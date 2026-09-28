const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && 'error' in r) throw new Error(r.error);
  return r?.ok;
}

function on(channel, cb) {
  const fn = (e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

contextBridge.exposeInMainWorld('tishe', {
  config: {
    get: () => call('cfg:get'),
    set: (patch) => call('cfg:set', patch),
    secret: (key, value) => call('cfg:secret', key, value),
  },
  source: {
    search: (src, q) => call('src:search', src, q),
    searchArtists: (src, q) => call('src:searchArtists', src, q),
    collections: (src) => call('src:collections', src),
    collection: (src, id) => call('src:collection', src, id),
  },
  stream: (track) => call('stream', track),
  albums: {
    list: () => call('albums:list'),
    get: (id) => call('albums:get', id),
    create: (title) => call('albums:create', title),
    rename: (id, title) => call('albums:rename', id, title),
    remove: (id) => call('albums:delete', id),
    add: (id, tracks) => call('albums:add', id, tracks),
    removeTracks: (id, trackIds) => call('albums:removeTracks', id, trackIds),
    move: (id, from, to) => call('albums:move', id, from, to),
    import: (title, tracks) => call('albums:import', title, tracks),
  },
  share: {
    put: (kind, data) => call('share:put', kind, data),
    get: (code) => call('share:get', code),
    public: (code) => call('share:public', code),
    takeLink: () => call('link:take'),
    onLink: (cb) => on('deeplink', cb),
  },
  collab: (op, code, body) => call('collab', op, code, body), // совместные плейлисты (src/account.js)
  meta: {
    edit: (filePath, fields, cover) => call('meta:edit', filePath, fields, cover),
    reset: (filePath) => call('meta:reset', filePath),
    lookup: (query) => call('meta:lookup', query),
    pickCover: () => call('meta:pickCover'),
    apply: (tracks) => call('meta:apply', tracks),
  },
  lyrics: (track) => call('lyrics:get', track),
  censor: { plan: (track) => call('censor:plan', track) },
  artist: {
    info: (name, hintId) => call('artist:info', name, hintId),
    album: (id) => call('artist:album', id),
  },
  account: {
    status: () => call('acc:status'),
    register: (server, login, password, name) => call('acc:register', server, login, password, name),
    login: (server, login, password) => call('acc:login', server, login, password),
    logout: () => call('acc:logout'),
    logoutAll: () => call('acc:logoutAll'),
    me: () => call('acc:me'),
    rename: (name) => call('acc:rename', name),
    avatar: (dataUrl) => call('acc:avatar', dataUrl),
    password: (old, next) => call('acc:password', old, next),
    remove: (password) => call('acc:delete', password),
    sync: () => call('acc:sync'),
    onEvent: (cb) => on('account:event', cb),
  },
  discord: {
    update: (p) => ipcRenderer.send('discord:update', p),
    status: () => call('discord:status'),
  },
  together: {
    create: () => call('tg:create'),
    join: (code) => call('tg:join', code),
    leave: () => call('tg:leave'),
    status: () => call('tg:status'),
    stream: (track) => call('tg:stream', track),
    avatar: (userId, at) => call('tg:avatar', userId, at),
    send: (state, beat) => ipcRenderer.send('tg:send', state, beat),
    react: (e) => ipcRenderer.send('tg:react', e),
    skip: (dir) => ipcRenderer.send('tg:skip', dir), // гость просит переключить трек того, чья очередь
    onEvent: (cb) => on('together:event', cb),
  },
  friends: {
    list: () => call('fr:list'),
    add: (login) => call('fr:add', login),
    accept: (id) => call('fr:accept', id),
    remove: (id) => call('fr:remove', id),
    invite: (id, code) => call('fr:invite', id, code),
    dismiss: (id) => call('fr:dismiss', id),
    knock: (id) => call('fr:knock', id),
    messages: (id, before) => call('fr:messages', id, before),
    profile: (id) => call('fr:profile', id),
    send: (id, body) => call('fr:send', id, body),
    edit: (id, msg, text) => call('fr:edit', id, msg, text),
    react: (id, msg, e) => call('fr:react', id, msg, e),
    unknock: (id) => call('fr:unknock', id),
    avatar: (userId, at) => call('fr:avatar', userId, at),
    now: (p) => ipcRenderer.send('fr:now', p),
  },
  // Остров поверх всех окон (src/island.js): окно плеера шлёт state, остров — action
  island: {
    push: (st) => ipcRenderer.send('island:state', st),
    onAction: (cb) => on('island:action', cb),
    action: (a) => ipcRenderer.send('island:action', a),
    hover: (h) => ipcRenderer.send('island:hover', h),
    log: (...p) => ipcRenderer.send('island:log', ...p), // временно: журнал острова
    onPointer: (cb) => on('island:pointer', cb),
    onState: (cb) => on('island:state', cb),
    onConfig: (cb) => on('island:config', cb),
    onWallConfig: (cb) => on('livewall:config', cb),
    onPreview: (cb) => on('island:preview', cb),
    onDemo: (cb) => on('island:demo', cb), // редактор места: показать раскрытым (src/island.js → editOpen)
    screen: () => call('island:screen'),
    preview: () => ipcRenderer.send('island:preview'),
    edit: () => ipcRenderer.send('island:edit'), // редактор места острова (src/islandedit.js)
    miniHover: (on) => ipcRenderer.send('mini:hover', on),
  },
  // Редактор места острова (renderer/islandedit.html): где капсула сейчас, и «выйти» с новым местом или без
  islandEdit: {
    onInit: (cb) => on('isledit:init', cb),
    onRect: (cb) => on('isledit:rect', cb), // где настоящая капсула на экране (раскрылась, выросла)
    onAccent: (cb) => on('isledit:accent', cb), // акцент играющего трека — им рисуется сетка
    move: (x, y) => ipcRenderer.send('isledit:move', { x, y }),
    open: (on) => ipcRenderer.send('isledit:open', on), // показать остров раскрытым
    raise: () => ipcRenderer.send('isledit:raise'),
    finish: (place) => ipcRenderer.send('isledit:finish', place),
  },
  // Раздел «Остров и окна»: мини-плеер, горячие клавиши, живые обои
  desk: {
    status: () => call('desk:status'),
    miniToggle: () => call('mini:toggle'),
    onChange: (cb) => on('desk:changed', cb),
  },
  // Волна: бесконечный поток под вкус (renderer/wave.js)
  wave: {
    start: (settings) => call('wave:start', settings),
    more: (queue) => call('wave:more', queue),
    feedback: (type, track, played) => call('wave:feedback', type, track, played),
    liked: (fresh) => call('ym:liked', fresh), // id треков из «Мне нравится» Яндекса
    unlike: (track) => call('ym:unlike', track), // убрать из «Мне нравится»
    related: (track) => call('wave:related', track),
  },
  // Скачанные для офлайна: треки лежат на диске вместе с обложкой и текстом
  downloads: {
    add: (tracks) => call('dl:add', tracks),
    remove: (tracks) => call('dl:remove', tracks),
    list: () => call('dl:list'),
    state: () => call('dl:state'),
    onEvent: (cb) => on('cache:changed', cb),
  },
  cache: {
    info: () => call('cache:info'),
    clear: (kind) => call('cache:clear', kind),
    onChange: (cb) => on('cache:changed', cb),
  },
  store: {
    get: (name) => call('store:get', name),
    set: (name, data) => call('store:set', name, data),
    setSync: (name, data) => ipcRenderer.sendSync('store:setSync', name, data),
  },
  sc: { discover: () => call('sc:discover') },
  sp: {
    connect: () => call('sp:connect'),
    disconnect: () => call('sp:disconnect'),
    status: () => call('sp:status'),
    redirect: () => call('sp:redirect'),
  },
  local: {
    addFolder: () => call('local:addFolder'),
    removeFolder: (dir) => call('local:removeFolder', dir),
    scan: () => call('local:scan'),
    openFiles: () => call('local:openFiles'),
    dropped: (files) => call('local:dropped', [...files].map((f) => webUtils.getPathForFile(f))),
    onProgress: (cb) => on('local:progress', cb),
  },
  duck: {
    onMeter: (cb) => on('duck:meter', cb),
    onStatus: (cb) => on('duck:status', cb),
    setLevel: (level) => ipcRenderer.send('duck:level', level),
  },
  win: {
    action: (a) => ipcRenderer.send('win', a),
    onState: (cb) => on('win:state', cb),
    onReveal: (cb) => on('win:reveal', cb),
    onMoving: (cb) => on('win:moving', cb), // окно тащат — анимации замирают (main.js)
    // Кнопки в превью окна на панели задач
    thumbState: (st) => ipcRenderer.send('thumb:state', st),
    onThumb: (cb) => on('thumb', cb),
  },
  app: { version: () => call('app:version') },
  // автообновления: state — idle | checking | none | downloading | ready | error | dev (src/updater.js)
  update: {
    status: () => call('update:status'),
    check: () => call('update:check'),
    install: () => call('update:install'),
    onEvent: (cb) => on('update:event', cb),
  },
  admin: {
    overview: () => call('adm:overview'),
    users: (q) => call('adm:users', q),
    kick: (id) => call('adm:kick', id),
    ban: (id, banned) => call('adm:ban', id, banned),
    rename: (id, name) => call('adm:rename', id, name),
    announce: (text, track) => call('adm:announce', text, track),
    notify: (id, text) => call('adm:notify', id, text),
  },
  announcement: () => call('acc:announcement'),
  popup: { rect: (r) => ipcRenderer.send('popup:rect', r) }, // всплывающие окна: где панель (src/hover.js)
  openExternal: (url) => ipcRenderer.send('open:external', url),
  copy: (text) => call('clipboard:write', text),
  // Эквалайзер в своём окне (src/eqpop.js)
  eqpop: {
    toggle: (rect, payload) => ipcRenderer.send('eqpop:toggle', rect, payload),
    close: () => ipcRenderer.send('eqpop:close'),
    hover: (on) => ipcRenderer.send('eqpop:hover', on),
    refresh: () => ipcRenderer.send('eqpop:refresh'),
    live: (eq) => ipcRenderer.send('eqpop:live', eq),
    action: (a) => ipcRenderer.send('eqpop:action', a),
    onOpen: (cb) => on('eqpop:open', cb),
    onRefresh: (cb) => on('eqpop:refresh', cb),
    onLive: (cb) => on('eqpop:live', cb),
    onShown: (cb) => on('eqpop:shown', cb),
    onAction: (cb) => on('eqpop:action', cb),
  },
});
