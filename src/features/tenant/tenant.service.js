// src/features/tenant/tenant.service.js
'use strict';

const { Tenant, User, Plan, TenantMember, sequelize } = require('../../models');
const notificationService = require('../../services/notification.service');
const { Op } = require('sequelize');

/**
 * Gera um slug amigável para URL a partir do nome.
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
 * Cria um novo Tenant e o primeiro usuário Admin.
 */
const createTenantWithAdmin = async (tenantName, adminUserData) => {
  const transaction = await sequelize.transaction();
  try {
    let slug = generateSlug(tenantName);
    const existingTenant = await Tenant.findOne({ where: { slug }, transaction });
    
    if (existingTenant) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
    }

    const basicPlan = await Plan.findOne({ where: { slug: 'basico' }, transaction });

    const tenant = await Tenant.create({
      name: tenantName,
      slug: slug,
      status: 'ACTIVE',
      planId: basicPlan ? basicPlan.id : null
    }, { transaction });

    await User.create({
      tenantId: tenant.id,
      name: adminUserData.name,
      email: adminUserData.email,
      role: 'ADMIN', 
      status: 'ACTIVE'
    }, { transaction });

    await transaction.commit();
    return tenant;
  } catch (error) {
    await transaction.rollback();
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw new Error(`O e-mail '${adminUserData.email}' já está em uso.`);
    }
    throw error;
  }
};

const findAllTenants = async () => {
  return Tenant.findAll({
    order: [['name', 'ASC']],
    include: [{ model: Plan, as: 'plan' }]
  });
};

const findTenantById = async (id) => {
  const tenant = await Tenant.findByPk(id, {
    include: [{ model: Plan, as: 'plan' }]
  });
  
  if (!tenant) {
    throw new Error('Tenant não encontrado.');
  }
  
  const owners = await User.count({ where: { tenantId: id, status: 'ACTIVE' } });
  const members = await TenantMember.count({ where: { tenantId: id, status: 'ACTIVE' } });
  const docs = await sequelize.models.Document.count({ where: { tenantId: id } });

  const tenantData = tenant.toJSON();
  tenantData.usage = {
    users: owners + members,
    documents: docs
  };
  
  return tenantData;
};

const updateTenantById = async (id, updateData) => {
  const tenant = await Tenant.findByPk(id);
  if (!tenant) {
    throw new Error('Tenant não encontrado.');
  }

  const allowedUpdates = ['name', 'status', 'planId'];
  const validUpdates = {};

  for (const key of allowedUpdates) {
    if (updateData[key] !== undefined) {
      validUpdates[key] = updateData[key];
    }
  }

  if (validUpdates.name) {
    validUpdates.slug = generateSlug(validUpdates.name);
  }

  await tenant.update(validUpdates);
  return tenant;
};

const listMyTenants = async (userId) => {
  const user = await User.findByPk(userId, {
    include: [{ model: Tenant, as: 'ownTenant' }]
  });

  const memberships = await TenantMember.findAll({
    where: { userId, status: 'ACTIVE' },
    include: [{ model: Tenant, as: 'tenant' }]
  });

  const list = [];
  
  if (user.ownTenant) {
    list.push({
      id: user.ownTenant.id,
      name: user.ownTenant.name,
      role: 'ADMIN', 
      isPersonal: true
    });
  }

  memberships.forEach(m => {
    if (m.tenant) {
      list.push({
        id: m.tenant.id,
        name: m.tenant.name,
        role: m.role, 
        isPersonal: false
      });
    }
  });

  return list;
};

/**
 * Convida um usuário por e-mail para o Tenant atual.
 */
const inviteMember = async (currentTenantId, email, role = 'VIEWER') => {
  const tenant = await Tenant.findByPk(currentTenantId, { include: [{ model: Plan, as: 'plan' }] });
  
  if (!tenant) throw new Error('Organização não encontrada.');

  if (tenant.subscriptionStatus && ['OVERDUE', 'CANCELED'].includes(tenant.subscriptionStatus)) {
      throw new Error('Sua assinatura está irregular. Regularize o pagamento para convidar novos membros.');
  }

  if (tenant.plan) {
    const ownerCount = await User.count({ 
        where: { tenantId: currentTenantId, status: 'ACTIVE' } 
    });
    
    const memberCount = await TenantMember.count({ 
      where: { 
        tenantId: currentTenantId, 
        status: { [Op.ne]: 'DECLINED' } 
      } 
    });
    
    const totalUsers = ownerCount + memberCount;

    if (totalUsers >= tenant.plan.userLimit) {
      throw new Error(`Limite de usuários do plano atingido (${tenant.plan.userLimit}). Faça upgrade para adicionar mais pessoas.`);
    }
  }

  // --- CORREÇÃO AQUI: VALIDAÇÃO DE EXISTÊNCIA ---
  // Verifica se o usuário existe no sistema global
  const existingUser = await User.findOne({ where: { email } });

  if (!existingUser) {
      // Se a regra de negócio exige que o usuário já tenha conta:
      throw new Error('Este e-mail não corresponde a nenhuma conta registrada no Doculink. O usuário precisa se cadastrar primeiro.');
  }
  // ---------------------------------------------

  // Verifica se já é membro
  const existingMember = await TenantMember.findOne({
      where: { tenantId: currentTenantId, email }
  });

  if (existingMember && existingMember.status === 'ACTIVE') {
      throw new Error('Este usuário já é membro desta equipe.');
  }

  // Cria ou Atualiza o convite
  const [member, created] = await TenantMember.findOrCreate({
    where: { tenantId: currentTenantId, email },
    defaults: {
      userId: existingUser.id, // Já vincula o ID pois sabemos que existe
      role,
      status: 'PENDING'
    }
  });

  if (!created) {
    member.status = 'PENDING';
    member.userId = existingUser.id;
    member.role = role;
    await member.save();
  }

  // Envia Notificação
  const inviteLink = `${process.env.FRONT_URL}/onboarding`;

  try {
      await notificationService.sendEmail(currentTenantId, {
          to: email,
          subject: `Convite para participar de ${tenant.name}`,
          html: `
            <div style="font-family: sans-serif; color: #333;">
                <h2>Olá, ${existingUser.name}!</h2>
                <p>Você foi convidado para fazer parte da equipe <strong>${tenant.name}</strong>.</p>
                <p style="margin: 20px 0;">
                    <a href="${inviteLink}" style="background-color: #2563EB; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Ver Convite
                    </a>
                </p>
            </div>
          `
      });
  } catch (error) {
      console.error(`[Invite] Erro ao enviar e-mail para ${email}:`, error.message);
  }
  
  return member;
};

const listPendingInvites = async (userId, userEmail) => {
  return TenantMember.findAll({
      where: {
          [Op.or]: [{ userId }, { email: userEmail }],
          status: 'PENDING'
      },
      include: [{ model: Tenant, as: 'tenant' }]
  });
};

const listSentInvites = async (tenantId) => {
  return TenantMember.findAll({
    where: {
      tenantId,
      status: 'PENDING'
    },
    attributes: ['id', 'email', 'role', 'createdAt']
  });
};

const respondToInvite = async (userId, inviteId, accept) => {
  const invite = await TenantMember.findByPk(inviteId);
  if (!invite) {
    throw new Error('Convite não encontrado.');
  }
  
  if (invite.userId !== userId) {
      const user = await User.findByPk(userId);
      if (user.email !== invite.email) {
          throw new Error('Este convite não pertence a você.');
      }
      invite.userId = userId;
  }

  invite.status = accept ? 'ACTIVE' : 'DECLINED';
  await invite.save();
  
  return invite;
};

module.exports = {
  createTenantWithAdmin,
  findAllTenants,
  findTenantById,
  updateTenantById,
  listMyTenants,
  inviteMember,
  listPendingInvites,
  listSentInvites,
  respondToInvite
};