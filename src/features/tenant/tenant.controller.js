// src/features/tenant/tenant.controller.js
'use strict';

const tenantService = require('./tenant.service');

// --- OPERAÇÕES DE SUPER ADMIN ---

/**
 * Cria um novo Tenant e o usuário admin inicial.
 * Acesso: Super Admin.
 */
const createTenant = async (req, res, next) => {
  try {
    const { name, adminUser } = req.body;
    if (!name || !adminUser || !adminUser.name || !adminUser.email) {
      return res.status(400).json({ message: 'Nome do tenant e dados do usuário administrador são obrigatórios.' });
    }
    const tenant = await tenantService.createTenantWithAdmin(name, adminUser);
    return res.status(201).json(tenant);
  } catch (error) {
    next(error);
  }
};

/**
 * Lista todos os Tenants da plataforma.
 * Acesso: Super Admin.
 */
const getAllTenants = async (req, res, next) => {
  try {
    const tenants = await tenantService.findAllTenants();
    return res.status(200).json(tenants);
  } catch (error) {
    next(error);
  }
};

/**
 * Obtém detalhes de um Tenant por ID.
 * Acesso: Super Admin.
 */
const getTenantById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenant = await tenantService.findTenantById(id);
    return res.status(200).json(tenant);
  } catch (error) {
    next(error);
  }
};

/**
 * Atualiza dados de um Tenant.
 * Acesso: Super Admin.
 */
const updateTenant = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = req.body; // ex: { name, status, planId }
    const updatedTenant = await tenantService.updateTenantById(id, updateData);
    return res.status(200).json(updatedTenant);
  } catch (error) {
    next(error);
  }
};

// --- OPERAÇÕES DE CONTEXTO DO USUÁRIO ---

/**
 * Obtém detalhes do Tenant atual do contexto do token do usuário.
 * Inclui informações de plano e uso.
 * Acesso: Usuário Autenticado.
 */
const getMyTenant = async (req, res, next) => {
  try {
    // O req.user.tenantId agora reflete o token (perfil selecionado),
    // graças à correção no authGuard.
    const tenant = await tenantService.findTenantById(req.user.tenantId);
    
    return res.status(200).json(tenant);
  } catch (error) {
    next(error);
  }
};
/**
 * Lista todos os Tenants disponíveis para o usuário trocar de perfil.
 * Inclui o tenant pessoal (dono) e tenants onde foi convidado (membro).
 * Acesso: Usuário Autenticado.
 */
const getAvailableTenants = async (req, res, next) => {
  try {
    const list = await tenantService.listMyTenants(req.user.id);
    res.status(200).json(list);
  } catch (error) {
    next(error);
  }
};

// --- OPERAÇÕES DE CONVITE E MEMBROS ---

/**
 * Convida um novo usuário (por e-mail) para o Tenant atual.
 * Acesso: Admin do Tenant.
 */
const inviteUser = async (req, res, next) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ message: 'Email é obrigatório.' });
    
    // Usa o tenantId do contexto atual do usuário
    const invite = await tenantService.inviteMember(req.user.tenantId, email, role);
    res.status(201).json({ message: 'Convite enviado com sucesso.', invite });
  } catch (error) {
    next(error);
  }
};

/**
 * Lista convites pendentes que o usuário recebeu (para aceitar/recusar).
 * Acesso: Usuário Autenticado.
 */
const getInvites = async (req, res, next) => {
  try {
    const invites = await tenantService.listPendingInvites(req.user.id, req.user.email);
    res.status(200).json(invites);
  } catch (error) {
    next(error);
  }
};

/**
 * Aceita ou recusa um convite de participação em um Tenant.
 * Acesso: Usuário Autenticado (Dono do convite).
 */
const respondInvite = async (req, res, next) => {
  try {
    const { id } = req.params; // ID do TenantMember (Convite)
    const { accept } = req.body; // true ou false
    
    if (accept === undefined) {
         return res.status(400).json({ message: 'A propriedade "accept" (boolean) é obrigatória.' });
    }

    await tenantService.respondToInvite(req.user.id, id, accept);
    res.status(200).json({ message: accept ? 'Convite aceito!' : 'Convite recusado.' });
  } catch (error) {
    next(error);
  }
};

const getSentInvites = async (req, res, next) => {
  try {
    // req.user.tenantId vem do token
    const invites = await tenantService.listSentInvites(req.user.tenantId);
    res.status(200).json(invites);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenant,
  getMyTenant,
  getAvailableTenants,
  inviteUser,
  getInvites,
  respondInvite,
  getSentInvites
};