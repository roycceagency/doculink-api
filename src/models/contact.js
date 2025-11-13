// src/models/contact.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Contact extends Model {
    static associate(models) {
      // Um contato pertence a um usuário (o dono da lista de contatos)
      Contact.belongsTo(models.User, { foreignKey: 'ownerId', as: 'owner' });
    }
  }
  Contact.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    ownerId: { // Chave estrangeira para o usuário dono do contato
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    // --- NOVOS CAMPOS ---
    isFavorite: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: 'ACTIVE', // Pode ser 'ACTIVE' ou 'INACTIVE'
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isEmail: true }
    },
    cpf: DataTypes.STRING,
    phone: DataTypes.STRING,
  }, {
    sequelize,
    modelName: 'Contact',
    // Garante que um usuário não pode ter o mesmo e-mail de contato duas vezes
    indexes: [{ unique: true, fields: ['ownerId', 'email'] }]
  });
  return Contact;
};