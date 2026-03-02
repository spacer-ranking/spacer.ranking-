const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'cyber-ranking-secret-key-2024';

// Настройка multer для загрузки аватарок
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

// Настройка почтового транспорта
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'cyber.rank.esports@gmail.com',
        pass: 'ваш_пароль_приложения' // замените на реальный пароль
    }
});

// Хранилище кодов восстановления
const resetCodes = new Map();

// Подключение к базе данных
const db = new sqlite3.Database('./cyber_ranking.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err);
    } else {
        console.log('Подключено к SQLite базе данных');
        initDatabase();
    }
});

// Инициализация таблиц
function initDatabase() {
    db.serialize(() => {
        // Таблица пользователей
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            avatar TEXT DEFAULT '/default-avatar.png',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Таблица команд
        db.run(`CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            avatar TEXT DEFAULT '/default-team.png',
            leader_id INTEGER,
            rating INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (leader_id) REFERENCES users(id)
        )`);

        // Таблица участников команды
        db.run(`CREATE TABLE IF NOT EXISTS team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER,
            member_name TEXT NOT NULL,
            role TEXT DEFAULT 'Игрок',
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (team_id) REFERENCES teams(id),
            UNIQUE(team_id, member_name)
        )`);

        // Таблица матчей
        db.run(`CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team1_id INTEGER,
            team2_id INTEGER,
            team1_score INTEGER DEFAULT 0,
            team2_score INTEGER DEFAULT 0,
            winner_id INTEGER,
            status TEXT DEFAULT 'completed',
            match_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER,
            FOREIGN KEY (team1_id) REFERENCES teams(id),
            FOREIGN KEY (team2_id) REFERENCES teams(id),
            FOREIGN KEY (winner_id) REFERENCES teams(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        )`);

        console.log('✅ База данных инициализирована');
    });
}

// Мидлвар для проверки авторизации
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Не авторизован' });

    try {
        const user = jwt.verify(token, SECRET_KEY);
        req.user = user;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Недействительный токен' });
    }
};

// Мидлвар для проверки роли лидера
const isLeader = (req, res, next) => {
    if (req.user.role !== 'leader') {
        return res.status(403).json({ error: 'Требуются права лидера' });
    }
    next();
};

// ============== API РОУТЫ ==============

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, email, password, code } = req.body;
    
    if (!code || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: 'Неверный код подтверждения' });
    }

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    try {
        db.get("SELECT * FROM users WHERE username = ? OR email = ?", [username, email], async (err, user) => {
            if (err) return res.status(500).json({ error: 'Ошибка базы данных' });

            if (user) {
                if (user.username === username) return res.status(400).json({ error: 'Имя уже используется' });
                if (user.email === email) return res.status(400).json({ error: 'Email уже используется' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const role = (username === 'Quantum') ? 'leader' : 'user';
            
            db.run("INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
                [username, email, hashedPassword, role],
                function(err) {
                    if (err) return res.status(500).json({ error: 'Ошибка регистрации' });
                    
                    const token = jwt.sign(
                        { id: this.lastID, username, email, role }, 
                        SECRET_KEY,
                        { expiresIn: '7d' }
                    );
                    
                    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
                    res.json({ success: true, user: { id: this.lastID, username, email, role } });
                });
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Ошибка базы данных' });
        if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Неверный пароль' });

        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email, role: user.role }, 
            SECRET_KEY,
            { expiresIn: '7d' }
        );
        
        res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
    });
});

// Выход
app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// Получение текущего пользователя
app.get('/api/me', (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json(null);

    try {
        const user = jwt.verify(token, SECRET_KEY);
        res.json(user);
    } catch (err) {
        res.clearCookie('token');
        res.json(null);
    }
});

// Восстановление пароля
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (!user) return res.status(404).json({ error: 'Email не найден' });

        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        resetCodes.set(email, {
            code: resetCode,
            expires: Date.now() + 15 * 60 * 1000
        });

        const mailOptions = {
            from: 'cyber.rank.esports@gmail.com',
            to: email,
            subject: 'Восстановление пароля - Cyber Rank',
            html: `
                <div style="font-family: Arial, sans-serif; background: #0a0c0f; color: #fff; padding: 20px;">
                    <h2 style="color: #ff4655;">Восстановление пароля</h2>
                    <p>Здравствуйте, ${user.username}!</p>
                    <p>Ваш код для восстановления пароля:</p>
                    <div style="font-size: 24px; font-weight: bold; color: #ff4655; padding: 10px; background: #000; border-radius: 5px;">${resetCode}</div>
                    <p>Код действителен 15 минут.</p>
                </div>
            `
        };

        try {
            await transporter.sendMail(mailOptions);
            res.json({ success: true, message: 'Код отправлен на email' });
        } catch (error) {
            console.error('Email error:', error);
            res.status(500).json({ error: 'Ошибка отправки email' });
        }
    });
});

app.post('/api/verify-reset-code', (req, res) => {
    const { email, code } = req.body;
    const resetData = resetCodes.get(email);
    if (!resetData || resetData.code !== code || Date.now() > resetData.expires) {
        return res.status(400).json({ error: 'Недействительный код' });
    }
    res.json({ success: true });
});

app.post('/api/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    const resetData = resetCodes.get(email);
    if (!resetData || resetData.code !== code || Date.now() > resetData.expires) {
        return res.status(400).json({ error: 'Недействительный код' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.run("UPDATE users SET password = ? WHERE email = ?", [hashedPassword, email], function(err) {
        if (err) return res.status(500).json({ error: 'Ошибка обновления пароля' });
        resetCodes.delete(email);
        res.json({ success: true });
    });
});

// ========== КОМАНДЫ ==========

// Получение рейтинга команд
app.get('/api/teams/ranking', (req, res) => {
    db.all(`
        SELECT t.*, 
               COUNT(DISTINCT tm.id) as members_count,
               COUNT(DISTINCT m.id) as matches_count,
               u.username as leader_name
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
        LEFT JOIN matches m ON t.id = m.team1_id OR t.id = m.team2_id
        LEFT JOIN users u ON t.leader_id = u.id
        GROUP BY t.id
        ORDER BY t.rating DESC
    `, [], (err, teams) => {
        if (err) {
            console.error(err);
            return res.json([]);
        }
        res.json(teams || []);
    });
});

// Получение всех команд
app.get('/api/teams', (req, res) => {
    db.all("SELECT * FROM teams ORDER BY name", [], (err, teams) => {
        res.json(teams || []);
    });
});

// Получение команды по ID
app.get('/api/teams/:id', (req, res) => {
    const teamId = req.params.id;
    
    db.get(`
        SELECT t.*, u.username as leader_name 
        FROM teams t
        LEFT JOIN users u ON t.leader_id = u.id
        WHERE t.id = ?
    `, [teamId], (err, team) => {
        if (!team) return res.status(404).json({ error: 'Команда не найдена' });
        
        db.all(`
            SELECT id, member_name, role
            FROM team_members
            WHERE team_id = ?
        `, [teamId], (err, members) => {
            team.members = members || [];
            
            db.all(`
                SELECT m.*, t1.name as team1_name, t2.name as team2_name,
                       t1.avatar as team1_avatar, t2.avatar as team2_avatar
                FROM matches m
                JOIN teams t1 ON m.team1_id = t1.id
                JOIN teams t2 ON m.team2_id = t2.id
                WHERE m.team1_id = ? OR m.team2_id = ?
                ORDER BY m.match_date DESC LIMIT 20
            `, [teamId, teamId], (err, matches) => {
                team.matches = matches || [];
                res.json(team);
            });
        });
    });
});

// Создание команды
app.post('/api/teams', authenticateToken, isLeader, (req, res) => {
    const { name } = req.body;
    
    if (!name || name.length < 2) {
        return res.status(400).json({ error: 'Название должно быть не менее 2 символов' });
    }
    
    db.get("SELECT * FROM teams WHERE name = ?", [name], (err, team) => {
        if (team) return res.status(400).json({ error: 'Команда уже существует' });
        
        db.run("INSERT INTO teams (name, leader_id, rating) VALUES (?, ?, 0)",
            [name, req.user.id],
            function(err) {
                if (err) return res.status(500).json({ error: 'Ошибка создания команды' });
                
                db.run("INSERT INTO team_members (team_id, member_name, role) VALUES (?, ?, 'Капитан')",
                    [this.lastID, req.user.username]);
                
                res.json({ success: true, id: this.lastID, name });
            });
    });
});

// Загрузка аватара команды
app.post('/api/teams/:teamId/avatar', authenticateToken, isLeader, upload.single('avatar'), (req, res) => {
    const teamId = req.params.teamId;
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    db.get("SELECT * FROM teams WHERE id = ? AND leader_id = ?", [teamId, req.user.id], (err, team) => {
        if (!team) return res.status(403).json({ error: 'Вы не лидер этой команды' });

        const avatarUrl = `/uploads/${req.file.filename}`;
        db.run("UPDATE teams SET avatar = ? WHERE id = ?", [avatarUrl, teamId], function(err) {
            if (err) return res.status(500).json({ error: 'Ошибка обновления аватара' });
            res.json({ success: true, avatar: avatarUrl });
        });
    });
});

// Удаление команды
app.delete('/api/teams/:teamId', authenticateToken, isLeader, (req, res) => {
    const teamId = req.params.teamId;

    db.get("SELECT * FROM teams WHERE id = ? AND leader_id = ?", [teamId, req.user.id], (err, team) => {
        if (!team) return res.status(403).json({ error: 'Вы не лидер этой команды' });

        db.run("DELETE FROM matches WHERE team1_id = ? OR team2_id = ?", [teamId, teamId]);
        db.run("DELETE FROM team_members WHERE team_id = ?", [teamId]);
        db.run("DELETE FROM teams WHERE id = ?", [teamId], function(err) {
            if (err) return res.status(500).json({ error: 'Ошибка удаления команды' });
            res.json({ success: true });
        });
    });
});

// ========== УЧАСТНИКИ ==========

// Добавление игрока
app.post('/api/teams/:teamId/members', authenticateToken, isLeader, (req, res) => {
    const teamId = req.params.teamId;
    const { member_name, role } = req.body;
    
    if (!member_name) return res.status(400).json({ error: 'Укажите имя игрока' });
    
    db.get("SELECT * FROM teams WHERE id = ? AND leader_id = ?", [teamId, req.user.id], (err, team) => {
        if (!team) return res.status(403).json({ error: 'Вы не лидер этой команды' });
        
        db.run("INSERT OR IGNORE INTO team_members (team_id, member_name, role) VALUES (?, ?, ?)",
            [teamId, member_name, role || 'Игрок'], function(err) {
                if (err) return res.status(500).json({ error: 'Ошибка добавления' });
                res.json({ success: true });
            });
    });
});

// Обновление роли
app.put('/api/teams/:teamId/members/:memberId', authenticateToken, isLeader, (req, res) => {
    const teamId = req.params.teamId;
    const memberId = req.params.memberId;
    const { role } = req.body;

    db.get("SELECT * FROM teams WHERE id = ? AND leader_id = ?", [teamId, req.user.id], (err, team) => {
        if (!team) return res.status(403).json({ error: 'Вы не лидер этой команды' });

        db.run("UPDATE team_members SET role = ? WHERE id = ? AND team_id = ?",
            [role, memberId, teamId], function(err) {
                if (err) return res.status(500).json({ error: 'Ошибка обновления роли' });
                res.json({ success: true });
            });
    });
});

// Удаление игрока
app.delete('/api/teams/:teamId/members/:memberId', authenticateToken, isLeader, (req, res) => {
    const teamId = req.params.teamId;
    const memberId = req.params.memberId;

    db.get("SELECT * FROM teams WHERE id = ? AND leader_id = ?", [teamId, req.user.id], (err, team) => {
        if (!team) return res.status(403).json({ error: 'Вы не лидер этой команды' });

        db.get("SELECT member_name FROM team_members WHERE id = ?", [memberId], (err, member) => {
            if (member && member.member_name === req.user.username) {
                return res.status(400).json({ error: 'Нельзя удалить лидера команды' });
            }
            db.run("DELETE FROM team_members WHERE id = ? AND team_id = ?", [memberId, teamId], function(err) {
                if (err) return res.status(500).json({ error: 'Ошибка удаления игрока' });
                res.json({ success: true });
            });
        });
    });
});

// ========== МАТЧИ ==========

// Создание матча
app.post('/api/matches', authenticateToken, isLeader, (req, res) => {
    const { team1_id, team2_id, team1_score, team2_score } = req.body;
    
    if (!team1_id || !team2_id) return res.status(400).json({ error: 'Выберите обе команды' });
    if (team1_id === team2_id) return res.status(400).json({ error: 'Команды должны быть разными' });
    
    let winner_id = null;
    if (team1_score > team2_score) winner_id = team1_id;
    else if (team2_score > team1_score) winner_id = team2_id;
    
    db.run(`
        INSERT INTO matches (team1_id, team2_id, team1_score, team2_score, winner_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [team1_id, team2_id, team1_score, team2_score, winner_id, req.user.id],
    function(err) {
        if (err) return res.status(500).json({ error: 'Ошибка создания матча' });
        
        if (winner_id) {
            const loser_id = winner_id == team1_id ? team2_id : team1_id;
            db.run("UPDATE teams SET rating = rating + 25 WHERE id = ?", [winner_id]);
            db.run("UPDATE teams SET rating = rating - 25 WHERE id = ?", [loser_id]);
        }
        
        res.json({ success: true, match_id: this.lastID });
    });
});

// Получение матчей
app.get('/api/matches', (req, res) => {
    db.all(`
        SELECT m.*, t1.name as team1_name, t2.name as team2_name,
               t1.avatar as team1_avatar, t2.avatar as team2_avatar
        FROM matches m
        JOIN teams t1 ON m.team1_id = t1.id
        JOIN teams t2 ON m.team2_id = t2.id
        ORDER BY m.match_date DESC LIMIT 50
    `, [], (err, matches) => {
        if (err) {
            console.error(err);
            return res.json([]);
        }
        res.json(matches || []);
    });
});

// Удаление матча
app.delete('/api/matches/:matchId', authenticateToken, isLeader, (req, res) => {
    const matchId = req.params.matchId;

    db.get("SELECT * FROM matches WHERE id = ? AND created_by = ?", [matchId, req.user.id], (err, match) => {
        if (!match) return res.status(403).json({ error: 'Вы не создатель этого матча' });

        db.run("DELETE FROM matches WHERE id = ?", [matchId], function(err) {
            if (err) return res.status(500).json({ error: 'Ошибка удаления матча' });
            res.json({ success: true });
        });
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 СЕРВЕР ЗАПУЩЕН');
    console.log('='.repeat(50));
    console.log(`📱 Порт: ${PORT}`);
    console.log('='.repeat(50) + '\n');
});