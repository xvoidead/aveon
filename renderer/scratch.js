'use strict';
// Обложка в бочке — пластинка. Пока играет, медленно крутится (33⅓ об/мин). Схватил и крутишь —
// звук скретчит вслед за рукой: вперёд, назад, держишь — тишина. Отпустил — трек идёт дальше с того
// места, куда его прокрутили. Звук — из scratch-worklet.js, он всё время помнит последние 12 секунд.
// Общие глобальные: state, audio, fx, ctx, $, IS_MOBILE, ensureGraph.

const RPM = 33.333;
const OMEGA = (RPM / 60) * 360; // градусов в секунду при обычной скорости

const vinyl = {
  node: null,         // AudioWorkletNode
  angle: 0,           // текущий угол обложки, градусы
  shown: '',          // угол, уже записанный в --spin
  held: false,        // держат рукой
  pending: null,      // нажали, но ещё не сдвинули — может, это просто клик
  last: null,         // { a, t } — прошлый угол руки и время
  handRate: 0,        // скорость руки в «нормальных скоростях»
  startTime: 0,       // позиция трека, когда схватили
  lastFrame: performance.now(),
};

const vinylOn = () => (window.LOOK?.vinyl ?? true);
const scratchOn = () => (window.LOOK?.scratch ?? true);

// Узел скретча встаёт между микшером плееров и эквалайзером (app.js → ensureGraph: fx.tap)
async function ensureScratchNode() {
  if (vinyl.node || !ctx?.audioWorklet || !fx.tap) return vinyl.node;
  try {
    await ctx.audioWorklet.addModule('scratch-worklet.js');
    const node = new AudioWorkletNode(ctx, 'aveon-scratch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    fx.mix.disconnect(fx.tap);
    fx.mix.connect(node).connect(fx.tap);
    node.port.onmessage = (e) => { if (e.data.type === 'offset') finishScratch(e.data.sec); };
    vinyl.node = node;
  } catch (e) {
    console.warn('scratch:', e.message);
  }
  return vinyl.node;
}

const porthole = () => $('#now-cover');

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
const angleAt = (c, e) => (Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180) / Math.PI;
const wrap = (d) => ((d + 540) % 360) - 180; // разница углов через ±180°

function onDown(e) {
  if (!scratchOn() || !state.track || e.button > 0) return;
  const el = porthole();
  vinyl.pending = { id: e.pointerId, x: e.clientX, y: e.clientY, c: centerOf(el) };
}

async function onMove(e) {
  const p = vinyl.pending;
  if (p && !vinyl.held) {
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return; // ещё клик, не скретч
    vinyl.pending = null;
    await startScratch(e, p);
    return;
  }
  if (!vinyl.held) return;
  e.preventDefault();
  const c = vinyl.center;
  const a = angleAt(c, e);
  const t = performance.now();
  const d = wrap(a - vinyl.last.a);
  const dt = Math.max(1, t - vinyl.last.t) / 1000;
  vinyl.angle += d;
  // скорость руки → скорость звука; сглаживаем, чтобы звук не рвался от дрожания
  const rate = Math.max(-4, Math.min(4, d / dt / OMEGA));
  vinyl.handRate = vinyl.handRate * 0.5 + rate * 0.5;
  vinyl.node?.port.postMessage({ type: 'rate', rate: vinyl.handRate });
  vinyl.last = { a, t };
}

async function startScratch(e, p) {
  ensureGraph();
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const node = await ensureScratchNode();
  if (!node) return;
  const el = porthole();
  try { el.setPointerCapture(p.id); } catch {}
  vinyl.held = true;
  vinyl.center = p.c;
  vinyl.last = { a: angleAt(p.c, e), t: performance.now() };
  vinyl.handRate = 0;
  vinyl.startTime = audio.currentTime;
  vinyl.wasPaused = audio.paused;
  node.port.postMessage({ type: 'start', rate: audio.paused ? 0 : 1 });
  el.classList.add('scratching');
  document.body.classList.add('is-scratching');
}

function onUp() {
  vinyl.pending = null;
  if (!vinyl.held) return;
  vinyl.held = false;
  vinyl.justScratched = true;
  setTimeout(() => { vinyl.justScratched = false; }, 300);
  porthole().classList.remove('scratching');
  document.body.classList.remove('is-scratching');
  vinyl.node?.port.postMessage({ type: 'stop' }); // ответит, насколько сдвинули трек → finishScratch
}

// Трек продолжается с того места, куда его докрутили
function finishScratch(sec) {
  if (!state.track || !isFinite(audio.duration)) return;
  const at = Math.max(0, Math.min(audio.duration - 0.3, vinyl.startTime + sec));
  audio.currentTime = at;
}

// Рука стоит — пластинка стоит: если мышь давно не двигалась, скорость — ноль
setInterval(() => {
  if (vinyl.held && performance.now() - vinyl.last.t > 70 && vinyl.handRate !== 0) {
    vinyl.handRate *= 0.3;
    if (Math.abs(vinyl.handRate) < 0.02) vinyl.handRate = 0;
    vinyl.node?.port.postMessage({ type: 'rate', rate: vinyl.handRate });
  }
}, 40);

// Вращение: пока играет — 33⅓ об/мин, держат — как ведёт рука
function spinFrame(t) {
  const dt = Math.min(0.1, (t - vinyl.lastFrame) / 1000);
  vinyl.lastFrame = t;
  if (!vinyl.held && vinylOn() && !audio.paused && !document.hidden) vinyl.angle += OMEGA * dt;
  // Угол пишем, только если он изменился: на паузе и с выключенным вращением кадр не трогает стили
  const spin = `${(vinyl.angle % 360).toFixed(2)}deg`;
  if (spin !== vinyl.shown) {
    const el = $('#barrel'); // на бочке: угол наследуют и обложка, и пластинка «Конверта»
    if (el) { el.style.setProperty('--spin', spin); vinyl.shown = spin; }
  }
  requestAnimationFrame(spinFrame);
}
requestAnimationFrame(spinFrame);

(() => {
  const el = porthole();
  if (!el) return;
  el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  // после скретча не открываем редактор обложки кликом
  el.addEventListener('click', (e) => { if (vinyl.justScratched) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  el.title = 'Схвати и крути — скретч';
})();
