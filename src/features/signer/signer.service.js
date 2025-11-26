// src/features/signer/signer.service.js
'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid'); // Necessário para o ID da assinatura visual

// Importação dos Modelos
const { 
  Document, 
  Signer, 
  OtpCode, 
  AuditLog, 
  Certificate, 
  User, 
  TenantSettings, 
  sequelize 
} = require('../../models');

// Importação dos Serviços
const notificationService = require('../../services/notification.service');
const documentService = require('../document/document.service');
const pdfService = require('../../services/pdf.service');
const auditService = require('../audit/audit.service');

/**
 * Salva a imagem da assinatura (em Base64) como um arquivo PNG no disco.
 * Retorna o caminho relativo para armazenamento no banco de dados.
 */
const saveSignatureImage = async (base64Image, tenantId, signerId) => {
  if (!base64Image) {
    throw new Error("Imagem da assinatura (Base64) não fornecida.");
  }
  
  // Define o diretório de upload absoluto usando a raiz do projeto
  const uploadDir = path.join(process.cwd(), 'uploads', tenantId, 'signatures');
  
  // Garante que o diretório existe
  await fs.mkdir(uploadDir, { recursive: true });
  
  // Limpa o cabeçalho do base64 e cria o buffer
  const base64Data = base64Image.replace(/^data:image\/png;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, 'base64');
  
  const fileName = `${signerId}.png`;
  const filePath = path.join(uploadDir, fileName);
  
  await fs.writeFile(filePath, imageBuffer);
  
  // Retorna o caminho RELATIVO (padrão POSIX para compatibilidade no banco)
  return path.join('uploads', tenantId, 'signatures', fileName);
};

/**
 * Obtém o resumo do documento para o signatário (Visualização do Link).
 * Registra o evento de visualização se for a primeira vez.
 */
const getSignerSummary = async (document, signer, req) => {
  // Se for a primeira visualização, atualiza status e loga
  if (signer.status === 'PENDING') {
    signer.status = 'VIEWED';
    await signer.save();
    
    await auditService.createEntry({
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

  const owner = await User.findByPk(document.ownerId);
  if (!owner) throw new Error("Proprietário do documento não encontrado.");
  
  // Gera URL segura para visualização do PDF
  const { url: documentUrl } = await documentService.getDocumentDownloadUrl(document.id, owner);
  
  return {
    document: {
      id: document.id,
      title: document.title,
      createdAt: document.createdAt,
      deadlineAt: document.deadlineAt,
      url: documentUrl,
    },
    signer: {
      name: signer.name,
      email: signer.email,
      phoneWhatsE164: signer.phoneWhatsE164,
      status: signer.status,
    }
  };
};

/**
 * Atualiza dados cadastrais do signatário (CPF/Fone) antes da assinatura.
 */
const identifySigner = async (signer, { cpf, phone }) => {
  if (cpf) signer.cpf = cpf;
  if (phone) signer.phoneWhatsE164 = phone;
  await signer.save();
};

/**
 * Envia o código OTP (One-Time Password) para os canais configurados.
 */
const startOtpVerification = async (signer, req) => {
  const otp = crypto.randomInt(100000, 999999).toString();
  const codeHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

  const channels = signer.authChannels || ['EMAIL'];

  for (const channel of channels) {
    const recipient = channel === 'EMAIL' ? signer.email : signer.phoneWhatsE164;
    if (!recipient) continue;

    // Salva hash no banco
    await OtpCode.create({ 
        recipient, 
        channel, 
        codeHash, 
        expiresAt, 
        context: 'SIGNING' 
    });
    
    // Envia via provedor (Z-API / Resend)
    notificationService.sendOtp(recipient, channel, otp, req.document.tenantId).catch(console.error);
    
    // Log de Auditoria
    await auditService.createEntry({
        tenantId: req.document.tenantId,
        actorKind: 'SYSTEM',
        entityType: 'OTP',
        entityId: signer.id,
        action: 'OTP_SENT',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        payload: { channel, recipient_masked: recipient.replace(/(.{2})(.*)(@|.{2})$/, "$1***$3") }
    });
  }
};

/**
 * Valida o código OTP inserido pelo usuário.
 */
const verifyOtp = async (signer, otp, req) => {
    const recipients = [signer.email, signer.phoneWhatsE164].filter(Boolean);
    
    const otpRecord = await OtpCode.findOne({
      where: { recipient: recipients, context: 'SIGNING' },
      order: [['createdAt', 'DESC']]
    });

    // Valida Existência e Expiração
    if (!otpRecord || new Date() > new Date(otpRecord.expiresAt)) {
        await auditService.createEntry({
             tenantId: req.document.tenantId, 
             actorKind: 'SIGNER', 
             actorId: signer.id, 
             entityType: 'OTP', 
             entityId: signer.id, 
             action: 'OTP_FAILED',
             ip: req.ip,
             userAgent: req.headers['user-agent'],
             payload: { reason: 'Expired or Not Found' }
        });
        throw new Error('Código OTP inválido ou expirado.');
    }

    // Valida Hash
    const isMatch = await bcrypt.compare(otp, otpRecord.codeHash);
    if (!isMatch) {
         await auditService.createEntry({
             tenantId: req.document.tenantId, 
             actorKind: 'SIGNER', 
             actorId: signer.id, 
             entityType: 'OTP', 
             entityId: signer.id, 
             action: 'OTP_FAILED',
             ip: req.ip,
             userAgent: req.headers['user-agent'],
             payload: { reason: 'Incorrect Code' }
        });
        throw new Error('Código OTP inválido.');
    }

    // Sucesso
    await auditService.createEntry({ 
        tenantId: req.document.tenantId, 
        actorKind: 'SIGNER', 
        actorId: signer.id, 
        entityType: 'OTP', 
        entityId: signer.id, 
        action: 'OTP_VERIFIED',
        ip: req.ip,
        userAgent: req.headers['user-agent']
    });
    
    // Queima o token para evitar reuso
    await otpRecord.destroy();
};

/**
 * Salva metadados de posição da assinatura visual (X, Y, Página).
 */
const saveSignaturePosition = async (signer, position) => {
  signer.signaturePositionX = position.x;
  signer.signaturePositionY = position.y;
  signer.signaturePositionPage = position.page;
  await signer.save();
};

/**
 * Efetiva a assinatura.
 * 1. Gera Hash, ShortCode, UUID Visual.
 * 2. Salva IP e Imagem.
 * 3. Atualiza Signer e Audita.
 * 4. Se TODOS assinaram: Gera PDF Final (com carimbos detalhados), e-mails customizados e certificado.
 * 
 * @param {string} userIp - IP do cliente passado pelo controller.
 */
const commitSignature = async (document, signer, clientFingerprint, signatureImageBase64, req, userIp) => {
    const transaction = await sequelize.transaction();
    let resultData = {};

    try {
        const timestampISO = new Date().toISOString();
        
        // 1. Gera o Hash SHA256 da Assinatura (Integridade)
        const signatureHash = crypto.createHash('sha256')
            .update(document.sha256 + signer.id + timestampISO + clientFingerprint)
            .digest('hex');
        
        // 2. Gera Código Curto de Verificação
        const shortCode = signatureHash.substring(0, 6).toUpperCase();

        // 3. Salva Imagem da Assinatura
        const artefactPath = await saveSignatureImage(signatureImageBase64, document.tenantId, signer.id);

        // 4. Atualiza Signatário (Com IP e UUID para o carimbo visual)
        signer.status = 'SIGNED';
        signer.signedAt = new Date();
        signer.signatureHash = signatureHash;
        signer.signatureArtefactPath = artefactPath;
        
        // --- NOVOS CAMPOS ---
        signer.ip = userIp; // Salva o IP
        signer.signatureUuid = uuidv4(); // Gera ID único para exibição no PDF
        // --------------------

        await signer.save({ transaction });

        // 5. Log de Auditoria: SIGNED
        await auditService.createEntry({
            tenantId: document.tenantId,
            actorKind: 'SIGNER',
            actorId: signer.id,
            entityType: 'DOCUMENT',
            entityId: document.id,
            action: 'SIGNED',
            ip: userIp || req.ip,
            userAgent: req.headers['user-agent'],
            payload: { signatureHash, artefactPath, shortCode, clientFingerprint, ip: userIp }
        }, transaction);

        // 6. Verifica se TODOS os signatários já assinaram
        const signersInDoc = await Signer.findAll({ where: { documentId: document.id }, transaction });
        const allSigned = signersInDoc.every(s => s.status === 'SIGNED');

        if (allSigned) {
            console.log(`[FINALIZE] Documento ${document.id} completo. Iniciando geração do PDF final...`);
            
            // CAMINHO ABSOLUTO: Garante que achamos o arquivo original
            const originalFilePath = path.join(process.cwd(), document.storageKey);
            
            if (!fsSync.existsSync(originalFilePath)) {
                console.error(`[ERRO CRÍTICO] Arquivo não encontrado: ${originalFilePath}`);
                throw new Error("Arquivo original do documento não encontrado no servidor.");
            }

            // 6a. Embute assinaturas visuais (Carimbo Detalhado: IP, CPF, Hash, UUID)
            // Agora passamos o objeto 'document' também para o PDF Service pegar o hash do doc e ID
            const signedPdfBuffer = await pdfService.embedSignatures(originalFilePath, signersInDoc, document);
            
            // 6b. Salva novo PDF Assinado
            const signedFileStorageKey = document.storageKey.replace(/(\.[\w\d_-]+)$/i, '-signed$1');
            const signedFilePath = path.join(process.cwd(), signedFileStorageKey);
            await fs.writeFile(signedFilePath, signedPdfBuffer);

            // 6c. Calcula novo Hash e Atualiza Documento
            const newSha256 = crypto.createHash('sha256').update(signedPdfBuffer).digest('hex');
            
            document.status = 'SIGNED';
            document.storageKey = signedFileStorageKey; // Aponta para o novo arquivo
            document.sha256 = newSha256;
            await document.save({ transaction });

            await auditService.createEntry({ 
                tenantId: document.tenantId, 
                actorKind: 'SYSTEM', 
                entityType: 'DOCUMENT', 
                entityId: document.id, 
                action: 'STATUS_CHANGED', 
                payload: { newStatus: 'SIGNED', newSha256 }
            }, transaction);

            // 6d. Emite Certificado de Conclusão (Registro no Banco)
            const certificateSha256 = crypto.createHash('sha256').update(`CERT-${document.id}-${timestampISO}`).digest('hex');
            await Certificate.create({
                documentId: document.id,
                storageKey: `certificates/${document.id}.pdf`, // Caminho virtual/futuro do PDF do certificado
                sha256: certificateSha256,
                issuedAt: new Date()
            }, { transaction });

            await auditService.createEntry({ 
                tenantId: document.tenantId, 
                actorKind: 'SYSTEM', 
                entityType: 'DOCUMENT', 
                entityId: document.id, 
                action: 'CERTIFICATE_ISSUED'
            }, transaction);

            // 6e. Envia E-mails de Conclusão (Com Template Customizável)
            
            // 1. Busca Configurações do Tenant para ver se tem template
            const tenantSettings = await TenantSettings.findOne({ 
                where: { tenantId: document.tenantId },
                transaction 
            });

            // 2. Prepara dados para link de download
            const owner = await User.findByPk(document.ownerId, { transaction });
            const { url: downloadUrl } = await documentService.getDocumentDownloadUrl(document.id, owner); // Usando owner como proxy de auth

            // 3. Define o Template (Customizado ou Padrão)
            let emailBodyTemplate = tenantSettings?.finalEmailTemplate;

            if (!emailBodyTemplate) {
                // Template Padrão (Fallback)
                emailBodyTemplate = `
                    <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2563EB;">Documento Finalizado</h2>
                        <p>Olá, <strong>{{signer_name}}</strong>.</p>
                        <p>O processo de assinatura do documento <strong>{{doc_title}}</strong> foi concluído por todas as partes.</p>
                        <p>O documento possui validade jurídica e integridade garantida.</p>
                        <p style="margin: 30px 0;">
                            <a href="{{doc_link}}" style="background-color: #10B981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
                                Baixar Documento Assinado
                            </a>
                        </p>
                        <p><small style="color: #666;">ID do Documento: {{doc_id}}</small></p>
                    </div>
                `;
            }

            // 4. Compilação Parcial (variáveis comuns)
            let compiledBase = emailBodyTemplate
                .replace(/{{doc_title}}/g, document.title)
                .replace(/{{doc_link}}/g, downloadUrl)
                .replace(/{{doc_id}}/g, document.id);

            // 5. Envio para o Dono
            if (owner) {
                const ownerHtml = compiledBase.replace(/{{signer_name}}/g, owner.name);
                notificationService.sendEmail(document.tenantId, {
                    to: owner.email,
                    subject: `Documento Finalizado: ${document.title}`,
                    html: ownerHtml
                }).catch(err => console.error("Erro ao notificar dono:", err.message));
            }
            
            // 6. Envio para Signatários
            signersInDoc.forEach(s => {
                 if (s.email) {
                    const signerHtml = compiledBase.replace(/{{signer_name}}/g, s.name);
                    
                    notificationService.sendEmail(document.tenantId, {
                        to: s.email,
                        subject: `Cópia do Documento Assinado: ${document.title}`,
                        html: signerHtml
                    }).catch(err => console.error(`Erro ao notificar signatário ${s.email}:`, err.message));
                 }
            });
        }

        await transaction.commit();

        // Dados para retorno ao Frontend
        resultData = {
            shortCode,
            signatureHash,
            isComplete: allSigned
        };

    } catch (error) {
        await transaction.rollback();
        console.error("Erro commitSignature:", error);
        throw error;
    }

    return resultData;
};

module.exports = {
  getSignerSummary,
  identifySigner,
  startOtpVerification,
  verifyOtp,
  commitSignature,
  saveSignaturePosition,
};