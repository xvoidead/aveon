'use strict';
// Волна — бесконечный поток под твой вкус, как «Моя волна» в Яндексе или DJ в Spotify.
// С Яндекс Музыкой — настоящая «Моя волна» аккаунта (src/services/yandex.js → rotor): настроение,
// характер, язык; лайки, дизлайки и пропуски уходят обратно, и волна подстраивается.
// Без неё — своя волна: любимое из статистики прослушиваний + похожее из подключённых сервисов.
// Диджей между треками говорит, что дальше; музыка на это время уходит в бочку.
// Общие глобальные из app.js и соседей: state, api, audio, fx, duck, stats, $, esc, toast, saveCfg,
// playFrom, next, renderTracks, openView, onAudio, IS_MOBILE, plural.

const WAVE_DEFAULTS = { mood: 'all', diversity: 'default', language: 'any', dj: false, djEvery: 2, djRate: 1, djVoice: '' };
const MOODS = [['all', 'Любое'], ['active', 'Бодрое'], ['fun', 'Весёлое'], ['calm', 'Спокойное'], ['sad', 'Грустное']];
const DIVERSITY = [['default', 'Как обычно'], ['favorite', 'Любимое'], ['discover', 'Незнакомое'], ['popular', 'Популярное']];
const LANGS = [['any', 'Любой'], ['russian', 'Русский'], ['not-russian', 'Иностранный'], ['without-words', 'Без слов']];

const Wave = {
  active: false,     // очередь сейчас — волна
  starting: false,   // playFrom вызывает сама волна — не выключаться
  loading: false,
  mode: null,        // ym | own
  heard: new Set(),  // что уже звучало в этой волне — без повторов
  banned: new Set(), // «не нравится» в своей волне: такого артиста больше не ставим
  current: null,     // { track, startedAt } — для «дослушал / пропустил»
  sinceDj: 0,
};
const waveCfg = () => ({ ...WAVE_DEFAULTS, ...(state.cfg?.wave || {}) });
const waveMode = () => (state.cfg?.has?.['ym.token'] ? 'ym' : 'own');
const artistOf = (t) => String(t?.artist || '').split(',')[0].trim().toLowerCase();

// ---------- своя волна ----------

function pickWeighted(items, weight) {
  const total = items.reduce((n, x) => n + weight(x), 0);
  let r = Math.random() * total;
  for (const x of items) { r -= weight(x); if (r <= 0) return x; }
  return items[items.length - 1];
}

// Любимое: треки из статистики, чем дольше слушал — тем вероятнее
function statsTracks() {
  return Object.values(stats?.data?.tracks || {}).filter((r) => r.t && r.t.playable !== false && r.sec > 30);
}

async function ownBatch(size = 8) {
  const cfg = waveCfg();
  const favShare = { favorite: 0.8, discover: 0.15, popular: 0.4, default: 0.5 }[cfg.diversity] ?? 0.5;
  const played = statsTracks();
  const known = new Set(played.map((r) => r.t.id));
  const artists = [...new Set(played.sort((a, b) => b.sec - a.sec).map((r) => artistOf(r.t)).filter(Boolean))].slice(0, 20);
  const fresh = (t) => t && t.playable !== false && !Wave.heard.has(t.id) && !Wave.banned.has(artistOf(t)) && !t.preview;
  const out = [];

  // из любимого
  const favPool = played.filter((r) => fresh(r.t));
  for (let i = 0; i < Math.round(size * favShare) && favPool.length; i++) {
    const r = pickWeighted(favPool, (x) => Math.sqrt(x.sec));
    favPool.splice(favPool.indexOf(r), 1);
    out.push(r.t);
  }

  // новое: похожее из SoundCloud по треку-затравке и треки любимых артистов из сервисов
  const services = ['sc', 'sp'].filter((s) => (s === 'sc' ? !!state.cfg.sc.clientId : !!state.sp.connected));
  const need = size - out.length;
  const found = [];
  try {
    const seed = played.filter((r) => r.t.source === 'sc').sort(() => Math.random() - 0.5)[0];
    if (seed) found.push(...(await api.wave.related(seed.t)));
  } catch {}
  for (let tries = 0; found.filter(fresh).length < need * 2 && tries < 3 && services.length && artists.length; tries++) {
    const a = artists[Math.floor(Math.random() * Math.min(artists.length, 10 + tries * 5))];
    const src = services[Math.floor(Math.random() * services.length)];
    try { found.push(...(await api.source.search(src, a))); } catch {}
  }
  const discover = found.filter((t) => fresh(t) && (cfg.diversity !== 'discover' || !known.has(t.id)));
  for (const t of discover.sort(() => Math.random() - 0.5)) {
    if (out.length >= size) break;
    if (!out.some((x) => x.id === t.id)) out.push(t);
  }

  // ничего не подключено и статистики мало — свои файлы
  if (out.length < size && state.local?.length) {
    for (const t of state.local.filter(fresh).sort(() => Math.random() - 0.5).slice(0, size - out.length)) out.push(t);
  }
  return out.sort(() => Math.random() - 0.5);
}

// ---------- общая часть ----------

async function waveBatch(first) {
  if (Wave.mode === 'ym') {
    const settings = { mood: waveCfg().mood, diversity: waveCfg().diversity, language: waveCfg().language };
    const list = first ? await api.wave.start(settings) : await api.wave.more(state.queue.slice(-10));
    return list.filter((t) => !Wave.heard.has(t.id));
  }
  return ownBatch();
}

async function waveStart() {
  if (Wave.loading) return;
  Wave.loading = true;
  Wave.mode = waveMode();
  Wave.heard.clear();
  Wave.sinceDj = 99; // первым делом диджей здоровается
  renderWaveHero();
  try {
    let list = await waveBatch(true);
    if (!list.length) list = Wave.mode === 'ym' ? [] : await ownBatch(12);
    if (!list.length) {
      toast(Wave.mode === 'ym' ? 'Волна не ответила — попробуй ещё раз' : 'Волне пока не из чего собраться: послушай что-нибудь или подключи SoundCloud / Spotify', true);
      return;
    }
    list.forEach((t) => Wave.heard.add(t.id));
    Wave.starting = true;
    Wave.active = true;
    state.cfg.shuffle && toggleShuffle(); // волна идёт по порядку
    playFrom(list, 0);
    Wave.starting = false;
    if (Wave.mode === 'ym') api.wave.feedback('radioStarted', null).catch(() => {});
    if (state.view === 'wave') renderWave();
  } catch (e) {
    toast(`Волна: ${e.message}`, true);
  } finally {
    Wave.loading = false;
    renderWaveHero();
  }
}

function waveStop() {
  if (!Wave.active) return;
  Wave.active = false;
  Wave.current = null;
  stopDj();
  renderWaveHero();
}

// Впереди мало треков — подкидываем ещё (app.js → next, и заранее при каждом новом треке)
let extending = null;
function waveExtend() {
  if (!Wave.active) return Promise.resolve(0);
  if (extending) return extending;
  extending = (async () => {
    try {
      const list = (await waveBatch(false)).filter((t) => !Wave.heard.has(t.id));
      list.forEach((t) => Wave.heard.add(t.id));
      const start = state.queue.length;
      state.queue.push(...list);
      state.order.push(...list.map((_, i) => start + i));
      if (state.view === 'wave') renderWave();
      return list.length;
    } catch (e) {
      console.warn('wave:', e.message);
      return 0;
    } finally {
      extending = null;
    }
  })();
  return extending;
}

// ---------- отклик: дослушал, пропустил, нравится ----------

function trackChanged() {
  const t = state.track;
  if (!Wave.active || !t) return;
  if (Wave.current?.track?.id === t.id) return;
  const prevT = Wave.current;
  if (prevT && Wave.mode === 'ym') {
    const played = (performance.now() - prevT.startedAt) / 1000;
    const dur = prevT.track.duration || 0;
    api.wave.feedback(dur && played >= dur * 0.85 ? 'trackFinished' : 'skip', prevT.track, played).catch(() => {});
  }
  Wave.current = { track: t, startedAt: performance.now() };
  if (Wave.mode === 'ym') api.wave.feedback('trackStarted', t).catch(() => {});
  if (state.order.length - state.pos <= 3) waveExtend();
  maybeDj(t);
  renderWaveHero();
}
onAudio('play', trackChanged);

async function waveLike() {
  const t = state.track;
  if (!t) return;
  if (Wave.mode === 'ym') await api.wave.feedback('like', t).catch(() => {});
  toast(`«${t.title}» — нравится, волна учтёт`);
}

async function waveDislike() {
  const t = state.track;
  if (!t) return;
  if (Wave.mode === 'ym') await api.wave.feedback('dislike', t).catch(() => {});
  else Wave.banned.add(artistOf(t));
  toast('Больше такого не будет');
  next();
}

// ---------- диджей ----------

let djVoices = [];
function loadVoices() {
  if (IS_MOBILE || !window.speechSynthesis) return;
  djVoices = speechSynthesis.getVoices().filter((v) => /^ru/i.test(v.lang));
}
if (!IS_MOBILE && window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

function djLine(t) {
  const who = String(t.artist || '').split(',')[0].trim() || 'кто-то';
  const title = String(t.title || '').replace(/\s*[([].*?[)\]]\s*/g, ' ').trim();
  const fav = statsTracks().some((r) => r.t.id === t.id);
  if (Wave.sinceDj >= 99) {
    const mood = { active: 'бодрое', fun: 'весёлое', calm: 'спокойное', sad: 'грустное' }[waveCfg().mood];
    return `${greeting()}! Это авеон, ваша волна${mood ? ` — сегодня ${mood}` : ''}. Начнём с ${who}: «${title}».`;
  }
  if (fav) return pick([`Из твоего любимого — ${who}, «${title}».`, `Возвращаемся к тому, что ты любишь: ${who}.`, `Это ты слушал много раз — ${who}, «${title}».`]);
  return pick([
    `Дальше — ${who}, «${title}».`,
    `А теперь ${who} с треком «${title}».`,
    `Следующим — «${title}». Исполняет ${who}.`,
    `Этого, кажется, ты ещё не слышал: ${who}.`,
    `Держи что-то новое — ${who}, «${title}».`,
  ]);
}

function speak(text) {
  const cfg = waveCfg();
  if (IS_MOBILE) return api.wave.speak(text, { rate: cfg.djRate });
  if (!window.speechSynthesis) return Promise.resolve();
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    u.rate = cfg.djRate;
    const v = djVoices.find((x) => x.name === cfg.djVoice) || djVoices[0];
    if (v) u.voice = v;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
    setTimeout(resolve, 15000); // голос завис — не держим музыку в бочке вечно
  });
}

// Говорит поверх начала трека, музыка на это время в бочке (app.js → duckTick учитывает duck.dj)
async function maybeDj(t) {
  const cfg = waveCfg();
  if (!cfg.dj) return;
  Wave.sinceDj++;
  if (Wave.sinceDj < 99 && Wave.sinceDj < cfg.djEvery) return;
  const text = djLine(t);
  Wave.sinceDj = 0;
  duck.dj = true;
  try { await speak(text); } finally { duck.dj = false; }
}

function stopDj() {
  duck.dj = false;
  if (IS_MOBILE) api.wave.stopSpeak?.();
  else window.speechSynthesis?.cancel();
}

// ---------- экран «Волна»: эфир и шкала приёмника ----------
// Сверху — эфир: тонкие линии, которые качаются под музыку, и слово «волна», чьи буквы плывут
// на средней линии. Ниже — настройки как шкала радиоприёмника: клик по делению переводит стрелку.

// Диджей на шкале: от «молчит» до «каждый трек» — одна шкала вместо двух рядов кнопок
const DJ_STOPS = [['off', 'Молчит'], ['4', 'Изредка'], ['2', 'Через один'], ['1', 'Каждый трек']];
const djStop = (cfg) => (cfg.dj ? String(cfg.djEvery) : 'off');

function tunerHtml(key, label, opts, cur) {
  const i = Math.max(0, opts.findIndex(([v]) => v === cur));
  const n = opts.length;
  return `<div class="tuner" data-wave="${key}" style="--n:${n};--at:${i}">
    <span class="tuner-name">${label}</span>
    <div class="tuner-band" role="radiogroup" aria-label="${label}">
      <i class="tuner-needle" aria-hidden="true"></i>
      ${opts.map(([v, t], k) => `<button role="radio" aria-checked="${k === i}" data-v="${v}" class="${k === i ? 'on' : ''}">${t}</button>`).join('')}
    </div>
  </div>`;
}

function renderWaveHero() {
  const box = $('#wave-hero');
  if (!box || box.hidden) return;
  const cfg = waveCfg();
  const ym = waveMode() === 'ym';
  const on = Wave.active && state.track;
  const playing = Wave.active && !audio.paused;
  box.classList.toggle('live', playing);
  box.classList.toggle('dj-on', !!duck.dj);
  const go = box.querySelector('.wave-go');
  go.innerHTML = Wave.loading ? '<span class="spinner small"></span>' : `<svg><use href="#${playing ? 'i-pause' : 'i-play'}"/></svg>`;
  go.setAttribute('aria-label', playing ? 'Пауза' : Wave.active ? 'Продолжить волну' : 'Включить волну');
  box.querySelector('.wave-now').innerHTML = on
    ? `<b>${esc(state.track.title)}</b><span>${esc(state.track.artist || '')}</span>`
    : `<b>${ym ? 'Моя волна' : 'Своя волна'}</b><span>${ym ? 'Из твоей Яндекс Музыки. Лайки и пропуски её направляют.' : 'Из того, что ты слушаешь, и похожего в подключённых сервисах.'}</span>`;
  box.querySelector('.wave-rate').hidden = !Wave.active;

  const tuner = $('#wave-tuner');
  tuner.innerHTML = `
    ${ym ? tunerHtml('mood', 'Настроение', MOODS, cfg.mood) : ''}
    ${tunerHtml('diversity', 'Характер', DIVERSITY, cfg.diversity)}
    ${ym ? tunerHtml('language', 'Язык', LANGS, cfg.language) : ''}
    ${tunerHtml('djStop', 'Диджей', DJ_STOPS, djStop(cfg))}
    ${cfg.dj && !IS_MOBILE && djVoices.length > 1 ? `<label class="tuner-voice"><span class="tuner-name">Голос</span><select class="input wave-voice">${djVoices.map((v) => `<option ${v.name === cfg.djVoice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>` : ''}`;
  bindWaveOpts(tuner);
}

function bindWaveOpts(box) {
  box.querySelectorAll('.tuner').forEach((t) => {
    const key = t.dataset.wave;
    t.querySelectorAll('button').forEach((b, i) => {
      b.onclick = async () => {
        t.style.setProperty('--at', i); // стрелка переезжает сразу, сохранение — следом
        t.querySelectorAll('button').forEach((x, k) => { x.classList.toggle('on', k === i); x.setAttribute('aria-checked', String(k === i)); });
        const v = b.dataset.v;
        if (key === 'djStop') {
          const dj = v !== 'off';
          await saveCfg({ wave: dj ? { dj, djEvery: +v } : { dj } });
          if (dj && Wave.active && state.track) { Wave.sinceDj = 99; maybeDj(state.track); }
          if (!dj) stopDj();
        } else {
          await saveCfg({ wave: { [key]: v } });
          if (Wave.active) waveStart(); // новое настроение, характер или язык — волна перестраивается
        }
        renderWaveHero();
      };
    });
  });
  const voice = box.querySelector('.wave-voice');
  if (voice) voice.onchange = () => saveCfg({ wave: { djVoice: voice.value } });
}

function ensureWaveHero() {
  let box = $('#wave-hero');
  if (box) return box;
  box = document.createElement('section');
  box.className = 'wave-hero';
  box.id = 'wave-hero';
  box.hidden = true;
  box.innerHTML = `
    <div class="wave-air">
      <canvas class="wave-canvas" id="wave-canvas" aria-hidden="true"></canvas>
      <h2 class="wave-word" id="wave-word" aria-label="Волна">${[...'волна'].map((c) => `<span aria-hidden="true">${c}</span>`).join('')}</h2>
    </div>
    <div class="wave-deck">
      <button class="wave-go" id="wave-go"></button>
      <div class="wave-now"></div>
      <div class="wave-rate" hidden>
        <button class="icon-btn" id="wave-like" aria-label="Нравится" title="Нравится"><svg><use href="#i-heart"/></svg></button>
        <button class="icon-btn" id="wave-dislike" aria-label="Не нравится" title="Не нравится: пропустить и больше не ставить"><svg><use href="#i-dislike"/></svg></button>
      </div>
    </div>
    <div class="wave-tuner" id="wave-tuner"></div>
    <h3 class="wave-next" id="wave-next" hidden>Дальше в волне</h3>`;
  $('#tracklist').before(box);
  box.querySelector('#wave-go').onclick = () => {
    if (Wave.loading) return;
    if (Wave.active) togglePlay(); else waveStart();
  };
  box.querySelector('#wave-like').onclick = waveLike;
  box.querySelector('#wave-dislike').onclick = waveDislike;
  new ResizeObserver(measureWord).observe(box);
  requestAnimationFrame(drawWave);
  return box;
}

// app.js → openView('wave')
function renderWave() {
  const box = ensureWaveHero();
  box.hidden = false;
  $('#content').classList.add('wave-on');
  renderWaveHero();
  measureWord();
  const next = $('#wave-next');
  if (Wave.active && state.queue.length) {
    const upcoming = state.order.slice(Math.max(0, state.pos)).map((i) => state.queue[i]).filter(Boolean);
    renderTracks(upcoming, '');
    next.hidden = false;
  } else {
    renderTracks([], '');
    $('#empty').hidden = true;
    next.hidden = true;
  }
}

function leaveWaveView() {
  const box = $('#wave-hero');
  if (box) box.hidden = true;
  $('#content').classList.remove('wave-on');
}

// ---- эфир ----
// Семь линий: у каждой своя частота и фаза, вместе — как рябь на осциллографе. Энергия — из басов,
// пока играет волна; тихо — линии едва дышат. Средняя линия несёт буквы слова «волна».

const waveBins = new Uint8Array(1024);
const LINES = 7;
let wavePhase = 0, waveEnergy = 0.12;
let letters = []; // центры букв относительно холста, в CSS-пикселях

function measureWord() {
  const c = $('#wave-canvas'), word = $('#wave-word');
  if (!c || !word) return;
  const base = c.getBoundingClientRect();
  letters = [...word.children].map((s) => {
    s.style.transform = '';
    const r = s.getBoundingClientRect();
    return { el: s, x: r.left + r.width / 2 - base.left, w: base.width };
  });
}

// Высота линии k в точке t (0…1 по ширине), в долях амплитуды
function lineAt(k, t) {
  const f = 1.6 + k * 0.45;
  return Math.sin(t * Math.PI * f + wavePhase * (0.8 + k * 0.17) + k * 1.3) * 0.7
    + Math.sin(t * Math.PI * (f * 2.3) - wavePhase * 1.1 + k) * 0.3;
}

const still = () => document.documentElement.classList.contains('look-still') || matchMedia('(prefers-reduced-motion: reduce)').matches;

function drawWave() {
  const c = $('#wave-canvas');
  const box = $('#wave-hero');
  if (c && box && !box.hidden && !document.hidden) {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth * dpr, h = c.clientHeight * dpr;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; measureWord(); }
    let target = 0.12;
    if (Wave.active && !audio.paused && fx.analyser) {
      const d = waveBins.subarray(0, fx.analyser.frequencyBinCount);
      fx.analyser.getByteFrequencyData(d);
      let s = 0;
      for (let i = 1; i < 24; i++) s += d[i];
      target = 0.3 + Math.pow(s / 23 / 255, 1.4) * 1.1 * (window.LOOK?.reactGain ?? 100) / 100;
    }
    waveEnergy += (target - waveEnergy) * 0.07;
    if (!still()) wavePhase += 0.008 + waveEnergy * 0.022;

    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.documentElement);
    const amber = cs.getPropertyValue('--amber').trim() || '#f0a63a';
    const voice = cs.getPropertyValue('--voice').trim() || '#9aa8ff';
    const mid = Math.floor(LINES / 2);
    const amp = h * 0.075 * (0.4 + waveEnergy);
    for (let k = 0; k < LINES; k++) {
      const y0 = h * (0.2 + (k / (LINES - 1)) * 0.6);
      g.beginPath();
      g.lineWidth = (k === mid ? 2.2 : 1) * dpr;
      g.strokeStyle = k === mid && (duck.dj || duck.m > 0.5) ? voice : amber;
      g.globalAlpha = k === mid ? 0.95 : 0.16 + (1 - Math.abs(k - mid) / mid) * 0.32;
      for (let x = 0; x <= w; x += 4 * dpr) {
        const t = x / w;
        const env = Math.sin(t * Math.PI) * 0.85 + 0.15; // к краям затихают
        const y = y0 + lineAt(k, t) * amp * env;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;

    // буквы — на средней линии
    const y0 = 0.2 + (mid / (LINES - 1)) * 0.6;
    for (const L of letters) {
      const t = L.x / (L.w || 1);
      const env = Math.sin(t * Math.PI) * 0.85 + 0.15;
      const dy = (lineAt(mid, t) * amp * env) / dpr;
      const slope = (lineAt(mid, t + 0.01) - lineAt(mid, t)) * amp * env / dpr;
      L.el.style.transform = `translateY(${dy.toFixed(1)}px) rotate(${Math.max(-8, Math.min(8, slope * 1.2)).toFixed(1)}deg)`;
    }
    void y0;
  }
  requestAnimationFrame(drawWave);
}

for (const ev of ['play', 'pause']) onAudio(ev, renderWaveHero);
