// Запуск нативного монитора DuckMon.exe. Собираем его из native/DuckMon.cs встроенным csc.exe
// (.NET Framework 4 есть в любой Windows 10/11), поэтому ничего доустанавливать не нужно.
const { app } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SRC = path.join(__dirname, '..', 'native', 'DuckMon.cs');
const CSC = [
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
];

let child = null;
let listener = () => {};
let statusListener = () => {};
let lastTargets = [];
let lastDuck = 1;
let stopping = false;
let restarts = 0;

function exePath() {
  return path.join(app.getPath('userData'), 'bin', 'DuckMon.exe');
}

function build() {
  const out = exePath();
  const srcTime = fs.statSync(SRC).mtimeMs;
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= srcTime) return Promise.resolve(out);
  const csc = CSC.find((p) => fs.existsSync(p));
  if (!csc) return Promise.reject(new Error('Не найден csc.exe (.NET Framework 4)'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  return new Promise((resolve, reject) => {
    execFile(csc, ['/nologo', '/optimize', '/target:exe', `/out:${out}`, SRC], { windowsHide: true }, (err, stdout) => {
      if (err) reject(new Error('Сборка DuckMon: ' + (stdout || err.message)));
      else resolve(out);
    });
  });
}

async function start(onMeter, onStatus) {
  listener = onMeter;
  statusListener = onStatus || (() => {});
  if (process.platform !== 'win32') {
    statusListener({ ok: false, error: 'Приглушение по Discord работает только в Windows' });
    return;
  }
  let exe;
  try {
    exe = await build();
  } catch (e) {
    statusListener({ ok: false, error: e.message });
    return;
  }
  launch(exe);
}

function launch(exe) {
  child = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  statusListener({ ok: true });
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    try { listener(JSON.parse(line)); } catch {}
  });
  child.stderr.on('data', (d) => console.warn('[DuckMon]', d.toString().trim()));
  child.on('exit', (code) => {
    child = null;
    if (stopping) return;
    if (restarts++ < 5) setTimeout(() => launch(exe), 1000);
    else statusListener({ ok: false, error: `DuckMon завершился (код ${code})` });
  });
  send(`targets ${lastTargets.join(',')}`);
  send(`duck ${lastDuck}`);
}

function send(line) {
  if (child && child.stdin.writable) child.stdin.write(line + '\n');
}

function setTargets(list) {
  lastTargets = (list || []).map((s) => String(s).trim()).filter(Boolean);
  send(`targets ${lastTargets.join(',')}`);
}

function setDuck(level) {
  lastDuck = Math.max(0, Math.min(1, Number(level) || 0));
  send(`duck ${lastDuck.toFixed(3)}`);
}

function stop() {
  stopping = true;
  if (!child) return;
  send('duck 1');
  send('quit');
  child.stdin.end();
  const c = child;
  setTimeout(() => { try { c.kill(); } catch {} }, 1500);
}

module.exports = { start, stop, setTargets, setDuck };
