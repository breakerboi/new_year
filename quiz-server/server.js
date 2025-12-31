const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Создаем папки если их нет
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

// Загружаем вопросы
let questions;
try {
  questions = {
    round1: require('./questions/round1.json'),
    round2: require('./questions/round2.json')
  };
} catch (error) {
  console.log('Файлы с вопросами не найдены, используем заглушки');
  questions = {
    round1: Array.from({length: 12}, (_, i) => ({
      id: i + 1,
      text: `Вопрос ${i + 1} для разминки`,
      answers: [`Вариант A`, `Вариант B`, `Вариант C`, `Вариант D`],
      correct: i % 4
    })),
    round2: Array.from({length: 12}, (_, i) => ({
      id: i + 1,
      text: `Мем ${i + 1}: Как называется этот мем?`,
      memeName: `Мем ${i + 1}`,
      imageUrl: null
    }))
  };
}

// Настройка Telegram бота
const token = process.env.TELEGRAM_BOT_TOKEN;
let bot;
if (token && token !== 'YOUR_BOT_TOKEN') {
  bot = new TelegramBot(token, { polling: true });
  console.log('Telegram бот запущен');
} else {
  console.log('Telegram бот не запущен. Установите TELEGRAM_BOT_TOKEN в .env файле');
}

// Хранилище данных
let gameState = {
  currentRound: 1,
  currentQuestion: 0,
  participants: {},
  questions: questions,
  answers: {},
  scores: {},
  showStats: false,
  showAnswers: false,
  round2NotificationSent: false,
  roundStatistics: null,
  // Добавьте это свойство:
  currentQuestionVideoShown: false
};

// Обработка подключений от веб-приложения
io.on('connection', (socket) => {
  console.log('Новое подключение от веб-приложения');
  
  // Отправляем текущее состояние
  socket.emit('gameState', {
    type: 'gameState',
    data: gameState
  });
  
  // Обработка команд от ведущего
  // В обработчике nextQuestion обновляем
  socket.on('nextQuestion', () => {
      const maxQuestions = gameState.currentRound === 1 ? 12 : 10;
      
      if (gameState.currentQuestion < maxQuestions - 1) {
          gameState.currentQuestion++;
          gameState.showStats = false;
          gameState.showAnswers = false;
          gameState.currentQuestionVideoShown = false;
          gameState.roundStatistics = null; // Сбрасываем статистику
          
          io.emit('gameState', {
              type: 'gameState',
              data: gameState
          });
          console.log(`Перешли к вопросу ${gameState.currentQuestion + 1}`);
      } else {
          // Это последний вопрос, показываем статистику раунда
          gameState.showStats = true;
          gameState.showAnswers = true; // Автоматически показываем ответы на последнем вопросе
          gameState.roundStatistics = calculateRoundResults();
          
          io.emit('gameState', {
              type: 'gameState',
              data: gameState
          });
          
          io.emit('roundStatistics', {
              type: 'roundStatistics',
              data: gameState.roundStatistics
          });
          
          console.log('Последний вопрос раунда, показана статистика');
      }
  });
  
  socket.on('prevQuestion', () => {
    if (gameState.currentQuestion > 0) {
      gameState.currentQuestion--;
      gameState.showStats = false;
      gameState.showAnswers = false;
      io.emit('gameState', {
        type: 'gameState',
        data: gameState
      });
      console.log(`Вернулись к вопросу ${gameState.currentQuestion + 1}`);
    }
  });
  
  // В обработчике switchRound сбрасываем статистику
  socket.on('switchRound', (data) => {
      gameState.currentRound = data.round;
      gameState.currentQuestion = 0;
      gameState.answers = {};
      gameState.showStats = false;
      gameState.showAnswers = false;
      gameState.roundStatistics = null; // Сбрасываем статистику
      gameState.currentQuestionVideoShown = false;
      
      if (gameState.currentRound === 2 && !gameState.round2NotificationSent && bot) {
          sendRound2Instruction();
          gameState.round2NotificationSent = true;
      }
      
      io.emit('gameState', {
          type: 'gameState',
          data: gameState
      });
      console.log(`Переключились на раунд ${data.round}`);
  });
  
  // В обработчике resetRound сбрасываем статистику
  socket.on('resetRound', () => {
      gameState.participants = {};
      gameState.answers = {};
      gameState.scores = {};
      gameState.currentQuestion = 0;
      gameState.showStats = false;
      gameState.showAnswers = false;
      gameState.roundStatistics = null; // Сбрасываем статистику
      gameState.round2NotificationSent = false;
      
      io.emit('gameState', {
          type: 'gameState',
          data: gameState
      });
      console.log('Раунд сброшен');
  });

  // Добавляем обработчик для получения URL видео
  socket.on('getQuestionVideo', (data, callback) => {
      const { round, questionIndex } = data;
      const roundKey = `round${round}`;
      
      if (gameState.questions[roundKey] && gameState.questions[roundKey][questionIndex]) {
          const question = gameState.questions[roundKey][questionIndex];
          callback({ videoUrl: question.videoUrl || null });
      } else {
          callback({ videoUrl: null });
      }
  });
  
  // В обработчике showAnswers добавляем проверку на последний вопрос
  socket.on('showAnswers', () => {
      const maxQuestions = gameState.currentRound === 1 ? 12 : 10;
      const isLastQuestion = gameState.currentQuestion === maxQuestions - 1;
      
      // Проверяем, все ли ответили
      const answerId = `${gameState.currentRound}_${gameState.currentQuestion}`;
      const currentAnswers = gameState.answers[answerId] || {};
      const participantsCount = Object.values(gameState.participants).filter(p => p.registered).length;
      
      if (Object.keys(currentAnswers).length >= participantsCount && participantsCount > 0) {
          gameState.showAnswers = true;
          gameState.showStats = true;
          
          // Если это последний вопрос, рассчитываем статистику раунда
          if (isLastQuestion) {
              gameState.roundStatistics = calculateRoundResults();
              io.emit('roundStatistics', {
                  type: 'roundStatistics',
                  data: gameState.roundStatistics
              });
          }
          
          io.emit('gameState', {
              type: 'gameState',
              data: gameState
          });
          console.log('Показаны ответы на текущий вопрос');
      } else {
          socket.emit('error', {
              type: 'error',
              message: 'Не все участники ответили на вопрос'
          });
      }
  });
  
  // В обработчике hideAnswers сбрасываем статистику
  socket.on('hideAnswers', () => {
      gameState.showAnswers = false;
      gameState.showStats = false;
      // Не сбрасываем roundStatistics, если мы на последнем вопросе и статистика уже показана
      if (gameState.currentQuestion !== (gameState.currentRound === 1 ? 11 : 9)) {
          gameState.roundStatistics = null;
      }
      
      io.emit('gameState', {
          type: 'gameState',
          data: gameState
      });
      console.log('Ответы скрыты');
  });
  
  socket.on('addScore', (data) => {
    const { userId, points = 1 } = data;
    
    if (!gameState.participants[userId]) {
        console.log(`Участник ${userId} не найден`);
        return;
    }
    
    // Инициализируем счет, если его нет
    if (!gameState.scores[userId]) {
        gameState.scores[userId] = { total: 0, round1: 0, round2: 0 };
    }
    
    // Добавляем баллы в зависимости от раунда
    if (gameState.currentRound === 1) {
        gameState.scores[userId].round1 += points;
    } else {
        gameState.scores[userId].round2 += points;
    }
    gameState.scores[userId].total += points;
    
    // Если статистика раунда уже была показана, пересчитываем её
    if (gameState.showStats && gameState.roundStatistics) {
        gameState.roundStatistics = calculateRoundResults();
        
        // Отправляем обновленную статистику
        io.emit('roundStatistics', {
            type: 'roundStatistics',
            data: gameState.roundStatistics
        });
    }
    
    // Отправляем обновленное состояние игры
    io.emit('gameState', {
        type: 'gameState',
        data: gameState
    });
    
    console.log(`Добавлено ${points} баллов участнику ${gameState.participants[userId].name}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Веб-приложение отключилось');
  });

  socket.on('refreshStatistics', () => {
    if (gameState.roundStatistics) {
        gameState.roundStatistics = calculateRoundResults();
        
        io.emit('roundStatistics', {
            type: 'roundStatistics',
            data: gameState.roundStatistics
        });
        
        console.log('Статистика раунда пересчитана по запросу клиента');
    }
  });
});

// Отправка инструкции для раунда 2
function sendRound2Instruction() {
  if (!bot) return;
  
  Object.values(gameState.participants).forEach(participant => {
    if (participant.registered && participant.chatId) {
      bot.sendMessage(participant.chatId,
        '🎨 Начинается раунд "КартинОЧКА"!\n\n' +
        'В этом раунде вы будете видеть изображение мема.\n' +
        'Отправьте ТЕКСТОВЫЙ ответ с названием мема.\n\n' +
        'Пример: "Ждун" или "Успешный бизнесмен"\n\n' +
        'Ведущий будет проверять ответы вручную и начислять баллы.'
      );
    }
  });
}

// Если бот запущен, настраиваем обработчики
if (bot) {
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = `tg_${chatId}`;
    
    bot.sendMessage(chatId, 
      'Привет! 👋\n\nДобро пожаловать в викторину!\n\n' +
      'Введите ваше имя для участия (только имя, без фамилии):'
    );
    
    gameState.participants[userId] = {
      chatId,
      name: null,
      registered: false
    };
  });

  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = `tg_${chatId}`;
    const text = msg.text;
    
    if (text.startsWith('/') && !text.startsWith('/start')) return;
    
    // Регистрация пользователя
    if (!gameState.participants[userId]?.registered && !text.startsWith('/')) {
      gameState.participants[userId] = {
        chatId,
        name: text.trim(),
        registered: true,
        color: getRandomColor()
      };
      
      // Инициализируем счет
      gameState.scores[userId] = { total: 0, round1: 0, round2: 0 };
      
      bot.sendMessage(chatId, 
        `Отлично, ${text}! ✅\nВы зарегистрированы.\n\n` +
        `Ожидайте вопросы. Отправляйте ответы:\n` +
        `• Для раунда "РазминОЧКА": 1, 2, 3, 4 или A, B, C, D\n` +
        `• Для раунда "КартинОЧКА": текстовый ответ\n\n` +
        `Удачи! 🍀`
      );
      
      io.emit('newParticipant', {
        type: 'newParticipant',
        userId,
        name: text,
        color: gameState.participants[userId].color
      });
      
      console.log(`Зарегистрирован новый участник: ${text}`);
    }
    
    // Обработка ответов на вопросы
    if (gameState.participants[userId]?.registered && 
        !text.startsWith('/') && 
        gameState.participants[userId].name !== text) {
      
      handleAnswer(userId, text, chatId);
    }
  });
}

// Обработка ответа
function handleAnswer(userId, answerText, chatId) {
  const currentRound = gameState.currentRound;
  const currentQuestion = gameState.currentQuestion;
  const question = gameState.questions[`round${currentRound}`][currentQuestion];
  
  if (!question) {
    if (bot) {
      bot.sendMessage(chatId, 'Вопрос не найден. Ожидайте следующий вопрос.');
    }
    return;
  }
  
  let isCorrect = false;
  let parsedAnswer = answerText;
  
  if (currentRound === 1) {
    // Для первого раунда парсим ответ
    const answer = parseAnswer(answerText);
    if (answer === null) {
      if (bot) {
        bot.sendMessage(chatId, 'Неверный формат ответа. Отправьте номер варианта (1, 2, 3, 4) или букву (A, B, C, D)');
      }
      return;
    }
    parsedAnswer = answer;
    isCorrect = (answer === question.correct);
    
    // Начисляем баллы за правильный ответ
    if (isCorrect) {
      if (!gameState.scores[userId]) {
        gameState.scores[userId] = { total: 0, round1: 0, round2: 0 };
      }
      gameState.scores[userId].round1 += 1;
      gameState.scores[userId].total += 1;
    }
  } else {
    // Для второго раунда ответ текстовый, баллы не начисляем автоматически
    isCorrect = false;
  }
  
  // Сохраняем ответ
  const answerId = `${currentRound}_${currentQuestion}`;
  if (!gameState.answers[answerId]) {
    gameState.answers[answerId] = {};
  }
  
  gameState.answers[answerId][userId] = {
    answer: parsedAnswer,
    isCorrect,
    userName: gameState.participants[userId].name,
    timestamp: new Date().toISOString(),
    round: currentRound
  };
  
  // Отправляем подтверждение пользователю
  if (bot) {
    if (currentRound === 1) {
      const answerLetters = ['A', 'B', 'C', 'D'];
      bot.sendMessage(chatId, 
        `Ваш ответ "${answerLetters[parsedAnswer]}" принят! ✅\n\n` +
        `Правильность будет показана после окончания вопроса.`
      );
    } else {
      bot.sendMessage(chatId, 
        `Ваш ответ "${answerText}" принят! ✅\n\n` +
        `Ведущий проверит ответ и начислит баллы.`
      );
    }
  }
  
  // Уведомляем веб-приложение о новом ответе
  io.emit('newAnswer', {
    type: 'newAnswer',
    answerId,
    userId,
    answer: parsedAnswer,
    isCorrect,
    userName: gameState.participants[userId].name,
    round: currentRound
  });
  
  console.log(`Ответ от ${gameState.participants[userId].name}: ${parsedAnswer} (раунд ${currentRound})`);
}

// Парсинг ответа для первого раунда
function parseAnswer(text) {
  const normalized = text.trim().toUpperCase();
  
  if (['A', 'B', 'C', 'D'].includes(normalized)) {
    return ['A', 'B', 'C', 'D'].indexOf(normalized);
  }
  
  const num = parseInt(normalized);
  if (!isNaN(num) && num >= 1 && num <= 4) {
    return num - 1;
  }
  
  return null;
}

// Генерация случайного цвета
function getRandomColor() {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0',
    '#118AB2', '#7209B7', '#3A86FF', '#FB5607',
    '#8338EC', '#FF006E', '#FFBE0B', '#FB5607'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Расчет результатов раунда
function calculateRoundResults() {
  const results = {};
  const round = gameState.currentRound;
  
  Object.keys(gameState.participants).forEach(userId => {
      const participant = gameState.participants[userId];
      if (participant.registered) {
          results[userId] = {
              name: participant.name,
              score: gameState.scores[userId] ? gameState.scores[userId].total : 0,
              round1Score: gameState.scores[userId] ? gameState.scores[userId].round1 : 0,
              round2Score: gameState.scores[userId] ? gameState.scores[userId].round2 : 0,
              correctAnswers: 0,
              totalAnswers: 0
          };
          
          // Подсчитываем правильные ответы за раунд
          Object.keys(gameState.answers).forEach(answerId => {
              if (answerId.startsWith(`${round}_`) && gameState.answers[answerId][userId]) {
                  results[userId].totalAnswers++;
                  if (gameState.answers[answerId][userId].isCorrect) {
                      results[userId].correctAnswers++;
                  }
              }
          });
      }
  });
  
  return results;
}

// REST API
app.get('/api/stats/:round/:question', (req, res) => {
  const { round, question } = req.params;
  const answerId = `${round}_${question}`;
  
  if (!gameState.answers[answerId]) {
    return res.json({ answers: [] });
  }
  
  const answers = Object.values(gameState.answers[answerId]);
  res.json({ answers });
});

app.get('/api/participants', (req, res) => {
  const participants = Object.values(gameState.participants)
    .filter(p => p.registered)
    .map(p => ({
      name: p.name,
      userId: Object.keys(gameState.participants).find(key => gameState.participants[key] === p),
      score: gameState.scores[Object.keys(gameState.participants).find(key => gameState.participants[key] === p)]?.total || 0
    }));
  
  res.json({ participants });
});

app.get('/api/scores', (req, res) => {
  const scores = {};
  Object.keys(gameState.scores).forEach(userId => {
    scores[userId] = {
      ...gameState.scores[userId],
      name: gameState.participants[userId]?.name || 'Unknown'
    };
  });
  res.json({ scores });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Откройте в браузере: http://localhost:${PORT}`);
});

function handleAnswer(userId, answerText, chatId) {
    const currentRound = gameState.currentRound;
    const currentQuestion = gameState.currentQuestion;
    const question = gameState.questions[`round${currentRound}`][currentQuestion];
    const answerId = `${currentRound}_${currentQuestion}`;
    
    if (!question) {
        if (bot) {
            bot.sendMessage(chatId, 'Вопрос не найден. Ожидайте следующий вопрос.');
        }
        return;
    }
    
    // Проверяем, отвечал ли уже участник на этот вопрос
    if (gameState.answers[answerId] && gameState.answers[answerId][userId]) {
        if (bot) {
            bot.sendMessage(chatId, 'Вы уже ответили на этот вопрос! Ожидайте следующий.');
        }
        return;
    }
    
    let isCorrect = false;
    let parsedAnswer = answerText;
    
    if (currentRound === 1) {
        const answer = parseAnswer(answerText);
        if (answer === null) {
            if (bot) {
                bot.sendMessage(chatId, 'Неверный формат ответа. Отправьте номер варианта (1, 2, 3, 4) или букву (A, B, C, D)');
            }
            return;
        }
        parsedAnswer = answer;
        isCorrect = (answer === question.correct);
        
        if (isCorrect) {
            if (!gameState.scores[userId]) {
                gameState.scores[userId] = { total: 0, round1: 0, round2: 0 };
            }
            gameState.scores[userId].round1 += 1;
            gameState.scores[userId].total += 1;
        }
    } else {
        isCorrect = false;
    }
    
    // Сохраняем ответ
    if (!gameState.answers[answerId]) {
        gameState.answers[answerId] = {};
    }
    
    gameState.answers[answerId][userId] = {
        answer: parsedAnswer,
        isCorrect,
        userName: gameState.participants[userId].name,
        timestamp: new Date().toISOString(),
        round: currentRound
    };
    
    // Отправляем подтверждение
    if (bot) {
        if (currentRound === 1) {
            const answerLetters = ['A', 'B', 'C', 'D'];
            bot.sendMessage(chatId, 
                `Ваш ответ "${answerLetters[parsedAnswer]}" принят! ✅\n\n` +
                `Правильность будет показана после окончания вопроса.`
            );
        } else {
            bot.sendMessage(chatId, 
                `Ваш ответ "${answerText}" принят! ✅\n\n` +
                `Ведущий проверит ответ и начислит баллы.`
            );
        }
    }
    
    // Уведомляем веб-приложение
    io.emit('newAnswer', {
        type: 'newAnswer',
        answerId,
        userId,
        answer: parsedAnswer,
        isCorrect,
        userName: gameState.participants[userId].name,
        round: currentRound
    });
    
    console.log(`Ответ от ${gameState.participants[userId].name}: ${parsedAnswer} (раунд ${currentRound})`);
}