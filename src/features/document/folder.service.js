// src/features/document/folder.service.js
'use strict';

const { Folder, Document, User } = require('../../models');
const { Op } = require('sequelize');

/**
 * Cria uma nova pasta.
 */
const createFolder = async (user, { name, parentId, color }) => {
    // Validação de segurança: se tiver parentId, ele deve pertencer ao mesmo tenant
    if (parentId) {
        const parent = await Folder.findOne({ where: { id: parentId, tenantId: user.tenantId } });
        if (!parent) throw new Error('Pasta pai não encontrada ou acesso negado.');
    }

    return Folder.create({
        tenantId: user.tenantId,
        ownerId: user.id,
        parentId: parentId || null,
        name,
        color
    });
};

/**
 * Lista conteúdo (Pastas e Arquivos) aplicando filtros.
 */
const listContents = async (user, { parentId, search }) => {
    const folderWhere = { tenantId: user.tenantId };
    const docWhere = { tenantId: user.tenantId };

    if (search) {
        // --- MODO BUSCA (Global) ---
        // Se o usuário digita algo, ignoramos a hierarquia e buscamos em tudo
        folderWhere.name = { [Op.iLike]: `%${search}%` }; // Case insensitive
        docWhere.title = { [Op.iLike]: `%${search}%` };
        // Removemos restrição de parentId/folderId para buscar em qualquer nível
    } else {
        // --- MODO NAVEGAÇÃO (Hierárquico) ---
        // Se parentId for 'root' ou undefined, buscamos onde parentId/folderId é NULL
        const targetId = (parentId === 'root' || !parentId) ? null : parentId;
        
        folderWhere.parentId = targetId;
        docWhere.folderId = targetId;
    }

    // Busca Pastas
    const folders = await Folder.findAll({
        where: folderWhere,
        order: [['name', 'ASC']],
        include: [{ model: User, as: 'creator', attributes: ['name'] }]
    });

    // Busca Documentos (exclui os cancelados da visualização padrão)
    docWhere.status = { [Op.ne]: 'CANCELLED' }; 
    
    const documents = await Document.findAll({
        where: docWhere,
        order: [['createdAt', 'DESC']],
        include: [
            { model: User, as: 'owner', attributes: ['name'] }
        ]
    });

    // Se estiver navegando, retorna breadcrumbs (caminho de pão)
    let breadcrumbs = [];
    if (parentId && parentId !== 'root' && !search) {
        let current = await Folder.findByPk(parentId);
        while(current) {
            breadcrumbs.unshift({ id: current.id, name: current.name });
            if (current.parentId) {
                current = await Folder.findByPk(current.parentId);
            } else {
                current = null;
            }
        }
        breadcrumbs.unshift({ id: 'root', name: 'Início' });
    }

    return {
        breadcrumbs,
        folders,
        documents
    };
};

const moveItem = async (user, { itemId, itemType, targetFolderId }) => {
    // Verifica destino
    let targetId = targetFolderId;
    if (targetId === 'root') targetId = null;

    if (targetId) {
        const target = await Folder.findOne({ where: { id: targetId, tenantId: user.tenantId } });
        if (!target) throw new Error('Pasta de destino inválida.');
    }

    if (itemType === 'DOCUMENT') {
        const doc = await Document.findOne({ where: { id: itemId, tenantId: user.tenantId } });
        if (!doc) throw new Error('Documento não encontrado.');
        doc.folderId = targetId;
        await doc.save();
    } else {
        const folder = await Folder.findOne({ where: { id: itemId, tenantId: user.tenantId } });
        if (!folder) throw new Error('Pasta não encontrada.');
        if (targetId === itemId) throw new Error('Movimento ilegal.');
        folder.parentId = targetId;
        await folder.save();
    }
    return { message: 'Item movido com sucesso.' };
};

const deleteFolder = async (user, folderId) => {
    const folder = await Folder.findOne({ where: { id: folderId, tenantId: user.tenantId } });
    if (!folder) throw new Error('Pasta não encontrada.');

    // Move documentos de dentro dela para a Raiz (para não perder arquivos importantes)
    await Document.update({ folderId: null }, { where: { folderId } });
    
    // Deleta subpastas (Recursão simples: deleta as pastas filhas, documentos delas viram órfãos na raiz tb? 
    // Simplificação: só deleta a pasta alvo. Se tiver subpastas, banco pode reclamar se não tiver CASCADE)
    // Aqui assumimos soft delete ou delete simples.
    await folder.destroy();
    
    return { message: 'Pasta removida. Os documentos foram movidos para a raiz.' };
};

module.exports = { createFolder, listContents, moveItem, deleteFolder };