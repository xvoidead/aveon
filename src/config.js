// Настройки в userData/config.json. Токены шифруются через safeStorage (DPAPI Windows).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const SECRET_KEYS = ['sc.token', 'ym.token', 'sp.refresh', 'sp.access', 'acc.token'];

const DEFAULTS = {
  volume: 0.8,
  shuffle: false,
  repeat: 'off', // off | all | one
  view: 'local',
  discord: { enabled: true }, // статус «Слушает» в Discord
  friends: { share: true }, // друзья авеона видят, что я слушаю
  crossfade: 6, // с — плавный переход между треками, 0 — выключен
  ui: {
    keepTitles: false, // true — названия треков без строчного стиля
    autoHideWin: true, // кнопки окна появляются, только когда к ним подводишь курсор
  },
  localFolders: [],
  sc: { clientId: '', profile: '' },
  ym: {},
  sp: { clientId: '', expires: 0 },
  // Аккаунт авеона: адрес сервера и кто вошёл. Токен лежит в секретах (acc.token)
  account: {
    server: '',
    login: '',
    name: '',
    device: '', // id этого компьютера, создаётся при первом запуске
    lastSync: 0,
    settingsAt: 0, // когда здесь последний раз меняли синхронизируемые настройки
    avatar: '', // копия своего аватара с сервера (data:image/…), чтобы он был виден и без сети
    avatarAt: 0, // когда аватар меняли на сервере — по этому понимаем, что копия устарела
  },
  duck: {
    enabled: true,
    mode: 'voice', // voice — когда кто-то говорит; call — весь звонок
    effect: 'barrel', // barrel — звук «из бочки»; volume — просто тише
    barrelCutoff: 600, // Гц, до какой частоты срезать верха в бочке
    barrelBoom: 0.55, // гулкость: резонанс и короткие переотражения
    barrelLevel: 0.8, // громкость в бочке
    level: 0.25, // режим volume: до какой доли громкости приглушать
    threshold: 0.03, // пиковый уровень голоса, выше которого считаем «говорят»
    attack: 120, // мс — как быстро уходить вниз
    release: 900, // мс — как быстро возвращаться
    hold: 700, // мс — сколько держать после последнего звука
    includeMic: true, // реагировать и на твой голос (свой детектор речи с шумоподавлением)
    micDevice: '', // deviceId микрофона, пусто — по умолчанию в Windows
    micSensitivity: 0.5, // 0…1, чувствительность детектора речи
    targets: [], // по желанию: внешние процессы (chrome, spotify…), которые тоже приглушать
  },
  censor: {
    enabled: false,
    profanity: true, // мат
    drugs: true, // упоминания наркотиков
    scope: 'word', // word — только слово; line — вся строка
    effect: 'warble', // barrel — только бочка; warble — плывёт; robot — робот; bleep — пик; mute — тишина
    custom: [], // свои слова: всё, что начинается с них
  },
  eq: {
    enabled: true,
    preset: 'flat', // см. EQ_PRESETS в renderer/eq.js; custom — полосы двигали вручную
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // дБ для 32 Гц … 16 кГц
    preamp: 0, // дБ
    custom: [], // свои пресеты: { id: 'u:…', name, gains, preamp }
  },
  // Остров поверх всех окон: pos — top | left | right | bottom; onlyAway — только когда плеер не в фокусе
  island: { enabled: true, pos: 'top', onlyAway: true, hideInGames: false, lyrics: true, friends: true, notify: true, pulse: true, rainbow: false, motion: 'music', bars: true, spin: true, x: 0, y: 0 },
  mini: { open: false, onMinimize: false, top: true, opacity: 100, lyrics: true, x: null, y: null }, // мини-плеер (src/mini.js)
  tray: { enabled: true, closeToTray: false }, // значок в трее (src/tray.js)
  hotkeys: {}, // горячие клавиши на всю систему; по умолчанию — src/hotkeys.js
  livewall: { enabled: false, style: 'both', title: true, dim: 45 }, // живые обои (src/livewall.js)
  wave: { mood: 'all', diversity: 'default', language: 'any', dj: false, djEvery: 2, djRate: 1, djVoice: '' }, // волна (renderer/wave.js)
  look: {}, // оформление: тема, цвета, шрифты… (значения по умолчанию — renderer/look.js)
  cache: { keep: true, limitMb: 2048 }, // треки сохраняются сами, пока их слушаешь (src/cache.js)
  mxm: { token: '' }, // токен Musixmatch: выдаётся редко, поэтому храним
};

let file;
let data;
let secrets = {};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? merge(base[k], v)
      : v;
  }
  return out;
}

function load() {
  file = path.join(app.getPath('userData'), 'config.json');
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (raw.secrets && safeStorage.isEncryptionAvailable()) {
    try { secrets = JSON.parse(safeStorage.decryptString(Buffer.from(raw.secrets, 'base64'))); } catch { secrets = {}; }
  }
  delete raw.secrets;
  data = merge(DEFAULTS, raw);
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

function flush() {
  clearTimeout(saveTimer);
  const out = { ...data };
  if (safeStorage.isEncryptionAvailable()) {
    out.secrets = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
}

function get() { return data; }

function set(patch) {
  data = merge(data, patch);
  save();
  return data;
}

function getSecret(key) { return secrets[key] || ''; }

function setSecret(key, value) {
  if (!SECRET_KEYS.includes(key)) throw new Error('unknown secret ' + key);
  if (value) secrets[key] = value; else delete secrets[key];
  save();
}

// То, что можно отдать в окно: без самих токенов, только флаги «задан/не задан»
function publicView() {
  return {
    ...data,
    has: Object.fromEntries(SECRET_KEYS.map((k) => [k, !!secrets[k]])),
  };
}

module.exports = { load, get, set, flush, getSecret, setSecret, publicView };
