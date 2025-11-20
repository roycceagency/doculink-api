// src/models/user.js
'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      // Tenant "dono" (aquele que foi criado no cadastro)
      User.belongsTo(models.Tenant, { foreignKey: 'tenantId', as: 'ownTenant' });
      
      // Tenants onde ele é membro (convidado)
      User.hasMany(models.TenantMember, { foreignKey: 'userId', as: 'memberships' });
      
      User.hasMany(models.Session, { foreignKey: 'userId' });
      User.hasMany(models.Document, { foreignKey: 'ownerId', as: 'ownedDocuments' });
    }
  }
  User.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    tenantId: { // Este continua sendo o Tenant "Pessoal/Principal" criado no registro
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Tenants', key: 'id' }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true }
    },
    // O Role aqui define se ele é dono da conta dele, mas o role no TenantMember define o acesso nas contas de terceiros
    role: {
      // Adicionado SUPER_ADMIN
      type: DataTypes.ENUM('SUPER_ADMIN', 'ADMIN', 'USER'), 
      defaultValue: 'USER',
      allowNull: false
    },
    cpf: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true
    },
    phoneWhatsE164: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.STRING, // ACTIVE, BLOCKED
      defaultValue: 'ACTIVE',
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'User',
    timestamps: true,
    updatedAt: false,
    defaultScope: {
      attributes: { exclude: ['passwordHash'] }
    },
    scopes: {
      withPassword: {
        attributes: { include: ['passwordHash'] }
      }
    }
  });
  return User;
};