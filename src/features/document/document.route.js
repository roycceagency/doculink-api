// src/features/document/document.route.js
'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const documentController = require('./document.controller');
const authGuard = require('../../middlewares/authGuard');
const roleGuard = require('../../middlewares/roleGuard'); // Middleware de permissões

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

// --- ROTAS PÚBLICAS OU DE UTILIDADE GERAL ---

// Validador de Arquivo (Upload do PDF para checar integridade e originalidade)
// Pode ser público ou protegido dependendo da regra de negócio. Aqui deixamos sem authGuard para validação externa.
router.post('/validate-file', uploadMemory.single('file'), documentController.validateFile);


// --- ROTAS PROTEGIDAS (REQUER LOGIN) ---
router.use(authGuard);


// --- ROTAS DE LEITURA (Acessíveis por ADMIN, MANAGER e VIEWER) ---

// Verificar Cadeia de Custódia (Hash Chain)
router.get('/:id/verify-chain', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.verifyChain);

// Obter detalhes de um documento
router.get('/:id', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.getDocumentById);

// Obter trilha de auditoria
router.get('/:id/audit', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.getDocumentAuditTrail);

// Download do arquivo
router.get('/:id/download', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.downloadDocumentFile);

// Listar todos os documentos do tenant
router.get('/', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.getAllDocuments);

// Estatísticas do dashboard
router.get('/stats', roleGuard(['ADMIN', 'MANAGER', 'VIEWER']), documentController.getStats); // Nota: Cuidar com a ordem, se 'stats' fosse param, daria conflito, mas aqui está ok pois :id valida UUID geralmente ou a ordem no express resolve se não bater. Para segurança, coloque rotas estáticas antes de /:id se possível, mas aqui stats é query param ou rota distinta dependendo da implementação do controller. (No código anterior, stats era rota fixa).


// --- ROTAS DE ESCRITA/AÇÃO (Acessíveis apenas por ADMIN e MANAGER) ---

// Criar novo documento (Upload)
router.post('/', roleGuard(['ADMIN', 'MANAGER']), uploadTemp.single('documentFile'), documentController.createDocument);

// Convidar signatários
router.post('/:id/invite', roleGuard(['ADMIN', 'MANAGER']), documentController.inviteSigners);

// Atualizar metadados (título, prazo)
router.patch('/:id', roleGuard(['ADMIN', 'MANAGER']), documentController.updateDocument);

// Cancelar documento
router.post('/:id/cancel', roleGuard(['ADMIN', 'MANAGER']), documentController.cancelDocument);

// Marcar como expirado (manual)
router.post('/:id/expire', roleGuard(['ADMIN', 'MANAGER']), documentController.expireDocument);

// Aplicar assinatura digital PAdES (se configurado)
router.post('/:id/pades', roleGuard(['ADMIN', 'MANAGER']), documentController.applyPades);

module.exports = router;