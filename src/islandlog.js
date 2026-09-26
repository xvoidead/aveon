// Временный журнал острова: где теряется нажатие по кнопкам. Пишет в userData/logs/island.log,
// файл обрезается на 256 КБ. Убрать, когда кнопки острова починены.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let file = null;

function log(...parts) {
  try {
    if (!file) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, 'island.log');
      if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.writeFileSync(file, '');
    }
    const t = new Date().toISOString().slice(11, 23);
    fs.appendFileSync(file, `${t} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
  } catch {}
}

module.exports = { log };
