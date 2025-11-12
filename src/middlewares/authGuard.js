// src/middlewares/authGuard.js

const jwt = require('jsonwebtoken');
const { User } = require('../models'); // Importa o User para buscar no DB

const authGuard = async (req, res, next) => {
  // 1. Pega o cabeçalho de autorização
  const authHeader = req.headers.authorization;

  // 2. Verifica se o cabeçalho existe e se está no formato 'Bearer token'
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Acesso negado. Nenhum token fornecido.' });
  }

  // 3. Extrai o token do cabeçalho
  const token = authHeader.split(' ')[1];

  try {
    // 4. Verifica se o token é válido usando o segredo JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 5. Busca o usuário no banco de dados com o ID que estava no token
    const user = await User.findOne({
      where: { id: decoded.userId, status: 'ACTIVE' }
    });

    // 6. Se o usuário não for encontrado ou não estiver ativo, o token é inválido
    if (!user) {
      return res.status(401).json({ message: 'Acesso negado. Usuário não encontrado ou inativo.' });
    }

    // 7. Anexa o objeto do usuário à requisição para uso posterior nas rotas
    req.user = user;

    // 8. Se tudo estiver certo, continua para a próxima função (o controller da rota)
    next();
  } catch (error) {
    // Se jwt.verify falhar (token expirado, malformado, etc.), ele lança um erro
    return res.status(401).json({ message: 'Token inválido ou expirado.' });
  }
};

module.exports = authGuard;