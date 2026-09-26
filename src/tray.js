// Значок в трее: пауза, треки, бочка, мини-плеер, остров, показать плеер и выход.
// «Закрывать в трей» — крестик прячет окно, музыка играет дальше.
const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const config = require('./config');

let tray = null;
let handlers = {};
let last = null;
let sig = '';

const cfg = () => ({ enabled: true, closeToTray: false, ...(config.get().tray || {}) });

function icon() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'tray.png'));
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
}

function menu() {
  const s = last || {};
  const t = s.hasTrack ? `${s.title}${s.artist ? ` — ${s.artist}` : ''}` : 'Ничего не играет';
  return Menu.buildFromTemplate([
    { label: t.length > 60 ? `${t.slice(0, 57)}…` : t, enabled: false },
    { type: 'separator' },
    { label: s.playing ? 'Пауза' : 'Играть', enabled: !!s.hasTrack, click: () => handlers.thumb('toggle') },
    { label: 'Следующий', enabled: !!s.hasTrack, click: () => handlers.thumb('next') },
    { label: 'Предыдущий', enabled: !!s.hasTrack, click: () => handlers.thumb('prev') },
    { type: 'separator' },
    { label: 'В бочку', type: 'checkbox', checked: !!s.manual, click: () => handlers.barrel() },
    { label: 'Мини-плеер', type: 'checkbox', checked: handlers.miniOpen(), click: () => handlers.mini() },
    { label: 'Остров', type: 'checkbox', checked: handlers.islandOn(), click: () => handlers.island() },
    { type: 'separator' },
    { label: 'Показать плеер', click: () => handlers.show() },
    { label: 'Выйти', click: () => handlers.quit() },
  ]);
}

function refresh(force) {
  if (!tray) return;
  const s = last || {};
  const next = [s.hasTrack, s.title, s.artist, s.playing, s.manual, handlers.miniOpen(), handlers.islandOn()].join('|');
  if (!force && next === sig) return;
  sig = next;
  tray.setToolTip(s.hasTrack ? `авеон · ${s.title}` : 'авеон');
  tray.setContextMenu(menu());
}

function apply() {
  if (cfg().enabled && !tray) {
    tray = new Tray(icon());
    tray.on('click', () => handlers.toggleWindow());
    refresh(true);
  } else if (!cfg().enabled && tray) {
    tray.destroy();
    tray = null;
  }
}

function init(h) {
  handlers = h;
  apply();
}

function state(s) {
  last = s;
  refresh(false);
}

const closeToTray = () => !!(tray && cfg().closeToTray);

function destroy() {
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = { init, state, refresh, settingsChanged: () => { apply(); refresh(true); }, closeToTray, destroy };
