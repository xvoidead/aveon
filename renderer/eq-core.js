'use strict';

// ---------- эквалайзер: полосы, пресеты, форматирование и кривая (сам попап — eq.js) ----------
// 10 полос от 32 Гц до 16 кГц, ±12 дБ: крайние — полки, остальные — колокола.

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

// Монотонный кубический сплайн (Фритч — Карлсон): гладкая кривая ровно через точки,
// без «перелётов» выше самой высокой ручки
function monotoneSlopes(ys) {
  const n = ys.length;
  const d = ys.slice(1).map((y, i) => y - ys[i]);
  const m = ys.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    if (a < 0) m[i] = 0;
    if (b < 0) m[i + 1] = 0;
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return m;
}

// Кривая по ручкам ползунков: canvas растягивается ровно по ходу ручек (от центра ручки на +12
// до центра на −12), по горизонтали точки стоят в центрах колонок полос
function drawEqCurveOn(cv, panelEl, gains) {
  const slider = panelEl.querySelector('input[type="range"]');
  if (slider) {
    const panel = panelEl.getBoundingClientRect();
    const r = slider.getBoundingClientRect();
    const knob = 8; // радиус ручки ползунка Chromium
    cv.style.top = `${r.top - panel.top + knob}px`;
    cv.style.height = `${r.height - knob * 2}px`;
  }
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (!w || !h) return;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }

  const n = EQ_FREQS.length;
  const col = w / n;
  const ys = EQ_FREQS.map((_, i) => Math.max(-EQ_MAX, Math.min(EQ_MAX, gains[i] || 0)));
  const m = monotoneSlopes(ys);
  const at = (x) => {
    const u = x / col - 0.5; // в единицах полос
    if (u <= 0) return ys[0];
    if (u >= n - 1) return ys[n - 1];
    const i = Math.floor(u), t = u - i;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * m[i + 1];
  };

  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--amber').trim() || '#f0a63a';
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const y = (db) => h / 2 - (db / EQ_MAX) * (h / 2);

  g.strokeStyle = css.getPropertyValue('--rivet-2').trim() || '#33271f';
  g.lineWidth = dpr;
  g.setLineDash([4 * dpr, 4 * dpr]);
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.setLineDash([]);

  const path = () => { g.beginPath(); for (let x = 0; x <= w; x++) (x ? g.lineTo(x, y(at(x))) : g.moveTo(x, y(at(x)))); };
  path();
  g.lineTo(w, h / 2); g.lineTo(0, h / 2); g.closePath();
  g.globalAlpha = 0.14;
  g.fillStyle = accent;
  g.fill();
  g.globalAlpha = 1;
  path();
  g.strokeStyle = accent;
  g.lineWidth = 2 * dpr;
  g.lineJoin = 'round';
  g.stroke();
}
