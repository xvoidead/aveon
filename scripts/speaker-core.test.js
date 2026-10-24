'use strict';
// Ядро «колонки» (src/speaker-core.js): плейлисты, диапазоны, ssh и скрипты для колонки. Запуск: npm run test:speaker
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/speaker-core.js');

const TOKEN = 'a'.repeat(32);
const URL_OK = `http://127.0.0.1:${S.REMOTE_PORT}/s/${TOKEN}`;

test('validHost: имя из ssh config и адреса — да, всё похожее на ключ ssh или команду — нет', () => {
  for (const h of ['lite2', 'root@192.168.0.102', 'speaker.local', 'user@fe80::1']) assert.equal(S.validHost(h), true, h);
  for (const h of ['', '-oProxyCommand=calc', 'a b', 'a;b', 'a$(x)', '$HOME', null, undefined, 42]) assert.equal(S.validHost(h), false, String(h));
});

test('masterOf: доля 0…1 → 0…255, мусор → 0.7', () => {
  assert.equal(S.masterOf(0.7), 179);
  assert.equal(S.masterOf(0), 0);
  assert.equal(S.masterOf(1), 255);
  assert.equal(S.masterOf(5), 255);
  assert.equal(S.masterOf(-1), 0);
  for (const bad of [undefined, null, 'x', NaN, Infinity]) assert.equal(S.masterOf(bad), 179, String(bad));
});

test('parseRange: три вида диапазона, обрезка по размеру, 416 и «диапазона нет»', () => {
  assert.deepEqual(S.parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(S.parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(S.parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(S.parseRange('bytes=0-5000', 1000), { start: 0, end: 999 });
  assert.equal(S.parseRange('bytes=2000-3000', 1000), null);
  assert.equal(S.parseRange('bytes=5-2', 1000), null);
  for (const h of [undefined, '', 'bytes=', 'bytes=-', 'garbage', 'bytes=0-1,5-6']) assert.equal(S.parseRange(h, 1000), undefined, String(h));
});

test('mediaFile: кэш и локальные файлы — как в протоколе media://, чужое не отдаём', () => {
  const deps = {
    cacheFileOf: (f) => (/^[a-f0-9]{24}\.mp3$/.test(f || '') ? `C:\\cache\\${f}` : null),
    isAllowed: (p) => p === 'C:\\music\\a b.mp3',
  };
  assert.equal(S.mediaFile(`media://cache/?f=${'ab'.repeat(12)}.mp3`, deps), `C:\\cache\\${'ab'.repeat(12)}.mp3`);
  assert.equal(S.mediaFile('media://cache/?f=..%5C..%5Cx.mp3', deps), null);
  assert.equal(S.mediaFile(`media://local/?p=${encodeURIComponent('C:\\music\\a b.mp3')}`, deps), 'C:\\music\\a b.mp3');
  assert.equal(S.mediaFile(`media://local/?p=${encodeURIComponent('C:\\secret.txt')}`, deps), null);
  assert.equal(S.mediaFile('media://cover/?p=x', deps), null);
  assert.equal(S.mediaFile('https://cdn.example/a.mp3', deps), undefined);
  assert.equal(S.mediaFile('не адрес', deps), undefined);
});

test('isPlaylist: по типу ответа или по адресу', () => {
  assert.equal(S.isPlaylist('application/vnd.apple.mpegurl', 'https://x/a'), true);
  assert.equal(S.isPlaylist('audio/mpegurl', 'https://x/a'), true);
  assert.equal(S.isPlaylist('', 'https://x/p.m3u8?sig=1'), true);
  assert.equal(S.isPlaylist('audio/mpeg', 'https://x/a.mp3'), false);
});

test('rewritePlaylist: абсолютные и относительные ссылки, MAP, ключи; теги и пустые строки целы', () => {
  const seen = [];
  const register = (u) => { seen.push(u); return `/seg/${seen.length - 1}`; };
  const src = [
    '#EXTM3U',
    '#EXT-X-MAP:URI="init.mp4?s=1"',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key-id"',
    '#EXT-X-KEY:METHOD=NONE',
    '#EXTINF:10.0,',
    'https://cdn.example/q/data000.m4s?sig=A',
    '',
    '#EXTINF:10.0,',
    '../data001.m4s',
    '#EXT-X-ENDLIST',
  ].join('\r\n');
  const out = S.rewritePlaylist(src, 'https://cdn.example/a/b/pl.m3u8?x=1', register).split('\n');
  assert.deepEqual(seen, [
    'https://cdn.example/a/b/init.mp4?s=1',
    'https://cdn.example/q/data000.m4s?sig=A',
    'https://cdn.example/a/data001.m4s',
  ]);
  assert.deepEqual(out, [
    '#EXTM3U',
    '#EXT-X-MAP:URI="/seg/0"',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key-id"',
    '#EXT-X-KEY:METHOD=NONE',
    '#EXTINF:10.0,',
    '/seg/1',
    '',
    '#EXTINF:10.0,',
    '/seg/2',
    '#EXT-X-ENDLIST',
  ]);
});

test('ssh: туннель выводит порт колонки на наш сервер, управление берёт скрипт из stdin', () => {
  const t = S.tunnelArgs('lite2', 54321);
  assert.equal(t[0], '-N');
  assert.equal(t.at(-1), 'lite2');
  assert.equal(t[t.indexOf('-R') + 1], `${S.REMOTE_PORT}:127.0.0.1:54321`);
  assert.ok(t.includes('BatchMode=yes') && t.includes('ExitOnForwardFailure=yes'));
  const c = S.controlArgs('lite2');
  assert.deepEqual(c.slice(-3), ['lite2', 'sh', '-s']);
  assert.ok(c.includes('BatchMode=yes'));
});

test('playScript: только свой адрес, громкость ставится до запуска плеера, смотритель вложен целиком', () => {
  for (const bad of [
    `http://127.0.0.1:${S.REMOTE_PORT}/s/${TOKEN}; reboot`,
    `http://127.0.0.1:${S.REMOTE_PORT}/s/${TOKEN}\nreboot`,
    `http://127.0.0.1:9999/s/${TOKEN}`,
    `http://evil.example:${S.REMOTE_PORT}/s/${TOKEN}`,
    `http://127.0.0.1:${S.REMOTE_PORT}/s/xyz`,
    '',
  ]) assert.throws(() => S.playScript({ url: bad, level: 0.7 }), /bad play url/, JSON.stringify(bad));

  const sh = S.playScript({ url: URL_OK, level: 0.7 });
  assert.ok(sh.includes(`setsid sh /tmp/aveon-speaker/run.sh ${URL_OK}`) || sh.includes(`run.sh ${URL_OK}`));
  const vol = sh.indexOf('amixer cset numid=186 179');
  assert.ok(vol > 0 && vol < sh.indexOf('setsid sh'), 'громкость выставляется раньше запуска плеера');
  assert.ok(sh.indexOf("<<'EOF'") > 0 && sh.indexOf('\nEOF\n') > sh.indexOf("<<'EOF'"), 'heredoc закрыт');
  assert.ok(sh.includes('--gst-launch "uridecodebin uri=$1 ! audioconvert ! audioresample ! alsasink"'));
  assert.ok(sh.includes("trap 'KILLED=1; kill $G 2>/dev/null' TERM INT"));
  // рукопожатие: позиция раз в секунду и конец трека — на наш сервер через туннель, а при остановке «конец» не шлётся
  assert.ok(sh.includes(`B=http://127.0.0.1:${S.REMOTE_PORT}`) && sh.includes('$B/p/$T?ms=$P') && sh.includes('[ -z "$KILLED" ] && wget'));
  assert.ok(sh.includes('rm -f $D/vol $D/pid'), 'громкость возвращается');
  assert.ok(S.playScript({ url: URL_OK, level: 0.5 }).includes('amixer cset numid=186 128'));
});

test('осиротевший dmix: убирается только при nattch = 0, после выхода плеера, при запуске и при остановке', () => {
  const sh = S.playScript({ url: URL_OK, level: 0.7 });
  assert.ok(sh.includes('dmix_clean() {') && sh.includes('[ "$N" = 0 ] && ipcrm -M 0x400 -M 0x401 -S 0x400'), 'чистим только без подключённых');
  // смотритель: чистит сразу после выхода плеера и до того, как вернёт громкость
  const run = sh.split("<<'EOF'\n")[1].split('\nEOF\n')[0];
  const wait = run.lastIndexOf('wait $G 2>/dev/null');
  const clean = run.indexOf('\ndmix_clean\n');
  assert.ok(wait > 0 && clean > wait, 'смотритель чистит после wait');
  assert.ok(run.indexOf('dmix_clean() {') < run.indexOf('/system/vendor/quasar/maind'), 'функция объявлена до запуска плеера');
  // запуск: чистим до старта нового плеера, после остановки прежнего
  const body = sh.split("<<'EOF'\n")[0];
  assert.ok(body.lastIndexOf('\ndmix_clean\n') > body.indexOf('kill -0 $OLD'), 'запуск чистит после остановки прежнего');
  // остановка: чистим и когда плеер был, и когда его уже нет
  const stop = S.stopScript();
  assert.equal(stop.split('\n  dmix_clean\n').length - 1, 2);
});

test('listenScript: порт туннеля в /proc/net/tcp ищется шестнадцатеричным, только в состоянии LISTEN', () => {
  assert.equal(S.REMOTE_PORT, 0x4d4e);
  const sh = S.listenScript();
  assert.ok(sh.includes("':4D4E 00000000:0000 0A '"));
  assert.ok(sh.includes('echo UP') && sh.includes('echo DOWN'));
});

test('playResult и isPlaying разбирают ответ колонки', () => {
  assert.deepEqual(S.playResult('OK 4242\n'), { ok: true });
  const bad = S.playResult('FAIL\n[x] ERROR from source: Internal data stream error\n');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Internal data stream error/);
  assert.equal(S.playResult('').ok, false);
  assert.equal(S.playResult(undefined).ok, false);
  assert.equal(S.isPlaying('PLAYING\n'), true);
  assert.equal(S.isPlaying('IDLE\n'), false);
  assert.equal(S.isPlaying(''), false);
});

test('progressOf: позиция из строки Progress лога плеера', () => {
  const line = '[2026-10-24 14:41:41.307] [info] [gst_launch.cpp:261] [1] Progress: 5256ms / 124238ms';
  assert.equal(S.progressOf(`PLAYING\n${line}\n`), 5.256);
  assert.equal(S.progressOf('PLAYING\n'), null);
  assert.equal(S.progressOf(''), null);
  assert.equal(S.isPlaying(`PLAYING\n${line}\n`), true);
});
