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
  },
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
    onEvent: (cb) => on('together:event', cb),
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
    // Кнопки в превью окна на панели задач
    thumbState: (st) => ipcRenderer.send('thumb:state', st),
    onThumb: (cb) => on('thumb', cb),
  },
  openExternal: (url) => ipcRenderer.send('open:external', url),
  copy: (text) => call('clipboard:write', text),
  // Эквалайзер в своём окне (src/eqpop.js)
  eqpop: {
    toggle: (rect, payload) => ipcRenderer.send('eqpop:toggle', rect, payload),
    close: () => ipcRenderer.send('eqpop:close'),
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
