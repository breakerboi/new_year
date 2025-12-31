const fs = require('fs');
const path = require('path');

// Создаем папку uploads если её нет
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('Создана папка uploads для изображений мемов');
}

// Инструкция по загрузке картинок
console.log(`
=== ИНСТРУКЦИЯ ПО ЗАГРУЗКЕ КАРТИНОК ===

1. Поместите изображения мемов в папку uploads/
2. Назовите файлы: meme1.jpg, meme2.jpg, ..., meme12.jpg
3. Форматы: JPG, PNG, GIF
4. Размер: рекомендуется 800x600 пикселей
5. В файле round2.json укажите правильные пути:
   "imageUrl": "/uploads/meme1.jpg"

Пример структуры:
quiz-server/
├── uploads/
│   ├── meme1.jpg
│   ├── meme2.jpg
│   └── ...
├── questions/
│   └── round2.json
└── server.js

Готовые мемы можно скачать здесь:
• https://knowyourmeme.com/
• https://memepedia.ru/
• Google Images с фильтром "мемы"
`);