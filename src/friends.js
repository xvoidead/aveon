// Друзья авеона: заявки по логину и «что слушает друг» (server/aveon_api/friends.py).
// Окно сообщает, что играет, — отсюда это уходит на сервер и раз в минуту повторяется,
// чтобы друзья видели, что плеер ещё открыт. Список друзей окно запрашивает само.
const config = require('./config');
const account = require('./account');

const BEAT_EVERY = 60 * 1000;

let last = null; // { track, playing, pos, t } — что играет у нас, t — когда pos была такой
let sentKey = ''; // что уже на сервере: не повторяем одно и то же
let beatTimer = null;
let unsupported = false; // старый сервер без друзей — не спамим его

const loggedIn = () => !!config.getSecret('acc.token') && !!config.get().account.server;
const sharing = () => config.get().friends?.share !== false;

function oldServer(e) {
  // старый сервер без друзей отвечает 404 без текста ошибки
  return e.status === 404 && !e.body?.error;
}

async function call(method, route, body) {
  try {
    return await account.api(method, route, body);
  } catch (e) {
    if (oldServer(e)) throw new Error('Сервер аккаунтов ещё не умеет друзей — обнови его');
    throw e;
  }
}

const list = () => call('GET', '/api/friends');
const add = (login) => call('POST', '/api/friends', { login });
const accept = (id) => call('POST', `/api/friends/${encodeURIComponent(id)}/accept`);
const remove = (id) => call('DELETE', `/api/friends/${encodeURIComponent(id)}`);
const invite = (id, code) => call('POST', `/api/friends/${encodeURIComponent(id)}/invite`, { code });
const dismiss = (id) => call('DELETE', `/api/friends/${encodeURIComponent(id)}/invite`);
const messages = (id, before) => call('GET', `/api/messages/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ''}`);
const send = (id, body) => call('POST', `/api/messages/${encodeURIComponent(id)}`, body);
const profile = (id) => call('GET', `/api/friends/${encodeURIComponent(id)}/profile`);
const knock = (id) => call('POST', `/api/friends/${encodeURIComponent(id)}/knock`);
const unknock = (id) => call('DELETE', `/api/friends/${encodeURIComponent(id)}/knock`);

async function push(force = false) {
  if (!loggedIn() || unsupported) return;
  const body = sharing() && last?.track
    ? { track: last.track, playing: last.playing, pos: +(last.pos + (last.playing ? (Date.now() - last.t) / 1000 : 0)).toFixed(1) }
    : { track: null };
  const key = body.track ? `${body.track.id}|${body.playing}|${Math.round(body.pos)}` : '';
  if (!force && key === sentKey) return;
  try {
    await account.api('PUT', '/api/now', body);
    sentKey = key;
  } catch (e) {
    if (oldServer(e)) unsupported = true;
  }
}

// Окно: что играет сейчас (null — ничего)
function now(p) {
  last = p?.track ? { track: p.track, playing: !!p.playing, pos: Math.max(0, +p.pos || 0), t: Date.now() } : null;
  push();
}

// Включили или выключили «показывать друзьям» — сразу сообщаем серверу
function settingsChanged() { push(true); }

function init() {
  clearInterval(beatTimer);
  // трек есть (даже на паузе) — напоминаем, что плеер открыт
  beatTimer = setInterval(() => { if (last && sharing()) push(true); }, BEAT_EVERY);
}

// Вход в другой аккаунт или выход: на новом сервере ничего ещё нет
function reset() {
  sentKey = '';
  unsupported = false;
}

// Выход из аккаунта: друзья больше не видят трек
async function offline() {
  if (!loggedIn() || unsupported || !sentKey) return;
  await account.api('PUT', '/api/now', { track: null }).catch(() => {});
  sentKey = '';
}

module.exports = { init, list, add, accept, remove, invite, dismiss, knock, unknock, messages, send, profile, now, settingsChanged, reset, offline };
