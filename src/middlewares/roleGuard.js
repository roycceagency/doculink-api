// src/middlewares/roleGuard.js

/**
 * Verifica se o usuário tem uma das roles permitidas no contexto atual.
 * @param {Array<string>} allowedRoles - Ex: ['ADMIN', 'MANAGER']
 */
const roleGuard = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Usuário não autenticado.' });
    }

    // Super Admin tem acesso a tudo sempre
    if (req.user.role === 'SUPER_ADMIN') {
      return next();
    }

    // Verifica se a role do usuário (no tenant atual) está na lista permitida
    if (allowedRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({ 
      message: 'Acesso negado. Você não tem permissão para realizar esta ação.' 
    });
  };
};

module.exports = roleGuard;