const settingsService = require('./settings.service');
const auditService = require('../audit/audit.service');

const get = async (req, res, next) => {
  try {
    const settings = await settingsService.getSettings(req.user.tenantId);
    res.json(settings);
  } catch (error) {
    next(error);
  }
};

const update = async (req, res, next) => {
  try {
    const updated = await settingsService.updateSettings(req.user.tenantId, req.body);
    
    // Log de Auditoria para mudança crítica
    await auditService.createEntry({
        tenantId: req.user.tenantId,
        actorKind: 'USER',
        actorId: req.user.id,
        entityType: 'SYSTEM',
        entityId: updated.id,
        action: 'SETTINGS_CHANGED',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        payload: { message: 'Configurações de integração atualizadas' }
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
};

const updateEmailTemplate = async (req, res, next) => {
    try {
        const { htmlContent } = req.body; // HTML puro vindo de um editor WYSIWYG do front
        const settings = await TenantSettings.findOne({ where: { tenantId: req.user.tenantId } });
        
        if (!settings) {
            await TenantSettings.create({ tenantId: req.user.tenantId, finalEmailTemplate: htmlContent });
        } else {
            settings.finalEmailTemplate = htmlContent;
            await settings.save();
        }
        res.json({ message: 'Template atualizado.' });
    } catch (error) { next(error); }
};

module.exports = { get, update, updateEmailTemplate };