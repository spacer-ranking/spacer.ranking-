// Загрузка рейтинга (без иконок статистики)
async function loadRanking() {
    try {
        const response = await fetch('/api/teams/ranking');
        const teams = await response.json();

        let html = `
            <div class="section-header">
                <h2>Рейтинг команд</h2>
                ${currentUser?.role === 'leader' ? `
                    <div class="leader-actions">
                        <button class="leader-btn" onclick="showCreateTeamModal()">+ Создать команду</button>
                        <button class="leader-btn" onclick="showCreateMatchModal()">+ Создать матч</button>
                    </div>
                ` : ''}
            </div>
            <div class="ranking-grid">
        `;

        if (teams && teams.length > 0) {
            teams.forEach((team, index) => {
                html += `
                    <div class="team-card" onclick="showTeam(${team.id})">
                        <div class="team-header">
                            <img src="${team.avatar || '/default-team.png'}" alt="${team.name}" class="team-avatar" onerror="this.src='/default-team.png'">
                            <div class="team-info">
                                <h3>#${index + 1} ${team.name}</h3>
                                <div class="team-rating">${team.rating} очков</div>
                            </div>
                        </div>
                        <div class="team-leader">👑 Лидер: ${team.leader_name || 'Неизвестно'}</div>
                    </div>
                `;
            });
        } else {
            html += '<p style="grid-column: 1/-1; text-align: center; padding: 2rem;">Нет команд для отображения</p>';
        }

        html += '</div>';
        mainContent.innerHTML = html;
    } catch (error) {
        console.error('Load ranking error:', error);
        mainContent.innerHTML = '<p style="text-align: center; padding: 2rem; color: #ff4655;">Ошибка загрузки рейтинга</p>';
    }
}

// Отображение команды (убрана колонка "ЛИДЕР")
async function showTeam(teamId) {
    try {
        const response = await fetch(`/api/teams/${teamId}`);
        const team = await response.json();

        let html = `
            <div class="team-page">
                <div class="team-page-header">
                    <img src="${team.avatar || '/default-team.png'}" alt="${team.name}" class="team-page-avatar" id="team-avatar-img" onerror="this.src='/default-team.png'">
                    <div class="team-page-info">
                        <h1>${team.name}</h1>
                        <div class="team-page-rating">${team.rating} очков</div>
                        <div class="team-page-meta">
                            <div class="meta-item">
                                <span class="meta-label">Участников</span>
                                <span class="meta-value">${team.members?.length || 0}</span>
                            </div>
                            <div class="meta-item">
                                <span class="meta-label">Матчей</span>
                                <span class="meta-value">${team.matches?.length || 0}</span>
                            </div>
                        </div>
        `;

        // Кнопки для лидера команды
        if (currentUser?.role === 'leader' && currentUser?.username === team.leader_name) {
            html += `
                <div class="leader-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <button class="leader-btn" onclick="showAddPlayerModal(${team.id})">+ Добавить игрока</button>
                    <button class="leader-btn" onclick="uploadTeamAvatar(${team.id})">📷 Сменить аватар</button>
                    <button class="leader-btn" style="background: #dc3545;" onclick="deleteTeam(${team.id})">🗑 Удалить команду</button>
                </div>
            `;
        }

        html += `
                    </div>
                </div>

                <div class="team-members">
                    <h3>Участники команды</h3>
                    <div class="members-grid">
        `;

        if (team.members && team.members.length > 0) {
            team.members.forEach(member => {
                html += `
                    <div class="member-card" id="member-${member.id}">
                        <img src="/default-avatar.png" alt="${member.member_name}" class="member-avatar">
                        <div class="member-info">
                            <span class="member-name">${member.member_name}</span>
                            <span class="member-role">${member.role}</span>
                        </div>
                        ${currentUser?.role === 'leader' && currentUser?.username === team.leader_name && member.member_name !== team.leader_name ? `
                            <div class="member-actions">
                                <select class="role-select" onchange="changeMemberRole(${team.id}, ${member.id}, this.value)">
                                    ${playerRoles.map(role => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${role}</option>`).join('')}
                                </select>
                                <button class="remove-member-btn" onclick="removeMember(${team.id}, ${member.id})">✕</button>
                            </div>
                        ` : ''}
                        ${member.member_name === team.leader_name ? '<span class="leader-tag">👑</span>' : ''}
                    </div>
                `;
            });
        } else {
            html += '<p>Нет участников</p>';
        }

        // ... остальная часть (матчи) ...
    }
}

// Добавление игрока (без проверки существования)
async function addPlayerToTeam() {
    const member_name = document.getElementById('playerUsername').value.trim();
    const teamId = document.getElementById('addPlayerTeamId').value;
    const role = document.getElementById('playerRole').value;

    if (!member_name) {
        showError('addPlayerError', 'Введите имя игрока');
        return;
    }

    try {
        const response = await fetch(`/api/teams/${teamId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ member_name, role })
        });

        const data = await response.json();

        if (response.ok) {
            hideModal(addPlayerModal);
            showTeam(teamId);
            alert('Игрок добавлен в команду!');
        } else {
            showError('addPlayerError', data.error || 'Ошибка добавления игрока');
        }
    } catch (error) {
        console.error('Add player error:', error);
        showError('addPlayerError', 'Ошибка соединения с сервером');
    }
}

// Изменение роли (по id участника)
async function changeMemberRole(teamId, memberId, newRole) {
    try {
        const response = await fetch(`/api/teams/${teamId}/members/${memberId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });
        if (response.ok) {
            document.querySelector(`#member-${memberId} .member-role`).textContent = newRole;
        } else {
            const data = await response.json();
            alert(data.error || 'Ошибка обновления роли');
        }
    } catch (error) {
        alert('Ошибка соединения');
    }
}

// Удаление игрока (по id участника)
async function removeMember(teamId, memberId) {
    if (!confirm('Удалить игрока из команды?')) return;
    try {
        const response = await fetch(`/api/teams/${teamId}/members/${memberId}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            document.getElementById(`member-${memberId}`).remove();
            alert('Игрок удалён');
        } else {
            const data = await response.json();
            alert(data.error || 'Ошибка удаления');
        }
    } catch (error) {
        alert('Ошибка соединения');
    }
}

// Загрузка матчей (только дата)
async function loadMatches() {
    try {
        const response = await fetch('/api/matches');
        const matches = await response.json();

        let html = `
            <div class="section-header">
                <h2>История матчей</h2>
                ${currentUser?.role === 'leader' ? `
                    <div class="leader-actions">
                        <button class="leader-btn" onclick="showCreateMatchModal()">+ Создать матч</button>
                    </div>
                ` : ''}
            </div>
            <div class="matches-list">
        `;

        if (matches && matches.length > 0) {
            matches.forEach(match => {
                const matchDate = new Date(match.match_date).toLocaleDateString('ru-RU');
                html += `
                    <div class="match-card" id="match-${match.id}">
                        <div class="match-teams">
                            <div class="match-team ${match.winner_id === match.team1_id ? 'winner' : ''}">
                                <img src="${match.team1_avatar || '/default-team.png'}" alt="${match.team1_name}" class="match-team-avatar" onerror="this.src='/default-team.png'">
                                <span>${match.team1_name}</span>
                            </div>
                            <div class="match-score">${match.team1_score} : ${match.team2_score}</div>
                            <div class="match-team ${match.winner_id === match.team2_id ? 'winner' : ''}">
                                <img src="${match.team2_avatar || '/default-team.png'}" alt="${match.team2_name}" class="match-team-avatar" onerror="this.src='/default-team.png'">
                                <span>${match.team2_name}</span>
                            </div>
                        </div>
                        <div class="match-date">${matchDate}</div>
                        ${currentUser?.role === 'leader' && match.created_by === currentUser.id ? `
                            <button class="delete-match-btn" onclick="deleteMatch(${match.id})" style="background: #ff4655; border: none; color: white; padding: 0.3rem 1rem; border-radius: 5px; cursor: pointer; margin-top: 0.5rem;">Удалить матч</button>
                        ` : ''}
                    </div>
                `;
            });
        } else {
            html += '<p style="text-align: center; padding: 2rem;">Нет матчей для отображения</p>';
        }

        html += '</div>';
        mainContent.innerHTML = html;
    } catch (error) {
        console.error('Load matches error:', error);
        mainContent.innerHTML = '<p style="text-align: center; padding: 2rem; color: #ff4655;">Ошибка загрузки матчей</p>';
    }
}