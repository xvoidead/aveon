// ---------- эквалайзер ----------
// 10 полос от 32 Гц до 16 кГц, ±12 дБ: крайние — полки, остальные — колокола. Стоит первым в графе
// (см. ensureGraph в app.js), поэтому бочка и цензура звучат уже поверх выровненного звука.

const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_MAX = 12;
const EQ_PRESETS = [
  ['flat', 'Ровно', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['bass', 'Бас', [6, 5, 4, 2, 0, 0, 0, 0, 0, 0]],
  ['vocal', 'Вокал', [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1]],
  ['treble', 'Высокие', [0, 0, 0, 0, 0, 1, 2, 4, 5, 6]],
  ['loud', 'Громко', [5, 4, 2, 0, -1, -1, 0, 2, 4, 5]],
  ['rock', 'Рок', [4, 3, 2, 0, -1, 0, 2, 3, 4, 4]],
  ['electro', 'Электроника', [5, 4, 1, 0, -2, 1, 0, 2, 4, 5]],
];

const fmtHz = (f) => (f >= 1000 ? `${f / 1000}к` : String(f));
const fmtDb = (v) => `${v > 0 ? '+' : ''}${v % 1 ? v.toFixed(1) : v}`;

function eqFilter(c, i) {
  const f = c.createBiquadFilter();
  f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
  f.frequency.value = EQ_FREQS[i];
  f.Q.value = 1.41;
  f.gain.value = 0;
  return f;
}

// Вызывается из ensureGraph: вход — источник звука, выход — после предусилителя
function eqBuild(input) {
  fx.eq = EQ_FREQS.map((_, i) => eqFilter(ctx, i));
  fx.eqPre = ctx.createGain();
  let node = input;
  for (const f of fx.eq) node = node.connect(f);
  node.connect(fx.eqPre);
  eqApply();
  return fx.eqPre;
}

// Текущие значения: выключенный эквалайзер = все полосы в ноль
function eqValues() {
  const e = state.cfg.eq;
  return e.enabled ? { gains: e.gains, preamp: e.preamp } : { gains: EQ_FREQS.map(() => 0), preamp: 0 };
}

function eqApply() {
  if (!fx.eq || !state.cfg?.eq) return;
  const { gains, preamp } = eqValues();
  const t = ctx.currentTime;
  fx.eq.forEach((f, i) => f.gain.setTargetAtTime(gains[i] || 0, t, 0.015));
  fx.eqPre.gain.setTargetAtTime(Math.pow(10, preamp / 20), t, 0.015);
}

// ---------- всплывающее окно ----------

const eqEl = $('#eq');
const eqOpen = () => !eqEl.hidden;

function openEq() {
  eqEl.hidden = false;
  $('#btn-eq').setAttribute('aria-pressed', 'true');
  renderEq();
  requestAnimationFrame(drawEqCurve); // кривой нужны размеры ползунков после раскладки окна
}

function closeEq() {
  eqEl.hidden = true;
  $('#btn-eq').setAttribute('aria-pressed', 'false');
}

function renderEq() {
  const e = state.cfg.eq;
  eqEl.classList.toggle('off', !e.enabled);
  $('#eq-enabled').checked = e.enabled;
  $('#eq-presets').innerHTML = [...EQ_PRESETS.map(([id, label]) => [id, label]), ...(e.preset === 'custom' ? [['custom', 'Свой']] : [])]
    .map(([id, label]) => `<button data-preset="${id}" class="${e.preset === id ? 'on' : ''}">${label}</button>`).join('');
  $('#eq-bands').innerHTML = EQ_FREQS.map((f, i) => `
    <div class="eq-band">
      <span class="db ${e.gains[i] ? 'on' : ''}" data-db="${i}">${fmtDb(e.gains[i])}</span>
      <input type="range" data-band="${i}" min="${-EQ_MAX}" max="${EQ_MAX}" step="0.5" value="${e.gains[i]}" aria-label="${fmtHz(f)} Гц" title="Двойной клик — в ноль">
      <span class="hz">${fmtHz(f)}</span>
    </div>`).join('');
  $('#eq-preamp').value = e.preamp;
  $('#eq-preamp-val').textContent = `${fmtDb(e.preamp)} дБ`;
  drawEqCurve();
}

// Пока тянешь — слышно сразу, сохраняем по отпусканию
function eqLive(patch) {
  Object.assign(state.cfg.eq, patch);
  eqApply();
  drawEqCurve();
}

function eqSave() {
  const { enabled, preset, gains, preamp } = state.cfg.eq;
  return saveCfg({ eq: { enabled, preset, gains: [...gains], preamp } });
}

$('#eq-bands').addEventListener('input', (e) => {
  const i = e.target.dataset?.band;
  if (i == null) return;
  const gains = [...state.cfg.eq.gains];
  gains[+i] = +e.target.value;
  const db = $(`[data-db="${i}"]`);
  db.textContent = fmtDb(gains[+i]);
  db.classList.toggle('on', !!gains[+i]);
  eqLive({ gains, preset: 'custom' });
});
$('#eq-bands').addEventListener('change', async () => { await eqSave(); renderEq(); });
$('#eq-bands').addEventListener('dblclick', async (e) => {
  const i = e.target.dataset?.band;
  if (i == null) return;
  const gains = [...state.cfg.eq.gains];
  gains[+i] = 0;
  eqLive({ gains, preset: 'custom' });
  await eqSave();
  renderEq();
});

$('#eq-presets').addEventListener('click', async (e) => {
  const id = e.target.closest('button')?.dataset.preset;
  const p = EQ_PRESETS.find(([pid]) => pid === id);
  if (!p) return;
  // Запас по громкости: половина самого сильного подъёма, чтобы громкие места не хрипели
  const boost = Math.max(0, ...p[2]);
  eqLive({ preset: id, gains: [...p[2]], preamp: -Math.round(boost) / 2, enabled: true });
  await eqSave();
  renderEq();
});

$('#eq-preamp').addEventListener('input', (e) => {
  $('#eq-preamp-val').textContent = `${fmtDb(+e.target.value)} дБ`;
  eqLive({ preamp: +e.target.value });
});
$('#eq-preamp').addEventListener('change', eqSave);

$('#eq-enabled').addEventListener('change', async (e) => {
  eqLive({ enabled: e.target.checked });
  await eqSave();
  renderEq();
});

$('#eq-reset').onclick = async () => {
  eqLive({ preset: 'flat', gains: EQ_FREQS.map(() => 0), preamp: 0 });
  await eqSave();
  renderEq();
};

$('#btn-eq').onclick = () => (eqOpen() ? closeEq() : openEq());
$('#eq-close').onclick = closeEq;
eqEl.addEventListener('pointerdown', (e) => { if (e.target === eqEl) closeEq(); }); // клик мимо окна
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && eqOpen()) { e.stopPropagation(); closeEq(); return; }
  if (e.target.matches('input, textarea, select') || e.ctrlKey || e.altKey) return;
  if (!$('#editor').hidden || !$('#dialog').hidden || !$('#settings').hidden) return;
  if (e.code === 'KeyE') (eqOpen() ? closeEq() : openEq());
});

// ---------- кривая АЧХ ----------
// Считаем на своих фильтрах в OfflineAudioContext: так кривая видна, даже пока звук ни разу не играл.
// По горизонтали частоты разложены так, чтобы центры полос совпали с ползунками.

let eqProbe = null;

function drawEqCurve() {
  if (!eqOpen()) return;
  const cv = $('#eq-curve');
  // Кривая ровно по ходу ручек ползунков: от центра ручки на +12 до центра на −12
  const slider = $('#eq-bands input');
  if (slider) {
    const panel = $('#eq-panel').getBoundingClientRect();
    const r = slider.getBoundingClientRect();
    const knob = 8; // радиус стандартной ручки Chromium
    cv.style.top = `${r.top - panel.top + knob}px`;
    cv.style.height = `${r.height - knob * 2}px`;
  }
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (!w || !h) return;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  if (!eqProbe) {
    const oc = new OfflineAudioContext(1, 1, 48000);
    eqProbe = EQ_FREQS.map((_, i) => eqFilter(oc, i));
  }
  const { gains } = eqValues();
  eqProbe.forEach((f, i) => { f.gain.value = gains[i] || 0; });

  const col = w / EQ_FREQS.length;
  const span = Math.log2(EQ_FREQS[EQ_FREQS.length - 1] / EQ_FREQS[0]);
  const freqs = new Float32Array(w);
  for (let x = 0; x < w; x++) freqs[x] = Math.min(23000, EQ_FREQS[0] * Math.pow(2, ((x - col / 2) / (w - col)) * span));
  const total = new Float32Array(w);
  const mag = new Float32Array(w), ph = new Float32Array(w);
  for (const f of eqProbe) {
    f.getFrequencyResponse(freqs, mag, ph);
    for (let x = 0; x < w; x++) total[x] += 20 * Math.log10(mag[x] || 1e-6);
  }

  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--amber').trim() || '#f0a63a';
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const y = (db) => h / 2 - (Math.max(-EQ_MAX, Math.min(EQ_MAX, db)) / EQ_MAX) * (h / 2);

  g.strokeStyle = css.getPropertyValue('--rivet-2').trim() || '#33271f';
  g.lineWidth = dpr;
  g.setLineDash([4 * dpr, 4 * dpr]);
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.setLineDash([]);

  g.beginPath();
  for (let x = 0; x < w; x++) (x ? g.lineTo(x, y(total[x])) : g.moveTo(x, y(total[x])));
  g.lineTo(w, h / 2); g.lineTo(0, h / 2); g.closePath();
  g.globalAlpha = 0.14;
  g.fillStyle = accent;
  g.fill();
  g.globalAlpha = 1;
  g.beginPath();
  for (let x = 0; x < w; x++) (x ? g.lineTo(x, y(total[x])) : g.moveTo(x, y(total[x])));
  g.strokeStyle = accent;
  g.lineWidth = 2 * dpr;
  g.lineJoin = 'round';
  g.stroke();
}

window.addEventListener('resize', drawEqCurve);
