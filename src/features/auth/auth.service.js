// src/features/auth/auth.service.js
'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, Tenant, Session, sequelize } = require('../../models');
const auditService = require('../audit/audit.service'); // Importação do Serviço de Auditoria

// --- FUNÇÕES AUXILIARES INTERNAS ---

/**
 * Gera um 'slug' seguro para URL a partir de um nome.
 * @param {string} name - O nome a ser convertido.
 * @returns {string}
 */
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
 * Gera um par de tokens (access e refresh) para um usuário autenticado.
 * @param {User} user - O objeto do usuário do Sequelize.
 * @returns {{accessToken: string, refreshToken: string}}
 */
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { userId: user.id, tenantId: user.tenantId },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

/**
 * Salva a sessão do refresh token no banco de dados.
 * @param {string} userId - ID do usuário.
 * @param {string} refreshToken - O token de refresh.
 */
const saveSession = async (userId, refreshToken) => {
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

  await Session.create({
    userId,
    refreshTokenHash,
    expiresAt,
  });
};


// --- FUNÇÕES DE SERVIÇO PRINCIPAIS (EXPORTADAS) ---

/**
 * Cadastra um novo usuário e seu tenant.
 * @param {object} userData - Dados do usuário (name, email, password, etc).
 * @param {object} context - Dados de contexto { ip, userAgent }.
 */
const registerUser = async (userData, { ip, userAgent } = {}) => {
  const { name, email, password, cpf, phone } = userData;

  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new Error('A senha é inválida ou muito curta (mínimo 6 caracteres).');
  }

  const existingUser = await User.scope('withPassword').findOne({ where: { email } });
  if (existingUser) {
    throw new Error('Este e-mail já está em uso.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  
  if (!passwordHash) {
      throw new Error("Falha crítica ao gerar o hash da senha.");
  }

  const transaction = await sequelize.transaction();
  try {
    let slug = generateSlug(`${name}'s Organization`);
    
    // Cria a organização (Tenant)
    const newTenant = await Tenant.create({ 
        name: `${name}'s Organization`, 
        slug 
    }, { transaction });

    const newUserPayload = {
      name,
      email,
      passwordHash,
      cpf,
      phoneWhatsE164: phone,
      tenantId: newTenant.id,
    };
    
    // Cria o usuário
    const newUser = await User.create(newUserPayload, { transaction });
    
    // Recarrega o usuário para garantir integridade
    const createdUserWithPassword = await User.scope('withPassword').findByPk(newUser.id, { transaction });

    if (!createdUserWithPassword || !createdUserWithPassword.passwordHash) {
      throw new Error("Falha ao salvar a senha do usuário durante o registro.");
    }

    // --- AUDIT LOG: CRIAÇÃO DE USUÁRIO ---
    // Como o usuário acabou de ser criado, ele é o ator e a entidade
    await auditService.createEntry({
        tenantId: newTenant.id,
        actorKind: 'USER',
        actorId: newUser.id,
        entityType: 'USER',
        entityId: newUser.id,
        action: 'USER_CREATED',
        ip: ip || '0.0.0.0',
        userAgent: userAgent || 'System',
        payload: { email, tenantName: newTenant.name }
    }, transaction);
    // -------------------------------------

    await transaction.commit();

    const { accessToken, refreshToken } = generateTokens(createdUserWithPassword);
    await saveSession(createdUserWithPassword.id, refreshToken);
    
    const userToReturn = createdUserWithPassword.toJSON();
    delete userToReturn.passwordHash;

    return { accessToken, refreshToken, user: userToReturn };
  } catch (error) {
    await transaction.rollback();
    console.error("ERRO NO REGISTRO:", error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw new Error('Não foi possível criar a conta. O CPF ou e-mail já está em uso.');
    }
    throw error;
  }
};

/**
 * Autentica um usuário com e-mail e senha.
 * @param {string} email 
 * @param {string} password 
 * @param {object} context - Objeto contendo { ip, userAgent } vindo do controller.
 */
const loginUser = async (email, password, { ip, userAgent }) => {
  if (!password || typeof password !== 'string') {
    throw new Error('Credenciais inválidas.');
  }

  const user = await User.scope('withPassword').findOne({ where: { email } });
  
  // Validações de segurança (Timing attack resistant logic seria ideal, mas simples aqui)
  if (!user || !user.passwordHash) {
    // Opcional: Poderíamos logar LOGIN_FAILED aqui, mas precisamos do tenantId do usuário que tentou logar (se existisse)
    throw new Error('Credenciais inválidas.'); 
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  
  if (!isPasswordValid) {
    // Log de falha poderia ser inserido aqui se desejado, cuidado com DoS de logs
    throw new Error('Credenciais inválidas.');
  }
  
  const { accessToken, refreshToken } = generateTokens(user);
  await saveSession(user.id, refreshToken);

  // --- AUDIT LOG: LOGIN SUCESSO ---
  try {
    await auditService.createEntry({
      tenantId: user.tenantId,
      actorKind: 'USER',
      actorId: user.id,
      entityType: 'USER', // A entidade afetada é a sessão do usuário
      entityId: user.id,
      action: 'LOGIN_SUCCESS',
      ip,
      userAgent,
      payload: { email }
    });
  } catch (logError) {
    console.error("Falha ao registrar log de login:", logError);
    // Não impedimos o login se o log falhar, mas registramos o erro no console
  }
  // --------------------------------

  const userToReturn = user.toJSON();
  delete userToReturn.passwordHash;
  
  return { accessToken, refreshToken, user: userToReturn };
};

/**
 * Processa um refresh token para emitir um novo par de tokens.
 */
const handleRefreshToken = async (refreshTokenFromRequest) => {
  try {
    const decoded = jwt.verify(refreshTokenFromRequest, process.env.JWT_REFRESH_SECRET);
    const sessions = await Session.findAll({ where: { userId: decoded.userId } });
    
    if (!sessions || sessions.length === 0) throw new Error('Nenhuma sessão ativa encontrada.');
    
    let sessionRecord = null;
    for (const session of sessions) {
        const isMatch = await bcrypt.compare(refreshTokenFromRequest, session.refreshTokenHash);
        if (isMatch) {
            sessionRecord = session;
            break;
        }
    }

    if (!sessionRecord) throw new Error('Refresh token inválido ou revogado.');
    
    // Remove a sessão antiga (rotação de refresh token)
    await sessionRecord.destroy();
    
    const user = await User.findByPk(decoded.userId);
    if (!user) throw new Error('Usuário associado ao token não encontrado.');

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    await saveSession(user.id, newRefreshToken);
    
    return { accessToken, refreshToken: newRefreshToken };
  } catch (error) {
    throw new Error('Acesso negado. Sessão inválida.');
  }
};

/**
 * Realiza o logout invalidando o refresh token e registrando log.
 * @param {string} refreshTokenFromRequest 
 * @param {User} user - Usuário autenticado
 * @param {object} context - { ip, userAgent }
 */
const handleLogout = async (refreshTokenFromRequest, user, { ip, userAgent } = {}) => {
  const sessions = await Session.findAll({ where: { userId: user.id } });
  
  let sessionFound = false;

  for (const session of sessions) {
      const isMatch = await bcrypt.compare(refreshTokenFromRequest, session.refreshTokenHash);
      if (isMatch) {
          await session.destroy();
          sessionFound = true;
          break;
      }
  }

  if (sessionFound) {
      // --- AUDIT LOG: LOGOUT ---
      try {
        await auditService.createEntry({
            tenantId: user.tenantId,
            actorKind: 'USER',
            actorId: user.id,
            entityType: 'USER',
            entityId: user.id,
            action: 'LOGOUT',
            ip,
            userAgent
        });
      } catch (error) {
          console.error("Erro ao registrar log de logout:", error);
      }
      // -------------------------
  }
};

module.exports = {
  registerUser,
  loginUser,
  handleRefreshToken,
  handleLogout,
};