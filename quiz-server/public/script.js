// Обновленный класс QuizApp с поддержкой WebSocket
class QuizApp {
    constructor() {
        this.currentRound = 1;
        this.currentQuestion = 0;
        this.participants = [];
        this.answers = {};
        this.showAnswers = false;
        this.timer = 0;
        this.timerInterval = null;
        this.socket = null;
        
        this.init();
    }
    
    init() {
        this.connectWebSocket();
        this.setupEventListeners();
        this.updateDate();
        
        // Автосохранение каждые 10 секунд
        setInterval(() => this.saveState(), 10000);
        
        // Обновление даты каждую минуту
        setInterval(() => this.updateDate(), 60000);
    }
    
    // Подключение к WebSocket серверу
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = () => {
            console.log('Подключено к серверу');
            document.getElementById('app-status').textContent = 'Подключено';
        };
        
        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleSocketMessage(data);
        };
        
        this.socket.onclose = () => {
            console.log('Соединение закрыто');
            document.getElementById('app-status').textContent = 'Отключено';
            
            // Попытка переподключения через 5 секунд
            setTimeout(() => this.connectWebSocket(), 5000);
        };
        
        this.socket.onerror = (error) => {
            console.error('WebSocket ошибка:', error);
            document.getElementById('app-status').textContent = 'Ошибка подключения';
        };
    }
    
    // Обновляем обработку команд от сервера
    handleSocketMessage(data) {
        switch(data.type) {
            case 'gameState':
                this.updateFromServer(data.data);
                // Сбрасываем флаг видео при новом состоянии игры
                if (data.data.currentQuestion !== this.currentQuestion) {
                    this.currentQuestionVideoShown = false;
                }
                break;
                
            case 'newParticipant':
                this.addParticipant(data);
                break;
                
            case 'newAnswer':
                this.processAnswer(data);
                break;
                
            case 'roundStatistics':
                console.log('Статистика раунда:', data);
                this.showRoundStatistics(data.data);
                break;
        }
    }
    
    // Обновление состояния из сервера
    updateFromServer(serverState) {
        this.currentRound = serverState.currentRound;
        this.currentQuestion = serverState.currentQuestion;
        
        // Обновляем участников
        if (serverState.participants) {
            this.participants = Object.entries(serverState.participants)
                .filter(([_, p]) => p.registered)
                .map(([userId, data]) => ({
                    id: userId,
                    name: data.name,
                    color: data.color || this.getRandomColor(),
                    answered: false,
                    answers: {}
                }));
            
            this.renderParticipants();
        }
        
        // Обновляем ответы
        if (serverState.answers) {
            this.answers = serverState.answers;
            this.updateAnswersDisplay();
        }
        
        this.updateQuestionDisplay();
        this.updateStatus();
    }
    
    // Добавление нового участника
    addParticipant(data) {
        const existing = this.participants.find(p => p.id === data.userId);
        if (!existing) {
            this.participants.push({
                id: data.userId,
                name: data.name,
                color: data.color || this.getRandomColor(),
                answered: false,
                answers: {}
            });
            
            this.renderParticipants();
            this.updateStatus();
            
            // Показать уведомление
            this.showNotification(`Новый участник: ${data.name}`);
        }
    }
    
    // Обработка нового ответа
    processAnswer(data) {
        const { answerId, userId, answer, isCorrect, userName } = data;
        
        // Находим участника
        const participant = this.participants.find(p => p.id === userId);
        if (participant) {
            participant.answered = true;
            participant.answers[answerId] = {
                answer,
                isCorrect,
                timestamp: new Date().toISOString()
            };
            
            // Обновляем отображение участника
            this.renderParticipants();
            
            // Обновляем статистику
            this.updateAnswersDisplay();
            
            // Показать всплывающее уведомление
            const answerLetters = ['A', 'B', 'C', 'D'];
            this.showNotification(
                `${userName}: Ответ ${answerLetters[answer]} ` +
                (isCorrect ? '✅' : '❌')
            );
        }
    }
    
    // Обновление отображения ответов
    updateAnswersDisplay() {
        const answerId = `${this.currentRound}_${this.currentQuestion}`;
        const currentAnswers = this.answers[answerId] || {};
        
        // Создаем таблицу статистики
        const statsContainer = document.getElementById('answers-stats');
        if (!statsContainer) {
            this.createStatsContainer();
        } else {
            this.renderStatsTable(currentAnswers);
        }
    }
    
    // Создание контейнера для статистики
    createStatsContainer() {
        const container = document.createElement('div');
        container.id = 'answers-stats';
        container.className = 'answers-stats';
        
        const hostContainer = document.getElementById('host-container');
        if (hostContainer) {
            hostContainer.appendChild(container);
        }
    }
    
    // Рендеринг таблицы статистики
    renderStatsTable(currentAnswers) {
        const statsContainer = document.getElementById('answers-stats');
        if (!statsContainer) return;
        
        const answers = Object.values(currentAnswers);
        
        if (answers.length === 0) {
            statsContainer.innerHTML = `
                <div class="stats-empty">
                    <i class="fas fa-hourglass-half"></i>
                    <p>Ожидаем ответов от участников...</p>
                </div>
            `;
            return;
        }
        
        const answerLetters = ['A', 'B', 'C', 'D'];
        
        let html = `
            <div class="stats-header">
                <h3><i class="fas fa-chart-bar"></i> Статистика ответов</h3>
                <div class="stats-summary">
                    <span class="stats-total">Всего: ${answers.length}</span>
                    <span class="stats-correct">✅: ${answers.filter(a => a.isCorrect).length}</span>
                    <span class="stats-wrong">❌: ${answers.filter(a => !a.isCorrect).length}</span>
                </div>
            </div>
            <div class="stats-table-container">
                <table class="stats-table">
                    <thead>
                        <tr>
                            <th>Участник</th>
                            <th>Ответ</th>
                            <th>Статус</th>
                            <th>Время</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        answers.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
               .forEach(answer => {
            const time = new Date(answer.timestamp).toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
            });
            
            html += `
                <tr>
                    <td class="participant-name-cell">
                        <span class="participant-color-dot" style="background: ${this.getParticipantColor(answer.userName)}"></span>
                        ${answer.userName}
                    </td>
                    <td class="answer-cell">${answerLetters[answer.answer]}</td>
                    <td class="status-cell">
                        <span class="status-badge ${answer.isCorrect ? 'correct' : 'wrong'}">
                            ${answer.isCorrect ? '✅ Верно' : '❌ Неверно'}
                        </span>
                    </td>
                    <td class="time-cell">${time}</td>
                </tr>
            `;
        });
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        statsContainer.innerHTML = html;
    }
    
    // Отправка команд на сервер
    sendCommand(command, data = {}) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: command, ...data }));
        } else {
            console.error('WebSocket не подключен');
        }
    }
    
    // Обновленные методы управления
    nextQuestion() {
        this.sendCommand('nextQuestion');
    }
    
    prevQuestion() {
        this.sendCommand('prevQuestion');
    }
    
    switchRound(round) {
        this.sendCommand('switchRound', { round });
    }
    
    resetRound() {
        this.sendCommand('resetRound');
    }
    
    // Показать уведомление
    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-bell"></i>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Анимация появления
        setTimeout(() => notification.classList.add('show'), 10);
        
        // Автоматическое скрытие через 3 секунды
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    // Дополнительные методы
    getParticipantColor(name) {
        const participant = this.participants.find(p => p.name === name);
        return participant ? participant.color : '#ccc';
    }
    
    getRandomColor() {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0',
            '#118AB2', '#7209B7', '#3A86FF', '#FB5607',
            '#8338EC', '#FF006E', '#FFBE0B', '#FB5607'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    // Остальные методы остаются похожими, но адаптируются под работу с сервером
    // ...
}

// Инициализация приложения
let quiz;

document.addEventListener('DOMContentLoaded', () => {
    quiz = new QuizApp();
    window.quiz = quiz;
});