// src/models/signer.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Signer extends Model {
    static associate(models) {
      // Um Signatário pertence a um Documento
      Signer.belongsTo(models.Document, { foreignKey: 'documentId' });
      
      // Um Signatário pode ter múltiplos tokens de compartilhamento
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
      allowNull: true, 
      references: { 
        model: 'Documents', 
        key: 'id' 
      }
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
    cpf: {
      type: DataTypes.STRING,
      allowNull: true, 
    },
    phoneWhatsE164: {
      type: DataTypes.STRING,
      allowNull: true, 
    },
    qualification: {
      type: DataTypes.STRING,
      allowNull: true, 
    },
    authChannels: {
      type: DataTypes.ARRAY(DataTypes.ENUM('EMAIL', 'SMS', 'WHATSAPP')),
      allowNull: false,
      defaultValue: ['EMAIL', 'WHATSAPP'], 
    },
    order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
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
    signedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // --- NOVOS CAMPOS PARA O CARIMBO VISUAL ---
    ip: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Endereço IP utilizado no momento da assinatura'
    },
    signatureUuid: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4, // Gera um ID único para a assinatura automaticamente se necessário
      allowNull: true,
      comment: 'ID único público da assinatura para exibição no PDF'
    },
    // ------------------------------------------
    signatureHash: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    signatureArtefactPath: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    signaturePositionX: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    signaturePositionY: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    signaturePositionPage: {
      type: DataTypes.INTEGER,
      allowNull: true,
    }
  }, {
    sequelize,
    modelName: 'Signer',
    timestamps: false 
  });
  return Signer;
};