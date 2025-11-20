// src/features/document/document.service.js
'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Document, Signer, ShareToken, AuditLog, User, Certificate, sequelize } = require('../../models');

// Serviços externos
const notificationService = require('../../services/notification.service');
const auditService = require('../audit/audit.service');
const pdfService = require('../../services/pdf.service');
const padesService = require('../../services/pades.service');

/**
 * Salva a imagem da assinatura (em Base64) como um arquivo PNG no disco.
 * @param {string} base64Image - A string Base64 da imagem PNG.
 * @param {string} tenantId - O ID do tenant para organizar os arquivos.
 * @param {string} signerId - O ID do signatário para nomear o arquivo.
 * @returns {Promise<string>} O caminho relativo do arquivo salvo.
 */
const saveSignatureImage = async (base64Image, tenantId, signerId) => {
  const base64Data = base64Image.replace(/^data:image\/png;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, 'base64');
  
  const dir = path.join(__dirname, '..', '..', '..', 'uploads', tenantId, 'signatures');
  await fs.mkdir(dir, { recursive: true });
  
  const filePath = path.join(dir, `${signerId}.png`);
  await fs.writeFile(filePath, imageBuffer);
  
  return path.relative(path.join(__dirname, '..', '..', '..'), filePath);
};

/**
 * Cria um registro de documento, lida com o upload do arquivo, calcula seu hash
 * e cria o primeiro evento de auditoria.
 */
const createDocumentAndHandleUpload = async ({ file, title, deadlineAt, user }) => {
  const transaction = await sequelize.transaction();
  try {
    const doc = await Document.create({
      tenantId: user.tenantId, // Usa o contexto atual do usuário
      ownerId: user.id,
      title: title || file.originalname,
      deadlineAt,
      mimeType: file.mimetype,
      size: file.size,
      status: 'DRAFT',
    }, { transaction });

    const permanentDir = path.join(__dirname, '..', '..', '..', 'uploads', user.tenantId);
    await fs.mkdir(permanentDir, { recursive: true });
    const fileExtension = path.extname(file.originalname);
    const permanentPath = path.join(permanentDir, `${doc.id}${fileExtension}`);
    
    await fs.rename(file.path, permanentPath);

    const fileBuffer = await fs.readFile(permanentPath);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    doc.storageKey = path.relative(path.join(__dirname, '..', '..', '..'), permanentPath);
    doc.sha256 = sha256;
    doc.status = 'READY';
    await doc.save({ transaction });

    // Log de Auditoria
    await auditService.createEntry({
      tenantId: user.tenantId,
      actorKind: 'USER',
      actorId: user.id,
      entityType: 'DOCUMENT',
      entityId: doc.id,
      action: 'STORAGE_UPLOADED',
      ip: 'SYSTEM', 
      userAgent: 'SYSTEM',
      payload: { fileName: file.originalname, sha256 }
    }, transaction);

    await transaction.commit();
    return doc;
  } catch (error) {
    await transaction.rollback();
    if (file && file.path) {
      await fs.unlink(file.path).catch(err => console.error("Falha ao limpar arquivo temporário após erro:", err));
    }
    throw error;
  }
};

/**
 * Valida um Buffer de PDF contra os registros do banco de dados (Prova de Autenticidade).
 */
const validatePdfIntegrity = async (fileBuffer) => {
  // 1. Calcula o SHA-256 do arquivo recebido
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // 2. Busca no banco
  const doc = await Document.findOne({
    where: { sha256: hash },
    include: [
      { 
        model: User, 
        as: 'owner', 
        attributes: ['name', 'email'] 
      },
      {
        model: Signer,
        as: 'Signers',
        attributes: ['name', 'email', 'status', 'signedAt'] 
      }
    ]
  });

  if (!doc) {
    return { valid: false };
  }

  return {
    valid: true,
    document: {
      title: doc.title,
      status: doc.status,
      createdAt: doc.createdAt,
      ownerName: doc.owner.name,
      signers: doc.Signers
    }
  };
};

/**
 * Verifica a integridade da corrente de logs (Blockchain-like verification).
 */
const verifyAuditLogChain = async (docId) => {
  // 1. Busca todos os logs relacionados a este documento e seus signatários
  const signers = await Signer.findAll({ where: { documentId: docId }, attributes: ['id'] });
  const signerIds = signers.map(s => s.id);

  // Busca logs crus ordenados por criação
  const logs = await AuditLog.findAll({
    where: {
      [Op.or]: [
        { entityType: 'DOCUMENT', entityId: docId },
        { entityType: 'SIGNER', entityId: { [Op.in]: signerIds } }
      ]
    },
    order: [['createdAt', 'ASC']]
  });

  if (logs.length === 0) {
    return { isValid: true, count: 0 };
  }

  // 2. Itera e recalcula
  for (let i = 0; i < logs.length; i++) {
    const currentLog = logs[i];
    const previousLog = i > 0 ? logs[i - 1] : null;

    // Verifica encadeamento
    if (previousLog) {
      if (currentLog.prevEventHash !== previousLog.eventHash) {
        return { isValid: false, brokenEventId: currentLog.id, reason: 'Broken Link (prevHash mismatch)' };
      }
    }

    // Recalcula o Hash do Evento Atual
    const { 
      actorKind, actorId, entityType, entityId, 
      action, ip, userAgent, payloadJson, prevEventHash, createdAt 
    } = currentLog;

    const payloadToHash = {
      actorKind, actorId, entityType, entityId, action, ip, userAgent, ...payloadJson
    };
    
    const timestamp = new Date(createdAt).toISOString();
    const payloadString = JSON.stringify(payloadToHash) + timestamp;

    const calculatedHash = crypto.createHash('sha256')
      .update(prevEventHash + payloadString)
      .digest('hex');

    if (calculatedHash !== currentLog.eventHash) {
      console.error(`Integrity Fail at ID ${currentLog.id}`);
      return { isValid: false, brokenEventId: currentLog.id, reason: 'Hash Mismatch (Tampering detected)' };
    }
  }

  return { isValid: true, count: logs.length };
};

/**
 * Encontra um documento pelo ID, garantindo que ele pertença ao tenant do usuário.
 */
const findDocumentById = async (docId, user) => {
    const document = await Document.findOne({
        where: { id: docId, tenantId: user.tenantId },
        include: [{ model: Signer, as: 'Signers'}]
    });
    if (!document) throw new Error('Documento não encontrado ou acesso negado.');
    return document;
};

/**
 * Atualiza os detalhes de um documento.
 */
const updateDocumentDetails = async (docId, updates, user) => {
    const document = await findDocumentById(docId, user);
    const allowedUpdates = ['title', 'deadlineAt', 'autoReminders'];
    const validUpdates = {};
    for (const key of allowedUpdates) {
        if (updates[key] !== undefined) {
            validUpdates[key] = updates[key];
        }
    }
    await document.update(validUpdates);
    return document;
};

/**
 * Obtém o caminho absoluto do arquivo no servidor.
 */
const getDocumentFilePath = async (docId, user) => {
    const document = await Document.findOne({
      where: { id: docId, tenantId: user.tenantId } // Garante acesso pelo tenant
    });

    if (!document || !document.storageKey) {
      throw new Error('Arquivo do documento não encontrado ou acesso negado.');
    }
    
    const absolutePath = path.join(__dirname, '..', '..', '..', document.storageKey);
    const originalName = document.title.includes('.') ? document.title : `${document.title}${path.extname(document.storageKey)}`;
    return { filePath: absolutePath, originalName };
};

/**
 * Retorna a URL pública para download do documento.
 */
const getDocumentDownloadUrl = async (docId, user) => {
    const document = await Document.findOne({
        where: { id: docId, tenantId: user.tenantId }
    });
    if (!document) {
        throw new Error('Documento não encontrado ou acesso negado.');
    }
    
    const fileUrl = `${process.env.API_BASE_URL}/${document.storageKey}`;
    return { url: fileUrl };
};

/**
 * Adiciona signatários e dispara convites.
 */
const addSignersToDocument = async (docId, signers, message, user) => {
  const transaction = await sequelize.transaction();
  try {
    const document = await Document.findOne({ where: { id: docId, tenantId: user.tenantId }, transaction });
    if (!document) {
      throw new Error('Documento não encontrado ou acesso negado.');
    }

    for (const signerData of signers) {
      const signer = await Signer.create({
        documentId: docId,
        name: signerData.name,
        email: signerData.email,
        phoneWhatsE164: signerData.phone,
        cpf: signerData.cpf,
        qualification: signerData.qualification,
        authChannels: signerData.authChannels,
        order: signerData.order || 0
      }, { transaction });

      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = document.deadlineAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await ShareToken.create({
        documentId: docId,
        signerId: signer.id,
        tokenHash,
        expiresAt,
      }, { transaction });

      await auditService.createEntry({
        tenantId: user.tenantId,
        actorKind: 'USER',
        actorId: user.id,
        entityType: 'SIGNER',
        entityId: signer.id,
        action: 'INVITED',
        ip: 'SYSTEM', 
        userAgent: 'SYSTEM',
        payload: { documentId: docId, recipient: signer.email }
      }, transaction);
      
      // Envio de notificação (Email/Whatsapp)
      await notificationService.sendSignInvite(signer, token, message, document.tenantId);
    }
    
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

/**
 * Retorna a trilha de auditoria completa de um documento e seus signatários.
 */
const findAuditTrail = async (docId, user) => {
    await findDocumentById(docId, user); // Valida acesso
    const signers = await Signer.findAll({ where: { documentId: docId }, attributes: ['id'] });
    const signerIds = signers.map(s => s.id);

    // Retorna logs crus para a API (o auditService.listLogs é para o painel geral)
    return AuditLog.findAll({
        where: {
            [Op.or]: [
                { entityType: 'DOCUMENT', entityId: docId },
                { entityType: 'SIGNER', entityId: { [Op.in]: signerIds } }
            ]
        },
        order: [['createdAt', 'ASC']]
    });
};

/**
 * Altera o status de um documento.
 */
const changeDocumentStatus = async (docId, newStatus, user) => {
  const transaction = await sequelize.transaction();
  try {
    const document = await Document.findOne({ where: { id: docId, tenantId: user.tenantId }, transaction });
    if (!document) throw new Error('Documento não encontrado.');
    
    document.status = newStatus;
    await document.save({ transaction });

    await auditService.createEntry({
      tenantId: user.tenantId,
      actorKind: 'USER',
      actorId: user.id,
      entityType: 'DOCUMENT',
      entityId: docId,
      action: 'STATUS_CHANGED',
      ip: 'SYSTEM',
      userAgent: 'SYSTEM',
      payload: { newStatus }
    }, transaction);

    await transaction.commit();
    return document;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

/**
 * Lista todos os documentos, filtrados pelo Tenant Atual.
 */
const findAllDocuments = async (user, status) => {
    const whereClause = {
        tenantId: user.tenantId, // Filtra pelo contexto do token
    };

    const statusMap = {
        pendentes: ['READY', 'PARTIALLY_SIGNED'],
        concluidos: ['SIGNED'],
        lixeira: ['CANCELLED', 'EXPIRED'],
    };
    
    if (status && statusMap[status]) {
        whereClause.status = { [Op.in]: statusMap[status] };
    } else {
        whereClause.status = { [Op.notIn]: ['CANCELLED'] };
    }

    return Document.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']],
        include: [
            { model: Signer, as: 'Signers' },
            { model: User, as: 'owner', attributes: ['name'] } // Inclui nome do criador
        ]
    });
};

/**
 * Obtém estatísticas do Tenant atual.
 */
const getDocumentStats = async (user) => {
  const tenantId = user.tenantId; // Filtra pelo contexto do token

  const [pendingCount, signedCount, totalCount] = await Promise.all([
    Document.count({ where: { tenantId, status: { [Op.in]: ['READY', 'PARTIALLY_SIGNED'] } } }),
    Document.count({ where: { tenantId, status: 'SIGNED' } }),
    Document.count({ where: { tenantId, status: { [Op.notIn]: ['CANCELLED'] } } })
  ]);

  return {
    pending: pendingCount,
    signed: signedCount,
    total: totalCount,
  };
};

/**
 * Aplica a assinatura PAdES (Digital) ao documento.
 * Normalmente chamado após todos os signatários assinarem visualmente ou sob demanda.
 */
const finalizeWithPades = async (docId, user) => {
    const transaction = await sequelize.transaction();
    try {
        // 1. Busca Documento
        const document = await Document.findOne({ 
            where: { id: docId, tenantId: user.tenantId },
            include: [{ model: Signer, as: 'Signers' }],
            transaction 
        });
        
        if (!document) throw new Error('Documento não encontrado.');

        // 2. Lê o arquivo atual (pode já ter assinaturas visuais)
        const filePath = path.join(__dirname, '..', '..', '..', document.storageKey);
        const fileBuffer = await fs.readFile(filePath);

        // 3. Prepara dados para carimbos visuais (se necessário reutilizar lógica de visual)
        const signersData = document.Signers.map(s => ({
            name: s.name,
            signedAt: s.signedAt,
            artefactPath: s.signatureArtefactPath,
            positionX: s.signaturePositionX,
            positionY: s.signaturePositionY,
            positionPage: s.signaturePositionPage
        }));

        // 4. Aplica PAdES + Carimbos Visuais (Service PAdES)
        // Nota: O padesService deve ser capaz de lidar com isso.
        const signedPdfBuffer = await padesService.applyPadesSignatureWithStamps(fileBuffer, signersData);
        
        // 5. Salva novo arquivo
        const newStorageKey = document.storageKey.replace(/(\.[\w\d_-]+)$/i, '-pades$1');
        const newPath = path.join(__dirname, '..', '..', '..', newStorageKey);
        await fs.writeFile(newPath, signedPdfBuffer);

        // 6. Atualiza Hash e Caminho
        const newSha256 = crypto.createHash('sha256').update(signedPdfBuffer).digest('hex');
        document.storageKey = newStorageKey;
        document.sha256 = newSha256;
        // Opcional: Atualizar status se já não estiver SIGNED
        if (document.status !== 'SIGNED') document.status = 'SIGNED';
        
        await document.save({ transaction });

        // 7. Log de Auditoria
        await auditService.createEntry({
            tenantId: user.tenantId,
            actorKind: 'USER',
            actorId: user.id,
            entityType: 'DOCUMENT',
            entityId: docId,
            action: 'PADES_SIGNED',
            ip: 'SYSTEM',
            userAgent: 'SYSTEM',
            payload: { newSha256 }
        }, transaction);

        await transaction.commit();
        return document;

    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

module.exports = {
  saveSignatureImage,
  createDocumentAndHandleUpload,
  validatePdfIntegrity,
  verifyAuditLogChain,
  findDocumentById,
  updateDocumentDetails,
  getDocumentFilePath,
  getDocumentDownloadUrl,
  addSignersToDocument,
  findAuditTrail,
  changeDocumentStatus,
  findAllDocuments,
  getDocumentStats,
  finalizeWithPades
};