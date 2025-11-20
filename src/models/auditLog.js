// src/models/auditLog.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class AuditLog extends Model {
    static associate(models) {
      AuditLog.belongsTo(models.Tenant, { foreignKey: 'tenantId' });
    }
  }
  AuditLog.init({
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
    actorKind: DataTypes.ENUM('USER', 'SIGNER', 'SYSTEM'),
    actorId: DataTypes.UUID, 
    
    // --- CORREÇÃO AQUI ---
    // Adicionado 'USER' e 'TENANT' à lista de tipos de entidade permitidos
    entityType: DataTypes.ENUM('DOCUMENT', 'SIGNER', 'TOKEN', 'OTP', 'STORAGE', 'SYSTEM', 'USER', 'TENANT'),
    
    entityId: DataTypes.UUID, 
    action: DataTypes.ENUM(
      'CREATED', 'INVITED', 'VIEWED', 'OTP_SENT', 'OTP_VERIFIED',
      'SIGNED', 'EMAILED', 'DOWNLOADED', 'EXPIRED', 'CANCELLED',
      'STATUS_CHANGED', 'STORAGE_UPLOADED', 'PADES_SIGNED', 'CERTIFICATE_ISSUED', 'OTP_FAILED',
      'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'USER_CREATED', 'SETTINGS_CHANGED', 'ACCOUNT_LOCKED', 'USER_DELETED'
    ),
    ip: DataTypes.STRING,
    userAgent: DataTypes.TEXT,
    deviceInfoJson: DataTypes.JSONB,
    payloadJson: DataTypes.JSONB,
    prevEventHash: DataTypes.STRING(64),
    eventHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true
    }
  }, {
    sequelize,
    modelName: 'AuditLog',
    timestamps: true,
    updatedAt: false
  });
  return AuditLog;
};