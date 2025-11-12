// src/features/tenant/tenant.service.js

const { Tenant, User, sequelize } = require('../../models');

// Função auxiliar para criar um 'slug' a partir do nome do tenant.
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove caracteres especiais
    .replace(/[\s_-]+/g, '-') // Substitui espaços e underscores por hífens
    .replace(/^-+|-+$/g, ''); // Remove hífens do início e do fim
};

const createTenantWithAdmin = async (tenantName, adminUserData) => {
  const transaction = await sequelize.transaction();
  try {
    // 1. Cria o slug e verifica se já existe
    let slug = generateSlug(tenantName);
    const existingTenant = await Tenant.findOne({ where: { slug }, transaction });
    if (existingTenant) {
      // Adiciona um sufixo aleatório se o slug já existir
      slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
    }

    // 2. Cria o tenant dentro da transação
    const tenant = await Tenant.create({
      name: tenantName,
      slug: slug,
      status: 'ACTIVE'
    }, { transaction });

    // 3. Cria o primeiro usuário (administrador) para este tenant
    await User.create({
      tenantId: tenant.id,
      name: adminUserData.name,
      email: adminUserData.email,
      // Outros campos do usuário como 'cpf' ou 'phone' podem ser adicionados aqui
      status: 'ACTIVE'
    }, { transaction });

    // 4. Se tudo deu certo, confirma a transação
    await transaction.commit();

    return tenant;
  } catch (error) {
    // 5. Se algo deu errado, desfaz todas as operações
    await transaction.rollback();
    // Verifica se o erro é de violação de unicidade (ex: e-mail do admin já existe)
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw new Error(`Não foi possível criar o tenant. O e-mail do administrador '${adminUserData.email}' já está em uso.`);
    }
    throw error;
  }
};

const findAllTenants = async () => {
  return Tenant.findAll({
    order: [['name', 'ASC']]
  });
};

const findTenantById = async (id) => {
  const tenant = await Tenant.findByPk(id);
  if (!tenant) {
    throw new Error('Tenant não encontrado.');
  }
  return tenant;
};

const updateTenantById = async (id, updateData) => {
  const tenant = await findTenantById(id);

  // Filtra os campos que podem ser atualizados
  const allowedUpdates = ['name', 'status'];
  const validUpdates = {};

  for (const key of allowedUpdates) {
    if (updateData[key] !== undefined) {
      validUpdates[key] = updateData[key];
    }
  }

  // Se o nome for atualizado, o slug também deve ser.
  if (validUpdates.name) {
    validUpdates.slug = generateSlug(validUpdates.name);
  }

  await tenant.update(validUpdates);
  return tenant;
};

module.exports = {
  createTenantWithAdmin,
  findAllTenants,
  findTenantById,
  updateTenantById,
};