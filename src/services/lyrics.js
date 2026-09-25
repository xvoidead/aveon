// Тексты песен из LRCLIB (lrclib.net): бесплатно, без ключа. syncedLyrics — LRC с таймкодами.
const { request, HttpError } = require('./http');

const API = 'https://lrclib.net/api';
const HEADERS = { 'User-Agent': 'aveon-player/1.0 (desktop music player)' }; // LRCLIB просит указывать клиент
const cache = new Map();

// «Song (feat. X) [Remastered 2011]» → «Song»
function cleanTitle(s) {
  return (s || '')
    .replace(/\s*[([](feat|ft|with|prod|remaster|remastered|official|lyrics?|audio|video|explicit)[^)\]]*[)\]]/gi, '')
    .replace(/\s+[-–—]\s+(remaster|remastered|live|radio edit|mono|stereo).*$/i, '')
    .trim();
}

function firstArtist(s) {
  return (s || '').split(/,|&| feat\.? | ft\.? | x /i)[0].trim();
}

function pack(r) {
  return {
    synced: r.syncedLyrics || '',
    plain: r.plainLyrics || '',
    instrumental: !!r.instrumental,
    source: `${r.artistName} — ${r.trackName}`,
  };
}

async function find(track) {
  if (cache.has(track.id)) return cache.get(track.id);
  const title = cleanTitle(track.title);
  const artist = firstArtist(track.artist);
  let result = null;

  // 1) Точное совпадение с длительностью
  if (artist && title) {
    const u = new URL(API + '/get');
    u.search = new URLSearchParams({
      track_name: title,
      artist_name: artist,
      ...(track.album ? { album_name: track.album } : {}),
      ...(track.duration ? { duration: String(Math.round(track.duration)) } : {}),
    }).toString();
    try {
      result = pack(await request(u, { headers: HEADERS }));
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404) throw e;
    }
  }

  // 2) Поиск: берём вариант с таймкодами и ближайшей длительностью
  if (!result || (!result.synced && !result.plain && !result.instrumental)) {
    const u = new URL(API + '/search');
    u.search = new URLSearchParams(artist ? { track_name: title, artist_name: artist } : { q: title }).toString();
    const list = await request(u, { headers: HEADERS });
    const scored = (Array.isArray(list) ? list : [])
      .map((r) => ({ r, d: track.duration ? Math.abs((r.duration || 0) - track.duration) : 0 }))
      .filter((x) => x.d <= 15)
      .sort((a, b) => (!!b.r.syncedLyrics - !!a.r.syncedLyrics) || a.d - b.d);
    if (scored.length) result = pack(scored[0].r);
  }

  result = result || { synced: '', plain: '', instrumental: false, source: '' };
  cache.set(track.id, result);
  return result;
}

module.exports = { find };
