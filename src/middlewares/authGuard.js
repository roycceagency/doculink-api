// src/middlewares/authGuard.js
const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authGuard = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token não fornecido.' });
  }
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findOne({ where: { id: decoded.userId, status: 'ACTIVE' } });
    if (!user) return res.status(401).json({ message: 'Usuário inválido.' });

    // --- MUDANÇA CRÍTICA AQUI ---
    // Anexamos os dados do usuário
    req.user = user;
    
    // Mas SOBRESCREVEMOS o tenantId e o role com o que está no TOKEN (Contexto Atual)
    // Isso permite navegar em outros tenants como convidado ou admin
    if (decoded.tenantId) req.user.tenantId = decoded.tenantId;
    if (decoded.role) req.user.role = decoded.role; 
    // -----------------------------

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido.' });
  }
};

module.exports = authGuard;