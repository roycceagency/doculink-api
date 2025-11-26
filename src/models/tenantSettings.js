'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TenantSettings extends Model {
    static associate(models) {
      TenantSettings.belongsTo(models.Tenant, { foreignKey: 'tenantId' });
    }
  }
  TenantSettings.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    tenantId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true, // Uma configuração por tenant
      references: { model: 'Tenants', key: 'id' }
    },
    // Configurações Gerais
    appName: { type: DataTypes.STRING, defaultValue: 'Doculink' },
    primaryColor: { type: DataTypes.STRING, defaultValue: '#1c4ed8' },
    logoUrl: DataTypes.STRING,
    
    // Integração WhatsApp (Z-API)
    zapiInstanceId: DataTypes.STRING,
    zapiToken: DataTypes.STRING, // Security Token
    zapiClientToken: DataTypes.STRING, // Client Token
    zapiActive: { type: DataTypes.BOOLEAN, defaultValue: false },

    // Integração Email (Resend/SMTP)
    resendApiKey: DataTypes.STRING,
    resendActive: { type: DataTypes.BOOLEAN, defaultValue: true },

    // --- NOVO CAMPO ---
    finalEmailTemplate: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Template HTML personalizado para o e-mail de conclusão de assinaturas'
    }
    // ------------------
    
  }, {
    sequelize,
    modelName: 'TenantSettings',
    timestamps: true
  });
  return TenantSettings;
};