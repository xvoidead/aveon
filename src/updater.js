// Автообновления: новые версии лежат в GitHub Releases (xvoidead/aveon, package.json → build.publish).
// Проверяем при запуске и раз в 4 часа, скачиваем в фоне. Скачалось — плеер показывает плашку
// «Перезапустить» (renderer/updates.js); не нажали — версия встанет сама при выходе.
// Работает только в установленном приложении: из `npm start` обновлять нечего.
const { app } = require('electron');

const EVERY = 4 * 3600 * 1000;
const FIRST = 15 * 1000; // не мешаем запуску

let updater = null;
let notify = () => {};
let status = { state: app.isPackaged ? 'idle' : 'dev' }; // idle | checking | none | downloading | ready | error | dev

function set(s) {
  status = s;
  notify(status);
}

function init(onEvent) {
  notify = onEvent;
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (e) {
    console.warn('updater:', e.message);
    status = { state: 'error', error: 'модуль обновлений не найден' };
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true; // «Позже» — поставится при выходе
  updater.logger = null;

  updater.on('checking-for-update', () => { if (status.state !== 'downloading' && status.state !== 'ready') set({ state: 'checking' }); });
  updater.on('update-not-available', () => set({ state: 'none' }));
  updater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }));
  updater.on('download-progress', (p) => set({ state: 'downloading', version: status.version, percent: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }));
  updater.on('error', (e) => {
    // нет сети или GitHub недоступен — не страшно, попробуем в следующий раз; уже скачанное не теряем
    if (status.state === 'ready') return;
    set({ state: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200) });
  });

  setTimeout(check, FIRST);
  setInterval(check, EVERY);
}

function check() {
  if (!updater || status.state === 'downloading' || status.state === 'ready') return status;
  updater.checkForUpdates().catch(() => {}); // ошибку уже поймал обработчик 'error'
  return status;
}

// «Перезапустить»: before — чтобы «закрывать в трей» не спрятало окно вместо выхода (main.js → quitting)
function install(before) {
  if (!updater || status.state !== 'ready') return false;
  before?.();
  setImmediate(() => updater.quitAndInstall(true, true)); // тихо, без мастера установки, и сразу запуск новой версии
  return true;
}

module.exports = { init, check, install, status: () => status };
