// src/features/document/document.route.js
'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const documentController = require('./document.controller');
const authGuard = require('../../middlewares/authGuard');
const roleGuard = require('../../middlewares/roleGuard');

const router = Router();

// 1. Configuração do Multer para Upload de Documentos (Salva em disco temporariamente)
const uploadTemp = multer({
  dest: path.join(__dirname, '..', '..', '..', 'temp_uploads/'),
  limits: { fileSize: 20 * 1024 * 1024 } // Limite de 20MB
});

// 2. Configuração do Multer para Validação (Mantém em memória para cálculo de Hash)
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// --- ROTAS PÚBLICAS / GERAIS (DEVEM VIR PRIMEIRO) ---

// Validador de Arquivo (Upload do PDF para checar integridade)
router.post('/validate-file', uploadMemory.single('file'), documentController.validateFile);


// --- INÍCIO DAS ROTAS PROTEGIDAS ---
router.use(authGuard);


// --- ROTAS DE LISTAGEM E ESTATÍSTICAS (DEVEM VIR ANTES DE ROTAS COM :id) ---

// Estatísticas do dashboard (CRÍTICO: Deve vir antes de /:id para não ser confundido com um UUID)
router.get('/stats', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.getStats);

// Listar todos os documentos do tenant
router.get('/', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.getAllDocuments);

// Criar novo documento (Upload)
router.post('/', roleGuard(['ADMIN', 'MANAGER']), uploadTemp.single('documentFile'), documentController.createDocument);


// --- ROTAS ESPECÍFICAS POR ID (:id) ---
// O Express lê de cima para baixo. Tudo que tiver :id deve ficar por último.

// Verificar Cadeia de Custódia (Hash Chain)
router.get('/:id/verify-chain', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.verifyChain);

// Obter trilha de auditoria
router.get('/:id/audit', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.getDocumentAuditTrail);

// Download do arquivo
router.get('/:id/download', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.downloadDocumentFile);

// Convidar signatários
router.post('/:id/invite', roleGuard(['ADMIN', 'MANAGER']), documentController.inviteSigners);

// Cancelar documento
router.post('/:id/cancel', roleGuard(['ADMIN', 'MANAGER']), documentController.cancelDocument);

// Marcar como expirado (manual)
router.post('/:id/expire', roleGuard(['ADMIN', 'MANAGER']), documentController.expireDocument);

// Aplicar assinatura digital PAdES
router.post('/:id/pades', roleGuard(['ADMIN', 'MANAGER']), documentController.applyPades);

// Atualizar metadados (título, prazo)
router.patch('/:id', roleGuard(['ADMIN', 'MANAGER']), documentController.updateDocument);

// Obter detalhes de um documento (GET /:id deve ser a última rota GET para não capturar outras rotas)
router.get('/:id', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.getDocumentById);

module.exports = router;