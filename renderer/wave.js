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

// ---------- экран «Волна»: эфир и фраза-настройка ----------
// Сверху — эфир: тонкие линии, которые качаются под музыку, и слово «волна», чьи буквы плывут
// на средней линии. Ниже — настройки одной фразой, слова в ней листаются кликами.

// Настройки волны — одной фразой: «Хочу спокойное, незнакомое, на русском. Диджей говорит через трек».
// Слова с волнистым подчёркиванием: ЛКМ — дальше по кругу, ПКМ — назад, колёсико — окно со всеми.
const PHRASE = {
  mood: [['all', 'что угодно'], ['active', 'бодрое'], ['fun', 'весёлое'], ['calm', 'спокойное'], ['sad', 'грустное']],
  diversity: [['default', 'как обычно'], ['favorite', 'из любимого'], ['discover', 'незнакомое'], ['popular', 'популярное']],
  language: [['any', 'на любом языке'], ['russian', 'на русском'], ['not-russian', 'на иностранном'], ['without-words', 'без слов']],
  dj: [['off', 'молчит'], ['4', 'говорит изредка'], ['2', 'говорит через трек'], ['1', 'говорит перед каждым треком']],
};
const djStop = (cfg) => (cfg.dj ? String(cfg.djEvery) : 'off');
const voiceShort = (name) => String(name || '').replace(/^Microsoft\s+/i, '').replace(/\s*[-–(].*$/, '').trim() || name;

// Слово-кнопка вместе со знаком после него — чтобы запятая или точка не уезжала на новую строку
function word(key, cur, punct = '') {
  const opt = PHRASE[key].find(([v]) => v === cur) || PHRASE[key][0];
  return `<span class="nobr"><button class="wave-word-opt" data-key="${key}" aria-haspopup="menu" aria-label="${esc(opt[1])} — изменить">${esc(opt[1])}</button>${punct}</span>`;
}

function phraseHtml(cfg, ym) {
  const dj = djStop(cfg);
  const voices = cfg.dj && !IS_MOBILE && djVoices.length > 1;
  const voice = djVoices.find((v) => v.name === cfg.djVoice) || djVoices[0];
  const want = ym
    ? `Хочу ${word('mood', cfg.mood, ',')} ${word('diversity', cfg.diversity, ',')} ${word('language', cfg.language, '.')}`
    : `Хочу ${word('diversity', cfg.diversity, '.')}`;
  const djText = voices
    ? `Диджей ${word('dj', dj)} голосом <span class="nobr"><button class="wave-word-opt" data-key="voice" aria-haspopup="menu">${esc(voiceShort(voice?.name))}</button>.</span>`
    : `Диджей ${word('dj', dj, '.')}`;
  return `<p class="wave-phrase"><span>${want}</span><span>${djText}</span></p>`;
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
  tuner.innerHTML = phraseHtml(cfg, ym);
  bindWaveOpts(tuner);
}

// Слова фразы: ЛКМ — следующий вариант по кругу, ПКМ — предыдущий, колёсико — окно со всеми.
// Сохраняем и перерисовываем сразу, а перестраиваем волну (и диджея) через миг после последнего
// клика — чтобы быстрое перелистывание не перезапускало волну на каждом слове
const WAVE_TITLES = { mood: 'Настроение', diversity: 'Характер', language: 'Язык', dj: 'Диджей', voice: 'Голос диджея' };
const WAVE_APPLY_AFTER = 700;
const wavePending = {};
let waveApplyTimer = 0;

function waveChoice(key) {
  const cfg = waveCfg();
  const cur = key === 'dj' ? djStop(cfg) : key === 'voice' ? (cfg.djVoice || djVoices[0]?.name) : cfg[key];
  const opts = key === 'voice' ? djVoices.map((v) => [v.name, voiceShort(v.name)]) : PHRASE[key];
  return { cur, opts };
}

async function setWave(key, v, { soon = false } = {}) {
  const patch = key === 'dj' ? (v !== 'off' ? { dj: true, djEvery: +v } : { dj: false })
    : key === 'voice' ? { djVoice: v } : { [key]: v };
  // сразу в state: следующий клик должен листать уже от нового слова, не дожидаясь сохранения
  state.cfg.wave = { ...(state.cfg.wave || {}), ...patch };
  renderWaveHero();
  flipWord(key);
  wavePending[key] = v;
  clearTimeout(waveApplyTimer);
  waveApplyTimer = setTimeout(applyWave, soon ? WAVE_APPLY_AFTER : 0);
  await saveCfg({ wave: patch });
}

function applyWave() {
  const p = { ...wavePending };
  for (const k of Object.keys(wavePending)) delete wavePending[k];
  if ('dj' in p) {
    if (p.dj !== 'off' && Wave.active && state.track) { Wave.sinceDj = 99; maybeDj(state.track); }
    if (p.dj === 'off') stopDj();
  }
  if ('voice' in p) speak('Привет! Теперь говорю я.');
  if (['mood', 'diversity', 'language'].some((k) => k in p) && Wave.active) waveStart(); // волна перестраивается
}

function cycleWave(key, step) {
  const { cur, opts } = waveChoice(key);
  if (opts.length < 2) return;
  const i = Math.max(0, opts.findIndex(([v]) => v === cur));
  setWave(key, opts[(i + step + opts.length) % opts.length][0], { soon: true });
}

// сменившееся слово плавно въезжает снизу
function flipWord(key) {
  const b = $(`#wave-tuner .wave-word-opt[data-key="${key}"]`);
  if (!b) return;
  b.classList.remove('flip');
  void b.offsetWidth;
  b.classList.add('flip');
}

function bindWaveOpts(box) {
  box.querySelectorAll('.wave-word-opt').forEach((b) => {
    const key = b.dataset.key;
    b.title = 'ЛКМ — дальше, ПКМ — назад, колёсико — все варианты';
    b.onclick = () => cycleWave(key, 1);
    b.oncontextmenu = (e) => { e.preventDefault(); cycleWave(key, -1); };
    b.onmousedown = (e) => { if (e.button === 1) e.preventDefault(); }; // без автопрокрутки колёсиком
    b.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); openWavePop(key, b); } };
    b.onkeydown = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); cycleWave(key, 1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); cycleWave(key, -1); }
      if (e.key === 'ContextMenu' || (e.key === 'Enter' && e.shiftKey)) { e.preventDefault(); openWavePop(key, b); }
    };
  });
}

// ---- окно со всеми вариантами (колёсико) ----

let wavePop = null;

function closeWavePop() {
  if (!wavePop) return;
  const el = wavePop;
  wavePop = null;
  $$('.wave-word-opt[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  el.classList.add('out');
  setTimeout(() => el.remove(), 160);
}

function openWavePop(key, anchor) {
  closeWavePop();
  const { cur, opts } = waveChoice(key);
  const el = document.createElement('div');
  el.className = `wave-pop${key === 'dj' || key === 'voice' ? ' dj' : ''}`;
  el.setAttribute('role', 'menu');
  el.innerHTML = `<div class="wave-pop-title">${esc(WAVE_TITLES[key] || '')}</div>
    <div class="wave-pop-opts">${opts.map(([v, t], i) => `<button role="menuitemradio" aria-checked="${v === cur}" class="${v === cur ? 'on' : ''}" data-v="${esc(v)}" style="--i:${i}">${esc(t)}</button>`).join('')}</div>`;
  document.body.append(el);
  wavePop = el;
  anchor.setAttribute('aria-expanded', 'true');
  // под словом, по его центру; не влезает вниз — над ним
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight, edge = 12;
  el.style.left = `${Math.min(Math.max(edge, r.left + r.width / 2 - w / 2), innerWidth - w - edge)}px`;
  const below = r.bottom + 10;
  el.style.top = `${below + h > innerHeight - edge ? Math.max(edge, r.top - 10 - h) : below}px`;
  el.style.setProperty('--ox', `${r.left + r.width / 2 - parseFloat(el.style.left)}px`);
  el.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { closeWavePop(); setWave(key, b.dataset.v); };
  });
  (el.querySelector('button.on') || el.querySelector('button'))?.focus();
}

document.addEventListener('pointerdown', (e) => { if (wavePop && !wavePop.contains(e.target)) closeWavePop(); }, true);
document.addEventListener('keydown', (e) => {
  if (!wavePop) return;
  if (e.key === 'Escape') { e.stopPropagation(); closeWavePop(); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const btns = [...wavePop.querySelectorAll('button')];
  const i = btns.indexOf(document.activeElement);
  const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
  btns[(i + step + btns.length) % btns.length]?.focus();
  e.preventDefault();
}, true);
window.addEventListener('resize', closeWavePop);

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
