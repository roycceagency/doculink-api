// src/features/user/user.service.js
'use strict';

const { User, Tenant, Plan, TenantMember } = require('../../models');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');

/**
 * Atualiza o próprio perfil do usuário (Nome, Telefone).
 */
const updateUser = async (userId, updateData) => {
  const user = await User.findByPk(userId);
  if (!user) {
    const error = new Error('Usuário não encontrado.');
    error.statusCode = 404;
    throw error;
  }

  const allowedUpdates = ['name', 'phoneWhatsE164'];
  const validUpdates = {};

  for (const key of allowedUpdates) {
    if (updateData[key] !== undefined) {
      validUpdates[key] = updateData[key];
    }
  }

  await user.update(validUpdates);
  return user;
};

/**
 * Altera a senha do próprio usuário.
 */
const changeUserPassword = async (user, currentPassword, newPassword) => {
  const userWithPassword = await User.scope('withPassword').findByPk(user.id);
  if (!userWithPassword) throw new Error('Usuário não encontrado.');
  if (!userWithPassword.passwordHash) throw new Error('Conta configurada incorretamente, sem hash de senha.');

  const isMatch = await bcrypt.compare(currentPassword, userWithPassword.passwordHash);
  if (!isMatch) {
    const error = new Error('A senha atual está incorreta.');
    error.statusCode = 403;
    throw error;
  }
  
  if (!newPassword || newPassword.length < 6) {
    const error = new Error('A nova senha deve ter no mínimo 6 caracteres.');
    error.statusCode = 400;
    throw error;
  }
  
  userWithPassword.passwordHash = await bcrypt.hash(newPassword, 10);
  await userWithPassword.save();
};

/**
 * Lista usuários de um Tenant específico (Para ADMIN comum).
 */
const listUsersByTenant = async (tenantId) => {
  return User.findAll({ 
      where: { tenantId },
      order: [['name', 'ASC']] 
  });
};

/**
 * Lista TODOS os usuários do sistema (Para SUPER_ADMIN).
 */
const listAllUsersSystem = async () => {
  return User.findAll({
    order: [['createdAt', 'DESC']],
    include: [
      { 
        model: Tenant, 
        as: 'ownTenant', 
        attributes: ['name', 'slug'] 
      }
    ]
  });
};

/**
 * Cria um novo usuário (Gestão Administrativa).
 * - Se for SUPER_ADMIN, pode especificar 'tenantId' no DTO para criar em outra empresa.
 * - Se for ADMIN, cria forçadamente na sua própria empresa.
 */
const createUserByAdmin = async (adminUser, newUserDto) => {
  const { name, email, password, role, tenantId: targetTenantId } = newUserDto;

  if (!name || !email || !password) {
    const error = new Error('Nome, e-mail e senha são obrigatórios.');
    error.statusCode = 400;
    throw error;
  }

  // 1. Define o Tenant de destino
  let finalTenantId = adminUser.tenantId;

  // Se for SUPER_ADMIN e enviou um ID de tenant diferente, usa esse.
  if (adminUser.role === 'SUPER_ADMIN' && targetTenantId) {
    finalTenantId = targetTenantId;
  }

  // 2. Busca o Tenant para verificar limites e validar existência
  const tenant = await Tenant.findByPk(finalTenantId, {
      include: [{ model: Plan, as: 'plan' }]
  });

  if (!tenant) {
      const error = new Error('Organização destino não encontrada.');
      error.statusCode = 404;
      throw error;
  }

  // 3. Validações de Plano (Opcional: Pode ser removido para Super Admin se desejar bypass total)
  // Verifica Pagamento (se não for gratuito)
  if (tenant.plan && parseFloat(tenant.plan.price) > 0) {
      if (tenant.subscriptionStatus && ['OVERDUE', 'CANCELED'].includes(tenant.subscriptionStatus)) {
          // Se não for Super Admin, bloqueia. Super Admin pode criar mesmo com conta atrasada para suporte.
          if (adminUser.role !== 'SUPER_ADMIN') {
              throw new Error('A assinatura da organização está irregular. Regularize para adicionar usuários.');
          }
      }
  }

  if (tenant.plan) {
      const ownerCount = await User.count({ where: { tenantId: finalTenantId, status: 'ACTIVE' } });
      const memberCount = await TenantMember.count({ where: { tenantId: finalTenantId, status: { [Op.ne]: 'DECLINED' } } });
      const totalUsers = ownerCount + memberCount;

      if (totalUsers >= tenant.plan.userLimit) {
          // Mantemos a regra de limite mesmo para Super Admin para evitar inconsistência com o plano contratado
          const error = new Error(`Limite de usuários do plano atingido (${tenant.plan.userLimit}). Faça upgrade.`);
          error.statusCode = 403;
          throw error;
      }
  }
  // ---------------------------------------------------

  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    const error = new Error('O e-mail fornecido já está em uso.');
    error.statusCode = 409; 
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const newUser = await User.create({
    name,
    email,
    passwordHash,
    role: role || 'USER', 
    tenantId: finalTenantId, 
    status: 'ACTIVE'
  });

  return newUser;
};

/**
 * Atualiza um usuário (Gestão Administrativa).
 * - SUPER_ADMIN: Pode editar qualquer usuário pelo ID.
 * - ADMIN: Só pode editar usuários do seu próprio tenant.
 */
const updateUserByAdmin = async (adminUser, targetUserId, updateData) => {
  const whereClause = { id: targetUserId };

  // Se NÃO for Super Admin, restringe a busca ao tenant do admin
  if (adminUser.role !== 'SUPER_ADMIN') {
      whereClause.tenantId = adminUser.tenantId;
  }

  const userToUpdate = await User.findOne({ where: whereClause });

  if (!userToUpdate) {
    const error = new Error('Usuário não encontrado ou você não tem permissão para editá-lo.');
    error.statusCode = 404;
    throw error;
  }

  const allowedUpdates = ['name', 'role', 'status', 'email', 'phoneWhatsE164'];
  const validUpdates = {};
  for (const key of allowedUpdates) {
    if (updateData[key] !== undefined) {
      validUpdates[key] = updateData[key];
    }
  }

  await userToUpdate.update(validUpdates);
  return userToUpdate;
};

/**
 * Deleta um usuário (Gestão Administrativa).
 * - SUPER_ADMIN: Pode deletar qualquer usuário.
 * - ADMIN: Só pode deletar usuários do seu próprio tenant.
 */
const deleteUserByAdmin = async (adminUser, targetUserId) => {
  if (adminUser.id === targetUserId) {
    const error = new Error('Você não pode deletar a própria conta.');
    error.statusCode = 403;
    throw error;
  }

  const whereClause = { id: targetUserId };

  // Se NÃO for Super Admin, restringe a busca ao tenant do admin
  if (adminUser.role !== 'SUPER_ADMIN') {
      whereClause.tenantId = adminUser.tenantId;
  }

  const userToDelete = await User.findOne({ where: whereClause });

  if (!userToDelete) {
    const error = new Error('Usuário não encontrado ou você não tem permissão para removê-lo.');
    error.statusCode = 404;
    throw error;
  }

  await userToDelete.destroy();
};

module.exports = {
  updateUser,
  changeUserPassword,
  listUsersByTenant,
  listAllUsersSystem,
  createUserByAdmin,
  updateUserByAdmin,
  deleteUserByAdmin
};