// src/features/auth/auth.service.js
'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, Tenant, Session, sequelize } = require('../../models');

// --- Funções Auxiliares Internas ---

/**
 * Gera um 'slug' seguro para URL a partir de um nome.
 */
const generateSlug = (name) => {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
};

/**
 * Gera um par de tokens (access e refresh) para um usuário.
 */
const generateTokens = (user) => {
  const accessToken = jwt.sign({ userId: user.id, tenantId: user.tenantId }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
};

/**
 * Salva a sessão do refresh token no banco de dados.
 */
const saveSession = async (userId, refreshToken) => {
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await Session.create({ userId, refreshTokenHash, expiresAt });
};

// --- Funções de Serviço Principais (Exportadas) ---

/**
 * Cadastra um novo usuário e seu Tenant associado.
 */
const registerUser = async (userData) => {
  const { name, email, password, cpf, phone } = userData;

  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new Error('A senha é inválida ou muito curta (mínimo 6 caracteres).');
  }

  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new Error('Este e-mail já está em uso.');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    console.log(`[DEBUG] Gerando hash para o usuário ${email}:`, passwordHash); // <-- LOG DE DEBUG

    // Criação do Tenant primeiro, fora da transação
    let slug = generateSlug(`${name}'s Organization`);
    const newTenant = await Tenant.create({ name: `${name}'s Organization`, slug });

    // Agora, a criação do usuário
    const newUser = await User.create({
      name,
      email,
      passwordHash, // Passando o hash
      cpf,
      phoneWhatsE164: phone,
      tenantId: newTenant.id,
    });
    
    console.log('[DEBUG] Objeto newUser criado:', newUser.toJSON()); // <-- LOG DE DEBUG

    const { accessToken, refreshToken } = generateTokens(newUser);
    await saveSession(newUser.id, refreshToken);
    
    const userToReturn = newUser.toJSON();
    delete userToReturn.passwordHash;

    return { accessToken, refreshToken, user: userToReturn };
  } catch (error) {
    console.error("ERRO DETALHADO NO REGISTRO:", error);
    throw error;
  }
};

/**
 * Autentica um usuário com e-mail e senha.
 */
const loginUser = async (email, password) => {
  // Validação reforçada para a senha
  if (!password || typeof password !== 'string') {
    throw new Error('Credenciais inválidas.');
  }

  const user = await User.findOne({ where: { email } });
  
  if (!user || !user.passwordHash) {
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
 */
const handleRefreshToken = async (refreshTokenFromRequest) => {
  try {
    const decoded = jwt.verify(refreshTokenFromRequest, process.env.JWT_REFRESH_SECRET);
    const sessions = await Session.findAll({ where: { userId: decoded.userId } });
    if (!sessions || sessions.length === 0) throw new Error('Nenhuma sessão ativa encontrada.');
    
    let sessionRecord = null;
    for (const session of sessions) {
        if (await bcrypt.compare(refreshTokenFromRequest, session.refreshTokenHash)) {
            sessionRecord = session;
            break;
        }
    }
    if (!sessionRecord) throw new Error('Refresh token inválido ou revogado.');
    
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
 * Realiza o logout invalidando o refresh token.
 */
const handleLogout = async (refreshTokenFromRequest, user) => {
  const sessions = await Session.findAll({ where: { userId: user.id } });
  for (const session of sessions) {
      if (await bcrypt.compare(refreshTokenFromRequest, session.refreshTokenHash)) {
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