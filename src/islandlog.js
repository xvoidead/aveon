// Временный журнал острова: где теряется нажатие по кнопкам. Пишет в userData/logs/island.log,
// файл обрезается на 256 КБ. Убрать, когда кнопки острова починены.
// Пишет пачками раз в секунду и не ждёт диск: синхронная запись из главного процесса, через который
// идёт состояние острова, на медленном диске (или под антивирусом) подвешивала остров
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let file = null;
let queue = [];
let timer = null;
let writing = false;

function flush() {
  timer = null;
  if (writing || !queue.length) return;
  const chunk = queue.join('');
  queue = [];
  writing = true;
  fs.promises.appendFile(file, chunk).catch(() => {}).finally(() => {
    writing = false;
    if (queue.length && !timer) timer = setTimeout(flush, 1000);
  });
}

function log(...parts) {
  try {
    if (!file) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, 'island.log');
      if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.writeFileSync(file, '');
    }
    const t = new Date().toISOString().slice(11, 23);
    queue.push(`${t} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
    if (queue.length > 2000) queue.splice(0, queue.length - 2000);
    if (!timer) timer = setTimeout(flush, 1000);
  } catch {}
}

module.exports = { log };
