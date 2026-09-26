// SoundCloud через api-v2. Нужен client_id (можно найти автоматически), для лайков — OAuth-токен
// или ссылка на публичный профиль.
const config = require('../config');
const { request } = require('./http');

const API = 'https://api-v2.soundcloud.com';

function clientId() {
  const id = config.get().sc.clientId;
  if (!id) throw new Error('Укажи client_id SoundCloud в настройках (или нажми «Найти автоматически»)');
  return id;
}

function headers() {
  const token = config.getSecret('sc.token');
  return token ? { Authorization: `OAuth ${token}` } : {};
}

async function api(pathname, params = {}) {
  const u = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('client_id', clientId());
  return request(u, { headers: headers() });
}

// client_id лежит в одном из JS-бандлов на soundcloud.com
async function discoverClientId() {
  const html = await request('https://soundcloud.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const src of scripts.reverse()) {
    try {
      const js = await request(src);
      const m = js.match(/[{,]client_id:"([a-zA-Z0-9]{32})"/) || js.match(/client_id[=:]"?([a-zA-Z0-9]{32})/);
      if (m) {
        config.set({ sc: { clientId: m[1] } });
        return m[1];
      }
    } catch {}
  }
  throw new Error('Не удалось найти client_id на soundcloud.com');
}

function cover(t) {
  const url = t.artwork_url || t.user?.avatar_url;
  return url ? url.replace('-large.', '-t300x300.') : '';
}

function mapTrack(t) {
  if (!t || t.kind !== 'track') return null;
  return {
    id: `sc:${t.id}`,
    source: 'sc',
    title: t.title,
    artist: t.publisher_metadata?.artist || t.user?.username || '',
    album: t.publisher_metadata?.album_title || '',
    duration: Math.round((t.full_duration || t.duration || 0) / 1000),
    cover: cover(t),
    link: t.permalink_url,
    playable: t.streamable !== false && t.policy !== 'BLOCK',
    preview: t.policy === 'SNIP',
    ref: { id: t.id, auth: t.track_authorization, transcodings: t.media?.transcodings || [] },
  };
}

async function search(q) {
  const res = await api('/search/tracks', { q, limit: 50 });
  return res.collection.map(mapTrack).filter(Boolean);
}

async function userId() {
  if (config.getSecret('sc.token')) {
    const me = await api('/me');
    return me.id;
  }
  const profile = config.get().sc.profile;
  if (!profile) throw new Error('Для лайков укажи OAuth-токен или ссылку на свой профиль SoundCloud');
  const user = await api('/resolve', { url: profile });
  return user.id;
}

async function collections() {
  return [{ id: 'likes', title: 'Мне нравится', icon: 'heart' }];
}

async function collection(id) {
  if (id !== 'likes') throw new Error('Неизвестная коллекция');
  const uid = await userId();
  const out = [];
  let next = `/users/${uid}/track_likes`;
  let params = { limit: 200 };
  for (let page = 0; next && page < 10; page++) {
    const res = await api(next, params);
    out.push(...res.collection.map((x) => mapTrack(x.track)).filter(Boolean));
    if (!res.next_href) break;
    const u = new URL(res.next_href);
    next = u.pathname;
    params = Object.fromEntries(u.searchParams);
    delete params.client_id;
  }
  return out;
}

// Выбираем незашифрованный поток: progressive mp3 → hls mp3 → hls aac/opus
async function stream(track) {
  let { transcodings, auth } = track.ref;
  if (!transcodings?.length) {
    const full = await api(`/tracks/${track.ref.id}`);
    transcodings = full.media?.transcodings || [];
    auth = full.track_authorization;
  }
  const rank = (t) => {
    const p = t.format?.protocol;
    const mime = t.format?.mime_type || '';
    if (p === 'progressive') return 0;
    if (p === 'hls' && mime.includes('mpeg')) return 1;
    if (p === 'hls') return 2;
    return 99; // encrypted-hls и прочее не умеем
  };
  const open = transcodings.filter((t) => rank(t) < 99).sort((a, b) => rank(a) - rank(b));
  // Полные потоки впереди, 30-секундные превью — в конце
  const list = [...open.filter((t) => !t.snipped), ...open.filter((t) => t.snipped)];
  if (!list.length) throw new Error('У этого трека в SoundCloud только зашифрованный поток, его нельзя играть в стороннем плеере');
  // У треков от лейблов прямая ссылка mp3 часто отвечает 404, а HLS рядом работает — пробуем по очереди
  let lastErr;
  for (const pick of list) {
    const u = new URL(pick.url);
    u.searchParams.set('client_id', clientId());
    if (auth) u.searchParams.set('track_authorization', auth);
    try {
      const res = await request(u, { headers: headers() });
      if (res?.url) return { url: res.url, hls: pick.format.protocol === 'hls', preview: !!pick.snipped, mime: pick.format.mime_type || '' };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(lastErr?.status === 404 || lastErr?.status === 403
    ? 'SoundCloud не отдаёт этот трек сторонним плеерам'
    : `SoundCloud не отдал поток: ${lastErr?.message || 'пустой ответ'}`);
}


// Похожие треки — для своей волны (renderer/wave.js), когда затравка из SoundCloud
async function related(track) {
  const id = track?.ref?.id || String(track?.id || '').replace(/^sc:/, '');
  if (!id) return [];
  const res = await api(`/tracks/${id}/related`, { limit: 30 });
  return (res.collection || []).map(mapTrack).filter((t) => t && t.playable !== false);
}

// Артисты — это пользователи SoundCloud, у которых есть треки
async function searchArtists(q) {
  const res = await api('/search/users', { q, limit: 20 });
  return (res.collection || []).filter((u) => (u.track_count || 0) > 0).slice(0, 12).map((u) => ({
    id: `sc:${u.id}`, source: 'sc', name: u.username,
    cover: (u.avatar_url || '').replace('-large.', '-t300x300.'),
    followers: u.followers_count || 0, link: u.permalink_url || '',
  }));
}

module.exports = { searchArtists, search, collections, collection, stream, discoverClientId, related };
