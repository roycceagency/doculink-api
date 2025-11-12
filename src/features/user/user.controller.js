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

module.exports = { getMe, updateMe };