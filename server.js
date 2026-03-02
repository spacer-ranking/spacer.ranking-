require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer'); // для возможной загрузки аватаров (здесь не используется, но оставим)
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка подключения к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Создание таблиц (если их нет)
const createTables = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(10) DEFAULT 'user',
        team_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        avatar_url TEXT,
        rating INTEGER DEFAULT 1000,
        leader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        team1_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        team2_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        score1 INTEGER NOT NULL,
        score2 INTEGER NOT NULL,
        match_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        winner_id INTEGER REFERENCES teams(id)
      );
    `);
    // Добавим внешний ключ для users.team_id после создания teams
    await client.query(`
      ALTER TABLE users ADD CONSTRAINT fk_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
    `).catch(() => {}); // игнорируем ошибку, если约束 уже существует
  } finally {
    client.release();
  }
};
createTables().catch(console.error);

// Настройка сессий с хранением в БД
const sessionStore = new pgSession({
  pool: pool,
  tableName: 'session' // будет создана автоматически
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 дней
}));

// Статические файлы (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// ========== API маршруты ==========

// Получение кода подтверждения для регистрации
app.post('/api/auth/get-code', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Имя пользователя обязательно' });

  try {
    // Проверка уникальности имени
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Имя уже занято' });
    }

    // Генерация 6-значного кода
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // Сохраняем код в сессии (время жизни - 5 минут)
    req.session.registrationCode = {
      username,
      code,
      expires: Date.now() + 5 * 60 * 1000
    };

    res.json({ code }); // отправляем код клиенту для отображения
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Регистрация
app.post('/api/auth/register', async (req, res) => {
  const { username, password, code } = req.body;

  if (!username || !password || !code) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }

  // Проверка кода из сессии
  const saved = req.session.registrationCode;
  if (!saved || saved.username !== username || saved.code !== code || saved.expires < Date.now()) {
    return res.status(400).json({ error: 'Неверный или просроченный код подтверждения' });
  }

  try {
    // Повторная проверка уникальности (на случай, если кто-то успел занять имя)
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Имя уже занято' });
    }

    // Хеширование пароля
    const hash = await bcrypt.hash(password, 10);
    // Роль: если имя Quantum, то leader, иначе user
    const role = username === 'Quantum' ? 'leader' : 'user';

    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hash, role]
    );

    // Удаляем код из сессии
    delete req.session.registrationCode;

    // Автоматически логиним пользователя
    req.session.userId = result.rows[0].id;
    req.session.username = result.rows[0].username;
    req.session.role = result.rows[0].role;

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверное имя или пароль' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Неверное имя или пароль' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    res.json({ id: user.id, username: user.username, role: user.role, team_id: user.team_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Выход
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Ошибка при выходе' });
    res.json({ success: true });
  });
});

// Текущий пользователь
app.get('/api/auth/me', (req, res) => {
  if (req.session.userId) {
    res.json({
      id: req.session.userId,
      username: req.session.username,
      role: req.session.role
    });
  } else {
    res.status(401).json({ error: 'Не авторизован' });
  }
});

// Получить список команд (с рейтингом)
app.get('/api/teams', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, u.username as leader_name
      FROM teams t
      LEFT JOIN users u ON t.leader_id = u.id
      ORDER BY t.rating DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Создание команды (только лидер)
app.post('/api/teams', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'leader') {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const { name, avatar_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Название команды обязательно' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Проверка уникальности названия
    const existing = await client.query('SELECT id FROM teams WHERE name = $1', [name]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Команда с таким названием уже существует' });
    }

    // Создаём команду
    const result = await client.query(
      'INSERT INTO teams (name, avatar_url, leader_id) VALUES ($1, $2, $3) RETURNING *',
      [name, avatar_url || null, req.session.userId]
    );
    const team = result.rows[0];

    // Добавляем лидера в команду (обновляем его team_id)
    await client.query('UPDATE users SET team_id = $1 WHERE id = $2', [team.id, req.session.userId]);

    await client.query('COMMIT');
    res.json(team);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

// Обновление аватара команды (только лидер этой команды)
app.put('/api/teams/:id', async (req, res) => {
  const teamId = parseInt(req.params.id);
  const { avatar_url } = req.body;

  if (!req.session.userId || req.session.role !== 'leader') {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  try {
    // Проверяем, что текущий пользователь - лидер этой команды
    const team = await pool.query('SELECT * FROM teams WHERE id = $1 AND leader_id = $2', [teamId, req.session.userId]);
    if (team.rows.length === 0) {
      return res.status(403).json({ error: 'Вы не являетесь лидером этой команды' });
    }

    await pool.query('UPDATE teams SET avatar_url = $1 WHERE id = $2', [avatar_url, teamId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Добавление игрока в команду (только лидер команды)
app.post('/api/teams/:id/add-member', async (req, res) => {
  const teamId = parseInt(req.params.id);
  const { username } = req.body;

  if (!req.session.userId || req.session.role !== 'leader') {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Проверка, что текущий пользователь - лидер команды
    const teamCheck = await client.query('SELECT * FROM teams WHERE id = $1 AND leader_id = $2', [teamId, req.session.userId]);
    if (teamCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Вы не являетесь лидером этой команды' });
    }

    // Ищем пользователя по имени
    const user = await client.query('SELECT * FROM users WHERE username = $1', [username]);
    if (user.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const targetUser = user.rows[0];
    // Проверяем, что пользователь ещё не в команде
    if (targetUser.team_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Пользователь уже состоит в команде' });
    }

    // Добавляем в команду
    await client.query('UPDATE users SET team_id = $1 WHERE id = $2', [teamId, targetUser.id]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

// Получить участников команды
app.get('/api/teams/:id/members', async (req, res) => {
  const teamId = parseInt(req.params.id);
  try {
    const members = await pool.query('SELECT id, username, role FROM users WHERE team_id = $1', [teamId]);
    res.json(members.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить матчи команды
app.get('/api/teams/:id/matches', async (req, res) => {
  const teamId = parseInt(req.params.id);
  try {
    const matches = await pool.query(`
      SELECT m.*, t1.name as team1_name, t2.name as team2_name
      FROM matches m
      JOIN teams t1 ON m.team1_id = t1.id
      JOIN teams t2 ON m.team2_id = t2.id
      WHERE m.team1_id = $1 OR m.team2_id = $1
      ORDER BY m.match_date DESC
    `, [teamId]);
    res.json(matches.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить все последние матчи (для общей ленты)
app.get('/api/matches', async (req, res) => {
  try {
    const matches = await pool.query(`
      SELECT m.*, t1.name as team1_name, t2.name as team2_name
      FROM matches m
      JOIN teams t1 ON m.team1_id = t1.id
      JOIN teams t2 ON m.team2_id = t2.id
      ORDER BY m.match_date DESC
      LIMIT 20
    `);
    res.json(matches.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Создание матча (только лидер)
app.post('/api/matches', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'leader') {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const { team1_id, team2_id, score1, score2 } = req.body;
  if (!team1_id || !team2_id || score1 === undefined || score2 === undefined) {
    return res.status(400).json({ error: 'Не все данные заполнены' });
  }

  if (team1_id === team2_id) {
    return res.status(400).json({ error: 'Команды должны быть разными' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Определяем победителя
    let winner_id = null;
    if (score1 > score2) winner_id = team1_id;
    else if (score2 > score1) winner_id = team2_id;

    // Вставляем матч
    const matchResult = await client.query(
      `INSERT INTO matches (team1_id, team2_id, score1, score2, winner_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [team1_id, team2_id, score1, score2, winner_id]
    );

    // Обновляем рейтинг команд
    if (winner_id) {
      // Победитель +10, проигравший -5
      const loser_id = winner_id === team1_id ? team2_id : team1_id;
      await client.query('UPDATE teams SET rating = rating + 10 WHERE id = $1', [winner_id]);
      await client.query('UPDATE teams SET rating = rating - 5 WHERE id = $1', [loser_id]);
    } // при ничьей ничего не меняем

    await client.query('COMMIT');
    res.json(matchResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});