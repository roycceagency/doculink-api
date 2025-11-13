// src/features/signer/signer.service.js

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { Document, Signer, OtpCode, AuditLog, Certificate, User, sequelize } = require('../../models');
const notificationService = require('../../services/notification.service');
const documentService = require('../document/document.service');
const { createAuditLog } = require('../document/document.service');
const pdfService = require('../../services/pdf.service'); // <-- IMPORTE O NOVO SERVIÇO

const saveSignatureImage = async (base64Image, tenantId, signerId) => {
  if (!base64Image) {
    throw new Error("Imagem da assinatura (Base64) não fornecida.");
  }
  const base64Data = base64Image.replace(/^data:image\/png;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, 'base64');
  
  const dir = path.join(__dirname, '..', '..', '..', 'uploads', tenantId, 'signatures');
  await fs.mkdir(dir, { recursive: true });
  
  const filePath = path.join(dir, `${signerId}.png`);
  await fs.writeFile(filePath, imageBuffer);
  
  return path.relative(path.join(__dirname, '..', '..', '..'), filePath);
};

/**
 * Obtém o resumo do documento para o signatário e registra o evento de visualização.
 * @param {object} document - Instância do modelo Document do Sequelize.
 * @param {object} signer - Instância do modelo Signer do Sequelize.
 * @param {object} req - Objeto da requisição Express.
 * @returns {object} Um resumo com dados do documento e do signatário.
 */
const getSignerSummary = async (document, signer, req) => {
  // Se for a primeira vez que o signatário acessa (status PENDING),
  // atualiza o status para VIEWED e cria um log de auditoria.
  if (signer.status === 'PENDING') {
    signer.status = 'VIEWED';
    await signer.save();

    await createAuditLog({
      tenantId: document.tenantId,
      actorKind: 'SIGNER',
      actorId: signer.id,
      entityType: 'DOCUMENT',
      entityId: document.id,
      action: 'VIEWED',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // Busca o usuário "dono" do documento.
  // Isso é necessário para chamar a função de geração de URL, que valida o acesso pelo dono.
  const owner = await User.findByPk(document.ownerId);
  if (!owner) {
    // Lança um erro se, por alguma inconsistência de dados, o dono não for encontrado.
    throw new Error("Proprietário do documento não foi encontrado. Não é possível gerar a URL do documento.");
  }
  
  // Chama a função do documentService para obter a URL pública do documento.
  const { url: documentUrl } = await documentService.getDocumentDownloadUrl(document.id, owner);
  
  // Monta e retorna o objeto de resposta final para o frontend.
  return {
    document: {
      id: document.id, // Inclui o ID para referência, se necessário
      title: document.title,
      createdAt: document.createdAt,
      deadlineAt: document.deadlineAt,
      url: documentUrl, // Inclui a URL do documento diretamente na resposta
    },
    signer: {
      name: signer.name,
      email: signer.email,
      phoneWhatsE164: signer.phoneWhatsE164, // Inclui o telefone
      status: signer.status,
    }
  };
};

/**
 * Atualiza o CPF do signatário.
 * @param {object} signer - Instância do modelo Signer do Sequelize.
 * @param {string} cpf - CPF fornecido pelo signatário.
 */
const identifySigner = async (signer, cpf) => {
  // Em uma aplicação real, adicione uma biblioteca para validar o formato e o dígito verificador do CPF.
  if (!cpf || cpf.length < 11) {
    throw new Error('Formato de CPF inválido.');
  }
  signer.cpf = cpf;
  await signer.save();
};

/**
 * Inicia o processo de verificação por OTP, enviando códigos para os canais do signatário.
 * @param {object} signer - Instância do modelo Signer do Sequelize.
 * @param {object} req - Objeto da requisição Express.
 */
const startOtpVerification = async (signer, req) => {
  const otp = crypto.randomInt(100000, 999999).toString();
  const codeHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Expira em 10 minutos

  // Itera sobre todos os canais de autenticação definidos para o signatário
  for (const channel of signer.authChannels) {
    const recipient = channel === 'EMAIL' ? signer.email : signer.phoneWhatsE164;
    if (!recipient) continue; // Pula se o canal não tiver um destinatário cadastrado

    // Cria um registro de OTP no banco de dados. Nunca armazene o OTP em texto plano.
    await OtpCode.create({
      recipient,
      channel,
      codeHash,
      expiresAt,
      context: 'SIGNING'
    });

    // Dispara o envio real via e-mail (Resend) ou WhatsApp (Z-API)
    // A função é assíncrona, mas não usamos 'await' aqui para não bloquear a resposta da API.
    // O envio acontece em segundo plano.
    notificationService.sendOtp(recipient, channel, otp);
    
    // Loga que um OTP foi enviado para este canal.
    await createAuditLog({
        tenantId: req.document.tenantId,
        actorKind: 'SYSTEM',
        entityType: 'OTP',
        entityId: signer.id, // A entidade do log é o signatário, para quem o OTP se destina
        action: 'OTP_SENT',
        payload: { channel, recipient: recipient } // Não vaza o OTP
    });
  }
};

/**
 * Verifica o código OTP fornecido pelo signatário.
 * @param {object} signer - Instância do modelo Signer do Sequelize.
 * @param {string} otp - Código de 6 dígitos fornecido pelo usuário.
 * @param {object} req - Objeto da requisição Express.
 */
const verifyOtp = async (signer, otp, req) => {
    const recipients = [signer.email, signer.phoneWhatsE164].filter(Boolean);
    
    // Busca o último OTP válido enviado para qualquer um dos contatos do signatário.
    const otpRecord = await OtpCode.findOne({
      where: { recipient: recipients, context: 'SIGNING' },
      order: [['createdAt', 'DESC']]
    });

    // Valida se o OTP existe e não expirou.
    if (!otpRecord || new Date() > new Date(otpRecord.expiresAt)) {
        await createAuditLog({ tenantId: req.document.tenantId, actorKind: 'SIGNER', actorId: signer.id, entityType: 'OTP', entityId: signer.id, action: 'OTP_FAILED', payload: { reason: 'Expired or not found' } });
        throw new Error('Código OTP inválido ou expirado.');
    }

    // Compara o código fornecido com o hash salvo no banco. É seguro contra timing attacks.
    const isMatch = await bcrypt.compare(otp, otpRecord.codeHash);
    if (!isMatch) {
        // Opcional: Incrementar 'attempts' no otpRecord e bloquear após X tentativas.
        await createAuditLog({ tenantId: req.document.tenantId, actorKind: 'SIGNER', actorId: signer.id, entityType: 'OTP', entityId: signer.id, action: 'OTP_FAILED', payload: { reason: 'Invalid code' } });
        throw new Error('Código OTP inválido.');
    }

    // Se o código é válido, o OTP é verificado com sucesso.
    await createAuditLog({ tenantId: req.document.tenantId, actorKind: 'SIGNER', actorId: signer.id, entityType: 'OTP', entityId: signer.id, action: 'OTP_VERIFIED' });
    
    // CRÍTICO: Deleta o OTP imediatamente após o uso para prevenir ataques de replay.
    await otpRecord.destroy();
};

/**
 * Finaliza o processo de assinatura, gerando o hash e atualizando os status.
 * @param {object} document - Instância do modelo Document.
 * @param {object} signer - Instância do modelo Signer.
 * @param {string} clientFingerprint - Hash que identifica o dispositivo/navegador do cliente.
 * @param {object} req - Objeto da requisição Express.
 */
const commitSignature = async (document, signer, clientFingerprint, signatureImageBase64, req) => {
    // Inicia uma transação de banco de dados para garantir que todas as operações ocorram com sucesso ou nenhuma ocorra.
    const transaction = await sequelize.transaction();
    try {
        // Gera o hash da assinatura: uma prova criptográfica que vincula o documento,
        // o signatário, o momento da assinatura e o dispositivo.
        const timestampISO = new Date().toISOString();
        const signatureHash = crypto.createHash('sha256')
            .update(document.sha256 + signer.id + timestampISO + clientFingerprint)
            .digest('hex');

        // Chama a função auxiliar para salvar a imagem da assinatura no disco.
        const artefactPath = await saveSignatureImage(signatureImageBase64, document.tenantId, signer.id);

        // Atualiza o registro do signatário no banco de dados com os dados da assinatura.
        signer.status = 'SIGNED';
        signer.signedAt = new Date();
        signer.signatureHash = signatureHash;
        signer.signatureArtefactPath = artefactPath;
        await signer.save({ transaction });

        // Registra este ato de assinatura na trilha de auditoria (hash-chain).
        await createAuditLog({
            tenantId: document.tenantId,
            actorKind: 'SIGNER',
            actorId: signer.id,
            entityType: 'DOCUMENT',
            entityId: document.id,
            action: 'SIGNED',
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            payload: { signatureHash, artefactPath }
        }, transaction);

        // Verifica se este foi o último signatário a assinar.
        const allSigners = await Signer.findAll({ where: { documentId: document.id }, transaction });
        const allSigned = allSigners.every(s => s.status === 'SIGNED');

        // Se todos assinaram, executa as ações de finalização do documento.
        if (allSigned) {
            console.log(`[Doculink] Todos os ${allSigners.length} signatários assinaram o documento ${document.id}. Finalizando...`);
            
            // 1. Atualiza o status do documento para 'SIGNED'.
            document.status = 'SIGNED';
            await document.save({ transaction });

            // 2. Registra a mudança de status do documento na auditoria.
            await createAuditLog({ 
                tenantId: document.tenantId, 
                actorKind: 'SYSTEM', 
                entityType: 'DOCUMENT', 
                entityId: document.id, 
                action: 'STATUS_CHANGED', 
                payload: { newStatus: 'SIGNED' }
            }, transaction);

            // 3. Gera o PDF final com os carimbos visuais das assinaturas.
            const originalPdfPath = path.join(__dirname, '..', '..', '..', document.storageKey);
            const signedPdfBuffer = await pdfService.embedSignatures(originalPdfPath, allSigners);
            
            // Salva o novo PDF com um sufixo "-signed".
            const signedPdfPath = originalPdfPath.replace(/(\.[\w\d_-]+)$/i, '-signed$1');
            await fs.writeFile(signedPdfPath, signedPdfBuffer);
            console.log(`[Doculink] PDF final com assinaturas visuais gerado em: ${signedPdfPath}`);

            // 4. Gera o certificado de conclusão.
            // (Esta parte ainda pode ser expandida para gerar um PDF de certificado mais detalhado)
            const certificateStorageKey = `certificates/${document.id}.pdf`;
            const certificateSha256 = crypto.createHash('sha256').update('conteudo_pdf_do_certificado_simulado').digest('hex');
            
            await Certificate.create({
                documentId: document.id,
                storageKey: certificateStorageKey,
                sha256: certificateSha256
            }, { transaction });

            // 5. Registra a emissão do certificado na auditoria.
            await createAuditLog({ 
                tenantId: document.tenantId, 
                actorKind: 'SYSTEM', 
                entityType: 'DOCUMENT', 
                entityId: document.id, 
                action: 'CERTIFICATE_ISSUED'
            }, transaction);

            // TODO: Adicionar lógica para notificar todas as partes (dono e signatários)
            // enviando por e-mail o PDF final assinado e o certificado de conclusão.
        }

        // Se todas as operações foram bem-sucedidas, confirma a transação.
        await transaction.commit();
    } catch (error) {
        // Se qualquer operação falhar, desfaz todas as alterações no banco de dados.
        await transaction.rollback();
        console.error("Erro durante o commit da assinatura:", error);
        // Propaga o erro para o controller, que retornará uma resposta 500.
        throw error;
    }
};

const saveSignaturePosition = async (signer, position) => {
  signer.signaturePositionX = position.x;
  signer.signaturePositionY = position.y;
  signer.signaturePositionPage = position.page;
  await signer.save();
};


module.exports = {
  getSignerSummary,
  identifySigner,
  startOtpVerification,
  verifyOtp,
  commitSignature,
  saveSignaturePosition
};