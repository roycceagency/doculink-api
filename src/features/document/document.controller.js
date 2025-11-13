// src/features/document/document.controller.js

const documentService = require('./document.service');

const createDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
    }
    const { title, deadlineAt } = req.body;
    const document = await documentService.createDocumentAndHandleUpload({
      file: req.file,
      title,
      deadlineAt,
      user: req.user
    });
    return res.status(201).json(document);
  } catch (error) {
    next(error);
  }
};

const getDocumentById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const document = await documentService.findDocumentById(id, req.user);
    return res.status(200).json(document);
  } catch (error) {
    next(error);
  }
};

const updateDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body; // ex: { title, deadlineAt }
    const updatedDocument = await documentService.updateDocumentDetails(id, updates, req.user);
    return res.status(200).json(updatedDocument);
  } catch (error) {
    next(error);
  }
};

const downloadDocumentFile = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // --- MUDANÇA AQUI ---
        // Agora chamamos a função que retorna o objeto { url: '...' }
        const downloadData = await documentService.getDocumentDownloadUrl(id, req.user);
        
        // Retornamos o JSON para o frontend. O frontend que fará o fetch da URL.
        return res.status(200).json(downloadData);
        // -------------------

    } catch (error) {
        next(error);
    }
};

const inviteSigners = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { signers } = req.body; // Espera um array de objetos de signatários
    if (!Array.isArray(signers) || signers.length === 0) {
      return res.status(400).json({ message: 'A lista de signatários é obrigatória.' });
    }
    await documentService.addSignersToDocument(id, signers, req.user);
    return res.status(200).json({ message: 'Convites enviados com sucesso.' });
  } catch (error) {
    next(error);
  }
};

const getDocumentAuditTrail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const auditTrail = await documentService.findAuditTrail(id, req.user);
    return res.status(200).json(auditTrail);
  } catch (error) {
    next(error);
  }
};

const cancelDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    await documentService.changeDocumentStatus(id, 'CANCELLED', req.user);
    return res.status(200).json({ message: 'Documento cancelado com sucesso.' });
  } catch (error) {
    next(error);
  }
};

const expireDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    await documentService.changeDocumentStatus(id, 'EXPIRED', req.user);
    return res.status(200).json({ message: 'Documento expirado com sucesso.' });
  } catch (error) {
    next(error);
  }
};

const applyPades = async (req, res, next) => {
  try {
    const { id } = req.params;
    const document = await documentService.finalizeWithPades(id, req.user);
    res.status(200).json({ 
        message: 'Assinatura digital PAdES aplicada com sucesso.',
        document 
    });
  } catch (error) {
    next(error);
  }
};

const getAllDocuments = async (req, res, next) => {
  try {
    const { status } = req.query; // Pega o status da URL, ex: ?status=SIGNED
    const documents = await documentService.findAllDocuments(req.user, status);
    return res.status(200).json(documents);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDocument,
  getDocumentById,
  updateDocument,
  downloadDocumentFile,
  inviteSigners,
  getDocumentAuditTrail,
  cancelDocument,
  expireDocument,
  applyPades,
  getAllDocuments
};