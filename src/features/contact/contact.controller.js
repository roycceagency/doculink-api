// src/features/contact/contact.controller.js
'use strict';

const contactService = require('./contact.service');

/**
 * Controller para listar os contatos.
 * Chama o serviço para buscar todos os contatos associados ao usuário autenticado.
 */
const list = async (req, res, next) => {
  try {
    // O objeto 'req.user' é adicionado pelo middleware authGuard
    const contacts = await contactService.listContacts(req.user);
    res.status(200).json(contacts);
  } catch (error) {
    // Passa qualquer erro para o handler de erros global
    next(error);
  }
};

/**
 * Controller para criar um novo contato.
 * Valida a entrada básica e chama o serviço para criar ou atualizar o contato.
 */
const create = async (req, res, next) => {
  try {
    // Validação de entrada básica no controller
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ message: 'Nome e e-mail são obrigatórios.' });
    }

    // O objeto 'req.user' é do usuário logado (dono da lista de contatos)
    // O objeto 'req.body' contém os dados do novo contato a ser criado
    const newContact = await contactService.createContact(req.user, req.body);
    
    // Retorna o contato recém-criado ou atualizado com status 201 (Created)
    res.status(201).json(newContact);
  } catch (error) {
    // Se o serviço lançar um erro (ex: falha no banco), ele é capturado aqui
    next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const updatedContact = await contactService.updateContact(req.user, req.params.id, req.body);
    res.status(200).json(updatedContact);
  } catch (error) {
    next(error);
  }
};

const deleteContact = async (req, res, next) => {
  try {
    await contactService.deleteContact(req.user, req.params.id);
    res.status(204).send(); // 204 No Content para sucesso sem corpo de resposta
  } catch (error) {
    next(error);
  }
};

module.exports = { list, create, update, delete: deleteContact };
