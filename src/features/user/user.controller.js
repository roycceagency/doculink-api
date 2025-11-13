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

module.exports = { getMe, updateMe, changePassword};