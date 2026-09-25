const { app, BrowserWindow, ipcMain, dialog, shell, session, protocol, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const config = require('./src/config');
const duck = require('./src/duck');
const local = require('./src/services/local');
const sc = require('./src/services/soundcloud');
const ym = require('./src/services/yandex');
const sp = require('./src/services/spotify');
const albums = require('./src/albums');
const store = require('./src/store');
const texts = require('./src/services/texts');
const thumbar = require('./src/thumbar');
const censor = require('./src/censor');
const account = require('./src/account');
const together = require('./src/together');

const SOURCES = { sc, ym, sp };
const MIME = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm', '.weba': 'audio/webm',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Приложение называлось «Тише»: переносим настройки, токены и альбомы в папку «авеон»
(function migrateUserData() {
  const now = app.getPath('userData');
  const old = path.join(app.getPath('appData'), 'Тише');
  if (now === old || fs.existsSync(path.join(now, 'config.json')) || !fs.existsSync(old)) return;
  try {
    fs.mkdirSync(now, { recursive: true });
    for (const name of ['config.json', 'albums.json', 'library.json', 'meta.json', 'session.json', 'stats.json']) {
      const from = path.join(old, name);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(now, name));
    }
    if (fs.existsSync(path.join(old, 'covers'))) fs.cpSync(path.join(old, 'covers'), path.join(now, 'covers'), { recursive: true });
  } catch (e) {
    console.warn('migrate userData:', e.message);
  }
})();

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 740,
    minWidth: 920,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1b1411',
    title: 'авеон',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false, // приглушение должно работать и в свёрнутом окне
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    thumbar.update(win, (action) => send('thumb', action)); // кнопки ставятся только на показанное окно
  });
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
  win.on('leave-full-screen', () => win.webContents.send('win:state', { fullscreen: false }));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// media://local/?p=<путь>  — аудиофайл с поддержкой Range (перемотка)
// media://cover/?p=<путь>  — обложка из тегов
// media://art/?f=<имя>     — своя обложка, заданная в редакторе тегов
function registerMediaProtocol() {
  protocol.handle('media', async (req) => {
    const u = new URL(req.url);
    if (u.hostname === 'art') {
      const art = local.readArt(u.searchParams.get('f'));
      if (!art) return new Response('no art', { status: 404 });
      return new Response(art.data, { headers: { 'Content-Type': art.type, 'Cache-Control': 'max-age=31536000', 'Access-Control-Allow-Origin': '*' } });
    }
    const p = u.searchParams.get('p') || '';
    if (!local.allowed.has(p)) return new Response('forbidden', { status: 403 });

    if (u.hostname === 'cover') {
      const pic = await local.coverOf(p).catch(() => null);
      if (!pic) return new Response('no cover', { status: 404 });
      return new Response(pic.data, { headers: { 'Content-Type': pic.type, 'Cache-Control': 'max-age=86400', 'Access-Control-Allow-Origin': '*' } });
    }

    let size;
    try { size = (await fs.promises.stat(p)).size; } catch { return new Response('not found', { status: 404 }); }
    const type = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.get('range');
    const m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m && (m[1] || m[2])) {
      let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
      let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      return new Response(Readable.toWeb(fs.createReadStream(p, { start, end })), {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(p)), {
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' },
    });
  });
}

// CDN музыкальных сервисов не присылают CORS-заголовки, а без них Web Audio (эквалайзер, визуализатор,
// приглушение) получает тишину. Добавляем заголовок к медиа, картинкам и HLS-сегментам.
// Разрешаем только микрофон (без камеры и экрана) — для детектора твоего голоса
function allowMicOnly() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const types = details.mediaTypes || [];
    cb(permission === 'media' && types.length > 0 && types.every((t) => t === 'audio'));
  });
  ses.setPermissionCheckHandler((wc, permission) => permission === 'media');
}

function allowCors() {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (!/^https?:/.test(details.url) || !['media', 'image', 'xhr', 'other'].includes(details.resourceType)) {
      cb({});
      return;
    }
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (k.toLowerCase() === 'access-control-allow-origin') delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    cb({ responseHeaders: headers });
  });
}

// ---- Сопоставление трека Spotify с потоком из Яндекс Музыки / SoundCloud ----

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

async function resolveStream(track) {
  if (track.source === 'local') {
    local.allowFiles([track.ref.path]);
    return { url: `media://local/?p=${encodeURIComponent(track.ref.path)}`, hls: false };
  }
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
  let m;
  try {
    m = await matchTrack(track);
  } catch (e) {
    if (/подключи/i.test(e.message)) throw new Error('Чтобы слушать вместе, подключи Яндекс Музыку или SoundCloud — через них плеер находит трек друга');
    throw e;
  }
  const st = await SOURCES[m.source].stream(m);
  return { ...st, cover: m.cover, via: { source: m.source, title: m.title, artist: m.artist, label: `У друга ${FROM[track.source] || ''}, звучит через ${NAMES_RU[m.source]}` } };
}

// ---- IPC ----

// Ошибки отдаём как { error }, чтобы в окне был понятный текст без «Error invoking remote method»
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    try { return { ok: await fn(...args) }; } catch (err) { return { error: err?.message || String(err) }; }
  });
}

function registerIpc() {
  handle('cfg:get', () => config.publicView());
  handle('cfg:set', (patch) => {
    config.set(patch);
    if (patch.duck?.targets) duck.setTargets(config.get().duck.targets);
    account.settingsChanged(patch);
    return config.publicView();
  });
  handle('cfg:secret', (key, value) => {
    config.setSecret(key, value);
    if (key === 'ym.token') ym.reset();
    matchCache.clear();
    return config.publicView();
  });

  handle('src:search', (source, q) => SOURCES[source].search(q));
  handle('src:collections', (source) => SOURCES[source].collections());
  handle('src:collection', (source, id) => SOURCES[source].collection(id));
  handle('stream', (track) => resolveStream(track));

  handle('albums:list', () => albums.list());
  handle('albums:get', (id) => {
    const a = albums.get(id);
    return { ...a, tracks: a.tracks.map(local.applyOverride) }; // свои теги видны и в альбомах
  });
  handle('albums:create', (title) => albums.create(title));
  handle('albums:rename', (id, title) => albums.rename(id, title));
  handle('albums:delete', (id) => albums.remove(id));
  handle('albums:add', (id, tracks) => {
    local.allowFiles(tracks.filter((t) => t.source === 'local').map((t) => t.ref.path));
    return albums.addTracks(id, tracks);
  });
  handle('albums:removeTracks', (id, trackIds) => albums.removeTracks(id, trackIds));
  handle('albums:move', (id, from, to) => albums.moveTrack(id, from, to));

  handle('sc:discover', () => sc.discoverClientId());
  handle('sp:connect', () => sp.connect());
  handle('sp:disconnect', () => sp.disconnect());
  handle('sp:status', () => sp.status());
  handle('sp:redirect', () => sp.REDIRECT);

  handle('local:addFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'], title: 'Папки с музыкой' });
    if (r.canceled) return null;
    const folders = [...new Set([...config.get().localFolders, ...r.filePaths])];
    config.set({ localFolders: folders });
    return folders;
  });
  handle('local:removeFolder', (dir) => {
    const folders = config.get().localFolders.filter((f) => f !== dir);
    config.set({ localFolders: folders });
    return folders;
  });
  handle('local:scan', () => local.scan((done, total) => send('local:progress', { done, total })));
  handle('local:openFiles', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Аудио', extensions: [...local.EXT].map((e) => e.slice(1)) }],
    });
    return r.canceled ? [] : local.filesToTracks(r.filePaths);
  });
  handle('local:dropped', (paths) => local.filesToTracks(paths.filter((p) => local.EXT.has(path.extname(p).toLowerCase()))));

  // Редактор тегов своих файлов
  handle('meta:edit', (filePath, fields, cover) => local.editMeta(filePath, fields, cover));
  handle('meta:reset', (filePath) => local.resetMeta(filePath));
  handle('meta:lookup', (query) => local.lookup(query));
  handle('meta:pickCover', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Обложка трека',
      properties: ['openFile'],
      filters: [{ name: 'Картинки', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    const type = local.COVER_TYPES[path.extname(p).toLowerCase()];
    if (!type) throw new Error('Обложка должна быть в формате JPG, PNG или WEBP');
    const buf = await fs.promises.readFile(p);
    if (buf.length > 15 * 1024 * 1024) throw new Error('Картинка больше 15 МБ');
    local.allowCoverPick(p);
    return { path: p, preview: `data:${type};base64,${buf.toString('base64')}` };
  });
  // Снимки треков из сессии/статистики — со своими тегами
  handle('meta:apply', (tracks) => tracks.map(local.applyOverride));

  handle('lyrics:get', (track) => texts.find(track)); // Musixmatch по словам → LRCLIB → …
  handle('censor:plan', (track) => censor.plan(track));
  // Дискография артиста — из Яндекс Музыки, если она подключена
  handle('artist:info', (name, hintId) => (config.getSecret('ym.token') ? ym.artistByName(name, hintId) : null));
  handle('artist:album', (id) => ym.album(String(id).replace(/^ym:/, '')));

  // Аккаунт и синхронизация
  handle('acc:status', () => account.status());
  handle('acc:register', (server, login, password, name) => account.register(server, login, password, name));
  handle('acc:login', (server, login, password) => account.login(server, login, password));
  handle('acc:logoutAll', () => account.logoutAll());
  handle('acc:me', () => account.me());
  handle('acc:rename', (name) => account.rename(name));
  handle('acc:password', (old, next) => account.changePassword(old, next));
  handle('acc:delete', (password) => account.remove(password));
  handle('acc:sync', () => account.sync());
  handle('acc:logout', async () => { together.leave(); return account.logout(); });

  // Слушать вместе
  handle('tg:create', () => together.create());
  handle('tg:join', (code) => together.join(code));
  handle('tg:leave', () => together.leave());
  handle('tg:status', () => together.status());
  handle('tg:stream', (track) => sharedStream(track));
  ipcMain.on('tg:send', (e, state, beat) => together.send(state, beat));

  // Где остановился и статистика прослушивания
  handle('store:get', (name) => {
    const data = store.read(name);
    if (name === 'session' && data?.queue) local.allowFiles(data.queue.filter((t) => t.source === 'local').map((t) => t.ref.path));
    return data;
  });
  handle('store:set', (name, data) => store.write(name, data));
  // При закрытии окно успевает только отправить сообщение — пишем синхронно
  ipcMain.on('store:setSync', (e, name, data) => {
    try { store.write(name, data); } catch {}
    e.returnValue = true;
  });

  ipcMain.on('thumb:state', (e, st) => thumbar.update(win, (action) => send('thumb', action), {
    playing: !!st?.playing,
    hasTrack: !!st?.hasTrack,
  }));
  ipcMain.on('duck:level', (e, level) => duck.setDuck(level));
  ipcMain.on('open:external', (e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.on('win', (e, action) => {
    if (!win) return;
    if (action === 'min') win.minimize();
    if (action === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
    if (action === 'close') win.close();
    if (action === 'fullscreen-on') win.setFullScreen(true);
    if (action === 'fullscreen-off') win.setFullScreen(false);
  });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.aveon.player');
  config.load();
  local.loadCache();
  albums.load();
  local.allowFiles(albums.localPaths()); // обложки и файлы из альбомов доступны сразу
  registerMediaProtocol();
  allowCors();
  allowMicOnly();
  registerIpc();
  createWindow();
  duck.setTargets(config.get().duck.targets);
  duck.start((m) => send('duck:meter', m), (s) => send('duck:status', s));
  together.init((ev) => send('together:event', ev));
  account.init((ev) => {
    if (ev.changed?.albums) local.allowFiles(albums.localPaths());
    if (ev.changed?.settings) duck.setTargets(config.get().duck.targets);
    send('account:event', ev);
  });
});

app.on('window-all-closed', () => {
  duck.stop();
  config.flush();
  app.quit();
});
