// src/routes/index.js

const { Router } = require('express');

// 1. Importa os roteadores de cada feature da aplicação.
const authRoutes = require('../features/auth/auth.route');
const documentRoutes = require('../features/document/document.route');
const tenantRoutes = require('../features/tenant/tenant.route');
const signerRoutes = require('../features/signer/signer.route');
const userRoutes = require('../features/user/user.route');

// 2. Cria uma instância do roteador principal.
const router = Router();

// 3. Define os prefixos para cada conjunto de rotas.
// Todas as requisições que começarem com '/api/auth' serão direcionadas para 'authRoutes'.
router.use('/auth', authRoutes);

// Requisições para '/api/documents'
router.use('/documents', documentRoutes);

// Requisições para '/api/tenants'
router.use('/tenants', tenantRoutes);

// Requisições para '/api/sign' (para o fluxo de assinatura externo)
router.use('/sign', signerRoutes);

// Requisições para '/api/users' (para dados do usuário logado, como /users/me)
router.use('/users', userRoutes);


// Opcional: Uma rota "health check" para verificar se a API está no ar.
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// 4. Exporta o roteador principal para ser usado no app.js.
module.exports = router;