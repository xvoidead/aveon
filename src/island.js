// «Остров» — капсула поверх всех окон и рабочего стола (как Dynamic Island): что играет, живой спектр,
// бочка. При наведении раскрывается с кнопками. Окно прозрачное и пропускает клики мимо капсулы.
// Состояние присылает окно плеера (renderer/island-feed.js), нарисован остров в renderer/island.html.
const { BrowserWindow, screen } = require('electron');
const hoverWatch = require('./hover');
const games = require('./games');
const path = require('path');
const config = require('./config');

const SIZE = { width: 780, height: 290 }; // с запасом: свёрнутая капсула растёт под длину строки, раскрытая — с текстом и друзьями

let win = null;
let main = null;
let last = null; // последнее состояние из окна плеера
let ready = false;

const cfg = () => ({ enabled: true, pos: 'top', onlyAway: true, overFullscreen: false, ...(config.get().island || {}) });

// На каком экране остров. Плеер перед глазами — на его экране (там и настройки мини-экрана);
// плеер свёрнут или позади — там, где курсор: с двумя мониторами игра обычно не на экране плеера
function display() {
  const front = main && !main.isDestroyed() && main.isVisible() && !main.isMinimized() && main.isFocused();
  if (front) return screen.getDisplayMatching(main.getBounds());
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}
let placedOn = null; // id экрана, на котором остров сейчас

// Капсула внутри прозрачного окна (renderer/island.css: свёрнутая 280×36, поля 8 px, снизу 10)
const PILL = { w: 280, h: 36 };
function pillIn(pos) {
  const x = pos === 'left' ? 8 : pos === 'right' ? SIZE.width - PILL.w - 8 : (SIZE.width - PILL.w) / 2;
  const y = pos === 'bottom' ? SIZE.height - PILL.h - 10 : 8;
  return { x, y };
}

// Где окно острова без сдвига — относительно экрана
function baseWindow(pos, d) {
  const wa = d.workArea, b = d.bounds;
  let x = wa.x - b.x + (wa.width - SIZE.width) / 2;
  let y = 0;
  if (pos === 'left') x = wa.x - b.x + 12;
  if (pos === 'right') x = wa.x - b.x + wa.width - SIZE.width - 12;
  if (pos === 'bottom') y = wa.y - b.y + wa.height - SIZE.height;
  return { x, y };
}

// Место острова: край экрана (pos) плюс свой сдвиг x/y. Ограничиваем по капсуле, а не по окну —
// так её можно поставить вплотную к любому краю
function place() {
  if (!win || win.isDestroyed()) return;
  const c = cfg();
  const d = display();
  placedOn = d.id;
  const b = d.bounds;
  const base = baseWindow(c.pos, d);
  const inner = pillIn(c.pos);
  let px = base.x + inner.x + (c.x || 0);
  let py = base.y + inner.y + (c.y || 0);
  px = Math.max(0, Math.min(px, b.width - PILL.w));
  py = Math.max(0, Math.min(py, b.height - PILL.h));
  win.setBounds({ x: Math.round(b.x + px - inner.x), y: Math.round(b.y + py - inner.y), ...SIZE });
}

// Для мини-экрана в настройках: размер экрана и где стоит капсула без сдвига при каждом pos
function screenInfo() {
  const d = display();
  const bases = {};
  for (const pos of ['top', 'left', 'right', 'bottom']) {
    const w = baseWindow(pos, d), inner = pillIn(pos);
    bases[pos] = { x: Math.round(w.x + inner.x), y: Math.round(w.y + inner.y) };
  }
  return { width: d.bounds.width, height: d.bounds.height, pill: PILL, bases };
}

// Пока в настройках двигают остров, он виден, даже если плеер в фокусе или ничего не играет
let previewUntil = 0;
let previewTimer = null;
function preview() {
  previewUntil = Date.now() + 2500;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewUntil = 0;
    if (win && !win.isDestroyed() && ready) win.webContents.send('island:preview', false);
    update();
  }, 2600);
  ensure();
  place();
  if (ready) win.webContents.send('island:preview', true);
  update();
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
  // заход курсора на капсулу решает главный процесс: события мыши в прозрачном окне врут при
  // переключении «пропускать клики / ловить» (ложный mouseleave — капсула закрывалась и клики уходили)
  hoverWatch.watch(win, { onInside: (on) => { if (ready && !win.isDestroyed()) win.webContents.send('island:pointer', on); } });
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

// Игры и видео на весь экран сами встают «поверх всех» и отодвигают остров вниз — поднимаем его
// обратно, пока он виден. Фокус не забирает. Над эксклюзивным полноэкранным режимом (не «без рамки»)
// окно не нарисовать никак — там помогает только режим «оконный без рамки» в самой игре
setInterval(() => {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  if (display().id !== placedOn) place(); // курсор ушёл на другой монитор — остров за ним
  if (!cfg().overFullscreen) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}, 1500);

// Когда показывать: включён, есть трек и (если так настроено) окно плеера не перед глазами
function wanted() {
  const c = cfg();
  if (Date.now() < previewUntil) return true;
  if (!c.enabled || !last?.hasTrack) return false;
  if (c.hideInGames && games.current()) return false; // идёт игра — остров не мешает (src/games.js)
  if (!c.onlyAway || !main || main.isDestroyed()) return true;
  return main.isMinimized() || !main.isVisible() || !main.isFocused();
}

function update() {
  if (!wanted()) {
    if (win && !win.isDestroyed() && win.isVisible()) {
      hoverWatch.reset(win); // спрятали под курсором — mouseleave не придёт
      win.hide();
    }
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
  games.start(() => cfg().enabled && !!cfg().hideInGames, () => update());
}

function state(s) {
  last = s;
  if (win && !win.isDestroyed() && ready) win.webContents.send('island:state', s);
  update();
}

// Курсор на капсуле — ловим клики; ушёл — окно снова прозрачно для мыши
function hover(on) {
  hoverWatch.setHover(win, on); // src/hover.js: ещё и сам смотрит, где курсор
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

module.exports = { init, state, hover, settingsChanged, destroy, preview, screenInfo };
