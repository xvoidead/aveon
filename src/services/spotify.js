// Spotify как источник библиотеки: поиск, «Любимые треки», плейлисты.
// Аудиопоток Spotify сторонним плеерам не отдаёт, поэтому звучит трек в самом «авеоне»:
// плеер находит его в Яндекс Музыке или SoundCloud (см. resolveStream в main.js).
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const config = require('../config');
const { request, HttpError } = require('./http');

const PORT = 43821;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'user-library-read playlist-read-private playlist-read-collaborative';

function clientId() {
  const id = config.get().sp.clientId;
  if (!id) throw new Error('Укажи Client ID приложения Spotify в настройках');
  return id;
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function saveTokens(t) {
  config.setSecret('sp.access', t.access_token);
  if (t.refresh_token) config.setSecret('sp.refresh', t.refresh_token);
  config.set({ sp: { expires: Date.now() + (t.expires_in - 60) * 1000 } });
}

let loginServer = null;

// Authorization Code + PKCE через локальный редирект на 127.0.0.1
function connect() {
  const cid = clientId();
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  if (loginServer) loginServer.close();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { finish(); reject(new Error('Время на вход в Spotify истекло')); }, 5 * 60 * 1000);
    const finish = () => { clearTimeout(timer); loginServer?.close(); loginServer = null; };
    const page = (msg) => `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div>${msg}</div>`;

    loginServer = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const html = { 'Content-Type': 'text/html; charset=utf-8' };
      if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) {
        res.writeHead(400, html).end(page('Вход отменён. Вкладку можно закрыть.'));
        finish();
        reject(new Error(u.searchParams.get('error') || 'Вход в Spotify отменён'));
        return;
      }
      let tokens;
      try {
        tokens = await request('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: u.searchParams.get('code'),
            redirect_uri: REDIRECT,
            client_id: cid,
            code_verifier: verifier,
          }).toString(),
        });
      } catch (e) {
        res.writeHead(500, html).end(page('Ошибка: ' + e.message));
        finish();
        reject(e);
        return;
      }
      // Ответ браузеру уходит один раз; профиль грузим уже после — его ошибка идёт в плеер, а не второй ответ
      saveTokens(tokens);
      res.writeHead(200, html).end(page('Spotify подключён — возвращайся в «авеон»'));
      finish();
      profile().then(resolve, reject);
    });
    loginServer.on('error', (e) => { finish(); reject(e); });
    loginServer.listen(PORT, '127.0.0.1', () => {
      const auth = new URL('https://accounts.spotify.com/authorize');
      auth.search = new URLSearchParams({
        client_id: cid,
        response_type: 'code',
        redirect_uri: REDIRECT,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        scope: SCOPES,
        state,
      }).toString();
      shell.openExternal(auth.toString());
    });
  });
}

function disconnect() {
  config.setSecret('sp.access', '');
  config.setSecret('sp.refresh', '');
  config.set({ sp: { expires: 0 } });
}

async function accessToken() {
  const access = config.getSecret('sp.access');
  if (access && Date.now() < config.get().sp.expires) return access;
  const refresh = config.getSecret('sp.refresh');
  if (!refresh) throw new Error('Spotify не подключён — нажми «Войти через Spotify» в настройках');
  const t = await request('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId() }).toString(),
  });
  saveTokens(t);
  return t.access_token;
}

async function api(pathname, params) {
  const u = new URL('https://api.spotify.com/v1' + pathname);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  return request(u, { headers: { Authorization: `Bearer ${await accessToken()}` } });
}

function mapTrack(t) {
  if (!t || !t.uri || t.type !== 'track') return null;
  const images = t.album?.images || [];
  return {
    id: `sp:${t.id || t.uri}`,
    source: 'sp',
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album?.name || '',
    duration: Math.round((t.duration_ms || 0) / 1000),
    cover: (images.find((i) => i.width && i.width <= 320) || images[0])?.url || '',
    link: t.external_urls?.spotify || '',
    playable: !t.is_local,
    explicit: t.explicit === true, // 18+
    ref: { uri: t.uri, isrc: t.external_ids?.isrc || '' },
  };
}

async function profile() {
  let me;
  try {
    me = await api('/me');
  } catch (e) {
    // Приложение Spotify в режиме разработки пускает только добавленных в него людей — остальным 403 на всё
    if (e.status === 403) {
      disconnect();
      throw new Error('Spotify не пускает этот аккаунт: добавь его на developer.spotify.com → твоё приложение → User Management (имя и почта от Spotify)');
    }
    throw e;
  }
  return { name: me.display_name || me.id };
}

async function search(q) {
  const res = await api('/search', { q, type: 'track', limit: 50 });
  return res.tracks.items.map(mapTrack).filter(Boolean);
}

async function paged(first, pick, max = 2000) {
  const out = [];
  let url = first;
  while (url && out.length < max) {
    const u = new URL(url);
    const res = await api(u.pathname.replace(/^\/v1/, ''), Object.fromEntries(u.searchParams));
    out.push(...pick(res));
    url = res.next;
  }
  return out;
}

async function collections() {
  const lists = await paged('https://api.spotify.com/v1/me/playlists?limit=50', (r) => r.items, 200);
  return [
    { id: 'likes', title: 'Любимые треки', icon: 'heart' },
    ...lists.filter(Boolean).map((p) => ({
      id: `pl:${p.id}`,
      title: p.name,
      count: p.tracks?.total ?? p.items?.total,
      cover: p.images?.[p.images.length - 1]?.url || '',
    })),
  ];
}

async function collection(id) {
  if (id === 'likes') {
    return paged('https://api.spotify.com/v1/me/tracks?limit=50', (r) => r.items.map((x) => mapTrack(x.track)).filter(Boolean));
  }
  if (id.startsWith('pl:')) {
    const pid = id.slice(3);
    // Spotify переименовал /tracks → /items у плейлистов; пробуем оба варианта
    try {
      return await paged(`https://api.spotify.com/v1/playlists/${pid}/items?limit=100`, (r) => r.items.map((x) => mapTrack(x.item || x.track)).filter(Boolean));
    } catch (e) {
      if (!(e instanceof HttpError) || (e.status !== 404 && e.status !== 403)) throw e;
      return paged(`https://api.spotify.com/v1/playlists/${pid}/tracks?limit=100`, (r) => r.items.map((x) => mapTrack(x.track)).filter(Boolean));
    }
  }
  throw new Error('Неизвестная коллекция');
}

async function status() {
  if (!config.getSecret('sp.refresh')) return { connected: false };
  try { return { connected: true, ...(await profile()) }; } catch (e) { return { connected: false, error: e.message }; }
}

// clientId, saveTokens, profile, SCOPES — для входа через ссылку aveon:// на Android (mobile/bridge)
async function searchArtists(q) {
  const res = await api('/search', { q, type: 'artist', limit: 12 });
  return (res.artists?.items || []).map((a) => ({
    id: `sp:${a.id}`, source: 'sp', name: a.name,
    cover: (a.images || []).slice(-2)[0]?.url || a.images?.[0]?.url || '',
    followers: a.followers?.total || 0, link: a.external_urls?.spotify || '',
  }));
}

module.exports = { searchArtists, connect, disconnect, status, search, collections, collection, REDIRECT, SCOPES, clientId, saveTokens, profile };
