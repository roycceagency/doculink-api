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
 * Geralmente usado pelo Super Admin.
 */
const createTenantWithAdmin = async (tenantName, adminUserData) => {
  const transaction = await sequelize.transaction();
  try {
    let slug = generateSlug(tenantName);
    const existingTenant = await Tenant.findOne({ where: { slug }, transaction });
    
    if (existingTenant) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
    }

    // Define um plano padrão (ex: Básico) para tenants criados manualmente pelo Super Admin.
    // Para registro público (via site), a lógica fica no auth.service (Plano Gratuito).
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
 * Verifica limites do plano e status da assinatura.
 */
const inviteMember = async (currentTenantId, email, role = 'VIEWER') => {
  const tenant = await Tenant.findByPk(currentTenantId, { include: [{ model: Plan, as: 'plan' }] });
  
  if (!tenant) throw new Error('Organização não encontrada.');

  // --- TRAVA DE PAGAMENTO (IGNORA SE FOR PLANO GRATUITO) ---
  if (tenant.plan && parseFloat(tenant.plan.price) > 0) {
      if (tenant.subscriptionStatus && ['OVERDUE', 'CANCELED'].includes(tenant.subscriptionStatus)) {
          throw new Error('Sua assinatura está irregular. Regularize o pagamento para convidar novos membros.');
      }
  }

  // --- TRAVA DE LIMITE DE USUÁRIOS DO PLANO ---
  if (tenant.plan) {
    // Conta donos (geralmente 1)
    const ownerCount = await User.count({ 
        where: { tenantId: currentTenantId, status: 'ACTIVE' } 
    });
    
    // Conta membros ativos e pendentes (exceto recusados)
    const memberCount = await TenantMember.count({ 
      where: { 
        tenantId: currentTenantId, 
        status: { [Op.ne]: 'DECLINED' } 
      } 
    });
    
    const totalUsers = ownerCount + memberCount;

    if (totalUsers >= tenant.plan.userLimit) {
      throw new Error(`Limite de usuários do plano atingido (${totalUsers}/${tenant.plan.userLimit}). Faça upgrade para adicionar mais pessoas.`);
    }
  }
  // --------------------------------------------------------

  // Verifica se o usuário já existe na plataforma globalmente
  const existingUser = await User.findOne({ where: { email } });

  if (!existingUser) {
      // Regra de negócio: O usuário deve se cadastrar primeiro ou o sistema deve permitir criar conta "shadow".
      // Aqui assumimos que ele deve existir.
      throw new Error('Este e-mail não corresponde a nenhuma conta registrada no Doculink. O usuário precisa se cadastrar na plataforma primeiro.');
  }

  // Verifica se já é membro desta equipe
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
      userId: existingUser.id,
      role,
      status: 'PENDING'
    }
  });

  // Se já existia (ex: recusado ou pendente antigo), reativa/atualiza
  if (!created) {
    member.status = 'PENDING';
    member.userId = existingUser.id;
    member.role = role;
    member.invitedAt = new Date(); // Atualiza data do convite
    await member.save();
  }

  // Envia Notificação por E-mail
  const inviteLink = `${process.env.FRONT_URL}/onboarding`; // Link para o usuário ver os convites no front

  try {
      await notificationService.sendEmail(currentTenantId, {
          to: email,
          subject: `Convite para participar de ${tenant.name}`,
          html: `
            <div style="font-family: sans-serif; color: #333;">
                <h2>Olá, ${existingUser.name}!</h2>
                <p>Você foi convidado para fazer parte da equipe <strong>${tenant.name}</strong> no Doculink.</p>
                <p>Nível de acesso: <strong>${role}</strong></p>
                <p style="margin: 20px 0;">
                    <a href="${inviteLink}" style="background-color: #2563EB; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Ver Convite
                    </a>
                </p>
                <p><small>Se você não esperava este convite, pode ignorar este e-mail.</small></p>
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
  
  // Valida se o convite pertence ao usuário logado
  if (invite.userId !== userId) {
      // Fallback: verifica por e-mail se o userId estava nulo
      const user = await User.findByPk(userId);
      if (user.email !== invite.email) {
          throw new Error('Este convite não pertence a você.');
      }
      // Vincula o ID agora
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