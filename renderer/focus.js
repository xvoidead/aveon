'use strict';
// Режим «фокус»: таймер «помидора» для работы и учёбы. Работа — музыка звучит (можно включить волну
// без слов), перерыв — музыка уходит в бочку или на паузу; смена этапа — тихий звонок и остров.
// Общие глобальные: state, audio, duck, $, esc, toast, saveCfg, togglePlay, waveStart, Wave, ctx, ensureGraph.

const FOCUS_DEFAULTS = { work: 25, rest: 5, long: 15, every: 4, music: 'wave', onRest: 'barrel' };
const focusCfg = () => ({ ...FOCUS_DEFAULTS, ...(state.cfg?.focus || {}) });
const pomo = { on: false, phase: 'work', endsAt: 0, round: 1, paused: 0, tick: 0 };

function focusLeft() { return pomo.paused || Math.max(0, pomo.endsAt - Date.now()); }
const fmmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// короткий звонок из двух нот — без файлов, прямо генератором
function chime() {
  ensureGraph();
  const t = ctx.currentTime;
  for (const [f, at] of [[880, 0], [1318.5, 0.18]]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t + at);
    g.gain.linearRampToValueAtTime(0.18, t + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 1.2);
    o.connect(g).connect(ctx.destination);
    o.start(t + at);
    o.stop(t + at + 1.3);
  }
}

async function startFocus() {
  const c = focusCfg();
  pomo.on = true;
  pomo.phase = 'work';
  pomo.round = 1;
  pomo.paused = 0;
  pomo.endsAt = Date.now() + c.work * 60000;
  duck.focus = false;
  if (c.music === 'wave') {
    // волна без слов, если Яндекс подключён; иначе — своя волна
    if (waveMode() === 'ym') await saveCfg({ wave: { language: 'without-words' } });
    if (!Wave.active) await waveStart();
  } else if (c.music === 'current' && audio.paused && state.track) togglePlay();
  toast(`Фокус: ${c.work} минут работы. Удачи!`);
  renderFocus();
}

function stopFocus() {
  pomo.on = false;
  duck.focus = false;
  renderFocus();
  toast('Фокус завершён');
}

function nextPhase() {
  const c = focusCfg();
  chime();
  if (pomo.phase === 'work') {
    const long = pomo.round % c.every === 0;
    pomo.phase = 'rest';
    pomo.endsAt = Date.now() + (long ? c.long : c.rest) * 60000;
    if (c.onRest === 'barrel') duck.focus = true;
    else if (c.onRest === 'pause' && !audio.paused) togglePlay();
    const text = long ? `Длинный перерыв — ${c.long} минут` : `Перерыв — ${c.rest} минут`;
    toast(text);
    if (typeof islandNotify === 'function') islandNotify(text);
  } else {
    pomo.phase = 'work';
    pomo.round++;
    pomo.endsAt = Date.now() + c.work * 60000;
    duck.focus = false;
    if (c.onRest === 'pause' && audio.paused && state.track) togglePlay();
    toast(`Раунд ${pomo.round}: снова работаем`);
    if (typeof islandNotify === 'function') islandNotify(`Раунд ${pomo.round} — работаем`);
  }
  renderFocus();
}

setInterval(() => {
  if (!pomo.on) return;
  if (!pomo.paused && Date.now() >= pomo.endsAt) nextPhase();
  renderFocus();
}, 500);

function toggleFocusPause() {
  if (!pomo.on) return;
  if (pomo.paused) { pomo.endsAt = Date.now() + pomo.paused; pomo.paused = 0; }
  else pomo.paused = pomo.endsAt - Date.now();
  renderFocus();
}

// Плашка на сцене и панель с кругом таймера
function renderFocus() {
  let chip = $('#focus-chip');
  if (!pomo.on) {
    chip?.remove();
    const p = $('#focus');
    if (p) p.hidden = true;
    return;
  }
  if (!chip) {
    chip = document.createElement('button');
    chip.id = 'focus-chip';
    chip.className = 'mode-chip focus';
    chip.onclick = openFocus;
    $('.now').after(chip);
  }
  chip.classList.toggle('rest', pomo.phase === 'rest');
  chip.innerHTML = `<svg><use href="#i-focus"/></svg><span>${pomo.phase === 'work' ? 'фокус' : 'перерыв'} ${fmmss(focusLeft())}${pomo.paused ? ' · пауза' : ''}</span>`;
  const p = $('#focus');
  if (p && !p.hidden) paintFocusPanel();
}

function openFocus() {
  let p = $('#focus');
  if (!p) {
    p = document.createElement('div');
    p.className = 'modal';
    p.id = 'focus';
    document.body.appendChild(p);
    p.addEventListener('pointerdown', (e) => { if (e.target === p) p.hidden = true; });
  }
  p.hidden = false;
  paintFocusPanel(true);
}

function paintFocusPanel(full) {
  const p = $('#focus');
  const c = focusCfg();
  const total = (pomo.phase === 'work' ? c.work : (pomo.round % c.every === 0 ? c.long : c.rest)) * 60000;
  const k = pomo.on ? 1 - focusLeft() / total : 0;
  const ring = `<svg class="focus-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" class="track"/><circle cx="60" cy="60" r="54" class="bar" style="stroke-dashoffset:${(339.3 * (1 - k)).toFixed(1)}"/></svg>`;
  if (!full && p.querySelector('.focus-time')) {
    p.querySelector('.focus-ring').outerHTML = ring;
    p.querySelector('.focus-time').textContent = pomo.on ? fmmss(focusLeft()) : `${c.work}:00`;
    p.querySelector('.focus-phase').textContent = pomo.on ? (pomo.phase === 'work' ? `Работа, раунд ${pomo.round}` : 'Перерыв') : 'Готов?';
    return;
  }
  const opt = (key, list, cur) => `<div class="seg wrap" data-focus="${key}">${list.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  p.innerHTML = `<div class="sheet focus-sheet ${pomo.phase === 'rest' ? 'rest' : ''}" role="dialog" aria-label="Режим фокуса">
    <div class="sheet-head"><h2>Фокус</h2><button class="icon-btn" data-close aria-label="Закрыть"><svg><use href="#i-close"/></svg></button></div>
    <div class="sheet-body">
      <div class="focus-dial">${ring}<div class="focus-center"><b class="focus-time">${pomo.on ? fmmss(focusLeft()) : `${c.work}:00`}</b><span class="focus-phase">${pomo.on ? (pomo.phase === 'work' ? `Работа, раунд ${pomo.round}` : 'Перерыв') : 'Готов?'}</span></div></div>
      <div class="focus-actions">
        ${pomo.on
          ? `<button class="btn" id="focus-pause">${pomo.paused ? 'Продолжить' : 'Пауза'}</button><button class="btn" id="focus-skip">${pomo.phase === 'work' ? 'К перерыву' : 'К работе'}</button><button class="btn danger" id="focus-stop">Закончить</button>`
          : '<button class="btn primary" id="focus-start">Начать</button>'}
      </div>
      <div class="field"><label>Работа, мин</label><div class="ctl">${opt('work', [[15, '15'], [25, '25'], [45, '45'], [50, '50'], [90, '90']], c.work)}</div></div>
      <div class="field"><label>Перерыв, мин</label><div class="ctl">${opt('rest', [[5, '5'], [10, '10'], [15, '15']], c.rest)}</div></div>
      <div class="field"><label>Музыка</label><div class="ctl">${opt('music', [['wave', 'Волна без слов'], ['current', 'Что играет'], ['none', 'Не трогать']], c.music)}</div></div>
      <div class="field"><label>В перерыв</label><div class="ctl">${opt('onRest', [['barrel', 'В бочку'], ['pause', 'Пауза'], ['keep', 'Играет дальше']], c.onRest)}</div></div>
    </div>
  </div>`;
  p.querySelector('[data-close]').onclick = () => { p.hidden = true; };
  p.querySelector('#focus-start')?.addEventListener('click', async () => { await startFocus(); paintFocusPanel(true); });
  p.querySelector('#focus-pause')?.addEventListener('click', () => { toggleFocusPause(); paintFocusPanel(true); });
  p.querySelector('#focus-skip')?.addEventListener('click', () => { nextPhase(); paintFocusPanel(true); });
  p.querySelector('#focus-stop')?.addEventListener('click', () => { stopFocus(); paintFocusPanel(true); });
  p.querySelectorAll('[data-focus] button').forEach((b) => {
    b.onclick = async () => {
      const key = b.closest('[data-focus]').dataset.focus;
      const v = ['work', 'rest'].includes(key) ? +b.dataset.v : b.dataset.v;
      await saveCfg({ focus: { ...focusCfg(), [key]: v } });
      paintFocusPanel(true);
    };
  });
}
