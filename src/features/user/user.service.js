const { User } = require('../../models');

const updateUser = async (userId, updateData) => {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new Error('Usuário não encontrado.');
  }

  // Filtra apenas os campos que o usuário pode alterar
  const allowedUpdates = ['name', 'phoneWhatsE164'];
  const validUpdates = {};
  for (const key of allowedUpdates) {
    if (updateData[key] !== undefined) {
      validUpdates[key] = updateData[key];
    }
  }

  await user.update(validUpdates);
  return user;
};

module.exports = { updateUser };