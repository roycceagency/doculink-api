// src/services/seed.service.js
'use strict';

const bcrypt = require('bcrypt');
const { User, Tenant, Plan } = require('../models');

const seedDefaultAdmin = async () => {
  try {
    console.log('🌱 Iniciando Seed do Sistema...');

    // 1. GARANTIR QUE OS PLANOS EXISTAM
    const plansData = [
      {
        name: 'Básico',
        slug: 'basico',
        price: 29.90,
        userLimit: 3,
        documentLimit: 20,
        features: ['Suporte via WhatsApp', 'Validade jurídica', 'Armazenamento seguro']
      },
      {
        name: 'Profissional',
        slug: 'profissional',
        price: 49.90,
        userLimit: 5,
        documentLimit: 50,
        features: ['Templates personalizados', 'API básica', 'Suporte prioritário']
      },
      {
        name: 'Empresa',
        slug: 'empresa',
        price: 79.90,
        userLimit: 10,
        documentLimit: 100,
        features: ['API completa', 'Branding completo', 'Suporte dedicado', 'Onboarding personalizado']
      }
    ];

    for (const p of plansData) {
      await Plan.findOrCreate({
        where: { slug: p.slug },
        defaults: p
      });
    }
    console.log('✅ Planos sincronizados.');

    // 2. GARANTIR TENANT PRINCIPAL (ROOT)
    // O Super Admin precisa de uma organização "casa", geralmente com o plano mais alto
    const enterprisePlan = await Plan.findOne({ where: { slug: 'empresa' } });

    const [tenant, createdTenant] = await Tenant.findOrCreate({
        where: { slug: 'main-org' },
        defaults: {
            name: 'Organização Principal (Super Admin)',
            status: 'ACTIVE',
            planId: enterprisePlan?.id
        }
    });

    if (createdTenant) console.log('✅ Tenant Principal criado.');

    // 3. GARANTIR SUPER ADMIN
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@doculink.com';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || '123456';

    const existingUser = await User.findOne({ where: { email: adminEmail } });

    if (existingUser) {
      // --- CORREÇÃO: Se já existe, verifica se é SUPER_ADMIN. Se não for, promove. ---
      if (existingUser.role !== 'SUPER_ADMIN') {
        console.log('⚠️ Usuário Admin encontrado com permissão antiga. Promovendo para SUPER_ADMIN...');
        existingUser.role = 'SUPER_ADMIN';
        existingUser.tenantId = tenant.id; // Garante que ele esteja no tenant principal
        await existingUser.save();
        console.log('✅ Usuário promovido com sucesso.');
      } else {
        console.log('✅ Usuário Super Admin já está configurado corretamente.');
      }
    } else {
      // --- CRIAÇÃO DO ZERO ---
      console.log('🌱 Criando novo Super Admin...');
      const passwordHash = await bcrypt.hash(adminPassword, 10);

      await User.create({
        tenantId: tenant.id,
        name: 'Super Admin',
        email: adminEmail,
        passwordHash: passwordHash,
        role: 'SUPER_ADMIN', // <--- DEFINIÇÃO EXPLÍCITA
        status: 'ACTIVE',
        cpf: '00000000000', // CPF fictício para admin sistema
        phoneWhatsE164: '5511999999999'
      });

      console.log(`✅ Super Admin criado: ${adminEmail} / Senha: ${adminPassword}`);
    }

  } catch (error) {
    console.error("❌ Erro no Seed:", error);
  }
};

module.exports = { seedDefaultAdmin };