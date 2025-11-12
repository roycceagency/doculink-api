'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Signer extends Model {
    static associate(models) {
      Signer.belongsTo(models.Document, { foreignKey: 'documentId' });
      Signer.hasMany(models.ShareToken, { foreignKey: 'signerId' });
    }
  }
  Signer.init({
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
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isEmail: true }
    },
    signatureArtefactPath: {
  type: DataTypes.STRING,
  allowNull: true,
},
    cpf: DataTypes.STRING,
    phoneWhatsE164: DataTypes.STRING,
    authChannels: {
      type: DataTypes.ARRAY(DataTypes.ENUM('EMAIL', 'SMS', 'WHATSAPP')),
      allowNull: false
    },
    order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    // --- NOVOS CAMPOS PARA O CARIMBO VISUAL ---
    signaturePositionX: {
      type: DataTypes.FLOAT,
      allowNull: true, // Permite assinaturas sem carimbo visual
    },
    signaturePositionY: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    signaturePositionPage: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(
        'PENDING',
        'VIEWED',
        'SIGNED',
        'DECLINED',
        'EXPIRED'
      ),
      defaultValue: 'PENDING',
      allowNull: false
    },
    signedAt: DataTypes.DATE,
    signatureHash: DataTypes.STRING(64)
  }, {
    sequelize,
    modelName: 'Signer',
    timestamps: false
  });
  return Signer;
};