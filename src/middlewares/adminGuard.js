// src/middlewares/adminGuard.js
const { TenantMember } = require('../models');

const adminGuard = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Não autenticado.' });

  // 1. Se for Super Admin, passa direto (Poder supremo)
  if (req.user.role === 'SUPER_ADMIN') {
    return next();
  }

  // 2. Se for o Dono da conta (Tenant Pessoal)
  // O authService.js gera o token com 'role' baseada no contexto.
  // Vamos confiar na role que está decodificada no req.user (vinda do token JWT)
  // Se o token foi gerado corretamente no login/switch, req.user.role já reflete a permissão no tenant atual.
  
  // Nota: O authGuard precisa decodificar o 'role' do payload do JWT e anexar ao req.user
  // Se o seu authGuard atual só pega do banco, precisamos garantir que ele considere o contexto.
  
  // Vamos simplificar: O adminGuard verifica se no Token atual a role é ADMIN
  // (Lembrando que no auth.service.js nós geramos o token com a role do contexto)
  
  // No authGuard, você deve garantir que: req.user.role = decoded.role || user.role
  
  // Verificação baseada no token (assumindo que authGuard extraiu corretamente)
  if (req.user.role === 'ADMIN') {
      return next();
  }

  return res.status(403).json({ message: 'Acesso negado. Requer perfil de Administrador.' });
};

module.exports = adminGuard;