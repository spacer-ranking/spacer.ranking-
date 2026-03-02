require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Sequelize, DataTypes, Op } = require('sequelize');
const bcrypt = require('bcrypt');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors({ origin: true, credentials: true }));

// База данных PostgreSQL (строка подключения из переменной окружения)
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  logging: false
});

// Подключение сессий с хранением в БД
const sessionStore = new pgSession({
  conString: process.env.DATABASE_URL,
  tableName: 'session'
});

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 дней
}));

// ==================== МОДЕЛИ ====================
const User = sequelize.define('User', {
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, defaultValue: 'user' } // 'leader' или 'user'
});

const Team = sequelize.define('Team', {
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  avatar: { type: DataTypes.STRING, defaultValue: '/default-avatar.png' },
  rating: { type: DataTypes.INTEGER, defaultValue: 1000 } // начальный рейтинг
});

const TeamMember = sequelize.define('TeamMember', {
  // связующая таблица
});

const Match = sequelize.define('Match', {
  team1_score: { type: DataTypes.INTEGER, allowNull: false },
  team2_score: { type: DataTypes.INTEGER, allowNull: false },
  winner_id: { type: DataTypes.INTEGER, allowNull: true },
  status: { type: DataTypes.STRING, defaultValue: 'completed' } // только completed для истории
});

// Связи
User.hasMany(Team, { as: 'createdTeams', foreignKey: 'createdBy' });
Team.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });

Team.belongsToMany(User, { through: TeamMember, as: 'members' });
User.belongsToMany(Team, { through: TeamMember, as: 'teams' });

Match.belongsTo(Team, { as: 'team1', foreignKey: 'team1_id' });
Match.belongsTo(Team, { as: 'team2', foreignKey: 'team2_id' });
Match.belongsTo(Team, { as: 'winner', foreignKey: 'winner_id' });
Match.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });

// ==================== СИНХРОНИЗАЦИЯ БД ====================
sequelize.sync({ alter: true }).then(() => {
  console.log('База данных синхронизирована');
  // Создаем лидера Quantum, если его нет
  User.findOrCreate({
    where: { username: 'Quantum' },
    defaults: {
      password: bcrypt.hashSync('quantum123', 10), // пароль по умолчанию, можно сменить
      role: 'leader'
    }
  }).then(([user, created]) => {
    if (created) console.log('Лидер Quantum создан');
  });
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function isLeader(req) {
  return req.session.user && req.session.user.role === 'leader';
}

// ==================== API РОУТЫ ====================

// Генерация одноразового кода для регистрации
app.post('/api/register/generate-code', (req, res) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 цифр
  req.session.regCode = code;
  res.json({ code }); // на клиенте покажем пользователю
});

// Регистрация
app.post('/api/register', async (req, res) => {
  const { username, password, code } = req.body;
  if (!username || !password || !code) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }
  // Проверка кода
  if (!req.session.regCode || req.session.regCode !== code) {
    return res.status(400).json({ error: 'Неверный код подтверждения' });
  }
  // Код одноразовый - удаляем после использования
  delete req.session.regCode;

  // Проверка уникальности имени
  const existing = await User.findOne({ where: { username } });
  if (existing) {
    return res.status(400).json({ error: 'Имя уже занято' });
  }

  // Хеширование пароля
  const hashedPassword = await bcrypt.hash(password, 10);
  // Роль: если имя Quantum - лидер, иначе обычный пользователь
  const role = (username === 'Quantum') ? 'leader' : 'user';
  const user = await User.create({ username, password: hashedPassword, role });

  // Автоматический вход после регистрации
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ user: req.session.user });
});

// Вход
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ where: { username } });
  if (!user) return res.status(401).json({ error: 'Неверное имя или пароль' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Неверное имя или пароль' });

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ user: req.session.user });
});

// Выход
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Текущий пользователь
app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: 'Не авторизован' });
  }
});

// Список команд с рейтингом (для главной)
app.get('/api/teams', async (req, res) => {
  const teams = await Team.findAll({ order: [['rating', 'DESC']] });
  res.json(teams);
});

// Создание команды (только лидер)
app.post('/api/teams', async (req, res) => {
  if (!isLeader(req)) return res.status(403).json({ error: 'Только лидер может создавать команды' });
  const { name, avatar } = req.body;
  try {
    const team = await Team.create({
      name,
      avatar: avatar || '/default-avatar.png',
      createdBy: req.session.user.id
    });
    res.json(team);
  } catch (e) {
    res.status(400).json({ error: 'Команда с таким именем уже существует' });
  }
});

// Изменение аватарки команды (только лидер)
app.put('/api/teams/:id/avatar', async (req, res) => {
  if (!isLeader(req)) return res.status(403).json({ error: 'Только лидер может менять аватар' });
  const team = await Team.findByPk(req.params.id);
  if (!team) return res.status(404).json({ error: 'Команда не найдена' });
  team.avatar = req.body.avatar;
  await team.save();
  res.json(team);
});

// Добавление игрока в команду (только лидер)
app.post('/api/teams/:id/members', async (req, res) => {
  if (!isLeader(req)) return res.status(403).json({ error: 'Только лидер может добавлять игроков' });
  const { userId } = req.body;
  const team = await Team.findByPk(req.params.id);
  if (!team) return res.status(404).json({ error: 'Команда не найдена' });
  const user = await User.findByPk(userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  await team.addMember(user);
  res.json({ success: true });
});

// История всех матчей
app.get('/api/matches', async (req, res) => {
  const matches = await Match.findAll({
    include: [
      { model: Team, as: 'team1', attributes: ['id', 'name', 'avatar'] },
      { model: Team, as: 'team2', attributes: ['id', 'name', 'avatar'] },
      { model: Team, as: 'winner', attributes: ['id', 'name'] }
    ],
    order: [['createdAt', 'DESC']]
  });
  res.json(matches);
});

// Матчи конкретной команды
app.get('/api/teams/:id/matches', async (req, res) => {
  const matches = await Match.findAll({
    where: {
      [Op.or]: [{ team1_id: req.params.id }, { team2_id: req.params.id }]
    },
    include: [
      { model: Team, as: 'team1', attributes: ['id', 'name', 'avatar'] },
      { model: Team, as: 'team2', attributes: ['id', 'name', 'avatar'] },
      { model: Team, as: 'winner', attributes: ['id', 'name'] }
    ],
    order: [['createdAt', 'DESC']]
  });
  res.json(matches);
});

// Создание матча (только лидер)
app.post('/api/matches', async (req, res) => {
  if (!isLeader(req)) return res.status(403).json({ error: 'Только лидер может создавать матчи' });
  const { team1_id, team2_id, team1_score, team2_score } = req.body;
  if (!team1_id || !team2_id || team1_score === undefined || team2_score === undefined) {
    return res.status(400).json({ error: 'Не все поля заполнены' });
  }
  if (team1_id === team2_id) return res.status(400).json({ error: 'Команды должны быть разными' });

  const team1 = await Team.findByPk(team1_id);
  const team2 = await Team.findByPk(team2_id);
  if (!team1 || !team2) return res.status(404).json({ error: 'Команда не найдена' });

  // Определяем победителя
  let winner_id = null;
  if (team1_score > team2_score) winner_id = team1_id;
  else if (team2_score > team1_score) winner_id = team2_id;

  // Создаем запись матча
  const match = await Match.create({
    team1_id,
    team2_id,
    team1_score,
    team2_score,
    winner_id,
    createdBy: req.session.user.id
  });

  // Обновляем рейтинг (простая система: победитель +10, проигравший -5)
  if (winner_id) {
    if (winner_id === team1_id) {
      team1.rating += 10;
      team2.rating -= 5;
    } else {
      team2.rating += 10;
      team1.rating -= 5;
    }
    await team1.save();
    await team2.save();
  } else {
    // Ничья: обоим +2
    team1.rating += 2;
    team2.rating += 2;
    await team1.save();
    await team2.save();
  }

  res.json(match);
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
