// src/features/tenant/tenant.route.js

const { Router } = require('express');
const tenantController = require('./tenant.controller');
const authGuard = require('../../middlewares/authGuard');
const superAdminGuard = require('../../middlewares/superAdminGuard');

const router = Router();

// --- Rota para Usuários Autenticados ---
// Permite que um usuário logado veja os detalhes do seu próprio tenant.
router.get('/my', authGuard, tenantController.getMyTenant);


// --- Rotas Exclusivas do Super Admin ---

// Rota para criar um novo tenant e seu primeiro usuário administrador.
router.post('/', superAdminGuard, tenantController.createTenant);

// Rota para listar todos os tenants da plataforma.
router.get('/', superAdminGuard, tenantController.getAllTenants);

// Rota para obter detalhes de um tenant específico por ID.
router.get('/:id', superAdminGuard, tenantController.getTenantById);

// Rota para atualizar os dados de um tenant (nome, status).
router.patch('/:id', superAdminGuard, tenantController.updateTenant);

module.exports = router;