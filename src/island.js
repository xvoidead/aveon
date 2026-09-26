// «Остров» — капсула поверх всех окон и рабочего стола (как Dynamic Island): что играет, живой спектр,
// бочка. При наведении раскрывается с кнопками. Окно прозрачное и пропускает клики мимо капсулы.
// Состояние присылает окно плеера (renderer/island-feed.js), нарисован остров в renderer/island.html.
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('./config');

const SIZE = { width: 520, height: 170 }; // с запасом под раскрытую капсулу и тень

let win = null;
let main = null;
let last = null; // последнее состояние из окна плеера
let ready = false;

const cfg = () => ({ enabled: true, pos: 'top', onlyAway: true, overFullscreen: false, ...(config.get().island || {}) });

function place() {
  if (!win || win.isDestroyed()) return;
  const c = cfg();
  const d = main && !main.isDestroyed() ? screen.getDisplayMatching(main.getBounds()) : screen.getPrimaryDisplay();
  const wa = d.workArea;
  const b = d.bounds;
  let x = Math.round(wa.x + (wa.width - SIZE.width) / 2);
  let y = b.y;
  if (c.pos === 'left') x = wa.x + 12;
  if (c.pos === 'right') x = wa.x + wa.width - SIZE.width - 12;
  if (c.pos === 'bottom') y = wa.y + wa.height - SIZE.height;
  win.setBounds({ x, y, ...SIZE });
}

function ensure() {
  if (win && !win.isDestroyed()) return;
  ready = false;
  win = new BrowserWindow({
    ...SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false, // не отнимает фокус у игры или браузера
    hasShadow: false,
    title: 'остров авеона',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  level();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'island.html'));
  win.webContents.once('did-finish-load', () => {
    ready = true;
    win.webContents.send('island:config', cfg());
    if (last) win.webContents.send('island:state', last);
    update();
  });
  win.on('closed', () => { win = null; ready = false; });
  place();
}

function level() {
  if (!win || win.isDestroyed()) return;
  // screen-saver — выше полноэкранных приложений; floating — только над обычными окнами
  win.setAlwaysOnTop(true, cfg().overFullscreen ? 'screen-saver' : 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: cfg().overFullscreen });
}

// Когда показывать: включён, есть трек и (если так настроено) окно плеера не перед глазами
function wanted() {
  const c = cfg();
  if (!c.enabled || !last?.hasTrack) return false;
  if (!c.onlyAway || !main || main.isDestroyed()) return true;
  return main.isMinimized() || !main.isVisible() || !main.isFocused();
}

function update() {
  if (!wanted()) {
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
    return;
  }
  ensure();
  if (ready && !win.isVisible()) {
    place();
    win.showInactive();
  }
}

function init(mainWindow) {
  main = mainWindow;
  for (const ev of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide']) main.on(ev, () => setTimeout(update, 60));
  screen.on('display-metrics-changed', place);
  screen.on('display-added', place);
  screen.on('display-removed', place);
}

function state(s) {
  last = s;
  if (win && !win.isDestroyed() && ready) win.webContents.send('island:state', s);
  update();
}

// Курсор на капсуле — ловим клики; ушёл — окно снова прозрачно для мыши
function hover(on) {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!on, { forward: true });
}

function settingsChanged() {
  if (win && !win.isDestroyed()) {
    level();
    place();
    if (ready) win.webContents.send('island:config', cfg());
  }
  update();
}

function destroy() {
  if (win && !win.isDestroyed()) win.destroy();
}

module.exports = { init, state, hover, settingsChanged, destroy };
