// «Слушать вместе»: рума на сервере авеона (server/aveon_api/together.py) через WebSocket.
// Здесь только связь: соединение, вход в руму, сверка часов и переподключение.
// Что и когда играть, решает окно (renderer/together.js).
const config = require('./config');

const PING_EVERY = 5000;
const RETRIES = 6;

let notify = () => {};
let ws = null;
let room = null; // { code, you, members, driver }
let offset = 0; // серверное время минус наше, мс
let samples = []; // [{ rtt, offset }] последних сверок
let pingTimer = null;
let retry = 0;
let leaving = false;
let pending = null; // { resolve, reject } — ждём ответ на create/join

function wsUrl() {
  const server = config.get().account.server;
  if (!server) throw new Error('Сначала войди в аккаунт');
  return server.replace(/^http/i, 'ws') + '/api/together';
}

const serverNow = () => Date.now() + offset;

function status() {
  return room ? { ...room, connected: ws?.readyState === 1 } : null;
}

function emit(ev) { notify({ ...ev, room: status() }); }

function sendRaw(msg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}

// Смещение часов берём по сверке с самым коротким откликом — она точнее всех
function onPong(m) {
  const t = Date.now();
  const rtt = t - m.c;
  samples.push({ rtt, offset: m.s - (m.c + rtt / 2) });
  samples = samples.slice(-8);
  offset = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
}

function onMessage(m) {
  switch (m.t) {
    case 'pong': onPong(m); break;
    case 'room':
      room = { code: m.code, you: m.you, members: m.members, driver: m.driver };
      retry = 0;
      pending?.resolve(status());
      pending = null;
      // состояние румы на момент входа: сколько ему уже лет по серверным часам
      if (m.state) emit({ type: 'state', state: m.state, age: m.now - m.state.at, driver: m.driver, initial: true });
      else emit({ type: 'room' });
      break;
    case 'members':
      if (!room) break;
      room.members = m.members;
      room.driver = m.driver;
      emit({ type: 'members', joined: m.joined, left: m.left });
      break;
    case 'state':
      if (!room) break;
      room.driver = m.driver;
      emit({ type: 'state', state: m.state, age: serverNow() - m.state.at, driver: m.driver, by: m.by, beat: m.beat });
      break;
    case 'react':
      if (room) emit({ type: 'react', e: m.e, by: m.by, from: m.from, mine: m.from === room.you });
      break;
    case 'skip': // гость просит переключить — переключает тот, чья очередь (renderer/together.js)
      if (room) emit({ type: 'skip', dir: m.dir, by: m.by, from: m.from });
      break;
    case 'error':
      if (pending) { pending.reject(new Error(m.error)); pending = null; }
      else emit({ type: 'error', error: m.error });
      if (m.fatal) close(true);
      break;
    default:
  }
}

function open(first) {
  return new Promise((resolve, reject) => {
    let sock;
    try { sock = new WebSocket(wsUrl()); } catch (e) { reject(e); return; }
    ws = sock;
    const timer = setTimeout(() => { sock.close(); reject(new Error('Сервер не отвечает')); }, 10000);
    sock.onopen = () => {
      sock.send(JSON.stringify({ t: 'hello', token: config.getSecret('acc.token') }));
    };
    sock.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'hello') {
        clearTimeout(timer);
        samples = [];
        clearInterval(pingTimer);
        const ping = () => sendRaw({ t: 'ping', c: Date.now() });
        ping();
        setTimeout(ping, 300);
        pingTimer = setInterval(ping, PING_EVERY);
        pending = { resolve, reject };
        sendRaw(first);
        return;
      }
      onMessage(m);
    };
    sock.onerror = () => {};
    sock.onclose = () => {
      clearTimeout(timer);
      clearInterval(pingTimer);
      if (ws !== sock) return;
      ws = null;
      if (pending) { pending.reject(new Error('Нет связи с сервером')); pending = null; }
      if (room && !leaving) reconnect();
    };
  });
}

// Связь пропала — пробуем вернуться в ту же руму, пока она жива
function reconnect() {
  if (++retry > RETRIES) {
    room = null;
    emit({ type: 'closed', error: 'Связь с румой потеряна' });
    return;
  }
  emit({ type: 'reconnecting' });
  setTimeout(() => {
    if (!room || leaving) return;
    open({ t: 'join', code: room.code }).catch((e) => {
      if (/не найдена/.test(e.message)) {
        room = null;
        emit({ type: 'closed', error: 'Рума закрылась' });
      } else if (!ws) reconnect();
    });
  }, Math.min(1000 * retry, 5000));
}

function close(silent) {
  leaving = true;
  clearInterval(pingTimer);
  sendRaw({ t: 'leave' });
  try { ws?.close(); } catch {}
  ws = null;
  const was = room;
  room = null;
  leaving = false;
  if (was && !silent) emit({ type: 'closed' });
}

async function enter(first) {
  close(true);
  retry = 0;
  return open(first);
}

const create = () => enter({ t: 'create' });

function join(code) {
  code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) return Promise.reject(new Error('Код румы — 6 символов'));
  return enter({ t: 'join', code });
}

function leave() {
  close(false);
  return null;
}

function send(state, beat = false) {
  if (!room) return;
  sendRaw({ t: 'state', state, beat });
  room.driver = room.you;
}

// Реакция всем в руме: одна из 8 эмодзи сервера (together.py, REACTS), не чаще раза в 300 мс
function react(e) {
  if (room) sendRaw({ t: 'react', e });
}

// «Следующий» / «предыдущий» у гостя: очередь у того, кто включил трек, — просим его (together.py, skip)
function skip(dir) {
  if (room && (dir === 'next' || dir === 'prev')) sendRaw({ t: 'skip', dir });
}

function init(onEvent) { notify = onEvent; }

module.exports = { init, create, join, leave, send, react, skip, status };
