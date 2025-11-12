'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Notification extends Model {
    static associate(models) {
      Notification.belongsTo(models.Tenant, { foreignKey: 'tenantId' });
    }
  }
  Notification.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    tenantId: DataTypes.UUID,
    channel: DataTypes.STRING,
    to: {
      type: DataTypes.STRING,
      allowNull: false
    },
    template: DataTypes.STRING,
    status: DataTypes.STRING, // Ex: PENDING, SENT, FAILED
    error: DataTypes.TEXT
  }, {
    sequelize,
    modelName: 'Notification',
    timestamps: true, // createdAt
    updatedAt: true  // updatedAt para rastrear novas tentativas
  });
  return Notification;
};