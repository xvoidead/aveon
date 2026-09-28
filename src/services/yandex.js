// Яндекс Музыка через api.music.yandex.net с OAuth-токеном аккаунта.
// Для полных треков нужна подписка Плюс, без неё API отдаёт 30-секундные превью.
const crypto = require('crypto');
const config = require('../config');
const { request } = require('./http');

const API = 'https://api.music.yandex.net';
const SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA';
const FILE_INFO_KEY = 'kzqU4XhfCaY6B6JTHODeq5';

let uidCache = null;

function token() {
  const t = config.getSecret('ym.token');
  if (!t) throw new Error('Укажи OAuth-токен Яндекс Музыки в настройках');
  return t;
}

function headers(extra = {}) {
  return {
    Authorization: `OAuth ${token()}`,
    'Accept-Language': 'ru',
    'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621',
    'User-Agent': 'Yandex-Music-API',
    ...extra,
  };
}

async function api(pathname, params = {}, opts = {}) {
  const u = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  // Соединение иногда рвётся ещё до ответа сервера — такие сбои повторяем
  for (let i = 0; ; i++) {
    try {
      const res = await request(u, { headers: headers(opts.headers), method: opts.method, body: opts.body });
      return res.result;
    } catch (e) {
      if (i >= 2 || e.status) throw e; // e.status — сервер ответил, повтор не поможет
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

function cover(uri, size = '300x300') {
  return uri ? `https://${uri.replace('%%', size)}` : '';
}

function mapTrack(t) {
  if (!t || !t.id) return null;
  const album = t.albums?.[0];
  return {
    id: `ym:${t.id}`,
    source: 'ym',
    title: t.title + (t.version ? ` (${t.version})` : ''),
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: album?.title || '',
    duration: Math.round((t.durationMs || 0) / 1000),
    cover: cover(t.coverUri || album?.coverUri),
    link: album ? `https://music.yandex.ru/album/${album.id}/track/${t.id}` : '',
    playable: t.available !== false,
    explicit: t.contentWarning === 'explicit' || t.explicit === true, // 18+: мат в тексте
    // id исполнителей — чтобы открыть страницу артиста без поиска по имени
    ref: { id: String(t.id), artists: (t.artists || []).map((a) => ({ id: String(a.id), name: a.name })) },
  };
}

async function uid() {
  if (uidCache) return uidCache;
  const status = await api('/account/status');
  uidCache = status.account.uid;
  return uidCache;
}

async function tracksByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 250) {
    const chunk = ids.slice(i, i + 250);
    const res = await api('/tracks', {}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'track-ids': chunk.join(','), 'with-positions': 'false' }).toString(),
    });
    out.push(...res.map(mapTrack).filter(Boolean));
  }
  return out;
}

async function search(q) {
  const res = await api('/search', { text: q, type: 'track', page: 0, nocorrect: 'false' });
  return (res.tracks?.results || []).map(mapTrack).filter(Boolean);
}

async function collections() {
  const id = await uid();
  const lists = await api(`/users/${id}/playlists/list`);
  return [
    { id: 'likes', title: 'Мне нравится', icon: 'heart' },
    ...lists.map((p) => ({ id: `pl:${p.kind}`, title: p.title, count: p.trackCount, cover: cover(p.cover?.uri || p.ogImage, '200x200') })),
  ];
}

async function collection(cid) {
  const id = await uid();
  if (cid === 'likes') {
    const res = await api(`/users/${id}/likes/tracks`);
    const ids = res.library.tracks.map((t) => (t.albumId ? `${t.id}:${t.albumId}` : t.id));
    return tracksByIds(ids);
  }
  if (cid.startsWith('pl:')) {
    const pl = await api(`/users/${id}/playlists/${cid.slice(3)}`);
    const tracks = pl.tracks || [];
    if (tracks.length && tracks[0].track) return tracks.map((x) => mapTrack(x.track)).filter(Boolean);
    return tracksByIds(tracks.map((x) => x.id));
  }
  throw new Error('Неизвестная коллекция');
}

// Классическая схема: download-info → xml/json с host/path/ts/s → подписанная ссылка на mp3
async function streamClassic(trackId) {
  const infos = await api(`/tracks/${trackId}/download-info`);
  const mp3 = infos.filter((i) => i.codec === 'mp3').sort((a, b) => b.bitrateInKbps - a.bitrateInKbps)[0] || infos[0];
  if (!mp3) throw new Error('Нет доступных потоков');
  const infoUrl = mp3.downloadInfoUrl + (mp3.downloadInfoUrl.includes('?') ? '&' : '?') + 'format=json';
  const d = await request(infoUrl, { headers: headers() });
  const info = typeof d === 'string' ? parseXmlInfo(d) : d;
  const sign = crypto.createHash('md5').update(SIGN_SALT + info.path.slice(1) + info.s).digest('hex');
  return { url: `https://${info.host}/get-mp3/${sign}/${info.ts}${info.path}`, hls: false, preview: !!mp3.preview, mime: 'audio/mpeg' };
}

function parseXmlInfo(xml) {
  const tag = (n) => (xml.match(new RegExp(`<${n}>([^<]*)</${n}>`)) || [])[1];
  return { host: tag('host'), path: tag('path'), ts: tag('ts'), s: tag('s') };
}

// Новая схема get-file-info (подпись HMAC-SHA256), используется как запасной вариант
async function streamFileInfo(trackId) {
  const ts = Math.floor(Date.now() / 1000);
  const quality = 'nq';
  const codecs = ['mp3', 'aac', 'he-aac'];
  const transports = 'raw';
  const msg = `${ts}${trackId}${quality}${codecs.join('')}${transports}`;
  const sign = crypto.createHmac('sha256', FILE_INFO_KEY).update(msg).digest('base64').slice(0, -1);
  const res = await api('/get-file-info', { ts, trackId, quality, codecs: codecs.join(','), transports, sign });
  const info = res.downloadInfo || res.download_info;
  if (!info?.url) throw new Error('get-file-info не вернул ссылку');
  return { url: info.url, hls: false, mime: info.codec ? `audio/${info.codec}` : '' };
}

async function stream(track) {
  const id = track.ref.id;
  try {
    return await streamClassic(id);
  } catch (e) {
    try { return await streamFileInfo(id); } catch { throw e; }
  }
}

// ---------- артисты и альбомы (страница артиста) ----------

const plain = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
const artistCache = new Map();

// Артист по имени: только точное совпадение, иначе можно открыть чужую страницу
async function findArtist(name) {
  const res = await api('/search', { text: name, type: 'artist', page: 0, nocorrect: 'true' });
  const want = plain(name);
  const hit = (res.artists?.results || []).slice(0, 8).find((a) => plain(a.name) === want);
  return hit ? String(hit.id) : null;
}

function mapAlbum(a) {
  return {
    id: `ym:${a.id}`,
    title: a.title + (a.version ? ` (${a.version})` : ''),
    year: a.year || null,
    type: a.type === 'single' ? 'single' : 'album', // сборники и live — к альбомам
    cover: cover(a.coverUri, '400x400'),
    count: a.trackCount || 0,
  };
}

// Дискография: популярные треки и все релизы, новые сверху
async function artist(id) {
  const hit = artistCache.get(id);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const brief = await api(`/artists/${id}/brief-info`);
  const albums = [];
  for (let page = 0; page < 10; page++) {
    const res = await api(`/artists/${id}/direct-albums`, { page, 'page-size': 100, 'sort-by': 'year' });
    albums.push(...(res.albums || []));
    if (!res.pager || albums.length >= res.pager.total || !res.albums?.length) break;
  }
  const a = brief.artist || {};
  const photo = a.cover?.uri || a.ogImage;
  // Второе фото артиста (если есть) — на баннер, чтобы не повторять аватарку
  const bannerUri = (brief.allCovers || []).map((c) => c.uri).find((u) => u && u !== photo) || photo;
  const data = {
    id: `ym:${id}`,
    name: a.name,
    cover: cover(photo, '400x400'),
    banner: cover(bannerUri, '1000x1000'),
    video: /^https:\/\//.test(brief.backgroundVideoUrl || '') ? brief.backgroundVideoUrl : '',
    color: a.derivedColors?.average || '',
    listeners: brief.stats?.lastMonthListeners ?? null,
    listenersDelta: brief.stats?.lastMonthListenersDelta ?? null,
    likes: a.likesCount ?? null,
    countries: a.countries || [],
    years: [a.initDate, a.endDate].filter(Boolean).map((d) => String(d).slice(0, 4)),
    popular: (brief.popularTracks || []).map(mapTrack).filter(Boolean),
    albums: albums.map(mapAlbum),
  };
  artistCache.set(id, { at: Date.now(), data });
  return data;
}

async function artistByName(name, hintId) {
  const id = hintId || (await findArtist(name));
  return id ? artist(id) : null;
}

async function album(id) {
  const a = await api(`/albums/${id}/with-tracks`);
  return { ...mapAlbum(a), tracks: (a.volumes || []).flat().map(mapTrack).filter(Boolean) };
}

function reset() { uidCache = null; likedCache = { at: 0, ids: null }; }

// id треков из «Мне нравится» ('ym:123') — только список, без данных самих треков: по нему сердечко
// у названия и в острове знает, что трек уже лайкнут (и лайкнут не в этой сессии). Держим минуту
let likedCache = { at: 0, ids: null };
async function likedIds(fresh = false) {
  if (!fresh && likedCache.ids && Date.now() - likedCache.at < 60 * 1000) return likedCache.ids;
  const res = await api(`/users/${await uid()}/likes/tracks`);
  const ids = (res.library?.tracks || []).map((t) => `ym:${t.id}`);
  likedCache = { at: Date.now(), ids };
  return ids;
}


// ---------- «Моя волна» (rotor) ----------
// Сессия волны: настройки уходят «семенами» (настроение, характер, язык), дальше сервер сам
// подбирает треки и учитывает, что ты слушал до конца, пропустил, лайкнул или не захотел слушать.
// Если сессии недоступны — старый API станции user:onyourwave.
const wave = { sid: null, batch: null, legacy: false, settings: {} };
const WAVE_STATION = 'user:onyourwave';

function waveSeeds(s = {}) {
  const seeds = [WAVE_STATION];
  if (s.mood && s.mood !== 'all') seeds.push(`settingMoodEnergy:${s.mood}`);
  if (s.diversity && s.diversity !== 'default') seeds.push(`settingDiversity:${s.diversity}`);
  if (s.language && s.language !== 'any') seeds.push(`settingLanguage:${s.language}`);
  return seeds;
}

const jsonPost = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const waveTrackId = (t) => String(t?.ref?.id || String(t?.id || '').replace(/^ym:/, ''));
const waveItems = (seq) => (seq || []).map((x) => x.track).map(mapTrack).filter((t) => t && t.playable);

async function waveStart(settings = {}) {
  wave.settings = settings;
  try {
    const r = await api('/rotor/session/new', {}, jsonPost({ seeds: waveSeeds(settings), includeTracksInResponse: true, includeWaveModel: false, interactive: true }));
    wave.sid = r.radioSessionId;
    wave.batch = r.batchId;
    wave.legacy = false;
    return waveItems(r.sequence);
  } catch (e) {
    // старый API: настройки — отдельным запросом, треки — со станции
    wave.legacy = true;
    wave.sid = null;
    try {
      await api(`/rotor/station/${WAVE_STATION}/settings2`, {}, jsonPost({
        moodEnergy: settings.mood || 'all', diversity: settings.diversity || 'default', language: settings.language || 'any', type: 'rotor',
      }));
    } catch {}
    return waveMore([]);
  }
}

// queue — id последних треков: сервер не повторяет их и продолжает с того места
async function waveMore(queue = []) {
  const ids = queue.map(waveTrackId).filter(Boolean).slice(-10);
  if (!wave.legacy && wave.sid) {
    const r = await api(`/rotor/session/${wave.sid}/tracks`, {}, jsonPost({ queue: ids }));
    wave.batch = r.batchId || wave.batch;
    return waveItems(r.sequence);
  }
  const r = await api(`/rotor/station/${WAVE_STATION}/tracks`, { settings2: 'true', ...(ids.length ? { queue: ids[ids.length - 1] } : {}) });
  wave.batch = r.batchId || wave.batch;
  return waveItems(r.sequence);
}

// type: radioStarted | trackStarted | trackFinished | skip | like | dislike
async function waveFeedback(type, track, played = 0) {
  const event = { type, timestamp: new Date().toISOString(), from: 'aveon' };
  if (track) event.trackId = waveTrackId(track);
  if (type === 'trackFinished' || type === 'skip') event.totalPlayedSeconds = Math.round(played);
  try {
    if (!wave.legacy && wave.sid) await api(`/rotor/session/${wave.sid}/feedback`, {}, jsonPost({ event, batchId: wave.batch }));
    else await api(`/rotor/station/${WAVE_STATION}/feedback`, wave.batch ? { 'batch-id': wave.batch } : {}, jsonPost(event));
  } catch {}
  // «нравится» — в лайки аккаунта; «не нравится» — в дизлайки, чтобы волна его больше не ставила
  if ((type === 'like' || type === 'dislike') && track) {
    try {
      const u = await uid();
      await api(`/users/${u}/${type === 'like' ? 'likes' : 'dislikes'}/tracks/add-multiple`, {}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ 'track-ids': waveTrackId(track) }).toString(),
      });
      if (type === 'like' && likedCache.ids && !likedCache.ids.includes(track.id)) likedCache.ids.push(track.id);
    } catch {}
  }
  return true;
}

// Артисты по запросу — для поиска (строка артистов над треками)
async function searchArtists(q) {
  const res = await api('/search', { text: q, type: 'artist', page: 0, nocorrect: 'false' });
  return (res.artists?.results || []).slice(0, 12).map((a) => ({
    id: `ym:${a.id}`, source: 'ym', name: a.name, ymId: String(a.id),
    cover: a.cover?.uri ? cover(a.cover.uri, '200x200') : '',
    followers: a.likesCount || 0,
  }));
}

module.exports = { searchArtists, search, collections, collection, stream, reset, artistByName, album, waveStart, waveMore, waveFeedback, likedIds };
