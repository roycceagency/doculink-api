// src/features/subscription/subscription.service.js
'use strict';

const { Tenant, Plan, User } = require('../../models');
const asaasService = require('../../services/asaas.service');

/**
 * Cria ou recupera o ID do cliente no Asaas para um determinado Tenant.
 */
const ensureAsaasCustomer = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId, {
      include: [{ model: User, as: 'ownerUsers' }]
  });
  
  if (!tenant) throw new Error('Organização não encontrada.');

  if (tenant.asaasCustomerId) {
      return tenant.asaasCustomerId;
  }

  const owner = tenant.ownerUsers && tenant.ownerUsers[0];
  if (!owner) throw new Error('Organização sem proprietário definido para faturamento.');

  // --- VALIDAÇÃO DE DADOS ANTES DA INTEGRAÇÃO ---
  const cpfClean = owner.cpf ? owner.cpf.replace(/\D/g, '') : '';
  
  if (!cpfClean || cpfClean.length !== 11 || /^(\d)\1{10}$/.test(cpfClean)) {
      throw new Error(`O proprietário (${owner.name}) precisa ter um CPF válido cadastrado no perfil para gerar a cobrança. CPF atual: ${owner.cpf || 'Vazio'}`);
  }

  const mobilePhone = owner.phoneWhatsE164 
    ? owner.phoneWhatsE164.replace('55', '') // Remove o 55 se existir, Asaas prefere DDD+Numero
    : undefined;

  const customerData = {
      name: tenant.name,
      email: owner.email,
      cpfCnpj: cpfClean, 
      mobilePhone: mobilePhone, 
      externalReference: tenant.id
  };

  const asaasCustomer = await asaasService.createCustomer(customerData);

  tenant.asaasCustomerId = asaasCustomer.id;
  await tenant.save();

  return asaasCustomer.id;
};

/**
 * Assina um plano.
 */
const subscribeToPlan = async (tenantId, planSlug, paymentData) => {
    const plan = await Plan.findOne({ where: { slug: planSlug } });
    if (!plan) throw new Error('Plano não encontrado.');
    
    if (plan.price <= 0) throw new Error('Planos gratuitos não exigem assinatura via Asaas.');

    // Garante Cliente
    const customerId = await ensureAsaasCustomer(tenantId);

    const subscriptionData = {
        customerId,
        billingType: paymentData.billingType,
        value: parseFloat(plan.price),
        nextDueDate: new Date().toISOString().split('T')[0],
        cycle: 'MONTHLY',
        description: `Assinatura Doculink - Plano ${plan.name}`,
        externalReference: tenantId,
        ...paymentData
    };

    const asaasSubscription = await asaasService.createSubscription(subscriptionData);

    const tenant = await Tenant.findByPk(tenantId);
    tenant.planId = plan.id;
    tenant.asaasSubscriptionId = asaasSubscription.id;
    tenant.subscriptionStatus = 'PENDING'; 
    await tenant.save();

    let pixInfo = null;
    if (paymentData.billingType === 'PIX') {
        const paymentsList = await asaasService.listSubscriptionPayments(asaasSubscription.id);
        const firstPayment = paymentsList.data && paymentsList.data[0];
        
        if (firstPayment) {
            pixInfo = await asaasService.getPixQrCode(firstPayment.id);
            pixInfo.dueDate = firstPayment.dueDate;
            pixInfo.value = firstPayment.value;
        }
    }

    return {
        subscriptionId: asaasSubscription.id,
        status: asaasSubscription.status,
        pixInfo
    };
};

const cancelSubscription = async (tenantId) => {
    const tenant = await Tenant.findByPk(tenantId);
    if (!tenant.asaasSubscriptionId) throw new Error('Nenhuma assinatura ativa encontrada.');

    await asaasService.cancelSubscription(tenant.asaasSubscriptionId);
    
    tenant.subscriptionStatus = 'CANCELED';
    const freePlan = await Plan.findOne({ where: { slug: 'basico' } });
    if (freePlan) tenant.planId = freePlan.id;
    
    await tenant.save();
    return { message: 'Assinatura cancelada.' };
};

module.exports = {
    ensureAsaasCustomer,
    subscribeToPlan,
    cancelSubscription
};