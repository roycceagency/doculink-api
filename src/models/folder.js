// src/models/folder.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Folder extends Model {
    static associate(models) {
      Folder.belongsTo(models.Tenant, { foreignKey: 'tenantId' });
      Folder.belongsTo(models.User, { foreignKey: 'ownerId', as: 'creator' });
      Folder.hasMany(models.Document, { foreignKey: 'folderId', as: 'documents' });
      
      // Auto-relacionamento (Subpastas)
      Folder.belongsTo(models.Folder, { foreignKey: 'parentId', as: 'parent' });
      Folder.hasMany(models.Folder, { foreignKey: 'parentId', as: 'subfolders' });
    }
  }
  Folder.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    tenantId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    ownerId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    parentId: {
      type: DataTypes.UUID,
      allowNull: true, // Null = Raiz
      references: { model: 'Folders', key: 'id' }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    color: {
      type: DataTypes.STRING,
      defaultValue: '#6b7280'
    }
  }, {
    sequelize,
    modelName: 'Folder',
    timestamps: true
  });
  return Folder;
};