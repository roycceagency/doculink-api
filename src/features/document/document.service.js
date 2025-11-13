// src/features/document/document.service.js
'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Document, AuditLog, Signer, ShareToken, sequelize } = require('../../models');
const notificationService = require('../../services/notification.service'); // Importa o serviço real de notificações


// --- INÍCIO DA CORREÇÃO ---
// Definição da função que estava faltando
/**
 * Salva a imagem da assinatura (em Base64) como um arquivo PNG no disco.
 * @param {string} base64Image - A string Base64 da imagem PNG.
 * @param {string} tenantId - O ID do tenant para organizar os arquivos.
 * @param {string} signerId - O ID do signatário para nomear o arquivo.
 * @returns {Promise<string>} O caminho relativo do arquivo salvo.
 */
const saveSignatureImage = async (base64Image, tenantId, signerId) => {
  // Remove o prefixo da string Base64 (ex: "data:image/png;base64,")
  const base64Data = base64Image.replace(/^data:image\/png;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, 'base64');
  
  const dir = path.join(__dirname, '..', '..', '..', 'uploads', tenantId, 'signatures');
  await fs.mkdir(dir, { recursive: true });
  
  const filePath = path.join(dir, `${signerId}.png`);
  await fs.writeFile(filePath, imageBuffer);
  
  // Retorna o caminho RELATIVO para ser salvo no banco de dados
  return path.relative(path.join(__dirname, '..', '..', '..'), filePath);
};

/**
 * Função central e reutilizável para criar e encadear os logs de auditoria (hash-chain).
 * @param {object} logData - Dados do evento de log.
 * @param {import('sequelize').Transaction} transaction - A transação do Sequelize.
 * @returns {Promise<AuditLog>}
 */
const createAuditLog = async (logData, transaction) => {
  const { tenantId, actorKind, actorId, entityType, entityId, action, ip, userAgent, payload = {} } = logData;
  
  const lastEvent = await AuditLog.findOne({
    where: { entityId },
    order: [['createdAt', 'DESC']],
    transaction
  });

  const prevEventHash = lastEvent ? lastEvent.eventHash : crypto.createHash('sha256').update('genesis_block_for_entity').digest('hex');

  const payloadToHash = {
    actorKind, actorId, entityType, entityId, action, ip, userAgent, ...payload
  };
  const payloadString = JSON.stringify(payloadToHash) + new Date().toISOString();

  const eventHash = crypto.createHash('sha256').update(prevEventHash + payloadString).digest('hex');

  return AuditLog.create({
    tenantId, actorKind, actorId, entityType, entityId, action, ip, userAgent,
    payloadJson: payload,
    prevEventHash,
    eventHash
  }, { transaction });
};

/**
 * Cria um registro de documento, lida com o upload do arquivo, calcula seu hash
 * e cria o primeiro evento de auditoria.
 */
const createDocumentAndHandleUpload = async ({ file, title, deadlineAt, user }) => {
  const transaction = await sequelize.transaction();
  try {
    const doc = await Document.create({
      tenantId: user.tenantId,
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

    await createAuditLog({
      tenantId: user.tenantId,
      actorKind: 'USER',
      actorId: user.id,
      entityType: 'DOCUMENT',
      entityId: doc.id,
      action: 'STORAGE_UPLOADED',
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
 * Atualiza os detalhes de um documento (apenas campos permitidos como título e prazo).
 */
const updateDocumentDetails = async (docId, updates, user) => {
    const document = await findDocumentById(docId, user);
    const allowedUpdates = ['title', 'deadlineAt'];
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
 * Obtém o caminho absoluto do arquivo no servidor para permitir o download.
 */
const getDocumentFilePath = async (docId, user) => {
    const document = await Document.findOne({
      where: { id: docId, ownerId: user.id } // Garantindo que só o dono possa acessar
    });

    if (!document || !document.storageKey) {
      throw new Error('Arquivo do documento não encontrado ou acesso negado.');
    }
    
    const absolutePath = path.join(__dirname, '..', '..', '..', document.storageKey);
    const originalName = document.title.includes('.') ? document.title : `${document.title}${path.extname(document.storageKey)}`;
    return { filePath: absolutePath, originalName };
};

const getDocumentDownloadUrl = async (docId, user) => {
    // Valida o acesso ao documento
    const document = await Document.findOne({
        where: { id: docId, ownerId: user.id }
    });
    if (!document) {
        throw new Error('Documento não encontrado ou acesso negado.');
    }
    
    // Constrói uma URL pública para o arquivo.
    // Isso requer que a pasta 'uploads' seja servida estaticamente pelo Express.
    const fileUrl = `${process.env.API_BASE_URL}/${document.storageKey}`;
    
    return { url: fileUrl };
};

/**
 * Adiciona um ou mais signatários a um documento e dispara os convites de assinatura.
 */
const addSignersToDocument = async (docId, signers, user) => {
  const transaction = await sequelize.transaction();
  try {
    const document = await Document.findOne({ where: { id: docId, tenantId: user.tenantId }, transaction });
    if (!document) throw new Error('Documento não encontrado.');

    for (const signerData of signers) {
      // Cria o registro do signatário no banco com todos os dados do frontend.
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

      // Gera um token de acesso único para o link de assinatura.
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = document.deadlineAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Salva o HASH do token no banco de dados.
      await ShareToken.create({
        documentId: docId,
        signerId: signer.id,
        tokenHash,
        expiresAt,
      }, { transaction });

      // Registra o evento de convite na trilha de auditoria.
      await createAuditLog({
        tenantId: user.tenantId,
        actorKind: 'USER',
        actorId: user.id,
        entityType: 'SIGNER',
        entityId: signer.id,
        action: 'INVITED',
        payload: { documentId: docId, recipient: signer.email }
      }, transaction);
      
      // Chama o serviço de notificação para enviar o convite real (e-mail/WhatsApp).
      await notificationService.sendSignInvite(signer, token);
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
    await findDocumentById(docId, user); 
    const signers = await Signer.findAll({ where: { documentId: docId }, attributes: ['id'] });
    const signerIds = signers.map(s => s.id);

    return AuditLog.findAll({
        where: {
            [sequelize.Op.or]: [
                { entityType: 'DOCUMENT', entityId: docId },
                { entityType: 'SIGNER', entityId: { [sequelize.Op.in]: signerIds } }
            ]
        },
        order: [['createdAt', 'ASC']]
    });
};

/**
 * Altera o status de um documento (ex: para CANCELLED ou EXPIRED).
 */
const changeDocumentStatus = async (docId, newStatus, user) => {
  const transaction = await sequelize.transaction();
  try {
    const document = await Document.findOne({ where: { id: docId, tenantId: user.tenantId }, transaction });
    if (!document) throw new Error('Documento não encontrado.');
    
    document.status = newStatus;
    await document.save({ transaction });

    await createAuditLog({
      tenantId: user.tenantId,
      actorKind: 'USER',
      actorId: user.id,
      entityType: 'DOCUMENT',
      entityId: docId,
      action: 'STATUS_CHANGED',
      payload: { newStatus }
    }, transaction);

    await transaction.commit();
    return document;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};


const findAllDocuments = async (user, status) => {
    const whereClause = {
        ownerId: user.id, // Garante que só os documentos do usuário logado sejam retornados
    };

    if (status) {
        // Mapeia os status do frontend para os status do backend
        const statusMap = {
            pendentes: ['READY', 'PARTIALLY_SIGNED'],
            concluidos: ['SIGNED'],
            lixeira: ['CANCELLED'], // Supondo que lixeira = cancelado
        };
        
        if (statusMap[status]) {
            whereClause.status = { [sequelize.Op.in]: statusMap[status] };
        }
    } else {
        // Se nenhum status for fornecido (ex: aba "Todos"), exclui os da lixeira
        whereClause.status = { [sequelize.Op.notIn]: ['CANCELLED'] };
    }

    return Document.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']],
    });
};

module.exports = {
  createAuditLog,
  createDocumentAndHandleUpload,
  findDocumentById,
  updateDocumentDetails,
  getDocumentFilePath,
  addSignersToDocument,
  findAuditTrail,
  changeDocumentStatus,
  getDocumentDownloadUrl,
  findAllDocuments
};