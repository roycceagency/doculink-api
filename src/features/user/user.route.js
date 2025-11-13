const { Router } = require('express');
const userController = require('./user.controller');
const authGuard = require('../../middlewares/authGuard');

const router = Router();

// Todas as rotas aqui são para o usuário autenticado
router.use(authGuard);

router.get('/me', userController.getMe);
router.patch('/me', userController.updateMe);

// --- NOVA ROTA ---
router.patch('/me/change-password', userController.changePassword);
// 


module.exports = router;