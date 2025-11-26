
// src/features/settings/settings.route.js
const { Router } = require('express');
const controller = require('./settings.controller');
const authGuard = require('../../middlewares/authGuard');
const roleGuard = require('../../middlewares/roleGuard');

const router = Router();
router.use(authGuard);

router.get('/', controller.get);
router.patch('/', roleGuard(['ADMIN', 'SUPER_ADMIN']), controller.update);

// --- NOVA ROTA DE TEMPLATE ---
router.put('/email-template', roleGuard(['ADMIN', 'SUPER_ADMIN']), controller.updateEmailTemplate);

module.exports = router;