// Таблица участников команды (новая структура)
db.run(`CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER,
    member_name TEXT NOT NULL,
    role TEXT DEFAULT 'Игрок',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    UNIQUE(team_id, member_name)
)`);

// ... остальной код ...

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

// Создание команды (только лидер)
app.post('/api/teams', authenticateToken, isLeader, (req, res) => {
    const { name } = req.body;
    
    db.get("SELECT * FROM teams WHERE name = ?", [name], (err, team) => {
        if (team) return res.status(400).json({ error: 'Команда уже существует' });
        
        db.run("INSERT INTO teams (name, leader_id, rating) VALUES (?, ?, 0)",
            [name, req.user.id],
            function(err) {
                if (err) return res.status(500).json({ error: 'Ошибка создания команды' });
                
                // Добавляем лидера как участника
                db.run("INSERT INTO team_members (team_id, member_name, role) VALUES (?, ?, 'Капитан')",
                    [this.lastID, req.user.username]);
                
                res.json({ success: true, id: this.lastID, name });
            });
    });
});

// Добавление игрока (без проверки существования)
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

// Обновление роли игрока (по id участника)
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

// Удаление игрока (по id участника)
app.delete('/api/teams/:teamId/members/:memberId', authenticateToken, isLeader, (req, res) => {
    const teamId = req.params.teamId;
    const memberId = req.params.memberId;

    db.get("SELECT * FROM teams WHERE id = ? AND leader_id = ?", [teamId, req.user.id], (err, team) => {
        if (!team) return res.status(403).json({ error: 'Вы не лидер этой команды' });

        // Не даём удалить самого лидера (сравниваем member_name)
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

// ... остальные эндпоинты ...