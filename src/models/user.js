'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.belongsTo(models.Tenant, { foreignKey: 'tenantId', as: 'tenant' });
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
    tenantId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Tenants',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      },
      // --- ATUALIZAÇÕES ---
    cpf: {
      type: DataTypes.STRING,
      allowNull: false, // CPF agora é obrigatório no cadastro
      unique: true
    },
    phoneWhatsE164: { // O nome do campo no DB já é o correto
        type: DataTypes.STRING,
        allowNull: false, // Celular agora é obrigatório
    },
          // --- NOVO CAMPO ---
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false, // Senha é obrigatória
    },
    },
    cpf: {
      type: DataTypes.STRING,
      unique: true
    },
    phoneWhatsE164: DataTypes.STRING,
    status: {
      type: DataTypes.STRING,
      defaultValue: 'ACTIVE',
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'User',
    timestamps: true,
    updatedAt: false
  });
  return User;
};