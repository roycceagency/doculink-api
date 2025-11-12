'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Certificate extends Model {
    static associate(models) {
      Certificate.belongsTo(models.Document, { foreignKey: 'documentId' });
    }
  }
  Certificate.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false
    },
    documentId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true, // Cada documento tem apenas um certificado
      references: { model: 'Documents', key: 'id' }
    },
    storageKey: {
      type: DataTypes.STRING,
      allowNull: false
    },
    sha256: {
      type: DataTypes.STRING(64),
      allowNull: false
    },
    issuedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    modelName: 'Certificate',
    timestamps: false
  });
  return Certificate;
};