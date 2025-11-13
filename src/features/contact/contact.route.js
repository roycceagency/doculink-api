// src/features/contact/contact.route.js
'use strict';

const { Router } = require('express');
const contactController = require('./contact.controller');
const authGuard = require('../../middlewares/authGuard'); // Middleware para proteger as rotas

// Cria uma nova instância do roteador do Express
const router = Router();

// -----------------------------------------------------------------------------
// APLICA O MIDDLEWARE DE AUTENTICAÇÃO
// -----------------------------------------------------------------------------
// router.use() aplica o middleware a TODAS as rotas definidas neste arquivo.
// Isso garante que apenas um usuário autenticado possa acessar sua lista de contatos.
router.use(authGuard);


// -----------------------------------------------------------------------------
// DEFINIÇÃO DAS ROTAS
// -----------------------------------------------------------------------------

/**
 * @route   GET /api/contacts
 * @desc    Lista todos os contatos pertencentes ao usuário logado.
 * @access  Private (protegido pelo authGuard)
 */
router.get('/', contactController.list);


/**
 * @route   POST /api/contacts
 * @desc    Cria um novo contato na lista do usuário logado ou atualiza um existente.
 * @access  Private (protegido pelo authGuard)
 */
router.post('/', contactController.create);

// --- NOVAS ROTAS ---
router.patch('/:id', contactController.update); // Rota para atualizar (editar, favoritar, inativar)
router.delete('/:id', contactController.delete);   // Rota para deletar
// -----------------


// Exporta o roteador configurado para ser usado no arquivo principal de rotas (src/routes/index.js)
module.exports = router;