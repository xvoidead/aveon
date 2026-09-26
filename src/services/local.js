// Локальные файлы: сканирование папок, теги через music-metadata, кэш в userData/library.json.
// Поверх тегов файла можно задать свои (meta.json) — сам файл при этом не меняется.
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.webm', '.weba']);
const allowed = new Set(); // только эти пути отдаёт протокол media://
let cacheFile;
let cache = {};

// Свои теги: { путь: { title, artist, album, cover } }. cover — имя файла в userData/covers, 'none' — без обложки
let metaFile;
let overrides = {};
let coversDir;
const pickedCovers = new Set(); // картинки, выбранные в диалоге: только их можно прочитать как обложку
const COVER_NAME = /^[a-f0-9]{40}-\d+\.(jpg|png|webp)$/;
const COVER_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function loadCache() {
  cacheFile = path.join(app.getPath('userData'), 'library.json');
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { cache = {}; }
  metaFile = path.join(app.getPath('userData'), 'meta.json');
  coversDir = path.join(app.getPath('userData'), 'covers');
  try { overrides = JSON.parse(fs.readFileSync(metaFile, 'utf8')) || {}; } catch { overrides = {}; }
}

function saveOverrides() {
  fs.writeFileSync(metaFile + '.tmp', JSON.stringify(overrides, null, 1));
  fs.renameSync(metaFile + '.tmp', metaFile);
}

// Применяет свои теги к треку (и к сохранённым копиям треков в альбомах, сессии, статистике)
function applyOverride(t) {
  if (t?.source !== 'local') return t;
  const o = overrides[t.ref.path];
  if (!o) return t;
  const out = { ...t, edited: true };
  if (o.title) out.title = o.title;
  if (o.artist != null) out.artist = o.artist;
  if (o.album != null) out.album = o.album;
  if (o.cover === 'none') out.cover = '';
  else if (o.cover) out.cover = `media://art/?f=${o.cover}`;
  return out;
}

async function walk(dir, out, depth = 0) {
  if (depth > 12) return;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else if (EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
}

function toTrack(p, meta) {
  const base = path.basename(p, path.extname(p));
  let title = meta.title;
  let artist = meta.artist;
  if (!title) {
    // «Исполнитель - Название.mp3»
    const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) { artist = artist || m[1]; title = m[2]; } else title = base;
  }
  return applyOverride({
    id: `local:${p}`,
    source: 'local',
    title,
    artist: artist || '',
    album: meta.album || '',
    duration: Math.round(meta.duration || 0),
    cover: meta.hasCover ? `media://cover/?p=${encodeURIComponent(p)}` : '',
    playable: true,
    ref: { path: p },
  });
}

async function scan(onProgress) {
  const mm = await import('music-metadata');
  const files = [];
  for (const dir of config.get().localFolders) await walk(dir, files);
  const next = {};
  const tracks = [];
  let done = 0;
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      let st;
      try { st = await fs.promises.stat(p); } catch { continue; }
      const key = `${p}|${st.mtimeMs}|${st.size}`;
      let meta = cache[key];
      if (!meta) {
        try {
          const r = await mm.parseFile(p, { duration: true, skipCovers: false });
          meta = {
            title: r.common.title || '',
            artist: r.common.artist || r.common.albumartist || '',
            album: r.common.album || '',
            duration: r.format.duration || 0,
            hasCover: !!r.common.picture?.length,
          };
        } catch {
          meta = { title: '', artist: '', album: '', duration: 0, hasCover: false };
        }
      }
      next[key] = meta;
      allowed.add(p);
      tracks.push(toTrack(p, meta));
      if (++done % 25 === 0) onProgress?.(done, files.length);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  cache = next;
  fs.promises.writeFile(cacheFile, JSON.stringify(cache)).catch(() => {});
  tracks.sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'ru') || a.title.localeCompare(b.title, 'ru'));
  return tracks;
}

async function coverOf(p) {
  if (!allowed.has(p)) return null;
  const mm = await import('music-metadata');
  const r = await mm.parseFile(p, { duration: false, skipCovers: false });
  const pic = r.common.picture?.[0];
  return pic ? { data: Buffer.from(pic.data), type: pic.format || 'image/jpeg' } : null;
}

function allowFiles(paths) {
  for (const p of paths) allowed.add(p);
}

// Адрес файла для <audio>: протокол media:// в main.js, с перемоткой
function streamUrl(p) {
  allowed.add(p);
  return `media://local/?p=${encodeURIComponent(p)}`;
}

async function filesToTracks(paths) {
  const mm = await import('music-metadata');
  const out = [];
  for (const p of paths) {
    allowed.add(p);
    try {
      const r = await mm.parseFile(p, { duration: true });
      out.push(toTrack(p, { title: r.common.title, artist: r.common.artist, album: r.common.album, duration: r.format.duration, hasCover: !!r.common.picture?.length }));
    } catch {
      out.push(toTrack(p, {}));
    }
  }
  return out;
}

// ---------- редактирование тегов ----------

function readArt(name) {
  if (!COVER_NAME.test(name || '')) return null;
  const p = path.join(coversDir, name);
  if (!fs.existsSync(p)) return null;
  return { data: fs.readFileSync(p), type: COVER_TYPES[path.extname(p)] || 'image/jpeg' };
}

function allowCoverPick(p) { pickedCovers.add(p); }

async function storeCover(filePath, source) {
  let buf, ext;
  if (source.type === 'file') {
    if (!pickedCovers.has(source.path)) throw new Error('Картинка не выбрана');
    ext = path.extname(source.path).toLowerCase().replace('.jpeg', '.jpg');
    if (!COVER_TYPES[ext]) throw new Error('Обложка должна быть в формате JPG, PNG или WEBP');
    buf = await fs.promises.readFile(source.path);
  } else {
    const u = new URL(source.url);
    if (u.protocol !== 'https:') throw new Error('Обложку можно скачать только по https');
    const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw new Error('Не удалось скачать обложку');
    buf = Buffer.from(await res.arrayBuffer());
    ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
  }
  if (buf.length > 15 * 1024 * 1024) throw new Error('Картинка больше 15 МБ');
  fs.mkdirSync(coversDir, { recursive: true });
  const name = `${crypto.createHash('sha1').update(filePath).digest('hex')}-${Date.now()}${ext}`;
  await fs.promises.writeFile(path.join(coversDir, name), buf);
  return name;
}

function dropCoverFile(name) {
  if (name && name !== 'none' && COVER_NAME.test(name)) fs.promises.unlink(path.join(coversDir, name)).catch(() => {});
}

// fields: { title, artist, album }
// cover: { type: 'keep' | 'file' | 'url' | 'none' | 'original', path?, url? }
async function editMeta(filePath, fields, cover = { type: 'keep' }) {
  if (!allowed.has(filePath)) throw new Error('Этого файла нет в библиотеке');
  const prev = overrides[filePath] || {};
  const next = {
    title: String(fields.title ?? '').trim(),
    artist: String(fields.artist ?? '').trim(),
    album: String(fields.album ?? '').trim(),
  };
  if (!next.title) throw new Error('Название не может быть пустым');
  if (cover.type === 'file' || cover.type === 'url') {
    next.cover = await storeCover(filePath, cover);
    dropCoverFile(prev.cover);
  } else if (cover.type === 'none') {
    dropCoverFile(prev.cover);
    next.cover = 'none';
  } else if (cover.type === 'original') {
    dropCoverFile(prev.cover);
  } else if (prev.cover) {
    next.cover = prev.cover;
  }
  overrides[filePath] = next;
  saveOverrides();
  return (await filesToTracks([filePath]))[0];
}

// Вернуть теги из самого файла
async function resetMeta(filePath) {
  if (!allowed.has(filePath)) throw new Error('Этого файла нет в библиотеке');
  dropCoverFile(overrides[filePath]?.cover);
  delete overrides[filePath];
  saveOverrides();
  return (await filesToTracks([filePath]))[0];
}

// Теги и обложка из каталога iTunes: без ключа, обложки до 600×600
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
  loadCache, scan, coverOf, allowed, allowFiles, streamUrl, filesToTracks, EXT,
  applyOverride, editMeta, resetMeta, lookup, readArt, allowCoverPick, COVER_TYPES,
};
