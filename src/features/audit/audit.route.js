const { Router } = require('express');
const auditController = require('./audit.controller');
const authGuard = require('../../middlewares/authGuard');
const superAdminGuard = require('../../middlewares/superAdminGuard');

const router = Router();
router.use(authGuard);

// Se a rota /audit for para ver logs GLOBAIS do sistema, use superAdminGuard
// Se for para ver logs DO TENANT, use adminGuard.
// Vamos assumir que o Admin vê logs da empresa dele.

router.get('/', auditController.getLogs); // O service já filtra por tenantId

module.exports = router;