// src/features/user/user.service.js
'use strict';

const { User, Tenant, Plan, TenantMember } = require('../../models');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');

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

const listUsersByTenant = async (tenantId) => {
  return User.findAll({ where: { tenantId } });
};

/**
 * Cria um novo usuário (por um administrador) com validação de plano.
 */
const createUserByAdmin = async (adminUser, newUserDto) => {
  const { name, email, password, role } = newUserDto;

  if (!name || !email || !password) {
    const error = new Error('Nome, e-mail e senha são obrigatórios.');
    error.statusCode = 400;
    throw error;
  }

  // --- TRAVA DE PLANO: VERIFICA LIMITE DE USUÁRIOS ---
  const tenant = await Tenant.findByPk(adminUser.tenantId, {
      include: [{ model: Plan, as: 'plan' }]
  });

  if (!tenant) throw new Error('Organização não encontrada.');

  // Verifica Pagamento (se não for gratuito)
  if (tenant.plan && parseFloat(tenant.plan.price) > 0) {
      if (tenant.subscriptionStatus && ['OVERDUE', 'CANCELED'].includes(tenant.subscriptionStatus)) {
          throw new Error('Sua assinatura está irregular. Regularize para adicionar usuários.');
      }
  }

  if (tenant.plan) {
      const ownerCount = await User.count({ where: { tenantId: adminUser.tenantId, status: 'ACTIVE' } });
      const memberCount = await TenantMember.count({ where: { tenantId: adminUser.tenantId, status: { [Op.ne]: 'DECLINED' } } });
      const totalUsers = ownerCount + memberCount;

      if (totalUsers >= tenant.plan.userLimit) {
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
    tenantId: adminUser.tenantId, 
    status: 'ACTIVE'
  });

  return newUser;
};

const updateUserByAdmin = async (adminUser, targetUserId, updateData) => {
  const userToUpdate = await User.findOne({
    where: { id: targetUserId, tenantId: adminUser.tenantId }
  });

  if (!userToUpdate) {
    const error = new Error('Usuário não encontrado ou não pertence a esta organização.');
    error.statusCode = 404;
    throw error;
  }

  const allowedUpdates = ['name', 'role', 'status'];
  const validUpdates = {};
  for (const key of allowedUpdates) {
    if (updateData[key] !== undefined) {
      validUpdates[key] = updateData[key];
    }
  }

  await userToUpdate.update(validUpdates);
  return userToUpdate;
};

const deleteUserByAdmin = async (adminUser, targetUserId) => {
  if (adminUser.id === targetUserId) {
    const error = new Error('Um administrador não pode deletar a própria conta.');
    error.statusCode = 403;
    throw error;
  }

  const userToDelete = await User.findOne({
    where: { id: targetUserId, tenantId: adminUser.tenantId }
  });

  if (!userToDelete) {
    const error = new Error('Usuário não encontrado ou não pertence a esta organização.');
    error.statusCode = 404;
    throw error;
  }

  await userToDelete.destroy();
};

module.exports = {
  updateUser,
  changeUserPassword,
  listUsersByTenant,
  createUserByAdmin,
  updateUserByAdmin,
  deleteUserByAdmin
};
