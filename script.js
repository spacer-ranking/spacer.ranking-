// Регистрация
async function register() {
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const code = document.getElementById('registerCode').value.trim();

    if (!username || !email || !password || !code) {
        showError('authError', 'Заполните все поля');
        return;
    }

    if (username.length < 3) {
        showError('authError', 'Имя должно быть не менее 3 символов');
        return;
    }

    if (password.length < 4) {
        showError('authError', 'Пароль должен быть не менее 4 символов');
        return;
    }

    if (!email.includes('@') || !email.includes('.')) {
        showError('authError', 'Введите корректный email');
        return;
    }

    if (code.length !== 6 || isNaN(code)) {
        showError('authError', 'Код должен быть 6-значным числом');
        return;
    }

    if (code !== currentCode) {
        showError('authError', 'Неверный код подтверждения');
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password, code })
        });

        const data = await response.json();

        if (response.ok) {
            hideModal(authModal);
            
            if (username === 'Quantum') {
                alert('✅ Поздравляем! Вы зарегистрировались как ЛИДЕР! Теперь вы можете создавать команды и матчи.');
            } else {
                alert('✅ Регистрация успешна! Добро пожаловать!');
            }
            
            // Очищаем поля
            document.getElementById('registerUsername').value = '';
            document.getElementById('registerEmail').value = '';
            document.getElementById('registerPassword').value = '';
            document.getElementById('registerCode').value = '';
            currentCode = null;
            
            // Обновляем пользователя
            await checkAuth();
            loadPage('ranking');
        } else {
            showError('authError', data.error || 'Ошибка регистрации');
        }
    } catch (error) {
        console.error('Register error:', error);
        showError('authError', 'Ошибка соединения с сервером');
    }
}