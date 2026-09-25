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
  crossfade: 6, // с — плавный переход между треками, 0 — выключен
  ui: { keepTitles: false }, // true — названия треков без строчного стиля
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
