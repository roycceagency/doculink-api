// app.js
'use strict';

// 1. Carrega as variáveis de ambiente do arquivo .env. Deve ser a primeira linha.
require('dotenv').config();

// 2. Importação dos módulos
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const routes = require('./src/routes');
const db = require('./src/models');
const { startReminderJob } = require('./src/services/cron.service');
const { seedDefaultAdmin } = require('./src/services/seed.service'); // <-- IMPORTADO AQUI

// 3. Inicialização do Express
const app = express();
const PORT = process.env.PORT || 3333;

// 4. Configuração dos Middlewares
app.use(helmet());
app.use(cors({ origin: '*' })); // Para produção, restrinja a origem: `origin: process.env.FRONT_URL`
app.use(express.json());

// 5. Servir Arquivos Estáticos
// Permite que o frontend acesse diretamente os arquivos na pasta 'uploads' (documentos, assinaturas, etc.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 6. Rotas da API
app.use('/api', routes);

// 7. Middleware de Tratamento de Erros
app.use((err, req, res, next) => {
  console.error('--- ERRO NÃO TRATADO ---');
  console.error(err.stack);
  console.error('--------------------------');
  
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    message: err.message || 'Ocorreu um erro interno no servidor.',
  });
});

// 8. Sincronização e Inicialização do Servidor
const startServer = async () => {
  try {
    console.log('Conectando ao banco de dados...');
    await db.sequelize.authenticate();
    console.log('✅ Conexão com o banco de dados estabelecida.');

    console.log('Sincronizando modelos...');
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    // ATENÇÃO: { force: true } APAGA TODAS AS TABELAS E RECRIA
    await db.sequelize.sync({ force: true });

    if (isDevelopment) {
      console.warn('----------------------------------------------------');
      console.warn('AVISO: DB sincronizado com "force: true" (tabelas recriadas).');
      console.warn('----------------------------------------------------');
    } else {
      console.log('✅ Modelos sincronizados.');
    }

    // --- CRIA O ADMIN PADRÃO (SEED) ---
    // A função verifica internamente se o admin já existe antes de criar.
    await seedDefaultAdmin();
    // ------------------------------------

    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      
      // Inicia os jobs agendados após o servidor estar no ar
      startReminderJob();
    });

  } catch (error) {
    console.error('❌ Falha ao iniciar o servidor:', error);
    process.exit(1);
  }
};

startServer();
