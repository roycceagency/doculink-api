// src/features/signatory/signatory.route.js
'use strict';

const { Router } = require('express');
const signatoryController = require('./signatory.controller');
const authGuard = require('../../middlewares/authGuard'); // Middleware para proteger as rotas

// Cria uma nova instância do roteador do Express
const router = Router();

// -----------------------------------------------------------------------------
// APLICA O MIDDLEWARE DE AUTENTICAÇÃO
// -----------------------------------------------------------------------------
// router.use() aplica o middleware a TODAS as rotas definidas neste arquivo.
// Isso garante que nenhum usuário não autenticado possa listar ou criar signatários.
// O authGuard irá verificar o token JWT e anexar o objeto 'user' à requisição (req.user).
router.use(authGuard);


// -----------------------------------------------------------------------------
// DEFINIÇÃO DAS ROTAS
// -----------------------------------------------------------------------------

/**
 * @route   GET /api/signatories
 * @desc    Lista todos os contatos de signatários únicos associados ao usuário logado.
 * @access  Private
 */
router.get('/', signatoryController.list);


/**
 * @route   POST /api/signatories
 * @desc    Cria um novo contato de signatário na lista do usuário logado.
 * @access  Private
 */
router.post('/', signatoryController.create);


// Exporta o roteador configurado para ser usado no arquivo principal de rotas (src/routes/index.js)
module.exports = router;