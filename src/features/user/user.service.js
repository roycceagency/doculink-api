// src/features/user/user.service.js
'use strict';

const { User, Tenant, Plan, TenantMember, sequelize } = require('../../models');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');

/**
 * Função auxiliar para gerar slug (igual ao auth.service)
 */
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

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
 * Cria um novo usuário com SUA PRÓPRIA ORGANIZAÇÃO.
 * Lógica: Admin cria usuário -> Sistema cria Tenant -> Usuário vira Admin desse Tenant.
 */
const createUserByAdmin = async (adminUser, newUserDto) => {
  // 1. Extração dos dados
  const { name, email, password, role, cpf, phone } = newUserDto;

  if (!name || !email || !password) {
    const error = new Error('Nome, e-mail e senha são obrigatórios.');
    error.statusCode = 400;
    throw error;
  }

  // 2. Verifica se e-mail já existe
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    const error = new Error('O e-mail fornecido já está em uso.');
    error.statusCode = 409; 
    throw error;
  }

  const transaction = await sequelize.transaction();

  try {
    // 3. Preparação do Tenant (Organização)
    let baseSlug = generateSlug(`${name}'s Org`);
    let slug = baseSlug;

    // Verifica colisão de slug para evitar erro de banco
    const slugExists = await Tenant.findOne({ where: { slug }, transaction });
    if (slugExists) {
        slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
    }
    
    // Busca plano gratuito padrão
    const freePlan = await Plan.findOne({ where: { slug: 'gratuito' }, transaction });

    // 4. Cria o Tenant
    const newTenant = await Tenant.create({ 
        name: `${name}`, 
        slug,
        status: 'ACTIVE',
        planId: freePlan ? freePlan.id : null
    }, { transaction });

    // 5. Hash da senha
    const passwordHash = await bcrypt.hash(password, 10);

    // 6. Cria o Usuário (Dono do novo Tenant)
    // --- CORREÇÃO AQUI: tenantId usa newTenant.id ---
    const newUser = await User.create({
      name,
      email,
      passwordHash,
      role: role || 'ADMIN', 
      tenantId: newTenant.id,       // <--- AQUI ESTAVA O ERRO (finalTenantId não existe mais)
      status: 'ACTIVE',
      cpf: cpf || null,             // Salva CPF
      phoneWhatsE164: phone || null // Salva Telefone
    }, { transaction });

    // 7. Cria o registro de Membro
    await TenantMember.create({ 
        tenantId: newTenant.id,
        userId: newUser.id, 
        email: email,
        role: newUser.role,
        status: 'ACTIVE'
    }, { transaction });

    await transaction.commit();
    return newUser;

  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

/**
 * Atualiza um usuário (Gestão Administrativa).
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

  const allowedUpdates = ['name', 'role', 'status', 'email', 'phoneWhatsE164', 'cpf'];
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