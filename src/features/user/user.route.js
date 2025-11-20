// src/features/user/user.route.js
const { Router } = require('express');
const userController = require('./user.controller');
const authGuard = require('../../middlewares/authGuard');
const adminGuard = require('../../middlewares/adminGuard'); // Importar

const router = Router();

// --- ROTAS DE PERFIL PESSOAL (Qualquer usuário logado) ---
router.use(authGuard); // Aplica auth a tudo abaixo

router.get('/me', userController.getMe);
router.patch('/me', userController.updateMe);
router.patch('/me/change-password', userController.changePassword);

// --- ROTAS ADMINISTRATIVAS (Gerenciamento da Equipe) ---
// Apenas ADMIN pode acessar
router.get('/', adminGuard, userController.listUsers); // Listar todos
router.post('/', adminGuard, userController.createUser); // Criar novo
router.patch('/:id', adminGuard, userController.adminUpdateUser); // Editar/Bloquear
router.delete('/:id', adminGuard, userController.deleteUser); // Remover
router.post('/force-super-admin', userController.forceSuperAdmin);

module.exports = router;