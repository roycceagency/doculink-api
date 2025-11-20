const { Router } = require('express');
const tenantController = require('./tenant.controller');
const authGuard = require('../../middlewares/authGuard');
const adminGuard = require('../../middlewares/adminGuard'); // Admin do Tenant
const superAdminGuard = require('../../middlewares/superAdminGuard'); // Super Admin do Sistema

const router = Router();

// --- ROTAS GLOBAIS (Super Admin) ---
// Apenas o Super Admin pode ver todos os tenants do sistema ou criar tenants "raiz"
router.post('/', authGuard, superAdminGuard, tenantController.createTenant); 
router.get('/all', authGuard, superAdminGuard, tenantController.getAllTenants); 
router.get('/:id', authGuard, superAdminGuard, tenantController.getTenantById);

// --- ROTAS DE TENANT (Admin da Empresa) ---
router.use(authGuard);

// Gerenciar equipe (Invite) - Requer ser Admin daquele tenant
router.post('/invite', adminGuard, tenantController.inviteUser); 
router.get('/invites/sent', adminGuard, tenantController.getSentInvites);

// Funções básicas de usuário
router.get('/my', tenantController.getMyTenant);
router.get('/available', tenantController.getAvailableTenants);
router.get('/invites/pending', tenantController.getInvites); // Meus convites recebidos
router.post('/invites/:id/respond', tenantController.respondInvite);

module.exports = router;