// src/middlewares/superAdminGuard.js

const superAdminGuard = (req, res, next) => {
  const adminApiKey = req.headers['x-admin-api-key'];

  if (!adminApiKey) {
    return res.status(401).json({ message: 'Chave de API de administrador não fornecida.' });
  }

  if (adminApiKey !== process.env.SUPER_ADMIN_API_KEY) {
    return res.status(403).json({ message: 'Acesso proibido. Chave de API inválida.' });
  }

  next();
};

module.exports = superAdminGuard;