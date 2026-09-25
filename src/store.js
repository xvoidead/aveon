// Простые JSON-хранилища в userData: где остановился (session) и статистика прослушивания (stats).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const NAMES = new Set(['session', 'stats']);
const cache = new Map();

function fileOf(name) {
  if (!NAMES.has(name)) throw new Error('unknown store ' + name);
  return path.join(app.getPath('userData'), `${name}.json`);
}

function read(name) {
  if (cache.has(name)) return cache.get(name);
  let data = null;
  try { data = JSON.parse(fs.readFileSync(fileOf(name), 'utf8')); } catch {}
  cache.set(name, data);
  return data;
}

// Запись через временный файл: если приложение упадёт посреди записи, старые данные останутся
function write(name, data) {
  const file = fileOf(name);
  cache.set(name, data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
}

module.exports = { read, write };
