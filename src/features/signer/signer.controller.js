// src/features/signer/signer.controller.js

const signerService = require('./signer.service');
const documentService = require('../document/document.service'); // <-- IMPORTAR O document.service
const { User } = require('../../models'); // <-- IMPORTAR O User

const getSummary = async (req, res, next) => {
  try {
    // A requisição já tem `req.document` e `req.signer` do middleware.
    const summary = await signerService.getSignerSummary(req.document, req.signer, req);
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
};

const identifySigner = async (req, res, next) => {
  try {
    const { cpf } = req.body;
    if (!cpf) return res.status(400).json({ message: 'CPF é obrigatório.' });
    
    await signerService.identifySigner(req.signer, cpf, req);
    res.status(200).json({ message: 'Identificação confirmada com sucesso.' });
  } catch (error) {
    next(error);
  }
};

const startOtp = async (req, res, next) => {
  try {
    await signerService.startOtpVerification(req.signer, req);
    res.status(200).json({ message: 'Código OTP enviado para os canais de autenticação.' });
  } catch (error) {
    next(error);
  }
};

const verifyOtp = async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ message: 'Código OTP é obrigatório.' });
    
    await signerService.verifyOtp(req.signer, otp, req);
    res.status(200).json({ message: 'Identidade verificada com sucesso.' });
  } catch (error) {
    next(error);
  }
};

const confirmSignatureArt = async (req, res, next) => {
    try {
      const { signatureArt } = req.body; // ex: base64 da imagem
      // Em uma implementação real, você validaria e talvez armazenaria isso temporariamente.
      if (!signatureArt) {
        return res.status(400).json({ message: 'Arte da assinatura é obrigatória.' });
      }
      res.status(200).json({ message: 'Arte da assinatura recebida, pronta para finalizar.' });
    } catch (error) {
      next(error);
    }
  };

const commitSignature = async (req, res, next) => {
  try {
    const { clientFingerprint, signatureImage } = req.body; // Recebe a imagem
    if (!clientFingerprint || !signatureImage) {
      return res.status(400).json({ message: 'Client fingerprint e imagem da assinatura são obrigatórios.' });
    }

    await signerService.commitSignature(req.document, req.signer, clientFingerprint, signatureImage, req);
    res.status(200).json({ message: 'Documento assinado com sucesso!' });
  } catch (error) {
    next(error);
  }
};

const savePosition = async (req, res, next) => {
  try {
    const { position } = req.body;
    if (!position || position.x == null || position.y == null || position.page == null) {
      return res.status(400).json({ message: 'Dados de posição (x, y, page) são obrigatórios.' });
    }
    await signerService.saveSignaturePosition(req.signer, position);
    res.status(200).json({ message: 'Posição da assinatura salva com sucesso.' });
  } catch (error) {
    next(error);
  }
};

const getDocumentUrl = async (req, res, next) => {
  try {
    // req.document é fornecido pelo middleware resolveSignerToken.
    // Para chamar o serviço de documento, precisamos do "dono" do documento.
    const owner = await User.findByPk(req.document.ownerId);
    if (!owner) {
        throw new Error("Proprietário do documento não encontrado.");
    }

    // Chama o serviço de documento para gerar a URL.
    const urlData = await documentService.getDocumentDownloadUrl(req.document.id, owner);

    res.status(200).json(urlData);
  } catch (error) {
    next(error);
  }
};




module.exports = {
  getSummary,
  identifySigner,
  startOtp,
  verifyOtp,
  confirmSignatureArt,
  commitSignature,
  savePosition,
   getDocumentUrl
};