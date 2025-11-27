// src/features/auth/auth.service.js
'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, Tenant, Session, TenantMember, sequelize } = require('../../models');
const auditService = require('../audit/audit.service');

// --- FUNÇÕES AUXILIARES INTERNAS ---

const generateSlug = (name) => {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * Gera tokens JWT.
 * @param {User} user - Objeto usuário.
 * @param {string} activeTenantId - O ID da organização que o usuário está acessando AGORA.
 * @param {string} activeRole - O papel do usuário NESTA organização (ADMIN/USER/SUPER_ADMIN).
 */
const generateTokens = (user, activeTenantId, activeRole) => {
  const accessToken = jwt.sign(
    { 
      userId: user.id, 
      tenantId: activeTenantId, // O Token agora carrega o contexto atual
      role: activeRole          // E a permissão naquele contexto
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' } // Expiração do Access Token
  );

  const refreshToken = jwt.sign(
    { userId: user.id, tenantId: activeTenantId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

const saveSession = async (userId, refreshToken) => {
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await Session.create({
    userId,
    refreshTokenHash,
    expiresAt,
  });
};

// --- FUNÇÕES PRINCIPAIS ---

const registerUser = async (userData, { ip, userAgent } = {}) => {
  const { name, email, password, cpf, phone } = userData;

  if (!password || password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');

  const existingUser = await User.scope('withPassword').findOne({ where: { email } });
  if (existingUser) throw new Error('Este e-mail já está em uso.');

  const passwordHash = await bcrypt.hash(password, 10);
  
  const transaction = await sequelize.transaction();
  try {
    let slug = generateSlug(`${name}'s Org`);
    
    // --- ALTERAÇÃO: Busca o plano GRATUITO para novos usuários ---
    const freePlan = await Plan.findOne({ where: { slug: 'gratuito' }, transaction });
    // -------------------------------------------------------------

    // 1. Cria o Tenant Pessoal
    const newTenant = await Tenant.create({ 
        name: `${name}`, 
        slug,
        status: 'ACTIVE',
        planId: freePlan ? freePlan.id : null // Começa no plano gratuito
    }, { transaction });

    // 2. Cria o Usuário (Dono)
    const newUser = await User.create({
      name,
      email,
      passwordHash,
      cpf,
      phoneWhatsE164: phone,
      tenantId: newTenant.id,
      role: 'ADMIN',
      status: 'ACTIVE'
    }, { transaction });
    
    await TenantMember.update({ userId: newUser.id }, { where: { email: email }, transaction });

    await auditService.createEntry({
        tenantId: newTenant.id,
        actorKind: 'USER',
        actorId: newUser.id,
        entityType: 'USER',
        entityId: newUser.id,
        action: 'USER_CREATED',
        ip: ip || '0.0.0.0',
        userAgent: userAgent || 'System',
        payload: { email, plan: 'gratuito' }
    }, transaction);

    await transaction.commit();

    const { accessToken, refreshToken } = generateTokens(newUser, newTenant.id, 'ADMIN');
    await saveSession(newUser.id, refreshToken);
    
    const userToReturn = newUser.toJSON();
    delete userToReturn.passwordHash;

    return { accessToken, refreshToken, user: userToReturn };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

const loginUser = async (email, password, { ip, userAgent }) => {
  const user = await User.scope('withPassword').findOne({ where: { email } });
  
  if (!user || !user.passwordHash) throw new Error('Credenciais inválidas.'); 

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) throw new Error('Credenciais inválidas.');
  
  // Por padrão, loga no Tenant Pessoal
  const activeTenantId = user.tenantId;
  
  // --- CORREÇÃO: Verifica se é SUPER_ADMIN ---
  let activeRole = 'ADMIN';
  if (user.role === 'SUPER_ADMIN') {
    activeRole = 'SUPER_ADMIN';
  }
  // ------------------------------------------

  const { accessToken, refreshToken } = generateTokens(user, activeTenantId, activeRole);
  await saveSession(user.id, refreshToken);

  await auditService.createEntry({
      tenantId: activeTenantId,
      actorKind: 'USER',
      actorId: user.id,
      entityType: 'USER',
      entityId: user.id,
      action: 'LOGIN_SUCCESS',
      ip,
      userAgent,
      payload: { email, context: 'PERSONAL' }
  });

  const userToReturn = user.toJSON();
  delete userToReturn.passwordHash;
  
  return { accessToken, refreshToken, user: userToReturn };
};

/**
 * Permite trocar o contexto de acesso para outro Tenant (se for membro).
 */
const switchTenantContext = async (userId, targetTenantId, { ip, userAgent }) => {
  const user = await User.findByPk(userId);
  if (!user) throw new Error('Usuário não encontrado.');

  let newRole = 'USER';
  let authorized = false;

  // 1. Verifica se é o Tenant Pessoal
  if (user.tenantId === targetTenantId) {
    authorized = true;
    // --- CORREÇÃO: Mantém role de SUPER_ADMIN se for o caso ---
    newRole = (user.role === 'SUPER_ADMIN') ? 'SUPER_ADMIN' : 'ADMIN';
  } else {
    // 2. Verifica se é membro convidado
    const membership = await TenantMember.findOne({
      where: { 
        userId, 
        tenantId: targetTenantId, 
        status: 'ACTIVE' 
      }
    });

    if (membership) {
      authorized = true;
      newRole = membership.role;
    }
  }

  if (!authorized) {
    throw new Error('Você não tem permissão para acessar esta organização.');
  }

  // Gera novos tokens com o novo tenantId e role
  const { accessToken, refreshToken } = generateTokens(user, targetTenantId, newRole);
  await saveSession(user.id, refreshToken);

  // Loga a troca de contexto
  await auditService.createEntry({
    tenantId: targetTenantId,
    actorKind: 'USER',
    actorId: userId,
    entityType: 'SYSTEM',
    entityId: userId,
    action: 'LOGIN_SUCCESS',
    ip,
    userAgent,
    payload: { message: 'Switched Tenant Context' }
  });

  return { accessToken, refreshToken, user };
};

const handleRefreshToken = async (refreshTokenFromRequest) => {
  try {
    // Decodifica sem verificar primeiro para pegar dados
    const decoded = jwt.decode(refreshTokenFromRequest);
    if (!decoded) throw new Error('Token malformado');

    // Verifica validade real
    jwt.verify(refreshTokenFromRequest, process.env.JWT_REFRESH_SECRET);

    const sessions = await Session.findAll({ where: { userId: decoded.userId } });
    if (!sessions.length) throw new Error('Nenhuma sessão ativa.');
    
    let sessionRecord = null;
    for (const session of sessions) {
        if (await bcrypt.compare(refreshTokenFromRequest, session.refreshTokenHash)) {
            sessionRecord = session;
            break;
        }
    }
    if (!sessionRecord) throw new Error('Token inválido.');
    await sessionRecord.destroy();
    
    const user = await User.findByPk(decoded.userId);
    
    // Mantém o mesmo Tenant ID do token anterior (Contexto Persistente)
    const currentTenantId = decoded.tenantId || user.tenantId;
    
    // Precisamos descobrir o role neste tenant novamente
    let role = 'USER';
    if (currentTenantId === user.tenantId) {
      // --- CORREÇÃO: Mantém SUPER_ADMIN ---
      role = (user.role === 'SUPER_ADMIN') ? 'SUPER_ADMIN' : 'ADMIN';
    } else {
      const mem = await TenantMember.findOne({ where: { userId: user.id, tenantId: currentTenantId }});
      if (mem) role = mem.role;
    }

    const { accessToken, refreshToken: newRef } = generateTokens(user, currentTenantId, role);
    await saveSession(user.id, newRef);
    
    return { accessToken, refreshToken: newRef };
  } catch (error) {
    throw new Error('Sessão expirada ou inválida.');
  }
};

const handleLogout = async (refreshToken, user) => {
    const sessions = await Session.findAll({ where: { userId: user.id } });
    for (const session of sessions) {
      if (await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
          await session.destroy();
      }
    }
};

module.exports = {
  registerUser,
  loginUser,
  handleRefreshToken,
  handleLogout,
  switchTenantContext
};