// src/features/auth/auth.controller.js

const authService = require('./auth.service');

const startLogin = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'O e-mail é obrigatório.' });
    }

    await authService.startEmailLogin(email);

    // Por segurança, sempre retorne uma mensagem genérica para não revelar
    // se um e-mail está ou não cadastrado no sistema (evita enumeração de usuários).
    return res.status(200).json({
      message: 'Se o e-mail estiver cadastrado, um código de verificação foi enviado.'
    });

  } catch (error) {
    next(error); // Passa o erro para o handler de erros global
  }
};

const verifyLogin = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ message: 'E-mail e código OTP são obrigatórios.' });
    }

    // O serviço retornará os tokens se a verificação for bem-sucedida
    const { accessToken, refreshToken } = await authService.verifyEmailOtp(email, otp);

    return res.status(200).json({ accessToken, refreshToken });

  } catch (error) {
    // O serviço vai lançar um erro que será capturado aqui
    // Ex: código inválido, expirado, etc.
    next(error);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token é obrigatório.' });
    }

    const tokens = await authService.handleRefreshToken(refreshToken);
    return res.status(200).json(tokens);
  } catch (error) {
    // Erros de token inválido ou expirado serão tratados aqui
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token é obrigatório.' });
    }
    
    // O req.user é fornecido pelo authGuard
    await authService.handleLogout(refreshToken, req.user);
    return res.status(200).json({ message: 'Logout realizado com sucesso.' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  startLogin,
  verifyLogin,
  refreshToken,
  logout,
};