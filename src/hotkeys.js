// Горячие клавиши на всю систему: работают, даже когда плеер свёрнут или открыта игра.
// Сочетания задаются в настройках; если сочетание занято другой программой — пишем об этом.
const { globalShortcut } = require('electron');
const config = require('./config');

const DEFAULTS = {
  enabled: true,
  play: 'CommandOrControl+Alt+Space',
  next: 'CommandOrControl+Alt+Right',
  prev: 'CommandOrControl+Alt+Left',
  barrel: 'CommandOrControl+Alt+B',
  show: 'CommandOrControl+Alt+A',
  mini: 'CommandOrControl+Alt+M',
  island: 'CommandOrControl+Alt+I',
  volUp: 'CommandOrControl+Alt+Up',
  volDown: 'CommandOrControl+Alt+Down',
  seekFwd: 'CommandOrControl+Alt+Shift+Right',
  seekBack: 'CommandOrControl+Alt+Shift+Left',
  mute: 'CommandOrControl+Alt+0',
  shuffle: 'CommandOrControl+Alt+S',
  repeat: 'CommandOrControl+Alt+R',
  wave: 'CommandOrControl+Alt+W',
  like: 'CommandOrControl+Alt+L',
  karaoke: 'CommandOrControl+Alt+K',
  sleep: 'CommandOrControl+Alt+Z',
};
const ACTIONS = Object.keys(DEFAULTS).filter((k) => k !== 'enabled');

let handlers = {};
let failed = [];

const cfg = () => ({ ...DEFAULTS, ...(config.get().hotkeys || {}) });

function apply() {
  globalShortcut.unregisterAll();
  failed = [];
  const c = cfg();
  if (!c.enabled) return;
  for (const a of ACTIONS) {
    const acc = c[a];
    if (!acc) continue;
    try {
      if (!globalShortcut.register(acc, () => handlers[a]?.())) failed.push(a);
    } catch {
      failed.push(a);
    }
  }
}

function init(h) {
  handlers = h;
  apply();
}

function status() {
  return { ...cfg(), failed };
}

module.exports = { init, settingsChanged: apply, status, DEFAULTS, destroy: () => globalShortcut.unregisterAll() };
