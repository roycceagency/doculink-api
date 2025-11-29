// src/features/auth/auth.controller.js
'use strict';

const authService = require('./auth.service');

const register = async (req, res, next) => {
  try {
    const result = await authService.registerUser(req.body, { 
        ip: req.ip, 
        userAgent: req.headers['user-agent'] 
    });
    return res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const result = await authService.loginUser(req.body.email, req.body.password, {
        ip: req.ip, 
        userAgent: req.headers['user-agent']
    });
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    const tokens = await authService.handleRefreshToken(req.body.refreshToken);
    return res.status(200).json(tokens);
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    await authService.handleLogout(req.body.refreshToken, req.user);
    return res.status(200).json({ message: 'Logout realizado.' });
  } catch (error) {
    next(error);
  }
};

// --- NOVO ENDPOINT ---
const switchTenant = async (req, res, next) => {
  try {
    const { targetTenantId } = req.body;
    if (!targetTenantId) return res.status(400).json({ message: 'Tenant ID é obrigatório.' });

    const result = await authService.switchTenantContext(req.user.id, targetTenantId, {
        ip: req.ip, 
        userAgent: req.headers['user-agent']
    });
    
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email, channel } = req.body; // Pega o channel (EMAIL ou WHATSAPP)
    await authService.requestPasswordReset(email, channel);
    res.status(200).json({ message: 'Código enviado com sucesso (se os dados conferirem).' });
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    await authService.resetPassword(email, otp, newPassword);
    res.status(200).json({ message: 'Senha redefinida com sucesso.' });
  } catch (error) {
    next(error);
  }
};

module.exports = { register, login, refreshToken, logout, switchTenant, resetPassword, forgotPassword };