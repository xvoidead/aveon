// Свои альбомы: userData/albums.json. В альбоме могут лежать треки из любых источников.
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let file;
let albums = [];

function load() {
  file = path.join(app.getPath('userData'), 'albums.json');
  try { albums = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { albums = []; }
  if (!Array.isArray(albums)) albums = [];
}

function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(albums, null, 1));
  fs.renameSync(tmp, file); // атомарно: при сбое не потеряем все альбомы
}

// Сохраняем только то, что нужно для показа и воспроизведения. У SoundCloud ссылки на потоки
// и ключ авторизации со временем протухают — их не храним, поток получим заново по id.
function clean(t) {
  const ref = { ...t.ref };
  if (t.source === 'sc') { delete ref.transcodings; delete ref.auth; }
  return {
    id: t.id, source: t.source, title: t.title, artist: t.artist, album: t.album,
    duration: t.duration, cover: t.cover, link: t.link, playable: t.playable !== false, preview: !!t.preview, ref,
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
  const a = { id: crypto.randomUUID(), title, created: Date.now(), tracks: [] };
  albums.push(a);
  save();
  return summary(a);
}

function rename(id, title) {
  title = String(title || '').trim();
  if (!title) throw new Error('Название альбома не может быть пустым');
  find(id).title = title;
  save();
  return list();
}

function remove(id) {
  albums = albums.filter((a) => a.id !== id);
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
  save();
  return { added, album: summary(a) };
}

function removeTracks(id, trackIds) {
  const a = find(id);
  const drop = new Set(trackIds);
  a.tracks = a.tracks.filter((t) => !drop.has(t.id));
  save();
  return a;
}

function moveTrack(id, from, to) {
  const a = find(id);
  if (from < 0 || from >= a.tracks.length) return a;
  to = Math.max(0, Math.min(a.tracks.length - 1, to));
  const [t] = a.tracks.splice(from, 1);
  a.tracks.splice(to, 0, t);
  save();
  return a;
}

function localPaths() {
  return albums.flatMap((a) => a.tracks.filter((t) => t.source === 'local').map((t) => t.ref.path));
}

module.exports = { load, list, get, create, rename, remove, addTracks, removeTracks, moveTrack, localPaths };
