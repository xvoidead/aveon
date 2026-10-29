// «Остров» — капсула поверх всех окон и рабочего стола (как Dynamic Island): что играет, живой спектр,
// бочка. По нажатию раскрывается с кнопками. Окно прозрачное и пропускает клики мимо капсулы.
// Состояние присылает окно плеера (renderer/island-feed.js), нарисован остров в renderer/island.html.
//
// Ядро устроено так, чтобы остров не залипал:
// - мышь решает только главный процесс (ниже, «мышь»): по часам смотрит, где курсор и где капсула, и
//   включает или выключает пропуск кликов. Без пересылки движения мыши (forward) — она ставила на всю
//   систему перехватчик мыши в главном процессе: любая заминка в нём — и мышь тормозила везде, а Windows
//   молча снимала перехватчик. Состояние «ловим / пропускаем» раз в секунду подтверждаем заново;
// - окно острова после перезагрузки или замены получает всё заново: место, состояние, «раскрыт ли»,
//   где капсула. Старое место капсулы забываем, пока новое окно не пришлёт своё;
// - сторож (ниже) лечит по лестнице: перерисовать → перезагрузить → заменить окно целиком. Если окно
//   не загрузилось или зависло — тоже заменяем, а не ждём вечно; сон компьютера застывшим не считаем.
const { BrowserWindow, screen, powerMonitor } = require('electron');
const games = require('./games');
const path = require('path');
const config = require('./config');
const { log } = require('./islandlog');

const SIZE = { width: 780, height: 420 }; // с запасом: свёрнутая капсула растёт под длину строки, раскрытая — с текстом и друзьями

let win = null;
let main = null;
let last = null; // последнее состояние из окна плеера
let ready = false; // окно острова загрузилось и слушает
let shown = false; // остров виден (прячем прозрачностью, см. conceal)

const cfg = () => ({ enabled: true, pos: 'top', onlyAway: true, ...(config.get().island || {}) });
const alive = () => !!win && !win.isDestroyed();
const send = (ch, v) => { if (alive() && ready) win.webContents.send(ch, v); };

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
// так её можно поставить вплотную к любому краю. Окно уже там — не трогаем (лишний SetWindowPos
// прозрачному окну — лишняя перерисовка)
function place() {
  if (!alive()) return;
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
  const to = { x: Math.round(b.x + px - inner.x), y: Math.round(b.y + py - inner.y), ...SIZE };
  const now = win.getBounds();
  if (now.x !== to.x || now.y !== to.y || now.width !== to.width || now.height !== to.height) win.setBounds(to);
}

// ---- редактор места (src/islandedit.js) ----
// Пока редактор открыт, настоящий остров виден и едет за мышью: место берём из edit.place, а не из
// настроек; мышь остров не ловит — нажатия проходят в окно редактора под ним
let editing = false;
let demo = false; // редактор показывает остров раскрытым
const edit = { display: null, place: null, onRect: null, onAccent: null };
const placeCfg = () => (editing && edit.place ? { ...cfg(), ...edit.place } : cfg());

const sendConfig = () => send('island:config', placeCfg());

// opts.display — экран редактора; opts.onRect(r) — где капсула на нём сейчас (раскрылась, выросла
// под длинное название), чтобы редактор знал, за что её можно взять; opts.onAccent(c) — сменился
// акцент играющего трека (им рисуется сетка)
function setEditing(on, opts = {}) {
  editing = on;
  demo = false;
  edit.display = on ? opts.display : null;
  edit.place = null;
  edit.onRect = on ? opts.onRect : null;
  edit.onAccent = on ? opts.onAccent : null;
  send('island:preview', on || Date.now() < previewUntil); // ничего не играет — капсула всё равно видна
  send('island:demo', false);
  sendConfig();
  update();
  place();
  track();
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
  if (editing && alive()) win.moveTop();
}

// Показать остров раскрытым — видно, в какую сторону он откроется
function editOpen(on) {
  if (!editing) return;
  demo = !!on;
  send('island:demo', demo);
}

// Где капсула на экране редактора — по тому, что прислало окно острова (popup:rect)
function editRect() {
  if (!editing || !edit.onRect || !alive() || !ptr.rect) return;
  const wb = win.getContentBounds(), db = edit.display.bounds, r = ptr.rect;
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
  return { display: d, pill: PILL, px, py, home: { x: home.x + homeIn.x, y: home.y + homeIn.y }, accent: last?.amber || null };
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
    if (!editing) send('island:preview', false);
    update();
  }, 2600);
  ensure();
  place();
  send('island:preview', true);
  update();
}

// ---- мышь ----
// Окно больше капсулы: поля под тень и раскрытие пропускают клики насквозь, а мышь окно ловит, только
// пока курсор над капсулой (или над каплями рядом). Где капсула, присылает окно острова (popup:rect),
// а где курсор — смотрим отсюда по часам: события мыши самого прозрачного окна при переключении
// «пропускать / ловить» врут (ложный mouseleave, сброшенный :hover).
// Зашёл на капсулу — окну «pointer: true» (подсветка); ушёл (с задержкой: раскрытая капсула растёт
// ~0,4 с, её граница догоняет курсор) — «pointer: false», остров сворачивается
const EVERY = 30;
const MARGIN_IN = 4, MARGIN_OUT = 16; // зайти — на 4 px от капсулы, уйти — отойдя на 16 (у края не мигает)
const LEAVE = 350;
const ptr = {
  rect: null, // {x, y, w, h} — капсула в окне; null — окно ещё не сказало
  extra: [], // капли рядом: над ними ловим мышь, но «зашёл» не считаем
  inside: false, // курсор на капсуле (с задержкой на уход)
  outSince: 0,
  open: false, // остров говорит, что раскрыт (island:hover)
  outSent: 0, // когда последний раз сказали «ушёл» раскрытому острову
  catching: null, // ловит ли окно мышь сейчас (null — не знаем, выставим заново)
  assertAt: 0,
};
const within = (r, x, y, m) => x >= r.x - m && x < r.x + r.w + m && y >= r.y - m && y < r.y + r.h + m;

function catchMouse(on) {
  const now = Date.now();
  // подтверждаем раз в секунду, даже если не менялось: стиль окна мог сбросить кто-то ещё
  if (on === ptr.catching && now - ptr.assertAt < 1000) return;
  if (on !== ptr.catching) log('island.mouse', on ? 'ловим' : 'насквозь');
  ptr.catching = on;
  ptr.assertAt = now;
  win.setIgnoreMouseEvents(!on); // без forward: движение мыши острову не нужно, решаем здесь
}

function setInside(on) {
  if (on === ptr.inside) return;
  ptr.inside = on;
  log('island.inside', on, 'rect', ptr.rect);
  send('island:pointer', on);
  if (!on) ptr.outSent = Date.now();
}

function track() {
  if (!alive()) return;
  // спрятан, грузится, в редакторе — мышь не ловим вовсе
  if (!shown || !ready || editing) {
    ptr.outSince = 0;
    if (ptr.inside) { ptr.inside = false; ptr.outSent = Date.now(); }
    catchMouse(false);
    return;
  }
  const now = Date.now();
  let inside = false, extra = false;
  if (ptr.rect) {
    const p = screen.getCursorScreenPoint();
    const b = win.getContentBounds();
    const x = p.x - b.x, y = p.y - b.y;
    inside = within(ptr.rect, x, y, ptr.inside ? MARGIN_OUT : MARGIN_IN);
    extra = ptr.extra.some((r) => within(r, x, y, 0));
  }
  if (inside) ptr.outSince = 0;
  else if (ptr.inside) {
    if (!ptr.outSince) ptr.outSince = now;
    if (now - ptr.outSince < LEAVE) inside = true;
  }
  setInside(inside);
  // остров раскрыт, а курсора на нём давно нет: «ушёл» потерялся (перезагрузка, гонка) — напоминаем
  if (ptr.open && !ptr.inside && now - ptr.outSent > 1000) {
    ptr.outSent = now;
    send('island:pointer', false);
  }
  catchMouse(inside || extra);
}
setInterval(track, EVERY);

// Окно острова говорит, где капсула (на каждом кадре, пока она меняет размер, и раз в 150 мс)
function setRect(r) {
  const ok = (v) => v && [v.x, v.y, v.w, v.h].every(Number.isFinite);
  ptr.rect = ok(r) ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
  ptr.extra = Array.isArray(r?.extra) ? r.extra.filter(ok).slice(0, 4) : [];
  editRect(); // открыт редактор места — он узнает, что капсула выросла или раскрылась
}

// Остров раскрылся (нажатием) или свернулся. Раскрылся — значит, курсор на нём: ловим мышь сразу,
// не дожидаясь часов; если курсор на самом деле снаружи, через LEAVE часы скажут «ушёл»
function hover(open) {
  ptr.open = !!open;
  if (!open || !shown || editing) return;
  ptr.inside = true;
  ptr.outSince = 0;
  track();
}

// Новое окно или перезагрузка: всё, что знали о мыши, — от старого
function forgetPointer() {
  ptr.rect = null;
  ptr.extra = [];
  ptr.inside = false;
  ptr.outSince = 0;
  ptr.open = false;
  ptr.catching = null;
}

function ensure() {
  if (alive()) return;
  ready = false;
  shown = false;
  forgetPointer();
  const w = new BrowserWindow({
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
  win = w;
  w.setIgnoreMouseEvents(true);
  ptr.catching = false;
  level();
  const wc = w.webContents;
  // где капсула — прямо из этого окна (main.js шлёт popup:rect ещё и в src/hover.js, тому остров не нужен)
  wc.ipc.on('popup:rect', (e, r) => setRect(r));
  wc.on('did-start-loading', () => {
    ready = false;
    loadingSince = Date.now();
    forgetPointer(); // старое место капсулы — от прошлой страницы; новая пришлёт своё
  });
  // on, а не once: после перезагрузки сторожем остров снова получает всё
  wc.on('did-finish-load', () => {
    ready = true;
    loadingSince = 0;
    lastBeat = Date.now();
    wc.send('island:config', placeCfg());
    if (editing || Date.now() < previewUntil) wc.send('island:preview', true);
    if (last) wc.send('island:state', last);
    if (editing && demo) wc.send('island:demo', true);
    if (shown) conceal(false); // окно уже было видно — сбросить «спрятан» и в самом острове
    update();
    track();
  });
  wc.on('did-fail-load', (e, code, desc) => { if (code !== -3) log('island.fail-load', code, desc); }); // -3 — прервали новой загрузкой
  wc.on('render-process-gone', (e, d) => { log('island.gone', d.reason, d.exitCode); revive('gone'); });
  wc.on('unresponsive', () => { log('island.unresponsive'); hungSince = Date.now(); });
  wc.on('responsive', () => { log('island.responsive'); hungSince = 0; });
  w.on('closed', () => {
    if (win !== w) return;
    win = null;
    ready = false;
    shown = false;
  });
  w.loadFile(path.join(__dirname, '..', 'renderer', 'island.html'));
  place();
}

// ---- сторож ----
// Остров из цикла отрисовки раз в секунду говорит «живой» (renderer/island.js → tick). Замолчал, пока
// виден, — окно перестало выводить кадры или повисло. Лечим по лестнице: попросить перерисовать окно →
// перезагрузить → заменить окно целиком. Повис (unresponsive) или не загрузился за 8 с — сразу замена.
// Компьютер спал или экран заблокирован — кадров и не должно было быть: ждём заново. Всё — в журнал
let lastBeat = Date.now();
let stalls = 0;
let loadingSince = 0;
let hungSince = 0;
let asleep = false;
let replacedAt = 0;
function beat() {
  if (stalls) log('island.beat после', stalls, 'попыток');
  lastBeat = Date.now();
  stalls = 0;
}
function revive(why) {
  if (!alive()) return;
  log('island.revive', why);
  lastBeat = Date.now();
  win.webContents.reload(); // did-start-loading сбросит ready и мышь
}
// Заменить окно: старое уничтожаем, новое создаём и показываем со всем, что знаем
function replace(why) {
  log('island.replace', why);
  replacedAt = Date.now();
  stalls = 0;
  hungSince = 0;
  loadingSince = 0;
  const old = win;
  win = null;
  ready = false;
  shown = false;
  if (old && !old.isDestroyed()) old.destroy();
  update(); // нужен — ensure() создаст новое, did-finish-load покажет
}
setInterval(() => {
  if (!alive() || asleep) return;
  const now = Date.now();
  if (now - replacedAt < 10000) return; // только что заменили — даём загрузиться
  if (loadingSince && now - loadingSince > 8000) return replace('не загрузился');
  if (hungSince && now - hungSince > 4000) return replace('повис');
  if (!ready || !shown || now - lastBeat < 3000) return;
  stalls++;
  log('island.stall', Math.round((now - lastBeat) / 1000), 'с, попытка', stalls);
  if (stalls === 1) win.webContents.invalidate();
  else if (stalls === 2) revive('stall');
  else if (stalls >= 4) replace('stall'); // перезагрузка не помогла (на 3-м ждём, пока она догрузится)
}, 1500);

function sleepWake() {
  powerMonitor.on('suspend', () => { asleep = true; });
  powerMonitor.on('lock-screen', () => { asleep = true; });
  const wake = () => {
    asleep = false;
    lastBeat = Date.now();
    stalls = 0;
    if (alive()) { level(); place(); win.webContents.invalidate(); } // после сна прозрачное окно бывает пустым
  };
  powerMonitor.on('resume', wake);
  powerMonitor.on('unlock-screen', wake);
}

function level() {
  if (!alive()) return;
  win.setAlwaysOnTop(true, 'screen-saver'); // выше и полноэкранных окон; в играх прячет «прятать в играх»
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

// Игры и видео на весь экран сами встают «поверх всех» и отодвигают остров вниз — поднимаем его
// обратно, пока он виден. Фокус не забирает. Над эксклюзивным полноэкранным режимом (не «без рамки»)
// окно не нарисовать никак — там помогает только режим «оконный без рамки» в самой игре
setInterval(() => {
  if (!alive() || !shown) return;
  if (ptr.inside || ptr.open || ptr.catching) return; // курсор на острове — не трогаем окно, чтобы не сорвать клик
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
// showInactive() перестаёт получать клики (проверено — движение мыши доходит, нажатия нет).
// Спрятанный остров ещё и сворачивается и забывает «раскрыт» (island:pointer 'reset')
function conceal(hide) {
  if (hide) send('island:pointer', 'reset');
  win.setOpacity(hide ? 0 : 1);
}

function update() {
  if (!wanted()) {
    if (alive() && shown) {
      shown = false;
      ptr.open = false;
      track(); // мышь не ловим, клики насквозь
      conceal(true);
    }
    return;
  }
  ensure();
  if (!ready || shown) return;
  shown = true;
  lastBeat = Date.now(); // пока был прозрачным, кадров могло не быть — ждём заново
  stalls = 0;
  place();
  conceal(false);
  if (!win.isVisible()) win.showInactive(); // только в первый раз — дальше окно не прячется
  track();
}

function init(mainWindow) {
  main = mainWindow;
  for (const ev of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide']) main.on(ev, () => setTimeout(update, 60));
  screen.on('display-metrics-changed', place);
  screen.on('display-added', place);
  screen.on('display-removed', place);
  sleepWake();
  games.start(() => cfg().enabled && !!cfg().hideInGames, () => update());
}

function state(s) {
  if (editing && s.amber && s.amber !== last?.amber) edit.onAccent?.(s.amber);
  last = s;
  send('island:state', s);
  update();
}

function settingsChanged() {
  if (alive()) {
    level();
    place();
    sendConfig();
  }
  update();
}

function destroy() {
  if (alive()) win.destroy();
}

module.exports = { init, state, beat, hover, settingsChanged, destroy, preview, screenInfo, editInfo, placement, setEditing, editMove, editOpen, editRect, editRaise };
