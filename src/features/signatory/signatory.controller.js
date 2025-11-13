// src/features/signatory/signatory.controller.js

const signatoryService = require('./signatory.service');

/**
 * Controller para listar os signatários únicos previamente utilizados pelo usuário autenticado.
 * Atende à requisição GET /signatories.
 */
const list = async (req, res, next) => {
  try {
    // A informação do usuário (req.user) é injetada pelo middleware 'authGuard'.
    const signatories = await signatoryService.listUniqueSignatories(req.user);
    
    // Retorna a lista de signatários com status 200 OK.
    res.status(200).json(signatories);
  } catch (error) {
    // Em caso de erro, passa para o middleware de tratamento de erros global.
    next(error);
  }
};

/**
 * Controller para criar um novo "contato" signatário na lista do usuário.
 * Atende à requisição POST /signatories.
 */
const create = async (req, res, next) => {
  try {
    // Extrai os dados do corpo da requisição.
    const { name, email, cpf, phone } = req.body;

    // Validação de entrada básica para garantir que os campos essenciais foram enviados.
    if (!name || !email) {
      return res.status(400).json({ message: 'Nome e e-mail são obrigatórios para criar um signatário.' });
    }
    
    // A informação do usuário (req.user) é injetada pelo middleware 'authGuard'.
    const newSignatory = await signatoryService.createSignatoryContact(req.user, req.body);
    
    // Retorna o signatário recém-criado ou atualizado com status 201 Created.
    res.status(201).json(newSignatory);
  } catch (error) {
    // Em caso de erro (ex: falha na validação do banco), passa para o middleware de erros.
    next(error);
  }
};

// Exporta as funções do controller para serem usadas no arquivo de rotas.
module.exports = {
  list,
  create,
};