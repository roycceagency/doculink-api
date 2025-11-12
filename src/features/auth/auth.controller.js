// src/features/auth/auth.controller.js

const authService = require('./auth.service');

/**
 * Controller para o registro de um novo usuário.
 * Recebe nome, e-mail e senha, e repassa para o serviço de autenticação.
 */
const register = async (req, res, next) => {
  try {
    // --- ATUALIZAÇÃO DA VALIDAÇÃO ---
    const { name, email, password, cpf, phone } = req.body;

    if (!name || !email || !password || !cpf || !phone) {
      return res.status(400).json({ message: 'Todos os campos são obrigatórios: nome, e-mail, senha, CPF e celular.' });
    }
    // --------------------------------

    if (password.length < 6) {
      return res.status(400).json({ message: 'A senha deve ter no mínimo 6 caracteres.' });
    }
    
    // Passa todos os dados para o serviço
    const result = await authService.registerUser({ name, email, password, cpf, phone });

    return res.status(201).json(result);

  } catch (error) {
    // O service já trata os erros de e-mail/cpf duplicado, então o controller apenas repassa.
    // O erro 500 deve ser resolvido, mas um erro 409 (Conflict) pode ser retornado.
    res.status(409).json({ message: error.message });
  }
};

/**
 * Controller para o login do usuário.
 * Recebe e-mail e senha e repassa para o serviço de autenticação.
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validação de entrada
    if (!email || !password) {
      return res.status(400).json({ message: 'E-mail and password are required.' });
    }

    const { accessToken, refreshToken, user } = await authService.loginUser(email, password);

    // Retorna os tokens e os dados do usuário logado
    return res.status(200).json({ accessToken, refreshToken, user });

  } catch (error) {
    next(error);
  }
};

/**
 * Controller para renovar um access token usando um refresh token.
 */
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

/**
 * Controller para realizar o logout, invalidando o refresh token.
 */
const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token é obrigatório.' });
    }
    
    // O req.user é fornecido pelo authGuard, garantindo que o usuário está logado
    await authService.handleLogout(refreshToken, req.user);
    return res.status(200).json({ message: 'Logout realizado com sucesso.' });
  } catch (error) {
    next(error);
  }
};


module.exports = {
  register,
  login,
  refreshToken,
  logout,
};