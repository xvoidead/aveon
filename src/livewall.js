// Живые обои: окно на весь экран за иконками рабочего стола — размытая обложка, спектр по кругу,
// название трека. Окно вешает за иконки native/DeskWall.cs (собирается встроенным csc.exe, как DuckMon).
const { app, BrowserWindow, screen } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SRC = path.join(__dirname, '..', 'native', 'DeskWall.cs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const CSC = [
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
];

let win = null;
let ready = false;
let last = null;
let error = '';
let notify = () => {};

const cfg = () => ({ enabled: false, style: 'both', title: true, dim: 45, ...(config.get().livewall || {}) });

function exePath() { return path.join(app.getPath('userData'), 'bin', 'DeskWall.exe'); }

function build() {
  const out = exePath();
  const srcTime = fs.statSync(SRC).mtimeMs;
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= srcTime) return Promise.resolve(out);
  const csc = CSC.find((p) => fs.existsSync(p));
  if (!csc) return Promise.reject(new Error('Не найден csc.exe (.NET Framework 4)'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  return new Promise((resolve, reject) => {
    execFile(csc, ['/nologo', '/optimize', '/target:exe', `/out:${out}`, SRC], { windowsHide: true }, (err, stdout) => {
      if (err) reject(new Error('Сборка DeskWall: ' + (stdout || err.message)));
      else resolve(out);
    });
  });
}

function run(args) {
  return build().then((exe) => new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout.trim());
    });
  }));
}

async function open() {
  if (win && !win.isDestroyed()) return;
  if (process.platform !== 'win32') { error = 'Живые обои есть только в Windows'; notify(); return; }
  const b = screen.getPrimaryDisplay().bounds;
  ready = false;
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#000000',
    title: 'живые обои авеона',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.on('closed', () => { win = null; ready = false; });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'livewall.html'));
  ready = true;
  win.webContents.send('livewall:config', cfg());
  if (last) win.webContents.send('island:state', last);
  win.showInactive();
  try {
    const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
    await run(['attach', hwnd]);
    win.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
    error = '';
  } catch (e) {
    error = e.message;
    close();
  }
  notify();
}

function close() {
  if (win && !win.isDestroyed()) {
    win.destroy();
    run(['refresh']).catch(() => {});
  }
  win = null;
}

function apply() {
  if (cfg().enabled) open().catch((e) => { error = e.message; notify(); });
  else close();
  if (win && ready) win.webContents.send('livewall:config', cfg());
}

function init(onChange) {
  notify = onChange || notify;
  apply();
}

function state(s) {
  last = s;
  if (win && !win.isDestroyed() && ready) win.webContents.send('island:state', s);
}

const status = () => ({ ...cfg(), running: !!(win && !win.isDestroyed()), error });
const wanted = () => !!(win && !win.isDestroyed());

module.exports = { init, state, settingsChanged: apply, status, wanted, destroy: close };
