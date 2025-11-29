// src/features/auth/auth.route.js
const { Router } = require('express');
const authController = require('./auth.controller');
const authGuard = require('../../middlewares/authGuard');

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authGuard, authController.logout);

// Rota para trocar de perfil (contexto)
router.post('/switch-tenant', authGuard, authController.switchTenant);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
module.exports = router;