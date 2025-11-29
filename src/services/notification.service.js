// src/services/notification.service.js
'use strict';

const axios = require('axios');
const { Resend } = require('resend');
const { TenantSettings } = require('../models'); // Importa o modelo para configurações whitelabel

// --- FUNÇÕES AUXILIARES ---

/**
 * Formata um número de telefone para o padrão E.164 (apenas números).
 * Remove caracteres não numéricos e adiciona o 55 (Brasil) se necessário.
 * @param {string} phone - O número de telefone (ex: "(71) 98888-7777").
 * @returns {string|null} - O número formatado (ex: "5571988887777") ou null.
 */
const formatPhoneNumber = (phone) => {
  if (!phone) return null;
  const digitsOnly = phone.replace(/\D/g, '');
  
  // Lógica específica para BR: Se tiver 10 ou 11 dígitos, assume que falta o DDI 55
  if (digitsOnly.length >= 10 && digitsOnly.length <= 11) {
    return `55${digitsOnly}`;
  }
  // Se já tiver 12 ou 13 (ex: 55...), retorna como está
  return digitsOnly;
};

/**
 * Obtém as credenciais de envio (Whitelabel).
 * Prioriza as configurações do banco de dados do Tenant.
 * Se não encontrar ou estiver inativo, usa as variáveis de ambiente (.env).
 * 
 * @param {string} tenantId - ID do tenant que está disparando a ação.
 */
const getCredentials = async (tenantId) => {
  let settings = null;
  
  if (tenantId) {
    try {
      settings = await TenantSettings.findOne({ where: { tenantId } });
    } catch (error) {
      console.error(`[Notification] Erro ao buscar configurações do tenant ${tenantId}:`, error.message);
    }
  }

  // Lógica de Fallback: Banco de Dados -> Variáveis de Ambiente
  return {
    // Email (Resend)
    resendApiKey: (settings?.resendActive && settings?.resendApiKey) 
      ? settings.resendApiKey 
      : process.env.RESEND_API_KEY,
    
    // O remetente deve ser um domínio verificado no painel do Resend.
    // Para testes gratuitos, use 'onboarding@resend.dev'
    resendFrom: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',

    // WhatsApp (Z-API)
    zapiInstance: (settings?.zapiActive && settings?.zapiInstanceId) 
      ? settings.zapiInstanceId 
      : process.env.ZAPI_INSTANCE_ID,
      
    zapiToken: (settings?.zapiActive && settings?.zapiToken) 
      ? settings.zapiToken 
      : process.env.ZAPI_TOKEN,
      
    zapiClientToken: (settings?.zapiActive && settings?.zapiClientToken) 
      ? settings.zapiClientToken 
      : process.env.ZAPI_CLIENT_TOKEN,
  };
};

// --- FUNÇÕES DE ENVIO (CORE - EXPORTADAS) ---

/**
 * Envia um e-mail genérico utilizando a API do Resend.
 * Esta função é usada tanto para convites quanto para notificações de conclusão.
 */
const sendEmail = async (tenantId, { to, subject, html }) => {
  try {
    const creds = await getCredentials(tenantId);

    if (!creds.resendApiKey) {
      console.warn(`[Resend] AVISO: Nenhuma chave de API configurada (Tenant: ${tenantId || 'Global'}). Email para ${to} ignorado.`);
      return;
    }

    // Instancia o cliente Resend com a chave específica
    const resendClient = new Resend(creds.resendApiKey);

    const { data, error } = await resendClient.emails.send({
      from: creds.resendFrom,
      to,
      subject,
      html
    });

    if (error) {
        console.error(`[Resend] ERRO API ao enviar para ${to}:`, error);
        return;
    }

    console.log(`[Resend] E-mail enviado com sucesso para ${to}. ID: ${data?.id} (Tenant: ${tenantId || 'Global'})`);
  } catch (error) {
    console.error(`[Resend] FALHA CRÍTICA ao enviar para ${to}:`, error.message);
  }
};

/**
 * Envia uma mensagem de texto via WhatsApp (Z-API).
 * Esta função é usada para OTPs, convites e notificações.
 */
const sendWhatsAppText = async (tenantId, { phone, message }) => {
  const formattedPhone = formatPhoneNumber(phone);
  if (!formattedPhone) {
    console.warn('[Z-API] Número de telefone inválido ou vazio. Ignorando envio.');
    return;
  }

  try {
    const creds = await getCredentials(tenantId);

    if (!creds.zapiInstance || !creds.zapiToken) {
      console.warn(`[Z-API] AVISO: Credenciais incompletas (Tenant: ${tenantId || 'Global'}). WhatsApp ignorado.`);
      return;
    }

    // Constrói a URL dinâmica baseada na instância
    const url = `https://api.z-api.io/instances/${creds.zapiInstance}/token/${creds.zapiToken}/send-text`;

    const response = await axios.post(
      url, 
      {
        phone: formattedPhone,
        message: message
      }, 
      {
        headers: {
          'Content-Type': 'application/json',
          'Client-Token': creds.zapiClientToken
        }
      }
    );

    // Log de sucesso ou erro lógico da API
    if (response.data && response.data.error) {
        console.error(`[Z-API] ERRO RETORNADO PELA API para ${formattedPhone}:`, response.data);
    } else {
        console.log(`[Z-API] WhatsApp enviado para ${formattedPhone} (Tenant: ${tenantId || 'Global'}). MsgId: ${response.data.messageId}`);
    }

  } catch (error) {
    if (error.response) {
        console.error(`[Z-API] ERRO HTTP ${error.response.status} para ${formattedPhone}:`, error.response.data);
    } else {
        console.error(`[Z-API] FALHA DE REDE para ${formattedPhone}:`, error.message);
    }
  }
};


// --- FUNÇÕES DE NEGÓCIO (PÚBLICAS) ---

/**
 * Envia o convite de assinatura para os canais configurados no signatário.
 * Constrói a mensagem padrão e chama os métodos de envio core.
 * 
 * @param {object} signer - Objeto do signatário.
 * @param {string} token - O token único para o link.
 * @param {string} [customMessage] - Mensagem personalizada opcional.
 * @param {string} tenantId - ID do Tenant.
 */
const sendSignInvite = async (signer, token, customMessage, tenantId) => {
  // URL do Frontend
  const inviteLink = `${process.env.FRONT_URL}/sign/${token}`;
  
  // Mensagem Texto (WhatsApp/SMS)
  const defaultMessageText = `Olá ${signer.name}, você foi convidado para assinar um documento.\n\nAcesse o link: ${inviteLink}`;
  const messageText = customMessage 
    ? `${customMessage}\n\nAcesse para assinar: ${inviteLink}` 
    : defaultMessageText;

  // Mensagem HTML (Email)
  const defaultMessageHtml = `
    <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
      <h2>Olá, ${signer.name}</h2>
      <p>Você foi convidado para assinar um documento digitalmente.</p>
      <p style="margin: 30px 0;">
        <a href="${inviteLink}" style="background-color: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
          Acessar Documento
        </a>
      </p>
      <p><small style="color: #666;">Ou copie e cole no navegador: ${inviteLink}</small></p>
    </div>
  `;
  
  const messageHtml = customMessage 
    ? `<div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
         <h2>Convite para Assinatura</h2>
         <p>${customMessage.replace(/\n/g, '<br>')}</p>
         <p style="margin: 30px 0;">
           <a href="${inviteLink}" style="background-color: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
             Acessar Documento
           </a>
         </p>
         <p><small style="color: #666;">Link seguro: ${inviteLink}</small></p>
       </div>`
    : defaultMessageHtml;

  const channels = Array.isArray(signer.authChannels) ? signer.authChannels : ['EMAIL']; // Default para Email se vazio

  console.log(`[Notification] Disparando convite para ${signer.name} (Canais: ${channels.join(', ')})`);

  const promises = [];

  if (channels.includes('EMAIL') && signer.email) {
    promises.push(sendEmail(tenantId, {
      to: signer.email,
      subject: 'Convite para assinatura de documento',
      html: messageHtml
    }));
  }

  if (channels.includes('WHATSAPP') && signer.phoneWhatsE164) {
    promises.push(sendWhatsAppText(tenantId, {
      phone: signer.phoneWhatsE164,
      message: messageText
    }));
  }

  await Promise.all(promises);
};

/**
 * Envia o código OTP para validação de identidade.
 * 
 * @param {string} recipient - Email ou Telefone destino.
 * @param {string} channel - 'EMAIL' ou 'WHATSAPP'.
 * @param {string} otp - O código de 6 dígitos.
 * @param {string} tenantId - ID do Tenant.
 */
const sendOtp = async (recipient, channel, otp, tenantId) => {
  if (channel === 'EMAIL') {
    await sendEmail(tenantId, {
      to: recipient,
      subject: 'Seu código de verificação',
      html: `
        <div style="font-family: sans-serif; text-align: center; padding: 20px;">
          <h3>Código de Segurança</h3>
          <p>Seu código de verificação é:</p>
          <h1 style="letter-spacing: 8px; color: #333; background-color: #f3f4f6; padding: 10px; border-radius: 8px; display: inline-block;">${otp}</h1>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">Este código expira em 10 minutos. Não compartilhe com ninguém.</p>
        </div>
      `
    });
  } else if (channel === 'WHATSAPP') {
    await sendWhatsAppText(tenantId, {
      phone: recipient,
      message: `Seu código de verificação Doculink é: *${otp}*.\n\nVálido por 10 minutos. Não compartilhe este código.`
    });
  }
};

const sendForgotPasswordEmail = async (email, otp, tenantId) => {
  await sendEmail(tenantId, {
    to: email,
    subject: 'Recuperação de Senha - Doculink',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1c4ed8;">Redefinição de Senha</h2>
        <p>Recebemos uma solicitação para redefinir a senha da sua conta.</p>
        <p>Use o código abaixo para prosseguir:</p>
        <div style="background: #f3f4f6; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">${otp}</span>
        </div>
        <p>Se você não solicitou isso, ignore este e-mail.</p>
      </div>
    `
  });
};

const sendForgotPasswordNotification = async (user, otp, channel) => {
  const tenantId = user.tenantId;

  if (channel === 'EMAIL') {
    await sendEmail(tenantId, {
      to: user.email,
      subject: 'Recuperação de Senha - Doculink',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1c4ed8;">Redefinição de Senha</h2>
          <p>Olá, ${user.name}. Recebemos uma solicitação para redefinir sua senha.</p>
          <p>Seu código de verificação é:</p>
          <div style="background: #f3f4f6; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">${otp}</span>
          </div>
          <p>Se não foi você, ignore este e-mail.</p>
        </div>
      `
    });
  } else if (channel === 'WHATSAPP') {
    await sendWhatsAppText(tenantId, {
      phone: user.phoneWhatsE164,
      message: `Doculink: Olá ${user.name}, seu código para redefinir a senha é *${otp}*.\n\nNão compartilhe este código.`
    });
  }
};

module.exports = {
  // Funções de Negócio
  sendSignInvite,
  sendOtp,
  sendForgotPasswordEmail,
  // Funções Core (Exportadas para uso genérico, ex: notificação de conclusão)
  sendEmail,
  sendWhatsAppText,
  sendForgotPasswordNotification,
  // Utilitários
  formatPhoneNumber
};