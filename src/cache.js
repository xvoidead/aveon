// Кэш: треки из сервисов сохраняются сами, пока их слушаешь, и дальше играют с диска — быстрее и
// без сети. Тексты песен хранятся целиком и навсегда. Треки занимают место до лимита из настроек;
// сверх него удаляются те, что слушали давнее всего.
// Как хранить файлы, решает платформа (backend): Windows — src/cache-files.js, Android — mobile/bridge/cache.js.
const crypto = require('crypto');
const config = require('./config');
const store = require('./store');

const NO_LYRICS_AGAIN = 3 * 24 * 3600 * 1000; // «текста нет» перепроверяем через 3 дня
const EXT = { mpeg: '.mp3', mp3: '.mp3', mp4: '.m4a', aac: '.aac', ogg: '.ogg', opus: '.ogg', webm: '.webm', flac: '.flac' };

let io = null; // { download(urls, name) → байты, remove(name), clear(), list() → [{ name, size }], url(name) }
let index = null; // store 'cache': { tracks: { key: { name, size, at, title, artist, via } } }
let lyrics = null; // store 'lyrics': { key: { at, data } }
const queue = [];
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
    if (!onDisk.has(e.name)) delete index.tracks[key];
    else { e.size = onDisk.get(e.name); known.add(e.name); }
  }
  for (const f of files) if (!known.has(f.name)) io.remove(f.name).catch(() => {});
  save();
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

// Поток уже найден и играет — докачиваем его целиком в фоне
function remember(track, stream) {
  if (!io || !cfg().keep || !track || !stream?.url) return;
  if (track.source === 'local' || track.preview || stream.preview || stream.cached) return;
  const key = trackKey(track);
  if (index.tracks[key] || busy === key || queue.some((q) => q.key === key)) return;
  queue.push({ key, track, stream });
  pump();
}

async function pump() {
  if (busy || !queue.length) return;
  const { key, track, stream } = queue.shift();
  busy = key;
  try {
    const plan = stream.hls ? await hlsPlan(stream.url, stream.mime) : { urls: [stream.url], ext: extOf(stream.mime, stream.url) };
    if (plan) {
      const name = `${sha(key).slice(0, 24)}${plan.ext}`;
      const size = await io.download(plan.urls, name);
      if (size > 0) {
        index.tracks[key] = {
          name, size, at: Date.now(), title: track.title || '', artist: track.artist || '',
          ...(stream.via ? { via: stream.via } : {}),
        };
        save();
        await trim();
        notify();
      }
    }
  } catch (e) {
    console.warn('cache:', e.message);
  } finally {
    busy = null;
    pump();
  }
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

async function trim() {
  const limit = cfg().limitMb * 1024 * 1024;
  const list = Object.entries(index.tracks).sort((a, b) => a[1].at - b[1].at);
  let total = list.reduce((n, [, e]) => n + e.size, 0);
  for (const [key, e] of list) {
    if (total <= limit) break;
    total -= e.size;
    delete index.tracks[key];
    await io.remove(e.name).catch(() => {});
  }
  save();
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
  const tracks = Object.values(index?.tracks || {});
  const lyr = Object.values(lyrics || {}).filter((e) => e.data?.words || e.data?.synced || e.data?.plain);
  return {
    tracks: { count: tracks.length, bytes: tracks.reduce((n, e) => n + e.size, 0) },
    lyrics: { count: lyr.length, bytes: lyrics && Object.keys(lyrics).length ? JSON.stringify(lyrics).length : 0 },
    downloading: busy ? 1 + queue.length : queue.length,
    keep: cfg().keep,
    limitMb: cfg().limitMb,
  };
}

async function clear(kind) {
  if (kind === 'tracks' || kind === 'all') {
    queue.length = 0;
    index.tracks = {};
    save();
    await io.clear().catch(() => {});
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

module.exports = { init, cachedStream, has, remember, lyricsGet, lyricsPut, info, clear, settingsChanged };
