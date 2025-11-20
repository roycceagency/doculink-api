// src/features/tenant/tenant.route.js
'use strict';

const { Router } = require('express');
const tenantController = require('./tenant.controller');
const authGuard = require('../../middlewares/authGuard');
const roleGuard = require('../../middlewares/roleGuard'); // Novo Middleware de RBAC
const superAdminGuard = require('../../middlewares/superAdminGuard'); // Super Admin do Sistema

const router = Router();

// 1. Proteção Básica: Todo acesso a tenants exige login
router.use(authGuard);


// --- ROTAS ESPECÍFICAS DE USUÁRIO COMUM (DEVEM VIR PRIMEIRO) ---

// Listar tenants disponíveis para troca de contexto (Switch)
router.get('/available', tenantController.getAvailableTenants);

// Obter dados do tenant atual (baseado no token)
router.get('/my', tenantController.getMyTenant);

// Listar convites recebidos pendentes
router.get('/invites/pending', tenantController.getInvites);

// Aceitar ou recusar um convite recebido
router.post('/invites/:id/respond', tenantController.respondInvite);


// --- ROTAS DE ADMINISTRAÇÃO DO TENANT (Apenas ADMIN da empresa) ---

// Convidar novo membro para a equipe
router.post('/invite', roleGuard(['ADMIN']), tenantController.inviteUser);

// Listar convites enviados que ainda não foram aceitos
router.get('/invites/sent', roleGuard(['ADMIN']), tenantController.getSentInvites);


// --- ROTAS DO SUPER ADMIN (PLATAFORMA GLOBAL) ---

// Listar todas as empresas cadastradas no sistema
router.get('/all', superAdminGuard, tenantController.getAllTenants);

// Criar uma nova empresa "Raiz" (Tenant)
router.post('/', superAdminGuard, tenantController.createTenant);


// --- ROTAS DINÂMICAS (DEVEM VIR POR ÚLTIMO) ---
// Atenção: O Express avalia rotas sequencialmente. Rotas com :id capturam qualquer string.

// Buscar Tenant específico por ID (Super Admin)
router.get('/:id', superAdminGuard, tenantController.getTenantById);

// Atualizar dados do Tenant (Super Admin)
router.patch('/:id', superAdminGuard, tenantController.updateTenant);

module.exports = router;