// app.js
'use strict';

// 1. Carrega as variáveis de ambiente
require('dotenv').config();

// 2. Importação dos módulos
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcrypt'); // Necessário para hash da senha no seed

// Importação de Rotas e Modelos
const routes = require('./src/routes');
const db = require('./src/models');
// Importamos os modelos explicitamente para usar no Seed embutido
const { User, Tenant, Plan, TenantMember } = require('./src/models'); 
const { startReminderJob } = require('./src/services/cron.service');

// 3. Inicialização do Express
const app = express();
const PORT = process.env.PORT || 3333;

// 4. Configuração dos Middlewares
app.use(helmet());
app.use(cors({ origin: '*' })); // Em produção, restrinja para a URL do front
app.use(express.json());

// 5. Servir Arquivos Estáticos (Uploads)
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
    console.log('🔌 Conectando ao banco de dados...');
    await db.sequelize.authenticate();
    console.log('✅ Conexão com o banco de dados estabelecida.');

    console.log('🔄 Sincronizando modelos...');
    // Use { alter: true } para tentar atualizar ENUMs sem apagar dados.
    // Use { force: true } APENAS se quiser resetar o banco (cuidado!).
    await db.sequelize.sync({ force: true }); 
    console.log('✅ Modelos sincronizados.');


    // --- INÍCIO: SEED EMBUTIDO (CRIAÇÃO/CORREÇÃO DO SUPER ADMIN) ---
    console.log('🌱 Executando Seed de Inicialização...');

    // A. Garantir Planos
    const enterprisePlan = await Plan.findOne({ where: { slug: 'empresa' } }) || await Plan.create({
        name: 'Empresa',
        slug: 'empresa',
        price: 79.90,
        userLimit: 10,
        documentLimit: 100,
        features: ['API completa', 'Branding completo']
    });

    await Plan.bulkCreate([
        { name: 'Básico', slug: 'basico', price: 29.90, userLimit: 3, documentLimit: 20 },
        { name: 'Profissional', slug: 'profissional', price: 49.90, userLimit: 5, documentLimit: 50 }
    ], { ignoreDuplicates: true });

    // B. Garantir Tenant Principal
    const [mainTenant] = await Tenant.findOrCreate({
        where: { slug: 'main-org' },
        defaults: {
            name: 'Organização Principal (Super Admin)',
            status: 'ACTIVE',
            planId: enterprisePlan.id
        }
    });

    // C. Garantir Usuário SUPER_ADMIN
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@doculink.com';
    const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || '123456';
    
    let superAdminUser = await User.findOne({ where: { email: adminEmail } });

    if (!superAdminUser) {
        // Cria novo se não existir
        const passwordHash = await bcrypt.hash(adminPass, 10);
        superAdminUser = await User.create({
            tenantId: mainTenant.id,
            name: 'Super Admin',
            email: adminEmail,
            passwordHash: passwordHash,
            role: 'SUPER_ADMIN', // <--- IMPORTANTE: Role no User
            cpf: '00000000000',
            phoneWhatsE164: '5511999999999',
            status: 'ACTIVE'
        });
        console.log(`✨ Usuário Super Admin CRIADO.`);
    } else {
        // Se já existe, verifica e CORRIGE a role se necessário
        if (superAdminUser.role !== 'SUPER_ADMIN') {
            console.log(`⚠️ Corrigindo role do Usuário Admin de ${superAdminUser.role} para SUPER_ADMIN...`);
            superAdminUser.role = 'SUPER_ADMIN';
            await superAdminUser.save();
            console.log(`✅ Role do Usuário corrigida.`);
        } else {
            console.log(`✅ Usuário Super Admin já existe e está correto.`);
        }
    }

    // D. Garantir Vínculo na tabela TenantMembers como SUPER_ADMIN
    // Isso resolve o problema de ele abrir como ADMIN se a lógica buscar na tabela de membros
    const memberRecord = await TenantMember.findOne({
        where: { userId: superAdminUser.id, tenantId: mainTenant.id }
    });

    if (memberRecord) {
        if (memberRecord.role !== 'SUPER_ADMIN') {
            console.log(`⚠️ Corrigindo role do Membro Admin de ${memberRecord.role} para SUPER_ADMIN...`);
            memberRecord.role = 'SUPER_ADMIN';
            await memberRecord.save();
            console.log(`✅ Role do Membro corrigida.`);
        }
    } else {
        // Se não existir o registro de membro (apenas o ownerId no tenant), cria o membro explicitamente
        console.log(`➕ Adicionando registro explícito em TenantMembers...`);
        await TenantMember.create({
            userId: superAdminUser.id,
            tenantId: mainTenant.id,
            email: superAdminUser.email,
            role: 'SUPER_ADMIN', // <--- IMPORTANTE: Role no Member
            status: 'ACTIVE'
        });
        console.log(`✅ Registro de membro criado.`);
    }
    
    console.log('🌱 Seed finalizado com sucesso.');
    // --- FIM DO SEED ---


    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      // Inicia os jobs agendados
      startReminderJob();
    });

  } catch (error) {
    console.error('❌ Falha ao iniciar o servidor:', error);
    process.exit(1);
  }
};

startServer();