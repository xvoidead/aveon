'use strict';
// Редактор места острова: двигают настоящий остров — он стоит поверх этого окна и мышь не ловит.
// Здесь только «ручка» по размеру капсулы (#grip), сетка и панель. Капсулу тащат левой кнопкой мыши —
// она плавно идёт за курсором; с зажатым Shift прилипает к сетке. Стрелки — по пикселю, Shift+стрелки —
// по клетке, пробел — показать раскрытым. «Выйти» (Enter) сохраняет, «Отменить» (Esc) — без изменений.
// Окно открывает src/islandedit.js; угол, от которого остров раскрывается, выбирает src/island.js → placement.
const api = window.tishe;
const $ = (s) => document.querySelector(s);
const grip = $('#grip');
const GRID = 24; // клетка сетки; вертикальные линии идут от центра экрана — остров чаще всего по центру

let scr = null; // { width, height, pill: {w, h}, home: {x, y} }
let pos = { x: 0, y: 0 }; // левый верхний угол капсулы 280×36 — то, что уходит в настройки
let real = null; // где настоящая капсула на экране ({x, y, w, h}) — присылает главный процесс
let grab = null; // { dx, dy } — где взяли капсулу, пока тащат
let lastPointer = null;
let opened = false;
let accent = '#f0a63a'; // акцент играющего трека (как у острова); ничего не играет — янтарный

function setAccent(c) {
  if (!c) return;
  accent = c;
  document.documentElement.style.setProperty('--amber', c);
  if (scr) render();
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Тот же выбор угла, что в src/island.js → placement: половина экрана по высоте, треть по ширине
function anchorOf(p) {
  const cx = p.x + scr.pill.w / 2, cy = p.y + scr.pill.h / 2;
  return { v: cy > scr.height / 2 ? 'bottom' : 'top', h: cx < scr.width / 3 ? 'left' : cx > (scr.width * 2) / 3 ? 'right' : 'center' };
}
// в подписи — куда остров раскроется, а не угол: «слева сверху» посреди экрана читалось бы как ошибка
const OPENS_V = { top: 'вниз', bottom: 'вверх' };
const OPENS_H = { left: ' и вправо', right: ' и влево', center: '' };

// По сетке: центр капсулы — на вертикальную линию, верх — на горизонтальную
function snap(x, y) {
  const cx = scr.width / 2;
  const mid = x + scr.pill.w / 2;
  return { x: cx + Math.round((mid - cx) / GRID) * GRID - scr.pill.w / 2, y: Math.round(y / GRID) * GRID };
}

// Остров переезжает не чаще раза в кадр
let moveQueued = false;
function sendMove() {
  if (moveQueued) return;
  moveQueued = true;
  requestAnimationFrame(() => { moveQueued = false; api.islandEdit.move(pos.x, pos.y); });
}

function setPos(x, y, snapped = false) {
  const next = { x: Math.round(clamp(x, 0, scr.width - scr.pill.w)), y: Math.round(clamp(y, 0, scr.height - scr.pill.h)) };
  document.body.classList.toggle('snapping', snapped);
  if (next.x !== pos.x || next.y !== pos.y) {
    pos = next;
    sendMove();
  }
  render();
}

// Ручка и подпись — по настоящей капсуле; пока она не пришла — по капсуле 280×36
function render() {
  const r = real || { x: pos.x, y: pos.y, w: scr.pill.w, h: scr.pill.h };
  grip.style.transform = `translate(${r.x}px, ${r.y}px)`;
  grip.style.width = `${r.w}px`;
  grip.style.height = `${r.h}px`;
  const a = anchorOf(pos);
  const centered = pos.x + scr.pill.w / 2 === scr.width / 2;
  const c = $('#coords');
  c.textContent = `раскроется ${OPENS_V[a.v]}${OPENS_H[a.h]} · ${centered ? 'по центру' : `x ${pos.x}`}, y ${pos.y}`;
  // подпись — со стороны экрана, куда остров не раскрывается
  const below = a.v === 'top' ? r.y + r.h + 10 + 24 < scr.height : r.y - 34 < 0;
  c.style.left = `${clamp(r.x + r.w / 2, 170, scr.width - 170)}px`;
  c.style.top = below ? `${r.y + r.h + 10}px` : `${r.y - 34}px`;
  // панель уходит наверх, когда капсула внизу, — чтобы не мешать
  $('#bar').classList.toggle('top', a.v === 'bottom');
  drawGrid(a);
}

function follow(e) {
  lastPointer = e;
  let x = e.clientX - grab.dx, y = e.clientY - grab.dy;
  if (e.shiftKey) ({ x, y } = snap(x, y));
  setPos(x, y, e.shiftKey);
}

// ---- сетка ----
const cv = $('#grid');
const g = cv.getContext('2d');
function drawGrid(a) {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth, h = window.innerHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const cx = w / 2;
  g.lineWidth = 1;
  // всё цветом акцента, насыщенность — прозрачностью
  g.strokeStyle = accent;
  g.fillStyle = accent;
  g.globalAlpha = 0.12;
  g.beginPath();
  for (let x = cx % GRID; x < w; x += GRID) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, h); }
  for (let y = 0; y < h; y += GRID) { g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); }
  g.stroke();
  // где меняется угол (трети по ширине, половина по высоте) — пунктиром; текущая зона чуть светлее
  if (scr && a) {
    const zx = { left: 0, center: w / 3, right: (w * 2) / 3 }[a.h], zy = a.v === 'top' ? 0 : h / 2;
    g.globalAlpha = 0.07;
    g.fillRect(zx, zy, w / 3, h / 2);
    g.setLineDash([6, 6]);
    g.globalAlpha = 0.3;
    g.beginPath();
    for (const x of [w / 3, (w * 2) / 3]) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, h); }
    g.moveTo(0, Math.round(h / 2) + 0.5); g.lineTo(w, Math.round(h / 2) + 0.5);
    g.stroke();
    g.setLineDash([]);
  }
  // оси через центр экрана; подсвечиваются, когда капсула на них
  const onV = scr && pos.x + scr.pill.w / 2 === cx;
  const onH = scr && pos.y + scr.pill.h / 2 === Math.round(h / 2);
  g.globalAlpha = onV ? 0.9 : 0.4;
  g.beginPath(); g.moveTo(Math.round(cx) + 0.5, 0); g.lineTo(Math.round(cx) + 0.5, h); g.stroke();
  g.globalAlpha = onH ? 0.9 : 0.4;
  g.beginPath(); g.moveTo(0, Math.round(h / 2) + 0.5); g.lineTo(w, Math.round(h / 2) + 0.5); g.stroke();
  g.globalAlpha = 1;
}
window.addEventListener('resize', () => { if (scr) render(); });

// ---- мышь: взять капсулу или нажать на пустое место — капсула прыгает под курсор ----
document.addEventListener('pointerdown', (e) => {
  api.islandEdit.raise(); // нажатие подняло это окно над островом — вернуть остров наверх
  if (e.button !== 0 || !scr || e.target.closest('.bar')) return;
  e.preventDefault();
  document.body.setPointerCapture(e.pointerId);
  // за капсулу взяли — держим за то же место; мимо — капсула встаёт серединой под курсор
  grab = e.target.closest('#grip')
    ? { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    : { dx: scr.pill.w / 2, dy: scr.pill.h / 2 };
  document.body.classList.add('dragging');
  follow(e);
});
document.addEventListener('pointermove', (e) => { if (grab) follow(e); });
const drop = () => {
  if (!grab) return;
  grab = null;
  document.body.classList.remove('dragging', 'snapping');
};
document.addEventListener('pointerup', drop);
document.addEventListener('pointercancel', drop);

// ---- раскрыть: видно, в какую сторону остров откроется ----
function setOpen(on) {
  opened = on;
  api.islandEdit.open(on);
  $('#open').textContent = on ? 'Свернуть' : 'Раскрыть';
  $('#open').classList.toggle('on', on);
}

// ---- клавиатура ----
const done = () => { api.islandEdit.open(false); api.islandEdit.finish({ x: pos.x, y: pos.y }); };
const cancel = () => { api.islandEdit.open(false); api.islandEdit.finish(null); };
document.addEventListener('keydown', (e) => {
  if (!scr) return;
  // Shift нажали или отпустили посреди перетаскивания — сразу прилипнуть или отлипнуть
  if (e.key === 'Shift' && grab && lastPointer) { follow({ clientX: lastPointer.clientX, clientY: lastPointer.clientY, shiftKey: true }); return; }
  const step = e.shiftKey ? GRID : 1;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (d) {
    e.preventDefault();
    let x = pos.x + d[0], y = pos.y + d[1];
    if (e.shiftKey) ({ x, y } = snap(x, y));
    setPos(x, y);
  } else if (e.key === 'Escape') cancel();
  else if (e.key === 'Enter') { e.preventDefault(); done(); }
  else if (e.key === ' ') { e.preventDefault(); setOpen(!opened); }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Shift' && grab && lastPointer) follow({ clientX: lastPointer.clientX, clientY: lastPointer.clientY, shiftKey: false });
});

// кнопки не держат фокус — иначе Enter и пробел нажимали бы последнюю нажатую кнопку
for (const b of document.querySelectorAll('.bar button')) b.addEventListener('mousedown', (e) => e.preventDefault());
$('#center').onclick = () => setPos(scr.width / 2 - scr.pill.w / 2, pos.y);
$('#reset').onclick = () => setPos(scr.home.x, scr.home.y);
$('#open').onclick = () => setOpen(!opened);
$('#cancel').onclick = cancel;
$('#done').onclick = done;

api.islandEdit.onRect((r) => {
  real = r;
  if (scr) render();
});

api.islandEdit.onAccent?.(setAccent);

api.islandEdit.onInit((s) => {
  scr = s;
  setAccent(s.accent);
  pos = { x: s.x, y: s.y };
  render();
  requestAnimationFrame(() => document.body.classList.add('ready'));
});
