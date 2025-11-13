const { User } = require('../../models');
const bcrypt = require('bcrypt'); // Importa o bcrypt

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

const changeUserPassword = async (user, currentPassword, newPassword) => {
  // Busca o usuário completo do banco, incluindo o hash da senha
  const userWithPassword = await User.findByPk(user.id);
  
  if (!userWithPassword.passwordHash) {
    throw new Error('Conta configurada incorretamente, sem hash de senha.');
  }

  // Verifica se a senha atual está correta
  const isMatch = await bcrypt.compare(currentPassword, userWithPassword.passwordHash);
  if (!isMatch) {
    const error = new Error('A senha atual está incorreta.');
    error.statusCode = 403; // Forbidden
    throw error;
  }
  
  if (!newPassword || newPassword.length < 6) {
    const error = new Error('A nova senha deve ter no mínimo 6 caracteres.');
    error.statusCode = 400; // Bad Request
    throw error;
  }
  
  // Criptografa e salva a nova senha
  userWithPassword.passwordHash = await bcrypt.hash(newPassword, 10);
  await userWithPassword.save();
};

module.exports = { updateUser, changeUserPassword };
