// src/features/document/document.service.js
'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Op } = require('sequelize');  
const { Document, Signer, ShareToken, AuditLog, Certificate, Tenant, Plan, User, Folder, TenantSettings, sequelize } = require('../../models'); 

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
 * Inclui validações de Limite de Plano e Status de Pagamento.
 */
const createDocumentAndHandleUpload = async ({ file, title, deadlineAt, folderId, user }) => {
  
  // 1. Busca dados do Tenant e do Plano atual
  const tenant = await Tenant.findByPk(user.tenantId, {
      include: [{ model: Plan, as: 'plan' }]
  });

  if (!tenant) throw new Error('Organização não encontrada.');

  // --- TRAVA DE PLANO / ASSINATURA ---
  // Se o plano tiver preço > 0 (Básico, Pro, Empresa), valida o status do pagamento.
  // Se for Gratuito (price == 0), ignora status da assinatura (pois não existe no Asaas).
  if (tenant.plan && parseFloat(tenant.plan.price) > 0) {
      if (tenant.subscriptionStatus && ['OVERDUE', 'CANCELED'].includes(tenant.subscriptionStatus)) {
          throw new Error('Sua assinatura está pendente ou cancelada. Regularize para criar novos documentos.');
      }
  }

  // 3. Verifica quantidade atual vs Limite do Plano
  if (tenant.plan) {
      const currentCount = await Document.count({ where: { tenantId: user.tenantId } });
      
      if (currentCount >= tenant.plan.documentLimit) {
          const error = new Error(`Limite de documentos atingido (${currentCount}/${tenant.plan.documentLimit}). Faça upgrade do plano.`);
          error.statusCode = 403; // Forbidden
          throw error;
      }
  }
  // --- FIM DA TRAVA DE LIMITE ---

  const transaction = await sequelize.transaction();
  try {
    // 4. Cria o registro no banco de dados (Status Inicial: DRAFT)
    const doc = await Document.create({
      tenantId: user.tenantId,
      ownerId: user.id,
      folderId: folderId || null, // Vincula à pasta ou Raiz
      title: title || file.originalname,
      deadlineAt,
      mimeType: file.mimetype,
      size: file.size,
      status: 'DRAFT',
    }, { transaction });
    
    // 5. Prepara diretório permanente
    // Caminho: uploads/{tenantId}/{docId}.pdf
    const permanentDir = path.join(__dirname, '..', '..', '..', 'uploads', user.tenantId);
    await fs.mkdir(permanentDir, { recursive: true });
    
    const fileExtension = path.extname(file.originalname);
    const permanentPath = path.join(permanentDir, `${doc.id}${fileExtension}`);
    
    // 6. Move o arquivo da pasta temporária (multer) para a pasta permanente
    await fs.rename(file.path, permanentPath);

    // 7. Calcula o Hash SHA256 para garantia de integridade
    const fileBuffer = await fs.readFile(permanentPath);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 8. Atualiza o documento com o caminho final e o hash
    doc.storageKey = path.relative(path.join(__dirname, '..', '..', '..'), permanentPath);
    doc.sha256 = sha256;
    doc.status = 'READY'; // Agora está pronto para assinaturas
    await doc.save({ transaction });

    // 9. Registra o evento de Upload na Auditoria
    await auditService.createEntry({
      tenantId: user.tenantId,
      actorKind: 'USER',
      actorId: user.id,
      entityType: 'DOCUMENT',
      entityId: doc.id,
      action: 'STORAGE_UPLOADED',
      ip: 'SYSTEM', // Upload inicial via API interna
      userAgent: 'SYSTEM',
      payload: { fileName: file.originalname, sha256 }
    }, transaction);

    await transaction.commit();
    return doc;

  } catch (error) {
    await transaction.rollback();
    
    // Limpeza de arquivo temporário em caso de erro no banco
    if (file && file.path) {
        try {
            await fs.unlink(file.path);
        } catch (err) {
            console.error("Erro ao limpar arquivo temporário:", err);
        }
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

  console.log(`[Validator] Verificando Hash: ${hash}`);

  // 2. Busca no banco pelo Hash
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

  // 3. Regra Estrita: Só é válido se existir E estiver ASSINADO (SIGNED)
  if (!doc || doc.status !== 'SIGNED') {
    return { 
        valid: false, 
        hashCalculated: hash, 
        reason: !doc ? 'NOT_FOUND' : 'NOT_SIGNED'
    };
  }

  // 4. Sucesso: Documento Assinado e Íntegro
  return {
    valid: true,
    hashCalculated: hash,
    document: {
      title: doc.title,
      signedAt: doc.updatedAt,
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
      where: { id: docId, tenantId: user.tenantId }
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
    
    // Supondo que a pasta 'uploads' é servida estaticamente em /uploads
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
 * Altera o status de um documento (Cancelado, Expirado).
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
        tenantId: user.tenantId,
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
            { model: User, as: 'owner', attributes: ['name'] },
            { 
                model: Folder, 
                as: 'folder', 
                attributes: ['id', 'name'],
                required: false // Left Join
            }
        ]
    });
};

/**
 * Obtém estatísticas do Tenant atual.
 */
const getDocumentStats = async (user) => {
  const tenantId = user.tenantId;

  // 1. Contagens de Status em Paralelo
  const [pendingCount, signedCount, expiredCount, draftCount, totalCount] = await Promise.all([
    Document.count({ where: { tenantId, status: { [Op.in]: ['READY', 'PARTIALLY_SIGNED'] } } }),
    Document.count({ where: { tenantId, status: 'SIGNED' } }),
    Document.count({ where: { tenantId, status: 'EXPIRED' } }),
    Document.count({ where: { tenantId, status: 'DRAFT' } }),
    Document.count({ where: { tenantId, status: { [Op.ne]: 'CANCELLED' } } })
  ]);

  // 2. Cálculo de Armazenamento Utilizado (Soma do campo size)
  const storageSum = await Document.sum('size', { 
    where: { tenantId, status: { [Op.ne]: 'CANCELLED' } } 
  });
  
  // Converte bytes para Megabytes para o front
  const storageUsedMB = storageSum ? (storageSum / (1024 * 1024)).toFixed(2) : 0;

  // 3. Documentos Recentes (Últimos 5 modificados)
  const recentDocs = await Document.findAll({
      where: { tenantId },
      limit: 5,
      order: [['updatedAt', 'DESC']],
      attributes: ['id', 'title', 'status', 'updatedAt', 'mimeType'],
      include: [
          { 
            model: User, 
            as: 'owner', 
            attributes: ['name'] 
          }
      ]
  });

  return {
    counts: {
        pending: pendingCount,
        signed: signedCount,
        expired: expiredCount,
        draft: draftCount,
        total: totalCount
    },
    storage: {
        usedBytes: storageSum || 0,
        usedMB: parseFloat(storageUsedMB)
    },
    recents: recentDocs
  };
};

/**
 * Aplica a assinatura PAdES (Digital) ao documento.
 * Processo final que sela o documento com certificado A1 e gera logs finais.
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

        // 2. Lê o arquivo atual (pode já ter assinaturas visuais ou não)
        const filePath = path.join(__dirname, '..', '..', '..', document.storageKey);
        
        if (!fsSync.existsSync(filePath)) {
            throw new Error(`Arquivo físico não encontrado: ${filePath}`);
        }
        
        const fileBuffer = await fs.readFile(filePath);

        // 3. Prepara dados para carimbos visuais (posicionamento capturado no front)
        const signersData = document.Signers.map(s => ({
            name: s.name,
            signedAt: s.signedAt,
            artefactPath: s.signatureArtefactPath,
            positionX: s.signaturePositionX,
            positionY: s.signaturePositionY,
            positionPage: s.signaturePositionPage
        }));

        // 4. Aplica PAdES + Carimbos Visuais (Service PAdES)
        const signedPdfBuffer = await padesService.applyPadesSignatureWithStamps(fileBuffer, signersData);
        
        // 5. Salva novo arquivo (versão assinada)
        // Substitui a extensão por -pades.pdf para diferenciar
        const newStorageKey = document.storageKey.replace(/(\.[\w\d_-]+)$/i, '-pades$1');
        const newPath = path.join(__dirname, '..', '..', '..', newStorageKey);
        await fs.writeFile(newPath, signedPdfBuffer);

        // 6. Atualiza Hash e Caminho no Banco
        const newSha256 = crypto.createHash('sha256').update(signedPdfBuffer).digest('hex');
        document.storageKey = newStorageKey;
        document.sha256 = newSha256;
        
        // Garante que o status final é SIGNED
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

        // 8. Emite Certificado de Conclusão (Registro no Banco)
        const timestampISO = new Date().toISOString();
        const certificateSha256 = crypto.createHash('sha256').update(`CERT-${document.id}-${timestampISO}`).digest('hex');
        
        // Verifica se já existe para não duplicar
        const existingCert = await Certificate.findOne({ where: { documentId: document.id }, transaction });
        
        if (!existingCert) {
            await Certificate.create({
                documentId: document.id,
                storageKey: `certificates/${document.id}.pdf`, // Placeholder lógica futura de geração de PDF do certificado
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
        }

        // 9. Envia E-mails de Conclusão (Com Template Customizável)
        const tenantSettings = await TenantSettings.findOne({ 
            where: { tenantId: document.tenantId },
            transaction 
        });

        const owner = await User.findByPk(document.ownerId, { transaction });
        const { url: downloadUrl } = await getDocumentDownloadUrl(document.id, owner); 

        // Template Padrão (Fallback)
        let emailBodyTemplate = tenantSettings?.finalEmailTemplate;
        if (!emailBodyTemplate) {
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

        let compiledBase = emailBodyTemplate
            .replace(/{{doc_title}}/g, document.title)
            .replace(/{{doc_link}}/g, downloadUrl)
            .replace(/{{doc_id}}/g, document.id);

        // Envio Assíncrono (não bloqueia a transação)
        if (owner) {
            const ownerHtml = compiledBase.replace(/{{signer_name}}/g, owner.name);
            notificationService.sendEmail(document.tenantId, {
                to: owner.email,
                subject: `Documento Finalizado: ${document.title}`,
                html: ownerHtml
            }).catch(err => console.error("Erro ao notificar dono:", err.message));
        }
        
        document.Signers.forEach(s => {
             if (s.email) {
                const signerHtml = compiledBase.replace(/{{signer_name}}/g, s.name);
                notificationService.sendEmail(document.tenantId, {
                    to: s.email,
                    subject: `Cópia do Documento Assinado: ${document.title}`,
                    html: signerHtml
                }).catch(err => console.error(`Erro ao notificar signatário ${s.email}:`, err.message));
             }
        });

        await transaction.commit();
        return document;

    } catch (error) {
        await transaction.rollback();
        console.error("Erro ao aplicar PAdES:", error);
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