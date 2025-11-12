// src/features/auth/auth.service.js

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, Tenant, Session, sequelize } = require('../../models');

/**
 * Função auxiliar para gerar um par de tokens (access e refresh).
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
 * Função auxiliar para salvar a sessão do refresh token no banco de dados.
 * @param {string} userId - ID do usuário.
 * @param {string} refreshToken - O token de refresh (não o hash).
 * @param {import('express').Request} [req] - Objeto da requisição (opcional) para IP/User-Agent.
 */
const saveSession = async (userId, refreshToken, req) => {
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

  await Session.create({
    userId,
    refreshTokenHash,
    expiresAt,
    ip: req?.ip,
    userAgent: req?.headers['user-agent'],
  });
};

/**
 * Cadastra um novo usuário e um novo Tenant para ele.
 * @param {object} userData - Dados do usuário { name, email, password }.
 * @returns {Promise<{accessToken: string, refreshToken: string, user: object}>}
 */
const registerUser = async (userData) => {
  const { name, email, password, cpf, phone } = userData;

  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new Error('Este e-mail já está em uso.');
  }

  const transaction = await sequelize.transaction();
  try {
    // --- CORREÇÃO DO BUG E ATUALIZAÇÃO ---
    // 1. Gera o slug para o novo Tenant
    let slug = generateSlug(`${name}'s Organization`);
    const existingTenant = await Tenant.findOne({ where: { slug } });
    if (existingTenant) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
    }
    
    // 2. Cria o tenant com o slug
    const newTenant = await Tenant.create({ name: `${name}'s Organization`, slug }, { transaction });

    const passwordHash = await bcrypt.hash(password, 10);

    // 3. Cria o usuário com os novos campos
    const newUser = await User.create({
      name,
      email,
      passwordHash,
      cpf,
      phoneWhatsE164: phone, // Mapeia o campo 'phone' do formulário para o 'phoneWhatsE164' do DB
      tenantId: newTenant.id,
    }, { transaction });
    // ------------------------------------

    await transaction.commit();

    // ... (resto da função: gerar tokens, salvar sessão, etc.)
    const { accessToken, refreshToken } = generateTokens(newUser);
    await saveSession(newUser.id, refreshToken);
    
    const userToReturn = newUser.toJSON();
    delete userToReturn.passwordHash;

    return { accessToken, refreshToken, user: userToReturn };
  } catch (error) {
    await transaction.rollback();
    // Adiciona um log para depuração em caso de erro de banco
    console.error("Erro na transação de registro:", error); 
    // Erro de violação de unicidade (ex: CPF já existe)
    if (error.name === 'SequelizeUniqueConstraintError') {
        throw new Error(`Não foi possível criar a conta. O CPF ou e-mail já está em uso.`);
    }
    throw new Error('Ocorreu um erro inesperado durante o cadastro.');
  }
};

/**
 * Autentica um usuário com e-mail e senha.
 * @param {string} email - O e-mail do usuário.
 * @param {string} password - A senha do usuário.
 * @param {import('express').Request} req - O objeto da requisição para salvar IP/User-Agent.
 * @returns {Promise<{accessToken: string, refreshToken: string, user: object}>}
 */
const loginUser = async (email, password, req) => {
  const user = await User.findOne({ where: { email } });
  
  if (!user) {
    throw new Error('Credenciais inválidas.');
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new Error('Credenciais inválidas.');
  }

  const { accessToken, refreshToken } = generateTokens(user);
  await saveSession(user.id, refreshToken, req);

  const userToReturn = user.toJSON();
  delete userToReturn.passwordHash;
  
  return { accessToken, refreshToken, user: userToReturn };
};

/**
 * Processa um refresh token para emitir um novo par de tokens.
 * @param {string} refreshTokenFromRequest - O refresh token enviado pelo cliente.
 * @returns {Promise<{accessToken: string, refreshToken: string}>}
 */
const handleRefreshToken = async (refreshTokenFromRequest) => {
  try {
    const decoded = jwt.verify(refreshTokenFromRequest, process.env.JWT_REFRESH_SECRET);

    const sessions = await Session.findAll({ where: { userId: decoded.userId } });
    if (sessions.length === 0) {
      throw new Error('Nenhuma sessão ativa encontrada.');
    }

    let sessionRecord = null;
    for (const session of sessions) {
      const isMatch = await bcrypt.compare(refreshTokenFromRequest, session.refreshTokenHash);
      if (isMatch) {
        sessionRecord = session;
        break;
      }
    }

    if (!sessionRecord) {
      throw new Error('Refresh token inválido ou revogado.');
    }

    await sessionRecord.destroy();

    const user = await User.findByPk(decoded.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new Error('Usuário associado ao token não encontrado ou inativo.');
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    await saveSession(user.id, newRefreshToken, { ip: sessionRecord.ip, headers: { 'user-agent': sessionRecord.userAgent } });

    return { accessToken, refreshToken: newRefreshToken };
  } catch (error) {
    throw new Error('Acesso negado. Sessão inválida.');
  }
};

/**
 * Realiza o logout invalidando o refresh token específico no banco de dados.
 * @param {string} refreshTokenFromRequest - O refresh token a ser invalidado.
 * @param {User} user - O usuário autenticado (do authGuard).
 */
const handleLogout = async (refreshTokenFromRequest, user) => {
  const sessions = await Session.findAll({ where: { userId: user.id } });
  
  for (const session of sessions) {
    const isMatch = await bcrypt.compare(refreshTokenFromRequest, session.refreshTokenHash);
    if (isMatch) {
      await session.destroy();
      return;
    }
  }
};

module.exports = {
  registerUser,
  loginUser,
  handleRefreshToken,
  handleLogout,
};