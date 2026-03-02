const express = require('express');
const router = express.Router();
const multer = require('multer');
const { Team, User, TeamMember, Match } = require('../models');
const authMiddleware = require('../middleware/auth');
const leaderMiddleware = require('../middleware/leader');

// Настройка multer для загрузки аватара (в память, потом base64)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 2 * 1024 * 1024 } }); // макс 2 МБ

// Список всех команд
router.get('/', async (req, res) => {
  try {
    const teams = await Team.findAll({ include: [{ model: User, as: 'creator' }] });
    res.render('teams', { user: req.session.user, teams });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// Страница команды
router.get('/:id', async (req, res) => {
  try {
    const team = await Team.findByPk(req.params.id, {
      include: [
        { model: User, as: 'creator' },
        { model: User, through: { attributes: [] } } // игроки
      ]
    });
    if (!team) return res.status(404).send('Команда не найдена');

    // Получаем матчи, где участвует команда
    const matches = await Match.findAll({
      where: {
        [Op.or]: [{ team1Id: team.id }, { team2Id: team.id }]
      },
      include: [
        { model: Team, as: 'team1' },
        { model: Team, as: 'team2' },
        { model: User, as: 'creator' }
      ],
      order: [['date', 'DESC']]
    });

    res.render('team', { user: req.session.user, team, matches });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// Создание команды (только лидер)
router.get('/create', leaderMiddleware, (req, res) => {
  res.render('create_team', { user: req.session.user, error: null });
});

router.post('/create', leaderMiddleware, upload.single('avatar'), async (req, res) => {
  const { name } = req.body;
  let avatarBase64 = null;
  if (req.file) {
    avatarBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  }

  try {
    const existingTeam = await Team.findOne({ where: { name } });
    if (existingTeam) {
      return res.render('create_team', { user: req.session.user, error: 'Команда с таким именем уже существует' });
    }

    await Team.create({
      name,
      avatar: avatarBase64,
      createdBy: req.session.user.id
    });
    res.redirect('/teams');
  } catch (error) {
    console.error(error);
    res.render('create_team', { user: req.session.user, error: 'Ошибка создания команды' });
  }
});

// Редактирование команды (только лидер)
router.get('/:id/edit', leaderMiddleware, async (req, res) => {
  try {
    const team = await Team.findByPk(req.params.id);
    if (!team) return res.status(404).send('Команда не найдена');
    res.render('edit_team', { user: req.session.user, team, error: null });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

router.post('/:id/edit', leaderMiddleware, upload.single('avatar'), async (req, res) => {
  const { name } = req.body;
  try {
    const team = await Team.findByPk(req.params.id);
    if (!team) return res.status(404).send('Команда не найдена');

    // Проверка уникальности имени, если меняется
    if (name !== team.name) {
      const existing = await Team.findOne({ where: { name } });
      if (existing) {
        return res.render('edit_team', { user: req.session.user, team, error: 'Команда с таким именем уже существует' });
      }
    }

    team.name = name;
    if (req.file) {
      team.avatar = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }
    await team.save();
    res.redirect(`/teams/${team.id}`);
  } catch (error) {
    console.error(error);
    res.render('edit_team', { user: req.session.user, team, error: 'Ошибка обновления' });
  }
});

// Добавление игрока в команду (только лидер)
router.post('/:id/add-player', leaderMiddleware, async (req, res) => {
  const { username } = req.body;
  try {
    const team = await Team.findByPk(req.params.id);
    if (!team) return res.status(404).send('Команда не найдена');

    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.redirect(`/teams/${team.id}?error=Пользователь не найден`);
    }

    // Проверка, не состоит ли уже
    const existing = await TeamMember.findOne({ where: { teamId: team.id, userId: user.id } });
    if (existing) {
      return res.redirect(`/teams/${team.id}?error=Игрок уже в команде`);
    }

    await TeamMember.create({ teamId: team.id, userId: user.id });
    res.redirect(`/teams/${team.id}`);
  } catch (error) {
    console.error(error);
    res.redirect(`/teams/${req.params.id}?error=Ошибка добавления игрока`);
  }
});

module.exports = router;