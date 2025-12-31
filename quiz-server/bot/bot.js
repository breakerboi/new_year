const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const token = '8215538774:AAGvMm4qIfYenOfa7RmeH_Rh_eUXcmDhamc';
const bot = new TelegramBot(token, { polling: true });
const SERVER_URL = 'http://localhost:3000';

// Хранилище состояний пользователей
const userStates = {};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    userStates[chatId] = {
        stage: 'registration',
        name: null
    };
    
    bot.sendMessage(chatId, 
        '👋 Добро пожаловать в викторину!\n\n' +
        'Для участия введите ваше имя:'
    );
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userStates[chatId];
    
    if (!state) return;
    
    // Регистрация
    if (state.stage === 'registration') {
        state.name = text;
        state.stage = 'ready';
        
        // Регистрируем на сервере
        try {
            await axios.post(`${SERVER_URL}/api/register`, {
                userId: `tg_${chatId}`,
                name: text,
                chatId
            });
            
            bot.sendMessage(chatId,
                `✅ Регистрация успешна!\n\n` +
                `Привет, ${text}!\n\n` +
                `Ожидайте вопросов от ведущего.\n` +
                `Отправляйте ответы в формате:\n` +
                `• "1" или "A" для первого варианта\n` +
                `• "2" или "B" для второго\n` +
                `• и т.д.\n\n` +
                `Удачи! 🍀`
            );
        } catch (error) {
            bot.sendMessage(chatId, '❌ Ошибка регистрации. Попробуйте позже.');
        }
    }
    
    // Обработка ответов
    else if (state.stage === 'ready') {
        // Парсим ответ
        const answer = parseAnswer(text);
        
        if (answer === null) {
            bot.sendMessage(chatId,
                '❌ Неверный формат ответа.\n' +
                'Используйте: 1, 2, 3, 4 или A, B, C, D'
            );
            return;
        }
        
        // Отправляем ответ на сервер
        try {
            await axios.post(`${SERVER_URL}/api/answer`, {
                userId: `tg_${chatId}`,
                userName: state.name,
                answer: answer,
                timestamp: new Date().toISOString()
            });
            
            const letters = ['A', 'B', 'C', 'D'];
            bot.sendMessage(chatId,
                `✅ Ответ "${letters[answer]}" принят!\n` +
                `Ожидайте результатов вопроса.`
            );
        } catch (error) {
            bot.sendMessage(chatId, '❌ Не удалось отправить ответ. Попробуйте снова.');
        }
    }
});

// Команда для проверки статуса
bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId];
    
    if (!state || !state.name) {
        bot.sendMessage(chatId, 'Вы не зарегистрированы. Используйте /start');
        return;
    }
    
    bot.sendMessage(chatId,
        `📊 Ваш статус:\n` +
        `Имя: ${state.name}\n` +
        `Статус: ${state.stage === 'ready' ? '✅ Готов к игре' : '❓ Ожидает регистрации'}\n\n` +
        `Для ответа на вопросы просто отправляйте номер варианта.`
    );
});

// Парсинг ответа
function parseAnswer(text) {
    const normalized = text.trim().toUpperCase();
    
    // Буквенные ответы
    const letterMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
    if (letterMap[normalized] !== undefined) {
        return letterMap[normalized];
    }
    
    // Числовые ответы
    const num = parseInt(normalized);
    if (!isNaN(num) && num >= 1 && num <= 4) {
        return num - 1;
    }
    
    return null;
}

console.log('Telegram бот запущен...');