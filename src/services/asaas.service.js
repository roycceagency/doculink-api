// src/services/asaas.service.js
'use strict';

const axios = require('axios');

class AsaasService {
  constructor() {
    this.api = axios.create({
      baseURL: process.env.ASAAS_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        'access_token': process.env.ASAAS_API_KEY
      }
    });
  }

  // --- HELPER PARA FORMATAR ERRO ---
  _formatError(error, context) {
    // Tenta pegar a mensagem de erro mais específica possível
    const responseData = error.response?.data;
    let details = error.message;

    if (responseData) {
        if (responseData.errors && Array.isArray(responseData.errors)) {
            // Formato padrão Asaas: { errors: [{ code, description }] }
            details = responseData.errors.map(e => e.description).join(' | ');
        } else if (typeof responseData === 'string') {
            // Erros brutos (ex: HTML de erro 500)
            details = responseData;
        } else {
            // Outros objetos JSON
            details = JSON.stringify(responseData);
        }
    }

    console.error(`[Asaas] Falha em ${context}:`, details);
    return new Error(`Asaas ${context}: ${details}`);
  }

  // --- GESTÃO DE CLIENTES ---

  async createCustomer(customerData) {
    try {
      const response = await this.api.post('/customers', {
        name: customerData.name,
        email: customerData.email,
        cpfCnpj: customerData.cpfCnpj,
        phone: customerData.phone,
        mobilePhone: customerData.mobilePhone,
        postalCode: customerData.postalCode,
        address: customerData.address,
        addressNumber: customerData.addressNumber,
        notificationDisabled: false
      });
      return response.data;
    } catch (error) {
      throw this._formatError(error, 'Criar Cliente');
    }
  }

  async getCustomer(customerId) {
    try {
      const response = await this.api.get(`/customers/${customerId}`);
      return response.data;
    } catch (error) {
       if (error.response && error.response.status === 404) return null;
       throw this._formatError(error, 'Buscar Cliente');
    }
  }

  // --- ASSINATURAS ---

  async createSubscription(subscriptionData) {
    try {
      const payload = {
        customer: subscriptionData.customerId,
        billingType: subscriptionData.billingType,
        value: subscriptionData.value,
        nextDueDate: subscriptionData.nextDueDate,
        cycle: subscriptionData.cycle || 'MONTHLY',
        description: subscriptionData.description,
        externalReference: subscriptionData.externalReference
      };

      if (subscriptionData.billingType === 'CREDIT_CARD' && subscriptionData.creditCard) {
        payload.creditCard = subscriptionData.creditCard;
        payload.creditCardHolderInfo = subscriptionData.creditCardHolderInfo;
      }

      if (subscriptionData.billingType === 'CREDIT_CARD' && subscriptionData.creditCardToken) {
          payload.creditCardToken = subscriptionData.creditCardToken;
      }

      const response = await this.api.post('/subscriptions', payload);
      return response.data;
    } catch (error) {
      throw this._formatError(error, 'Criar Assinatura');
    }
  }

  async getSubscription(subscriptionId) {
    try {
        const response = await this.api.get(`/subscriptions/${subscriptionId}`);
        return response.data;
    } catch (error) {
        throw this._formatError(error, 'Buscar Assinatura');
    }
  }

  async cancelSubscription(subscriptionId) {
      try {
        const response = await this.api.delete(`/subscriptions/${subscriptionId}`);
        return response.data;
      } catch (error) {
        throw this._formatError(error, 'Cancelar Assinatura');
      }
  }

  // --- COBRANÇAS E PIX ---

  async listSubscriptionPayments(subscriptionId) {
    try {
        const response = await this.api.get('/payments', {
        params: { subscription: subscriptionId }
        });
        return response.data;
    } catch (error) {
        throw this._formatError(error, 'Listar Pagamentos');
    }
  }

  async getPixQrCode(paymentId) {
    try {
        const response = await this.api.get(`/payments/${paymentId}/pixQrCode`);
        return response.data;
    } catch (error) {
        throw this._formatError(error, 'Gerar PIX');
    }
  }
}

module.exports = new AsaasService();