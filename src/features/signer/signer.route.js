// src/features/signer/signer.route.js

const { Router } = require('express');
const signerController = require('./signer.controller');
const resolveSignerToken = require('../../middlewares/resolveSignerToken');

const router = Router();

// Aplica o middleware de resolução de token a todas as rotas com /:token
router.use('/:token', resolveSignerToken);

// GET /sign/:token -> resumo (título, data, prazo, status, baixar não assinado)
router.get('/:token', signerController.getSummary);

// POST /sign/:token/identify -> valida/atualiza CPF (e congela e-mail/WhatsApp)
router.post('/:token/identify', signerController.identifySigner);

// POST /sign/:token/otp/start -> envia OTP (e-mail + WhatsApp)
router.post('/:token/otp/start', signerController.startOtp);

// POST /sign/:token/otp/verify -> confirma identidade
router.post('/:token/otp/verify', signerController.verifyOtp);

// POST /sign/:token/draw -> salva arte da assinatura (canvas/texto) - *Simplificado*
// Em um app real, este endpoint receberia a imagem/vetor da assinatura.
// Aqui, vamos tratá-lo como um passo de confirmação antes do commit final.
router.post('/:token/draw', signerController.confirmSignatureArt);


// POST /sign/:token/commit -> realiza a assinatura (gera signatureHash, atualiza Signer)
router.post('/:token/commit', signerController.commitSignature);

module.exports = router;