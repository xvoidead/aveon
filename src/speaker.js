// Колонка: Яндекс Станция Лайт 2 играет треки авеона. Колонка не умеет TLS и не достаёт до аудио-CDN SoundCloud,
// поэтому звук отдаёт этот компьютер: локальный сервер на 127.0.0.1 и обратный SSH-туннель (колонка ходит на свой
// 127.0.0.1:REMOTE_PORT), правило брандмауэра не нужно. Управление по SSH: запуск плеера и громкость (speaker-core.js).
// Настройки: config.speaker { host, level } (раздел «Колонка» в окне). Кнопка в плеере: renderer/speaker.js
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const config = require('./config');
const core = require('./speaker-core');

const STREAM_TTL = 60000; // подписанные ссылки сервисов живут минуты: найденный поток держим меньше
const SSH_TIMEOUT = 25000;

let deps = null; // { resolveStream, cacheFiles, local } из main.js
let server = null;
let port = 0;
let tunnel = null; // { proc, host, port }
let session = null; // { token, track, stream, streamAt, segs } — играет один трек, новый заменяет прежний

function init(d) { deps = d; }

const cfg = () => config.get().speaker || {};

function hostOrThrow() {
  const { host } = cfg();
  if (!host) throw new Error('Колонка не задана: speaker.host в настройках (имя из ~/.ssh/config или адрес)');
  if (!core.validHost(host)) throw new Error('speaker.host: недопустимое имя');
  return host;
}

// ---- ssh ----

// Выполнить скрипт на колонке. Скрипт идёт в stdin, потому что кавычки для удалённой оболочки не нужны
function ctl(host, script) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ssh', core.controlArgs(host), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Колонка не ответила по SSH')); }, SSH_TIMEOUT);
    proc.stdout.on('data', (b) => { out += b; });
    proc.stderr.on('data', (b) => { err = (err + b).slice(-400); });
    proc.stdin.on('error', () => {});
    proc.once('error', (e) => { clearTimeout(timer); reject(new Error('ssh не запустился: ' + e.message)); });
    proc.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || out.trim()) resolve(out);
      else reject(new Error(`SSH к колонке: код ${code} ${err.trim()}`));
    });
    proc.stdin.end(script);
  });
}

function closeTunnel() {
  if (!tunnel) return;
  tunnel.proc.kill();
  tunnel = null;
}

// Туннель поднимается параллельно запуску плеера: порт на колонке ждёт сам скрипт запуска (playScript).
// Возвращает обещание, которое отвергается, если ssh-туннель умер (порт занят, вход не удался)
function ensureTunnel(host) {
  if (tunnel && tunnel.proc.exitCode === null && tunnel.host === host && tunnel.port === port) return tunnel.dead;
  closeTunnel();
  const proc = spawn('ssh', core.tunnelArgs(host, port), { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (b) => { err = (err + b).slice(-400); });
  const dead = new Promise((_, reject) => {
    proc.once('error', (e) => reject(new Error('ssh не запустился: ' + e.message)));
    proc.once('exit', (code) => reject(new Error(`SSH-туннель не поднялся (код ${code}): ${err.trim() || 'без сообщения'}`)));
  });
  dead.catch(() => {});
  proc.once('exit', () => { if (tunnel?.proc === proc) tunnel = null; });
  tunnel = { proc, host, port, dead };
  return dead;
}

// ---- сервер для колонки ----

function ensureServer() {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = http.createServer(onRequest);
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      s.removeListener('error', reject);
      s.on('error', (e) => console.warn('speaker server:', e.message));
      server = s;
      port = s.address().port;
      resolve();
    });
  });
}

function closeServer() {
  if (!server) return;
  server.close();
  server.closeAllConnections();
  server = null;
  port = 0;
}

// Поток трека: ссылка сервиса живёт минуты, поэтому находим её заново, когда прошла минута
async function currentStream(s) {
  if (!s.stream || Date.now() - s.streamAt > STREAM_TTL) {
    s.pending = s.pending || deps.resolveStream(s.track).finally(() => { s.pending = null; }); // один поиск на всех, кто ждёт
    s.stream = await s.pending;
    s.streamAt = Date.now();
  }
  return s.stream;
}

// /s/<токен> — сам трек, /seg/<токен>/<n> — ссылка, которую мы сами выдали в плейлисте. Чужие адреса не отдаём:
// сегменты берутся только из списка, так что сервер не работает как открытый прокси
async function onRequest(req, res) {
  const m = /^\/(s|seg)\/([0-9a-f]{32})(?:\/(\d{1,6}))?$/.exec((req.url || '').split('?')[0]);
  const s = session;
  // сообщение от колонки (смотритель в speaker-core.js): /p/<токен>?ms=<позиция> раз в секунду и /e/<токен> — трек кончился
  const ev = /^\/(p|e)\/([0-9a-f]{32})(?:\?ms=(\d{1,9}))?$/.exec(req.url || '');
  if (ev && req.method === 'GET') {
    if (s && s.token === ev[2]) deps.onEvent?.({ type: ev[1] === 'p' ? 'pos' : 'end', id: s.track.id, ms: Number(ev[3] || 0), at: Date.now() });
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'GET' || !m || !s || s.token !== m[2]) { res.writeHead(404); res.end(); return; }
  try {
    if (m[1] === 's') {
      await serveTrack(req, res, s);
    } else {
      const url = s.segs[Number(m[3])];
      if (!url) { res.writeHead(404); res.end(); return; }
      await proxy(url, req, res, s);
    }
  } catch (e) {
    console.warn('speaker:', (req.url || '').slice(0, 60), e.message);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  }
}

async function serveTrack(req, res, s) {
  const stream = await currentStream(s);
  const file = core.mediaFile(stream.url, {
    cacheFileOf: deps.cacheFiles.fileOf,
    isAllowed: (p) => deps.local.allowed.has(p),
  });
  if (file === null) throw new Error('файл недоступен');
  if (file) return sendFile(file, req, res);
  return proxy(stream.url, req, res, s);
}

function pipe(src, res) {
  src.on('error', () => res.destroy());
  res.on('close', () => src.destroy());
  src.pipe(res);
}

// Файл из кэша или свой файл — с перемоткой, как в main.js (serveFile)
async function sendFile(file, req, res) {
  let size;
  try { size = (await fs.promises.stat(file)).size; } catch { res.writeHead(404); res.end(); return; }
  const range = core.parseRange(req.headers.range, size);
  if (range === null) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
  const head = { 'Content-Type': core.MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  if (range) {
    res.writeHead(206, { ...head, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${size}` });
    pipe(fs.createReadStream(file, range), res);
  } else {
    res.writeHead(200, { ...head, 'Content-Length': String(size) });
    pipe(fs.createReadStream(file), res);
  }
}

// Плейлист HLS: ссылки в нём колонка открыть не может (https), поэтому они уходят на наш сервер.
// Список только растёт: плейлист-мастер и его варианты получают свои номера и не сбивают друг друга
function sendPlaylist(text, url, res, s) {
  const body = core.rewritePlaylist(text, url, (u) => `/seg/${s.token}/${s.segs.push(u) - 1}`);
  res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function proxy(url, req, res, s) {
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const timer = setTimeout(() => abort.abort(), 20000); // ждём только ответ: тело потом может идти сколько нужно
  let r;
  try {
    r = await fetch(url, { headers: req.headers.range ? { Range: req.headers.range } : {}, signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
  if (r.ok && core.isPlaylist(r.headers.get('content-type'), url)) return sendPlaylist(await r.text(), url, res, s);
  const head = {};
  for (const k of ['content-type', 'content-range', 'accept-ranges']) {
    const v = r.headers.get(k);
    if (v) head[k] = v;
  }
  // fetch сам распаковывает ответ, и длина сжатого тела уже не подходит
  if (!r.headers.get('content-encoding') && r.headers.get('content-length')) head['content-length'] = r.headers.get('content-length');
  res.writeHead(r.status, head);
  if (!r.body) { res.end(); return; }
  pipe(Readable.fromWeb(r.body), res);
}

// ---- управление ----

async function play(track) {
  const host = hostOrThrow();
  if (!deps) throw new Error('Модуль колонки не запущен');
  if (!track?.id) throw new Error('Нужен трек');
  const s = { token: crypto.randomBytes(16).toString('hex'), track, stream: null, streamAt: 0, segs: [] };
  // Всё сразу: сервер, туннель, поиск потока и запуск плеера. Плеер сам ждёт порт туннеля и поток (сервер ответит,
  // когда поток найден), так что запуск занимает столько, сколько самый долгий из шагов, а не сумму
  await ensureServer();
  const dead = ensureTunnel(host);
  session = s;
  const url = `http://127.0.0.1:${core.REMOTE_PORT}/s/${s.token}`;
  const resolved = currentStream(s);
  resolved.catch(() => {});
  const run = ctl(host, core.playScript({ url, level: cfg().level }));
  try {
    const [, out] = await Promise.race([Promise.all([resolved, run]), dead]);
    const r = core.playResult(out);
    if (!r.ok) throw new Error('Колонка не заиграла: ' + r.error);
  } catch (e) {
    if (session === s) session = null;
    ctl(host, core.stopScript()).catch(() => {}); // плеер мог уже стартовать
    throw e;
  }
  return { host, title: track.title || '' };
}

async function stop() {
  const host = hostOrThrow();
  session = null;
  try {
    return { stopped: (await ctl(host, core.stopScript())).includes('STOPPED') };
  } finally {
    closeTunnel();
    closeServer();
  }
}

// Связь с колонкой («handshake»): отвечает ли она по SSH, играет ли сейчас. Не бросает: нет связи — online: false
async function status() {
  const { host, enabled } = cfg();
  if (!enabled || !host || !core.validHost(host)) return { configured: false, online: false, playing: false, track: '' };
  try {
    const out = await ctl(host, core.statusScript());
    const playing = core.isPlaying(out);
    return { configured: true, online: true, playing, progress: playing ? core.progressOf(out) : null, track: playing && session ? session.track.title || '' : '' };
  } catch (e) {
    return { configured: true, online: false, playing: false, track: '', error: e.message };
  }
}

// Выход из приложения: плеер на колонке останавливаем не дожидаясь ответа, а туннель и сервер закрываем сразу.
// Если остановить не успеем, поток оборвётся и плеер закончит сам, вернув громкость
function destroy() {
  const { host } = cfg();
  if (session && host && core.validHost(host)) ctl(host, core.stopScript()).catch(() => {});
  session = null;
  closeTunnel();
  closeServer();
}

module.exports = { init, play, stop, status, destroy };
