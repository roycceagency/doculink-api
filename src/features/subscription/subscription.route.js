// src/features/subscription/subscription.route.js
'use strict';

const { Router } = require('express');
const controller = require('./subscription.controller');
const authGuard = require('../../middlewares/authGuard');
const roleGuard = require('../../middlewares/roleGuard');

const router = Router();

// 1. Aplica o AuthGuard em todas as rotas deste arquivo
// Garante que o usuário está logado e temos o req.user
router.use(authGuard);

// 2. Rota para Criar Assinatura (Cartão ou PIX)
// Apenas ADMIN (dono do tenant) ou SUPER_ADMIN podem contratar planos
router.post('/', roleGuard(['ADMIN', 'SUPER_ADMIN']), controller.createSubscription);

// 3. Rota para Cancelar Assinatura
// Apenas ADMIN ou SUPER_ADMIN podem cancelar
router.delete('/', roleGuard(['ADMIN', 'SUPER_ADMIN']), controller.cancel);

module.exports = router;