const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { User } = require('../models');

// Генерация случайной капчи
const generateCaptcha = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let captcha = '';
  for (let i = 0; i < 6; i++) {
    captcha += chars[Math.floor(Math.random() * chars.length)];
  }
  return captcha;
};

// Страница входа
router.get('/login', (req, res) => {
  res.render('login', { user: req.session.user, error: null });
});

// Обработка входа
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.render('login', { user: req.session.user, error: 'Неверное имя или пароль' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('login', { user: req.session.user, error: 'Неверное имя или пароль' });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// Страница регистрации
router.get('/register', (req, res) => {
  const captcha = generateCaptcha();
  req.session.captcha = { code: captcha, expires: Date.now() + 5 * 60 * 1000 }; // 5 минут
  res.render('register', { user: req.session.user, captcha, error: null });
});

// Обработка регистрации
router.post('/register', async (req, res) => {
  const { username, password, confirmPassword, captchaInput } = req.body;

  // Проверка капчи
  if (!req.session.captcha || req.session.captcha.expires < Date.now() || req.session.captcha.code !== captchaInput) {
    const captcha = generateCaptcha();
    req.session.captcha = { code: captcha, expires: Date.now() + 5 * 60 * 1000 };
    return res.render('register', { user: req.session.user, captcha, error: 'Неверный код подтверждения' });
  }
  // Удаляем капчу после использования (одноразовость)
  delete req.session.captcha;

  if (password !== confirmPassword) {
    const captcha = generateCaptcha();
    req.session.captcha = { code: captcha, expires: Date.now() + 5 * 60 * 1000 };
    return res.render('register', { user: req.session.user, captcha, error: 'Пароли не совпадают' });
  }

  try {
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      const captcha = generateCaptcha();
      req.session.captcha = { code: captcha, expires: Date.now() + 5 * 60 * 1000 };
      return res.render('register', { user: req.session.user, captcha, error: 'Имя уже занято' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let role = 'user';
    if (username === 'Quantum') {
      role = 'leader';
    }
    const newUser = await User.create({ username, password: hashedPassword, role });
    req.session.user = { id: newUser.id, username: newUser.username, role: newUser.role };
    res.redirect('/');
  } catch (error) {
    console.error(error);
    const captcha = generateCaptcha();
    req.session.captcha = { code: captcha, expires: Date.now() + 5 * 60 * 1000 };
    res.render('register', { user: req.session.user, captcha, error: 'Ошибка регистрации' });
  }
});

// Выход
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;