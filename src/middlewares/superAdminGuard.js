// src/middlewares/superAdminGuard.js

const superAdminGuard = (req, res, next) => {
  // O authGuard já rodou e populou req.user
  if (!req.user) {
    return res.status(401).json({ message: 'Usuário não autenticado.' });
  }

  // Verifica estritamente se é SUPER_ADMIN
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ message: 'Acesso negado. Requer privilégios de Super Administrador.' });
  }

  next();
};

module.exports = superAdminGuard;