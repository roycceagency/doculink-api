// src/features/document/folder.controller.js
const folderService = require('./folder.service');

const create = async (req, res, next) => {
    try {
        const folder = await folderService.createFolder(req.user, req.body);
        res.status(201).json(folder);
    } catch(e) { next(e); }
};

const list = async (req, res, next) => {
    try {
        // Recebe ?parentId=xyz ou ?search=contrato
        const data = await folderService.listContents(req.user, req.query);
        res.status(200).json(data);
    } catch(e) { next(e); }
};

const move = async (req, res, next) => {
    try {
        const result = await folderService.moveItem(req.user, req.body);
        res.status(200).json(result);
    } catch(e) { next(e); }
};

const remove = async (req, res, next) => {
    try {
        const result = await folderService.deleteFolder(req.user, req.params.id);
        res.status(200).json(result);
    } catch(e) { next(e); }
};

module.exports = { create, list, move, remove };