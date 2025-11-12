// app.js
require('dotenv').config(); // Carrega as variáveis do .env - DEVE SER A PRIMEIRA LINHA

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/api', routes); // Prefixa todas as rotas com /api

// Handler de erros básico (opcional mas recomendado)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: err.message || 'Ocorreu um erro interno.' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});