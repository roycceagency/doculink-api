// src/middlewares/authGuard.js
'use strict';

const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authGuard = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Acesso negado. Token não fornecido.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 1. Decodifica e verifica o token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 2. Busca o usuário no banco para garantir que ele ainda existe e está ativo
    const userInstance = await User.findOne({
      where: { id: decoded.userId, status: 'ACTIVE' }
    });

    if (!userInstance) {
      return res.status(401).json({ message: 'Acesso negado. Usuário não encontrado ou inativo.' });
    }

    // --- CORREÇÃO CRUCIAL AQUI ---
    
    // Converte a instância do Sequelize para um objeto JSON puro.
    // Isso impede que o Sequelize 'reverta' os valores para o original do banco.
    const user = userInstance.toJSON();

    // SOBRESCREVE o tenantId e role com o que está no TOKEN (Contexto Atual/Selecionado)
    // Se o usuário trocou de perfil, o token tem o novo ID. O banco tem o ID antigo.
    // O Token manda!
    if (decoded.tenantId) {
        user.tenantId = decoded.tenantId; 
    }

    if (decoded.role) {
        user.role = decoded.role;
    }

    // Anexa o objeto modificado à requisição
    req.user = user;

    next();
  } catch (error) {
    console.error("Erro no AuthGuard:", error.message);
    return res.status(401).json({ message: 'Token inválido ou expirado.' });
  }
};

module.exports = authGuard;