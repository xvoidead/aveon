// Эквалайзер в отдельном окне: раскрывается вниз от своей кнопки и может выходить за край окна
// плеера. Окно прозрачное — по краям поля под тень, сама панель нарисована в renderer/eqpop.html.
// Звук живёт в окне плеера: попап присылает туда изменения, а сохраняет настройки сам (cfg:set).
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const PANEL = { width: 620, height: 470 };
const MARGIN = 28; // прозрачные поля вокруг панели: тень и небольшой «отлёт» анимации
const SIZE = { width: PANEL.width + MARGIN * 2, height: PANEL.height + MARGIN * 2 };

let pop = null;
let ready = null;
let closedAt = 0;
let notify = () => {};

function ensure(main) {
  if (pop && !pop.isDestroyed()) return;
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
  pop.on('blur', () => hide()); // клик мимо — закрыть
  pop.on('closed', () => { pop = null; });
  if (!main.eqpopHooked) {
    main.eqpopHooked = true;
    for (const ev of ['move', 'resize', 'minimize', 'hide', 'enter-full-screen', 'leave-full-screen']) main.on(ev, () => hide());
  }
}

// rect — кнопка эквалайзера в CSS-пикселях окна плеера. Панель встаёт справа от кнопки, верхним
// краем на её уровне, и раскрывается вниз — за нижний край окна плеера. Граница ей только край
// экрана: если внизу не хватает места, панель поднимается ровно настолько, насколько нужно
async function open(main, rect, payload) {
  ensure(main);
  await ready;
  const cb = main.getContentBounds();
  const area = screen.getDisplayMatching(cb).workArea;
  let x = Math.round(cb.x + rect.right + 10);
  let y = Math.round(cb.y + rect.top - 18);
  if (x + PANEL.width > area.x + area.width - 8) x = Math.round(cb.x + rect.left - 10 - PANEL.width); // справа нет места — слева
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - PANEL.width - 8));
  const lift = Math.max(0, y + PANEL.height - (area.y + area.height - 8));
  y = Math.max(area.y + 8, y - lift);
  const up = lift > PANEL.height / 2; // подняли больше чем наполовину — выезжает снизу вверх
  pop.setBounds({ x: x - MARGIN, y: y - MARGIN, ...SIZE });
  pop.webContents.send('eqpop:open', { ...payload, up });
  pop.show();
  pop.focus();
  notify(true);
}

function hide() {
  if (!pop || pop.isDestroyed() || !pop.isVisible()) return;
  closedAt = Date.now();
  pop.hide();
  notify(false);
}

// Клик по кнопке эквалайзера сначала уводит фокус из попапа (он закрывается по blur),
// а потом приходит сюда — без этой паузы попап тут же открылся бы снова
function toggle(main, rect, payload) {
  if (pop && !pop.isDestroyed() && pop.isVisible()) { hide(); return; }
  if (Date.now() - closedAt < 300) return;
  open(main, rect, payload).catch((e) => console.warn('eqpop:', e.message));
}

// Настройки эквалайзера поменялись снаружи — открытый попап перечитывает их
function refresh() {
  if (pop && !pop.isDestroyed() && pop.isVisible()) pop.webContents.send('eqpop:refresh');
}

function init(cb) { notify = cb; }

function destroy() {
  if (pop && !pop.isDestroyed()) pop.destroy();
}

module.exports = { toggle, hide, refresh, init, destroy };
