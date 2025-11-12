// src/features/document/document.service.js

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Document, AuditLog, Signer, ShareToken, sequelize } = require('../../models');
const notificationService = require('../../services/notification.service'); // Importando o serviço real de notificações
const padesService = require('../../services/pades.service'); // <-- IMPORTE O NOVO SERVIÇO

/**
 * Função central para criar e encadear os logs de auditoria (hash-chain).
 * Esta função é exportada para ser reutilizada por outros serviços (como o signer.service).
 * @param {object} logData - Dados do evento de log.
 * @param {import('sequelize').Transaction} transaction - A transação do Sequelize.
 * @returns {Promise<AuditLog>}
 */
const createAuditLog = async (logData, transaction) => {
  const { tenantId, actorKind, actorId, entityType, entityId, action, ip, userAgent, payload = {} } = logData;
  
  // 1. Busca o hash do último evento para esta entidade para criar o encadeamento.
  const lastEvent = await AuditLog.findOne({
    where: { entityId },
    order: [['createdAt', 'DESC']],
    transaction
  });

  // Se for o primeiro evento, usamos um hash "gênese" fixo.
  const prevEventHash = lastEvent ? lastEvent.eventHash : crypto.createHash('sha256').update('genesis_block_for_entity').digest('hex');

  // 2. Prepara o payload que será usado para calcular o novo hash.
  const payloadToHash = {
    actorKind, actorId, entityType, entityId, action, ip, userAgent, ...payload
  };
  const payloadString = JSON.stringify(payloadToHash) + new Date().toISOString();

  // 3. Calcula o novo hash do evento, que é um hash do hash anterior + o payload atual.
  const eventHash = crypto.createHash('sha256').update(prevEventHash + payloadString).digest('hex');

  // 4. Cria e salva o novo registro de log de auditoria.
  return AuditLog.create({
    tenantId,
    actorKind,
    actorId,
    entityType,
    entityId,
    action,
    ip,
    userAgent,
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
    // 1. Cria o registro do documento no DB com status inicial 'DRAFT'.
    const doc = await Document.create({
      tenantId: user.tenantId,
      ownerId: user.id,
      title: title || file.originalname,
      deadlineAt,
      mimeType: file.mimetype,
      size: file.size,
      status: 'DRAFT',
    }, { transaction });

    // 2. Define o caminho permanente do arquivo (uploads/tenantId/documentId.ext) e garante que o diretório exista.
    const permanentDir = path.join(__dirname, '..', '..', '..', 'uploads', user.tenantId);
    await fs.mkdir(permanentDir, { recursive: true });
    const fileExtension = path.extname(file.originalname);
    const permanentPath = path.join(permanentDir, `${doc.id}${fileExtension}`);
    
    // 3. Move o arquivo da pasta temporária para a localização permanente.
    await fs.rename(file.path, permanentPath);

    // 4. Lê o arquivo movido para calcular seu hash SHA256.
    const fileBuffer = await fs.readFile(permanentPath);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 5. Atualiza o registro do documento com o hash, o caminho e o novo status 'READY'.
    doc.storageKey = path.relative(path.join(__dirname, '..', '..', '..'), permanentPath); // Salva o caminho relativo
    doc.sha256 = sha256;
    doc.status = 'READY';
    await doc.save({ transaction });

    // 6. Cria o primeiro evento na trilha de auditoria para este documento.
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
    // Em caso de erro, tenta apagar o arquivo temporário que pode ter ficado órfão.
    if (file && file.path) {
      await fs.unlink(file.path).catch(err => console.error("Falha ao limpar arquivo temporário após erro:", err));
    }
    throw error;
  }
};

/**
 * Encontra um documento pelo ID, garantindo que ele pertença ao tenant do usuário logado.
 */
const findDocumentById = async (docId, user) => {
    const document = await Document.findOne({
        where: { id: docId, tenantId: user.tenantId },
        include: [{ model: Signer, as: 'Signers'}] // Inclui os signatários associados
    });
    if (!document) throw new Error('Documento não encontrado ou acesso negado.');
    return document;
};

/**
 * Atualiza os detalhes de um documento (apenas campos permitidos).
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
 * Obtém o caminho absoluto do arquivo no servidor para download.
 */
const getDocumentFilePath = async (docId, user) => {
    const document = await findDocumentById(docId, user);
    if (!document.storageKey) throw new Error('Arquivo do documento não encontrado no armazenamento.');
    
    const absolutePath = path.join(__dirname, '..', '..', '..', document.storageKey);
    const originalName = document.title.includes('.') ? document.title : `${document.title}${path.extname(document.storageKey)}`;
    return { filePath: absolutePath, originalName };
};

/**
 * Adiciona um ou mais signatários a um documento e dispara os convites.
 */
const addSignersToDocument = async (docId, signers, user) => {
  const transaction = await sequelize.transaction();
  try {
    const document = await Document.findOne({ where: { id: docId, tenantId: user.tenantId }, transaction });
    if (!document) throw new Error('Documento não encontrado.');

    for (const signerData of signers) {
      // 1. Cria o signatário com os dados de posição
      const signer = await Signer.create({
        documentId: docId,
        name: signerData.name,
        email: signerData.email,
        phoneWhatsE164: signerData.phoneWhatsE164,
        authChannels: signerData.authChannels || ['EMAIL'],
        order: signerData.order || 0,
        // --- SALVANDO AS COORDENADAS ---
        signaturePositionX: signerData.position?.x,
        signaturePositionY: signerData.position?.y,
        signaturePositionPage: signerData.position?.page,
        // ---------------------------------
      }, { transaction });

      // 2. Gera um token de acesso único e seguro para o link de assinatura.
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = document.deadlineAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Expira no prazo do doc ou em 30 dias

      // 3. Salva o HASH do token no banco, nunca o token puro.
      await ShareToken.create({
        documentId: docId,
        signerId: signer.id,
        tokenHash,
        expiresAt,
      }, { transaction });

      // 4. Registra o convite na trilha de auditoria.
      await createAuditLog({
        tenantId: user.tenantId,
        actorKind: 'USER',
        actorId: user.id,
        entityType: 'SIGNER',
        entityId: signer.id, // O log é sobre a entidade Signer
        action: 'INVITED',
        payload: { documentId: docId, recipient: signer.email }
      }, transaction);
      
      // 5. Chama o serviço de notificação para enviar o convite real (e-mail/WhatsApp).
      // Passamos o token PURO, pois ele que vai no link.
      await notificationService.sendSignInvite(signer, token);
    }
    
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

/**
 * Retorna a trilha de auditoria completa de um documento.
 */
const findAuditTrail = async (docId, user) => {
    // Garante que o usuário tem acesso ao documento antes de mostrar o log.
    await findDocumentById(docId, user); 
    return AuditLog.findAll({
        // Busca por eventos cujo ID da entidade seja o do documento OU o de um de seus signatários.
        where: {
            [sequelize.Op.or]: [
                { entityType: 'DOCUMENT', entityId: docId },
                { entityType: 'SIGNER', entityId: { [sequelize.Op.in]: (await Signer.findAll({ where: { documentId: docId }, attributes: ['id'] })).map(s => s.id) } }
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

const finalizeWithPades = async (docId, user) => {
  const transaction = await sequelize.transaction();
  try {
    const document = await Document.findOne({ 
        where: { id: docId, tenantId: user.tenantId },
        // Inclui os signatários para obter seus dados e posições
        include: [{ model: Signer, as: 'Signers' }], 
        transaction 
    });
    if (!document) throw new Error('Documento não encontrado.');

    if (document.status !== 'SIGNED') {
        throw new Error(`A assinatura digital só pode ser aplicada a documentos com status 'SIGNED'. Status atual: ${document.status}`);
    }

    const originalFilePath = path.join(__dirname, '..', '..', '..', document.storageKey);
    const pdfBuffer = await fs.readFile(originalFilePath);

    // --- MONTA A LISTA DE ASSINATURAS PARA O SERVIÇO PADES ---
    const signaturesToApply = document.Signers.map(s => ({
        name: s.name,
        signedAt: s.signedAt,
        positionX: s.signaturePositionX,
        positionY: s.signaturePositionY,
        positionPage: s.signaturePositionPage,
    }));
    // -------------------------------------------------------------

    // Chama o novo serviço passando os dados dos signatários
    const padesSignedPdfBuffer = await padesService.applyPadesSignatureWithStamps(pdfBuffer, signaturesToApply);
    
    const newStorageKey = document.storageKey.replace(/(\.[\w\d_-]+)$/i, '-final$1');
    const newFilePath = path.join(__dirname, '..', '..', '..', newStorageKey);
    
    await fs.writeFile(newFilePath, padesSignedPdfBuffer);

    const newSha256 = crypto.createHash('sha256').update(padesSignedPdfBuffer).digest('hex');
    const oldSha256 = document.sha256;
    
    document.storageKey = newStorageKey;
    document.sha256 = newSha256;
    await document.save({ transaction });
    
    await createAuditLog({
      // ... (log de auditoria como antes) ...
    }, transaction);

    await transaction.commit();
    return document;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

module.exports = {
  createAuditLog, // Exportando para ser usado em outros serviços
  createDocumentAndHandleUpload,
  findDocumentById,
  updateDocumentDetails,
  getDocumentFilePath,
  addSignersToDocument,
  findAuditTrail,
  changeDocumentStatus,
  finalizeWithPades
};