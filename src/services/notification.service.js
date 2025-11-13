// src/services/notification.service.js
'use strict';

const axios = require('axios');
const { Resend } = require('resend');

// --- Configuração dos Clientes de API ---

// 1. Cliente Resend (para e-mails)
const resend = new Resend(process.env.RESEND_API_KEY);

// 2. Cliente Axios para a Z-API (sem Client-Token)
const zapiClient = axios.create({
  baseURL: `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`,
  headers: {
    'Content-Type': 'application/json',
    // O cabeçalho 'Client-Token' foi completamente removido.
  }
});


// --- Funções Auxiliares ---

/**
 * Formata um número de telefone para o padrão E.164 (DDI+DDD+Número).
 * @param {string} phone - O número de telefone com máscara (ex: "(71) 98314-1335").
 * @returns {string} - O número formatado (ex: "5571983141335").
 */
const formatPhoneNumber = (phone) => {
  if (!phone) return null;
  const digitsOnly = phone.replace(/\D/g, '');
  // Adiciona o DDI do Brasil (55) se o número tiver 11 ou 10 dígitos (DDD + número).
  if (digitsOnly.length <= 11) {
    return `55${digitsOnly}`;
  }
  return digitsOnly;
};


// --- Funções de Envio Reais ---

/**
 * Envia um e-mail usando a API do Resend.
 */
const sendEmail = async ({ to, subject, html }) => {
  try {
    const from = process.env.RESEND_FROM_EMAIL;
    if (!from) {
        console.error('[Resend] Variável RESEND_FROM_EMAIL não está configurada no .env');
        return;
    }
    await resend.emails.send({ from, to, subject, html });
    console.log(`[Resend] E-mail enviado com sucesso para: ${to}`);
  } catch (error) {
    console.error(`[Resend] Erro ao enviar e-mail para ${to}:`, error.response?.data || error.message);
  }
};

/**
 * Envia uma mensagem de texto via WhatsApp usando a Z-API.
 */
const sendWhatsAppText = async ({ phone, message }) => {
  const formattedPhone = formatPhoneNumber(phone);
  if (!formattedPhone) {
    console.error('[Z-API] Tentativa de envio para um número de telefone nulo ou inválido.');
    return;
  }

  try {
    console.log(`[Z-API] Enviando mensagem para ${formattedPhone}...`);
    const response = await zapiClient.post('/send-text', {
      phone: formattedPhone,
      message: message
    });
    console.log(`[Z-API] Mensagem enviada com sucesso! Z-API ID: ${response.data.zaapId}`);
  } catch (error) {
    console.error(`[Z-API] Erro ao enviar mensagem para ${formattedPhone}:`, error.response?.data || error.message);
  }
};


// --- Funções de Negócio (Exportadas para o resto da aplicação) ---

/**
 * Envia o convite de assinatura para o signatário por e-mail e/ou WhatsApp.
 */
const sendSignInvite = async (signer, token) => {
  const inviteLink = `${process.env.FRONT_URL}/sign/${token}`;
  
  // Envia o e-mail de convite
  if (signer.email) {
    await sendEmail({
      to: signer.email,
      subject: 'Você foi convidado para assinar um documento',
      html: `Olá ${signer.name},<br><br>Por favor, acesse o link abaixo para visualizar e assinar o documento:<br><a href="${inviteLink}">${inviteLink}</a>`
    });
  }

  // Se o signatário tiver WhatsApp, envia também
  if (signer.phoneWhatsE164) {
    await sendWhatsAppText({
      phone: signer.phoneWhatsE164,
      message: `Olá ${signer.name}, você foi convidado para assinar um documento no Doculink. Acesse o link: ${inviteLink}`
    });
  }
};

/**
 * Envia o código OTP (One-Time Password) para o canal especificado.
 */
const sendOtp = async (recipient, channel, otp) => {
  if (channel === 'EMAIL') {
    await sendEmail({
      to: recipient,
      subject: 'Seu código de verificação Doculink',
      html: `Seu código de verificação é: <strong>${otp}</strong>.<br>Ele é válido por 10 minutos.`
    });
  }
  
  if (channel === 'WHATSAPP') {
    await sendWhatsAppText({
      phone: recipient,
      message: `Seu código de verificação Doculink é: *${otp}*. Ele expira em 10 minutos.`
    });
  }
};

module.exports = {
  sendSignInvite,
  sendOtp
};