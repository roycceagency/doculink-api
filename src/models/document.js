'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Document extends Model {
    static associate(models) {
      Document.belongsTo(models.Tenant, { foreignKey: 'tenantId' });
      Document.belongsTo(models.User, { foreignKey: 'ownerId', as: 'owner' });
      
      // Nova associação: Pasta
      // Se você ainda não criou o arquivo folder.js, o Sequelize vai reclamar se tentar rodar sem ele.
      // Certifique-se de criar o model Folder antes de rodar a sync.
      if (models.Folder) {
          Document.belongsTo(models.Folder, { foreignKey: 'folderId', as: 'folder' });
      }

      Document.hasMany(models.Signer, { foreignKey: 'documentId', as: 'Signers' });
      Document.hasOne(models.Certificate, { foreignKey: 'documentId' });
    }
  }
  Document.init({
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
    ownerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    // --- NOVO CAMPO ---
    folderId: {
      type: DataTypes.UUID,
      allowNull: true, // Se for null, o arquivo está na "Raiz"
      references: { model: 'Folders', key: 'id' }
    },
    // ------------------
    autoReminders: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false
    },
    storageKey: DataTypes.STRING,
    mimeType: DataTypes.STRING,
    size: DataTypes.INTEGER, // in bytes
    sha256: DataTypes.STRING(64),
    deadlineAt: DataTypes.DATE,
    status: {
      type: DataTypes.ENUM(
        'DRAFT',
        'READY',
        'PARTIALLY_SIGNED',
        'SIGNED',
        'EXPIRED',
        'CANCELLED'
      ),
      defaultValue: 'DRAFT',
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'Document',
    timestamps: true,
    updatedAt: true
  });
  return Document;
};