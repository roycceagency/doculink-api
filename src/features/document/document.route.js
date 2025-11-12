// src/features/document/document.route.js

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const documentController = require('./document.controller');
const authGuard = require('../../middlewares/authGuard');

const router = Router();

// Configuração do Multer para salvar os arquivos temporariamente antes do processamento.
// Isso nos permite validar e mover o arquivo para um local permanente depois.
const upload = multer({
  dest: path.join(__dirname, '..', '..', '..', 'temp_uploads/'), // Pasta temporária
  limits: { fileSize: 10 * 1024 * 1024 } // Limite de 10MB por arquivo
});

// Todas as rotas de documento exigem que o usuário esteja autenticado.
router.use(authGuard);

// Rota para criar um novo documento (faz o upload do arquivo junto).
router.post('/', upload.single('documentFile'), documentController.createDocument);

// Rota para convidar signatários para um documento.
router.post('/:id/invite', documentController.inviteSigners);

// Rota para obter detalhes de um documento específico.
router.get('/:id', documentController.getDocumentById);

// Rota para listar a trilha de auditoria (hash-chain) de um documento.
router.get('/:id/audit', documentController.getDocumentAuditTrail);

// Rota para fazer o download do arquivo de um documento.
router.get('/:id/download', documentController.downloadDocumentFile);

// Rota para atualizar informações de um documento (título, prazo).
router.patch('/:id', documentController.updateDocument);

// Rotas para alterar o status do documento.
router.post('/:id/cancel', documentController.cancelDocument);
router.post('/:id/expire', documentController.expireDocument);


router.post('/:id/pades', authGuard, documentController.applyPades);


module.exports = router;