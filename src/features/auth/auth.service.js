// src/features/auth/auth.service.js

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { User, OtpCode, Session } = require('../../models');

// Em um projeto real, esta função estaria em um serviço de notificação separado
// para manter a organização, mas a incluímos aqui para manter o arquivo autocontido.
const sendEmail = async ({ to, subject, text }) => {
  console.log('--- SIMULANDO ENVIO DE E-MAIL ---');
  console.log(`Para: ${to}`);
  console.log(`Assunto: ${subject}`);
  console.log(`Corpo: ${text}`);
  console.log('---------------------------------');
  // Em uma implementação real, você usaria o Resend ou Nodemailer aqui.
  return Promise.resolve();
};


/**
 * Inicia o processo de login sem senha enviando um código OTP para o e-mail do usuário.
 * @param {string} email - O e-mail do usuário que está tentando fazer login.
 */
const startEmailLogin = async (email) => {
  const user = await User.findOne({ where: { email } });

  // Por segurança, não retorna erro se o usuário não existe.
  // Isso evita que um atacante possa "enumerar" quais e-mails estão cadastrados.
  if (!user || user.status !== 'ACTIVE') {
    return;
  }

  // Gera um código numérico de 6 dígitos seguro.
  const otp = crypto.randomInt(100000, 999999).toString();
  const codeHash = await bcrypt.hash(otp, 10);

  // Define a expiração do código para 10 minutos a partir de agora.
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // Cria o registro do OTP no banco de dados.
  await OtpCode.create({
    recipient: email,
    channel: 'EMAIL',
    codeHash,
    expiresAt,
    context: 'LOGIN'
  });

  // Envia o e-mail para o usuário com o código em texto plano.
  await sendEmail({
    to: email,
    subject: 'Seu código de acesso Doculink',
    text: `Olá ${user.name}, seu código de acesso é: ${otp}. Ele é válido por 10 minutos.`
  });
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
    { expiresIn: '15m' } // Vida curta para segurança
  );

  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' } // Vida longa para conveniência
  );

  return { accessToken, refreshToken };
};


/**
 * Salva a sessão do refresh token no banco de dados, incluindo IP e User-Agent para auditoria.
 * @param {string} userId - ID do usuário.
 * @param {string} refreshToken - O token de refresh (não o hash).
 * @param {string} ip - Endereço IP da requisição.
 * @param {string} userAgent - User-Agent do cliente.
 */
const saveSession = async (userId, refreshToken, ip, userAgent) => {
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

  await Session.create({
    userId,
    refreshTokenHash,
    expiresAt,
    ip,
    userAgent,
  });
};


/**
 * Verifica o código OTP, e se for válido, completa o login gerando tokens e criando uma sessão.
 * @param {string} email - O e-mail do usuário.
 * @param {string} otp - O código OTP de 6 dígitos.
 * @param {import('express').Request} req - O objeto da requisição para obter IP e User-Agent.
 * @returns {Promise<{accessToken: string, refreshToken: string}>}
 */
const verifyEmailOtp = async (email, otp, req) => {
  const user = await User.findOne({ where: { email, status: 'ACTIVE' } });
  if (!user) {
    throw new Error('Credenciais inválidas.');
  }

  const otpRecord = await OtpCode.findOne({
    where: { recipient: email, context: 'LOGIN' },
    order: [['createdAt', 'DESC']]
  });

  if (!otpRecord) {
    throw new Error('Código OTP inválido ou não encontrado.');
  }
  if (new Date() > new Date(otpRecord.expiresAt)) {
    throw new Error('Código OTP expirado.');
  }

  const isMatch = await bcrypt.compare(otp, otpRecord.codeHash);
  if (!isMatch) {
    throw new Error('Código OTP inválido.');
  }

  // OTP validado com sucesso, remove para não ser reutilizado.
  await otpRecord.destroy();

  // Gera os tokens de acesso e refresh.
  const { accessToken, refreshToken } = generateTokens(user);

  // Cria a sessão no banco de dados.
  await saveSession(user.id, refreshToken, req.ip, req.headers['user-agent']);

  return { accessToken, refreshToken };
};


/**
 * Processa um refresh token para emitir um novo par de tokens.
 * Implementa a rotação de tokens para maior segurança.
 * @param {string} refreshTokenFromRequest - O refresh token enviado pelo cliente.
 * @returns {Promise<{accessToken: string, refreshToken: string}>}
 */
const handleRefreshToken = async (refreshTokenFromRequest) => {
  try {
    const decoded = jwt.verify(refreshTokenFromRequest, process.env.JWT_REFRESH_SECRET);

    const sessions = await Session.findAll({ where: { userId: decoded.userId } });
    if (sessions.length === 0) {
      throw new Error('Nenhuma sessão ativa encontrada para este usuário.');
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
      throw new Error('Refresh token inválido ou já revogado.');
    }

    // ROTAÇÃO DE TOKEN: a sessão antiga é destruída.
    await sessionRecord.destroy();

    const user = await User.findByPk(decoded.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new Error('Usuário associado ao token não encontrado ou inativo.');
    }

    // Gera um NOVO par de tokens.
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    
    // Salva a NOVA sessão com o novo refresh token.
    await saveSession(user.id, newRefreshToken, sessionRecord.ip, sessionRecord.userAgent);

    return { accessToken, refreshToken: newRefreshToken };
  } catch (error) {
    // Captura erros de JWT (expirado, malformado) ou erros de lógica acima.
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
      return; // Sessão encontrada e destruída.
    }
  }
  // Se o token não for encontrado, não há necessidade de lançar um erro.
  // O objetivo (a sessão não existir mais) já foi cumprido.
};


module.exports = {
  startEmailLogin,
  verifyEmailOtp,
  handleRefreshToken,
  handleLogout,
};