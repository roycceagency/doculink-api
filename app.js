// app.js

// 1. Carrega as variáveis de ambiente do arquivo .env. ESSENCIAL que seja a primeira linha.
require('dotenv').config();

// 2. Importação dos módulos necessários
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./src/routes');
const db = require('./src/models'); // Importa a configuração do Sequelize (incluindo a conexão)

// 3. Inicialização da aplicação Express
const app = express();
const PORT = process.env.PORT || 3333;

// 4. Configuração dos Middlewares de Segurança e Parse
// Helmet adiciona vários cabeçalhos HTTP para proteger contra vulnerabilidades comuns
app.use(helmet());

// CORS permite que seu frontend (em outro domínio) acesse a API
// Em produção, configure 'origin' para o domínio específico do seu frontend.
app.use(cors({ origin: '*' })); // Para desenvolvimento, '*' é aceitável.

// Middleware para parsear o corpo de requisições JSON
app.use(express.json());

// 5. Configuração das Rotas da API
// Todas as rotas definidas em 'src/routes/index.js' serão prefixadas com '/api'
app.use('/api', routes);


// 6. Middleware para Tratamento de Erros (Error Handling)
// Este é um handler de erros genérico que captura exceções não tratadas nas rotas.
// Ele deve ser o último 'app.use' a ser adicionado.
app.use((err, req, res, next) => {
  console.error('---------------------------------');
  console.error('Um erro não tratado ocorreu:');
  console.error(err.stack);
  console.error('---------------------------------');

  // Retorna uma resposta de erro genérica para o cliente
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
    console.log('Sincronizando modelos com o banco de dados...');
    
    // Verifica se estamos em ambiente de desenvolvimento para usar o 'force: true'
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    // A opção { alter: true } é uma alternativa menos destrutiva para desenvolvimento.
    // Ela tenta alterar as tabelas existentes para corresponder ao modelo.
    // Use { force: true } se quiser recriar tudo do zero.
    await db.sequelize.sync({ force: isDevelopment }); 
    
    if (isDevelopment) {
      console.warn('------------------------------------------------------------------');
      console.warn('AVISO: Servidor rodando em modo de desenvolvimento.');
      console.warn('Banco de dados foi sincronizado com "force: true" (tabelas recriadas).');
      console.warn('------------------------------------------------------------------');
    } else {
      console.log('Modelos sincronizados.');
    }

    // Inicia o servidor Express para ouvir as requisições
    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`🔗 Acessível em: http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('❌ Falha ao iniciar o servidor:', error);
    process.exit(1); // Encerra o processo se não conseguir conectar ao DB
  }
};

// Inicia o processo
startServer();