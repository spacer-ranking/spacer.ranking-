const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'cyber-ranking-secret-key-2024';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(__dirname));

// Создаем папку для загрузок
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}
app.use('/uploads', express.static('uploads'));

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

// Инициализация таблиц (БЕЗ автоматического создания пользователей)
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
            rating INTEGER DEFAULT 1000,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (leader_id) REFERENCES users(id)
        )`);

        // Таблица участников команды
        db.run(`CREATE TABLE IF NOT EXISTS team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER,
            user_id INTEGER,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (team_id) REFERENCES teams(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(team_id, user_id)
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
        console.log('📝 Все пользователи создаются только через регистрацию');
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
    
    // Проверка кода подтверждения
    if (!code || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: 'Неверный код подтверждения' });
    }

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    if (username.length < 3) {
        return res.status(400).json({ error: 'Имя должно быть не менее 3 символов' });
    }

    if (password.length < 4) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 4 символов' });
    }

    if (!email.includes('@') || !email.includes('.')) {
        return res.status(400).json({ error: 'Введите корректный email' });
    }

    try {
        // Проверяем существует ли пользователь
        db.get("SELECT * FROM users WHERE username = ? OR email = ?", [username, email], async (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Ошибка базы данных' });
            }

            if (user) {
                if (user.username === username) {
                    return res.status(400).json({ error: 'Это имя уже используется' });
                }
                if (user.email === email) {
                    return res.status(400).json({ error: 'Этот email уже используется' });
                }
            }

            // Хешируем пароль
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Создаем пользователя (все новые пользователи получают роль 'user')
            db.run("INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
                [username, email, hashedPassword, 'user'],
                function(err) {
                    if (err) {
                        console.error('Insert error:', err);
                        return res.status(500).json({ error: 'Ошибка регистрации' });
                    }
                    
                    // Создаем токен
                    const token = jwt.sign(
                        { id: this.lastID, username, email, role: 'user' }, 
                        SECRET_KEY,
                        { expiresIn: '7d' }
                    );
                    
                    // Устанавливаем куки
                    res.cookie('token', token, { 
                        httpOnly: true,
                        maxAge: 7 * 24 * 60 * 60 * 1000,
                        sameSite: 'lax'
                    });
                    
                    console.log('✅ Новый пользователь зарегистрирован:', username);
                    res.json({ 
                        success: true, 
                        user: { id: this.lastID, username, email, role: 'user' }
                    });
                });
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }

        if (!user) {
            return res.status(400).json({ error: 'Пользователь не найден' });
        }

        try {
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(400).json({ error: 'Неверный пароль' });
            }

            // Создаем токен
            const token = jwt.sign(
                { id: user.id, username: user.username, email: user.email, role: user.role }, 
                SECRET_KEY,
                { expiresIn: '7d' }
            );
            
            // Устанавливаем куки
            res.cookie('token', token, { 
                httpOnly: true,
                maxAge: 7 * 24 * 60 * 60 * 1000,
                sameSite: 'lax'
            });
            
            console.log('✅ Пользователь вошел:', username);
            res.json({ 
                success: true, 
                user: { id: user.id, username: user.username, email: user.email, role: user.role }
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });
});

// Запрос на восстановление пароля
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (!user) {
            return res.status(404).json({ error: 'Email не найден' });
        }

        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        resetCodes.set(email, {
            code: resetCode,
            expires: Date.now() + 15 * 60 * 1000
        });

        // Выводим код в консоль (для тестирования)
        console.log(`\n🔐 Код восстановления для ${email}: ${resetCode}\n`);
        
        res.json({ success: true, message: 'Код восстановления отправлен' });
    });
});

// Проверка кода восстановления
app.post('/api/verify-reset-code', (req, res) => {
    const { email, code } = req.body;
    const resetData = resetCodes.get(email);

    if (!resetData || resetData.code !== code || Date.now() > resetData.expires) {
        return res.status(400).json({ error: 'Недействительный код' });
    }

    res.json({ success: true });
});

// Сброс пароля
app.post('/api/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    const resetData = resetCodes.get(email);

    if (!resetData || resetData.code !== code || Date.now() > resetData.expires) {
        return res.status(400).json({ error: 'Недействительный код' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.run("UPDATE users SET password = ? WHERE email = ?", [hashedPassword, email], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Ошибка обновления пароля' });
        }
        
        resetCodes.delete(email);
        console.log('✅ Пароль изменен для:', email);
        res.json({ success: true });
    });
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

// Выход
app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// Получение рейтинга команд
app.get('/api/teams/ranking', (req, res) => {
    db.all(`
        SELECT t.*, 
               COUNT(DISTINCT tm.user_id) as members_count,
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
            console.error('Ranking error:', err);
            return res.status(500).json({ error: 'Ошибка получения рейтинга' });
        }
        res.json(teams || []);
    });
});

// Получение всех команд
app.get('/api/teams', (req, res) => {
    db.all("SELECT * FROM teams ORDER BY name", [], (err, teams) => {
        if (err) {
            console.error('Teams error:', err);
            return res.status(500).json({ error: 'Ошибка получения команд' });
        }
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
        if (err) {
            console.error('Team error:', err);
            return res.status(500).json({ error: 'Ошибка получения команды' });
        }
        
        if (!team) {
            return res.status(404).json({ error: 'Команда не найдена' });
        }
        
        // Получаем участников
        db.all(`
            SELECT u.id, u.username, u.avatar 
            FROM team_members tm
            JOIN users u ON tm.user_id = u.id
            WHERE tm.team_id = ?
        `, [teamId], (err, members) => {
            team.members = members || [];
            
            // Получаем матчи команды
            db.all(`
                SELECT m.*, 
                       t1.name as team1_name, 
                       t2.name as team2_name,
                       t1.avatar as team1_avatar,
                       t2.avatar as team2_avatar
                FROM matches m
                JOIN teams t1 ON m.team1_id = t1.id
                JOIN teams t2 ON m.team2_id = t2.id
                WHERE m.team1_id = ? OR m.team2_id = ?
                ORDER BY m.match_date DESC
                LIMIT 20
            `, [teamId, teamId], (err, matches) => {
                team.matches = matches || [];
                res.json(team);
            });
        });
    });
});

// Создание команды (только лидер)
app.post('/api/teams', authenticateToken, isLeader, (req, res) => {
    const { name } = req.body;
    
    if (!name || name.length < 2) {
        return res.status(400).json({ error: 'Название должно быть не менее 2 символов' });
    }
    
    db.get("SELECT * FROM teams WHERE name = ?", [name], (err, team) => {
        if (team) {
            return res.status(400).json({ error: 'Команда с таким названием уже существует' });
        }
        
        db.run("INSERT INTO teams (name, leader_id) VALUES (?, ?)",
            [name, req.user.id],
            function(err) {
                if (err) {
                    console.error('Create team error:', err);
                    return res.status(500).json({ error: 'Ошибка создания команды' });
                }
                
                // Добавляем лидера в команду
                db.run("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)",
                    [this.lastID, req.user.id]);
                
                console.log('✅ Команда создана:', name, 'лидер:', req.user.username);
                res.json({ success: true, id: this.lastID, name });
            });
    });
});

// Добавление игрока в команду (только лидер)
app.post('/api/teams/:teamId/members', authenticateToken, isLeader, (req, res) => {
    const teamId = req.params.teamId;
    const { username } = req.body;
    
    if (!username) {
        return res.status(400).json({ error: 'Укажите имя игрока' });
    }
    
    // Проверяем, является ли пользователь лидером этой команды
    db.get("SELECT * FROM teams WHERE id = ? AND leader_id = ?", [teamId, req.user.id], (err, team) => {
        if (!team) {
            return res.status(403).json({ error: 'Вы не являетесь лидером этой команды' });
        }
        
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
            if (!user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            
            db.run("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)",
                [teamId, user.id],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Ошибка добавления игрока' });
                    }
                    console.log('✅ Игрок добавлен в команду:', username);
                    res.json({ success: true, message: 'Игрок добавлен в команду' });
                });
        });
    });
});

// Создание матча (только лидер)
app.post('/api/matches', authenticateToken, isLeader, (req, res) => {
    const { team1_id, team2_id, team1_score, team2_score } = req.body;
    
    if (!team1_id || !team2_id) {
        return res.status(400).json({ error: 'Выберите обе команды' });
    }
    
    if (team1_id === team2_id) {
        return res.status(400).json({ error: 'Команды должны быть разными' });
    }
    
    // Определяем победителя
    let winner_id = null;
    if (team1_score > team2_score) winner_id = team1_id;
    else if (team2_score > team1_score) winner_id = team2_id;
    
    db.run(`
        INSERT INTO matches (team1_id, team2_id, team1_score, team2_score, winner_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [team1_id, team2_id, team1_score, team2_score, winner_id, req.user.id],
    function(err) {
        if (err) {
            console.error('Create match error:', err);
            return res.status(500).json({ error: 'Ошибка создания матча' });
        }
        
        // Обновляем рейтинги команд
        if (winner_id) {
            const loser_id = winner_id == team1_id ? team2_id : team1_id;
            
            db.run("UPDATE teams SET rating = rating + 25 WHERE id = ?", [winner_id]);
            db.run("UPDATE teams SET rating = rating - 25 WHERE id = ?", [loser_id]);
        }
        
        console.log('✅ Матч создан');
        res.json({ success: true, match_id: this.lastID });
    });
});

// Получение истории матчей
app.get('/api/matches', (req, res) => {
    db.all(`
        SELECT m.*, 
               t1.name as team1_name, t1.avatar as team1_avatar,
               t2.name as team2_name, t2.avatar as team2_avatar,
               w.name as winner_name
        FROM matches m
        JOIN teams t1 ON m.team1_id = t1.id
        JOIN teams t2 ON m.team2_id = t2.id
        LEFT JOIN teams w ON m.winner_id = w.id
        ORDER BY m.match_date DESC
        LIMIT 50
    `, [], (err, matches) => {
        if (err) {
            console.error('Matches error:', err);
            return res.status(500).json({ error: 'Ошибка получения матчей' });
        }
        res.json(matches || []);
    });
});

// Функция для выдачи роли лидера (только через прямой запрос к БД)
// Это можно сделать через отдельный API эндпоинт или вручную

// Запуск сервера
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📱 Локальный доступ: http://localhost:${PORT}`);
    console.log(`\n📝 Информация:`);
    console.log(`   • Все пользователи создаются через регистрацию`);
    console.log(`   • По умолчанию все получают роль 'user'`);
    console.log(`   • Роль 'leader' выдается отдельно`);
    console.log(`   • База данных: cyber_ranking.db\n`);
});
