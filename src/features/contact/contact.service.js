// src/features/contact/contact.service.js
'use strict';

const { Contact } = require('../../models');
const { Op } = require('sequelize');

/**
 * Cria um novo contato na lista do usuário, evitando duplicatas.
 * @param {User} user - O usuário autenticado.
 * @param {object} contactData - Dados do novo contato.
 */
const createContact = async (user, contactData) => {
  const { name, email, cpf, phone } = contactData;

  // findOrCreate garante que não haverá duplicatas de e-mail para o mesmo usuário
  const [contact, created] = await Contact.findOrCreate({
    where: { ownerId: user.id, email: email.toLowerCase() },
    defaults: { name, cpf, phone }
  });

  if (!created) {
    // Se o contato já existia, atualiza seus dados
    contact.name = name;
    if (cpf) contact.cpf = cpf;
    if (phone) contact.phone = phone;
    // Se quiser reativar um contato inativo ao recriá-lo:
    // contact.status = 'ACTIVE'; 
    await contact.save();
  }

  return contact;
};

/**
 * Lista todos os contatos pertencentes ao usuário logado.
 * @param {User} user - O usuário autenticado.
 */
const listContacts = async (user) => {
  const contacts = await Contact.findAll({
    where: { ownerId: user.id },
    order: [['name', 'ASC']]
  });
  return contacts;
};

/**
 * Atualiza um contato específico.
 * @param {User} user - O usuário autenticado.
 * @param {string} contactId - ID do contato.
 * @param {object} updateData - Campos a atualizar.
 */
const updateContact = async (user, contactId, updateData) => {
  const contact = await Contact.findOne({ where: { id: contactId, ownerId: user.id } });
  if (!contact) {
    throw new Error('Contato não encontrado ou acesso negado.');
  }

  // Filtra apenas os campos que podem ser atualizados
  const allowedUpdates = ['name', 'email', 'cpf', 'phone', 'isFavorite', 'status'];
  const validUpdates = {};
  for (const key of allowedUpdates) {
    if (updateData[key] !== undefined) {
      validUpdates[key] = updateData[key];
    }
  }

  await contact.update(validUpdates);
  return contact;
};

/**
 * Deleta um contato permanentemente.
 * @param {User} user - O usuário autenticado.
 * @param {string} contactId - ID do contato.
 */
const deleteContact = async (user, contactId) => {
    const contact = await Contact.findOne({ where: { id: contactId, ownerId: user.id } });
    if (!contact) {
        throw new Error('Contato não encontrado ou acesso negado.');
    }
    await contact.destroy();
};

/**
 * Inativa múltiplos contatos de uma vez (Bulk Action).
 * @param {User} user - O usuário autenticado.
 * @param {Array<string>} contactIds - Lista de IDs.
 */
const inactivateContactsBulk = async (user, contactIds) => {
  // O 'update' do Sequelize pode atualizar múltiplos registros de uma vez
  const [affectedCount] = await Contact.update(
    { status: 'INACTIVE' }, // O que atualizar
    {
      where: {
        ownerId: user.id,   // Garante que o usuário só pode inativar seus próprios contatos
        id: {
          [Op.in]: contactIds // A condição: onde o ID está na lista fornecida
        }
      }
    }
  );

  return { affectedCount };
};

module.exports = {
  createContact,
  listContacts,
  updateContact,
  deleteContact,
  inactivateContactsBulk  
};