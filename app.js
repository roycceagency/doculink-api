  // app.js

  // 1. Carrega as variáveis de ambiente do arquivo .env. ESSENCIAL que seja a primeira linha.
  require('dotenv').config();

  // 2. Importação dos módulos necessários
  const express = require('express');
  const cors = require('cors');
  const helmet = require('helmet');
  const routes = require('./src/routes');
  const db = require('./src/models'); // Importa a configuração do Sequelize (incluindo a conexão)
const path = require('path');

  // 3. Inicialização da aplicação Express
  const app = express();
  const PORT = process.env.PORT || 3333;

  // 4. Configuração dos Middlewares de Segurança e Parse
  app.use(helmet());
  app.use(cors({ origin: '*' }));
  app.use(express.json());

  // 5. Configuração das Rotas da API
  app.use('/api', routes);

  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


  // 6. Middleware para Tratamento de Erros
  app.use((err, req, res, next) => {
    console.error('---------------------------------');
    console.error('Um erro não tratado ocorreu:');
    console.error(err.stack);
    console.error('---------------------------------');
    res.status(500).json({
      message: err.message || 'Ocorreu um erro interno no servidor.',
    });
  });

  // 7. Sincronização com o Banco de Dados e Inicialização do Servidor
  const startServer = async () => {
    try {
      console.log('Conectando ao banco de dados...');
      await db.sequelize.authenticate();
      console.log('Conexão com o banco de dados estabelecida com sucesso.');

      // --- SINCRONIZAÇÃO DOS MODELOS ---
      console.log('Sincronizando modelos com o banco de dados (FORCE TRUE)...');
      await db.sequelize.sync({ force: false }); // <-- força recriação total das tabelas

      console.warn('------------------------------------------------------------------');
      console.warn('⚠️  Atenção: Banco de dados foi recriado com "force: true".');
      console.warn('⚠️  Todas as tabelas e dados existentes foram apagados e recriados.');
      console.warn('------------------------------------------------------------------');

      // Inicia o servidor Express
      app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`🔗 Acessível em: http://localhost:${PORT}`);
      });

    } catch (error) {
      console.error('❌ Falha ao iniciar o servidor:', error);
      process.exit(1);
    }
  };

  // Inicia o processo
  startServer();
