// src/models/tenantMember.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TenantMember extends Model {
    static associate(models) {
      TenantMember.belongsTo(models.Tenant, { foreignKey: 'tenantId', as: 'tenant' });
      TenantMember.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    }
  }
  TenantMember.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    tenantId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Tenants', key: 'id' }
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'Users', key: 'id' }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false
    },
    // --- ALTERAÇÃO AQUI: Novos Cargos ---
    role: {
      type: DataTypes.ENUM('ADMIN', 'MANAGER', 'VIEWER'),
      defaultValue: 'VIEWER',
      allowNull: false
    },
    // ------------------------------------
    status: {
      type: DataTypes.ENUM('PENDING', 'ACTIVE', 'DECLINED'),
      defaultValue: 'PENDING',
      allowNull: false
    },
    invitedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    modelName: 'TenantMember',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['tenantId', 'email'] }
    ]
  });
  return TenantMember;
};