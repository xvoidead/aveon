// Откуда играть трек: поток сервиса, свой файл, а для Spotify и «Слушать вместе» — тот же трек,
// найденный в Яндекс Музыке / SoundCloud. Общий для Windows (main.js) и Android (mobile/bridge).
const config = require('./config');
const sc = require('./services/soundcloud');
const ym = require('./services/yandex');
const sp = require('./services/spotify');
const texts = require('./services/texts');
const cache = require('./cache');

const SOURCES = { sc, ym, sp };
let local = null; // services/local.js на Windows, mobile/bridge/local.js на Android

function init(localModule) { local = localModule; }

const matchCache = new Map();

function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\((feat|ft|with|prod)[^)]*\)|\[(feat|ft|with|prod)[^\]]*\]/g, ' ')
    .replace(/\s[-–—]\s.*(remaster|version|edit|mix|live|mono|stereo).*$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function overlap(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size);
}

function score(want, got) {
  if (!got.playable) return -1;
  const t = overlap(want.title, got.title);
  const a = Math.max(overlap(want.artist.split(',')[0], got.artist), overlap(want.artist, got.artist));
  const dd = want.duration && got.duration ? Math.abs(want.duration - got.duration) : 10;
  const d = dd <= 3 ? 1 : dd <= 8 ? 0.6 : dd <= 20 ? 0.2 : 0;
  return t * 0.5 + a * 0.3 + d * 0.2 - (got.preview ? 0.3 : 0);
}

async function matchTrack(track) {
  if (matchCache.has(track.id)) return matchCache.get(track.id);
  const order = [];
  if (config.getSecret('ym.token')) order.push('ym');
  if (config.get().sc.clientId) order.push('sc');
  if (!order.length) throw new Error('Чтобы слушать треки из Spotify, подключи Яндекс Музыку или SoundCloud — через них плеер находит аудио');
  const q = `${track.artist.split(',')[0]} ${track.title}`;
  let best = null;
  for (const src of order) {
    let results = [];
    try { results = await SOURCES[src].search(q); } catch { continue; }
    for (const r of results.slice(0, 15)) {
      const s = score(track, r);
      if (!best || s > best.s) best = { s, r };
    }
    if (best && best.s >= 0.75) break;
  }
  if (!best || best.s < 0.45) throw new Error('Не нашёл этот трек в Яндекс Музыке / SoundCloud');
  matchCache.set(track.id, best.r);
  return best.r;
}

// Трек уже в кэше — играем с диска; иначе берём поток сервиса и докачиваем его в кэш вместе с текстом
async function resolveStream(track) {
  if (track.source === 'local') return { url: local.streamUrl(track.ref.path), hls: false };
  const hit = cache.cachedStream(track);
  if (hit) return hit;
  const s = await serviceStream(track);
  keep(track, s);
  return s;
}

function keep(track, s) {
  cache.remember(track, s);
  if (!s.preview) texts.find(track).catch(() => {});
}

async function serviceStream(track) {
  if (track.source === 'sp') {
    const m = await matchTrack(track);
    const s = await SOURCES[m.source].stream(m);
    return { ...s, via: { source: m.source, title: m.title, artist: m.artist } };
  }
  const svc = SOURCES[track.source];
  if (!svc) throw new Error('Неизвестный источник');
  return svc.stream(track);
}

// Трек, который включил друг в «Слушать вместе». Если у нас подключён тот же сервис — играем
// напрямую; иначе (или это его локальный файл) ищем тот же трек в Яндекс Музыке / SoundCloud.
const FROM = { local: 'из своего файла', ym: 'из Яндекс Музыки', sc: 'из SoundCloud', sp: 'из Spotify' };
const NAMES_RU = { ym: 'Яндекс Музыку', sc: 'SoundCloud' };

async function sharedStream(track) {
  const direct = (track.source === 'ym' && config.getSecret('ym.token')) || (track.source === 'sc' && config.get().sc.clientId);
  if (direct) {
    try { return await resolveStream(track); } catch {}
  }
  const hit = cache.cachedStream(track);
  if (hit) return hit;
  let m;
  try {
    m = await matchTrack(track);
  } catch (e) {
    if (/подключи/i.test(e.message)) throw new Error('Чтобы слушать вместе, подключи Яндекс Музыку или SoundCloud — через них плеер находит трек друга');
    throw e;
  }
  const st = await SOURCES[m.source].stream(m);
  const out = { ...st, cover: m.cover, via: { source: m.source, title: m.title, artist: m.artist, label: `У друга ${FROM[track.source] || ''}, звучит через ${NAMES_RU[m.source]}` } };
  keep(track, out);
  return out;
}

// ---- скачать для офлайна ----
// Треки качаются по одному: поток каждого ищем прямо перед загрузкой — подписанные ссылки
// Яндекса и SoundCloud живут недолго, заранее на всю подборку их брать нельзя
const dlQueue = [];
let dlRunning = false;

function download(tracks) {
  let added = 0;
  for (const t of tracks) {
    if (!t || t.source === 'local' || t.playable === false) continue;
    const key = `${t.source}:${t.id}`;
    if (dlQueue.some((q) => `${q.source}:${q.id}` === key)) continue;
    dlQueue.push(t);
    cache.emit({ download: { key, state: 'queued' } });
    added++;
  }
  runDownloads();
  return added;
}

async function runDownloads() {
  if (dlRunning) return;
  dlRunning = true;
  while (dlQueue.length) {
    const t = dlQueue.shift();
    const key = `${t.source}:${t.id}`;
    try {
      const s = cache.has(t) ? { url: 'cached' } : await serviceStream(t);
      await cache.remember(t, s, { pin: true });
      texts.find(t).catch(() => {}); // текст — тоже для офлайна
    } catch (e) {
      cache.emit({ download: { key, state: 'error', error: e.message } });
    }
  }
  dlRunning = false;
}

function cancelDownloads() {
  for (const t of dlQueue.splice(0)) cache.emit({ download: { key: `${t.source}:${t.id}`, state: 'removed' } });
}

const pendingDownloads = () => [...cache.pendingKeys(), ...dlQueue.map((t) => `${t.source}:${t.id}`)];

module.exports = { init, resolveStream, sharedStream, matchCache, SOURCES, download, cancelDownloads, pendingDownloads };
