// Кэш: треки из сервисов сохраняются сами, пока их слушаешь, и дальше играют с диска — быстрее и
// без сети. Тексты песен хранятся целиком и навсегда. Треки занимают место до лимита из настроек;
// сверх него удаляются те, что слушали давнее всего.
// Скачанные (pinned) — то же хранилище, но их лимит не трогает: они для офлайна, вместе с обложкой.
// Как хранить файлы, решает платформа (backend): Windows — src/cache-files.js, Android — mobile/bridge/cache.js.
const crypto = require('crypto');
const config = require('./config');
const store = require('./store');

const NO_LYRICS_AGAIN = 3 * 24 * 3600 * 1000; // «текста нет» перепроверяем через 3 дня
const EXT = { mpeg: '.mp3', mp3: '.mp3', mp4: '.m4a', aac: '.aac', ogg: '.ogg', opus: '.ogg', webm: '.webm', flac: '.flac' };

let io = null; // { download(urls, name) → байты, remove(name), clear(), list() → [{ name, size }], url(name) }
// store 'cache': { tracks: { key: { name, size, at, title, artist, via, pinned, track, cover, coverSize } } }
let index = null;
let lyrics = null; // store 'lyrics': { key: { at, data } }
const queue = []; // { key, track, stream, pin, done: [resolve, reject][] }
let busy = null; // ключ трека, который сейчас скачивается
let notify = () => {};

// keep — сохранять ли треки, limitMb — сколько места им можно занять
const cfg = () => ({ keep: true, limitMb: 2048, ...(config.get().cache || {}) });
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const trackKey = (t) => `${t.source}:${t.id}`;

function save() { store.write('cache', index); }
function saveLyrics() { store.write('lyrics', lyrics); }

async function init(backend, onChange) {
  io = backend;
  if (onChange) notify = onChange;
  index = store.read('cache') || { tracks: {} };
  index.tracks ||= {};
  lyrics = store.read('lyrics') || {};
  // Сверяем индекс с файлами: недокачанные и потерянные записи убираем
  let files = [];
  try { files = await io.list(); } catch {}
  const onDisk = new Map(files.map((f) => [f.name, f.size]));
  const known = new Set();
  for (const [key, e] of Object.entries(index.tracks)) {
    if (!onDisk.has(e.name)) { delete index.tracks[key]; continue; }
    e.size = onDisk.get(e.name);
    known.add(e.name);
    if (e.cover) {
      if (onDisk.has(e.cover)) known.add(e.cover);
      else delete e.cover;
    }
  }
  for (const f of files) if (!known.has(f.name)) io.remove(f.name).catch(() => {});
  save();
}

// Копия трека для списка «Скачанные»: без того, что протухает (ссылки SoundCloud на поток)
function slim(t) {
  const ref = { ...(t.ref || {}) };
  delete ref.transcodings;
  delete ref.auth;
  return { id: t.id, source: t.source, title: t.title || '', artist: t.artist || '', album: t.album || '', duration: t.duration || 0, cover: t.cover || '', link: t.link || '', playable: true, ref };
}

// ---------- треки ----------

function cachedStream(track) {
  if (!io || !track || track.source === 'local') return null;
  const e = index.tracks[trackKey(track)];
  if (!e) return null;
  e.at = Date.now();
  save();
  return { url: io.url(e.name), hls: false, cached: true, ...(e.via ? { via: e.via } : {}) };
}

function has(track) {
  return !!(track && index?.tracks[trackKey(track)]);
}

// Поток уже найден и играет — докачиваем его целиком в фоне. pin — это скачивание для офлайна:
// идёт первым в очереди, не вытесняется лимитом, а промис ждёт конца загрузки
function remember(track, stream, { pin = false } = {}) {
  if (!io || !track || !stream?.url) return Promise.resolve(false);
  if (!pin && !cfg().keep) return Promise.resolve(false);
  if (track.source === 'local' || stream.preview || (!pin && track.preview)) return Promise.resolve(false);
  const key = trackKey(track);
  if (index.tracks[key]) return pin ? pinExisting(track).then(() => true) : Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const item = queue.find((q) => q.key === key) || (busy?.key === key ? busy : null);
    if (item) {
      item.pin ||= pin;
      item.track = track;
      item.done.push([resolve, reject]);
      return;
    }
    const next = { key, track, stream, pin, done: [[resolve, reject]] };
    if (pin) queue.splice(queue.findIndex((q) => !q.pin) === -1 ? queue.length : queue.findIndex((q) => !q.pin), 0, next);
    else queue.push(next);
    pump();
  });
}

async function pump() {
  if (busy || !queue.length) return;
  const item = queue.shift();
  busy = item;
  const { key, track, stream } = item;
  if (item.pin) notify({ download: { key, state: 'loading' } });
  let ok = false;
  let err = null;
  try {
    const plan = stream.hls ? await hlsPlan(stream.url, stream.mime) : { urls: [stream.url], ext: extOf(stream.mime, stream.url) };
    if (!plan) throw new Error('Этот поток нельзя сохранить в файл');
    const name = `${sha(key).slice(0, 24)}${plan.ext}`;
    const size = await io.download(plan.urls, name);
    if (size > 0) {
      index.tracks[key] = {
        name, size, at: Date.now(), title: track.title || '', artist: track.artist || '',
        ...(stream.via ? { via: stream.via } : {}),
      };
      if (item.pin) await pinExisting(track);
      save();
      await trim();
      ok = true;
    }
  } catch (e) {
    err = e;
    console.warn('cache:', e.message);
  } finally {
    busy = null;
    for (const [resolve, reject] of item.done) (ok || !item.pin ? resolve(ok) : reject(err || new Error('Не скачалось')));
    notify(item.pin ? { download: { key, state: ok ? 'done' : 'error', error: err?.message } } : { cached: key });
    pump();
  }
}

// Трек уже на диске — закрепляем его и докачиваем обложку, чтобы и без сети было что показать
async function pinExisting(track) {
  const key = trackKey(track);
  const e = index.tracks[key];
  if (!e) return;
  if (!e.pinned) e.pinnedAt = Date.now();
  e.pinned = true;
  e.track = slim(track);
  e.at = Date.now();
  if (!e.cover && /^https?:\/\//.test(track.cover || '')) {
    const coverName = `${sha(key).slice(0, 24)}.jpg`;
    try {
      e.coverSize = await io.download([track.cover], coverName);
      e.cover = coverName;
    } catch {}
  }
  save();
}

// Убрать из скачанных — файл больше не нужен
async function unpin(track) {
  const key = trackKey(track);
  const e = index?.tracks[key];
  if (!e) return false;
  delete index.tracks[key];
  save();
  await io.remove(e.name).catch(() => {});
  if (e.cover) await io.remove(e.cover).catch(() => {});
  notify({ download: { key, state: 'removed' } });
  return true;
}

function extOf(mime, url) {
  const m = String(mime || '').toLowerCase();
  for (const [k, v] of Object.entries(EXT)) if (m.includes(k)) return v;
  const u = String(url).split('?')[0].toLowerCase();
  const dot = u.match(/\.(mp3|m4a|mp4|aac|ogg|opus|webm|flac)$/);
  return dot ? EXT[dot[1] === 'm4a' ? 'mp4' : dot[1]] || `.${dot[1]}` : '.mp3';
}

// HLS → список частей, которые склеиваются в обычный файл: mp3 и ogg — подряд, fMP4 — init + фрагменты.
// MPEG-TS и зашифрованные потоки не кэшируем: такой файл браузер не сыграет
async function hlsPlan(url, mime) {
  let text = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).text();
  let base = url;
  if (text.includes('#EXT-X-STREAM-INF')) {
    const variant = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (!variant) return null;
    base = new URL(variant, url).toString();
    text = await (await fetch(base, { signal: AbortSignal.timeout(20000) })).text();
  }
  if (/#EXT-X-KEY:(?!.*METHOD=NONE)/.test(text)) return null;
  const urls = [];
  const map = text.match(/#EXT-X-MAP:.*URI="([^"]+)"/);
  if (map) urls.push(new URL(map[1], base).toString());
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l && !l.startsWith('#')) urls.push(new URL(l, base).toString());
  }
  if (!urls.length) return null;
  const first = urls[map ? 1 : 0] || '';
  if (/\.ts(\?|$)/i.test(first) || /mp2t/i.test(mime || '')) return null;
  return { urls, ext: map ? '.m4a' : extOf(mime, first) };
}

// Лимит — только для кэша: скачанные не трогаем
async function trim() {
  const limit = cfg().limitMb * 1024 * 1024;
  const list = Object.entries(index.tracks).filter(([, e]) => !e.pinned).sort((a, b) => a[1].at - b[1].at);
  let total = list.reduce((n, [, e]) => n + e.size, 0);
  for (const [key, e] of list) {
    if (total <= limit) break;
    total -= e.size;
    delete index.tracks[key];
    await io.remove(e.name).catch(() => {});
  }
  save();
}

// ---------- скачанные ----------

// Список для раздела «Скачанные»: новые сверху, обложка — своя копия с диска
function downloads() {
  return Object.values(index?.tracks || {})
    .filter((e) => e.pinned && e.track)
    .sort((a, b) => (b.pinnedAt || b.at) - (a.pinnedAt || a.at))
    .map((e) => ({ ...e.track, cover: e.cover ? io.url(e.cover) : e.track.cover, downloaded: true }));
}

function downloadedKeys() {
  return Object.entries(index?.tracks || {}).filter(([, e]) => e.pinned).map(([k]) => k);
}

function pendingKeys() {
  return [...(busy?.pin ? [busy.key] : []), ...queue.filter((q) => q.pin).map((q) => q.key)];
}

// ---------- тексты ----------

const lyricsKey = (t) => sha(`${t.id}|${(t.artist || '').toLowerCase()}|${(t.title || '').toLowerCase()}`);

function lyricsGet(track) {
  if (!lyrics) return null;
  const e = lyrics[lyricsKey(track)];
  if (!e) return null;
  const empty = !e.data?.words && !e.data?.synced && !e.data?.plain && !e.data?.instrumental;
  if (empty && Date.now() - e.at > NO_LYRICS_AGAIN) return null;
  return e.data;
}

function lyricsPut(track, data) {
  if (!lyrics || !data) return;
  lyrics[lyricsKey(track)] = { at: Date.now(), data };
  saveLyrics();
}

// ---------- для настроек ----------

function info() {
  const all = Object.values(index?.tracks || {});
  const auto = all.filter((e) => !e.pinned);
  const pinned = all.filter((e) => e.pinned);
  const lyr = Object.values(lyrics || {}).filter((e) => e.data?.words || e.data?.synced || e.data?.plain);
  return {
    tracks: { count: auto.length, bytes: auto.reduce((n, e) => n + e.size, 0) },
    downloads: { count: pinned.length, bytes: pinned.reduce((n, e) => n + e.size + (e.coverSize || 0), 0) },
    lyrics: { count: lyr.length, bytes: lyrics && Object.keys(lyrics).length ? JSON.stringify(lyrics).length : 0 },
    downloading: (busy ? 1 : 0) + queue.length,
    keep: cfg().keep,
    limitMb: cfg().limitMb,
  };
}

// tracks — только кэш (скачанные остаются), downloads — только скачанные, lyrics — тексты
async function clear(kind) {
  if (kind === 'tracks' || kind === 'downloads' || kind === 'all') {
    const pinned = kind === 'downloads';
    for (let i = queue.length - 1; i >= 0; i--) if (kind === 'all' || !!queue[i].pin === pinned) queue.splice(i, 1);
    for (const [key, e] of Object.entries(index.tracks)) {
      if (kind !== 'all' && !!e.pinned !== pinned) continue;
      delete index.tracks[key];
      await io.remove(e.name).catch(() => {});
      if (e.cover) await io.remove(e.cover).catch(() => {});
    }
    save();
    if (kind !== 'tracks') notify({ download: { state: 'cleared' } });
  }
  if (kind === 'lyrics' || kind === 'all') {
    lyrics = {};
    saveLyrics();
  }
  return info();
}

async function settingsChanged() {
  if (index) await trim();
  return info();
}

// Для очереди скачивания в resolve.js: сообщить окну, что трек встал в очередь
function emit(ev) { notify(ev); }

module.exports = {
  init, emit, cachedStream, has, remember, unpin, downloads, downloadedKeys, pendingKeys,
  lyricsGet, lyricsPut, info, clear, settingsChanged,
};
