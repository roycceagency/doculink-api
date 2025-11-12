'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Session extends Model {
    static associate(models) {
      Session.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    }
  }
  Session.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    refreshTokenHash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    ip: DataTypes.STRING,
    userAgent: DataTypes.STRING,
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'Session',
    timestamps: false // Geralmente não precisamos de createdAt/updatedAt para sessões
  });
  return Session;
};