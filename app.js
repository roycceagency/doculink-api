// app.js
'use strict';

// 1. Carrega as variáveis de ambiente
require('dotenv').config();

// 2. Importação dos módulos
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcrypt'); // Necessário para criar o hash da senha aqui

// Importação de Rotas e Modelos
const routes = require('./src/routes');
const db = require('./src/models');
const { User, Tenant, Plan } = require('./src/models'); // Importa modelos diretamente para o Seed
const { startReminderJob } = require('./src/services/cron.service');

// 3. Inicialização do Express
const app = express();
const PORT = process.env.PORT || 3333;

// 4. Configuração dos Middlewares
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

// 5. Servir Arquivos Estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 6. Rotas da API
app.use('/api', routes);

// 7. Middleware de Tratamento de Erros
app.use((err, req, res, next) => {
  console.error('--- ERRO NÃO TRATADO ---');
  console.error(err.stack);
  console.error('--------------------------');
  
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    message: err.message || 'Ocorreu um erro interno no servidor.',
  });
});

// 8. Sincronização e Inicialização do Servidor
const startServer = async () => {
  try {
    console.log('Conectando ao banco de dados...');
    await db.sequelize.authenticate();
    console.log('✅ Conexão com o banco de dados estabelecida.');

    console.log('Sincronizando modelos...');
    // Em produção, use { alter: true } ou migrations. 
    // Em desenvolvimento, force: true recria tudo (apaga dados).
    const isDevelopment = process.env.NODE_ENV === 'development';
    await db.sequelize.sync({ force: isDevelopment }); 
    
    if (isDevelopment) {
      console.warn('⚠️  DB sincronizado com "force: true". Dados resetados.');
    } else {
      console.log('✅ Modelos sincronizados.');
    }

    // --- INÍCIO: LÓGICA DE SEED DIRETA NO APP.JS ---
    console.log('🌱 Verificando configuração inicial (Seed)...');

    // A. Criar Planos
    const enterprisePlan = await Plan.create({
        name: 'Empresa',
        slug: 'empresa',
        price: 79.90,
        userLimit: 10,
        documentLimit: 100,
        features: ['API completa', 'Branding completo']
    }).catch(() => Plan.findOne({ where: { slug: 'empresa' } })); // Se já existe, busca

    await Plan.bulkCreate([
        { name: 'Básico', slug: 'basico', price: 29.90, userLimit: 3, documentLimit: 20 },
        { name: 'Profissional', slug: 'profissional', price: 49.90, userLimit: 5, documentLimit: 50 }
    ], { ignoreDuplicates: true });

    // B. Criar Tenant Principal
    const [mainTenant] = await Tenant.findOrCreate({
        where: { slug: 'main-org' },
        defaults: {
            name: 'Organização Principal (Super Admin)',
            status: 'ACTIVE',
            planId: enterprisePlan?.id
        }
    });

    // C. Criar Super Admin
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@doculink.com';
    const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || '123456';
    
    const existingAdmin = await User.findOne({ where: { email: adminEmail } });

    if (!existingAdmin) {
        const passwordHash = await bcrypt.hash(adminPass, 10);
        
        const superAdmin = await User.create({
            tenantId: mainTenant.id,
            name: 'Super Admin',
            email: adminEmail,
            passwordHash: passwordHash,
            role: 'SUPER_ADMIN', // <--- FORÇADO AQUI
            cpf: '00000000000',
            phoneWhatsE164: '5511999999999',
            status: 'ACTIVE'
        });
        
        console.log(`✅ SUPER_ADMIN CRIADO COM SUCESSO!`);
        console.log(`📧 Email: ${superAdmin.email}`);
        console.log(`🔑 Role: ${superAdmin.role}`);
    } else {
        // Se já existe, força atualização para garantir a role
        if (existingAdmin.role !== 'SUPER_ADMIN') {
            console.log(`⚠️  Usuário Admin existia mas com role errada (${existingAdmin.role}). Corrigindo...`);
            existingAdmin.role = 'SUPER_ADMIN';
            await existingAdmin.save();
            console.log(`✅ Usuário promovido para SUPER_ADMIN.`);
        } else {
            console.log('✅ Super Admin já configurado corretamente.');
        }
    }
    // --- FIM: LÓGICA DE SEED ---

    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      startReminderJob();
    });

  } catch (error) {
    console.error('❌ Falha ao iniciar o servidor:', error);
    process.exit(1);
  }
};

startServer();