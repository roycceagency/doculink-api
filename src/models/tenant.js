'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Tenant extends Model {
    static associate(models) {
      Tenant.hasMany(models.User, { foreignKey: 'tenantId' });
      Tenant.hasMany(models.Document, { foreignKey: 'tenantId' });
    }
  }
  Tenant.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    status: {
      type: DataTypes.STRING, // Ex: ACTIVE, INACTIVE, SUSPENDED
      defaultValue: 'ACTIVE',
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'Tenant',
    timestamps: true, // createdAt é adicionado automaticamente
    updatedAt: false // Desabilita updatedAt se não for necessário
  });
  return Tenant;
};