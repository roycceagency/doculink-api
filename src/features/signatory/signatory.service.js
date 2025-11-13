// src/features/signatory/signatory.service.js

const { Signer, Document, sequelize } = require('../../models');

/**
 * Cria um novo "contato" signatário ou atualiza um existente.
 * Esta função é usada pelo modal "Adicionar Novo Signatário".
 * Ela cria um registro de Signer sem um documentId, tratando-o como um contato global.
 * @param {User} user - O usuário autenticado (atualmente não usado, mas bom para futuras regras de permissão).
 * @param {object} signatoryData - Dados do novo signatário { name, email, cpf, phone }.
 * @returns {Promise<Signer>} - O registro do signatário criado ou atualizado.
 */
const createSignatoryContact = async (user, signatoryData) => {
  const { name, email, phone, cpf } = signatoryData;

  // Garante que o e-mail seja sempre salvo em minúsculas para evitar duplicatas.
  const lowerCaseEmail = email.toLowerCase();

  // Usa findOrCreate:
  // 1. Tenta encontrar um Signer com o e-mail fornecido.
  // 2. Se não encontrar, cria um novo com os dados em 'defaults'.
  const [signer, created] = await Signer.findOrCreate({
    where: { email: lowerCaseEmail },
    defaults: {
      name,
      phoneWhatsE164: phone,
      cpf,
      // `documentId` será nulo por padrão, e `authChannels` usará seu defaultValue.
    }
  });

  // Se o signatário não foi criado (ou seja, ele já existia),
  // atualizamos seus dados com as informações mais recentes fornecidas.
  if (!created) {
    signer.name = name;
    signer.phoneWhatsE164 = phone;
    signer.cpf = cpf;
    await signer.save();
  }

  return signer;
};


/**
 * Lista todos os signatários únicos que um usuário já convidou para qualquer documento.
 * Esta função alimenta o modal "Escolha um signatário de sua lista".
 * @param {User} user - O usuário autenticado que está solicitando a lista.
 * @returns {Promise<Array<Signer>>} - Um array de objetos de signatários únicos.
 */
const listUniqueSignatories = async (user) => {
  // A consulta busca na tabela `Signers`
  const uniqueSigners = await Signer.findAll({
    // Seleciona apenas os campos que queremos retornar, e usa DISTINCT no e-mail
    attributes: [
      [sequelize.fn('DISTINCT', sequelize.col('Signer.email')), 'email'], // Pega e-mails únicos
      'name',
      'phoneWhatsE164',
      'cpf'
    ],
    // Faz um JOIN com a tabela `Documents` para filtrar apenas os signatários
    // de documentos que pertencem ao usuário atual.
    include: [{
      model: Document,
      as: 'Document',
      attributes: [], // Não precisamos de nenhuma coluna da tabela de documentos
      where: { ownerId: user.id },
      required: true // Garante que é um INNER JOIN
    }],
    // Agrupa os resultados para garantir a unicidade
    group: ['Signer.email', 'Signer.name', 'Signer.phoneWhatsE164', 'Signer.cpf'],
    raw: true // Retorna objetos JSON puros em vez de instâncias do Sequelize
  });

  return uniqueSigners;
};


module.exports = {
  createSignatoryContact,
  listUniqueSignatories,
};