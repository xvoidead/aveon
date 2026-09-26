// ---------- эквалайзер ----------
// 10 полос от 32 Гц до 16 кГц, ±12 дБ: крайние — полки, остальные — колокола. Стоит первым в графе
// (см. ensureGraph в app.js), поэтому бочка и цензура звучат уже поверх выровненного звука.
//
// Здесь — звук и свои пресеты. Сам эквалайзер открывается отдельным окном под кнопкой
// (src/eqpop.js, renderer/eqpop.*): так он может выходить за край окна плеера.
// Полосы, пресеты, форматирование и кривая — в eq-core.js

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

// glide — смена пресета: звук перетекает вместе с ползунками в окне эквалайзера, а не прыгает
function eqApply(glide = false) {
  if (!fx.eq || !state.cfg?.eq) return;
  const { gains, preamp } = eqValues();
  const t = ctx.currentTime;
  const tau = glide ? 0.09 : 0.015;
  fx.eq.forEach((f, i) => f.gain.setTargetAtTime(gains[i] || 0, t, tau));
  fx.eqPre.gain.setTargetAtTime(Math.pow(10, preamp / 20), t, tau);
}

// ---------- свои пресеты (для кода от друга и строки в настройках) ----------

const eqMine = () => state.cfg.eq.custom || [];

// Как называется то, что сейчас стоит: встроенный пресет, свой или «свой вариант»
function eqPresetName() {
  const id = state.cfg.eq.preset;
  return EQ_PRESETS.find(([pid]) => pid === id)?.[1] || eqMine().find((p) => p.id === id)?.name || 'свои полосы';
}

const newPresetId = () => `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Добавить пресет в свои (пресет с тем же именем заменяется) и включить его
async function eqAddMine(preset, { select = true } = {}) {
  const mine = [...eqMine()];
  const same = mine.find((p) => p.name.toLowerCase() === preset.name.toLowerCase());
  const p = { id: same?.id || newPresetId(), name: preset.name.slice(0, 40), gains: preset.gains.map(Number), preamp: +preset.preamp || 0 };
  if (same) mine[mine.indexOf(same)] = p; else mine.push(p);
  Object.assign(state.cfg.eq, select ? { custom: mine, preset: p.id, gains: [...p.gains], preamp: p.preamp, enabled: true } : { custom: mine });
  const { enabled, preset: id, gains, preamp, custom } = state.cfg.eq;
  await saveCfg({ eq: { enabled, preset: id, gains: [...gains], preamp, custom } });
  eqApply(true);
  renderEq();
  return { preset: p, replaced: !!same };
}

// ---------- окно эквалайзера ----------

let eqWinOpen = false;
const eqOpen = () => eqWinOpen;

function toggleEq() {
  const r = $('#btn-eq').getBoundingClientRect();
  const cs = getComputedStyle(document.documentElement);
  const theme = Object.fromEntries(THEME_VARS.map((k) => [k, cs.getPropertyValue(k).trim()])); // extras.js: палитра обложки
  api.eqpop.toggle({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, { theme });
}
function openEq() { if (!eqWinOpen) toggleEq(); }
function closeEq() { api.eqpop.close(); }
// Эквалайзер поменялся не в его окне (синхронизация, код от друга) — пусть окно перечитает настройки
function renderEq() { if (eqWinOpen) api.eqpop.refresh(); }

// Окно эквалайзера поменяло настройки — применяем к звуку; сохранило оно их само
api.eqpop.onLive((eq) => {
  const { _glide, ...rest } = eq;
  state.cfg.eq = rest;
  eqApply(!!_glide);
});
api.eqpop.onShown((open) => {
  eqWinOpen = !!open;
  $('#btn-eq').setAttribute('aria-pressed', String(eqWinOpen));
});
// «Поделиться» и «Вставить код» — здесь: в окне плеера есть диалоги и уведомления
api.eqpop.onAction((a) => {
  if (a?.type === 'share' && a.preset) shareEqPreset(a.preset); // share.js
  if (a?.type === 'paste') openShareCode();
});

$('#btn-eq').onclick = toggleEq;
document.addEventListener('keydown', (e) => {
  if (locked()) return; // под экраном входа (app.js) клавиши плеера не работают
  if (e.target.matches('input, textarea, select') || e.ctrlKey || e.altKey) return;
  if (!$('#editor').hidden || !$('#dialog').hidden || !$('#settings').hidden) return;
  if (e.code === 'KeyE') toggleEq();
});
