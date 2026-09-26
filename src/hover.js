// Прозрачные всплывающие окна (остров, мини-плеер, эквалайзер) больше своей панели: поля под тень
// пропускают клики насквозь, а мышь окно ловит, только пока курсор над панелью.
// Окно само сообщает, где панель (popup:rect) и что курсор над ней (hover). Но над областями
// перетаскивания окно движение мыши не получает — поэтому курсор ещё и проверяем отсюда, по часам.
const { screen } = require('electron');
const { log } = require('./islandlog'); // временно: где теряется нажатие

const EVERY = 30;
// запас у края: зайти — на 4 px от панели, уйти — только отойдя на 16 px (чтобы у края не мигало)
const MARGIN_IN = 4;
const MARGIN_OUT = 16;
const watched = new Map(); // BrowserWindow → { rect: {x, y, w, h} | null, hovered, on, inside, onInside }
let timer = null;

function apply(win, s) {
  let inside = false;
  if (s.rect) {
    const p = screen.getCursorScreenPoint();
    const b = win.getContentBounds();
    const x = p.x - b.x, y = p.y - b.y;
    const m = s.inside ? MARGIN_OUT : MARGIN_IN;
    inside = x >= s.rect.x - m && x < s.rect.x + s.rect.w + m && y >= s.rect.y - m && y < s.rect.y + s.rect.h + m;
  }
  if (inside !== s.inside) {
    s.inside = inside;
    if (s.onInside) log('hover.inside', inside, 'rect', s.rect, 'cursor', screen.getCursorScreenPoint(), 'bounds', win.getContentBounds());
    s.onInside?.(inside);
  }
  const on = s.hovered || inside;
  if (on === s.on) return;
  s.on = on;
  if (s.onInside) log('hover.catchMouse', on, 'hovered', s.hovered, 'inside', s.inside);
  win.setIgnoreMouseEvents(!on, { forward: true });
}

function tick() {
  for (const [win, s] of watched) {
    if (win.isDestroyed()) { watched.delete(win); continue; }
    if (win.isVisible()) apply(win, s);
  }
  if (!watched.size) { clearInterval(timer); timer = null; }
}

// onInside(on) — курсор зашёл на панель / ушёл с неё (по часам, а не по событиям мыши окна)
function watch(win, { onInside } = {}) {
  watched.set(win, { rect: null, hovered: false, on: false, inside: false, onInside });
  win.setIgnoreMouseEvents(true, { forward: true });
  if (!timer) timer = setInterval(tick, EVERY);
}

function setHover(win, on) {
  const s = win && watched.get(win);
  if (!s || win.isDestroyed()) return;
  s.hovered = on;
  if (s.onInside) log('hover.setHover', on);
  apply(win, s);
}

function setRect(win, rect) {
  const s = win && watched.get(win);
  if (!s) return;
  s.rect = rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ? rect : null;
}

// Окно спрятали под курсором — mouseleave не придёт: сбрасываем, чтобы после показа не ловило мышь зря
function reset(win) {
  const s = win && watched.get(win);
  if (!s || win.isDestroyed()) return;
  if (s.onInside) log('hover.reset (окно прячут)');
  s.hovered = false;
  s.on = false;
  s.inside = false;
  win.setIgnoreMouseEvents(true, { forward: true });
}

module.exports = { watch, setHover, setRect, reset };
