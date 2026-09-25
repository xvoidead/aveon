'use strict';

const api = window.tishe;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const NAMES = { local: 'Мои файлы', artists: 'Артисты', albums: 'Альбомы', ym: 'Яндекс Музыка', sc: 'SoundCloud', sp: 'Spotify' };
const VIEWS = ['local', 'artists', 'albums', 'ym', 'sc', 'sp'];
const SHORT = { local: 'файл', ym: 'Яндекс', sc: 'SoundCloud', sp: 'Spotify' };

const state = {
  cfg: null,
  sp: { connected: false },
  account: { loggedIn: false }, // вход в аккаунт авеона
  view: 'local',
  sub: null,
  shown: [],             // треки, которые сейчас в списке
  local: [],             // треки из папок
  opened: [],            // файлы, открытые вручную или перетащенные
  scanning: false,
  cache: {},             // `${src}:${collection}` → треки
  results: {},           // src → последние результаты поиска
  queries: {},           // src → строка поиска
  collections: {},       // src → список коллекций
  albums: [],            // свои альбомы: { id, title, count, cover }
  album: null,           // открытый альбом целиком
  queue: [],
  order: [],             // порядок проигрывания (индексы queue), для перемешивания
  pos: -1,               // позиция в order
  track: null,
  muted: false,
};

// ---------- утилиты ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(sec) {
  if (!isFinite(sec) || sec <= 0) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function summary(tracks) {
  const total = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  const h = Math.floor(total / 3600), m = Math.round((total % 3600) / 60);
  const dur = h ? `${h} ч ${m} мин` : `${m} мин`;
  return `${tracks.length} ${plural(tracks.length, 'трек', 'трека', 'треков')}${total ? `, ${dur}` : ''}`;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('hide'), kind === 'err' ? 5200 : 3000);
  setTimeout(() => el.remove(), kind === 'err' ? 5600 : 3400);
}

async function saveCfg(patch) {
  state.cfg = await api.config.set(patch);
  return state.cfg;
}

const lerp = (a, b, t) => a + (b - a) * t;

// ---------- всплывающее меню ----------
// items: { label, icon, onClick, count, danger, muted } | { sep: true } | { note: 'текст' }

const menuEl = $('#menu');
let menuAnchor = null;

function showMenu(items, { x, y, anchor } = {}) {
  closeMenu();
  menuEl.innerHTML = '';
  for (const it of items) {
    if (it.sep) { menuEl.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); continue; }
    if (it.note) { menuEl.insertAdjacentHTML('beforeend', `<div class="menu-note">${esc(it.note)}</div>`); continue; }
    const b = document.createElement('button');
    b.className = `menu-item${it.danger ? ' danger' : ''}${it.muted ? ' in' : ''}`;
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `${it.icon ? `<svg><use href="#${it.icon}"/></svg>` : ''}<span>${esc(it.label)}</span>${it.count != null ? `<span class="count">${esc(it.count)}</span>` : ''}`;
    b.onclick = () => { closeMenu(); it.onClick(); };
    menuEl.append(b);
  }
  menuEl.hidden = false;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = r.right; y = r.bottom + 4;
    menuAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
  }
  // Не даём меню вылезти за окно
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  menuEl.style.left = `${Math.max(8, Math.min(x - (anchor ? w : 0), innerWidth - w - 8))}px`;
  menuEl.style.top = `${y + h > innerHeight - 8 ? Math.max(8, (anchor ? anchor.getBoundingClientRect().top - 4 : y) - h) : y}px`;
  menuEl.querySelector('.menu-item')?.focus();
}

function closeMenu() {
  if (menuEl.hidden) return;
  menuEl.hidden = true;
  menuAnchor?.setAttribute('aria-expanded', 'false');
  menuAnchor = null;
}

document.addEventListener('pointerdown', (e) => {
  if (!menuEl.hidden && !menuEl.contains(e.target) && !e.target.closest('[aria-expanded="true"]')) closeMenu();
});
menuEl.addEventListener('keydown', (e) => {
  const items = $$('.menu-item', menuEl);
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
});
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// ---------- диалог: ввод названия или подтверждение ----------

function ask({ title, text = '', value = '', ok, input = true, danger = false, password = false }) {
  const dlg = $('#dialog');
  const field = $('#dialog-input');
  $('#dialog-title').textContent = title;
  $('#dialog-text').textContent = text;
  $('#dialog-ok').textContent = ok;
  $('#dialog-ok').classList.toggle('danger', danger);
  $('#dialog-ok').classList.toggle('primary', !danger);
  field.hidden = !input;
  field.type = password ? 'password' : 'text';
  field.value = value;
  dlg.hidden = false;
  (input ? field : $('#dialog-ok')).focus();
  if (input) field.select();
  return new Promise((resolve) => {
    const done = (result) => {
      dlg.hidden = true;
      $('#dialog-form').onsubmit = null;
      $('#dialog-cancel').onclick = null;
      dlg.onpointerdown = null;
      dlg.onkeydown = null;
      resolve(result);
    };
    $('#dialog-form').onsubmit = (e) => {
      e.preventDefault();
      if (input && !field.value.trim()) { field.focus(); return; }
      done(input ? (password ? field.value : field.value.trim()) : true);
    };
    $('#dialog-cancel').onclick = () => done(null);
    dlg.onpointerdown = (e) => { if (e.target === dlg) done(null); };
    dlg.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
  });
}

// Слайдер на pointer-событиях: onInput во время перетаскивания, onChange по отпусканию
function makeSlider(el, { onInput, onChange }) {
  const frac = (e) => {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    onInput?.(frac(e));
    const move = (ev) => onInput?.(frac(ev));
    const up = (ev) => {
      el.classList.remove('drag');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      onChange?.(frac(ev));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

function setSlider(el, f) {
  const p = `${Math.min(1, Math.max(0, f)) * 100}%`;
  el.querySelector('.slider-fill').style.width = p;
  el.querySelector('.slider-knob').style.left = p;
}

// ---------- аудиодвижок ----------
// audio  → регулятор ┐
// audio2 → регулятор ┴→ mix (плавный переход между треками)
//
//                      ┌→ cDry ─────────────────────┐
//   mix → эквалайзер ──┼→ плывущая задержка → cWarble ┼→ lowpass → «гул» (peaking) ─┬─→ master → volume → analyser → колонки
//                      └→ кольцевой модулятор → cRing ┘                              └─→ гребёнка → combWet ─┘
// Эффект бочки: срез высоких, резонанс и короткие переотражения, как будто музыка играет внутри бочки.
// Ветки cDry / cWarble / cRing и писк cBleep — самоцензура (censor.js): искажают спрятанное слово.

// Два плеера по очереди: пока один доигрывает с затуханием («хвост»), другой уже играет следующий трек.
// audio — тот, что сейчас главный; всё остальное приложение работает только с ним.
const decks = [$('#audio'), $('#audio2')];
let audio = decks[0];
let ctx = null;
const hlsOf = new Map(); // элемент → hls.js
let tail = null;         // { el, dur, timer } — доигрывающий трек
let autoFade = 0;        // > 0: переход начат сам за столько секунд до конца трека

// События только от главного элемента: хвост доигрывает молча
function onAudio(type, fn) {
  for (const el of decks) el.addEventListener(type, (e) => { if (e.target === audio) fn(e); });
}
const fx = {};
let loadSeq = 0;
let failStreak = 0;
let retried = false;
let seeking = false;

function ensureGraph() {
  if (ctx) return;
  ctx = new AudioContext({ latencyHint: 'playback' });
  // у каждого плеера свой регулятор (для перехода между треками), дальше общий микшер → эквалайзер
  fx.mix = ctx.createGain();
  fx.deck = new Map(decks.map((el) => {
    const g = ctx.createGain();
    ctx.createMediaElementSource(el).connect(g).connect(fx.mix);
    return [el, g];
  }));
  const src = eqBuild(fx.mix); // eq.js: 10 полос и предусилитель
  fx.lp = ctx.createBiquadFilter();
  fx.lp.type = 'lowpass';
  fx.lp.frequency.value = 20000;
  fx.lp.Q.value = 0.707;
  fx.boom = ctx.createBiquadFilter();
  fx.boom.type = 'peaking';
  fx.boom.frequency.value = 170;
  fx.boom.Q.value = 1.1;
  fx.boom.gain.value = 0;
  fx.comb = ctx.createDelay(0.05);
  fx.comb.delayTime.value = 0.0105;
  fx.combFb = ctx.createGain();
  fx.combFb.gain.value = 0.42;
  fx.combWet = ctx.createGain();
  fx.combWet.gain.value = 0;
  fx.master = ctx.createGain();
  fx.vol = ctx.createGain();
  fx.analyser = ctx.createAnalyser();
  fx.analyser.fftSize = 1024;
  fx.analyser.smoothingTimeConstant = 0.8;

  // Самоцензура: сухой сигнал и искажения всегда подключены, смешиваются по силе цензуры
  fx.cDry = ctx.createGain();
  fx.cWarble = ctx.createDelay(0.1);
  fx.cWarble.delayTime.value = 0.03;
  const lfo = ctx.createOscillator(); // плавающая задержка = «плывущая» высота тона
  lfo.frequency.value = 6;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.008;
  lfo.connect(lfoDepth).connect(fx.cWarble.delayTime);
  lfo.start();
  fx.cWarbleWet = ctx.createGain();
  fx.cWarbleWet.gain.value = 0;
  fx.cRing = ctx.createGain(); // кольцевая модуляция: сигнал × синус 70 Гц — «робот»
  fx.cRing.gain.value = 0;
  const carrier = ctx.createOscillator();
  carrier.frequency.value = 70;
  carrier.connect(fx.cRing.gain);
  carrier.start();
  fx.cRingWet = ctx.createGain();
  fx.cRingWet.gain.value = 0;
  fx.cBleep = ctx.createGain();
  fx.cBleep.gain.value = 0;
  const tone = ctx.createOscillator();
  tone.frequency.value = 1000;
  tone.connect(fx.cBleep);
  tone.start();

  src.connect(fx.cDry).connect(fx.lp);
  src.connect(fx.cWarble).connect(fx.cWarbleWet).connect(fx.lp);
  src.connect(fx.cRing).connect(fx.cRingWet).connect(fx.lp);
  fx.cBleep.connect(fx.vol);
  fx.lp.connect(fx.boom).connect(fx.master);
  fx.boom.connect(fx.comb);
  fx.comb.connect(fx.combFb).connect(fx.comb);
  fx.comb.connect(fx.combWet).connect(fx.master);
  fx.master.connect(fx.vol).connect(fx.analyser).connect(ctx.destination);
  applyVolume();
  applyEffect(duck.m);
}

// m: 0 — чистый звук, 1 — полностью «в бочке» (или приглушено, если выбран режим громкости).
// Поверх — самоцензура: c от 0 до 1 (censor.js) тоже уводит в бочку и искажает звук.
function applyEffect(m) {
  if (!ctx) return;
  const d = state.cfg.duck;
  const t = ctx.currentTime;
  const c = cz.c;
  const effect = state.cfg.censor?.effect || 'barrel';
  const k = c > 0.001 ? 0.008 : 0.02; // слово короткое — цензура должна включаться быстро
  const quiet = d.effect === 'volume' ? m : 0;
  const b = Math.max(d.effect === 'volume' ? 0 : m, c);
  // Частоту среза ведём по логарифму — на слух это ровное «закрывание»
  const freq = 20000 * Math.pow(d.barrelCutoff / 20000, b);
  const boom = d.barrelBoom;
  fx.lp.frequency.setTargetAtTime(freq, t, k);
  fx.lp.Q.setTargetAtTime(0.707 + b * boom * 4.5, t, k);
  fx.boom.gain.setTargetAtTime(b * boom * 9, t, k);
  fx.combWet.gain.setTargetAtTime(b * boom * 0.38, t, k);
  fx.master.gain.setTargetAtTime((1 - b * (1 - d.barrelLevel)) * (1 - quiet * (1 - d.level)), t, k);
  fx.cDry.gain.setTargetAtTime(effect === 'barrel' ? 1 : 1 - c, t, k);
  fx.cWarbleWet.gain.setTargetAtTime(effect === 'warble' ? c : 0, t, k);
  fx.cRingWet.gain.setTargetAtTime(effect === 'robot' ? c * 1.4 : 0, t, k); // модуляция вдвое снижает мощность
  fx.cBleep.gain.setTargetAtTime(effect === 'bleep' ? c * 0.18 : 0, t, k);
}

// Во сколько раз эффект снижает громкость — для приглушения других программ через микшер
function externalLevel(m) {
  const d = state.cfg.duck;
  return 1 - m * (1 - (d.effect === 'volume' ? d.level : Math.min(d.barrelLevel, 0.5)));
}

function applyVolume() {
  const v = state.muted ? 0 : state.cfg.volume;
  setSlider($('#volume'), v);
  $('#btn-mute use').setAttribute('href', v === 0 ? '#i-mute' : '#i-vol');
  if (fx.vol) fx.vol.gain.setTargetAtTime(v * v, ctx.currentTime, 0.02); // квадрат ближе к восприятию громкости
}

function dropHls(el) {
  hlsOf.get(el)?.destroy();
  hlsOf.delete(el);
}

function attach(url, isHls) {
  const el = audio;
  dropHls(el);
  if (isHls && window.Hls?.isSupported()) {
    const hls = new Hls({ enableWorker: true, maxBufferLength: 60 });
    hls.on(Hls.Events.ERROR, (e, data) => {
      if (data.fatal && el === audio) onAudioError(new Error('поток HLS: ' + data.details));
    });
    hls.loadSource(url);
    hls.attachMedia(el);
    hlsOf.set(el, hls);
  } else {
    el.src = url;
  }
}

// ---------- плавный переход между треками ----------
// Кривые «равной мощности»: сумма громкостей на слух ровная, без провала посередине
const FADE_STEPS = 64;
const FADE_IN = Float32Array.from({ length: FADE_STEPS }, (_, i) => Math.sin((i / (FADE_STEPS - 1)) * Math.PI / 2));
const FADE_OUT = Float32Array.from({ length: FADE_STEPS }, (_, i) => Math.cos((i / (FADE_STEPS - 1)) * Math.PI / 2));
const MANUAL_FADE = 1.2; // с — когда трек сменили сами, переход короткий

function deckGain(el, v) {
  const g = fx.deck?.get(el)?.gain;
  if (!g) return;
  g.cancelScheduledValues(ctx.currentTime);
  g.setValueAtTime(v, ctx.currentTime);
}

// Сколько длится переход к следующему треку: 0 — сразу (выключено или ничего не играет)
function fadeLength() {
  const cf = +state.cfg.crossfade || 0;
  const auto = autoFade;
  autoFade = 0;
  if (!cf || !ctx || audio.paused || locked()) return 0;
  return auto ? Math.max(0.5, Math.min(cf, auto)) : Math.min(cf, MANUAL_FADE);
}

// Текущий трек становится хвостом, следующий пойдёт во второй элемент (пока беззвучно)
function handOff() {
  const dur = fadeLength();
  if (!dur) return;
  killTail();
  const old = audio;
  audio = decks.find((d) => d !== old);
  tail = { el: old, dur, timer: 0 };
  deckGain(audio, 0);
}

// Новый трек зазвучал — хвост затихает, новый нарастает. Не зазвучал — хвост просто быстро гаснет.
function startFade() {
  if (!tail || tail.timer) return;
  const playing = !audio.paused;
  const dur = playing ? tail.dur : 0.3;
  const t = ctx.currentTime;
  const gOld = fx.deck.get(tail.el).gain;
  gOld.cancelScheduledValues(t);
  gOld.setValueCurveAtTime(FADE_OUT.map((v) => v * gOld.value), t, dur);
  const gNew = fx.deck.get(audio).gain;
  gNew.cancelScheduledValues(t);
  if (playing) gNew.setValueCurveAtTime(FADE_IN, t, dur);
  else gNew.setValueAtTime(1, t);
  tail.timer = setTimeout(killTail, dur * 1000 + 80);
}

function killTail() {
  if (!tail) return;
  clearTimeout(tail.timer);
  const el = tail.el;
  tail = null;
  el.pause();
  dropHls(el);
  el.removeAttribute('src');
  el.load();
  deckGain(el, 1);
}

for (const el of decks) el.addEventListener('ended', () => { if (tail?.el === el) killTail(); });

// Есть ли куда переходить: иначе трек доигрывает до конца как обычно
function hasNext() {
  if (!state.queue.length || state.cfg.repeat === 'one') return false;
  return state.cfg.repeat === 'all' || state.pos + 1 < state.order.length;
}

// Раз в timeupdate: пора ли начинать переход к следующему треку
function maybeAutoFade() {
  const cf = +state.cfg.crossfade || 0;
  if (!cf || tail || seeking || audio.paused || !hasNext() || Together.waitsOnEnd()) return;
  const d = audio.duration;
  if (!isFinite(d) || d < cf * 3) return; // короткие треки и превью — без перехода
  const left = d - audio.currentTime;
  if (left > cf || left < 0.4) return;
  autoFade = left;
  next(true);
}

// quiet — при восстановлении после перезапуска: без уведомлений и автоперехода, если поток не получен.
// startAt — секунды или функция (для «Слушать вместе»: позиция считается в момент, когда поток готов).
// track.shared — трек, который включил друг: поток ищется через together (свой сервис или подбор).
async function loadTrack(track, { autoplay = true, startAt = 0, quiet = false } = {}) {
  if (locked()) autoplay = false;
  const seq = ++loadSeq;
  state.track = track;
  showNow(track, null);
  markPlaying();
  Together.beforeLoad();
  handOff();
  audio.pause();
  let stream;
  try {
    stream = await (track.shared ? api.together.stream(track) : api.stream(track));
  } catch (e) {
    Together.loadFailed();
    if (seq === loadSeq) startFade(); // хвост не должен играть вечно
    if (seq !== loadSeq || quiet) return;
    if (track.shared) { toast(`${track.title}: ${e.message}`, 'err'); return; } // трек друга: ждём следующий от него
    failStreak++;
    toast(`${track.title}: ${e.message}`, 'err');
    if (failStreak < 5 && state.queue.length > 1) setTimeout(() => next(true), 600);
    else failStreak = 0;
    return;
  }
  if (seq !== loadSeq) return;
  if (track.shared && !track.cover && stream.cover) track.cover = stream.cover; // у файла друга обложки нет — берём у найденного
  showNow(track, stream);
  ensureGraph();
  if (ctx.state === 'suspended') ctx.resume();
  if (!tail) deckGain(audio, 1);
  attach(stream.url, stream.hls);
  if (startAt) audio.addEventListener('loadedmetadata', () => { audio.currentTime = typeof startAt === 'function' ? startAt() : startAt; }, { once: true });
  if (autoplay) {
    try { await audio.play(); failStreak = 0; } catch (e) { if (e.name !== 'AbortError') onAudioError(e); }
  }
  if (seq === loadSeq) startFade();
  if (seq === loadSeq && !quiet) Together.afterLoad(track);
}

function onAudioError(err) {
  const t = state.track;
  if (!t) return;
  // Ссылки сервисов со временем перестают работать — один раз получаем поток заново с того же места
  if (!retried && t.source !== 'local') {
    retried = true;
    loadTrack(t, { startAt: audio.currentTime || 0 });
    return;
  }
  retried = false;
  toast(`Не получилось включить «${t.title}»${err?.message ? `: ${err.message}` : ''}`, 'err');
  if (++failStreak < 5 && state.queue.length > 1) setTimeout(() => next(true), 600);
}

onAudio('error', () => {
  if (hlsOf.has(audio)) return; // ошибки HLS обрабатывает hls.js
  const code = audio.error?.code;
  onAudioError(new Error(code === 4 ? 'формат не поддерживается' : code === 2 ? 'ошибка сети' : 'ошибка декодирования'));
});
onAudio('playing', () => { retried = false; });
onAudio('play', updatePlayState);
onAudio('pause', updatePlayState);
onAudio('ended', () => {
  if (Together.waitsOnEnd()) return; // вместе трек переключает ведущий
  if (state.cfg.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  next(true);
});
onAudio('timeupdate', () => { if (!seeking) { renderProgress(); maybeAutoFade(); } });
onAudio('durationchange', renderProgress);
onAudio('progress', renderProgress);

function renderProgress() {
  const d = audio.duration || state.track?.duration || 0;
  const c = audio.currentTime || 0;
  $('#time-cur').textContent = fmt(c);
  $('#time-dur').textContent = fmt(d);
  setSlider($('#progress'), d ? c / d : 0);
  const b = audio.buffered;
  $('#progress-buf').style.width = d && b.length ? `${(b.end(b.length - 1) / d) * 100}%` : '0';
  if ('mediaSession' in navigator && d && isFinite(d)) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(c, d), playbackRate: 1 }); } catch {}
  }
}

function updatePlayState() {
  const playing = !audio.paused;
  $('#btn-play use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('#btn-play').setAttribute('aria-label', playing ? 'Пауза' : 'Играть');
  document.body.classList.toggle('paused', !playing);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  api.win.thumbState({ playing, hasTrack: !!state.track });
  markPlaying();
  if (playing) startViz();
}

function togglePlay() {
  if (locked()) return; // до входа в аккаунт не играем
  if (!state.track) {
    const list = state.shown.length ? state.shown : state.local;
    if (list.length) playFrom(list, 0);
    return;
  }
  if (audio.paused) {
    ensureGraph();
    ctx.resume();
    if (!audio.src && !hlsOf.has(audio)) loadTrack(state.track);
    else audio.play().catch(() => {});
  } else {
    killTail(); // пауза посреди перехода — тишина сразу, без доигрывающего хвоста
    audio.pause();
  }
}

// ---------- очередь ----------

function buildOrder(startIdx) {
  const n = state.queue.length;
  const idx = [...Array(n).keys()];
  if (state.cfg.shuffle) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const at = idx.indexOf(startIdx);
    if (at > 0) [idx[0], idx[at]] = [idx[at], idx[0]];
    state.order = idx;
    state.pos = 0;
  } else {
    state.order = idx;
    state.pos = Math.max(0, startIdx);
  }
}

function playFrom(list, index) {
  state.queue = list.slice();
  failStreak = 0;
  buildOrder(index);
  loadTrack(state.queue[state.order[state.pos]]);
}

function next(auto = false) {
  if (!state.queue.length) return;
  const n = state.order.length;
  for (let step = 1; step <= n; step++) {
    let p = state.pos + step;
    if (p >= n) {
      if (auto && state.cfg.repeat === 'off') { audio.pause(); audio.currentTime = 0; return; }
      p %= n;
    }
    const t = state.queue[state.order[p]];
    if (t?.playable !== false) {
      state.pos = p;
      loadTrack(t);
      return;
    }
  }
}

function prev() {
  if (audio.currentTime > 4 || !state.queue.length) { audio.currentTime = 0; return; }
  for (let p = state.pos - 1; p >= 0; p--) {
    const t = state.queue[state.order[p]];
    if (t?.playable !== false) { state.pos = p; loadTrack(t); return; }
  }
  audio.currentTime = 0;
}

// ---------- сейчас играет ----------

function showNow(track, stream) {
  state.via = stream?.via || null;
  $('#now-title').textContent = track.title;
  $('#btn-now-album').disabled = false;
  $('#now-artist').innerHTML = track.artist ? artistLinks(track.artist) : 'Исполнитель неизвестен'; // имя — ссылка на артиста
  $('#now-cover').innerHTML = track.cover ? `<img src="${esc(track.cover)}" alt="">` : '<span class="porthole-empty">♪</span>';
  const via = $('#now-via');
  if (stream?.via) {
    via.hidden = false;
    via.textContent = stream.via.label || `Из Spotify, звучит через ${NAMES[stream.via.source]}`;
  } else if (stream?.preview) {
    via.hidden = false;
    via.textContent = 'Только 30 секунд: для полного трека нужна подписка';
  } else {
    via.hidden = true;
  }
  document.title = `${track.title} — ${track.artist || 'авеон'}`;
  api.win.thumbState({ playing: !audio.paused, hasTrack: true });
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.cover ? [{ src: track.cover, sizes: '300x300' }] : [],
    });
  }
  renderProgress();
  onTrackShown(track); // extras.js: палитра, статистика, текст песни
}

function markPlaying() {
  const id = state.track?.id;
  for (const row of $$('#tracklist .row')) {
    const t = state.shown[+row.dataset.i];
    const on = !!id && t?.id === id;
    row.classList.toggle('playing', on);
    const btn = row.querySelector('.play-hover');
    // В «Моих файлах» обложка открывает редактор тегов
    const want = on && !audio.paused ? 'bars' : state.view === 'local' ? 'edit' : 'play';
    if (btn.dataset.kind !== want) {
      btn.dataset.kind = want;
      btn.innerHTML = want === 'bars' ? '<span class="bars"><i></i><i></i><i></i></span>' : `<svg><use href="#${want === 'edit' ? 'i-pencil' : 'i-play'}"/></svg>`;
      btn.setAttribute('aria-label', want === 'edit' ? 'Изменить теги' : 'Играть');
    }
  }
}

// ---------- кольцевой спектр вокруг бочки ----------
// Рисуется после фильтра, поэтому в бочке высокие частоты в спектре действительно гаснут.

const viz = $('#viz');
let vizRunning = false;

function startViz() {
  if (vizRunning || !fx.analyser) return;
  vizRunning = true;
  const g = viz.getContext('2d');
  const data = new Uint8Array(fx.analyser.frequencyBinCount);
  const draw = () => {
    if (audio.paused || document.hidden) { vizRunning = false; g.clearRect(0, 0, viz.width, viz.height); return; }
    const dpr = window.devicePixelRatio || 1;
    const w = viz.clientWidth * dpr, h = viz.clientHeight * dpr;
    if (viz.width !== w || viz.height !== h) { viz.width = w; viz.height = h; }
    fx.analyser.getByteFrequencyData(data);
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const inner = w * 0.43;       // чуть снаружи внешнего обруча
    const reach = w * 0.065;
    const bars = 96;
    const m = duck.m;
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.5, w / 260);
    for (let i = 0; i < bars; i++) {
      // Спектр зеркалим: басы сверху, высокие внизу с обеих сторон
      const half = i < bars / 2 ? i : bars - 1 - i;
      const f = half / (bars / 2);
      const lo = Math.floor(Math.pow(f, 1.8) * data.length * 0.7);
      const hi = Math.max(lo + 1, Math.floor(Math.pow(f + 2 / bars, 1.8) * data.length * 0.7));
      let v = 0;
      for (let k = lo; k < hi; k++) v = Math.max(v, data[k]);
      const len = Math.pow(v / 255, 1.5) * reach + 1;
      const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(a), sin = Math.sin(a);
      // Цвет спектра — акцент из обложки; в бочке переходит в цвет голосов
      g.strokeStyle = vizColor(m > 0.5 ? 'voice' : 'amber');
      g.globalAlpha = 0.35 + v / 400;
      g.beginPath();
      g.moveTo(cx + cos * inner, cy + sin * inner);
      g.lineTo(cx + cos * (inner + len), cy + sin * (inner + len));
      g.stroke();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && !audio.paused) startViz(); });

// ---------- твой микрофон: шумоподавление и детектор речи ----------
// Сигнал Discord для микрофона — это «сырой» уровень, в нём шум, клавиатура и музыка из колонок.
// Поэтому слушаем микрофон сами: Chromium даёт шумоподавление и эхоподавление (оно вычитает
// звук, который играет сам плеер), а поверх — детектор речи: полоса голоса 250–3800 Гц,
// сравнение с плавающим уровнем фонового шума и минимальная длительность (щелчки короче).

const mic = { stream: null, analyser: null, buf: null, floor: 0.003, rms: 0, frames: 0, speaking: false, want: false, starting: false, error: '' };

async function micStart() {
  if (mic.stream || mic.starting) return;
  mic.starting = true;
  try {
    ensureGraph();
    const deviceId = state.cfg.duck.micDevice;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    if (!mic.want) { stream.getTracks().forEach((t) => t.stop()); return; }
    const src = ctx.createMediaStreamSource(stream);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 250;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3800;
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(hp).connect(lp).connect(an); // в колонки не выводим
    mic.stream = stream;
    mic.analyser = an;
    mic.buf = new Float32Array(an.fftSize);
    mic.floor = 0.003;
    mic.error = '';
  } catch (e) {
    mic.error = e.message;
  } finally {
    mic.starting = false;
  }
}

function micStop() {
  if (!mic.stream) return;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.stream = null;
  mic.analyser = null;
  mic.speaking = false;
  mic.frames = 0;
  mic.rms = 0;
}

// Чувствительность 0…1 → во сколько раз голос должен быть громче фонового шума
// После шумоподавления фон почти нулевой, поэтому главный критерий — абсолютная громкость речи.
// Замер в тишине: всплески шума доходят до ~0.015 RMS, обычная речь — 0.03 и выше.
const micRatioNeed = (s) => lerp(8, 2.5, s);
const micAbsNeed = (s) => lerp(0.035, 0.006, s);

function micTick() {
  if (!mic.analyser) return;
  mic.analyser.getFloatTimeDomainData(mic.buf);
  let sum = 0;
  for (let i = 0; i < mic.buf.length; i++) sum += mic.buf[i] * mic.buf[i];
  const rms = Math.sqrt(sum / mic.buf.length);
  mic.rms = rms;
  // Уровень шума: быстро опускается к тишине, очень медленно поднимается (чтобы не «выучить» речь)
  mic.floor = rms < mic.floor ? lerp(mic.floor, rms, 0.2) : lerp(mic.floor, rms, 0.002);
  mic.floor = Math.max(mic.floor, 0.0015);
  const s = state.cfg.duck.micSensitivity;
  const loud = rms > micAbsNeed(s) && rms / mic.floor > micRatioNeed(s);
  mic.frames = loud ? mic.frames + 1 : 0;
  // ≥ 4 замера подряд (~120 мс): слова проходят, щелчки клавиатуры и стуки — нет
  mic.speaking = mic.frames >= 4;
}

// ---------- эффект в звонке ----------
// Монитор присылает уровни ~30 раз в секунду. Голос выше порога → эффект быстро нарастает,
// тишина дольше «держать после фразы» → плавно уходит.

const duck = { m: 0, meter: { o: 0, m: 0, call: 0, dc: 0 }, lastVoice: -1e9, last: performance.now(), sent: 1, ok: null, error: '', streak: 0 };

api.duck.onMeter((m) => {
  duck.meter = m;
  const d = state.cfg?.duck;
  if (!d) return;
  // Реальная речь длится дольше одного замера, а случайные скачки — нет
  duck.streak = m.call && m.o > d.threshold ? duck.streak + 1 : 0;
  if (duck.streak >= 2) duck.lastVoice = performance.now();
});
api.duck.onStatus((s) => { duck.ok = s.ok; duck.error = s.error || ''; });

function duckTick() {
  const now = performance.now();
  const dt = Math.min(200, now - duck.last);
  duck.last = now;
  const d = state.cfg?.duck;
  if (!d) return;
  const m = duck.meter;

  mic.want = d.enabled && d.includeMic && !!m.call;
  if (mic.want) micStart(); else micStop();
  micTick();
  if (mic.speaking) duck.lastVoice = now;

  const talking = !!m.call && now - duck.lastVoice < d.hold;
  const active = d.enabled && !!m.call && (d.mode === 'call' || talking);
  const want = active ? 1 : 0;
  const tau = want > duck.m ? d.attack : d.release;
  duck.m += (want - duck.m) * (1 - Math.exp(-dt / Math.max(10, tau / 3)));
  if (Math.abs(duck.m - want) < 0.003) duck.m = want;

  censorTick(dt); // censor.js
  applyEffect(duck.m);
  document.documentElement.style.setProperty('--m', duck.m.toFixed(3));
  const ext = d.targets?.length ? externalLevel(duck.m) : 1;
  if (Math.abs(ext - duck.sent) > 0.01) {
    duck.sent = ext;
    api.duck.setLevel(ext);
  }
  renderCall(talking);
}
setInterval(duckTick, 30);

const meterScale = (x) => Math.min(1, Math.sqrt(Math.max(0, x)));

function renderCall(talking) {
  const d = state.cfg.duck;
  const m = duck.meter;
  $('#meter-fill').style.width = `${meterScale(m.o) * 100}%`;
  $('#meter-threshold').style.left = `${meterScale(d.threshold) * 100}%`;

  // Микрофон: громкость голоса после шумоподавления, отметка — порог речи (на 40% полосы)
  const micMeter = $('#mic-meter');
  const need = micAbsNeed(d.micSensitivity);
  const level = mic.analyser ? mic.rms / (need * 2.5) : 0;
  $('#mic-fill').style.width = `${Math.min(1, Math.sqrt(level)) * 100}%`;
  $('#mic-threshold').style.left = `${Math.sqrt(0.4) * 100}%`;
  micMeter.classList.toggle('live', mic.speaking);
  micMeter.title = mic.error ? `Микрофон недоступен: ${mic.error}` : !d.includeMic ? 'Реакция на твой голос выключена' : 'Твой голос после шумоподавления';

  const el = $('#duck-chip');
  let text, cls = '';
  if (duck.ok === false) { text = 'Монитор звука не запустился'; cls = 'err'; el.title = duck.error; }
  else if (!m.dc) text = 'Discord не запущен';
  else if (!m.call) text = 'Ты не в голосовом канале';
  else if (!d.enabled) text = 'В звонке, эффект выключен';
  else if (talking) { text = 'Говорят, музыка в бочке'; cls = 'talk'; }
  else text = 'В звонке, тихо';
  if (el.textContent !== text) el.textContent = text;
  el.className = `call-state ${cls}`;
}

makeSlider($('#meter'), {
  onChange: (f) => {
    const threshold = Math.max(0.002, +(f * f).toFixed(4));
    saveCfg({ duck: { threshold } });
    toast(`Порог для голосов собеседников: ${Math.round(f * 100)}%`);
  },
});

$('#duck-enabled').addEventListener('change', (e) => saveCfg({ duck: { enabled: e.target.checked } }));

// ---------- списки треков ----------

function rowHtml(t, i) {
  const cover = t.cover
    ? `<img loading="lazy" decoding="async" src="${esc(t.cover)}" alt="">`
    : `<div class="ph">${esc((t.title || '?').trim()[0]?.toUpperCase() || '♪')}</div>`;
  const tags = [
    state.view !== t.source ? `<span class="tag">${SHORT[t.source]}</span>` : '',
    t.preview ? '<span class="tag preview">30 сек</span>' : '',
  ].join('');
  const draggable = canReorder() ? ' draggable="true"' : '';
  const edit = state.view === 'local' && t.source === 'local' ? ' editable' : '';
  return `<div class="row${t.playable === false ? ' disabled' : ''}" data-i="${i}"${draggable}>
    <div class="num">${cover}<button class="play-hover" data-kind="play" tabindex="-1" aria-label="Играть"><svg><use href="#i-play"/></svg></button></div>
    <div class="t-main"><div class="t-title${edit}" title="${esc(t.title)}">${esc(t.title)}</div><div class="t-artist${edit}">${tags}${artistLinks(t.artist)}</div></div>
    <div class="t-album col-album">${esc(t.album)}</div>
    <div class="col-time">${fmt(t.duration)}</div>
    <button class="row-more" aria-label="Действия с треком" aria-haspopup="menu"><svg><use href="#i-more"/></svg></button>
  </div>`;
}

// ---------- альбомы: добавление и удаление треков ----------

async function refreshAlbums() {
  try { state.albums = await api.albums.list(); } catch (e) { toast(e.message, 'err'); }
  if (state.view === 'albums') renderCollections();
}

async function addToAlbum(album, tracks) {
  try {
    const { added } = await api.albums.add(album.id, tracks);
    if (tracks.length === 1) toast(added ? `Добавлено в «${album.title}»` : `Этот трек уже есть в «${album.title}»`);
    else toast(added ? `В «${album.title}» добавлено ${added} ${plural(added, 'трек', 'трека', 'треков')}` : `Все эти треки уже есть в «${album.title}»`);
    await refreshAlbums();
    if (state.view === 'albums' && state.sub === album.id) openView('albums', album.id);
  } catch (e) { toast(e.message, 'err'); }
}

async function createAlbum(tracks = []) {
  const title = await ask({ title: 'Новый альбом', text: tracks.length === 1 ? `Первым в него попадёт «${tracks[0].title}».` : '', ok: 'Создать', value: '' });
  if (!title) return null;
  try {
    const album = await api.albums.create(title);
    if (tracks.length) await api.albums.add(album.id, tracks);
    toast(tracks.length ? `Альбом «${title}» создан, трек добавлен` : `Альбом «${title}» создан`);
    await refreshAlbums();
    return album;
  } catch (e) { toast(e.message, 'err'); return null; }
}

function albumMenuItems(tracks) {
  const items = [];
  const current = state.view === 'albums' ? state.sub : null;
  const others = state.albums.filter((a) => a.id !== current);
  if (others.length) {
    items.push({ note: tracks.length === 1 ? 'Добавить в альбом' : `Добавить ${tracks.length} ${plural(tracks.length, 'трек', 'трека', 'треков')} в альбом` });
    for (const a of others) items.push({ label: a.title, icon: 'i-list', count: a.count, onClick: () => addToAlbum(a, tracks) });
  }
  items.push({ label: 'Новый альбом', icon: 'i-plus', onClick: async () => {
    const a = await createAlbum(tracks);
    if (a && state.view === 'albums') openView('albums', a.id);
  } });
  return items;
}

function openTrackMenu(i, pos) {
  const t = state.shown[i];
  if (!t) return;
  const items = albumMenuItems([t]);
  const artists = splitArtists(t.artist); // artists.js / extras.js
  if (artists.length) {
    items.unshift(...artists.slice(0, 3).map((name) => ({ label: artists.length > 1 ? name : 'Перейти к артисту', icon: 'i-user', onClick: () => openArtist(name) })), { sep: true });
  }
  if (t.source === 'local') items.unshift({ label: 'Изменить теги и обложку', icon: 'i-pencil', onClick: () => openEditor(t) }, { sep: true });
  if (state.view === 'albums' && state.album) {
    items.push({ sep: true }, { label: 'Убрать из альбома', icon: 'i-trash', danger: true, onClick: () => removeFromAlbum([t]) });
  }
  if (t.link) {
    items.push({ sep: true }, { label: `Открыть в ${NAMES[t.source] || 'браузере'}`, icon: 'i-search', onClick: () => api.openExternal(t.link) });
  }
  showMenu(items, pos);
}

async function removeFromAlbum(tracks) {
  const album = state.album;
  if (!album) return;
  try {
    state.album = await api.albums.removeTracks(album.id, tracks.map((t) => t.id));
    toast(tracks.length === 1 ? `«${tracks[0].title}» убран из альбома` : 'Треки убраны из альбома');
    await refreshAlbums();
    renderAlbum();
  } catch (e) { toast(e.message, 'err'); }
}

async function renameAlbum() {
  const album = state.album;
  if (!album) return;
  const title = await ask({ title: 'Переименовать альбом', value: album.title, ok: 'Сохранить' });
  if (!title || title === album.title) return;
  try {
    await api.albums.rename(album.id, title);
    toast('Альбом переименован');
    await refreshAlbums();
    openView('albums', album.id);
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteAlbum() {
  const album = state.album;
  if (!album) return;
  const n = album.tracks.length;
  const ok = await ask({
    title: `Удалить «${album.title}»?`,
    text: n ? `Из приложения пропадёт сам альбом. Треки останутся в своих источниках (${n} ${plural(n, 'трек', 'трека', 'треков')}).` : 'Альбом пустой.',
    ok: 'Удалить альбом', input: false, danger: true,
  });
  if (!ok) return;
  try {
    await api.albums.remove(album.id);
    toast(`Альбом «${album.title}» удалён`);
    state.album = null;
    await refreshAlbums();
    openView('albums');
  } catch (e) { toast(e.message, 'err'); }
}

// Порядок треков в альбоме меняется перетаскиванием (без активного поиска)
function canReorder() {
  return state.view === 'albums' && !!state.album && !(state.queries.albums || '').trim();
}

let dragFrom = -1;
const tracklistEl = $('#tracklist');
tracklistEl.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.row');
  if (!row || !canReorder()) return;
  dragFrom = +row.dataset.i;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/x-tishe-row', String(dragFrom));
});
tracklistEl.addEventListener('dragover', (e) => {
  if (dragFrom < 0) return;
  e.preventDefault();
  e.stopPropagation();
  const row = e.target.closest('.row');
  $$('.drop-before, .drop-after', tracklistEl).forEach((r) => r.classList.remove('drop-before', 'drop-after'));
  if (!row) return;
  const r = row.getBoundingClientRect();
  row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
});
tracklistEl.addEventListener('drop', async (e) => {
  if (dragFrom < 0) return;
  e.preventDefault();
  e.stopPropagation();
  const row = e.target.closest('.row');
  const from = dragFrom;
  dragFrom = -1;
  if (!row) return;
  let to = +row.dataset.i + (row.classList.contains('drop-after') ? 1 : 0);
  if (to > from) to--;
  if (to === from) { renderAlbum(); return; }
  try {
    state.album = await api.albums.move(state.album.id, from, to);
    renderAlbum();
  } catch (err) { toast(err.message, 'err'); }
});
tracklistEl.addEventListener('dragend', () => {
  dragFrom = -1;
  $$('.dragging, .drop-before, .drop-after', tracklistEl).forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after'));
});

function renderAlbum() {
  const a = state.album;
  if (!a || state.view !== 'albums') return;
  $('#view-title').textContent = a.title;
  const q = (state.queries.albums || '').trim().toLowerCase();
  const tracks = q ? a.tracks.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) : a.tracks;
  if (!a.tracks.length) {
    showEmpty({
      title: 'Альбом пока пустой',
      text: 'Открой любой источник, нажми «⋯» у трека или кликни по нему правой кнопкой и выбери этот альбом. Играющий трек добавляется кнопкой под бочкой.',
      actions: [['Открыть мои файлы', () => openView('local'), true]],
    });
    return;
  }
  if (!tracks.length) { showEmpty({ title: 'Ничего не нашлось', text: 'В этом альбоме нет совпадений.' }); return; }
  renderTracks(tracks, q ? `${summary(tracks)} из ${a.tracks.length}` : `${summary(tracks)}. Порядок меняется перетаскиванием`);
}

function renderTracks(tracks, subtitle) {
  state.shown = tracks;
  $('#empty').hidden = true;
  const list = $('#tracklist');
  list.hidden = false;
  list.innerHTML = tracks.map(rowHtml).join('');
  list.scrollTop = 0;
  $('#view-sub').textContent = subtitle ?? summary(tracks);
  markPlaying();
  renderActions();
}

function showEmpty({ title, text = '', actions = [], loading = false }) {
  state.shown = [];
  $('#tracklist').hidden = true;
  $('#tracklist').innerHTML = '';
  const el = $('#empty');
  el.hidden = false;
  el.innerHTML = `${loading ? '<div class="spinner"></div>' : ''}
    ${title ? `<h3>${esc(title)}</h3>` : ''}${text ? `<p>${esc(text)}</p>` : ''}
    <div class="actions"></div>`;
  for (const [label, fn, primary] of actions) {
    const b = document.createElement('button');
    b.className = `btn${primary ? ' primary' : ''}`;
    b.textContent = label;
    b.onclick = fn;
    el.querySelector('.actions').append(b);
  }
  renderActions();
}

$('#tracklist').addEventListener('click', (e) => {
  const more = e.target.closest('.row-more');
  if (more) {
    if (more.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
    openTrackMenu(+more.closest('.row').dataset.i, { anchor: more });
    return;
  }
  const row = e.target.closest('.row');
  if (!row) return;
  const i = +row.dataset.i;
  const t = state.shown[i];
  const btn = e.target.closest('.play-hover');

  // «Мои файлы»: обложка, название и исполнитель открывают редактор тегов, остальная строка — играет
  if (state.view === 'local' && t.source === 'local') {
    if ((btn && btn.dataset.kind === 'edit') || e.target.closest('.editable')) { openEditor(t); return; }
    if (e.detail > 1) return; // двойной клик обрабатывается отдельно
    if (state.track?.id === t.id) togglePlay();
    else playFrom(state.shown, i);
    return;
  }

  if (!btn) return;
  if (state.track?.id === t.id) { togglePlay(); return; }
  if (t.playable !== false) playFrom(state.shown, i);
});
$('#tracklist').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  e.preventDefault();
  openTrackMenu(+row.dataset.i, { x: e.clientX, y: e.clientY });
});

$('#btn-now-album').onclick = (e) => {
  if (!state.track) return;
  const btn = e.currentTarget;
  if (btn.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
  showMenu(albumMenuItems([state.track]), { anchor: btn });
};

$('#tracklist').addEventListener('dblclick', (e) => {
  if (e.target.closest('.row-more') || state.view === 'local') return; // в файлах трек включается одним кликом
  const row = e.target.closest('.row');
  if (!row || e.target.closest('.play-hover')) return;
  const i = +row.dataset.i;
  if (state.shown[i]?.playable === false) return;
  playFrom(state.shown, i);
});

function renderActions() {
  const box = $('#head-actions');
  box.innerHTML = '';
  const add = (label, icon, fn, primary) => {
    const b = document.createElement('button');
    b.className = `btn${primary ? ' primary' : ''}${label ? '' : ' icon-only'}`;
    b.innerHTML = `${icon ? `<svg><use href="#${icon}"/></svg>` : ''}${label ? `<span>${esc(label)}</span>` : ''}`;
    b.onclick = fn;
    box.append(b);
    return b;
  };
  if (state.shown.length) {
    add('Слушать', 'i-play', () => { if (state.cfg.shuffle) toggleShuffle(); playFrom(state.shown, 0); }, true);
    add('Вперемешку', 'i-shuffle', () => {
      if (!state.cfg.shuffle) toggleShuffle();
      playFrom(state.shown, Math.floor(Math.random() * state.shown.length));
    });
  }
  if (state.view === 'albums' && state.album) {
    add('', 'i-pencil', renameAlbum).setAttribute('aria-label', 'Переименовать альбом');
    add('', 'i-trash', deleteAlbum).setAttribute('aria-label', 'Удалить альбом');
    box.lastElementChild.title = 'Удалить альбом';
    box.lastElementChild.previousElementSibling.title = 'Переименовать альбом';
  } else if (state.view === 'local' && state.cfg.localFolders.length) {
    add('', 'i-refresh', () => scanLocal(true)).setAttribute('aria-label', 'Пересканировать папки');
  } else if (['ym', 'sc', 'sp'].includes(state.view) && state.sub && state.sub !== 'search' && serviceReady(state.view)) {
    add('', 'i-refresh', () => { delete state.cache[`${state.view}:${state.sub}`]; openView(state.view, state.sub); }).setAttribute('aria-label', 'Обновить');
  }
}

// ---------- навигация ----------

function serviceReady(src) {
  if (src === 'ym') return !!state.cfg.has['ym.token'];
  if (src === 'sc') return !!state.cfg.sc.clientId;
  if (src === 'sp') return !!state.sp.connected;
  if (src === 'albums') return true;
  return true;
}

// Ряд под поиском: коллекции сервиса или действия с файлами
function renderCollections() {
  const box = $('#collections');
  box.innerHTML = '';
  const chip = (label, { active, icon, cover, count, onClick }) => {
    const b = document.createElement('button');
    b.className = `chip${active ? ' active' : ''}`;
    b.innerHTML = `${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : icon ? `<svg><use href="#${icon}"/></svg>` : ''}<span>${esc(label)}</span>${count != null ? `<span class="count">${count}</span>` : ''}`;
    b.title = label;
    b.onclick = onClick;
    box.append(b);
  };
  if (state.view === 'albums') {
    for (const a of state.albums) {
      chip(a.title, { active: state.sub === a.id, cover: a.cover, icon: 'i-list', count: a.count, onClick: () => openView('albums', a.id) });
    }
    chip('Новый альбом', { icon: 'i-plus', onClick: async () => { const a = await createAlbum(); if (a) openView('albums', a.id); } });
    box.lastElementChild.classList.add('new');
    return;
  }
  if (state.view === 'local') {
    chip('Добавить папку', { icon: 'i-plus', onClick: addFolder });
    chip('Открыть файлы', { icon: 'i-folder', onClick: openFiles });
    return;
  }
  if (!serviceReady(state.view)) return;
  for (const c of state.collections[state.view] || []) {
    chip(c.title, { active: state.sub === c.id, cover: c.cover, count: c.count, onClick: () => openView(state.view, c.id) });
  }
}

let viewSeq = 0;

async function openView(view, sub = null) {
  const seq = ++viewSeq;
  hideOverlays(); // статистика и текст песни закрываются при переходе в раздел
  state.view = view;
  state.sub = sub;
  saveCfg({ view });
  $$('.source').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#view-title').textContent = NAMES[view];
  $('#view-sub').textContent = '';
  const input = $('#search');
  input.value = state.queries[view] || '';
  input.placeholder = {
    local: 'Искать в своих файлах',
    artists: sub ? 'Искать у артиста' : 'Искать артиста',
    albums: 'Искать в альбоме',
    ym: 'Искать в Яндекс Музыке',
    sc: 'Искать в SoundCloud',
    sp: 'Искать в Spotify',
  }[view];
  renderCollections();

  if (view === 'local') { renderLocal(); return; }
  if (view === 'artists') { openArtists(sub); return; } // artists.js

  if (view === 'albums') {
    if (!sub) {
      if (!state.albums.length) {
        state.album = null;
        showEmpty({
          title: 'Собери свой первый альбом',
          text: 'В альбом можно сложить треки откуда угодно: свои файлы, Яндекс Музыку, SoundCloud и Spotify. Слушаются они потом одной очередью.',
          actions: [['Создать альбом', async () => { const a = await createAlbum(); if (a) openView('albums', a.id); }, true]],
        });
        return;
      }
      openView('albums', state.albums[0].id);
      return;
    }
    try {
      const album = await api.albums.get(sub);
      if (seq !== viewSeq) return;
      state.album = album;
      renderAlbum();
    } catch (e) {
      state.album = null;
      openView('albums');
    }
    return;
  }

  if (!serviceReady(view)) {
    const text = {
      ym: 'Нужен OAuth-токен твоего аккаунта. После этого здесь появятся поиск, «Мне нравится» и плейлисты.',
      sc: 'Нужен client_id. В настройках есть кнопка, которая находит его сама.',
      sp: 'Отсюда подтянутся твои лайки и плейлисты. Сами треки плеер найдёт и сыграет через Яндекс Музыку или SoundCloud.',
    }[view];
    showEmpty({ title: `${NAMES[view]} не подключен${view === 'ym' ? 'а' : ''}`, text, actions: [['Подключить', () => openSettings(view), true]] });
    return;
  }

  loadCollections(view);

  if (sub === 'search') {
    const r = state.results[view] || [];
    $('#view-title').textContent = state.queries[view];
    if (r.length) renderTracks(r, `${summary(r)} в ${NAMES[view]}`);
    else showEmpty({ title: 'Ничего не нашлось', text: 'Попробуй написать название иначе или только исполнителя.' });
    return;
  }

  if (!sub) {
    const canLikes = view !== 'sc' || state.cfg.has['sc.token'] || state.cfg.sc.profile;
    if (canLikes) { openView(view, 'likes'); return; }
    showEmpty({ title: 'Найди трек через поиск', text: 'Чтобы видеть свои лайки, добавь в настройках OAuth-токен или ссылку на профиль SoundCloud.', actions: [['Открыть настройки', () => openSettings('sc')]] });
    return;
  }

  const col = (state.collections[view] || []).find((c) => c.id === sub);
  $('#view-title').textContent = col?.title || (sub === 'likes' ? 'Мне нравится' : NAMES[view]);
  const key = `${view}:${sub}`;
  if (state.cache[key]) { renderTracks(state.cache[key], subtitleFor(view, state.cache[key])); return; }
  showEmpty({ loading: true, text: 'Загружаю треки…' });
  try {
    const tracks = await api.source.collection(view, sub);
    state.cache[key] = tracks;
    if (seq !== viewSeq) return;
    if (tracks.length) renderTracks(tracks, subtitleFor(view, tracks));
    else showEmpty({ title: 'Здесь пока пусто', text: 'В этой подборке нет треков.' });
  } catch (e) {
    if (seq !== viewSeq) return;
    showEmpty({ title: 'Подборка не загрузилась', text: e.message, actions: [['Повторить', () => openView(view, sub), true], ['Настройки', () => openSettings(view)]] });
  }
}

function subtitleFor(view, tracks) {
  return view === 'sp' ? `${summary(tracks)}. Звучат через Яндекс Музыку или SoundCloud` : summary(tracks);
}

async function loadCollections(src) {
  if (state.collections[src]) return;
  state.collections[src] = [];
  try {
    state.collections[src] = await api.source.collections(src);
  } catch {
    state.collections[src] = [{ id: 'likes', title: 'Мне нравится' }];
  }
  if (state.view === src) renderCollections();
}

$$('.source').forEach((b) => { b.onclick = () => openView(b.dataset.view); });

// ---------- поиск ----------

const searchInput = $('#search');
let localFilterTimer;

searchInput.addEventListener('input', () => {
  state.queries[state.view] = searchInput.value;
  if (state.view === 'local' || state.view === 'albums' || state.view === 'artists') {
    clearTimeout(localFilterTimer);
    const render = { local: renderLocal, albums: renderAlbum, artists: () => openArtists(state.sub) }[state.view];
    localFilterTimer = setTimeout(render, 120);
  }
});

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  const view = state.view;
  if (view === 'local' || view === 'albums' || view === 'artists' || !q) return;
  if (!serviceReady(view)) { openSettings(view); return; }
  state.queries[view] = q;
  const seq = ++viewSeq;
  $('#view-title').textContent = q;
  showEmpty({ loading: true, text: `Ищу в ${NAMES[view]}…` });
  try {
    state.results[view] = await api.source.search(view, q);
    if (seq !== viewSeq) return;
    openView(view, 'search');
  } catch (err) {
    if (seq !== viewSeq) return;
    showEmpty({ title: 'Поиск не сработал', text: err.message, actions: [['Настройки', () => openSettings(view)]] });
  }
});

// ---------- свои файлы ----------

function renderLocal() {
  if (state.view !== 'local') return;
  const all = [...state.opened, ...state.local];
  const q = (state.queries.local || '').trim().toLowerCase();
  const tracks = q ? all.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) : all;
  $('#view-title').textContent = NAMES.local;
  if (state.scanning && !all.length) {
    showEmpty({ loading: true, title: 'Читаю папки', text: 'Собираю названия, исполнителей и обложки из тегов.' });
    return;
  }
  if (!all.length) {
    showEmpty({
      title: 'Добавь свою музыку',
      text: 'Выбери папку с mp3, flac, ogg, m4a или wav. Можно просто перетащить файлы в окно.',
      actions: [['Добавить папку', addFolder, true], ['Открыть файлы', openFiles]],
    });
    return;
  }
  if (!tracks.length) { showEmpty({ title: 'Ничего не нашлось', text: 'В твоих файлах нет совпадений.' }); return; }
  renderTracks(tracks, q ? `${summary(tracks)} из ${all.length}` : summary(tracks));
}

async function scanLocal(announce = false) {
  if (!state.cfg.localFolders.length) { state.local = []; renderLocal(); return; }
  state.scanning = true;
  renderLocal();
  try {
    state.local = await api.local.scan();
    if (announce) toast(`Нашёл ${summary(state.local)}`);
  } catch (e) {
    toast(`Папки не прочитались: ${e.message}`, 'err');
  }
  state.scanning = false;
  renderLocal();
}

api.local.onProgress(({ done, total }) => {
  if (state.view === 'local' && state.scanning) $('#view-sub').textContent = `Прочитано ${done} из ${total}`;
});

async function addFolder() {
  try {
    const folders = await api.local.addFolder();
    if (!folders) return;
    state.cfg.localFolders = folders;
    if (state.view !== 'local') openView('local');
    await scanLocal(true);
    if (!$('#settings').hidden) renderSettings();
  } catch (e) { toast(e.message, 'err'); }
}

async function openFiles() {
  try {
    addOpened(await api.local.openFiles(), true);
  } catch (e) { toast(e.message, 'err'); }
}

function addOpened(tracks, play) {
  if (!tracks.length) return;
  const ids = new Set(tracks.map((t) => t.id));
  state.opened = [...tracks, ...state.opened.filter((t) => !ids.has(t.id))];
  if (state.view !== 'local') openView('local'); else renderLocal();
  if (play) playFrom(state.shown, Math.max(0, state.shown.findIndex((t) => t.id === tracks[0].id)));
}

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; $('#drop-hint').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-hint').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-hint').hidden = true;
  if (!e.dataTransfer.files.length) return;
  try {
    const tracks = await api.local.dropped(e.dataTransfer.files);
    if (!tracks.length) { toast('Среди файлов нет музыки', 'err'); return; }
    addOpened(tracks, true);
  } catch (err) { toast(err.message, 'err'); }
});

// ---------- настройки ----------

function openSettings(focus) {
  renderSettings().then(() => {
    if (focus) $(`#settings [data-sec="${focus}"]`)?.scrollIntoView({ block: 'start' });
  });
  $('#settings').hidden = false;
}
function closeSettings() { $('#settings').hidden = true; }
$('#open-settings').onclick = () => openSettings();
$('#close-settings').onclick = closeSettings;
$('#settings').addEventListener('pointerdown', (e) => { if (e.target.id === 'settings') closeSettings(); });

function secretField(key, label, placeholder) {
  const has = state.cfg.has[key];
  return `<div class="field"><label>${label}</label><div class="ctl">
    <input class="input" type="password" data-secret="${key}" placeholder="${has ? 'Сохранён. Вставь новый, чтобы заменить' : esc(placeholder)}" spellcheck="false">
    <button class="btn" data-save-secret="${key}">Сохранить</button>
    ${has ? `<button class="btn danger icon-only" data-clear-secret="${key}" aria-label="Удалить"><svg><use href="#i-close"/></svg></button>` : ''}
  </div></div>`;
}

const SHOW = {
  level: (v) => `${Math.round(v * 100)}%`,
  barrelLevel: (v) => `${Math.round(v * 100)}%`,
  barrelCutoff: (v) => `${Math.round(v)} Гц`,
  barrelBoom: (v) => `${Math.round(v * 100)}%`,
  threshold: (v) => `${Math.round(meterScale(v) * 100)}%`,
  micSensitivity: (v) => `${Math.round(v * 100)}%`,
  attack: (v) => `${v} мс`,
  release: (v) => `${v} мс`,
  hold: (v) => `${v} мс`,
};

function rangeField(key, label, min, max, step) {
  const v = state.cfg.duck[key];
  return `<div class="field"><label for="r-${key}">${label}</label><div class="ctl">
    <input id="r-${key}" type="range" data-duck="${key}" min="${min}" max="${max}" step="${step}" value="${v}">
    <span class="val" data-val="${key}">${SHOW[key](v)}</span></div></div>`;
}

const fadeLabel = (v) => (+v ? `${+v} с` : 'выкл');

async function renderSettings() {
  const c = state.cfg;
  const d = c.duck;
  const redirect = await api.sp.redirect().catch(() => 'http://127.0.0.1:43821/callback');
  let mics = [];
  try {
    mics = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'audioinput' && x.deviceId !== 'communications');
  } catch {}
  const barrel = d.effect !== 'volume';
  state.account = await api.account.status().catch(() => state.account);
  await refreshDiscordStatus();

  $('#settings-body').innerHTML = `
    ${accountSection()}
    <section class="sec" data-sec="ui">
      <h3 class="sec-title">Вид</h3>
      <p class="sec-desc">Интерфейс написан строчными буквами. Названия треков, артистов и тексты песен тоже, но их можно оставить как есть.</p>
      <div class="field"><label for="crossfade">Плавный переход</label><div class="ctl">
        <input id="crossfade" type="range" min="0" max="12" step="1" value="${+c.crossfade || 0}">
        <span class="val" id="crossfade-val">${fadeLabel(c.crossfade)}</span></div></div>
      <div class="field"><label>Названия треков как есть</label><div class="ctl"><label class="switch"><input type="checkbox" id="keep-titles" ${c.ui?.keepTitles ? 'checked' : ''} aria-label="Названия треков как есть"><span></span></label></div></div>
    </section>

    <section class="sec" data-sec="duck">
      <h3 class="sec-title">Когда в Discord говорят</h3>
      <p class="sec-desc">Плеер слушает звук Discord через микшер Windows, бот и токен не нужны. Пока в звонке звучит голос, музыка уходит в бочку: глухо, с гулом, как из-за стенки. В паузах она возвращается.</p>
      <div class="field"><label>Включено</label><div class="ctl"><label class="switch"><input type="checkbox" data-duck-bool="enabled" ${d.enabled ? 'checked' : ''} aria-label="Включено"><span></span></label></div></div>
      <div class="field"><label>Эффект</label><div class="ctl"><div class="seg" data-duck-seg="effect">
        <button data-v="barrel" class="${barrel ? 'on' : ''}">Бочка</button>
        <button data-v="volume" class="${barrel ? '' : 'on'}">Просто тише</button>
      </div></div></div>
      <div class="sub-fields" ${barrel ? '' : 'data-off'}>
        ${rangeField('barrelCutoff', 'Глухость (срез частот)', 250, 2500, 10)}
        ${rangeField('barrelBoom', 'Гулкость', 0, 1, 0.01)}
        ${rangeField('barrelLevel', 'Громкость в бочке', 0.2, 1, 0.01)}
      </div>
      <div class="sub-fields" ${barrel ? 'data-off' : ''}>
        ${rangeField('level', 'Громкость музыки', 0, 1, 0.01)}
      </div>
      <div class="field"><label>Когда включать</label><div class="ctl"><div class="seg" data-duck-seg="mode">
        <button data-v="voice" class="${d.mode === 'voice' ? 'on' : ''}">Пока говорят</button>
        <button data-v="call" class="${d.mode === 'call' ? 'on' : ''}">Весь звонок</button>
      </div></div></div>
      ${rangeField('threshold', 'Порог для собеседников', 0.001, 0.25, 0.001)}
      ${rangeField('attack', 'Скорость ухода в бочку', 20, 1000, 10)}
      ${rangeField('release', 'Скорость возврата', 100, 4000, 50)}
      ${rangeField('hold', 'Держать после фразы', 0, 3000, 50)}
    </section>

    <section class="sec" data-sec="mic">
      <h3 class="sec-title">Твой голос</h3>
      <p class="sec-desc">Плеер сам слушает микрофон, пока ты в звонке, через шумоподавление и эхоподавление. Фоновый шум, щелчки клавиатуры и музыка из колонок не считаются речью: детектор ждёт звук в полосе голоса, заметно громче фона и дольше 120 мс. Записей не делается, звук никуда не отправляется.</p>
      <div class="field"><label>Реагировать на мой голос</label><div class="ctl"><label class="switch"><input type="checkbox" data-duck-bool="includeMic" ${d.includeMic ? 'checked' : ''} aria-label="Реагировать на мой голос"><span></span></label></div></div>
      <div class="field"><label for="mic-device">Микрофон</label><div class="ctl">
        <select class="input" id="mic-device">
          <option value="">Как в Windows по умолчанию</option>
          ${mics.map((m) => `<option value="${esc(m.deviceId)}" ${m.deviceId === d.micDevice ? 'selected' : ''}>${esc(m.label || 'Микрофон')}</option>`).join('')}
        </select>
      </div></div>
      ${rangeField('micSensitivity', 'Чувствительность', 0, 1, 0.01)}
    </section>
${censorSettingsHtml()}

    ${discordSection()}

    <section class="sec" data-sec="ym">
      <h3 class="sec-title">Яндекс Музыка<span class="state ${c.has['ym.token'] ? 'ok' : ''}">${c.has['ym.token'] ? 'подключена' : 'не подключена'}</span></h3>
      <p class="sec-desc">Нужен OAuth-токен аккаунта. Открой <a data-ext="https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d">страницу входа Яндекса</a> и войди. После перехода скопируй из адресной строки значение <code>access_token</code>, от <code>=</code> до <code>&amp;</code>. Полные треки доступны с Плюсом, без него играют 30 секунд.</p>
      ${secretField('ym.token', 'OAuth-токен', 'y0_AgAAAA…')}
    </section>

    <section class="sec" data-sec="sc">
      <h3 class="sec-title">SoundCloud<span class="state ${c.sc.clientId ? 'ok' : ''}">${c.sc.clientId ? 'подключён' : 'не подключён'}</span></h3>
      <p class="sec-desc">Для поиска и прослушивания хватит <code>client_id</code>, его можно найти автоматически. Для лайков вставь OAuth-токен (cookie <code>oauth_token</code> на soundcloud.com) или ссылку на свой открытый профиль.</p>
      <div class="field"><label for="sc-client">client_id</label><div class="ctl">
        <input class="input" id="sc-client" value="${esc(c.sc.clientId)}" placeholder="32 символа" spellcheck="false">
        <button class="btn" id="sc-save">Сохранить</button>
        <button class="btn primary" id="sc-discover">Найти сам</button>
      </div></div>
      <div class="field"><label for="sc-profile">Профиль для лайков</label><div class="ctl">
        <input class="input" id="sc-profile" value="${esc(c.sc.profile)}" placeholder="https://soundcloud.com/имя" spellcheck="false">
        <button class="btn" id="sc-profile-save">Сохранить</button>
      </div></div>
      ${secretField('sc.token', 'OAuth-токен', 'необязательно')}
    </section>

    <section class="sec" data-sec="sp">
      <h3 class="sec-title">Spotify<span class="state ${state.sp.connected ? 'ok' : ''}">${state.sp.connected ? `вход: ${esc(state.sp.name)}` : 'не подключён'}</span></h3>
      <p class="sec-desc">Spotify не отдаёт звук другим плеерам. Отсюда берутся твои лайки и плейлисты, а каждый трек плеер находит и играет через Яндекс Музыку или SoundCloud.<br><br>
      Создай приложение на <a data-ext="https://developer.spotify.com/dashboard">developer.spotify.com</a> с галочкой Web API. В Redirect URIs добавь <code>${esc(redirect)}</code>, затем вставь сюда Client ID.</p>
      <div class="field"><label for="sp-client">Client ID</label><div class="ctl">
        <input class="input" id="sp-client" value="${esc(c.sp.clientId)}" placeholder="Client ID приложения" spellcheck="false">
        ${state.sp.connected
          ? '<button class="btn danger" id="sp-logout">Выйти</button>'
          : '<button class="btn primary" id="sp-login">Войти через Spotify</button>'}
      </div></div>
    </section>

    <section class="sec" data-sec="local">
      <h3 class="sec-title">Папки с музыкой</h3>
      <div class="folders">${c.localFolders.map((f) => `<div class="folder"><svg><use href="#i-folder"/></svg><span title="${esc(f)}">${esc(f)}</span><button data-rm-folder="${esc(f)}" aria-label="Убрать папку"><svg><use href="#i-close"/></svg></button></div>`).join('') || '<p class="sec-desc">Пока ни одной папки.</p>'}</div>
      <div class="row-actions"><button class="btn" id="folder-add"><svg><use href="#i-plus"/></svg>Добавить папку</button>${c.localFolders.length ? '<button class="btn" id="folder-rescan"><svg><use href="#i-refresh"/></svg>Пересканировать</button>' : ''}</div>
    </section>

    <section class="sec" data-sec="ext">
      <h3 class="sec-title">Другие программы</h3>
      <p class="sec-desc">Можно заодно приглушать другие программы, например браузер. Бочку к ним не применить, только громкость. Впиши имена процессов через запятую.</p>
      <div class="field"><label for="duck-targets">Процессы</label><div class="ctl">
        <input class="input" id="duck-targets" value="${esc(d.targets.join(', '))}" placeholder="chrome, browser, spotify" spellcheck="false">
      </div></div>
    </section>`;

  const body = $('#settings-body');
  bindAccount(body);
  bindDiscord(body);

  $$('[data-ext]', body).forEach((a) => { a.onclick = (e) => { e.preventDefault(); api.openExternal(a.dataset.ext); }; });
  $('#crossfade', body).oninput = (e) => {
    state.cfg.crossfade = +e.target.value;
    $('#crossfade-val', body).textContent = fadeLabel(+e.target.value);
  };
  $('#crossfade', body).onchange = (e) => saveCfg({ crossfade: +e.target.value });
  $('#keep-titles', body).onchange = (e) => {
    document.body.classList.toggle('keep-titles', e.target.checked);
    saveCfg({ ui: { keepTitles: e.target.checked } });
  };

  $$('input[data-duck]', body).forEach((inp) => {
    const key = inp.dataset.duck;
    inp.oninput = () => {
      $(`[data-val="${key}"]`, body).textContent = SHOW[key](+inp.value);
      state.cfg.duck[key] = +inp.value; // сразу слышно, пока тянешь
    };
    inp.onchange = () => saveCfg({ duck: { [key]: +inp.value } });
  });
  $$('input[data-duck-bool]', body).forEach((inp) => {
    inp.onchange = async () => { await saveCfg({ duck: { [inp.dataset.duckBool]: inp.checked } }); syncDuckSwitch(); };
  });
  $$('[data-duck-seg] button', body).forEach((b) => {
    b.onclick = async () => {
      await saveCfg({ duck: { [b.parentElement.dataset.duckSeg]: b.dataset.v } });
      renderSettings();
    };
  });
  bindCensorSettings(body); // censor.js
  $('#mic-device', body).onchange = async (e) => {
    await saveCfg({ duck: { micDevice: e.target.value } });
    micStop(); // перезапустится с новым устройством на следующем такте
  };
  $('#duck-targets', body).onchange = (e) => {
    const targets = e.target.value.split(/[,;\s]+/).map((s) => s.trim().replace(/\.exe$/i, '')).filter(Boolean);
    saveCfg({ duck: { targets } });
    if (!targets.length) api.duck.setLevel(1);
    duck.sent = -1;
  };

  $$('[data-save-secret]', body).forEach((b) => {
    b.onclick = async () => {
      const key = b.dataset.saveSecret;
      const val = $(`[data-secret="${key}"]`, body).value.trim();
      if (!val) { toast('Сначала вставь токен в поле'); return; }
      state.cfg = await api.config.secret(key, val);
      afterServiceChange(key.split('.')[0]);
      toast('Токен сохранён');
      renderSettings();
    };
  });
  $$('[data-clear-secret]', body).forEach((b) => {
    b.onclick = async () => {
      state.cfg = await api.config.secret(b.dataset.clearSecret, '');
      afterServiceChange(b.dataset.clearSecret.split('.')[0]);
      toast('Токен удалён');
      renderSettings();
    };
  });

  $('#sc-save', body).onclick = async () => {
    await saveCfg({ sc: { clientId: $('#sc-client', body).value.trim() } });
    afterServiceChange('sc');
    toast('client_id сохранён');
    renderSettings();
  };
  $('#sc-discover', body).onclick = async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Ищу…';
    try {
      const id = await api.sc.discover();
      state.cfg = await api.config.get();
      afterServiceChange('sc');
      toast(`client_id найден: ${id.slice(0, 6)}…`);
    } catch (err) { toast(err.message, 'err'); }
    renderSettings();
  };
  $('#sc-profile-save', body).onclick = async () => {
    await saveCfg({ sc: { profile: $('#sc-profile', body).value.trim() } });
    afterServiceChange('sc');
    toast('Профиль сохранён');
  };

  const login = $('#sp-login', body);
  if (login) login.onclick = async () => {
    const cid = $('#sp-client', body).value.trim();
    if (!cid) { toast('Сначала вставь Client ID', 'err'); return; }
    await saveCfg({ sp: { clientId: cid } });
    login.disabled = true;
    login.textContent = 'Жду вход в браузере…';
    try {
      const me = await api.sp.connect();
      state.sp = { connected: true, ...me };
      afterServiceChange('sp');
      toast(`Вход в Spotify выполнен: ${me.name}`);
    } catch (err) { toast(err.message, 'err'); }
    renderSettings();
  };
  const logout = $('#sp-logout', body);
  if (logout) logout.onclick = async () => {
    await api.sp.disconnect();
    state.sp = { connected: false };
    afterServiceChange('sp');
    toast('Выход из Spotify выполнен');
    renderSettings();
  };
  $('#sp-client', body).onchange = (e) => saveCfg({ sp: { clientId: e.target.value.trim() } });

  $$('[data-rm-folder]', body).forEach((b) => {
    b.onclick = async () => {
      state.cfg.localFolders = await api.local.removeFolder(b.dataset.rmFolder);
      renderSettings();
      scanLocal();
    };
  });
  $('#folder-add', body).onclick = addFolder;
  const rescan = $('#folder-rescan', body);
  if (rescan) rescan.onclick = () => scanLocal(true);
}

// ---------- аккаунт авеона ----------

function syncedAgo(ts) {
  if (!ts) return 'ещё не было';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  return new Date(ts).toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function accountSection() {
  const a = state.account;
  const desc = 'Альбомы, настройки бочки и статистика будут одинаковыми на всех твоих компьютерах. Токены сервисов, папки с музыкой и микрофон остаются только здесь.';
  if (!a.loggedIn) return ''; // без входа вместо плеера экран входа
  return `<section class="sec" data-sec="account">
    <h3 class="sec-title">Аккаунт<span class="state ok">${esc(a.name || a.login)}</span></h3>
    <p class="sec-desc">${desc}<br><br>Логин <code>${esc(a.login)}</code> на <code>${esc(a.server)}</code>. Синхронизация: ${a.syncing ? 'идёт…' : syncedAgo(a.lastSync)}.${a.error ? `<br>Последняя попытка не удалась: ${esc(a.error)}` : ''}</p>
    <div class="field"><label for="acc-name">Имя</label><div class="ctl">
      <input class="input" id="acc-name" value="${esc(a.name || '')}" maxlength="64" spellcheck="false">
      <button class="btn" id="acc-name-save">Сохранить</button>
    </div></div>
    <div class="row-actions">
      <button class="btn primary" id="acc-sync"><svg><use href="#i-refresh"/></svg>Синхронизировать</button>
      <button class="btn" id="acc-password">Сменить пароль</button>
      <button class="btn" id="acc-logout-all">Выйти на других устройствах</button>
      <button class="btn" id="acc-logout">Выйти</button>
      <button class="btn danger" id="acc-delete">Удалить аккаунт</button>
    </div>
  </section>`;
}

// Что поменялось после синхронизации — перерисовываем только это
function applySynced(changed) {
  if (!changed) return;
  if (changed.albums) {
    refreshAlbums();
    if (state.view === 'albums' && state.album) openView('albums', state.album.id);
  }
  if (changed.settings) {
    api.config.get().then((cfg) => {
      state.cfg = cfg;
      document.body.classList.toggle('keep-titles', !!cfg.ui?.keepTitles);
      syncDuckSwitch();
      if (!$('#settings').hidden) renderSettings();
    });
  }
  if (changed.stats) loadRemoteStats().then(() => { if (!$('#stats').hidden) renderStats(); });
}

// ---------- экран входа: без аккаунта плеер закрыт ----------

const LOCAL_SERVER = /^http:\/\/(localhost|127\.|192\.168\.|10\.)/i;
const authEl = $('#auth');
let authMode = 'login';

const locked = () => !authEl.hidden;

// После входа бочка с экрана входа переезжает на своё место в плеере (FLIP):
// форма уходит, фон растворяется, бочка летит в позицию #barrel и подменяется настоящей
async function leaveAuth() {
  const fly = $('.auth-barrel', authEl);
  const target = $('#barrel');
  const from = fly.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || !from.width || !to.width) { authEl.hidden = true; return; }

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const s = to.width / from.width;
  target.style.visibility = 'hidden';
  authEl.classList.add('leaving');
  const move = fly.animate(
    [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }],
    { duration: 800, delay: 120, easing: 'cubic-bezier(.65, 0, .2, 1)', fill: 'forwards' },
  );
  // Страховка: если окно не рисуется (свёрнуто), анимация стоит — экран входа всё равно убираем
  await Promise.race([move.finished.catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);

  target.style.visibility = '';
  authEl.hidden = true;
  authEl.classList.remove('leaving');
  move.cancel();
  // в пустом иллюминаторе экрана входа была нота — обложку проявляем мягко
  $('#now-cover').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' });
}

const AUTH_TEXT = {
  login: {
    title: 'вход', sub: 'Войди, чтобы слушать. Альбомы, настройки и статистика подтянутся с сервера.',
    go: 'Войти', busy: 'Вхожу…', ask: 'Нет аккаунта?', other: 'Зарегистрироваться',
  },
  register: {
    title: 'регистрация', sub: 'Один аккаунт на все компьютеры: альбомы, настройки бочки и статистика будут везде одинаковыми.',
    go: 'Создать аккаунт', busy: 'Создаю…', ask: 'Уже есть аккаунт?', other: 'Войти',
  },
};

function setAuthMode(mode) {
  authMode = mode;
  const t = AUTH_TEXT[mode];
  const reg = mode === 'register';
  $('#auth-title').textContent = t.title;
  $('#auth-sub').textContent = t.sub;
  $('#auth-go').textContent = t.go;
  $('#auth-switch-text').textContent = t.ask;
  $('#auth-switch').textContent = t.other;
  $('#auth-password2-field').hidden = !reg;
  $('#auth-password').autocomplete = reg ? 'new-password' : 'current-password';
  $('#auth-password').placeholder = reg ? 'не короче 8 символов' : '';
  $('#auth-error').textContent = '';
}

// Адрес сервера: вшитый — не показываем; уже известный — одной строкой с «изменить»; иначе поле
function showServer(edit) {
  const a = state.account;
  const known = a.server || a.defaultServer;
  const field = !a.defaultServer && (edit || !known);
  $('#auth-server-field').hidden = !field;
  $('#auth-server-line').hidden = field || !!a.defaultServer;
  $('#auth-server-host').textContent = (known || '').replace(/^https?:\/\//, '');
  if (field) $('#auth-server').value = (a.server || '').replace(/^https?:\/\//, '');
}

function showAuth(message = '') {
  if (!audio.paused) togglePlay();
  closeSettings();
  closeMenu();
  const a = state.account;
  showServer(false);
  $('#auth-login').value = a.login || $('#auth-login').value;
  $('#auth-password').value = $('#auth-password2').value = '';
  setAuthMode(authMode);
  $('#auth-error').textContent = message;
  authEl.hidden = false;
  const first = !$('#auth-server-field').hidden && !$('#auth-server').value ? '#auth-server'
    : $('#auth-login').value ? '#auth-password' : '#auth-login';
  $(first).focus();
}

$('#auth-switch').onclick = () => {
  setAuthMode(authMode === 'login' ? 'register' : 'login');
  $('#auth-login').focus();
};
$('#auth-server-edit').onclick = () => {
  showServer(true);
  $('#auth-server').focus();
};

$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('#auth-error');
  const server = $('#auth-server-field').hidden ? state.account.server || '' : $('#auth-server').value.trim();
  const login = $('#auth-login').value.trim();
  const password = $('#auth-password').value;
  const register = authMode === 'register';
  const fail = (msg, field) => { err.textContent = msg; if (field) $(field).focus(); };
  if (!$('#auth-server-field').hidden && !server) return fail('Укажи адрес сервера', '#auth-server');
  if (!login) return fail('Введи логин', '#auth-login');
  if (!password) return fail('Введи пароль', '#auth-password');
  if (register && password.length < 8) return fail('Пароль должен быть не короче 8 символов', '#auth-password');
  if (register && password !== $('#auth-password2').value) return fail('Пароли не совпадают', '#auth-password2');

  const go = $('#auth-go');
  go.disabled = true;
  go.textContent = AUTH_TEXT[authMode].busy;
  err.textContent = '';
  try {
    const r = register
      ? await api.account.register(server, login, password, '')
      : await api.account.login(server, login, password);
    state.account = r.status;
    leaveAuth();
    if (/^http:\/\//i.test(r.status.server) && !LOCAL_SERVER.test(r.status.server)) {
      toast('Сервер без https: пароль идёт по сети открытым текстом', 'err');
    }
    toast(register ? `Аккаунт создан, привет, ${r.status.name || r.status.login}` : `С возвращением, ${r.status.name || r.status.login}`);
    applySynced(r.changed);
  } catch (ex) {
    fail(ex.message, '#auth-password');
  }
  go.disabled = false;
  go.textContent = AUTH_TEXT[authMode].go;
};

function bindAccount(body) {
  if (!$('#acc-name-save', body)) return;

  $('#acc-name-save', body).onclick = async () => {
    try {
      state.account = await api.account.rename($('#acc-name', body).value.trim());
      toast('Имя сохранено');
      renderSettings();
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#acc-sync', body).onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api.account.sync();
      toast('Синхронизировано');
    } catch (err) { toast(err.message, 'err'); }
    renderSettings();
  };
  $('#acc-password', body).onclick = async () => {
    const old = await ask({ title: 'Смена пароля', text: 'Текущий пароль', ok: 'Дальше', password: true });
    if (!old) return;
    const next = await ask({
      title: 'Смена пароля',
      text: 'Новый пароль, не короче 8 символов. На других устройствах нужно будет войти заново.',
      ok: 'Сменить', password: true,
    });
    if (!next) return;
    try {
      await api.account.password(old, next);
      toast('Пароль изменён');
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#acc-logout-all', body).onclick = async () => {
    try {
      const r = await api.account.logoutAll();
      toast(r.closed ? `Закрыто сессий: ${r.closed}` : 'Других сессий нет');
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#acc-logout', body).onclick = async () => {
    state.account = await api.account.logout();
    showAuth();
    toast('Выход выполнен. Альбомы и статистика остались на этом компьютере');
  };
  $('#acc-delete', body).onclick = async () => {
    const password = await ask({
      title: 'Удалить аккаунт?',
      text: 'С сервера пропадут альбомы, настройки и статистика. На этом компьютере всё останется. Введи пароль, чтобы подтвердить.',
      ok: 'Удалить', danger: true, password: true,
    });
    if (!password) return;
    try {
      state.account = await api.account.remove(password);
      setAuthMode('register');
      showAuth();
      toast('Аккаунт удалён');
    } catch (err) { toast(err.message, 'err'); }
  };
}

api.account.onEvent((ev) => {
  if (ev.status) state.account = ev.status;
  if (ev.status && !ev.status.loggedIn) {
    if (!locked()) showAuth(ev.error || '');
    return;
  }
  if (ev.error) toast(ev.error, 'err');
  applySynced(ev.changed);
  // не перерисовываем настройки, пока в них что-то печатают
  if (!$('#settings').hidden && !document.activeElement?.closest('#settings-body')) renderSettings();
});

function afterServiceChange(src) {
  for (const k of Object.keys(state.cache)) if (k.startsWith(`${src}:`) || k.startsWith('sp:')) delete state.cache[k];
  delete state.collections[src];
  if (state.view === src) openView(src);
}

function syncDuckSwitch() {
  $('#duck-enabled').checked = state.cfg.duck.enabled;
}

// ---------- кнопки плеера ----------

function toggleShuffle() {
  state.cfg.shuffle = !state.cfg.shuffle;
  saveCfg({ shuffle: state.cfg.shuffle });
  if (state.queue.length) buildOrder(state.order[state.pos]);
  renderModes();
}

function cycleRepeat() {
  state.cfg.repeat = { off: 'all', all: 'one', one: 'off' }[state.cfg.repeat];
  saveCfg({ repeat: state.cfg.repeat });
  renderModes();
}

function renderModes() {
  $('#btn-shuffle').classList.toggle('on', state.cfg.shuffle);
  const r = $('#btn-repeat');
  r.classList.toggle('on', state.cfg.repeat !== 'off');
  r.classList.toggle('one', state.cfg.repeat === 'one');
  r.setAttribute('aria-label', { off: 'Повтор выключен', all: 'Повтор списка', one: 'Повтор трека' }[state.cfg.repeat]);
  r.title = r.getAttribute('aria-label');
}

function setVolume(v, persist) {
  state.cfg.volume = Math.round(v * 100) / 100;
  state.muted = false;
  applyVolume();
  if (persist) saveCfg({ volume: state.cfg.volume });
}

function toggleMute() {
  state.muted = !state.muted;
  applyVolume();
}

$('#btn-play').onclick = togglePlay;
$('#btn-next').onclick = () => next();
$('#btn-prev').onclick = prev;
$('#btn-shuffle').onclick = toggleShuffle;
$('#btn-repeat').onclick = cycleRepeat;
$('#btn-mute').onclick = toggleMute;

makeSlider($('#progress'), {
  onInput: (f) => {
    seeking = true;
    const d = audio.duration || state.track?.duration || 0;
    setSlider($('#progress'), f);
    $('#time-cur').textContent = fmt(f * d);
  },
  onChange: (f) => {
    const d = audio.duration;
    if (d && isFinite(d)) audio.currentTime = f * d;
    seeking = false;
  },
});
makeSlider($('#volume'), { onInput: (f) => setVolume(f, false), onChange: (f) => setVolume(f, true) });
$('#volume').addEventListener('wheel', (e) => {
  e.preventDefault();
  setVolume(Math.min(1, Math.max(0, state.cfg.volume - Math.sign(e.deltaY) * 0.05)), true);
}, { passive: false });

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', togglePlay);
  ms.setActionHandler('pause', togglePlay);
  ms.setActionHandler('nexttrack', () => next());
  ms.setActionHandler('previoustrack', prev);
  ms.setActionHandler('seekto', (e) => { audio.currentTime = e.seekTime; });
}

document.addEventListener('keydown', (e) => {
  if (locked()) return; // горячие клавиши плеера не работают под экраном входа
  const typing = e.target.matches('input, textarea, select');
  if (e.key === 'Escape') {
    if (!menuEl.hidden) { closeMenu(); return; }
    if (!$('#settings').hidden) closeSettings();
    else if (typing) e.target.blur();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); closeSettings(); searchInput.focus(); searchInput.select(); return; }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); openSettings(); return; }
  if (typing) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.ctrlKey && e.key === 'ArrowRight') next();
  else if (e.ctrlKey && e.key === 'ArrowLeft') prev();
  else if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
  else if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
  else if (e.key === 'ArrowUp') { e.preventDefault(); setVolume(Math.min(1, state.cfg.volume + 0.05), true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); setVolume(Math.max(0, state.cfg.volume - 0.05), true); }
  else if (e.code === 'KeyM') toggleMute();
  else if (e.code === 'KeyS') toggleShuffle();
  else if (e.code === 'KeyR') cycleRepeat();
});

// ---------- окно ----------

$$('[data-win]').forEach((b) => { b.onclick = () => api.win.action(b.dataset.win); });
api.win.onThumb((action) => {
  if (locked()) return;
  if (action === 'toggle') togglePlay();
  else if (action === 'next') next();
  else if (action === 'prev') prev();
});

// ---------- старт ----------
// Запускаемся, когда выполнены все скрипты (extras.js подключается после app.js)

async function init() {
  state.cfg = await api.config.get();
  state.account = await api.account.status().catch(() => state.account);
  if (!state.account.loggedIn) showAuth();
  document.body.classList.toggle('keep-titles', !!state.cfg.ui?.keepTitles);
  syncDuckSwitch();
  renderModes();
  applyVolume();
  await Promise.all([refreshAlbums(), loadStats()]);
  const start = VIEWS.includes(state.cfg.view) ? state.cfg.view : 'local';
  if (state.cfg.localFolders.length) scanLocal();
  api.sp.status().then((s) => {
    state.sp = s;
    if (state.view === 'sp') openView('sp');
  }).catch(() => {});
  openView(start);
  restoreSession(); // трек на паузе там, где остановились в прошлый раз
}

window.addEventListener('DOMContentLoaded', () => init().catch((e) => console.error('init', e)));
