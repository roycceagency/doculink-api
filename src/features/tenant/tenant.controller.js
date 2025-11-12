// src/features/tenant/tenant.controller.js

const tenantService = require('./tenant.service');

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

const getAllTenants = async (req, res, next) => {
  try {
    const tenants = await tenantService.findAllTenants();
    return res.status(200).json(tenants);
  } catch (error) {
    next(error);
  }
};

const getTenantById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenant = await tenantService.findTenantById(id);
    return res.status(200).json(tenant);
  } catch (error) {
    next(error);
  }
};

const getMyTenant = async (req, res, next) => {
  try {
    // O authGuard já anexa o usuário à requisição.
    // O tenantId está disponível em req.user.tenantId.
    const tenant = await tenantService.findTenantById(req.user.tenantId);
    return res.status(200).json(tenant);
  } catch (error) {
    next(error);
  }
};

const updateTenant = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = req.body; // ex: { name, status }
    const updatedTenant = await tenantService.updateTenantById(id, updateData);
    return res.status(200).json(updatedTenant);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTenant,
  getAllTenants,
  getTenantById,
  getMyTenant,
  updateTenant,
};