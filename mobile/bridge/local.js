// Свои файлы на Android: вместо обхода папок и music-metadata — MediaStore (AveonPlugin.scanAudio).
// Путь трека — content:// адрес файла; играет и отдаёт обложку WebView по /_media/* (AveonWebViewClient).
// Свои теги (meta.json) и обложки (covers/) — как в src/services/local.js.
const fs = require('fs');
const crypto = require('crypto');
const config = require('../../src/config');
const { Aveon, b64ToBytes } = require('./native.js');

const EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.webm', '.weba']);
const COVER_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const COVER_NAME = /^[a-f0-9]{40}-\d+\.(jpg|png|webp)$/;
const META = '/aveon/meta.json';

const known = new Map(); // uri → теги из MediaStore
const picked = new Map(); // выбранные картинки для обложки: ключ → base64
let overrides = {};

const media = (kind, q) => `${location.origin}/_media/${kind}?${q}`;

function loadCache() {
  try { overrides = JSON.parse(fs.readFileSync(META, 'utf8')) || {}; } catch { overrides = {}; }
}

function saveOverrides() {
  fs.writeFileSync(META, JSON.stringify(overrides, null, 1));
}

function applyOverride(t) {
  if (t?.source !== 'local') return t;
  const o = overrides[t.ref.path];
  if (!o) return t;
  const out = { ...t, edited: true };
  if (o.title) out.title = o.title;
  if (o.artist != null) out.artist = o.artist;
  if (o.album != null) out.album = o.album;
  if (o.cover === 'none') out.cover = '';
  else if (o.cover) out.cover = media('art', `f=${o.cover}`);
  return out;
}

function toTrack(uri, meta = {}) {
  const base = (meta.name || '').replace(/\.[^.]+$/, '');
  let title = meta.title;
  let artist = meta.artist && meta.artist !== '<unknown>' ? meta.artist : '';
  if (!title || title === base) {
    const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) { artist = artist || m[1]; title = m[2]; } else title = title || base || 'без названия';
  }
  return applyOverride({
    id: `local:${uri}`,
    source: 'local',
    title,
    artist: artist || '',
    album: meta.album && meta.album !== '<unknown>' ? meta.album : '',
    duration: Math.round((meta.duration || 0) / 1000),
    cover: meta.hasArt === false ? '' : media('cover', `p=${encodeURIComponent(uri)}`),
    playable: true,
    ref: { path: uri },
  });
}

// localFolders на телефоне — папки внутри памяти вида «Music/Rock/» (из системного выбора папки)
async function scan(onProgress) {
  const folders = config.get().localFolders;
  if (!folders.length) return [];
  const { items = [] } = await Aveon.scanAudio({ folders });
  const tracks = [];
  for (const it of items) {
    known.set(it.uri, it);
    tracks.push(toTrack(it.uri, it));
  }
  onProgress?.(tracks.length, tracks.length);
  tracks.sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'ru') || a.title.localeCompare(b.title, 'ru'));
  return tracks;
}

function streamUrl(uri) {
  return media('local', `p=${encodeURIComponent(uri)}`);
}

function allowFiles() {}

async function openFiles() {
  const { items = [] } = await Aveon.pickAudio();
  return items.map((it) => { known.set(it.uri, it); return toTrack(it.uri, it); });
}

async function filesToTracks(uris) {
  const out = [];
  for (const uri of uris) {
    if (!known.has(uri)) {
      try { known.set(uri, await Aveon.audioInfo({ uri })); } catch {}
    }
    out.push(toTrack(uri, known.get(uri)));
  }
  return out;
}

// ---------- обложки и теги ----------

async function pickCover() {
  const r = await Aveon.pickImage();
  if (!r?.data) return null;
  if (r.data.length * 0.75 > 15 * 1024 * 1024) throw new Error('Картинка больше 15 МБ');
  const key = `pick:${Date.now()}`;
  picked.set(key, { data: r.data, type: r.type || 'image/jpeg' });
  return { path: key, preview: `data:${r.type || 'image/jpeg'};base64,${r.data}` };
}

async function storeCover(uri, source) {
  let buf, type;
  if (source.type === 'file') {
    const p = picked.get(source.path);
    if (!p) throw new Error('Картинка не выбрана');
    buf = b64ToBytes(p.data);
    type = p.type;
  } else {
    const u = new URL(source.url);
    if (u.protocol !== 'https:') throw new Error('Обложку можно скачать только по https');
    const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
    type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw new Error('Не удалось скачать обложку');
    buf = new Uint8Array(await res.arrayBuffer());
  }
  if (buf.length > 15 * 1024 * 1024) throw new Error('Картинка больше 15 МБ');
  const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
  const name = `${crypto.createHash('sha1').update(uri).digest('hex')}-${Date.now()}${ext}`;
  await fs.promises.writeFile(`/aveon/covers/${name}`, buf);
  return name;
}

function dropCoverFile(name) {
  if (name && name !== 'none' && COVER_NAME.test(name)) fs.promises.unlink(`/aveon/covers/${name}`).catch(() => {});
}

async function editMeta(uri, fields, cover = { type: 'keep' }) {
  const prev = overrides[uri] || {};
  const next = {
    title: String(fields.title ?? '').trim(),
    artist: String(fields.artist ?? '').trim(),
    album: String(fields.album ?? '').trim(),
  };
  if (!next.title) throw new Error('Название не может быть пустым');
  if (cover.type === 'file' || cover.type === 'url') {
    next.cover = await storeCover(uri, cover);
    dropCoverFile(prev.cover);
  } else if (cover.type === 'none') {
    dropCoverFile(prev.cover);
    next.cover = 'none';
  } else if (cover.type === 'original') {
    dropCoverFile(prev.cover);
  } else if (prev.cover) {
    next.cover = prev.cover;
  }
  overrides[uri] = next;
  saveOverrides();
  return (await filesToTracks([uri]))[0];
}

async function resetMeta(uri) {
  dropCoverFile(overrides[uri]?.cover);
  delete overrides[uri];
  saveOverrides();
  return (await filesToTracks([uri]))[0];
}

async function lookup(query) {
  const u = new URL('https://itunes.apple.com/search');
  u.search = new URLSearchParams({ term: query, entity: 'song', limit: '12' }).toString();
  const res = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Каталог не ответил (HTTP ${res.status})`);
  const json = await res.json();
  return (json.results || []).map((r) => ({
    title: r.trackName || '',
    artist: r.artistName || '',
    album: r.collectionName || '',
    year: (r.releaseDate || '').slice(0, 4),
    cover: (r.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.'),
    thumb: r.artworkUrl100 || '',
  }));
}

module.exports = {
  EXT, COVER_TYPES, loadCache, scan, streamUrl, allowFiles, openFiles, filesToTracks,
  applyOverride, editMeta, resetMeta, lookup, pickCover,
};
