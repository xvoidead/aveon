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

const eqMine = () => state.cfg.eq.custom || [];

function renderEq() {
  const e = state.cfg.eq;
  eqEl.classList.toggle('off', !e.enabled);
  $('#eq-enabled').checked = e.enabled;
  $('#eq-presets').innerHTML = [...EQ_PRESETS.map(([id, label]) => [id, label]), ...(e.preset === 'custom' ? [['custom', 'Свой']] : [])]
    .map(([id, label]) => `<button data-preset="${id}" class="${e.preset === id ? 'on' : ''}">${label}</button>`).join('');
  renderEqMine();
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
  const { enabled, preset, gains, preamp, custom = [] } = state.cfg.eq;
  return saveCfg({ eq: { enabled, preset, gains: [...gains], preamp, custom } });
}

// ---------- свои пресеты ----------
// Ряд под встроенными: свои пресеты (у каждого меню «⋯») и «Сохранить как пресет».
// Хранятся в настройках эквалайзера и вместе с ними синхронизируются через аккаунт.

function renderEqMine() {
  const e = state.cfg.eq;
  const mine = eqMine();
  const own = mine.find((p) => p.id === e.preset);
  $('#eq-mine').innerHTML = `<span class="eq-mine-label">мои</span>${mine.map((p) => `
    <span class="chip${e.preset === p.id ? ' active' : ''}" data-mine="${esc(p.id)}" role="button" tabindex="0" title="${esc(p.name)}">
      <span>${esc(p.name)}</span>
      <button class="chip-more" data-mine-more="${esc(p.id)}" aria-label="Действия с пресетом" aria-haspopup="menu"><svg><use href="#i-more"/></svg></button>
    </span>`).join('')}
    ${own ? '' : `<button class="chip plain new" id="eq-save-as"><svg><use href="#i-plus"/></svg><span>${mine.length ? 'Сохранить текущий' : 'Сохранить как свой пресет'}</span></button>`}
    <button class="chip plain new" id="eq-paste" title="Пресет, которым поделился друг"><svg><use href="#i-code"/></svg><span>Вставить код</span></button>`;
  $('#eq-save-as')?.addEventListener('click', eqSaveAs);
  $('#eq-paste').onclick = openShareCode; // share.js
}

// Сравнение с точностью до полудецибела: так ползунки и хранятся
const sameGains = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
const newPresetId = () => `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Добавить пресет в свои; пресет с тем же именем заменяется
async function eqAddMine(preset, { select = true } = {}) {
  const mine = [...eqMine()];
  const same = mine.find((p) => p.name.toLowerCase() === preset.name.toLowerCase());
  const p = { id: same?.id || newPresetId(), name: preset.name.slice(0, 40), gains: preset.gains.map(Number), preamp: +preset.preamp || 0 };
  if (same) mine[mine.indexOf(same)] = p; else mine.push(p);
  eqLive(select ? { custom: mine, preset: p.id, gains: [...p.gains], preamp: p.preamp, enabled: true } : { custom: mine });
  await eqSave();
  renderEq();
  return { preset: p, replaced: !!same };
}

async function eqSaveAs() {
  const e = state.cfg.eq;
  const name = await ask({
    title: 'Свой пресет',
    text: 'Сохранятся все 10 полос и предусилитель. Пресет появится на всех твоих компьютерах.',
    ok: 'Сохранить',
  });
  if (!name) return;
  const { preset, replaced } = await eqAddMine({ name, gains: e.gains, preamp: e.preamp });
  toast(replaced ? `Пресет «${preset.name}» обновлён` : `Пресет «${preset.name}» сохранён`);
}

function eqUseMine(id) {
  const p = eqMine().find((x) => x.id === id);
  if (!p) return;
  eqLive({ preset: p.id, gains: [...p.gains], preamp: p.preamp, enabled: true });
  eqSave().then(renderEq);
}

async function eqUpdateMine(id) {
  const e = state.cfg.eq;
  eqLive({ custom: eqMine().map((x) => (x.id === id ? { ...x, gains: [...e.gains], preamp: e.preamp } : x)), preset: id });
  await eqSave();
  renderEq();
  toast('Пресет обновлён');
}

async function eqRenameMine(id) {
  const p = eqMine().find((x) => x.id === id);
  if (!p) return;
  const name = await ask({ title: 'Переименовать пресет', value: p.name, ok: 'Сохранить' });
  if (!name || name === p.name) return;
  eqLive({ custom: eqMine().map((x) => (x.id === id ? { ...x, name: name.slice(0, 40) } : x)) });
  await eqSave();
  renderEq();
}

async function eqDeleteMine(id) {
  const p = eqMine().find((x) => x.id === id);
  if (!p) return;
  const ok = await ask({ title: `Удалить «${p.name}»?`, text: 'Звук не изменится: полосы останутся как сейчас.', ok: 'Удалить', input: false, danger: true });
  if (!ok) return;
  eqLive({ custom: eqMine().filter((x) => x.id !== id), ...(state.cfg.eq.preset === id ? { preset: 'custom' } : {}) });
  await eqSave();
  renderEq();
  toast(`Пресет «${p.name}» удалён`);
}

function eqMineMenu(id, anchor) {
  const e = state.cfg.eq;
  const p = eqMine().find((x) => x.id === id);
  if (!p) return;
  const changed = !(sameGains(p.gains, e.gains) && p.preamp === e.preamp);
  showMenu([
    { label: 'Включить', icon: 'i-eq', onClick: () => eqUseMine(id) },
    ...(changed ? [{ label: 'Записать сюда текущие полосы', icon: 'i-refresh', onClick: () => eqUpdateMine(id) }] : []),
    { label: 'Переименовать', icon: 'i-pencil', onClick: () => eqRenameMine(id) },
    { label: 'Поделиться', icon: 'i-share', onClick: () => shareEqPreset(p) }, // share.js
    { sep: true },
    { label: 'Удалить', icon: 'i-trash', danger: true, onClick: () => eqDeleteMine(id) },
  ], { anchor });
}

$('#eq-mine').addEventListener('click', (e) => {
  const more = e.target.closest('[data-mine-more]');
  if (more) {
    e.stopPropagation();
    if (more.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
    eqMineMenu(more.dataset.mineMore, more);
    return;
  }
  const chip = e.target.closest('[data-mine]');
  if (chip) eqUseMine(chip.dataset.mine);
});
$('#eq-mine').addEventListener('contextmenu', (e) => {
  const chip = e.target.closest('[data-mine]');
  if (!chip) return;
  e.preventDefault();
  eqMineMenu(chip.dataset.mine, chip.querySelector('.chip-more'));
});
$('#eq-mine').addEventListener('keydown', (e) => {
  const chip = e.target.closest?.('[data-mine]');
  if (chip && e.target === chip && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); eqUseMine(chip.dataset.mine); }
});

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
$('#eq-bands').addEventListener('change', async () => {
  // Полосы вернули ровно как в своём пресете — снова считаем, что выбран он
  const e = state.cfg.eq;
  const back = eqMine().find((p) => sameGains(p.gains, e.gains) && p.preamp === e.preamp);
  if (back) e.preset = back.id;
  await eqSave();
  renderEq();
});
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
  if (locked()) return; // под экраном входа (app.js) клавиши плеера не работают
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
