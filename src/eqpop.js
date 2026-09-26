// Эквалайзер в отдельном окне поверх плеера, а под ним — нативное стекло (@hicccc77/electron-liquid-glass).
// Модуль снимает рабочий стол через DXGI Desktop Duplication и преломляет его на видеокарте, поэтому
// под попапом виден настоящий интерфейс плеера. Работает только на Windows 10 2004+; если модуль
// недоступен, окно плеера показывает свой встроенный эквалайзер (renderer/eq.js).
const { BrowserWindow, screen } = require('electron');
const path = require('path');

let glass = null;
try { glass = require('@hicccc77/electron-liquid-glass'); } catch { glass = null; }

const SIZE = { width: 680, height: 470 };
const RADIUS = 16; // как у .eq-sheet

let pop = null;
let panel = null;
let owner = null;
let policy = 'all';
let ready = null;
let closedAt = 0;
let onClosed = () => {};

function supported() {
  try { return !!glass?.isSupported(); } catch { return false; }
}

function ensure(main) {
  if (pop && !pop.isDestroyed()) return;
  owner = main;
  pop = new BrowserWindow({
    ...SIZE,
    parent: main, // всегда над плеером и сворачивается вместе с ним
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
    hasShadow: false,
    title: 'эквалайзер',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  pop.loadFile(path.join(__dirname, '..', 'renderer', 'eqpop.html'));
  ready = new Promise((r) => pop.webContents.once('did-finish-load', r));
  // Сам попап стекло не должно захватывать — иначе оно преломляло бы собственный текст.
  // dda-only: исключаем только из захвата стекла, для скриншотов и записи экрана попап виден
  policy = glass.setWindowCapturePolicy(pop, 'dda-only') ? 'dda-only' : 'all';
  pop.on('blur', () => hide()); // клик мимо — закрыть, как у встроенного попапа
  pop.on('closed', () => { panel?.destroy(); panel = null; pop = null; });
  if (!main.eqpopHooked) {
    main.eqpopHooked = true;
    for (const ev of ['move', 'resize', 'minimize', 'hide', 'enter-full-screen', 'leave-full-screen']) main.on(ev, () => hide());
  }
}

// rect — кнопка эквалайзера в CSS-пикселях окна плеера; попап встаёт над ней (или под, если не влезает)
async function open(main, rect, payload) {
  ensure(main);
  await ready;
  const cb = main.getContentBounds();
  const area = screen.getDisplayMatching(cb).workArea;
  const { width: w, height: h } = SIZE;
  let x = Math.round(cb.x + rect.left - 24);
  let y = Math.round(cb.y + rect.top - h - 12);
  if (y < area.y + 8) y = Math.round(cb.y + rect.bottom + 12);
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - w - 8));
  y = Math.max(area.y + 8, Math.min(y, area.y + area.height - h - 8));
  const bounds = { x, y, width: w, height: h };
  pop.setBounds(bounds);
  pop.webContents.send('eqpop:open', payload);

  const phys = screen.dipToScreenRect(pop, bounds);
  const dpr = screen.getDisplayMatching(bounds).scaleFactor;
  const params = {
    cornerRadius: RADIUS * dpr,
    blurSigma: 2 * dpr,
    displacementScale: 70,
    aberrationIntensity: 2,
    saturation: 1.35,
  };
  if (!panel) {
    panel = glass.createPanel({ ...phys, ...params, dpr, capturePolicy: policy, anchorWindow: pop });
  } else {
    panel.setBounds(phys);
    panel.setParams(params);
    panel.anchor(pop);
  }
  pop.show();
  pop.focus();
  panel?.show(120);
}

function hide() {
  if (!pop || pop.isDestroyed() || !pop.isVisible()) return;
  closedAt = Date.now();
  panel?.hide(80);
  pop.hide();
  onClosed();
}

// Клик по кнопке эквалайзера сначала уводит фокус из попапа (он закрывается по blur),
// а потом приходит сюда — без этой паузы попап тут же открылся бы снова
function toggle(main, rect, payload) {
  if (pop && !pop.isDestroyed() && pop.isVisible()) { hide(); return; }
  if (Date.now() - closedAt < 300) return;
  open(main, rect, payload).catch((e) => console.warn('eqpop:', e.message));
}

function init(cb) { onClosed = cb; }

function destroy() {
  panel?.destroy();
  panel = null;
  if (pop && !pop.isDestroyed()) pop.destroy();
  try { glass?.shutdown(); } catch {}
}

module.exports = { supported, toggle, hide, init, destroy };
