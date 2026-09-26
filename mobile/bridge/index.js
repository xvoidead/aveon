// window.tishe для Android: то же API, что preload.js даёт окну в Electron, только «главный процесс»
// (src/) работает прямо здесь, в WebView. Node-модули подменены шимами (mobile/build.mjs),
// сеть идёт через нативный HTTP без CORS, а звонок, уведомление и файлы — через AveonPlugin.
import { App } from '@capacitor/app';
import { Aveon } from './native.js';
import * as fsShim from './shims/fs.js';
import { setHostname } from './shims/os.js';

const config = require('../../src/config');
const store = require('../../src/store');
const albums = require('../../src/albums');
const account = require('../../src/account');
const together = require('../../src/together');
const friends = require('../../src/friends');
const cache = require('../../src/cache');
const cacheFiles = require('./cache.js');
const censor = require('../../src/censor');
const texts = require('../../src/services/texts');
const sc = require('../../src/services/soundcloud');
const ym = require('../../src/services/yandex');
const sp = require('../../src/services/spotify');
const resolve = require('../../src/resolve');
const { request } = require('../../src/services/http');
const local = require('./local.js');

const { SOURCES, resolveStream, sharedStream, matchCache } = resolve;
resolve.init(local);

// ---- события «главного процесса» → окно ----
const listeners = new Map();
function on(channel, cb) {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel).add(cb);
  return () => listeners.get(channel).delete(cb);
}
function send(channel, payload) {
  for (const cb of listeners.get(channel) || []) {
    try { cb(clone(payload)); } catch (e) { console.error(channel, e); }
  }
}

// IPC в Electron копирует данные — окно может менять полученное, не трогая «главный процесс»
const clone = (v) => (v === undefined ? v : structuredClone(v));
const call = (fn) => async (...args) => {
  await ready;
  try {
    return clone(await fn(...args.map(clone)));
  } catch (e) {
    throw new Error(e?.message || String(e));
  }
};

// ---- запуск: данные с диска, затем то же, что app.whenReady в main.js ----
const ready = (async () => {
  await fsShim.preload();
  try { setHostname((await Aveon.deviceName()).name); } catch {}
  config.load();
  local.loadCache();
  albums.load();
})();

ready.then(() => {
  together.init((ev) => send('together:event', ev));
  friends.init();
  cache.init(cacheFiles, (ev) => send('cache:changed', ev)).catch((e) => console.warn('cache init:', e.message));
  account.init((ev) => send('account:event', ev));
  startDuck();
}).catch((e) => console.error('bridge start:', e));

// ---- бочка: звонок Discord определяет Android (режим связи), плюс кнопка «вручную» ----
let call$ = { call: false, manual: false, discord: false };
function emitMeter() {
  const loud = call$.call || call$.manual ? 1 : 0; // голоса в звонке не слышны приложению — считаем, что говорят всегда
  send('duck:meter', { o: loud, m: 0, call: call$.call || call$.manual ? 1 : 0, dc: call$.discord ? 1 : 0, manual: call$.manual });
}
async function startDuck() {
  Aveon.addListener('call', (s) => { call$ = { ...call$, ...s }; emitMeter(); });
  try { call$ = { ...call$, ...(await Aveon.callState()) }; } catch {}
  send('duck:status', { ok: true });
  emitMeter();
  setInterval(emitMeter, 500);
}
function setManual(on) {
  call$.manual = !!on;
  Aveon.setBarrel({ on: call$.manual }).catch(() => {});
  emitMeter();
}

// ---- уведомление с кнопками и экран блокировки ----
let now = { hasTrack: false, playing: false };
function pushMedia(patch) {
  now = { ...now, ...patch };
  Aveon.mediaUpdate({ ...now, barrel: call$.manual }).catch(() => {});
}
Aveon.addListener('media', ({ action, pos }) => {
  if (action === 'barrel') { setManual(!call$.manual); return; }
  if (action === 'seek') { window.dispatchEvent(new CustomEvent('aveon-seek', { detail: pos })); return; }
  send('thumb', action === 'play' || action === 'pause' ? 'toggle' : action);
});

// ---- Spotify: вход через ссылку aveon://spotify (её надо добавить в Redirect URIs приложения Spotify) ----
const SP_REDIRECT = 'aveon://spotify';
let spPending = null;
App.addListener('appUrlOpen', ({ url }) => {
  if (!url?.startsWith(SP_REDIRECT) || !spPending) return;
  const u = new URL(url.replace(/^aveon:/, 'https:'));
  spPending(u.searchParams);
});
async function spConnect() {
  const cid = sp.clientId();
  const rnd = (n) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const verifier = rnd(48);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const state = rnd(16);
  const params = await new Promise((res, rej) => {
    const timer = setTimeout(() => { spPending = null; rej(new Error('Время на вход в Spotify истекло')); }, 5 * 60 * 1000);
    spPending = (p) => { clearTimeout(timer); spPending = null; res(p); };
    const auth = new URL('https://accounts.spotify.com/authorize');
    auth.search = new URLSearchParams({
      client_id: cid, response_type: 'code', redirect_uri: SP_REDIRECT,
      code_challenge_method: 'S256', code_challenge: challenge, scope: sp.SCOPES, state,
    }).toString();
    Aveon.openUrl({ url: auth.toString() });
  });
  if (params.get('state') !== state || !params.get('code')) throw new Error(params.get('error') || 'Вход в Spotify отменён');
  const tokens = await request('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: params.get('code'), redirect_uri: SP_REDIRECT, client_id: cid, code_verifier: verifier }).toString(),
  });
  sp.saveTokens(tokens);
  return sp.profile();
}

// ---- эквалайзер: на телефоне — шторка снизу (iframe с тем же eqpop.html) ----
const pop = { frame: null, open: false, api: null, listeners: new Map() };
function popEmit(ch, data) { for (const cb of pop.listeners.get(ch) || []) cb(clone(data)); }
function popOn(ch, cb) {
  if (!pop.listeners.has(ch)) pop.listeners.set(ch, new Set());
  pop.listeners.get(ch).add(cb);
  return () => pop.listeners.get(ch).delete(cb);
}
function popEnsure() {
  if (pop.frame) return pop.ready;
  const f = document.createElement('iframe');
  f.className = 'eqpop-frame';
  f.src = 'eqpop.html';
  f.setAttribute('aria-label', 'Эквалайзер');
  pop.ready = new Promise((r) => f.addEventListener('load', r, { once: true }));
  pop.frame = f;
  document.body.appendChild(f);
  return pop.ready;
}
function popHide() {
  if (!pop.open) return;
  pop.open = false;
  pop.frame.classList.remove('open');
  send('eqpop:shown', false);
}
async function popToggle(rect, payload) {
  if (pop.open) { popHide(); return; }
  await popEnsure();
  pop.open = true;
  popEmit('eqpop:open', { ...payload, up: true });
  requestAnimationFrame(() => pop.frame.classList.add('open'));
  send('eqpop:shown', true);
}

const api = {
  mobile: {
    barrel: (onOff) => setManual(onOff),
    back: (cb) => App.addListener('backButton', cb),
    minimize: () => App.minimizeApp(),
    flush: () => { config.flush(); return fsShim.flushed(); },
  },
  config: {
    get: call(() => config.publicView()),
    set: call((patch) => {
      config.set(patch);
      account.settingsChanged(patch);
      if (patch.friends) friends.settingsChanged();
      if (patch.cache) cache.settingsChanged();
      if (pop.open && patch.eq) popEmit('eqpop:refresh');
      return config.publicView();
    }),
    secret: call((key, value) => {
      config.setSecret(key, value);
      if (key === 'ym.token') ym.reset();
      matchCache.clear();
      return config.publicView();
    }),
  },
  source: {
    search: call((src, q) => SOURCES[src].search(q)),
    searchArtists: call((src, q) => SOURCES[src].searchArtists(q)),
    collections: call((src) => SOURCES[src].collections()),
    collection: call((src, id) => SOURCES[src].collection(id)),
  },
  stream: call((track) => resolveStream(track)),
  albums: {
    list: call(() => albums.list()),
    get: call((id) => { const a = albums.get(id); return { ...a, tracks: a.tracks.map(local.applyOverride) }; }),
    create: call((title) => albums.create(title)),
    rename: call((id, title) => albums.rename(id, title)),
    remove: call((id) => albums.remove(id)),
    add: call((id, tracks) => albums.addTracks(id, tracks)),
    removeTracks: call((id, ids) => albums.removeTracks(id, ids)),
    move: call((id, from, to) => albums.moveTrack(id, from, to)),
    import: call((title, tracks) => albums.importAlbum(title, tracks)),
  },
  share: {
    put: call((kind, data) => account.sharePut(kind, data)),
    get: call((code) => account.shareGet(code)),
  },
  meta: {
    edit: call((p, fields, cover) => local.editMeta(p, fields, cover)),
    reset: call((p) => local.resetMeta(p)),
    lookup: call((q) => local.lookup(q)),
    pickCover: call(() => local.pickCover()),
    apply: call((tracks) => tracks.map(local.applyOverride)),
  },
  lyrics: call((track) => texts.find(track)),
  censor: { plan: call((track) => censor.plan(track)) },
  artist: {
    info: call((name, hintId) => (config.getSecret('ym.token') ? ym.artistByName(name, hintId) : null)),
    album: call((id) => ym.album(String(id).replace(/^ym:/, ''))),
  },
  account: {
    status: call(() => account.status()),
    register: call((server, login, password, name) => { friends.reset(); return account.register(server, login, password, name); }),
    login: call((server, login, password) => { friends.reset(); return account.login(server, login, password); }),
    logout: call(async () => { together.leave(); await friends.offline(); return account.logout(); }),
    logoutAll: call(() => account.logoutAll()),
    me: call(() => account.me()),
    rename: call((name) => account.rename(name)),
    avatar: call((dataUrl) => account.setAvatar(dataUrl)),
    password: call((old, next) => account.changePassword(old, next)),
    remove: call((password) => { friends.reset(); return account.remove(password); }),
    sync: call(() => account.sync()),
    onEvent: (cb) => on('account:event', cb),
  },
  // Rich Presence есть только у Discord на компьютере; здесь — уведомление и экран блокировки
  discord: {
    update: (p) => {
      if (!p) { pushMedia({ hasTrack: false, playing: false }); return; }
      const t = p.track || {};
      pushMedia({ hasTrack: true, playing: !!p.playing, title: t.title || '', artist: t.artist || '', album: t.album || '', cover: t.cover || '', pos: p.pos || 0, duration: p.duration || 0 });
    },
    status: call(() => ({ enabled: false, connected: false, unsupported: true })),
  },
  together: {
    create: call(() => together.create()),
    join: call((code) => together.join(code)),
    leave: call(() => together.leave()),
    status: call(() => together.status()),
    stream: call((track) => sharedStream(track)),
    avatar: call((userId, at) => account.avatarOf(userId, at)),
    send: (state, beat) => { ready.then(() => together.send(clone(state), beat)); },
    onEvent: (cb) => on('together:event', cb),
  },
  app: { version: call(() => require('../../package.json').version) },
  admin: {
    overview: call(() => account.adminApi.overview()),
    users: call((q) => account.adminApi.users(q)),
    kick: call((id) => account.adminApi.kick(id)),
    ban: call((id, banned) => account.adminApi.ban(id, banned)),
    rename: call((id, name) => account.adminApi.rename(id, name)),
    announce: call((text, track) => account.adminApi.announce(text, track)),
    notify: call((id, text) => account.adminApi.notify(id, text)),
  },
  announcement: call(() => account.announcement()),
  friends: {
    list: call(() => friends.list()),
    add: call((login) => friends.add(login)),
    accept: call((id) => friends.accept(id)),
    remove: call((id) => friends.remove(id)),
    invite: call((id, code) => friends.invite(id, code)),
    dismiss: call((id) => friends.dismiss(id)),
    knock: call((id) => friends.knock(id)),
    messages: call((id, before) => friends.messages(id, before)),
    profile: call((id) => friends.profile(id)),
    send: call((id, body) => friends.send(id, body)),
    unknock: call((id) => friends.unknock(id)),
    avatar: call((userId, at) => account.avatarOf(userId, at)),
    now: (p) => { ready.then(() => friends.now(clone(p))); },
  },
  wave: {
    start: call((settings) => ym.waveStart(settings)),
    more: call((queue) => ym.waveMore(queue)),
    feedback: call((type, track, played) => ym.waveFeedback(type, track, played)),
    related: call((track) => (track?.source === 'sc' ? sc.related(track) : [])),
    speak: (text, opts) => Aveon.speak({ text, rate: opts?.rate || 1, pitch: opts?.pitch || 1 }),
    stopSpeak: () => Aveon.stopSpeak().catch(() => {}),
  },
  downloads: {
    add: call((tracks) => resolve.download(tracks)),
    remove: call(async (tracks) => { for (const t of tracks) await cache.unpin(t); return true; }),
    list: call(() => cache.downloads()),
    state: call(() => ({ done: cache.downloadedKeys(), pending: resolve.pendingDownloads() })),
    onEvent: (cb) => on('cache:changed', cb),
  },
  cache: {
    info: call(() => cache.info()),
    clear: call((kind) => { if (kind === 'downloads' || kind === 'all') resolve.cancelDownloads(); return cache.clear(kind); }),
    onChange: (cb) => on('cache:changed', cb),
  },
  store: {
    get: call((name) => store.read(name)),
    set: call((name, data) => store.write(name, data)),
    setSync: (name, data) => { try { store.write(name, clone(data)); } catch {} return true; },
  },
  sc: { discover: call(() => sc.discoverClientId()) },
  sp: {
    connect: call(() => spConnect()),
    disconnect: call(() => sp.disconnect()),
    status: call(() => sp.status()),
    redirect: call(() => SP_REDIRECT),
  },
  local: {
    addFolder: call(async () => {
      const r = await Aveon.pickFolder();
      if (!r?.path) return null;
      const folders = [...new Set([...config.get().localFolders, r.path])];
      config.set({ localFolders: folders });
      return folders;
    }),
    removeFolder: call((dir) => {
      const folders = config.get().localFolders.filter((f) => f !== dir);
      config.set({ localFolders: folders });
      return folders;
    }),
    scan: call(() => local.scan((done, total) => send('local:progress', { done, total }))),
    openFiles: call(() => local.openFiles()),
    dropped: call(() => []),
    onProgress: (cb) => on('local:progress', cb),
  },
  duck: {
    onMeter: (cb) => on('duck:meter', cb),
    onStatus: (cb) => on('duck:status', cb),
    setLevel: () => {}, // приглушать другие приложения Android не даёт
  },
  win: {
    action: (a) => {
      if (a === 'close' || a === 'min') App.minimizeApp();
      if (a === 'fullscreen-on' || a === 'fullscreen-off') Aveon.setFullscreen({ on: a === 'fullscreen-on' }).catch(() => {});
    },
    onState: (cb) => on('win:state', cb),
    thumbState: (st) => pushMedia({ playing: !!st?.playing, hasTrack: !!st?.hasTrack }),
    onThumb: (cb) => on('thumb', cb),
  },
  openExternal: (url) => { if (/^https?:\/\//.test(url)) Aveon.openUrl({ url }); },
  copy: call((text) => Aveon.copy({ text: String(text ?? '').slice(0, 1024 * 1024) }).then(() => true)),
  eqpop: {
    toggle: (rect, payload) => { popToggle(rect, payload); },
    close: () => popHide(),
    hover: () => {}, // на телефоне шторка — прозрачных полей нет
    refresh: () => { if (pop.open) popEmit('eqpop:refresh'); },
    live: (eq) => send('eqpop:live', eq), // из шторки — в звук плеера
    action: (a) => { popHide(); send('eqpop:action', a); },
    onOpen: (cb) => popOn('eqpop:open', cb),
    onRefresh: (cb) => popOn('eqpop:refresh', cb),
    onLive: (cb) => on('eqpop:live', cb),
    onShown: (cb) => on('eqpop:shown', cb),
    onAction: (cb) => on('eqpop:action', cb),
  },
};

window.tishe = api;

// Приложение ушло в фон: сохранить сессию и статистику (в Electron это делает beforeunload)
App.addListener('pause', () => {
  window.dispatchEvent(new Event('beforeunload'));
  ready.then(() => config.flush());
});
