// src/models/signer.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Signer extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Um Signatário pertence a um Documento (esta associação agora é opcional)
      Signer.belongsTo(models.Document, { foreignKey: 'documentId' });
      
      // Um Signatário pode ter múltiplos tokens de compartilhamento (ShareToken)
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
      allowNull: true, // <-- CORREÇÃO: Permite que seja nulo para funcionar como "contato"
      references: { 
        model: 'Documents', // Nome da tabela
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
      allowNull: true, // CPF pode ser nulo inicialmente e preenchido no fluxo de assinatura
    },
    phoneWhatsE164: {
      type: DataTypes.STRING,
      allowNull: true, // Telefone também pode ser opcional ao criar um contato
    },
    qualification: {
      type: DataTypes.STRING,
      allowNull: true, // Qualificação (Advogado, etc.) é opcional
    },
    authChannels: {
      type: DataTypes.ARRAY(DataTypes.ENUM('EMAIL', 'SMS', 'WHATSAPP')),
      allowNull: false,
      defaultValue: ['EMAIL', 'WHATSAPP'], // <-- CORREÇÃO: Adiciona um valor padrão
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
    timestamps: false // Geralmente não precisamos de createdAt/updatedAt para o signatário do documento
  });
  return Signer;
};