const express = require('express');
const router = express.Router();
const { Match, Team, User } = require('../models');
const authMiddleware = require('../middleware/auth');
const leaderMiddleware = require('../middleware/leader');
const { Op } = require('sequelize');

// Функция пересчета рейтинга
async function updateRatings(team1Id, team2Id, score1, score2) {
  const team1 = await Team.findByPk(team1Id);
  const team2 = await Team.findByPk(team2Id);
  if (!team1 || !team2) return;

  let delta1 = 0, delta2 = 0;
  if (score1 > score2) {
    delta1 = 10;
    delta2 = -5;
  } else if (score1 < score2) {
    delta1 = -5;
    delta2 = 10;
  } // ничья - без изменений

  team1.rating += delta1;
  team2.rating += delta2;
  await team1.save();
  await team2.save();
}

// Страница истории всех матчей
router.get('/', async (req, res) => {
  try {
    const matches = await Match.findAll({
      include: [
        { model: Team, as: 'team1' },
        { model: Team, as: 'team2' },
        { model: User, as: 'creator' }
      ],
      order: [['date', 'DESC']]
    });
    res.render('matches', { user: req.session.user, matches });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// Создание матча (только лидер)
router.get('/create', leaderMiddleware, async (req, res) => {
  try {
    const teams = await Team.findAll();
    res.render('create_match', { user: req.session.user, teams, error: null });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

router.post('/create', leaderMiddleware, async (req, res) => {
  const { team1Id, team2Id, team1Score, team2Score, date } = req.body;
  // Проверка, что команды разные
  if (team1Id === team2Id) {
    const teams = await Team.findAll();
    return res.render('create_match', { user: req.session.user, teams, error: 'Команды должны быть разными' });
  }

  try {
    const match = await Match.create({
      team1Id,
      team2Id,
      team1Score: parseInt(team1Score),
      team2Score: parseInt(team2Score),
      date: date || new Date(),
      createdBy: req.session.user.id
    });

    // Пересчет рейтинга
    await updateRatings(team1Id, team2Id, parseInt(team1Score), parseInt(team2Score));

    res.redirect('/matches');
  } catch (error) {
    console.error(error);
    const teams = await Team.findAll();
    res.render('create_match', { user: req.session.user, teams, error: 'Ошибка создания матча' });
  }
});

module.exports = router;