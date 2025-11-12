// src/services/notification.service.js

const axios = require('axios');
const { Resend } = require('resend');

// --- Configuração dos Clientes de API ---

// 1. Cliente Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// 2. Cliente Axios para a Z-API
const zapiClient = axios.create({
  baseURL: `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`,
  headers: {
    'Content-Type': 'application/json',
    'Client-Token': process.env.ZAPI_CLIENT_TOKEN
  }
});


// --- Funções de Envio Reais ---

/**
 * Envia um e-mail usando a API do Resend.
 * @param {object} options - Opções do e-mail.
 * @param {string} options.to - Destinatário.
 * @param {string} options.subject - Assunto.
 * @param {string} options.html - Conteúdo HTML do e-mail.
 */
const sendEmail = async ({ to, subject, html }) => {
  try {
    const from = process.env.RESEND_FROM_EMAIL;
    await resend.emails.send({ from, to, subject, html });
    console.log(`[Resend] E-mail enviado com sucesso para: ${to}`);
  } catch (error) {
    console.error(`[Resend] Erro ao enviar e-mail para ${to}:`, error.response?.data || error.message);
    // Em produção, você pode querer logar isso em um serviço de monitoramento.
  }
};

/**
 * Envia uma mensagem de texto simples via WhatsApp usando a Z-API.
 * @param {object} options - Opções da mensagem.
 * @param {string} options.phone - Número do destinatário no formato 5511999999999.
 * @param {string} options.message - Texto da mensagem.
 */
const sendWhatsAppText = async ({ phone, message }) => {
  try {
    await zapiClient.post('/send-text', { phone, message });
    console.log(`[Z-API] Mensagem enviada com sucesso para: ${phone}`);
  } catch (error) {
    console.error(`[Z-API] Erro ao enviar mensagem para ${phone}:`, error.response?.data || error.message);
  }
};


// --- Funções de Negócio (abstrações) ---

/**
 * Envia o convite de assinatura para o signatário.
 * @param {object} signer - O objeto do signatário do Sequelize.
 * @param {string} token - O token de acesso (não o hash).
 */
const sendSignInvite = async (signer, token) => {
  const inviteLink = `${process.env.FRONT_URL}/sign/${token}`;
  
  // Envia o e-mail de convite
  await sendEmail({
    to: signer.email,
    subject: 'Você foi convidado para assinar um documento',
    html: `Olá ${signer.name},<br><br>Por favor, acesse o link abaixo para visualizar e assinar o documento:<br><a href="${inviteLink}">${inviteLink}</a>`
  });

  // Se o signatário tiver WhatsApp, envia também
  if (signer.phoneWhatsE164) {
    await sendWhatsAppText({
      phone: signer.phoneWhatsE164,
      message: `Olá ${signer.name}, você foi convidado para assinar um documento no Doculink. Acesse o link: ${inviteLink}`
    });
  }
};

/**
 * Envia o código OTP para os canais de autenticação do signatário.
 * @param {string} recipient - E-mail ou telefone.
 * @param {'EMAIL' | 'WHATSAPP'} channel - O canal de envio.
 * @param {string} otp - O código de 6 dígitos.
 */
const sendOtp = async (recipient, channel, otp) => {
  const promises = [];

  if (channel === 'EMAIL') {
    promises.push(sendEmail({
      to: recipient,
      subject: 'Seu código de verificação Doculink',
      html: `Seu código de verificação é: <strong>${otp}</strong>.<br>Ele é válido por 10 minutos.`
    }));
  }
  
  if (channel === 'WHATSAPP') {
    promises.push(sendWhatsAppText({
      phone: recipient,
      message: `Seu código de verificação Doculink é: *${otp}*. Ele expira em 10 minutos.`
    }));
  }

  // Executa todos os envios em paralelo e aguarda a conclusão.
  // Usamos allSettled para garantir que tentaremos enviar por todos os canais,
  // mesmo que um deles falhe.
  await Promise.allSettled(promises);
};


module.exports = {
  sendSignInvite,
  sendOtp
};