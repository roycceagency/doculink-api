// src/features/signer/signer.service.js
'use strict';

const fs = require('fs/promises');
const fsSync = require('fs'); // Usado para verificações síncronas rápidas de existência
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// Importação dos Modelos
const { Document, Signer, OtpCode, AuditLog, Certificate, User, sequelize } = require('../../models');

// Importação dos Serviços
const notificationService = require('../../services/notification.service');
const documentService = require('../document/document.service');
const pdfService = require('../../services/pdf.service');
const auditService = require('../audit/audit.service');

/**
 * Salva a imagem da assinatura (em Base64) como um arquivo PNG no disco.
 * Retorna o caminho relativo para armazenamento no banco.
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
  
  // Retorna o caminho RELATIVO (padrão POSIX para compatibilidade)
  // ex: uploads/tenant-id/signatures/xyz.png
  return path.join('uploads', tenantId, 'signatures', fileName);
};

/**
 * Obtém o resumo do documento para o signatário (Visualização do Link).
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
 * Atualiza dados cadastrais do signatário (CPF/Fone).
 */
const identifySigner = async (signer, { cpf, phone }) => {
  if (cpf) signer.cpf = cpf;
  if (phone) signer.phoneWhatsE164 = phone;
  await signer.save();
};

/**
 * Envia o código OTP (One-Time Password).
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
    // Não usamos await para não bloquear a resposta da API se o envio demorar
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
 * Valida o código OTP inserido.
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
    
    // Queima o token
    await otpRecord.destroy();
};

/**
 * Salva metadados de posição da assinatura visual.
 */
const saveSignaturePosition = async (signer, position) => {
  signer.signaturePositionX = position.x;
  signer.signaturePositionY = position.y;
  signer.signaturePositionPage = position.page;
  await signer.save();
};

/**
 * Efetiva a assinatura, gera PDF final se todos assinaram e emite certificados.
 */
const commitSignature = async (document, signer, clientFingerprint, signatureImageBase64, req) => {
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

        // 4. Atualiza Signatário
        signer.status = 'SIGNED';
        signer.signedAt = new Date();
        signer.signatureHash = signatureHash;
        signer.signatureArtefactPath = artefactPath;
        await signer.save({ transaction });

        // 5. Log de Auditoria: SIGNED
        await auditService.createEntry({
            tenantId: document.tenantId,
            actorKind: 'SIGNER',
            actorId: signer.id,
            entityType: 'DOCUMENT',
            entityId: document.id,
            action: 'SIGNED',
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            payload: { signatureHash, artefactPath, shortCode }
        }, transaction);

        // 6. Verifica status global do documento
        const signersInDoc = await Signer.findAll({ where: { documentId: document.id }, transaction });
        const allSigned = signersInDoc.every(s => s.status === 'SIGNED');

        if (allSigned) {
            console.log(`[FINALIZE] Documento ${document.id} completo. Iniciando geração do PDF final...`);
            
            // --- CORREÇÃO DE CAMINHO ABSOLUTO ---
            const originalFilePath = path.join(process.cwd(), document.storageKey);
            
            if (!fsSync.existsSync(originalFilePath)) {
                console.error(`[ERRO CRÍTICO] Arquivo não encontrado: ${originalFilePath}`);
                throw new Error("Arquivo original do documento não encontrado no servidor.");
            }

            // --- PREPARAÇÃO DE CAMINHOS PARA O PDF SERVICE ---
            // O pdfService precisa de caminhos absolutos para ler as imagens das assinaturas.
            // Como salvamos caminhos relativos no banco, precisamos convertê-los temporariamente.
            for (const s of signersInDoc) {
                if (s.signatureArtefactPath && !path.isAbsolute(s.signatureArtefactPath)) {
                    s.signatureArtefactPath = path.join(process.cwd(), s.signatureArtefactPath);
                }
            }

            // 6a. Embute assinaturas visuais
            const signedPdfBuffer = await pdfService.embedSignatures(originalFilePath, signersInDoc);
            
            // 6b. Salva novo PDF
            const signedFileStorageKey = document.storageKey.replace(/(\.[\w\d_-]+)$/i, '-signed$1');
            const signedFilePath = path.join(process.cwd(), signedFileStorageKey);
            await fs.writeFile(signedFilePath, signedPdfBuffer);

            // 6c. Calcula novo Hash e Atualiza Documento
            const newSha256 = crypto.createHash('sha256').update(signedPdfBuffer).digest('hex');
            
            document.status = 'SIGNED';
            document.storageKey = signedFileStorageKey; // Agora aponta para o PDF assinado
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

            // 6d. Emite Certificado de Conclusão
            const certificateSha256 = crypto.createHash('sha256').update(`CERT-${document.id}-${timestampISO}`).digest('hex');
            await Certificate.create({
                documentId: document.id,
                storageKey: `certificates/${document.id}.pdf`, // Mock do caminho
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

            // 6e. Envia E-mails de Conclusão
            const owner = await User.findByPk(document.ownerId, { transaction });
            
            // Dispara e-mail para o dono (Assíncrono, sem await para não travar)
            if (owner) {
                notificationService.sendEmail(document.tenantId, {
                    to: owner.email,
                    subject: `Documento Finalizado: ${document.title}`,
                    html: `
                        <h3>Processo Concluído</h3>
                        <p>O documento <strong>${document.title}</strong> foi assinado por todas as partes.</p>
                        <p>Acesse a plataforma para baixar a versão final e o certificado de auditoria.</p>
                    `
                }).catch(err => console.error("Erro ao notificar dono:", err.message));
            }
            
            // Dispara e-mail para os signatários
            signersInDoc.forEach(s => {
                 if (s.email) {
                    notificationService.sendEmail(document.tenantId, {
                        to: s.email,
                        subject: `Cópia do Documento Assinado: ${document.title}`,
                        html: `
                            <h3>Olá, ${s.name}</h3>
                            <p>O processo de assinatura do documento <strong>${document.title}</strong> foi concluído.</p>
                            <p>Você pode solicitar uma cópia do documento assinado entrando em contato com o remetente.</p>
                        `
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
        // Relança o erro para o controller enviar 500/400
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