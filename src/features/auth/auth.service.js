// src/features/auth/auth.service.js
'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // Importação trazida para o topo
const { User, Tenant, Session, TenantMember, Plan, OtpCode, sequelize } = require('../../models');
const auditService = require('../audit/audit.service');
const notificationService = require('../../services/notification.service');

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

const generateTokens = (user, activeTenantId, activeRole) => {
  const accessToken = jwt.sign(
    { 
      userId: user.id, 
      tenantId: activeTenantId, 
      role: activeRole          
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
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

/**
 * Gera um OTP numérico de 6 dígitos compatível com versões antigas do Node.
 */
const generateSixDigitOtp = () => {
  // Gera 4 bytes aleatórios e converte para um número inteiro sem sinal
  const randomValue = crypto.randomBytes(4).readUInt32BE(0);
  // Garante que o número esteja entre 100000 e 999999
  const otp = (randomValue % 900000) + 100000;
  return otp.toString();
};

// --- FUNÇÕES PRINCIPAIS ---

const registerUser = async (userData, { ip, userAgent } = {}) => {
  const { name, email, password, cpf, phone } = userData;

  if (!password || password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');

  // Limpa CPF e Telefone (apenas números)
  const cpfClean = cpf ? cpf.replace(/\D/g, '') : null;
  const phoneClean = phone ? phone.replace(/\D/g, '') : null;

  // Verifica e-mail
  const existingUser = await User.scope('withPassword').findOne({ where: { email } });
  if (existingUser) throw new Error('Este e-mail já está em uso.');

  // Verifica CPF
  if (cpfClean) {
    const existingCpf = await User.findOne({ where: { cpf: cpfClean } });
    if (existingCpf) throw new Error('Este CPF já está em uso.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  
  const transaction = await sequelize.transaction();
  try {
    let baseSlug = generateSlug(`${name}'s Org`);
    let slug = baseSlug;

    const slugExists = await Tenant.findOne({ where: { slug }, transaction });
    if (slugExists) {
        slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
    }
    
    const freePlan = await Plan.findOne({ where: { slug: 'gratuito' }, transaction });

    const newTenant = await Tenant.create({ 
        name: `${name}`, 
        slug,
        status: 'ACTIVE',
        planId: freePlan ? freePlan.id : null 
    }, { transaction });

    const newUser = await User.create({
      name,
      email,
      passwordHash,
      cpf: cpfClean,
      phoneWhatsE164: phoneClean,
      tenantId: newTenant.id,
      role: 'ADMIN', 
      status: 'ACTIVE'
    }, { transaction });
    
    await TenantMember.create({ 
        tenantId: newTenant.id,
        userId: newUser.id, 
        email: email,
        role: 'ADMIN',
        status: 'ACTIVE'
    }, { transaction });

    await auditService.createEntry({
        tenantId: newTenant.id,
        actorKind: 'USER',
        actorId: newUser.id,
        entityType: 'USER',
        entityId: newUser.id,
        action: 'USER_CREATED',
        ip: ip || '0.0.0.0',
        userAgent: userAgent || 'System',
        payload: { email, plan: 'gratuito', context: 'SELF_REGISTER' }
    }, transaction);

    await transaction.commit();

    const { accessToken, refreshToken } = generateTokens(newUser, newTenant.id, 'ADMIN');
    await saveSession(newUser.id, refreshToken);
    
    const userToReturn = newUser.toJSON();
    delete userToReturn.passwordHash;

    return { accessToken, refreshToken, user: userToReturn };

  } catch (error) {
    await transaction.rollback();
    
    if (error.name === 'SequelizeUniqueConstraintError') {
        if (error.fields && error.fields.slug) throw new Error('Erro ao gerar ID da organização.');
        if (error.fields && error.fields.email) throw new Error('Este e-mail já está em uso.');
        if (error.fields && error.fields.cpf) throw new Error('Este CPF já está em uso.');
    }
    throw error;
  }
};

const loginUser = async (email, password, { ip, userAgent }) => {
  const user = await User.scope('withPassword').findOne({ where: { email } });
  
  if (!user || !user.passwordHash) throw new Error('Credenciais inválidas.'); 

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) throw new Error('Credenciais inválidas.');
  
  const activeTenantId = user.tenantId;
  
  let activeRole = 'ADMIN';
  if (user.role === 'SUPER_ADMIN') {
    activeRole = 'SUPER_ADMIN';
  }

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

const switchTenantContext = async (userId, targetTenantId, { ip, userAgent }) => {
  const user = await User.findByPk(userId);
  if (!user) throw new Error('Usuário não encontrado.');

  let newRole = 'USER';
  let authorized = false;

  if (user.tenantId === targetTenantId) {
    authorized = true;
    newRole = (user.role === 'SUPER_ADMIN') ? 'SUPER_ADMIN' : 'ADMIN';
  } else {
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

  const { accessToken, refreshToken } = generateTokens(user, targetTenantId, newRole);
  await saveSession(user.id, refreshToken);

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
    const decoded = jwt.decode(refreshTokenFromRequest);
    if (!decoded) throw new Error('Token malformado');

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
    
    const currentTenantId = decoded.tenantId || user.tenantId;
    
    let role = 'USER';
    if (currentTenantId === user.tenantId) {
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

const requestPasswordReset = async (email, channel = 'EMAIL') => {
  const user = await User.findOne({ where: { email } });
  
  if (!user) {
    return; // Silently fail to avoid enumeration
  }

  if (channel === 'WHATSAPP') {
    if (!user.phoneWhatsE164) {
      throw new Error('Este usuário não possui um número de WhatsApp cadastrado. Tente por e-mail.');
    }
  }

  // --- CORREÇÃO APLICADA AQUI: Substituição do randomInt por randomBytes ---
  const otp = generateSixDigitOtp();
  // --------------------------------------------------------------------------

  const codeHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); 

  await OtpCode.create({
    recipient: channel === 'WHATSAPP' ? user.phoneWhatsE164 : email, 
    channel: channel,
    codeHash,
    expiresAt,
    context: 'PASSWORD_RESET'
  });

  await notificationService.sendForgotPasswordNotification(user, otp, channel);
};

const resetPassword = async (email, otp, newPassword) => {
  const user = await User.findOne({ where: { email } });
  if (!user) throw new Error('Usuário não encontrado.');

  const transaction = await sequelize.transaction();
  try {
    const possibleRecipients = [email];
    if (user.phoneWhatsE164) possibleRecipients.push(user.phoneWhatsE164);

    const otpRecord = await OtpCode.findOne({
      where: { 
        recipient: { [require('sequelize').Op.in]: possibleRecipients }, 
        context: 'PASSWORD_RESET' 
      },
      order: [['createdAt', 'DESC']],
      transaction
    });

    if (!otpRecord || new Date() > new Date(otpRecord.expiresAt)) {
      throw new Error('Código inválido ou expirado.');
    }

    const isMatch = await bcrypt.compare(otp, otpRecord.codeHash);
    if (!isMatch) {
      throw new Error('Código incorreto.');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    
    await user.update({ passwordHash: newPasswordHash }, { transaction });
    
    await otpRecord.destroy({ transaction });

    await transaction.commit();
    return { message: 'Senha alterada com sucesso.' };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

module.exports = {
  registerUser,
  loginUser,
  handleRefreshToken,
  handleLogout,
  switchTenantContext,
  requestPasswordReset,
  resetPassword
};