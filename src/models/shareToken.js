'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ShareToken extends Model {
    static associate(models) {
      ShareToken.belongsTo(models.Document, { foreignKey: 'documentId' });
      ShareToken.belongsTo(models.Signer, { foreignKey: 'signerId' });
    }
  }
  ShareToken.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    documentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Documents', key: 'id' }
    },
    signerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Signers', key: 'id' }
    },
    tokenHash: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    timesUsed: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  }, {
    sequelize,
    modelName: 'ShareToken',
    timestamps: false
  });
  return ShareToken;
};