// Сборка веб-части для Android: renderer/ как есть + мост (mobile/bridge → bridge.js) + телефонные
// стили и скрипт. Результат — mobile/www (webDir в capacitor.config.json), оттуда `cap sync`.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(root, 'mobile', 'www');
const r = (...p) => path.join(root, ...p);

// Чистим содержимое, а не саму папку: её может держать открытой dev-сервер
fs.mkdirSync(www, { recursive: true });
for (const f of fs.readdirSync(www)) fs.rmSync(path.join(www, f), { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'renderer'), { recursive: true });

// Страницы лежат в renderer/ и ссылаются на ../node_modules — сохраняем ту же структуру
fs.cpSync(r('renderer'), path.join(www, 'renderer'), { recursive: true });
for (const font of ['onest', 'unbounded']) {
  const from = r('node_modules', '@fontsource', font);
  const to = path.join(www, 'node_modules', '@fontsource', font);
  fs.mkdirSync(path.join(to, 'files'), { recursive: true });
  for (const f of fs.readdirSync(from)) if (/^\d+\.css$/.test(f)) fs.copyFileSync(path.join(from, f), path.join(to, f));
  for (const f of fs.readdirSync(path.join(from, 'files'))) {
    if (/(cyrillic|latin)-(ext-)?\d+-normal\.woff2$/.test(f)) fs.copyFileSync(path.join(from, 'files', f), path.join(to, 'files', f));
  }
}
fs.mkdirSync(path.join(www, 'node_modules', 'hls.js', 'dist'), { recursive: true });
fs.copyFileSync(r('node_modules', 'hls.js', 'dist', 'hls.light.min.js'), path.join(www, 'node_modules', 'hls.js', 'dist', 'hls.light.min.js'));

// Мост: src/ в браузере, Node-модули — шимы
const shim = (name) => r('mobile', 'bridge', 'shims', name);
await build({
  entryPoints: [r('mobile', 'bridge', 'index.js')],
  outfile: path.join(www, 'renderer', 'bridge.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  alias: {
    electron: shim('electron.js'),
    fs: shim('fs.js'),
    crypto: shim('crypto.js'),
    os: shim('os.js'),
    http: shim('empty.js'),
    net: shim('empty.js'),
    path: 'path-browserify',
  },
  inject: [r('mobile', 'bridge', 'shims', 'globals.js')],
  define: { 'process.platform': '"android"', 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

// Страницы: без CSP (Capacitor вставляет свой скрипт в страницу), с мостом и телефонными стилями
function page(name, extraHead, beforeScripts) {
  const file = path.join(www, 'renderer', name);
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '');
  html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">');
  html = html.replace('<link rel="stylesheet" href="styles.css">', `<link rel="stylesheet" href="styles.css">\n  ${extraHead}`);
  const first = html.indexOf('<script src=');
  html = html.slice(0, first) + beforeScripts + '\n  ' + html.slice(first);
  fs.writeFileSync(file, html);
}
page('index.html', '<link rel="stylesheet" href="mobile.css">', '<script src="bridge.js"></script>');
const index = path.join(www, 'renderer', 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<script src="presence.js"></script>', '<script src="presence.js"></script>\n  <script src="mobile.js"></script>'));
// Эквалайзер открывается шторкой в iframe и пользуется тем же мостом, что и плеер
page('eqpop.html', '<link rel="stylesheet" href="mobile.css">', '<script>window.tishe = parent.tishe;</script>');

// Корень сайта: Capacitor открывает index.html — отправляем в renderer/
fs.writeFileSync(path.join(www, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>html{background:#1b1411}</style><script>location.replace("renderer/index.html")</script>');

console.log('mobile/www готов');
