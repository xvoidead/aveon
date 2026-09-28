// «Остров» — капсула поверх всех окон и рабочего стола (как Dynamic Island): что играет, живой спектр,
// бочка. При наведении раскрывается с кнопками. Окно прозрачное и пропускает клики мимо капсулы.
// Состояние присылает окно плеера (renderer/island-feed.js), нарисован остров в renderer/island.html.
const { BrowserWindow, screen } = require('electron');
const hoverWatch = require('./hover');
const games = require('./games');
const path = require('path');
const config = require('./config');

const SIZE = { width: 780, height: 420 }; // с запасом: свёрнутая капсула растёт под длину строки, раскрытая — с текстом и друзьями

let win = null;
let main = null;
let last = null; // последнее состояние из окна плеера
let ready = false;

const cfg = () => ({ enabled: true, pos: 'top', onlyAway: true, ...(config.get().island || {}) });

// На каком экране остров. Плеер перед глазами — на его экране (там и настройки мини-экрана);
// плеер свёрнут или позади — там, где курсор: с двумя мониторами игра обычно не на экране плеера
function display() {
  const front = main && !main.isDestroyed() && main.isVisible() && !main.isMinimized() && main.isFocused();
  if (front) return screen.getDisplayMatching(main.getBounds());
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}
let placedOn = null; // id экрана, на котором остров сейчас

// Край (pos) — угол, к которому прижата капсула и от которого она раскрывается: top, left, right
// (верх: по центру, слева, справа) и bottom, bottom-left, bottom-right. Раскрытый остров растёт
// от этого угла внутрь экрана (renderer/island.css: body.v-bottom, h-left, h-right)
const anchor = (pos = 'top') => ({
  v: pos.startsWith('bottom') ? 'bottom' : 'top',
  h: pos.endsWith('left') ? 'left' : pos.endsWith('right') ? 'right' : 'center',
});

// Капсула внутри прозрачного окна (renderer/island.css: свёрнутая 280×36, поля 8 px, снизу 10)
const PILL = { w: 280, h: 36 };
function pillIn(pos) {
  const a = anchor(pos);
  const x = a.h === 'left' ? 8 : a.h === 'right' ? SIZE.width - PILL.w - 8 : (SIZE.width - PILL.w) / 2;
  const y = a.v === 'bottom' ? SIZE.height - PILL.h - 10 : 8;
  return { x, y };
}

// Где окно острова без сдвига — относительно экрана
function baseWindow(pos, d) {
  const wa = d.workArea, b = d.bounds;
  const a = anchor(pos);
  let x = wa.x - b.x + (wa.width - SIZE.width) / 2;
  let y = 0;
  if (a.h === 'left') x = wa.x - b.x + 12;
  if (a.h === 'right') x = wa.x - b.x + wa.width - SIZE.width - 12;
  if (a.v === 'bottom') y = wa.y - b.y + wa.height - SIZE.height;
  return { x, y };
}

// Место острова: край экрана (pos) плюс свой сдвиг x/y. Ограничиваем по капсуле, а не по окну —
// так её можно поставить вплотную к любому краю
function place() {
  if (!win || win.isDestroyed()) return;
  const c = placeCfg();
  const d = editing ? edit.display : display();
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

// ---- редактор места (src/islandedit.js) ----
// Пока редактор открыт, настоящий остров виден и едет за мышью: место берём из edit.place, а не из
// настроек; мышь остров не ловит — нажатия проходят в окно редактора под ним
let editing = false;
const edit = { display: null, place: null, onRect: null };
const placeCfg = () => (editing && edit.place ? { ...cfg(), ...edit.place } : cfg());

function sendConfig() {
  if (win && !win.isDestroyed() && ready) win.webContents.send('island:config', placeCfg());
}

// opts.display — экран редактора; opts.onRect(r) — где капсула на нём сейчас (раскрылась, выросла
// под длинное название), чтобы редактор знал, за что её можно взять
function setEditing(on, opts = {}) {
  editing = on;
  edit.display = on ? opts.display : null;
  edit.place = null;
  edit.onRect = on ? opts.onRect : null;
  if (win && !win.isDestroyed() && ready) {
    win.webContents.send('island:preview', on); // ничего не играет — капсула всё равно видна
    win.webContents.send('island:demo', false);
  }
  sendConfig();
  update();
  place();
  if (win && !win.isDestroyed()) hoverWatch.setOff(win, on || !shown);
}

// Капсулу в редакторе передвинули: px, py — левый верхний угол капсулы 280×36 на экране
function editMove(px, py) {
  if (!editing) return;
  const p = placement(px, py, edit.display);
  const posChanged = p.pos !== edit.place?.pos;
  edit.place = p;
  if (posChanged) sendConfig();
  place();
  editRaise();
  editRect();
}

// Окно редактора с тем же уровнем «поверх всех» по нажатию встаёт выше острова — поднимаем остров
function editRaise() {
  if (editing && win && !win.isDestroyed()) win.moveTop();
}

// Показать остров раскрытым — видно, в какую сторону он откроется
function editOpen(on) {
  if (editing && win && !win.isDestroyed() && ready) win.webContents.send('island:demo', !!on);
}

// Где капсула на экране редактора — по тому, что прислало окно острова (popup:rect → src/hover.js)
function editRect() {
  if (!editing || !edit.onRect || !win || win.isDestroyed()) return;
  const r = hoverWatch.rect(win);
  if (!r) return;
  const wb = win.getContentBounds(), db = edit.display.bounds;
  edit.onRect({ x: wb.x - db.x + r.x, y: wb.y - db.y + r.y, w: r.w, h: r.h });
}

// Где сейчас капсула на экране острова (левый верхний угол, от края экрана) и где она по умолчанию
function editInfo() {
  const c = cfg();
  const d = display();
  const b = d.bounds;
  const base = baseWindow(c.pos, d), inner = pillIn(c.pos);
  const px = Math.max(0, Math.min(base.x + inner.x + (c.x || 0), b.width - PILL.w));
  const py = Math.max(0, Math.min(base.y + inner.y + (c.y || 0), b.height - PILL.h));
  const home = baseWindow('top', d), homeIn = pillIn('top');
  return { display: d, pill: PILL, px, py, home: { x: home.x + homeIn.x, y: home.y + homeIn.y } };
}

// Точка на экране → угол (pos) и сдвиг от него. Угол выбираем по месту: верхняя или нижняя половина
// экрана, левая, средняя или правая треть. От угла зависит, куда раскрывается капсула (снизу — вверх,
// слева — вправо, справа — влево), чтобы раскрытый остров не уезжал за экран
function placement(px, py, d) {
  const b = d.bounds;
  const cx = px + PILL.w / 2, cy = py + PILL.h / 2;
  const h = cx < b.width / 3 ? 'left' : cx > (b.width * 2) / 3 ? 'right' : '';
  const pos = cy > b.height / 2 ? (h ? `bottom-${h}` : 'bottom') : h || 'top';
  const base = baseWindow(pos, d), inner = pillIn(pos);
  return { pos, x: Math.round(px - base.x - inner.x), y: Math.round(py - base.y - inner.y) };
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
  hoverWatch.watch(win, { leaveDelay: 350, onInside: (on) => { if (ready && !win.isDestroyed()) win.webContents.send('island:pointer', on); } });
  level();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'island.html'));
  win.webContents.once('did-finish-load', () => {
    ready = true;
    win.webContents.send('island:config', placeCfg());
    if (editing) win.webContents.send('island:preview', true);
    if (last) win.webContents.send('island:state', last);
    update();
  });
  win.on('closed', () => { win = null; ready = false; shown = false; });
  place();
}

function level() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver'); // выше и полноэкранных окон; в играх прячет «прятать в играх»
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

// Игры и видео на весь экран сами встают «поверх всех» и отодвигают остров вниз — поднимаем его
// обратно, пока он виден. Фокус не забирает. Над эксклюзивным полноэкранным режимом (не «без рамки»)
// окно не нарисовать никак — там помогает только режим «оконный без рамки» в самой игре
setInterval(() => {
  if (!win || win.isDestroyed() || !shown) return;
  if (hoverWatch.isInside(win)) return; // курсор на острове — не трогаем окно, чтобы не сорвать клик
  if (!editing && display().id !== placedOn) place(); // курсор ушёл на другой монитор — остров за ним
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}, 1500);

// Когда показывать: включён, есть трек и (если так настроено) окно плеера не перед глазами
function wanted() {
  const c = cfg();
  if (editing) return true; // в редакторе остров виден всегда — его и двигают
  if (Date.now() < previewUntil) return true;
  if (!c.enabled || !last?.hasTrack) return false; // уведомления остров не раскрывают (капля слева) — без трека показывать нечего
  if (games.snipping()) return false; // открыты «Ножницы» — не лезем в снимок (src/games.js)
  if (c.hideInGames && games.current()) return false; // идёт игра — остров не мешает (src/games.js)
  if (!c.onlyAway || !main || main.isDestroyed()) return true;
  return main.isMinimized() || !main.isVisible() || !main.isFocused();
}

// Остров прячем не hide(), а полной прозрачностью: окно с focusable: false после hide() и
// showInactive() перестаёт получать клики (проверено — движение мыши доходит, нажатия нет),
// и кнопки острова ломались после каждого события и смены окна
let shown = false;
function update() {
  if (!wanted()) {
    if (win && !win.isDestroyed() && shown) {
      shown = false;
      hoverWatch.setOff(win, true); // мышь не ловим, клики насквозь
      // острову — свернуться и забыть «раскрыт»
      if (ready) win.webContents.send('island:pointer', 'reset');
      win.setOpacity(0);
    }
    return;
  }
  ensure();
  if (!ready || shown) return;
  shown = true;
  place();
  win.setOpacity(1);
  hoverWatch.setOff(win, editing); // в редакторе мышь не ловим: нажатия — редактору
  if (!win.isVisible()) win.showInactive(); // только в первый раз — дальше окно не прячется
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
    sendConfig();
  }
  update();
}

function destroy() {
  if (win && !win.isDestroyed()) win.destroy();
}

module.exports = { init, state, hover, settingsChanged, destroy, preview, screenInfo, editInfo, placement, setEditing, editMove, editOpen, editRect, editRaise };
