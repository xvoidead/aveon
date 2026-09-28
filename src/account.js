// Аккаунт авеона: вход на свой сервер (папка server/) и синхронизация между компьютерами.
// Синхронизируются альбомы, вид, эквалайзер со своими пресетами, настройки бочки и статистика. Токены музыкальных сервисов,
// папки с музыкой и место остановки остаются только на этом компьютере.
const crypto = require('crypto');
const os = require('os');

const config = require('./config');
const albums = require('./albums');
const store = require('./store');

// Адрес сервера аккаунтов, вшитый в плеер, например 'http://1.2.3.4:25565' или 'https://aveon.example.ru'.
// Пока пусто, на экране входа есть поле «Сервер». Можно переопределить переменной AVEON_SERVER.
const DEFAULT_SERVER = process.env.AVEON_SERVER || '';

const AUTO_EVERY = 5 * 60 * 1000;
const AFTER_CHANGE = 4000;

let notify = () => {};
let running = null;
let changeTimer = null;
let autoTimer = null;
let lastStatsPushed = '';
let lastError = '';

class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const acc = () => config.get().account;

function normServer(url) {
  url = String(url || DEFAULT_SERVER).trim().replace(/\/+$/, '');
  if (!url) throw new Error('Укажи адрес сервера');
  // Голый IP или адрес с портом (так выдаёт панель хостинга) — почти всегда без https
  if (!/^https?:\/\//i.test(url)) url = (/^[\d.]+(:\d+)?$|:\d+$/.test(url) ? 'http://' : 'https://') + url;
  try { new URL(url); } catch { throw new Error('Не похоже на адрес сервера'); }
  return url;
}

async function api(method, route, body, { server = acc().server, token = config.getSecret('acc.token') } = {}) {
  let res;
  try {
    res = await fetch(server + route, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new ApiError(0, e.name === 'TimeoutError' ? 'Сервер не отвечает' : 'Нет связи с сервером');
  }
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401 && token) dropSession();
    throw new ApiError(res.status, json?.error || `Ошибка сервера (${res.status})`, json);
  }
  return json;
}

function ensureDevice() {
  if (!acc().device) config.set({ account: { device: crypto.randomUUID() } });
}

function status() {
  const a = acc();
  return {
    server: a.server,
    defaultServer: DEFAULT_SERVER,
    loggedIn: !!config.getSecret('acc.token'),
    login: a.login,
    name: a.name,
    avatar: a.avatar || '',
    admin: !!a.admin, // логин в AVEON_ADMINS на сервере — видна админка
    lastSync: a.lastSync,
    syncing: !!running,
    error: lastError,
    keys: keysState, // синхронизация ключей сервисов: ok | nokey (войти заново) | badkey (пароль сменили на другом устройстве)
  };
}

// Сервер сказал «не знаю такой токен» — выходим локально, данные на компьютере остаются
function dropSession() {
  config.setSecret('acc.token', '');
  config.set({ account: { login: '', name: '' } });
  notify({ status: status(), error: 'Сессия истекла, войди в аккаунт заново' });
}

async function enter(route, server, fields) {
  server = normServer(server);
  ensureDevice();
  const r = await api('POST', route, { ...fields, device: os.hostname().slice(0, 64) }, { server, token: '' });
  config.setSecret('acc.token', r.token);
  config.setSecret('acc.key', deriveKey(fields.password, r.user.login).toString('base64'));
  // keysSig пустой — при первой синхронизации ключи с сервера и здесь сливаются, а не затирают друг друга
  config.set({ account: { server, login: r.user.login, name: r.user.name, avatar: '', avatarAt: 0, admin: !!r.user.admin, keysSig: '', keysAt: 0 } });
  lastStatsPushed = '';
  start();
  const changed = await sync().catch(() => null);
  return { status: status(), changed };
}

const register = (server, login, password, name) => enter('/api/auth/register', server, { login, password, name });
const login = (server, login, password) => enter('/api/auth/login', server, { login, password });

async function logout() {
  if (config.getSecret('acc.token')) await api('POST', '/api/auth/logout').catch(() => {});
  config.setSecret('acc.token', '');
  config.setSecret('acc.key', '');
  config.set({ account: { login: '', name: '' } });
  stop();
  return status();
}

async function me() {
  return api('GET', '/api/me');
}

async function rename(name) {
  const r = await api('PATCH', '/api/me', { name });
  config.set({ account: { name: r.user.name } });
  return status();
}

async function changePassword(old, next) {
  await api('POST', '/api/me/password', { old, new: next });
  // ключи сервисов на сервере перешифровываем новым паролем (остальные устройства всё равно войдут заново)
  config.setSecret('acc.key', deriveKey(next, acc().login).toString('base64'));
  config.set({ account: { keysAt: Date.now() } });
  schedule();
}

async function logoutAll() {
  return api('POST', '/api/auth/logout-all');
}

async function remove(password) {
  await api('POST', '/api/me/delete', { password });
  config.setSecret('acc.token', '');
  config.setSecret('acc.key', '');
  config.set({ account: { login: '', name: '' } });
  stop();
  return status();
}

// ---- поделиться: снимок альбома или пресета по короткому коду ----

async function sharePut(kind, data) {
  if (!config.getSecret('acc.token')) throw new ApiError(401, 'Нужно войти в аккаунт');
  return (await api('POST', '/api/share', { kind, data })).code;
}

async function shareGet(code) {
  try {
    return await api('GET', `/api/share/${encodeURIComponent(code)}`);
  } catch (e) {
    // старый сервер без «поделиться» отвечает 404 без текста ошибки
    if (e.status === 404 && !e.body?.error) throw new Error('Сервер аккаунтов ещё не умеет открывать коды — обнови его');
    throw e;
  }
}

// Трек по ссылке (kind "track") открывается и без аккаунта
async function sharePublic(code) {
  try {
    return await api('GET', `/api/share/${encodeURIComponent(code)}/public`, undefined, { token: '' });
  } catch (e) {
    if (e.status === 404 && !e.body?.error) throw new Error('Сервер аккаунтов ещё не умеет открывать ссылки на треки — обнови его');
    throw e;
  }
}

// ---- совместные плейлисты: живой список по коду, правки видны всем (server/collab.go) ----

const COLLAB_OPS = {
  list: ['GET', ''], get: ['GET', ''], create: ['POST', ''], join: ['POST', '/join'], add: ['POST', '/tracks'],
  remove: ['POST', '/remove'], move: ['POST', '/move'], rename: ['PATCH', ''], leave: ['POST', '/leave'],
};

async function collab(op, code, body) {
  if (!COLLAB_OPS[op]) throw new Error('unknown collab op ' + op);
  if (!config.getSecret('acc.token')) throw new ApiError(401, 'Нужно войти в аккаунт');
  const [method, tail] = COLLAB_OPS[op];
  const route = code ? `/api/collab/${encodeURIComponent(code)}${tail}` : '/api/collab';
  try {
    return await api(method, route, body);
  } catch (e) {
    if (e.status === 404 && !e.body?.error) throw new Error('Сервер аккаунтов ещё не умеет совместные плейлисты — обнови его');
    if (e.status === 405) throw new Error('Сервер аккаунтов ещё не умеет совместные плейлисты — обнови его');
    throw e;
  }
}

// ---- аватар ----
// Аватар хранится на сервере: смена сразу уходит туда, другие компьютеры и друзья в «Слушать вместе»
// берут его оттуда. Здесь лежит только копия (account.avatar), чтобы он был виден и без сети.

async function setAvatar(avatar) {
  const r = await api('PUT', '/api/me/avatar', { avatar: avatar || '' });
  config.set({ account: { avatar: avatar || '', avatarAt: r.user.avatar_at } });
  return status();
}

// При синхронизации: аватар поменяли с другого компьютера — обновляем копию.
// Старые версии хранили аватар в настройках вида — такой один раз переносим на сервер
async function syncAvatar(changed) {
  let me;
  try { me = (await api('GET', '/api/me')).user; } catch { return; }
  if (!!me.admin !== !!acc().admin) { config.set({ account: { admin: !!me.admin } }); changed.avatar = true; }
  if (me.avatar_at === undefined) return; // сервер ещё без аватаров
  const old = config.get().ui?.avatar;
  if (old) {
    config.set({ ui: { avatar: undefined } });
    if (!me.avatar_at) { await setAvatar(old).catch(() => {}); changed.avatar = true; return; }
  }
  if (me.avatar_at === acc().avatarAt) return;
  const avatar = me.avatar_at ? await avatarOf(me.id, me.avatar_at) : '';
  if (me.avatar_at && !avatar) return; // не скачался — попробуем в следующий раз
  config.set({ account: { avatar, avatarAt: me.avatar_at } });
  changed.avatar = true;
}

// Аватар участника румы: at — когда он его менял, по нему же и кэш
const avatars = new Map();

async function avatarOf(userId, at) {
  if (!userId || !at) return '';
  const key = `${userId}:${at}`;
  if (avatars.has(key)) return avatars.get(key);
  let url = '';
  try {
    const res = await fetch(`${acc().server}/api/avatar/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${config.getSecret('acc.token')}` },
      signal: AbortSignal.timeout(15000),
    });
    const type = res.headers.get('content-type') || '';
    if (res.ok && /^image\/(jpeg|png|webp)$/.test(type)) {
      url = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    }
  } catch {}
  if (avatars.size > 200) avatars.clear();
  avatars.set(key, url);
  return url;
}

// ---- синхронизация ----

// Какие настройки общие для всех компьютеров: микрофон у каждого свой
function syncedSettings() {
  const { ui, duck, crossfade, eq, look } = config.get();
  const { micDevice, ...rest } = duck;
  return { ui, duck: rest, crossfade, eq, look };
}

function settingsChanged(patch) {
  if (!patch || !(patch.ui || patch.eq || patch.look || 'crossfade' in patch || (patch.duck && Object.keys(patch.duck).some((k) => k !== 'micDevice')))) return;
  config.set({ account: { settingsAt: Date.now() } });
  schedule();
}

// Записать документ; при конфликте (кто-то успел раньше) пересобрать его из свежей версии сервера
async function put(kind, key, remote, build) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = build(remote?.data);
    if (data === undefined) return;
    try {
      await api('PUT', `/api/sync/${kind}/${encodeURIComponent(key)}`, { data, base_rev: remote?.rev ?? null });
      return;
    } catch (e) {
      if (e.status !== 409) throw e;
      remote = e.body?.rev == null ? null : { rev: e.body.rev, data: e.body.data };
    }
  }
  throw new Error('Не получилось синхронизировать: данные всё время меняются');
}

async function syncAlbums(remote, changed) {
  await put('albums', 'main', remote, (theirs) => {
    const merged = albums.merge(albums.snapshot(), theirs);
    if (albums.replace(merged)) changed.albums = true;
    return theirs && JSON.stringify(merged) === JSON.stringify(theirs) ? undefined : merged;
  });
}

async function syncSettings(remote, changed) {
  await put('settings', 'main', remote, (theirs) => {
    const mine = acc().settingsAt;
    if (theirs && theirs.at >= mine) {
      if (theirs.at > mine) {
        config.set({
          ui: theirs.ui, duck: { ...theirs.duck, micDevice: config.get().duck.micDevice }, account: { settingsAt: theirs.at },
          ...(theirs.crossfade != null ? { crossfade: theirs.crossfade } : {}),
          ...(theirs.eq ? { eq: theirs.eq } : {}),
          ...(theirs.look ? { look: theirs.look } : {}),
        });
        changed.settings = true;
      }
      return undefined;
    }
    const at = mine || Date.now();
    if (!mine) config.set({ account: { settingsAt: at } });
    return { at, ...syncedSettings() };
  });
}

async function syncStats(docs, changed) {
  const device = acc().device;
  const own = docs.find((d) => d.kind === 'stats' && d.key === device);
  const mine = store.read('stats');
  const json = JSON.stringify(mine);
  if (mine && json !== lastStatsPushed) {
    await put('stats', device, own, () => mine); // своя статистика принадлежит только этому компьютеру
    lastStatsPushed = json;
  }
  const others = {};
  for (const d of docs) if (d.kind === 'stats' && d.key !== device && d.data?.days) others[d.key] = d.data;
  if (JSON.stringify(others) !== JSON.stringify(store.read('statsRemote') || {})) {
    store.write('statsRemote', others);
    changed.stats = true;
  }
}

async function runSync() {
  const { docs } = await api('GET', '/api/sync');
  const doc = (kind, key) => docs.find((d) => d.kind === kind && d.key === key) || null;
  const changed = { albums: false, settings: false, stats: false, avatar: false, keys: false };
  await syncAlbums(doc('albums', 'main'), changed);
  await syncSettings(doc('settings', 'main'), changed);
  await syncStats(docs, changed);
  await syncAvatar(changed);
  await syncKeys(doc('keys', 'main'), changed);
  config.set({ account: { lastSync: Date.now() } });
  return changed;
}

// Параллельные вызовы ждут одну и ту же синхронизацию
function sync() {
  if (!config.getSecret('acc.token') || !acc().server) return Promise.resolve(null);
  if (running) return running;
  running = runSync()
    .then((changed) => { lastError = ''; notify({ status: statusAfter(), changed }); return changed; })
    .catch((e) => {
      // Фоновые ошибки не всплывают тостами: их видно в разделе «Аккаунт». Про истёкшую сессию уже сообщил dropSession
      if (e.status !== 401) lastError = e.message;
      notify({ status: statusAfter() });
      throw e;
    });
  return running;
}

function statusAfter() {
  running = null;
  return status();
}

function schedule() {
  if (!config.getSecret('acc.token')) return;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => sync().catch(() => {}), AFTER_CHANGE);
}

function start() {
  stop();
  autoTimer = setInterval(() => sync().catch(() => {}), AUTO_EVERY);
}

function stop() {
  clearInterval(autoTimer);
  clearTimeout(changeTimer);
  autoTimer = changeTimer = null;
}

function init(onEvent) {
  notify = onEvent;
  ensureDevice();
  albums.onChange(schedule);
  if (config.getSecret('acc.token')) {
    start();
    setTimeout(() => sync().catch(() => {}), 3000);
  }
}

// ---- ключи сервисов: одинаковые на всех компьютерах ----
// Токены Яндекс Музыки, SoundCloud и Spotify и client_id сервисов. На сервер уходят только зашифрованными
// (AES-256-GCM) ключом из пароля от авеона — сервер и админы видят шифр. Ключ вычисляется при входе
// и хранится здесь в защищённом хранилище Windows (acc.key). Кто вошёл до этой версии — ключа нет,
// нужен один повторный вход.

const KEY_SECRETS = ['ym.token', 'sc.token', 'sp.refresh'];
let keysState = 'ok';

function deriveKey(password, login) {
  return crypto.scryptSync(String(password), `aveon-keys:${String(login).toLowerCase()}`, 32, { N: 16384, r: 8, p: 1 });
}

function encKey() {
  const k = config.getSecret('acc.key');
  return k ? Buffer.from(k, 'base64') : null;
}

function keysNow() {
  const c = config.get();
  return {
    secrets: Object.fromEntries(KEY_SECRETS.map((k) => [k, config.getSecret(k) || ''])),
    sc: { clientId: c.sc?.clientId || '', profile: c.sc?.profile || '' },
    sp: { clientId: c.sp?.clientId || '' },
  };
}

const keySig = (k) => crypto.createHash('sha256').update(JSON.stringify(k)).digest('hex');
const hasAny = (k) => Object.values(k.secrets).some(Boolean) || !!(k.sc.clientId || k.sc.profile || k.sp.clientId);

function seal(obj, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function unseal(box, key) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8'));
}

// Первый раз на этом компьютере: с сервера берём то, что там есть, своё — где там пусто
function mergeFill(theirs, mine) {
  const pick = (a, b) => a || b;
  return {
    secrets: Object.fromEntries(KEY_SECRETS.map((k) => [k, pick(theirs.secrets?.[k], mine.secrets[k])])),
    sc: { clientId: pick(theirs.sc?.clientId, mine.sc.clientId), profile: pick(theirs.sc?.profile, mine.sc.profile) },
    sp: { clientId: pick(theirs.sp?.clientId, mine.sp.clientId) },
  };
}

function applyKeys(k) {
  const was = config.getSecret('sp.refresh');
  for (const name of KEY_SECRETS) config.setSecret(name, k.secrets?.[name] || '');
  if ((k.secrets?.['sp.refresh'] || '') !== (was || '')) { // другой вход в Spotify — старый access-токен не годится
    config.setSecret('sp.access', '');
    config.set({ sp: { expires: 0 } });
  }
  config.set({ sc: { clientId: k.sc?.clientId || '', profile: k.sc?.profile || '' }, sp: { clientId: k.sp?.clientId || '' } });
}

async function syncKeys(remote, changed) {
  const key = encKey();
  if (!key) { keysState = 'nokey'; return; }
  const first = !acc().keysSig;
  const mine = keysNow();
  const sig = keySig(mine);
  if (!first && sig !== acc().keysSig) config.set({ account: { keysSig: sig, keysAt: Date.now() } }); // поменяли здесь
  keysState = 'ok';
  await put('keys', 'main', remote, (theirs) => {
    let data = null;
    if (theirs?.box) {
      try { data = unseal(theirs.box, key); } catch { keysState = 'badkey'; return undefined; } // другой пароль
    }
    const now = keysNow();
    if (first) {
      if (!data) {
        if (!hasAny(now)) { config.set({ account: { keysSig: keySig(now) } }); return undefined; }
        const at = Date.now();
        config.set({ account: { keysSig: keySig(now), keysAt: at } });
        return { at, box: seal(now, key) };
      }
      const merged = mergeFill(data, now);
      if (keySig(merged) !== keySig(now)) { applyKeys(merged); changed.keys = true; changed.settings = true; }
      const same = keySig(merged) === keySig(data);
      const at = same ? theirs.at : Date.now();
      config.set({ account: { keysSig: keySig(keysNow()), keysAt: at } });
      return same ? undefined : { at, box: seal(merged, key) };
    }
    const localAt = acc().keysAt || 0;
    if (data && theirs.at >= localAt) {
      if (theirs.at > localAt && keySig(data) !== keySig(now)) { applyKeys(data); changed.keys = true; changed.settings = true; }
      config.set({ account: { keysSig: keySig(keysNow()), keysAt: theirs.at } });
      return undefined;
    }
    if (!localAt) return undefined;
    return { at: localAt, box: seal(now, key) };
  });
}

// Поменяли ключ сервиса (настройки, вход в Spotify) — синхронизировать поскорее
function keysChanged() { schedule(); }

// ---- админка (server/admin.go) и объявление для всех ----

const adminApi = {
  overview: () => api('GET', '/api/admin/overview'),
  users: (q) => api('GET', `/api/admin/users?q=${encodeURIComponent(q || '')}`),
  kick: (id) => api('POST', `/api/admin/users/${encodeURIComponent(id)}/logout`),
  ban: (id, banned) => api('POST', `/api/admin/users/${encodeURIComponent(id)}/ban`, { banned }),
  rename: (id, name) => api('POST', `/api/admin/users/${encodeURIComponent(id)}/rename`, { name }),
  announce: (text, track) => api('PUT', '/api/admin/announce', { text, track: track || null }),
  notify: (id, text) => api('POST', `/api/admin/users/${encodeURIComponent(id)}/notify`, { text }),
};

async function announcement() {
  if (!config.getSecret('acc.token')) return null;
  try { return await api('GET', '/api/announce'); } catch { return null; } // { announce, notice }; старый сервер — объявлений нет
}

module.exports = {
  init, status, register, login, logout, logoutAll, me, rename, changePassword, remove, sync, settingsChanged,
  sharePut, shareGet, sharePublic, collab, avatarOf, setAvatar, api, adminApi, announcement, keysChanged,
};
