const { app, BrowserWindow, ipcMain, dialog, shell, session, protocol, Menu, clipboard, screen } = require('electron');
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
const games = require('./src/games');
const friends = require('./src/friends');
const discord = require('./src/discord');
const eqpop = require('./src/eqpop');
const island = require('./src/island');
const mini = require('./src/mini');
const tray = require('./src/tray');
const hotkeys = require('./src/hotkeys');
const livewall = require('./src/livewall');
const resolve = require('./src/resolve');
const cache = require('./src/cache');
const cacheFiles = require('./src/cache-files');

const { resolveStream, sharedStream, matchCache } = resolve;
resolve.init(local);

const SOURCES = { sc, ym, sp };
const MIME = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.jpg': 'image/jpeg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm', '.weba': 'audio/webm',
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

// Живые обои висят за иконками рабочего стола — Windows считает такое окно закрытым, и Chromium
// перестаёт его рисовать (спектр и строка текста замирают). Проверку перекрытия выключаем
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let quitting = false; // «Выйти» из трея: крестик больше не прячет окно в трей

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 740,
    minWidth: 920,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1b1411',
    title: 'авеон',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'), // панель задач и Alt+Tab (и при npm start)
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
  // Крестик при «закрывать в трей» только прячет окно — музыка играет дальше
  win.on('close', (e) => {
    if (!quitting && tray.closeToTray()) { e.preventDefault(); win.hide(); }
  });
  // остров, мини-плеер и обои не держат приложение открытым
  win.on('closed', () => { island.destroy(); mini.destroy(); livewall.destroy(); });
  island.init(win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

// Кнопки окна прячутся и проявляются у правого верхнего угла. Над областями перетаскивания окно
// не получает движение мыши, поэтому где курсор — смотрим отсюда
const WIN_ZONE = { w: 240, h: 64 };
let winReveal = false;
setInterval(() => {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || config.get().ui?.autoHideWin === false) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getContentBounds();
  const on = p.y >= b.y && p.y < b.y + WIN_ZONE.h && p.x >= b.x + b.width - WIN_ZONE.w && p.x < b.x + b.width;
  if (on !== winReveal) { winReveal = on; send('win:reveal', on); }
}, 120);

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// media://local/?p=<путь>  — аудиофайл с поддержкой Range (перемотка)
// media://cover/?p=<путь>  — обложка из тегов
// media://art/?f=<имя>     — своя обложка, заданная в редакторе тегов
// media://cache/?f=<имя>   — трек из кэша (src/cache.js)
function registerMediaProtocol() {
  protocol.handle('media', async (req) => {
    const u = new URL(req.url);
    if (u.hostname === 'art') {
      const art = local.readArt(u.searchParams.get('f'));
      if (!art) return new Response('no art', { status: 404 });
      return new Response(art.data, { headers: { 'Content-Type': art.type, 'Cache-Control': 'max-age=31536000', 'Access-Control-Allow-Origin': '*' } });
    }
    if (u.hostname === 'cache') {
      const f = cacheFiles.fileOf(u.searchParams.get('f'));
      return f ? serveFile(f, req) : new Response('forbidden', { status: 403 });
    }
    const p = u.searchParams.get('p') || '';
    if (!local.allowed.has(p)) return new Response('forbidden', { status: 403 });

    if (u.hostname === 'cover') {
      const pic = await local.coverOf(p).catch(() => null);
      if (!pic) return new Response('no cover', { status: 404 });
      return new Response(pic.data, { headers: { 'Content-Type': pic.type, 'Cache-Control': 'max-age=86400', 'Access-Control-Allow-Origin': '*' } });
    }
    return serveFile(p, req);
  });
}

// Аудиофайл с поддержкой Range — без неё не работает перемотка
async function serveFile(p, req) {
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
    if (patch.discord) discord.settingsChanged();
    if (patch.friends) friends.settingsChanged();
    if (patch.cache) cache.settingsChanged();
    if (patch.island) { island.settingsChanged(); tray.refresh(true); }
    if (patch.mini) mini.settingsChanged();
    if (patch.tray) tray.settingsChanged();
    if (patch.hotkeys) hotkeys.settingsChanged();
    if (patch.livewall) livewall.settingsChanged();
    return config.publicView();
  });
  handle('cfg:secret', (key, value) => {
    config.setSecret(key, value);
    if (key === 'ym.token') ym.reset();
    matchCache.clear();
    return config.publicView();
  });

  handle('src:search', (source, q) => SOURCES[source].search(q));
  handle('src:searchArtists', (source, q) => SOURCES[source].searchArtists(q));
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
    local.allowFiles(tracks.filter((t) => t.source === 'local' && t.ref?.path).map((t) => t.ref.path));
    return albums.addTracks(id, tracks);
  });
  handle('albums:removeTracks', (id, trackIds) => albums.removeTracks(id, trackIds));
  handle('albums:move', (id, from, to) => albums.moveTrack(id, from, to));
  handle('albums:import', (title, tracks) => albums.importAlbum(title, tracks));

  // Поделиться: короткий код на сервере аккаунтов
  handle('share:put', (kind, data) => account.sharePut(kind, data));
  handle('share:get', (code) => account.shareGet(code));

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
  handle('acc:register', (server, login, password, name) => { friends.reset(); return account.register(server, login, password, name); });
  handle('acc:login', (server, login, password) => { friends.reset(); return account.login(server, login, password); });
  handle('acc:logoutAll', () => account.logoutAll());
  handle('acc:me', () => account.me());
  handle('acc:rename', (name) => account.rename(name));
  handle('acc:avatar', (dataUrl) => account.setAvatar(dataUrl));
  handle('acc:password', (old, next) => account.changePassword(old, next));
  handle('acc:delete', (password) => { friends.reset(); return account.remove(password); });
  handle('acc:sync', () => account.sync());
  handle('acc:logout', async () => { together.leave(); await friends.offline(); return account.logout(); });

  // Слушать вместе
  handle('tg:create', () => together.create());
  handle('tg:join', (code) => together.join(code));
  handle('tg:leave', () => together.leave());
  handle('tg:status', () => together.status());
  handle('tg:stream', (track) => sharedStream(track));
  handle('tg:avatar', (userId, at) => account.avatarOf(userId, at));
  ipcMain.on('tg:send', (e, state, beat) => together.send(state, beat));

  // Друзья: заявки по логину и что они слушают
  handle('fr:list', () => friends.list());
  handle('fr:add', (login) => friends.add(login));
  handle('fr:accept', (id) => friends.accept(id));
  handle('fr:remove', (id) => friends.remove(id));
  handle('fr:invite', (id, code) => friends.invite(id, code));
  handle('fr:dismiss', (id) => friends.dismiss(id));
  handle('fr:knock', (id) => friends.knock(id));
  handle('fr:messages', (id, before) => friends.messages(id, before));
  handle('fr:profile', (id) => friends.profile(id));

  // Версия (для «Что нового»), админка и объявление
  handle('app:version', () => app.getVersion());
  handle('adm:overview', () => account.adminApi.overview());
  handle('adm:users', (q) => account.adminApi.users(q));
  handle('adm:kick', (id) => account.adminApi.kick(id));
  handle('adm:ban', (id, banned) => account.adminApi.ban(id, banned));
  handle('adm:rename', (id, name) => account.adminApi.rename(id, name));
  handle('adm:announce', (text, track) => account.adminApi.announce(text, track));
  handle('adm:notify', (id, text) => account.adminApi.notify(id, text));
  handle('acc:announcement', () => account.announcement());
  handle('fr:send', (id, body) => friends.send(id, body));
  handle('fr:unknock', (id) => friends.unknock(id));
  handle('fr:avatar', (userId, at) => account.avatarOf(userId, at));
  ipcMain.on('fr:now', (e, p) => friends.now(p));

  // Эквалайзер в своём окне (src/eqpop.js). Попап сохраняет настройки сам (cfg:set), а окну плеера
  // пересылает их для звука; «поделиться» и «вставить код» делает окно плеера
  ipcMain.on('eqpop:toggle', (e, rect, payload) => eqpop.toggle(win, rect, payload));
  ipcMain.on('eqpop:close', () => eqpop.hide());
  ipcMain.on('eqpop:hover', (e, on) => eqpop.hover(!!on));
  ipcMain.on('eqpop:refresh', () => eqpop.refresh());
  ipcMain.on('eqpop:live', (e, eq) => send('eqpop:live', eq));
  ipcMain.on('eqpop:action', (e, action) => { eqpop.hide(); send('eqpop:action', action); });


  // Волна: «Моя волна» Яндекса и похожие треки SoundCloud для своей волны (renderer/wave.js)
  handle('wave:start', (settings) => ym.waveStart(settings));
  handle('wave:more', (queue) => ym.waveMore(queue));
  handle('wave:feedback', (type, track, played) => ym.waveFeedback(type, track, played));
  handle('wave:related', (track) => (track?.source === 'sc' ? sc.related(track) : []));

  // Кэш треков и текстов: сколько занимает, очистка
  handle('cache:info', () => cache.info());
  handle('cache:clear', (kind) => { if (kind === 'downloads' || kind === 'all') resolve.cancelDownloads(); return cache.clear(kind); });

  // Скачанные для офлайна (src/resolve.js → download, src/cache.js → pinned)
  handle('dl:add', (tracks) => resolve.download(tracks));
  handle('dl:remove', async (tracks) => { for (const t of tracks) await cache.unpin(t); return true; });
  handle('dl:list', () => cache.downloads());
  handle('dl:state', () => ({ done: cache.downloadedKeys(), pending: resolve.pendingDownloads() }));

  // Остров поверх всех окон (src/island.js): состояние — из окна плеера, кнопки — обратно в него
  ipcMain.on('island:state', (e, st) => {
    island.state(st);
    mini.state(st);
    livewall.state(st);
    tray.state(st);
  });
  ipcMain.on('island:hover', (e, on) => island.hover(!!on));
  ipcMain.on('mini:hover', (e, on) => mini.hover(!!on));
  // где у всплывающего окна панель — по ней src/hover.js сам решает, ловить ли мышь
  ipcMain.on('popup:rect', (e, r) => require('./src/hover').setRect(BrowserWindow.fromWebContents(e.sender), r));
  ipcMain.on('island:action', (e, a) => {
    if (a?.type === 'focus') { showWindow(); return; }
    if (a?.type === 'mini-close') { mini.close(); return; }
    send('island:action', a);
  });

  // Остров, мини-плеер, трей, горячие клавиши, живые обои — для раздела «Остров и окна»
  handle('desk:status', () => ({ hotkeys: hotkeys.status(), livewall: livewall.status(), mini: mini.isOpen() }));
  handle('mini:toggle', () => { mini.toggle(); return mini.isOpen(); });
  handle('island:screen', () => island.screenInfo());
  ipcMain.on('island:preview', () => island.preview());

  // Discord: что сейчас играет
  ipcMain.on('discord:update', (e, p) => discord.update(p));
  handle('discord:status', () => discord.status());

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
  // Буфер обмена — через главный процесс: navigator.clipboard в окне упирается в запрет разрешений (allowMicOnly)
  handle('clipboard:write', (text) => { clipboard.writeText(String(text ?? '').slice(0, 1024 * 1024)); return true; });
  ipcMain.on('win', (e, action) => {
    if (!win) return;
    if (action === 'min') win.minimize();
    if (action === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
    if (action === 'close') win.close();
    if (action === 'fullscreen-on') win.setFullScreen(true);
    if (action === 'fullscreen-off') win.setFullScreen(false);
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && !win.isMinimized() && win.isFocused()) win.hide();
  else showWindow();
}

function toggleIsland() {
  const on = config.get().island?.enabled !== false;
  config.set({ island: { enabled: !on } });
  island.settingsChanged();
  tray.refresh(true);
  send('desk:changed');
}

// Трей и глобальные клавиши зовут одни и те же действия
const deskActions = {
  thumb: (a) => send('thumb', a),
  barrel: () => send('island:action', { type: 'barrel' }),
  mini: () => { mini.toggle(); tray.refresh(true); send('desk:changed'); },
  miniOpen: () => mini.isOpen(),
  island: toggleIsland,
  islandOn: () => config.get().island?.enabled !== false,
  show: showWindow,
  toggleWindow,
  quit: () => { quitting = true; app.quit(); },
};

app.on('before-quit', () => { quitting = true; });

app.on('second-instance', () => {
  if (!win) return;
  showWindow();
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
  duck.start((m) => { games.foreground(m.fg); send('duck:meter', m); }, (s) => send('duck:status', s)); // fg — активное окно (src/games.js)
  together.init((ev) => send('together:event', ev));
  cache.init(cacheFiles, (ev) => send('cache:changed', ev)).catch((e) => console.warn('cache init:', e.message));
  eqpop.init((open) => send('eqpop:shown', open));
  discord.init();
  friends.init();
  tray.init(deskActions);
  mini.init(win, () => { tray.refresh(true); send('desk:changed'); });
  livewall.init(() => send('desk:changed'));
  hotkeys.init({
    play: () => send('thumb', 'toggle'),
    next: () => send('thumb', 'next'),
    prev: () => send('thumb', 'prev'),
    barrel: deskActions.barrel,
    show: toggleWindow,
    mini: deskActions.mini,
    island: toggleIsland,
    volUp: () => send('island:action', { type: 'volume', delta: 0.05 }),
    volDown: () => send('island:action', { type: 'volume', delta: -0.05 }),
  });
  account.init((ev) => {
    if (ev.changed?.albums) local.allowFiles(albums.localPaths());
    if (ev.changed?.settings) duck.setTargets(config.get().duck.targets);
    send('account:event', ev);
  });
});

app.on('window-all-closed', async () => {
  eqpop.destroy();
  hotkeys.destroy();
  tray.destroy();
  duck.stop();
  discord.stop();
  config.flush();
  // друзья сразу видят, что плеер закрыт; сеть не отвечает — не держим выход дольше секунды
  await Promise.race([friends.offline(), new Promise((r) => setTimeout(r, 1000))]);
  app.quit();
});
