// Discord Rich Presence: «Слушает авеон» с треком, исполнителем, альбомом, обложкой и полосой
// прогресса — как у Spotify. Без библиотек: локальный канал Discord (\\?\pipe\discord-ipc-N),
// кадр = op (int32 LE) + длина (int32 LE) + JSON.
const net = require('net');
const config = require('./config');
const local = require('./services/local');

// Приложение «авеон» на discord.com/developers/applications — его название Discord пишет в «Слушает …»,
// а картинки logo / ym / sc / sp / local загружены в нём в Rich Presence → Art Assets (docs/discord)
const CLIENT_ID = '1553163501642580100';

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const RETRY = 15000;
const MIN_GAP = 4200; // Discord пропускает не больше 5 обновлений за 20 секунд

// «Где слушаю»: подпись к значку сервиса и кнопка. Ключи картинок — ассеты приложения в Discord
// (Rich Presence → Art Assets), PNG лежат в docs/discord/
const SOURCES = {
  ym: { name: 'Яндекс Музыка', open: 'Открыть в Яндекс Музыке', icon: 'ym' },
  sc: { name: 'SoundCloud', open: 'Открыть в SoundCloud', icon: 'sc' },
  sp: { name: 'Spotify', open: 'Открыть в Spotify', icon: 'sp' },
  local: { name: 'Свой файл', open: '', icon: 'local' },
};

let sock = null;
let ready = false;
let connecting = false;
let retryTimer = null;
let buf = Buffer.alloc(0);
let want = null;       // последнее, что окно просило показать (null — ничего)
let sentAt = 0;
let sendTimer = null;
let lastSent = '';
const coverCache = new Map(); // «артист — название» → https-обложка из iTunes для своих файлов

const enabled = () => config.get().discord?.enabled !== false;

function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function write(op, data) {
  try { sock?.write(frame(op, data)); } catch {}
}

function onData(chunk) {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 8) {
    const op = buf.readInt32LE(0);
    const len = buf.readInt32LE(4);
    if (buf.length < 8 + len) return;
    let msg = null;
    try { msg = JSON.parse(buf.subarray(8, 8 + len).toString()); } catch {}
    buf = buf.subarray(8 + len);
    if (op === OP.PING) write(OP.PONG, msg);
    else if (op === OP.CLOSE) { drop(); return; } // чаще всего — неверный ID приложения
    else if (op === OP.FRAME && msg?.evt === 'READY') {
      ready = true;
      lastSent = 'null'; // после подключения статуса ещё нет — пустой не шлём
      flush();
    }
  }
}

function drop() {
  ready = false;
  connecting = false;
  try { sock?.destroy(); } catch {}
  sock = null;
  buf = Buffer.alloc(0);
  scheduleRetry();
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (enabled()) retryTimer = setTimeout(connect, RETRY);
}

// Discord может сидеть на любом из каналов discord-ipc-0…9
function tryPipe(i) {
  if (i > 9) { connecting = false; scheduleRetry(); return; }
  // AVEON_DISCORD_PIPE — свой канал вместо Discord (для тестов)
  const s = net.createConnection(process.env.AVEON_DISCORD_PIPE || `\\\\?\\pipe\\discord-ipc-${i}`);
  s.once('error', () => { s.destroy(); tryPipe(i + 1); });
  s.once('connect', () => {
    s.removeAllListeners('error');
    sock = s;
    connecting = false;
    s.on('data', onData);
    s.on('error', drop);
    s.on('close', () => { if (sock === s) drop(); });
    write(OP.HANDSHAKE, { v: 1, client_id: CLIENT_ID });
  });
}

function connect() {
  clearTimeout(retryTimer);
  if (sock || connecting || !enabled()) return;
  connecting = true;
  tryPipe(0);
}

// ---- что показываем ----

const clip = (s, max = 128) => {
  s = String(s || '').trim();
  if (s.length < 2) s = (s + '  ').slice(0, 2); // Discord требует минимум 2 символа
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};
const https = (u) => (/^https:\/\//i.test(u || '') ? u : '');

// Обложка своего файла: Discord берёт картинки только по https — ищем тот же трек в iTunes
async function coverFor(t) {
  if (https(t.cover)) return t.cover;
  if (t.source !== 'local' || !t.title) return '';
  const key = `${t.artist} — ${t.title}`.toLowerCase();
  if (coverCache.has(key)) return coverCache.get(key);
  let url = '';
  try {
    const found = await local.lookup(`${t.artist || ''} ${t.title}`.trim());
    url = https(found[0]?.cover);
  } catch {}
  coverCache.set(key, url);
  return url;
}

async function activity(p) {
  const t = p.track;
  const src = SOURCES[t.source] || SOURCES.local;
  const now = Date.now();
  const cover = await coverFor(t);
  const link = https(t.link);
  const a = {
    type: 2, // «Слушает» — с полосой прогресса, как у Spotify
    status_display_type: 2, // в списке участников — название трека, а не «авеон»
    details: clip(t.title),
    state: clip(t.artist || 'исполнитель неизвестен'),
    assets: {
      large_image: cover || 'logo',
      large_text: clip(t.album || t.title),
      small_image: src.icon,
      small_text: clip(p.via?.label || (p.via ? `${SOURCES[t.source]?.name || ''} через ${SOURCES[p.via.source]?.name}` : src.name)),
    },
    instance: false,
  };
  if (link) a.details_url = link;
  if (p.duration > 0) {
    const start = now - Math.max(0, p.pos) * 1000;
    a.timestamps = { start: Math.round(start), end: Math.round(start + p.duration * 1000) };
  }
  if (link && src.open) a.buttons = [{ label: src.open, url: link }];
  if (p.party) a.party = { id: p.party.id, size: [p.party.size, 10] }; // «слушать вместе»: (2 из 10)
  return a;
}

async function flush() {
  clearTimeout(sendTimer);
  if (!ready) return;
  const wait = sentAt + MIN_GAP - Date.now();
  if (wait > 0) { sendTimer = setTimeout(flush, wait); return; }
  const p = want;
  const act = p ? await activity(p) : null;
  if (p !== want) { flush(); return; } // пока искали обложку, трек сменился
  // одинаковое не шлём, но позицию сверяем с запасом в 2 с: перемотка сдвигает полосу
  const sig = JSON.stringify(act, (k, v) => (k === 'timestamps' ? { s: Math.round(v.start / 2000) } : v));
  if (sig === lastSent) return;
  lastSent = sig;
  sentAt = Date.now();
  write(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: act }, nonce: `${sentAt}` });
}

// p: { track, playing, pos, duration, via, party } или null. На паузе — пусто, как у Spotify
function update(p) {
  want = p && p.playing && p.track ? p : null;
  if (!enabled()) return;
  if (!sock && !connecting) connect();
  flush();
}

function settingsChanged() {
  lastSent = '';
  if (!enabled()) {
    if (ready) write(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: `${Date.now()}` });
    clearTimeout(retryTimer);
    try { sock?.destroy(); } catch {}
    sock = null;
    ready = false;
    return;
  }
  connect();
}

function status() {
  return { enabled: enabled(), connected: ready };
}

function init() { if (enabled()) connect(); }

function stop() {
  clearTimeout(retryTimer);
  clearTimeout(sendTimer);
  try { sock?.destroy(); } catch {}
}

module.exports = { init, update, settingsChanged, status, stop };
