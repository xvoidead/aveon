// Редактор места острова: прозрачное окно во весь экран острова с сеткой. Двигают настоящий остров:
// он стоит поверх редактора и не ловит мышь, а редактор по перетаскиванию (с Shift — по сетке)
// присылает новое место — остров сразу туда переезжает и раскрывается от своего угла (src/island.js).
// Нарисован в renderer/islandedit.html; «Выйти» присылает, где встала капсула, — отсюда в настройки.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const island = require('./island');

let win = null;
let display = null;
let onSave = () => {};

const fromEditor = (e) => win && !win.isDestroyed() && e.sender === win.webContents;

function open(save) {
  onSave = save;
  if (win && !win.isDestroyed()) { win.focus(); return; }
  const info = island.editInfo();
  display = info.display;
  const b = display.bounds;
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, title: 'место острова',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver'); // поверх всего, как сам остров
  win.setBounds(b); // на экране с другим масштабом размер в конструкторе может встать неточно
  const w = win;
  const to = (ch) => (v) => { if (!w.isDestroyed()) w.webContents.send(ch, v); };
  island.setEditing(true, { display, onRect: to('isledit:rect'), onAccent: to('isledit:accent') });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'islandedit.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('isledit:init', {
      width: b.width, height: b.height, pill: info.pill, x: info.px, y: info.py, home: info.home, accent: info.accent,
    });
    win.show();
    win.focus();
    island.editMove(info.px, info.py); // остров — поверх редактора, редактор узнает, где капсула
  });
  win.on('focus', () => island.editRaise());
  win.on('closed', () => { win = null; island.setEditing(false); });
}

ipcMain.on('isledit:move', (e, p) => {
  if (fromEditor(e) && Number.isFinite(p?.x) && Number.isFinite(p?.y)) island.editMove(p.x, p.y);
});
ipcMain.on('isledit:open', (e, on) => { if (fromEditor(e)) island.editOpen(on); });
ipcMain.on('isledit:raise', (e) => { if (fromEditor(e)) island.editRaise(); });

// p — где встала капсула на экране ({x, y}, левый верхний угол) или null — выйти без изменений
ipcMain.on('isledit:finish', (e, p) => {
  if (!fromEditor(e)) return;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) onSave(island.placement(p.x, p.y, display));
  win.close();
});

module.exports = { open };
