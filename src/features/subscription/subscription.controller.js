// src/features/subscription/subscription.controller.js
'use strict';
const { Plan } = require('../../models');


const subscriptionService = require('./subscription.service');

const createSubscription = async (req, res, next) => {
  try {
    const { planSlug, billingType, creditCard, creditCardHolderInfo } = req.body;
    
    if (!planSlug || !billingType) {
        return res.status(400).json({ message: 'Dados incompletos (planSlug e billingType obrigatórios).' });
    }

    const result = await subscriptionService.subscribeToPlan(
        req.user.tenantId,
        planSlug,
        { billingType, creditCard, creditCardHolderInfo }
    );

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

const cancel = async (req, res, next) => {
    try {
        const result = await subscriptionService.cancelSubscription(req.user.tenantId);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

const updatePlan = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, price, userLimit, documentLimit, features } = req.body;
        
        const plan = await Plan.findByPk(id);
        if (!plan) return res.status(404).json({ message: 'Plano não encontrado' });

        await plan.update({
            name, price, userLimit, documentLimit, features
        });

        return res.status(200).json(plan);
    } catch (error) {
        next(error);
    }
};

const listPlans = async (req, res, next) => {
  try {
    const plans = await Plan.findAll({ order: [['price', 'ASC']] });
    res.status(200).json(plans);
  } catch (error) {
    next(error);
  }
};

module.exports = { createSubscription, cancel, updatePlan, listPlans};