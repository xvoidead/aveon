// Игра ли в активном окне: имя его процесса сверяем со списком игр Discord — по нему Discord
// пишет «Играет в …» (https://discord.com/api/v10/applications/detectable, ~24 тыс. игр).
// Список качаем раз в неделю и храним сжатым: только «имя exe → название игры» для Windows.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const LIST_URL = 'https://discord.com/api/v10/applications/detectable';
const REFRESH = 7 * 24 * 3600 * 1000;
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

// Активное окно — от DuckMon (native/DuckMon.cs, поле fg: имя процесса без .exe), ~30 раз в секунду.
// Игра — когда её окно перед глазами: свёрнутая или позади — не считается
let fgName = null;
let needed = () => false;

// «Ножницы»: оверлей выделения (Win+Shift+S) и само приложение — пока они перед глазами, остров прячется,
// чтобы не висеть поверх и не попадать в снимок (src/island.js → wanted)
const SNIP = new Set(['screenclippinghost', 'snippingtool', 'screensketch']);
let snipping = false;

function evaluate() {
  const exe = needed() && names && fgName ? `${fgName}.exe` : '';
  const found = exe && names[exe] ? { exe, name: names[exe] } : null;
  if ((found?.exe || null) === (current?.exe || null)) return;
  current = found;
  onChange(current);
}

function foreground(name) {
  name = String(name || '').toLowerCase();
  if (name === fgName) return;
  fgName = name;
  const snip = SNIP.has(name);
  if (snip !== snipping) { snipping = snip; onChange(current); }
  evaluate();
}

// needed() — нужно ли следить (включён остров и «прятать в играх»); спрашиваем каждый раз.
// Раз в 5 с: догрузить список и пересчитать — вдруг настройку включили, когда игра уже на экране
function start(isNeeded, cb) {
  needed = isNeeded;
  onChange = cb;
  if (timer) return;
  timer = setInterval(() => {
    if (needed()) load().then(evaluate);
    else evaluate();
  }, 5000);
}

module.exports = { start, foreground, current: () => current, snipping: () => snipping };
