// Запущена ли игра: список запущенных процессов сверяем со списком игр Discord — по нему Discord
// пишет «Играет в …» (https://discord.com/api/v10/applications/detectable, ~24 тыс. игр).
// Список качаем раз в неделю и храним сжатым: только «имя exe → название игры» для Windows.
const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const LIST_URL = 'https://discord.com/api/v10/applications/detectable';
const REFRESH = 7 * 24 * 3600 * 1000;
const EVERY = 5000;
// слишком общие имена: так называются и не игры
const GENERIC = new Set(['launcher.exe', 'client.exe', 'nw.exe', 'autorun.exe', 'java.exe', 'update.exe', 'setup.exe', 'electron.exe', 'start.exe']);

let names = null; // имя exe (строчными) → название игры
let current = null; // { exe, name } или null
let timer = null;
let loading = null;
let onChange = () => {};

const file = () => path.join(app.getPath('userData'), 'games.json');

function readCache() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return null; }
}

async function download() {
  const res = await fetch(LIST_URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = await res.json();
  const map = {};
  for (const g of list) {
    for (const e of g.executables || []) {
      if (e.os !== 'win32' || e.is_launcher) continue;
      const exe = String(e.name || '').split('/').pop().toLowerCase();
      if (exe.endsWith('.exe') && !GENERIC.has(exe) && !map[exe]) map[exe] = g.name;
    }
  }
  const data = { at: Date.now(), names: map };
  try { fs.writeFileSync(file(), JSON.stringify(data)); } catch {}
  return data;
}

function load() {
  if (loading) return loading;
  const cached = readCache();
  if (cached?.names) names = cached.names;
  const fresh = cached && Date.now() - cached.at < REFRESH;
  loading = fresh ? Promise.resolve() : download().then((d) => { names = d.names; }).catch((e) => console.warn('games:', e.message));
  return loading;
}

// Имена запущенных процессов. tasklist есть в любой Windows, без оболочки и без PowerShell
function processes() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) { resolve([]); return; }
      // "имя","PID","сеанс","№ сеанса","память" — службы (сеанс 0) не игры: lms.exe у Intel — не «Last Man Standing»
      resolve(out.split(/\r?\n/).map((l) => l.match(/^"([^"]+)","\d+","[^"]*","(\d+)"/)).filter((m) => m && m[2] !== '0').map((m) => m[1].toLowerCase()));
    });
  });
}

async function check() {
  if (!names) return;
  let found = null;
  for (const exe of await processes()) {
    if (names[exe]) { found = { exe, name: names[exe] }; break; }
  }
  if ((found?.exe || null) === (current?.exe || null)) return;
  current = found;
  onChange(current);
}

// Следим, пока нужно (включён остров и «прятать в играх»); needed() спрашиваем каждый раз
function start(needed, cb) {
  onChange = cb;
  if (timer) return;
  timer = setInterval(() => {
    if (!needed()) {
      if (current) { current = null; onChange(null); }
      return;
    }
    load().then(check);
  }, EVERY);
}

module.exports = { start, current: () => current };
