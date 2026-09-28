'use strict';
// Дополнения к app.js (общие глобальные: state, api, audio, $, $$, esc, fmt, toast, …):
// палитра из обложки, «где остановился», статистика, редактор тегов своих файлов, текст песни.

// ---------- палитра из обложки ----------

const THEME_VARS = ['--oak', '--oak-2', '--rivet', '--rivet-2', '--hoop', '--hoop-dim', '--text', '--text-2', '--text-3', '--amber', '--voice'];
const BG_VARS = ['--oak', '--oak-2', '--rivet', '--rivet-2', '--hoop', '--hoop-dim', '--text', '--text-2', '--text-3'];
let themeSeq = 0;
let lastPalette = null;

// Фон в цвет обложки: на компьютере по умолчанию включён, на телефоне — нет (только акцент)
const tintBg = () => state.cfg?.ui?.tintBg ?? !IS_MOBILE;

const hsl = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// → [оттенок 0…1, насыщенность 0…1, светлота 0…1]
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function resetTheme() {
  themeSeq++;
  lastPalette = null;
  lastCoverImg = ambientFor = null;
  for (const v of THEME_VARS) document.documentElement.style.removeProperty(v);
  document.documentElement.style.removeProperty('--ambient');
}

// «Стекло» (look.js → SKIN_AMBIENT): фон сцены — обложка, размытая один раз на холсте 64×64.
// Браузер потом только растягивает готовую картинку: ни CSS-фильтров, ни перерисовки размытия каждый кадр
let lastCoverImg = null;
let ambientFor = null;
function ambientFrom(img) {
  lastCoverImg = img;
  if (!window.SKIN_AMBIENT || ambientFor === img) return;
  ambientFor = img;
  const root = document.documentElement.style;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.filter = 'blur(7px) saturate(1.7)';
    g.drawImage(img, -24, -24, 112, 112); // с запасом за краями — размытие не темнит углы
    root.setProperty('--ambient', `url("${c.toDataURL('image/jpeg', 0.9)}")`);
  } catch {
    root.removeProperty('--ambient'); // картинку не прочитать (без CORS) — остаётся ровный фон
  }
}

function applyThemeFrom(url) {
  lookCover(url); // look.js: фон «размытая обложка»
  const seq = ++themeSeq;
  if (!url) { resetTheme(); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (seq !== themeSeq) return;
    try { setTheme(analyzeCover(img)); } catch { /* обложка без CORS — оставляем прежнюю палитру */ }
    ambientFrom(img);
  };
  img.src = url;
}

// Два цвета из обложки: фон — общий тон картинки, акцент — самый заметный насыщенный оттенок
function analyzeCover(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 40;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, 40, 40);
  const d = g.getImageData(0, 0, 40, 40).data;
  const bins = Array.from({ length: 24 }, () => ({ w: 0, s: 0 }));
  let sx = 0, sy = 0, sw = 0, satSum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    n++;
    satSum += s;
    // Общий тон: круговое среднее оттенка с весом насыщенности
    const a = h * Math.PI * 2;
    const wBg = s * (1 - Math.abs(l - 0.45));
    sx += Math.cos(a) * wBg; sy += Math.sin(a) * wBg; sw += wBg;
    // Акцент: насыщенные пиксели средней яркости
    if (l > 0.18 && l < 0.88 && s > 0.25) {
      const b = bins[Math.floor(h * 24) % 24];
      const w = s * s * (1 - Math.abs(l - 0.55));
      b.w += w; b.s += s * w;
    }
  }
  const bgHue = sw > 0.001 ? ((Math.atan2(sy, sx) / (Math.PI * 2)) * 360 + 360) % 360 : 25;
  const avgSat = satSum / n;
  let best = -1, bestW = 0;
  bins.forEach((b, i) => {
    // соседние корзины тоже считаем — оттенки на границе не дробятся
    const w = b.w + 0.5 * (bins[(i + 23) % 24].w + bins[(i + 1) % 24].w);
    if (w > bestW) { bestW = w; best = i; }
  });
  const vivid = bestW / n > 0.015;
  const accentHue = vivid ? best * 15 + 7.5 : bgHue;
  const accentSat = vivid ? bins[best].s / Math.max(bins[best].w, 1e-6) : 0.12;
  return { bgHue, bgSat: avgSat, accentHue, accentSat, vivid };
}

// Перекрасить заново после смены настройки «фон в цвет обложки»
function reapplyTheme() {
  if (lastPalette) setTheme(lastPalette);
  if (lastCoverImg) ambientFrom(lastCoverImg); // включили «Стекло» посреди трека
}

function setTheme(p) {
  lastPalette = p;
  const bgS = clamp(p.bgSat * 0.7, 0.06, 0.38);
  const vars = {
    '--oak': hsl(p.bgHue, bgS, 0.075),
    '--oak-2': hsl(p.bgHue, bgS, 0.1),
    '--rivet': hsl(p.bgHue, bgS * 0.9, 0.135),
    '--rivet-2': hsl(p.bgHue, bgS * 0.85, 0.175),
    '--hoop-dim': hsl(p.bgHue, bgS * 0.5, 0.3),
    '--hoop': hsl(p.bgHue, bgS * 0.35, 0.5),
    '--text': hsl(p.bgHue, 0.3, 0.93),
    '--text-2': hsl(p.bgHue, 0.16, 0.74),
    '--text-3': hsl(p.bgHue, 0.1, 0.57),
    // Чёрно-белая обложка — светлый приглушённый акцент того же тона.
    // На светлом дизайне (look.js → SKIN_LIGHT) акцент и голоса темнее: иначе их не прочитать на белом
    '--amber': window.SKIN_LIGHT
      ? (p.vivid ? hsl(p.accentHue, clamp(p.accentSat, 0.45, 0.8), 0.38) : hsl(p.bgHue, 0.1, 0.34))
      : (p.vivid ? hsl(p.accentHue, clamp(p.accentSat, 0.55, 0.9), 0.66) : hsl(p.bgHue, 0.14, 0.8)),
    // Цвет голосов не должен сливаться с акцентом музыки
    '--voice': p.vivid && hueDist(p.accentHue, 232) < 50
      ? hsl(158, 0.55, window.SKIN_LIGHT ? 0.3 : 0.7)
      : (window.SKIN_LIGHT ? '#5b48db' : '#9aa8ff'),
  };
  const root = document.documentElement.style;
  const l = window.LOOK || {};
  for (const [k, v] of Object.entries(vars)) {
    // look.js: свой акцент или цвет бочки важнее палитры обложки
    const own = (k === '--amber' && l.accentMode === 'fixed') || (k === '--voice' && l.voice);
    // look.js: у дизайна свои цвета фона или свой акцент — палитра обложки их не трогает
    const skinOwn = (window.SKIN_FIXED && BG_VARS.includes(k)) || (window.SKIN_ACCENT && k === '--amber');
    if (own || skinOwn || (!tintBg() && BG_VARS.includes(k))) root.removeProperty(k);
    else root.setProperty(k, v);
  }
}

// Цвета для canvas-визуализатора (читаем раз в полсекунды, с учётом плавного перехода)
const vizColors = { at: 0, amber: '#f0a63a', voice: '#9aa8ff' };
function vizColor(kind) {
  const now = performance.now();
  if (now - vizColors.at > 500) {
    const cs = getComputedStyle(document.documentElement);
    vizColors.amber = cs.getPropertyValue('--amber').trim() || vizColors.amber;
    vizColors.voice = cs.getPropertyValue('--voice').trim() || vizColors.voice;
    vizColors.at = now;
  }
  return vizColors[kind];
}

// ---------- копия трека для хранения ----------

function slimTrack(t) {
  if (!t) return null;
  const ref = { ...t.ref };
  if (t.source === 'sc') { delete ref.transcodings; delete ref.auth; } // протухают, поток получим заново
  return { id: t.id, source: t.source, title: t.title, artist: t.artist, album: t.album, duration: t.duration, cover: t.cover, link: t.link, playable: t.playable !== false, preview: !!t.preview, ref, ...(t.shared ? { shared: true } : {}) };
}

// ---------- где остановился ----------

const resume = { lastSave: 0 };

function sessionSnapshot() {
  if (!state.track || !state.queue.length) return null;
  // Очередь сохраняем уже в порядке проигрывания (с учётом перемешивания), окном вокруг текущего трека
  const ordered = state.order.map((i) => state.queue[i]);
  const from = Math.max(0, state.pos - 200);
  const list = ordered.slice(from, from + 1000);
  return {
    track: slimTrack(state.track),
    position: +(audio.currentTime || 0).toFixed(1),
    queue: list.map(slimTrack),
    pos: state.pos - from,
    view: state.view,
    sub: state.sub ?? null, // открытый плейлист или альбом в разделе
    wave: typeof Wave !== 'undefined' && Wave.active ? { mode: Wave.mode } : null, // слушали волну
    savedAt: Date.now(),
  };
}

function saveSession(sync = false) {
  const snap = sessionSnapshot();
  if (!snap) return;
  resume.lastSave = Date.now();
  if (sync) api.store.setSync('session', snap);
  else api.store.set('session', snap).catch(() => {});
}

async function restoreSession() {
  let s;
  try { s = await api.store.get('session'); } catch { return; }
  if (!s?.track || !Array.isArray(s.queue) || !s.queue.length) return;
  const queue = await api.meta.apply(s.queue).catch(() => s.queue); // свои теги могли поменяться
  const pos = clamp(s.pos | 0, 0, queue.length - 1);
  state.queue = queue;
  state.order = queue.map((_, i) => i);
  state.pos = pos;
  // Трек ставим на паузу ровно там, где остановились; звук не включаем
  loadTrack(queue[pos], { autoplay: false, startAt: s.position || 0, quiet: true });
  $('#time-cur').textContent = fmt(s.position || 0);
  // Где слушали — туда и возвращаемся: волна снова включена и дальше подкидывает треки (wave.js),
  // открытый плейлист или альбом открыт снова
  if (s.wave) {
    Wave.active = true;
    Wave.mode = s.wave.mode || waveMode();
    for (const t of queue) Wave.heard.add(t.id);
    renderWaveHero();
    if (state.view === 'wave') renderWave();
  }
  if (s.sub != null && s.view === state.view && state.sub == null) openView(s.view, s.sub);
}

onAudio('pause', () => saveSession());
onAudio('seeked', () => { if (Date.now() - resume.lastSave > 1000) saveSession(); });
setInterval(() => { if (!audio.paused) saveSession(); }, 5000);
window.addEventListener('beforeunload', () => { saveSession(true); saveStats(true); });

// ---------- статистика ----------

// data — статистика этого компьютера, remote — других компьютеров аккаунта (id устройства → данные)
const stats = { data: { v: 1, days: {}, tracks: {} }, remote: {}, dirty: false, cur: null, lastTime: null, month: null };

const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

async function loadStats() {
  try {
    const d = await api.store.get('stats');
    if (d?.days && d?.tracks) stats.data = d;
  } catch {}
  await loadRemoteStats();
}

async function loadRemoteStats() {
  try { stats.remote = (await api.store.get('statsRemote')) || {}; } catch { stats.remote = {}; }
}

// Статистика для показа: этот компьютер плюс остальные компьютеры аккаунта
function statsAll() {
  const others = Object.values(stats.remote).filter((d) => d?.days && d?.tracks);
  if (!others.length) return stats.data;
  const days = { ...stats.data.days };
  const tracks = {};
  const addTrack = (id, rec) => {
    const have = tracks[id] || (tracks[id] = { t: rec.t, sec: 0, plays: 0, m: {} });
    have.sec += rec.sec || 0;
    have.plays += rec.plays || 0;
    for (const [mk, rm] of Object.entries(rec.m || {})) {
      const hm = have.m[mk] || (have.m[mk] = { sec: 0, plays: 0 });
      hm.sec += rm.sec || 0;
      hm.plays += rm.plays || 0;
    }
  };
  for (const [id, rec] of Object.entries(stats.data.tracks)) addTrack(id, rec);
  for (const d of others) {
    for (const [k, v] of Object.entries(d.days)) days[k] = (days[k] || 0) + v;
    for (const [id, rec] of Object.entries(d.tracks)) addTrack(id, rec);
  }
  return { days, tracks };
}

function saveStats(sync = false) {
  if (!stats.dirty) return;
  stats.dirty = false;
  if (sync) api.store.setSync('stats', stats.data);
  else api.store.set('stats', stats.data).catch(() => { stats.dirty = true; });
}
setInterval(saveStats, 20000);

function statsOnTrack(track) {
  stats.cur = track ? { id: track.id, listened: 0, counted: false } : null;
  stats.lastTime = null;
}
onAudio('ended', () => { if (state.track) statsOnTrack(state.track); });

// Раз в секунду: сколько реально проиграно (перемотка не считается)
setInterval(() => {
  const t = state.track;
  if (!t || audio.paused || !stats.cur || stats.cur.id !== t.id) { stats.lastTime = null; return; }
  const now = audio.currentTime;
  const prev = stats.lastTime;
  stats.lastTime = now;
  if (prev == null) return;
  const delta = now - prev;
  if (delta <= 0 || delta > 2.5) return;
  const d = stats.data;
  const day = dayKey(), month = monthKey();
  d.days[day] = (d.days[day] || 0) + delta;
  const rec = d.tracks[t.id] || (d.tracks[t.id] = { t: slimTrack(t), sec: 0, plays: 0, m: {} });
  rec.t = slimTrack(t);
  rec.sec += delta;
  const rm = rec.m[month] || (rec.m[month] = { sec: 0, plays: 0 });
  rm.sec += delta;
  stats.cur.listened += delta;
  // Прослушиванием считаем 30 секунд или половину короткого трека
  if (!stats.cur.counted && stats.cur.listened >= Math.min(30, (t.duration || audio.duration || 60) / 2)) {
    stats.cur.counted = true;
    rec.plays++;
    rm.plays++;
  }
  stats.dirty = true;
  if (profileOpen() && Math.floor(stats.cur.listened) % 15 === 0) renderStats(); // profile.js
}, 1000);

function fmtDur(sec, short = false) {
  const m = Math.round(sec / 60);
  if (m < 1) return sec > 0 ? 'меньше минуты' : '0 мин';
  const h = Math.floor(m / 60), mm = m % 60;
  if (!h) return `${m} мин`;
  if (short || !mm) return `${h} ч`;
  return `${h} ч ${mm} мин`;
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function splitArtists(s) {
  return (s || '').split(/\s*,\s*|\s+&\s+|\s+feat\.?\s+|\s+ft\.?\s+/i).map((x) => x.trim()).filter(Boolean);
}

function monthData(mk) {
  const [y, m] = mk.split('-').map(Number);
  const daysIn = new Date(y, m, 0).getDate();
  const all = statsAll();
  const days = Array.from({ length: daysIn }, (_, i) => all.days[`${mk}-${pad2(i + 1)}`] || 0);
  const total = days.reduce((a, b) => a + b, 0);
  const tracks = [];
  const artists = new Map();
  let plays = 0;
  for (const rec of Object.values(all.tracks)) {
    const rm = rec.m?.[mk];
    if (!rm || rm.sec < 1) continue;
    plays += rm.plays;
    tracks.push({ t: rec.t, plays: rm.plays, sec: rm.sec });
    for (const a of splitArtists(rec.t.artist)) artists.set(a, (artists.get(a) || 0) + rm.sec);
  }
  tracks.sort((a, b) => b.plays - a.plays || b.sec - a.sec);
  const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { y, m, daysIn, days, total, tracks, plays, topArtists };
}

function monthRange() {
  const keys = Object.keys(statsAll().days).map((k) => k.slice(0, 7)).sort();
  return { first: keys[0] || monthKey(), last: monthKey() };
}

function shiftMonth(mk, delta) {
  const [y, m] = mk.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

// Статистика живёт в профиле (profile.js)
function openStats() { openProfile({ to: 'stats' }); }
function closeStats() { closeProfile(); }

let statsTopList = [];

function renderStats() {
  const box = $('#stats');
  const allTime = Object.values(statsAll().days).reduce((a, b) => a + b, 0);
  if (allTime < 1) {
    box.innerHTML = `<h2 class="pf-h">Статистика</h2><div class="stats-empty"><h3>Пока пусто</h3><p>Включи любой трек. Время, артисты и топ треков месяца начнут считаться с первой минуты.</p></div>`;
    return;
  }
  const mk = stats.month;
  const md = monthData(mk);
  const { first, last } = monthRange();
  const isCurrent = mk === monthKey();
  const daysPassed = isCurrent ? new Date().getDate() : md.daysIn;
  const activeDays = md.days.filter((s) => s >= 60).length;
  statsTopList = md.tracks.slice(0, 10);

  box.innerHTML = `
    <div class="stats-head">
      <h2 class="pf-h">Статистика</h2>
      <div class="month-nav">
        <button class="icon-btn" id="m-prev" aria-label="Предыдущий месяц" ${mk <= first ? 'disabled' : ''}><svg><use href="#i-chevron-l"/></svg></button>
        <span class="label">${MONTHS[md.m - 1]} ${md.y}</span>
        <button class="icon-btn" id="m-next" aria-label="Следующий месяц" ${mk >= last ? 'disabled' : ''}><svg><use href="#i-chevron-r"/></svg></button>
      </div>
    </div>
    <div class="hero">
      <div class="hero-num">${esc(fmtDur(md.total))}</div>
      <div class="hero-sub">
        <span>музыки за ${isCurrent ? 'этот месяц' : MONTHS[md.m - 1]}</span>
        <span>в среднем <b>${esc(fmtDur(md.total / Math.max(1, daysPassed)))}</b> в день</span>
        <span><b>${md.plays}</b> ${plural(md.plays, 'прослушивание', 'прослушивания', 'прослушиваний')}</span>
        <span><b>${activeDays}</b> ${plural(activeDays, 'день', 'дня', 'дней')} с музыкой</span>
        <span>за всё время <b>${esc(fmtDur(allTime))}</b></span>
      </div>
    </div>
    <div class="chart" id="chart" role="img" aria-label="Минуты музыки по дням: ${MONTHS[md.m - 1]} ${md.y}"></div>
    <div class="stats-cols">
      <section>
        <h3>Топ-10 треков месяца</h3>
        ${statsTopList.length ? `<ol class="top-list">${statsTopList.map((x, i) => `
          <li><button class="top-item" data-top="${i}" title="Включить">
            <span class="top-rank">${i + 1}</span>
            ${x.t.cover ? `<img src="${esc(x.t.cover)}" alt="" loading="lazy">` : `<span class="ph">${esc((x.t.title || '♪')[0])}</span>`}
            <span class="top-main"><span class="top-title">${esc(x.t.title)}</span><span class="top-artist">${esc(x.t.artist || '')}</span></span>
            <span class="top-val">${x.plays} ${plural(x.plays, 'раз', 'раза', 'раз')}<br>${esc(fmtDur(x.sec))}</span>
          </button></li>`).join('')}</ol>` : '<p class="muted">В этом месяце треки ещё не набрали прослушиваний.</p>'}
      </section>
      <section>
        <h3>Артисты месяца</h3>
        ${md.topArtists.length ? md.topArtists.map(([name, sec]) => `
          <div class="artist-row">
            <span class="artist-name">${esc(name)}</span><span class="top-val">${esc(fmtDur(sec))}</span>
            <span class="artist-bar"><i style="width:${Math.max(2, (sec / md.topArtists[0][1]) * 100)}%"></i></span>
          </div>`).join('') : '<p class="muted">Пока никого.</p>'}
      </section>
    </div>`;

  $('#m-prev', box).onclick = () => { stats.month = shiftMonth(mk, -1); renderStats(); };
  $('#m-next', box).onclick = () => { stats.month = shiftMonth(mk, 1); renderStats(); };
  $$('[data-top]', box).forEach((b) => {
    b.onclick = async () => {
      const list = await api.meta.apply(statsTopList.map((x) => x.t)).catch(() => statsTopList.map((x) => x.t));
      playFrom(list, +b.dataset.top);
    };
  });
  drawChart($('#chart', box), md, isCurrent ? new Date().getDate() : 0);
}

// Столбцы по дням: одна серия, цвет акцента, скруглённый верх, подсказка при наведении
function drawChart(el, md, today) {
  const W = Math.max(320, el.clientWidth), H = 170, left = 44, bottom = 22, top = 8;
  const mins = md.days.map((s) => s / 60);
  const max = Math.max(...mins, 1);
  const step = [5, 10, 15, 30, 60, 90, 120, 180, 240, 360, 480, 720].find((s) => s * 2 >= max) || Math.ceil(max / 120) * 60;
  const yMax = step * 2;
  const plotH = H - bottom - top;
  const slot = (W - left) / md.daysIn;
  const bw = Math.max(2, slot - 2); // 2px зазор между столбцами
  const y = (v) => top + plotH - (v / yMax) * plotH;
  const label = (v) => (v >= 60 ? `${v / 60} ч` : `${v} мин`);
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`;
  for (const v of [0, step, yMax]) {
    svg += `<line class="grid" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="axis-label" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${v ? label(v) : '0'}</text>`;
  }
  md.days.forEach((s, i) => {
    const x = left + i * slot + (slot - bw) / 2;
    const v = s / 60;
    if (v > 0) {
      const h = Math.max(2, (v / yMax) * plotH);
      const r = Math.min(4, bw / 2, h);
      const y0 = top + plotH;
      const y1 = y0 - h;
      svg += `<path class="bar${i + 1 === today ? ' today' : ''}" data-d="${i}" d="M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y0} Z"/>`;
    }
    svg += `<rect class="hit" data-d="${i}" x="${left + i * slot}" y="${top}" width="${slot}" height="${plotH}"/>`;
    if (i === 0 || (i + 1) % 5 === 0) svg += `<text class="axis-label" x="${x + bw / 2}" y="${H - 4}" text-anchor="middle">${i + 1}</text>`;
  });
  svg += '</svg><div class="tip" hidden></div>';
  el.innerHTML = svg;
  const tip = $('.tip', el);
  el.onpointermove = (e) => {
    const hit = e.target.closest('[data-d]');
    $$('.bar.hover', el).forEach((b) => b.classList.remove('hover'));
    if (!hit) { tip.hidden = true; return; }
    const i = +hit.dataset.d;
    $(`.bar[data-d="${i}"]`, el)?.classList.add('hover');
    const r = el.getBoundingClientRect();
    const scale = r.width / W;
    tip.hidden = false;
    tip.innerHTML = `${i + 1} ${MONTHS_GEN[md.m - 1]} <span>${esc(md.days[i] ? fmtDur(md.days[i]) : 'без музыки')}</span>`;
    tip.style.left = `${(left + i * slot + slot / 2) * scale}px`;
    tip.style.top = `${y(md.days[i] / 60) * (r.height / H)}px`;
  };
  el.onpointerleave = () => { tip.hidden = true; $$('.bar.hover', el).forEach((b) => b.classList.remove('hover')); };
}


// ---------- редактор тегов своих файлов ----------

const editor = { track: null, cover: { type: 'keep' } };

function editorArt(url, fallback) {
  $('#editor-art').innerHTML = url ? `<img src="${esc(url)}" alt="">` : esc((fallback || '♪').trim()[0]?.toUpperCase() || '♪');
}

function openEditor(track) {
  if (!track || track.source !== 'local') return;
  closeMenu();
  editor.track = track;
  editor.cover = { type: 'keep' };
  $('#ed-title').value = track.title || '';
  $('#ed-artist').value = track.artist || '';
  $('#ed-album').value = track.album || '';
  $('#editor-file').textContent = track.ref.path;
  $('#editor-reset').hidden = !track.edited;
  $('#lookup-results').innerHTML = '';
  editorArt(track.cover, track.title);
  $('#editor').hidden = false;
  $('#ed-title').focus();
}

function closeEditor() { $('#editor').hidden = true; editor.track = null; }

async function pickEditorCover() {
  try {
    const r = await api.meta.pickCover();
    if (!r) return;
    editor.cover = { type: 'file', path: r.path };
    editorArt(r.preview);
  } catch (e) { toast(e.message, 'err'); }
}

$('#editor-art').onclick = pickEditorCover;
$('#editor-pick').onclick = pickEditorCover;
$('#editor-nocover').onclick = () => { editor.cover = { type: 'none' }; editorArt('', $('#ed-title').value); };
$('#editor-close').onclick = closeEditor;
$('#editor-cancel').onclick = closeEditor;
$('#editor').addEventListener('pointerdown', (e) => { if (e.target.id === 'editor') closeEditor(); });
$('#editor').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeEditor(); } });

$('#editor-find').onclick = async () => {
  const q = [$('#ed-artist').value, $('#ed-title').value].map((s) => s.trim()).filter(Boolean).join(' ');
  const box = $('#lookup-results');
  if (!q) { box.innerHTML = '<div class="lookup-msg">Впиши название или исполнителя, чтобы было что искать.</div>'; return; }
  box.innerHTML = '<div class="lookup-msg">Ищу…</div>';
  try {
    const results = await api.meta.lookup(q);
    if (!results.length) { box.innerHTML = '<div class="lookup-msg">Ничего не нашлось. Попробуй убрать лишнее из названия.</div>'; return; }
    box.innerHTML = results.map((r, i) => `
      <button type="button" class="lookup-item" data-r="${i}">
        ${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : '<span></span>'}
        <span><span class="l1">${esc(r.title)}</span><span class="l2">${esc([r.artist, r.album, r.year].filter(Boolean).join(', '))}</span></span>
      </button>`).join('');
    $$('.lookup-item', box).forEach((b) => {
      b.onclick = () => {
        const r = results[+b.dataset.r];
        $$('.lookup-item', box).forEach((x) => x.classList.toggle('on', x === b));
        $('#ed-title').value = r.title;
        $('#ed-artist').value = r.artist;
        $('#ed-album').value = r.album;
        if (r.cover) { editor.cover = { type: 'url', url: r.cover }; editorArt(r.cover); }
      };
    });
  } catch (e) {
    box.innerHTML = `<div class="lookup-msg">Поиск не сработал: ${esc(e.message)}</div>`;
  }
};

$('#editor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = editor.track;
  if (!t) return;
  const btn = $('#editor-save');
  btn.disabled = true;
  try {
    const updated = await api.meta.edit(t.ref.path, {
      title: $('#ed-title').value, artist: $('#ed-artist').value, album: $('#ed-album').value,
    }, editor.cover);
    replaceTrackEverywhere(updated);
    toast('Теги сохранены');
    closeEditor();
  } catch (err) { toast(err.message, 'err'); }
  btn.disabled = false;
});

$('#editor-reset').onclick = async () => {
  const t = editor.track;
  if (!t) return;
  try {
    replaceTrackEverywhere(await api.meta.reset(t.ref.path));
    toast('Теги возвращены из файла');
    closeEditor();
  } catch (err) { toast(err.message, 'err'); }
};

function replaceTrackEverywhere(t) {
  const swap = (list) => { if (!list) return; for (let i = 0; i < list.length; i++) if (list[i]?.id === t.id) list[i] = t; };
  swap(state.local); swap(state.opened); swap(state.queue); swap(state.shown); swap(state.album?.tracks);
  if (stats.data.tracks[t.id]) stats.data.tracks[t.id].t = slimTrack(t);
  if (state.track?.id === t.id) {
    state.track = t;
    showNow(t, null);
    saveSession();
  }
  if (state.view === 'local') renderLocal();
  else if (state.view === 'albums') renderAlbum();
  refreshAlbums();
}

// ---------- текст песни (LRCLIB) ----------

const ly = { track: null, lines: [], active: -1, sung: -1, userScrollAt: 0, raf: 0, seq: 0 };
const LYRICS_FROM = { musixmatch: 'Musixmatch', lrclib: 'LRCLIB' };

function parseLRC(text) {
  let offset = 0;
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (off) { offset = +off[1] / 1000; continue; }
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!tags.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) lines.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')) - offset, text: words });
  }
  return lines.sort((a, b) => a.t - b.t);
}

function lyricsOpen() { return !$('#lyrics').hidden; }

function openLyrics() {
  closeStats();
  $('#lyrics').hidden = false;
  $('#btn-lyrics').setAttribute('aria-pressed', 'true');
  if (state.track && ly.track?.id !== state.track.id) loadLyrics(state.track);
  else if (!state.track) renderLyricsEmpty('Сначала включи трек', 'Текст появится здесь и будет идти вместе с музыкой.');
  startLyricsSync();
}

function closeLyrics() {
  $('#lyrics').hidden = true;
  $('#btn-lyrics').setAttribute('aria-pressed', 'false');
  cancelAnimationFrame(ly.raf);
}

function renderLyricsEmpty(title, text) {
  ly.lines = [];
  $('#lyrics-body').innerHTML = `<div class="lyrics-empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
}

async function loadLyrics(track) {
  const seq = ++ly.seq;
  ly.track = track;
  ly.lines = [];
  ly.active = -1;
  ly.sung = -1;
  const meta = `${track.title}${track.artist ? ` — ${track.artist}` : ''}`;
  $('#lyrics-meta').textContent = meta;
  $('#lyrics-body').innerHTML = '<div class="lyrics-empty"><div class="spinner"></div></div>';
  let res;
  try {
    res = await api.lyrics(track);
  } catch (e) {
    if (seq === ly.seq) renderLyricsEmpty('Текст не загрузился', `Проверь интернет и открой текст ещё раз. ${e.message}`);
    return;
  }
  if (seq !== ly.seq) return;
  const body = $('#lyrics-body');
  body.classList.remove('lyrics-plain');
  if (res.from) $('#lyrics-meta').textContent = `${meta} · текст: ${LYRICS_FROM[res.from]}`;
  if (res.words?.length) {
    // Musixmatch знает время каждого слова: слова загораются по одному, как в караоке
    // Musixmatch режет «пиф-пау» на «пиф-» и «пау» — после дефиса пробел не ставим
    const gap = (words, i) => (i && !words[i - 1].text.endsWith('-') ? ' ' : '');
    ly.lines = res.words.map((l) => ({ t: l.ts, words: l.words }));
    body.innerHTML = ly.lines.map((l, i) => `<button class="lyric karaoke" data-l="${i}">${l.words.map((w, j) => `${gap(l.words, j)}<span class="w">${esc(w.text)}</span>`).join('')}</button>`).join('');
    body.scrollTop = 0;
    syncLyrics(true);
  } else if (res.synced) {
    ly.lines = parseLRC(res.synced);
    body.innerHTML = ly.lines.map((l, i) => `<button class="lyric${l.text ? '' : ' gap'}" data-l="${i}">${l.text ? esc(l.text) : '♪ ♪ ♪'}</button>`).join('');
    body.scrollTop = 0;
    syncLyrics(true);
  } else if (res.plain) {
    body.classList.add('lyrics-plain');
    body.innerHTML = `<p class="lyrics-note">У этого трека в LRCLIB текст без таймкодов, поэтому строки не подсвечиваются.</p>`
      + res.plain.split(/\r?\n/).map((l) => `<span class="lyric">${esc(l) || '&nbsp;'}</span>`).join('');
  } else if (res.instrumental) {
    renderLyricsEmpty('Здесь без слов', 'В LRCLIB этот трек отмечен как инструментальный.');
  } else {
    renderLyricsEmpty('Текст не нашёлся', `Ни в Musixmatch, ни в LRCLIB нет текста для «${track.title}». Если это свой файл, поправь название и исполнителя в тегах и открой текст снова.`);
  }
}

// Когда слово допето: начало следующего слова, иначе начало следующей строки. Долгую паузу после
// слова не растягиваем — буквы заливаются не дольше 1,2 с
function wordEnd(lines, li, wi) {
  const l = lines[li];
  const next = l.words[wi + 1]?.t ?? lines[li + 1]?.t ?? l.words[wi].t + 1;
  return Math.min(next, l.words[wi].t + 1.2);
}

// Подсветка текущей строки и плавная прокрутка к ней
// Слова активной строки: спетые подсвечиваются. Если у текста есть время слов (richsync Musixmatch),
// текущее слово заливается по буквам (--p от 0 до 1) — каждый кадр, остальное меняем только по событию
function syncWords(force) {
  const l = ly.lines[ly.active];
  if (!l?.words) return;
  const t = audio.currentTime + 0.05;
  let n = 0;
  while (n < l.words.length && l.words[n].t <= t) n++;
  const letters = window.LOOK?.lyricsLetters !== false; // look.js
  const nodes = $$('.w', $(`.lyric[data-l="${ly.active}"]`, $('#lyrics-body')));
  if (n !== ly.sung || force) {
    ly.sung = n;
    nodes.forEach((w, i) => w.classList.toggle('sung', i < n));
  }
  // текущее слово — последнее начатое, пока не допето
  const cur = n - 1;
  nodes.forEach((w, i) => {
    const on = letters && i === cur && t < wordEnd(ly.lines, ly.active, cur);
    // w-now, а не now: .now — это блок «сейчас играет», и в «Стекле» его стиль (блок, отступ сверху) цеплялся
    // к слову — текущее слово рвало строку текста
    if (!on && w.classList.contains('w-now')) w.classList.add('filled'); // залито — дальше без перехода цвета
    w.classList.toggle('w-now', on);
    if (on) {
      const s = l.words[cur].t;
      w.style.setProperty('--p', Math.min(1, Math.max(0, (t - s) / Math.max(0.05, wordEnd(ly.lines, ly.active, cur) - s))).toFixed(3));
    }
  });
}

function syncLyrics(force = false) {
  if (!ly.lines.length) return;
  const t = audio.currentTime + 0.2; // небольшой запас, чтобы строка загоралась вместе с голосом
  let idx = -1;
  for (let i = 0; i < ly.lines.length && ly.lines[i].t <= t; i++) idx = i;
  if (idx === ly.active && !force) {
    syncWords(false);
    return;
  }
  ly.active = idx;
  const nodes = $$('.lyric', $('#lyrics-body'));
  syncWords(true);
  nodes.forEach((n, i) => {
    n.classList.toggle('active', i === idx);
    n.classList.toggle('past', i < idx);
  });
  // Если пользователь сам листает текст — не мешаем ему 3 секунды
  if (performance.now() - ly.userScrollAt < 3000) return;
  const el = nodes[Math.max(0, idx)];
  if (!el) return;
  const body = $('#lyrics-body');
  body.scrollTo({ top: el.offsetTop - body.clientHeight * 0.36, behavior: force ? 'auto' : 'smooth' });
}

function startLyricsSync() {
  cancelAnimationFrame(ly.raf);
  const loop = () => {
    if (!lyricsOpen()) return;
    if (!audio.paused || audio.seeking) syncLyrics();
    ly.raf = requestAnimationFrame(loop);
  };
  ly.raf = requestAnimationFrame(loop);
}

$('#lyrics-body').addEventListener('click', (e) => {
  const b = e.target.closest('button.lyric');
  if (!b || !ly.lines.length) return;
  audio.currentTime = Math.max(0, ly.lines[+b.dataset.l].t);
  ly.userScrollAt = 0;
  if (audio.paused) togglePlay();
  syncLyrics(true);
});
for (const ev of ['wheel', 'touchmove', 'pointerdown']) {
  $('#lyrics-body').addEventListener(ev, () => { ly.userScrollAt = performance.now(); }, { passive: true });
}
onAudio('seeked', () => { if (lyricsOpen()) { ly.userScrollAt = 0; syncLyrics(true); } });
$('#btn-lyrics').onclick = () => (lyricsOpen() ? closeLyrics() : openLyrics());
$('#lyrics-close').onclick = closeLyrics;

// ---------- связка с app.js ----------

// Вызывается из showNow при смене трека
function onTrackShown(track) {
  applyThemeFrom(track.cover);
  if (stats.cur?.id !== track.id) statsOnTrack(track);
  if (lyricsOpen() && ly.track?.id !== track.id) loadLyrics(track);
  if (cz.trackId !== track.id) censorLoad(track); // censor.js
  const editable = track.source === 'local' && !track.shared;
  $('#now-cover').classList.toggle('editable', editable);
  $('#now-title').classList.toggle('editable', editable);
  $('#now-cover').title = editable ? 'Изменить обложку и теги' : '';
}

for (const id of ['#now-cover', '#now-title']) { // имя исполнителя — ссылка на артиста (artists.js)
  $(id).addEventListener('click', () => { if (state.track?.source === 'local' && !state.track.shared) openEditor(state.track); });
}

function hideOverlays() { closeStats(); closeLyrics(); }

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || e.ctrlKey || e.altKey) return;
  if (!$('#editor').hidden || !$('#dialog').hidden) return;
  if (e.code === 'KeyL') { lyricsOpen() ? closeLyrics() : openLyrics(); }
});
