// src/services/seed.service.js
'use strict';

const bcrypt = require('bcrypt');
const { User, Tenant } = require('../models');

const seedDefaultAdmin = async () => {
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@doculink.com';
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || '123456';

  // Verifica se já existe algum usuário
  const userExists = await User.findOne({ where: { email: adminEmail } });
  if (userExists) {
    console.log('✅ Usuário Admin padrão já existe.');
    return;
  }

  console.log('🌱 Criando Tenant e Admin padrão...');

  // Cria um Tenant padrão
  const tenant = await Tenant.create({
    name: 'Organização Principal',
    slug: 'main-org',
    status: 'ACTIVE'
  });

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await User.create({
    tenantId: tenant.id,
    name: 'Super Admin',
    email: adminEmail,
    passwordHash: passwordHash,
   role: 'SUPER_ADMIN', // <--- MUDANÇA AQUI
    status: 'ACTIVE'
  });

  console.log(`✅ Admin criado: ${adminEmail} / Senha: ${adminPassword}`);
};

module.exports = { seedDefaultAdmin };