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
});
