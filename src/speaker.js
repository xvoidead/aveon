// Колонка: Яндекс Станция Лайт 2 играет треки авеона. Колонка не умеет TLS и не достаёт до аудио-CDN SoundCloud,
// поэтому звук отдаёт этот компьютер: локальный сервер на 127.0.0.1 и обратный SSH-туннель (колонка ходит на свой
// 127.0.0.1:<порт, который выдала она сама>), правило брандмауэра не нужно. Управление по SSH: запуск плеера и громкость (speaker-core.js).
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
let ringHex = ''; // цвет кольца колонки: его считает окно из обложки, колонка спрашивает его сама
let pulse = { id: '', text: '' }; // кадры пульса кольца для трека: строка на кадр 40 мс, их считает окно
let session = null; // { token, track, stream, streamAt, segs } — играет один трек, новый заменяет прежний

function init(d) { deps = d; }

const cfg = () => config.get().speaker || {};

// Громкость колонки — та же, что в окне: ползунок плеера (0…1). level в настройках колонки больше не нужен
const levelNow = () => { const v = config.get().volume; return typeof v === 'number' ? v : 0.5; };

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

// Туннель: колонка сама выдаёт свободный порт (tunnelArgs, -R 0) и ssh называет его в ответ.
// Обещание сбывается номером порта и обещанием смерти туннеля (отвергается, если ssh вышел)
function ensureTunnel(host) {
  if (tunnel && tunnel.proc.exitCode === null && tunnel.host === host && tunnel.port === port) return tunnel.ready;
  closeTunnel();
  const proc = spawn('ssh', core.tunnelArgs(host, port), { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  const dead = new Promise((_, reject) => {
    proc.once('error', (e) => reject(new Error('ssh не запустился: ' + e.message)));
    proc.once('exit', (code) => reject(new Error(`SSH-туннель не поднялся (код ${code}): ${err.trim() || 'без сообщения'}`)));
  });
  dead.catch(() => {});
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Колонка не выдала порт для туннеля за 10 секунд')); }, 10000);
    proc.stderr.on('data', (b) => {
      err = (err + b).slice(-400);
      const remote = core.allocatedPort(err);
      if (remote) { clearTimeout(timer); resolve({ remote, dead }); }
    });
    dead.catch((e) => { clearTimeout(timer); reject(e); });
  });
  ready.catch(() => {});
  proc.once('exit', () => { if (tunnel?.proc === proc) tunnel = null; });
  tunnel = { proc, host, port, ready };
  return ready;
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
  // сообщение от колонки (смотритель в speaker-core.js): /p/<токен>?ms=<позиция> раз в секунду и /e/<токен> — трек кончился, /b/<токен>?k=up|down — двойной тап по громкости
  // /f/<токен> — кадры пульса кольца этого трека; пока окно их не посчитало (или трек HLS) — пусто
  const fr = /^\/f\/([0-9a-f]{32})$/.exec(req.url || '');
  if (fr && req.method === 'GET') {
    const v = s && s.token === fr[1] && pulse.id === s.track.id ? pulse.text : '';
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': String(Buffer.byteLength(v)) });
    res.end(v);
    return;
  }
  // /c/<токен> — цвет кольца сверху, окно обновляет его при смене обложки
  const col = /^\/c\/([0-9a-f]{32})$/.exec(req.url || '');
  if (col && req.method === 'GET') {
    const v = s && s.token === col[1] ? ringHex : '';
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': String(v.length) });
    res.end(v);
    return;
  }
  // /o/<токен> — с какой секунды трека начат поток: плеер колонки своё время считает с нуля, а на часах нужно время трека
  const off = /^\/o\/([0-9a-f]{32})$/.exec(req.url || '');
  if (off && req.method === 'GET') {
    const ms = s && s.token === off[1] ? String(Math.round((s.base || 0) * 1000)) : '0';
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': String(ms.length) });
    res.end(ms);
    return;
  }
  const ev = /^\/(p|e|b)\/([0-9a-f]{32})(?:\?(?:ms=(\d{1,9})|k=(up|down)))?$/.exec(req.url || '');
  if (ev && req.method === 'GET') {
    if (s && s.token === ev[2]) deps.onEvent?.({ type: { p: 'pos', e: 'end', b: 'key' }[ev[1]], id: s.track.id, ms: Number(ev[3] || 0), key: ev[4] || '', at: Date.now() });
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
  if (file) return sendFile(file, req, res, s);
  return proxy(stream.url, req, res, s);
}

// Трек начинается не с начала: перемотать запущенный плеер нечем (см. speaker-core.js), поэтому отдаём поток уже со сдвигом.
// С какой секунды получилось на самом деле — сообщаем окну (плейлист режется по сегментам, mp3 по байтам)
function setBase(s, seconds) {
  s.seek = 0;
  s.base = seconds;
  deps.onEvent?.({ type: 'base', id: s.track.id, ms: Math.round(seconds * 1000), at: Date.now() });
}

// mp3 отдаётся одним куском, перемотка по нему — доля от размера. У записи с переменным битрейтом попадание
// приблизительное, зато декодер подхватывает с ближайшего кадра. Остальные форматы (m4a и прочие) играем с начала
function byteSeek(s, type, size) {
  const dur = s.track.duration || 0;
  if (!(s.seek > 0) || !size || !dur || !/audio\/mpeg|mp3/i.test(type || '')) return 0;
  const at = Math.min(s.seek, Math.max(0, dur - 5));
  const off = Math.floor((size * at) / dur);
  if (off <= 0) return 0;
  setBase(s, at);
  return off;
}

function pipe(src, res) {
  src.on('error', () => res.destroy());
  res.on('close', () => src.destroy());
  src.pipe(res);
}

// Файл из кэша или свой файл — с перемоткой, как в main.js (serveFile)
async function sendFile(file, req, res, s) {
  let size;
  try { size = (await fs.promises.stat(file)).size; } catch { res.writeHead(404); res.end(); return; }
  const type = core.MIME[path.extname(file).toLowerCase()] || '';
  const from = s ? byteSeek(s, type, size) : 0;
  if (from) { // играем с нужной секунды: отдаём хвост файла как целый поток
    res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Content-Length': String(size - from) });
    pipe(fs.createReadStream(file, { start: from }), res);
    return;
  }
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
  const cut = core.trimPlaylist(text, s.seek || 0); // начать не с начала: выкидываем сегменты до нужной секунды
  if (cut.offset) setBase(s, cut.offset);
  const body = core.rewritePlaylist(cut.text, url, (u) => `/seg/${s.token}/${s.segs.push(u) - 1}`);
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
  // трек с нужной секунды: длину и тип знаем только из ответа, поэтому спрашиваем ещё раз, уже с нужного байта
  if (s && r.ok && !req.headers.range) {
    const off = byteSeek(s, r.headers.get('content-type'), Number(r.headers.get('content-length') || 0));
    if (off) {
      r.body?.cancel().catch(() => {});
      const r2 = await fetch(url, { headers: { Range: `bytes=${off}-` }, signal: abort.signal });
      if (r2.ok) { // 206 отдаём колонке как обычный поток целиком: перематывать она всё равно не умеет
        res.writeHead(200, { 'content-type': r2.headers.get('content-type') || 'audio/mpeg' });
        if (!r2.body) { res.end(); return; }
        pipe(Readable.fromWeb(r2.body), res);
        return;
      }
      r = await fetch(url, { signal: abort.signal }); // не дал кусок — играем с начала
    }
  }
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

// at — с какой секунды играть (кнопка колонки на ходу, клик по полосе). Громкость берём ту, что стоит в окне
async function play(track, at = 0) {
  const host = hostOrThrow();
  if (!deps) throw new Error('Модуль колонки не запущен');
  if (!track?.id) throw new Error('Нужен трек');
  const s = { token: crypto.randomBytes(16).toString('hex'), track, stream: null, streamAt: 0, segs: [], seek: at > 1 ? at : 0, base: 0 };
  // Поиск потока идёт, пока поднимается туннель; плеер запускаем, как только колонка назвала порт.
  // Плеер сам дождётся потока: сервер ответит ему, когда поток найден
  await ensureServer();
  session = s;
  const resolved = currentStream(s);
  resolved.catch(() => {});
  try {
    const { remote, dead } = await ensureTunnel(host);
    const url = `http://127.0.0.1:${remote}/s/${s.token}`;
    const run = ctl(host, core.playScript({ url, level: levelNow(), display: cfg().display !== false, keys: cfg().keys !== false, ring: cfg().ring !== false }));
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

// Цвет кольца: окно присылает его из акцента обложки, колонка забирает сама
function ring(hex) {
  ringHex = /^[0-9a-f]{6}$/i.test(hex || '') ? String(hex).toLowerCase() : '';
  return { ok: true };
}

// Кадры пульса: строка на кадр, в каждой девять байт «\xBB\xGG\xRR» трёх светодиодов — их колонка отдаёт
// в printf как есть. Чужое (не байты в таком виде) не принимаем: строка уходит прямо в оболочку колонки
const FRAME = /^(?:\\x[0-9a-f]{2}){9}$/;
function frames(id, text) {
  const lines = typeof text === 'string' ? text.split('\n') : [];
  const ok = id && lines.length && lines.length < 50000 && lines.every((l) => FRAME.test(l));
  pulse = ok ? { id: String(id), text } : { id: '', text: '' };
  return { ok: !!ok, frames: ok ? lines.length : 0 };
}

// Ползунок громкости в окне двигает громкость колонки, пока она играет
async function volume(level) {
  const { host } = cfg();
  if (!session || !host || !core.validHost(host)) return { ok: false };
  return { ok: (await ctl(host, core.volumeScript(level))).includes('VOL') };
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

module.exports = { init, play, volume, ring, frames, stop, status, destroy };
