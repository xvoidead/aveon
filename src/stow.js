// «Свернуть в трей» с анимацией: окно плеера будто улетает в значок трея и вылетает из него обратно.
// Двигать и сжимать настоящее окно по кадрам — дёргано (перерисовка всего плеера), поэтому летит его
// снимок: прозрачное окно-подложка на весь экран рисует картинку окна и CSS-ом уносит её к значку.
// Само окно прячется сразу, как подложка готова, и показывается, когда снимок долетел обратно.
const { BrowserWindow, screen } = require('electron');

const OUT_MS = 420;
const IN_MS = 380;
let busy = false;
let shot = null; // последний снимок окна (JPEG data URL) — для обратного полёта: спрятанное окно не снять

// Центр значка в трее; значок в «скрытых значках» (getBounds пустой) — угол у часов на экране окна
function trayPoint(trayBounds, d) {
  if (trayBounds && trayBounds.width > 0) return { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y + trayBounds.height / 2 };
  const b = d.workArea;
  return { x: b.x + b.width - 60, y: b.y + b.height + 20 };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
img{position:absolute;transform-origin:0 0;will-change:transform,opacity;border-radius:8px;box-shadow:0 20px 60px rgb(0 0 0/.45)}
</style></head><body><img id="i"><script>
// load — снимок встал на место окна и нарисован; go — полёт. from/to — прямоугольники в координатах
// подложки; улетая — разгон и тает к концу, прилетая — наоборот
let from = null;
const i = document.getElementById('i');
const k = (r) => 'translate(' + (r.x - from.x) + 'px,' + (r.y - from.y) + 'px) scale(' + r.w / from.w + ',' + r.h / from.h + ')';
window.load = (src, f, hiddenAt) => new Promise((done) => {
  from = f;
  Object.assign(i.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
  if (hiddenAt) { i.style.transform = k(hiddenAt); i.style.opacity = 0; }
  i.onload = () => requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
  i.src = src;
});
window.go = (to, ms, out) => new Promise((done) => {
  const a = i.animate(out
    ? [{ transform: 'none', opacity: 1 }, { transform: k(to), opacity: .9, offset: .75 }, { transform: k(to), opacity: 0 }]
    : [{ transform: k(to), opacity: 0 }, { transform: k(to), opacity: .9, offset: .2 }, { transform: 'none', opacity: 1 }],
    { duration: ms, easing: out ? 'cubic-bezier(.55,0,.85,.35)' : 'cubic-bezier(.15,.65,.35,1)', fill: 'forwards' });
  a.onfinish = () => done(true);
});
</script></body></html>`;

// Подложка на весь экран окна: прозрачная, мимо неё клики, поверх всего
async function overlay(d) {
  const o = new BrowserWindow({
    ...d.bounds, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  o.setIgnoreMouseEvents(true);
  o.setAlwaysOnTop(true, 'screen-saver');
  await o.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  return o;
}

// картинку передаём в страницу скриптом: в адрес страницы она не влезла бы
const js = (o, fn, ...args) => o.webContents.executeJavaScript(`${fn}(${args.map((a) => JSON.stringify(a)).join(',')})`);

// Где окно и куда лететь — в координатах подложки (она на весь экран окна)
function path(b, d, trayBounds) {
  const t = trayPoint(trayBounds, d);
  const s = 24; // долетает размером со значок
  const h = s * (b.height / b.width);
  return {
    from: { x: b.x - d.bounds.x, y: b.y - d.bounds.y, w: b.width, h: b.height },
    to: { x: t.x - d.bounds.x - s / 2, y: t.y - d.bounds.y - h / 2, w: s, h },
  };
}

// Окно → значок в трее. Не вышло (нет снимка, окно свёрнуто) — просто спрятать
async function toTray(win, trayBounds) {
  if (!win || win.isDestroyed() || busy) return;
  if (!win.isVisible() || win.isMinimized()) { win.hide(); return; }
  busy = true;
  let o = null;
  try {
    const b = win.getBounds();
    const d = screen.getDisplayMatching(b);
    const img = await win.webContents.capturePage();
    shot = img.isEmpty() ? null : `data:image/jpeg;base64,${img.toJPEG(82).toString('base64')}`;
    if (!shot) { win.hide(); return; }
    o = await overlay(d);
    const { from, to } = path(b, d, trayBounds);
    await js(o, 'load', shot, from, null);
    o.showInactive();
    await new Promise((r) => setTimeout(r, 30)); // подложка показалась поверх — окно прячем под ней
    if (!win.isDestroyed()) win.hide();
    await js(o, 'go', to, OUT_MS, true);
  } catch {
    if (!win.isDestroyed()) win.hide();
  } finally {
    if (o && !o.isDestroyed()) o.destroy();
    busy = false;
  }
}

// Значок в трее → окно. show — как показать окно (restore, show, focus — main.js → showWindow)
async function fromTray(win, trayBounds, show) {
  if (!win || win.isDestroyed()) return;
  if (busy || !shot || win.isVisible()) { show(); return; }
  busy = true;
  let o = null;
  try {
    const b = win.getBounds();
    const d = screen.getDisplayMatching(b);
    o = await overlay(d);
    const { from, to } = path(b, d, trayBounds);
    await js(o, 'load', shot, from, to); // сразу маленьким у значка и прозрачным
    o.showInactive();
    await js(o, 'go', to, IN_MS, false);
    show();
    await new Promise((r) => setTimeout(r, 80)); // окно успело нарисоваться — теперь убираем снимок
  } catch {
    show();
  } finally {
    if (o && !o.isDestroyed()) o.destroy();
    busy = false;
  }
}

module.exports = { toTray, fromTray };
