// src/features/auth/auth.route.js

const { Router } = require('express');
const authController = require('./auth.controller');
const authGuard = require('../../middlewares/authGuard'); // Precisamos do authGuard para o logout

const router = Router();

// Rota para iniciar o processo de login: o usuário envia o e-mail
router.post('/email/start', authController.startLogin);

// Rota para verificar o OTP e o e-mail para completar o login
router.post('/email/verify', authController.verifyLogin);

// --- NOVAS ROTAS ---

// Rota para obter um novo access token usando um refresh token
router.post('/refresh', authController.refreshToken);

// Rota para invalidar um refresh token (fazer logout)
router.post('/logout', authGuard, authController.logout);

module.exports = router;