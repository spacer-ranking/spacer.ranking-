let currentUser = null;

// Загрузка данных при старте
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadRanking();
    loadMatches();
    loadTeams();
    setupEventListeners();
});

function setupEventListeners() {
    // Навигация
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = e.target.dataset.page;
            showPage(page);
        });
    });
}

function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    
    document.getElementById(`${page}-page`).classList.add('active');
    document.querySelector(`[data-page="${page}"]`).classList.add('active');
    
    // Обновляем данные при переключении страниц
    if (page === 'ranking') loadRanking();
    if (page === 'matches') loadMatches();
    if (page === 'teams') loadTeams();
}

// Авторизация
async function checkAuth() {
    try {
        const response = await fetch('/api/user');
        if (response.ok) {
            currentUser = await response.json();
            updateUIForAuth();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

function updateUIForAuth() {
    if (currentUser) {
        document.getElementById('userInfo').style.display = 'flex';
        document.getElementById('username').textContent = currentUser.username;
        document.getElementById('authButtons').style.display = 'none';
        
        if (currentUser.role === 'leader') {
            addLeaderButton();
        }
    } else {
        document.getElementById('userInfo').style.display = 'none';
        document.getElementById('authButtons').style.display = 'flex';
    }
}

function addLeaderButton() {
    const navAuth = document.querySelector('.nav-auth');
    if (!document.getElementById('leaderPanelBtn')) {
        const leaderBtn = document.createElement('button');
        leaderBtn.id = 'leaderPanelBtn';
        leaderBtn.className = 'btn-leader';
        leaderBtn.textContent = 'Панель лидера';
        leaderBtn.onclick = () => showLeaderModal();
        leaderBtn.style.marginRight = '10px';
        leaderBtn.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
        leaderBtn.style.color = 'white';
        leaderBtn.style.border = 'none';
        leaderBtn.style.padding = '0.5rem 1rem';
        leaderBtn.style.borderRadius = '8px';
        leaderBtn.style.cursor = 'pointer';
        
        document.getElementById('userInfo').prepend(leaderBtn);
    }
}

function showModal(type) {
    document.getElementById('authModal').style.display = 'block';
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    
    if (type === 'login') {
        document.getElementById('loginForm').classList.add('active');
    } else {
        document.getElementById('registerForm').classList.add('active');
    }
}

function closeModal() {
    document.getElementById('authModal').style.display = 'none';
}

async function generateCode() {
    try {
        const response = await fetch('/api/verification-code');
        const data = await response.json();
        document.getElementById('verificationCode').value = data.code;
        alert(`Ваш код подтверждения: ${data.code}\n(Скопируйте его для регистрации)`);
    } catch (error) {
        alert('Ошибка при генерации кода');
    }
}

async function register() {
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;
    const code = document.getElementById('verificationCode').value;

    if (!username || !password || !code) {
        alert('Заполните все поля');
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, code })
        });

        const data = await response.json();
        if (data.success) {
            currentUser = data.user;
            updateUIForAuth();
            closeModal();
            loadRanking();
            alert('Регистрация успешна!');
        } else {
            alert(data.error);
        }
    } catch (error) {
        alert('Ошибка регистрации');
    }
}

async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        alert('Заполните все поля');
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (data.success) {
            currentUser = data.user;
            updateUIForAuth();
            closeModal();
            loadRanking();
            alert('Вход выполнен успешно!');
        } else {
            alert(data.error);
        }
    } catch (error) {
        alert('Ошибка входа');
    }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    currentUser = null;
    updateUIForAuth();
    location.reload();
}

// Загрузка рейтинга
async function loadRanking() {
    try {
        const response = await fetch('/api/teams');
        const teams = await response.json();
        
        const tbody = document.getElementById('rankingBody');
        tbody.innerHTML = '';
        
        teams.forEach((team, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>
                    <div class="team-info">
                        <img src="/uploads/${team.avatar || 'default-team.png'}" 
                             class="team-avatar" 
                             onerror="this.src='https://via.placeholder.com/40'">
                        ${team.name}
                    </div>
                </td>
                <td class="rating-value">${team.rating}</td>
                <td>${team.members_count || 0}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Failed to load ranking:', error);
    }
}

// Загрузка матчей
async function loadMatches() {
    try {
        const response = await fetch('/api/matches');
        const matches = await response.json();
        
        const matchesList = document.getElementById('matchesList');
        matchesList.innerHTML = '';
        
        matches.forEach(match => {
            const matchCard = document.createElement('div');
            matchCard.className = 'match-card';
            
            const winnerText = match.winner_name ? `Победитель: ${match.winner_name}` : 'Ничья';
            
            matchCard.innerHTML = `
                <div class="match-teams">
                    <div class="match-team">
                        <img src="/uploads/${match.team1_avatar || 'default-team.png'}" 
                             class="match-team-avatar"
                             onerror="this.src='https://via.placeholder.com/50'">
                        <span>${match.team1_name}</span>
                    </div>
                    <div class="match-score">${match.team1_score} : ${match.team2_score}</div>
                    <div class="match-team">
                        <img src="/uploads/${match.team2_avatar || 'default-team.png'}" 
                             class="match-team-avatar"
                             onerror="this.src='https://via.placeholder.com/50'">
                        <span>${match.team2_name}</span>
                    </div>
                </div>
                <div class="match-info">
                    <div class="match-winner">${winnerText}</div>
                    <div class="match-date">${new Date(match.match_date).toLocaleString()}</div>
                </div>
            `;
            
            matchesList.appendChild(matchCard);
        });
    } catch (error) {
        console.error('Failed to load matches:', error);
    }
}

// Загрузка команд
async function loadTeams() {
    try {
        const response = await fetch('/api/teams');
        const teams = await response.json();
        
        const teamsList = document.getElementById('teamsList');
        teamsList.innerHTML = '';
        
        for (const team of teams) {
            // Загружаем участников команды
            const membersResponse = await fetch(`/api/team-members/${team.id}`);
            const members = await membersResponse.json();
            
            // Загружаем матчи команды
            const matchesResponse = await fetch(`/api/teams/${team.id}/matches`);
            const matches = await matchesResponse.json();
            
            const teamCard = document.createElement('div');
            teamCard.className = 'team-card';
            teamCard.innerHTML = `
                <img src="/uploads/${team.avatar || 'default-team.png'}" 
                     class="team-card-avatar"
                     onerror="this.src='https://via.placeholder.com/100'">
                <h3>${team.name}</h3>
                <div class="team-card-rating">Рейтинг: ${team.rating}</div>
                <div class="team-card-members">Участники: ${members.map(m => m.username).join(', ')}</div>
                <div class="team-card-matches">
                    <h4>Последние матчи:</h4>
                    ${matches.slice(0, 3).map(m => `
                        <div class="team-match">
                            ${m.team1_name} ${m.team1_score}:${m.team2_score} ${m.team2_name}
                            ${m.winner_name ? `(Победитель: ${m.winner_name})` : '(Ничья)'}
                        </div>
                    `).join('')}
                </div>
            `;
            
            teamsList.appendChild(teamCard);
        }
    } catch (error) {
        console.error('Failed to load teams:', error);
    }
}

// Функции для лидера
function showLeaderModal() {
    document.getElementById('leaderModal').style.display = 'block';
    loadTeamsForSelect();
}

function closeLeaderModal() {
    document.getElementById('leaderModal').style.display = 'none';
}

function showLeaderTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.leader-tab').forEach(t => t.classList.remove('active'));
    
    document.querySelector(`[onclick="showLeaderTab('${tabName}')"]`).classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    if (tabName === 'add-member' || tabName === 'create-match' || tabName === 'change-avatar') {
        loadTeamsForSelect();
    }
}

async function loadTeamsForSelect() {
    try {
        const response = await fetch('/api/teams');
        const teams = await response.json();
        
        const selects = ['teamSelect', 'team1Select', 'team2Select', 'avatarTeamSelect'];
        
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (select) {
                select.innerHTML = '<option value="">Выберите команду</option>';
                teams.forEach(team => {
                    select.innerHTML += `<option value="${team.id}">${team.name}</option>`;
                });
            }
        });
    } catch (error) {
        console.error('Failed to load teams:', error);
    }
}

async function createTeam() {
    const name = document.getElementById('teamName').value;
    
    if (!name) {
        alert('Введите название команды');
        return;
    }
    
    try {
        const response = await fetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Команда создана успешно!');
            closeLeaderModal();
            loadRanking();
            loadTeams();
        } else {
            alert(data.error);
        }
    } catch (error) {
        alert('Ошибка при создании команды');
    }
}

async function addMember() {
    const teamId = document.getElementById('teamSelect').value;
    const username = document.getElementById('playerUsername').value;
    
    if (!teamId || !username) {
        alert('Выберите команду и введите имя игрока');
        return;
    }
    
    try {
        const response = await fetch(`/api/teams/${teamId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Игрок добавлен в команду!');
            closeLeaderModal();
            loadTeams();
        } else {
            alert(data.error);
        }
    } catch (error) {
        alert('Ошибка при добавлении игрока');
    }
}

async function createMatch() {
    const team1_id = document.getElementById('team1Select').value;
    const team2_id = document.getElementById('team2Select').value;
    const team1_score = document.getElementById('team1Score').value;
    const team2_score = document.getElementById('team2Score').value;
    
    if (!team1_id || !team2_id || team1_score === '' || team2_score === '') {
        alert('Заполните все поля');
        return;
    }
    
    if (team1_id === team2_id) {
        alert('Команды должны быть разными');
        return;
    }
    
    try {
        const response = await fetch('/api/matches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                team1_id, 
                team2_id, 
                team1_score: parseInt(team1_score), 
                team2_score: parseInt(team2_score) 
            })
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Матч создан успешно!');
            closeLeaderModal();
            loadRanking();
            loadMatches();
            loadTeams();
        } else {
            alert(data.error);
        }
    } catch (error) {
        alert('Ошибка при создании матча');
    }
}

async function changeAvatar() {
    const teamId = document.getElementById('avatarTeamSelect').value;
    const fileInput = document.getElementById('teamAvatar');
    
    if (!teamId || !fileInput.files[0]) {
        alert('Выберите команду и файл изображения');
        return;
    }
    
    const formData = new FormData();
    formData.append('avatar', fileInput.files[0]);
    
    try {
        const response = await fetch(`/api/teams/${teamId}/avatar`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            alert('Аватар обновлен успешно!');
            closeLeaderModal();
            loadRanking();
            loadTeams();
        } else {
            alert(data.error);
        }
    } catch (error) {
        alert('Ошибка при загрузке аватара');
    }
}