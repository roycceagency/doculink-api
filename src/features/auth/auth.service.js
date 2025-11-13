// src/features/auth/auth.service.js
'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, Tenant, Session, sequelize } = require('../../models');

// --- Funções Auxiliares Internas ---

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
    .replace(/[^\w\s-]/g, '') // Remove caracteres especiais
    .replace(/[\s_-]+/g, '-') // Substitui espaços e underscores por hífens
    .replace(/^-+|-+$/g, ''); // Remove hífens do início e do fim
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
 * @param {string} refreshToken - O token de refresh (não o hash).
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

// --- Funções de Serviço Principais (Exportadas) ---

/**
 * Cadastra um novo usuário e um novo Tenant associado.
 * @param {object} userData - Dados do formulário { name, email, password, cpf, phone }.
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
    let slug = generateSlug(`${name}'s Organization`);
    
    const existingTenant = await Tenant.findOne({ where: { slug }, transaction });
    if (existingTenant) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
    }
    
    const newTenant = await Tenant.create({ name: `${name}'s Organization`, slug }, { transaction });

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name,
      email,
      passwordHash,
      cpf,
      phoneWhatsE164: phone,
      tenantId: newTenant.id,
    }, { transaction });

    await transaction.commit();

    const { accessToken, refreshToken } = generateTokens(newUser);
    await saveSession(newUser.id, refreshToken);
    
    const userToReturn = newUser.toJSON();
    delete userToReturn.passwordHash;

    return { accessToken, refreshToken, user: userToReturn };
  } catch (error) {
    await transaction.rollback();
    console.error("Erro na transação de registro:", error); 
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw new Error(`Não foi possível criar a conta. O CPF ou e-mail já está em uso.`);
    }
    throw error;
  }
};

/**
 * Autentica um usuário com e-mail e senha, com verificação de segurança.
 * @param {string} email - O e-mail do usuário.
 * @param {string} password - A senha do usuário.
 * @returns {Promise<{accessToken: string, refreshToken: string, user: object}>}
 */
const loginUser = async (email, password) => {
  const user = await User.findOne({ where: { email } });
  
  // Se o usuário não for encontrado, as credenciais são inválidas.
  if (!user) {
    throw new Error('Credenciais inválidas.');
  }

  // CORREÇÃO: Se o usuário foi criado sem senha, não podemos comparar.
  // Isso protege contra o erro "data and hash arguments required".
  if (!user.passwordHash) {
    console.error(`Tentativa de login para o usuário ${email} que não possui hash de senha no banco de dados.`);
    throw new Error('Credenciais inválidas.');
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new Error('Credenciais inválidas.');
  }

  const { accessToken, refreshToken } = generateTokens(user);
  await saveSession(user.id, refreshToken);

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
    if (!sessions || sessions.length === 0) {
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
    if (!sessionRecord) throw new Error('Refresh token inválido ou revogado.');
    
    await sessionRecord.destroy(); // Rotação de token
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
 * Realiza o logout invalidando o refresh token específico no banco de dados.
 * @param {string} refreshTokenFromRequest - O refresh token a ser invalidado.
 * @param {User} user - O usuário autenticado.
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