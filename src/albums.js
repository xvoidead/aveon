// Свои альбомы: userData/albums.json. В альбоме могут лежать треки из любых источников.
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let file;
let albums = [];
// id удалённого альбома → когда удалён. Нужно для синхронизации: иначе альбом, удалённый
// на одном компьютере, вернулся бы с другого. Храним полгода.
let deleted = {};
const TOMBSTONE_TTL = 180 * 24 * 3600 * 1000;
let changed = () => {};

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, p); // атомарно: при сбое не потеряем все альбомы
}

const deletedFile = () => path.join(path.dirname(file), 'albums-deleted.json');

function load() {
  file = path.join(app.getPath('userData'), 'albums.json');
  albums = readJson(file, []);
  if (!Array.isArray(albums)) albums = [];
  deleted = readJson(deletedFile(), {});
  if (!deleted || typeof deleted !== 'object') deleted = {};
}

function save(a) {
  if (a) a.updated = Date.now();
  writeJson(file, albums);
  changed();
}

// Сохраняем только то, что нужно для показа и воспроизведения. У SoundCloud ссылки на потоки
// и ключ авторизации со временем протухают — их не храним, поток получим заново по id.
function clean(t) {
  const ref = { ...t.ref };
  if (t.source === 'sc') { delete ref.transcodings; delete ref.auth; }
  return {
    id: t.id, source: t.source, title: t.title, artist: t.artist, album: t.album,
    duration: t.duration, cover: t.cover, link: t.link, playable: t.playable !== false, preview: !!t.preview, ref,
    ...(t.shared ? { shared: true } : {}), // трек из чужого альбома: свой файл друга ищется по названию
  };
}

function find(id) {
  const a = albums.find((x) => x.id === id);
  if (!a) throw new Error('Альбом не найден');
  return a;
}

function summary(a) {
  return { id: a.id, title: a.title, count: a.tracks.length, cover: a.tracks.find((t) => t.cover)?.cover || '' };
}

function list() { return albums.map(summary); }

function get(id) { return find(id); }

function create(title) {
  title = String(title || '').trim();
  if (!title) throw new Error('Название альбома не может быть пустым');
  const a = { id: crypto.randomUUID(), title, created: Date.now(), updated: Date.now(), tracks: [] };
  albums.push(a);
  save();
  return summary(a);
}

function rename(id, title) {
  title = String(title || '').trim();
  if (!title) throw new Error('Название альбома не может быть пустым');
  const a = find(id);
  a.title = title;
  save(a);
  return list();
}

function remove(id) {
  albums = albums.filter((a) => a.id !== id);
  deleted[id] = Date.now();
  writeJson(deletedFile(), deleted);
  save();
  return list();
}

// Добавляет треки в конец, пропуская те, что уже есть. Возвращает, сколько добавлено.
function addTracks(id, tracks) {
  const a = find(id);
  const have = new Set(a.tracks.map((t) => t.id));
  let added = 0;
  for (const t of tracks) {
    if (!t?.id || have.has(t.id)) continue;
    a.tracks.push(clean(t));
    have.add(t.id);
    added++;
  }
  if (added) save(a);
  return { added, album: summary(a) };
}

// Альбом, которым поделился друг: новый альбом с копией его треков
function importAlbum(title, tracks) {
  const a = create(title);
  addTracks(a.id, tracks);
  return summary(find(a.id));
}

function removeTracks(id, trackIds) {
  const a = find(id);
  const drop = new Set(trackIds);
  a.tracks = a.tracks.filter((t) => !drop.has(t.id));
  save(a);
  return a;
}

function moveTrack(id, from, to) {
  const a = find(id);
  if (from < 0 || from >= a.tracks.length) return a;
  to = Math.max(0, Math.min(a.tracks.length - 1, to));
  const [t] = a.tracks.splice(from, 1);
  a.tracks.splice(to, 0, t);
  save(a);
  return a;
}

function localPaths() {
  return albums.flatMap((a) => a.tracks.filter((t) => t.source === 'local' && t.ref?.path).map((t) => t.ref.path));
}

// ---- синхронизация с аккаунтом ----

function snapshot() {
  const now = Date.now();
  for (const [id, at] of Object.entries(deleted)) if (now - at > TOMBSTONE_TTL) delete deleted[id];
  return { albums, deleted };
}

// Слияние двух копий: по каждому альбому побеждает более свежая правка,
// удаление побеждает правки, сделанные до него. Порядок — как у нас, новые с сервера в конце.
function merge(mine, theirs) {
  const del = { ...mine.deleted };
  for (const [id, at] of Object.entries(theirs?.deleted || {})) del[id] = Math.max(del[id] || 0, at);
  const stamp = (a) => a.updated || a.created || 0;
  const byId = new Map();
  for (const a of [...mine.albums, ...(theirs?.albums || [])]) {
    const have = byId.get(a.id);
    if (!have || stamp(a) > stamp(have)) byId.set(a.id, a);
  }
  const order = [...new Set([...mine.albums, ...(theirs?.albums || [])].map((a) => a.id))];
  const out = order.map((id) => byId.get(id)).filter((a) => !(del[a.id] >= stamp(a)));
  return { albums: out, deleted: del };
}

// Подставить слитую версию. Возвращает true, если у нас что-то поменялось.
function replace(next) {
  const before = JSON.stringify(albums);
  albums = next.albums;
  deleted = next.deleted;
  writeJson(deletedFile(), deleted);
  if (JSON.stringify(albums) === before) return false;
  writeJson(file, albums);
  return true;
}

function onChange(cb) { changed = cb; }

module.exports = {
  load, list, get, create, rename, remove, addTracks, importAlbum, removeTracks, moveTrack, localPaths,
  snapshot, merge, replace, onChange,
};
