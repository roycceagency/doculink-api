// src/middlewares/resolveSignerToken.js

const crypto = require('crypto');
const { ShareToken, Document, Signer } = require('../models');

const resolveSignerToken = async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ message: 'Token de assinatura não fornecido.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const shareToken = await ShareToken.findOne({
      where: { tokenHash },
      include: [
        { model: Document, as: 'Document' },
        { model: Signer, as: 'Signer' }
      ]
    });

    if (!shareToken || !shareToken.Document || !shareToken.Signer) {
      return res.status(404).json({ message: 'Link de assinatura inválido ou não encontrado.' });
    }
    
    if (new Date() > new Date(shareToken.expiresAt)) {
        return res.status(403).json({ message: 'Link de assinatura expirado.' });
    }

    const doc = shareToken.Document;
    const signer = shareToken.Signer;

    // Validações de status
    if (signer.status === 'SIGNED' || signer.status === 'DECLINED') {
        return res.status(403).json({ message: `Acesso negado. A assinatura já foi concluída com o status: ${signer.status}.` });
    }
    if (doc.status === 'CANCELLED' || doc.status === 'EXPIRED' || doc.status === 'SIGNED') {
        return res.status(403).json({ message: `Acesso negado. O documento não está mais disponível para assinatura (status: ${doc.status}).` });
    }

    // Anexa os dados à requisição para uso posterior
    req.document = doc;
    req.signer = signer;
    req.shareToken = shareToken;

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = resolveSignerToken;