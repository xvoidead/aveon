// Мини-плеер: маленькое окно поверх всех окон с обложкой, названием, строкой текста и кнопками.
// Его можно утащить куда угодно — место запоминается. Состояние то же, что у острова (island-feed.js).
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('./config');

const SIZE = { width: 360, height: 112 };

let win = null;
let ready = false;
let last = null;
let notify = () => {};

const cfg = () => ({ open: false, onMinimize: false, top: true, opacity: 100, x: null, y: null, ...(config.get().mini || {}) });

function startBounds() {
  const c = cfg();
  const wa = screen.getPrimaryDisplay().workArea;
  let x = c.x ?? wa.x + wa.width - SIZE.width - 24;
  let y = c.y ?? wa.y + wa.height - SIZE.height - 24;
  // сохранённое место вне всех экранов (отключили монитор) — ставим в угол основного
  const inside = screen.getAllDisplays().some((d) => x >= d.workArea.x - 40 && y >= d.workArea.y - 40 && x < d.workArea.x + d.workArea.width - 40 && y < d.workArea.y + d.workArea.height - 40);
  if (!inside) { x = wa.x + wa.width - SIZE.width - 24; y = wa.y + wa.height - SIZE.height - 24; }
  return { x: Math.round(x), y: Math.round(y), ...SIZE };
}

function open() {
  if (win && !win.isDestroyed()) { win.showInactive(); return; }
  ready = false;
  win = new BrowserWindow({
    ...startBounds(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    title: 'мини-плеер авеона',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setIgnoreMouseEvents(true, { forward: true }); // поля вокруг карточки пропускают клики (renderer/mini.js)
  apply();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'mini.html'));
  win.webContents.once('did-finish-load', () => {
    ready = true;
    if (last) win.webContents.send('island:state', last);
    win.showInactive();
  });
  let saveTimer;
  win.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      config.set({ mini: { x, y } });
    }, 400);
  });
  win.on('closed', () => { win = null; ready = false; });
  if (!cfg().open) { config.set({ mini: { open: true } }); notify(); }
}

function close() {
  if (win && !win.isDestroyed()) win.destroy();
  if (cfg().open) { config.set({ mini: { open: false } }); notify(); }
}

function toggle() {
  if (win && !win.isDestroyed()) close(); else open();
}

function hover(on) {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!on, { forward: true });
}

function isOpen() { return !!(win && !win.isDestroyed()); }

function apply() {
  if (!win || win.isDestroyed()) return;
  const c = cfg();
  win.setAlwaysOnTop(!!c.top, 'floating');
  win.setOpacity(Math.max(0.3, Math.min(1, c.opacity / 100)));
}

function state(s) {
  last = s;
  if (win && !win.isDestroyed() && ready) win.webContents.send('island:state', s);
}

// Свернули плеер — вместо него мини-плеер (если так настроено), развернули — убираем
function init(main, onChange) {
  if (onChange) notify = onChange;
  main.on('minimize', () => { if (cfg().onMinimize && last?.hasTrack) open(); });
  main.on('restore', () => { if (cfg().onMinimize && isOpen()) close(); });
  if (cfg().open) open();
}

function settingsChanged() { apply(); }

function destroy() {
  if (win && !win.isDestroyed()) win.destroy();
}

module.exports = { init, open, close, toggle, isOpen, hover, state, settingsChanged, destroy };
