// app.js
'use strict';

// 1. Carrega as variáveis de ambiente
require('dotenv').config();

// 2. Importação dos módulos
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcrypt'); 

// Importação de Rotas e Modelos
const routes = require('./src/routes');
const db = require('./src/models');
const { User, Tenant, Plan, TenantMember } = require('./src/models'); 
const { startReminderJob } = require('./src/services/cron.service');

// 3. Inicialização do Express
const app = express();
const PORT = process.env.PORT || 3333;

// 4. Configuração dos Middlewares
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "blob:"],
        "frame-src": ["'self'", "*"], 
        "frame-ancestors": ["'self'", "*"], 
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }, 
  })
);

app.use(cors({ origin: '*' })); 
app.use(express.json());

// 5. Servir Arquivos Estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 6. Rotas da API
app.use('/api', routes);

// 7. Tratamento de Erros
app.use((err, req, res, next) => {
  console.error('--- ERRO NÃO TRATADO ---');
  console.error(err.stack);
  console.error('--------------------------');
  
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    message: err.message || 'Ocorreu um erro interno no servidor.',
  });
});

// 8. Inicialização do Servidor e SEED
const startServer = async () => {
  try {
    console.log('🔌 Conectando ao banco de dados...');
    await db.sequelize.authenticate();
    console.log('✅ Conexão estabelecida.');

    console.log('🔄 Sincronizando modelos...');
    await db.sequelize.sync({ force: false }); 
    console.log('✅ Modelos sincronizados.');

    // --- INÍCIO: SEED AUTOMÁTICO ---
    console.log('🌱 Executando Seed de Inicialização...');

    // A. GARANTIR OS 4 PLANOS (Gratuito adicionado)
    const defaultPlans = [
        { 
            name: 'Gratuito', 
            slug: 'gratuito', 
            price: 0.00, 
            userLimit: 1, // Apenas o dono
            documentLimit: 3,
            features: ['Assinatura eletrônica básica', 'Armazenamento limitado']
        },
        { 
            name: 'Básico', 
            slug: 'basico', 
            price: 29.90, 
            userLimit: 3, 
            documentLimit: 20,
            features: ['Suporte via WhatsApp', 'Validade jurídica']
        },
        { 
            name: 'Profissional', 
            slug: 'profissional', 
            price: 49.90, 
            userLimit: 5, 
            documentLimit: 50,
            features: ['Templates personalizados', 'API básica']
        },
        { 
            name: 'Empresa', 
            slug: 'empresa', 
            price: 79.90, 
            userLimit: 10, 
            documentLimit: 100,
            features: ['API completa', 'Branding completo', 'Suporte dedicado']
        }
    ];

    for (const planData of defaultPlans) {
        const [plan, created] = await Plan.findOrCreate({
            where: { slug: planData.slug },
            defaults: planData
        });
        if (created) console.log(`✨ Plano criado: ${plan.name}`);
        // Atualiza se existir (para garantir limites novos)
        if (!created) await plan.update(planData);
    }

    // B. GARANTIR TENANT PRINCIPAL
    const enterprisePlan = await Plan.findOne({ where: { slug: 'empresa' } });

    const [mainTenant] = await Tenant.findOrCreate({
        where: { slug: 'main-org' },
        defaults: {
            name: 'Organização Principal (Super Admin)',
            status: 'ACTIVE',
            planId: enterprisePlan?.id
        }
    });

    // C. GARANTIR USUÁRIO SUPER_ADMIN
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@doculink.com';
    const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || '123456';
    
    let superAdminUser = await User.findOne({ where: { email: adminEmail } });

    if (!superAdminUser) {
        const passwordHash = await bcrypt.hash(adminPass, 10);
        superAdminUser = await User.create({
            tenantId: mainTenant.id,
            name: 'Super Admin',
            email: adminEmail,
            passwordHash: passwordHash,
            role: 'SUPER_ADMIN',
            cpf: '00000000000',
            phoneWhatsE164: '5511999999999',
            status: 'ACTIVE'
        });
        console.log(`✨ Usuário Super Admin CRIADO.`);
    } else {
        if (superAdminUser.role !== 'SUPER_ADMIN') {
            console.log(`⚠️ Promovendo usuário Admin para SUPER_ADMIN...`);
            superAdminUser.role = 'SUPER_ADMIN';
            await superAdminUser.save();
        }
    }

    // D. GARANTIR MEMBRO
    const memberRecord = await TenantMember.findOne({
        where: { userId: superAdminUser.id, tenantId: mainTenant.id }
    });

    if (!memberRecord) {
        await TenantMember.create({
            userId: superAdminUser.id,
            tenantId: mainTenant.id,
            email: superAdminUser.email,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE'
        });
        console.log(`✅ Registro de membro criado.`);
    } else if (memberRecord.role !== 'SUPER_ADMIN') {
        memberRecord.role = 'SUPER_ADMIN';
        await memberRecord.save();
    }
    
    console.log('🌱 Seed finalizado.');
    // --- FIM DO SEED ---

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