const userService = require('./user.service');

const getMe = async (req, res, next) => {
  try {
    // A informação do usuário já vem do authGuard
    res.status(200).json(req.user);
  } catch (error) {
    next(error);
  }
};

const updateMe = async (req, res, next) => {
  try {
    const updatedUser = await userService.updateUser(req.user.id, req.body);
    res.status(200).json(updatedUser);
  } catch (error) {
    next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    await userService.changeUserPassword(req.user, currentPassword, newPassword);
    res.status(200).json({ message: 'Senha atualizada com sucesso.' });
  } catch (error) {
    // Passa o erro para o middleware, que pode retornar 400 ou 403
    next(error);
  }
};

const listUsers = async (req, res, next) => {
  try {
    const users = await userService.listUsersByTenant(req.user.tenantId);
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  try {
    // Admin criando outro usuário
    const newUser = await userService.createUserByAdmin(req.user, req.body);
    res.status(201).json(newUser);
  } catch (error) {
    next(error);
  }
};

const adminUpdateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await userService.updateUserByAdmin(req.user, id, req.body);
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    await userService.deleteUserByAdmin(req.user, id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const forceSuperAdmin = async (req, res, next) => {
  try {
    // Define o e-mail fixo do admin
    const targetEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@doculink.com';

    // Busca o usuário
    const user = await require('../../models').User.findOne({ where: { email: targetEmail } });

    if (!user) {
      return res.status(404).json({ message: `Usuário padrão (${targetEmail}) não encontrado no banco.` });
    }

    // Força a atualização direta
    await user.update({ role: 'SUPER_ADMIN' });

    return res.status(200).json({ 
        message: 'SUCESSO: Permissão atualizada.',
        details: `O usuário ${user.email} agora é ${user.role}. Faça logout e login novamente.`
    });

  } catch (error) {
    next(error);
  }
};


module.exports = { 
    getMe, updateMe, changePassword, // Existentes
    listUsers, createUser, adminUpdateUser, deleteUser,
    forceSuperAdmin // Novos
};