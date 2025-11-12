'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class OtpCode extends Model {
    static associate(models) {
      // No direct association needed based on the diagram, 
      // recipient is a generic field.
    }
  }
  OtpCode.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    recipient: { // e-mail ou phone
      type: DataTypes.STRING,
      allowNull: false
    },
    channel: {
      type: DataTypes.ENUM('EMAIL', 'SMS', 'WHATSAPP'),
      allowNull: false
    },
    codeHash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    context: {
      type: DataTypes.ENUM('LOGIN', 'SIGNING'),
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'OtpCode',
    timestamps: true, // createdAt é útil
    updatedAt: false
  });
  return OtpCode;
};