'use strict';
// Визуализатор на весь экран — для вечеринок. Четыре вида, листаются стрелками или кнопками:
// пластинка (обложка крутится, вокруг — лучи спектра), частицы (взрываются на басах),
// эфир (линии как на волне), столбики. Цвета — из обложки. Клавиша V, выход — Esc или клик по крестику.
// Общие глобальные: state, audio, fx, ctx, $, esc, ensureGraph, api.

const VIZ_STYLES = [['vinyl', 'Пластинка'], ['particles', 'Частицы'], ['air', 'Эфир'], ['bars', 'Столбики']];
const vz = { open: false, style: 0, data: new Uint8Array(2048), bass: 0, parts: [], ang: 0, img: null, imgSrc: null, idle: 0 }; // imgSrc — id трека, чья обложка загружена

function vizEl() {
  let el = $('#vizfull');
  if (el) return el;
  el = document.createElement('section');
  el.id = 'vizfull';
  el.className = 'vizfull';
  el.hidden = true;
  el.setAttribute('aria-label', 'Визуализатор');
  el.innerHTML = `<canvas id="vizfull-c"></canvas>
    <div class="vz-ui">
      <div class="vz-now" id="vz-now"></div>
      <div class="vz-styles" id="vz-styles">${VIZ_STYLES.map(([id, t], i) => `<button data-vz="${i}">${t}</button>`).join('')}</div>
      <button class="icon-btn vz-close" id="vz-close" aria-label="Закрыть визуализатор"><svg><use href="#i-close"/></svg></button>
    </div>`;
  document.body.appendChild(el);
  el.querySelectorAll('[data-vz]').forEach((b) => { b.onclick = () => setVizStyle(+b.dataset.vz); });
  $('#vz-close').onclick = closeVisualizer;
  el.addEventListener('pointermove', () => wakeViz());
  el.addEventListener('dblclick', () => api.win.action(document.fullscreenElement ? 'fullscreen-off' : 'fullscreen-on'));
  return el;
}

function wakeViz() {
  const el = $('#vizfull');
  el.classList.remove('idle');
  clearTimeout(vz.idle);
  vz.idle = setTimeout(() => el.classList.add('idle'), 2500);
}

function setVizStyle(i) {
  vz.style = (i + VIZ_STYLES.length) % VIZ_STYLES.length;
  try { localStorage.setItem('aveon:viz', String(vz.style)); } catch {}
  $$('#vz-styles button').forEach((b, k) => b.classList.toggle('on', k === vz.style));
  vz.parts = [];
}

function openVisualizer() {
  ensureGraph();
  const el = vizEl();
  try { vz.style = +localStorage.getItem('aveon:viz') || 0; } catch {}
  setVizStyle(vz.style);
  el.hidden = false;
  vz.open = true;
  wakeViz();
  requestAnimationFrame(vizFrame);
}

function closeVisualizer() {
  vz.open = false;
  const el = $('#vizfull');
  if (el) el.hidden = true;
}

document.addEventListener('keydown', (e) => {
  if (!vz.open) return;
  if (e.key === 'Escape') { e.stopPropagation(); closeVisualizer(); }
  else if (e.key === 'ArrowRight' && !e.ctrlKey) { e.stopPropagation(); e.preventDefault(); setVizStyle(vz.style + 1); }
  else if (e.key === 'ArrowLeft' && !e.ctrlKey) { e.stopPropagation(); e.preventDefault(); setVizStyle(vz.style - 1); }
}, true);

function vzColors() {
  const cs = getComputedStyle(document.documentElement);
  return { a: cs.getPropertyValue('--amber').trim() || '#f0a63a', v: cs.getPropertyValue('--voice').trim() || '#9aa8ff', bg: cs.getPropertyValue('--oak').trim() || '#1b1411' };
}

function vizFrame() {
  if (!vz.open) return;
  const c = $('#vizfull-c');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth * dpr, h = c.clientHeight * dpr;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d');
  const d = vz.data.subarray(0, fx.analyser?.frequencyBinCount || 0);
  if (fx.analyser && !audio.paused) fx.analyser.getByteFrequencyData(d);
  else d.fill(0);
  let b = 0;
  for (let i = 1; i < 10 && i < d.length; i++) b = Math.max(b, d[i]);
  const gain = (window.LOOK?.reactGain ?? 100) / 100;
  vz.bass += (Math.min(1, (b / 255) * gain) - vz.bass) * 0.3;
  const col = vzColors();
  const t = state.track;
  if (t && t.id !== vz.imgSrc) {
    vz.imgSrc = t.id;
    vz.img = null;
    if (t.cover) { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { vz.img = im; }; im.src = t.cover; }
    $('#vz-now').innerHTML = `<b>${esc(t.title)}</b><span>${esc(t.artist || '')}</span>`;
  }
  const style = VIZ_STYLES[vz.style][0];
  // шлейф: прошлый кадр гаснет, а не стирается — движение становится мягким
  g.globalAlpha = style === 'particles' ? 0.22 : 0.35;
  g.fillStyle = col.bg;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 1;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h);
  const band = (k, n) => { const lo = Math.floor(Math.pow(k / n, 1.7) * d.length * 0.75); const hi = Math.max(lo + 1, Math.floor(Math.pow((k + 1) / n, 1.7) * d.length * 0.75)); let v = 0; for (let i = lo; i < hi; i++) v = Math.max(v, d[i]); return Math.min(1, (v / 255) * gain); };

  if (style === 'vinyl') {
    vz.ang += audio.paused ? 0 : 0.012;
    const r = R * (0.2 + vz.bass * 0.02);
    g.save();
    g.translate(cx, cy);
    g.rotate(vz.ang);
    g.beginPath();
    g.arc(0, 0, r * 1.35, 0, Math.PI * 2);
    g.fillStyle = '#0d0a09';
    g.fill();
    for (let k = 0; k < 18; k++) { g.beginPath(); g.arc(0, 0, r * (0.75 + k * 0.035), 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.035)'; g.lineWidth = 1; g.stroke(); }
    g.beginPath();
    g.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    g.clip();
    if (vz.img) g.drawImage(vz.img, -r * 0.62, -r * 0.62, r * 1.24, r * 1.24);
    else { g.fillStyle = col.a; g.fill(); }
    g.restore();
    const n = 120;
    g.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const half = k < n / 2 ? k : n - 1 - k;
      const v = band(half, n / 2);
      const a = (k / n) * Math.PI * 2 - Math.PI / 2;
      const r0 = r * 1.45, r1 = r0 + v * R * 0.22 + 2;
      g.strokeStyle = v > 0.7 ? col.v : col.a;
      g.globalAlpha = 0.3 + v * 0.7;
      g.lineWidth = Math.max(2, R / 260);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
    g.globalAlpha = 1;
  } else if (style === 'particles') {
    if (vz.bass > 0.55 && Math.random() < vz.bass) {
      for (let i = 0; i < 6 + vz.bass * 16; i++) {
        const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 7 * vz.bass) * dpr;
        vz.parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, s: (1.5 + Math.random() * 3.5) * dpr, c: Math.random() < 0.3 ? col.v : col.a });
      }
    }
    for (const p of vz.parts) {
      p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.vy *= 0.99; p.life -= 0.008;
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.c;
      g.beginPath();
      g.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      g.fill();
    }
    vz.parts = vz.parts.filter((p) => p.life > 0 && p.x > -50 && p.x < w + 50 && p.y > -50 && p.y < h + 50).slice(-1500);
    g.globalAlpha = 0.9;
    g.beginPath();
    g.arc(cx, cy, R * (0.06 + vz.bass * 0.05), 0, Math.PI * 2);
    g.fillStyle = col.a;
    g.fill();
    g.globalAlpha = 1;
  } else if (style === 'air') {
    vz.ang += 0.01 + vz.bass * 0.05;
    for (let k = 0; k < 9; k++) {
      g.beginPath();
      g.strokeStyle = k === 4 ? col.v : col.a;
      g.globalAlpha = k === 4 ? 0.95 : 0.25 + (1 - Math.abs(k - 4) / 4) * 0.4;
      g.lineWidth = (k === 4 ? 3 : 1.4) * dpr;
      const y0 = h * (0.15 + k * 0.0875);
      for (let x = 0; x <= w; x += 5 * dpr) {
        const u = x / w;
        const v = band(Math.floor(u * 48), 48);
        const y = y0 + Math.sin(u * Math.PI * (2 + k * 0.5) + vz.ang * (1 + k * 0.2)) * h * 0.03 * (0.5 + vz.bass * 2) - v * h * 0.05;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  } else {
    const n = 64, gap = 4 * dpr, bw = (w - gap * (n + 1)) / n;
    for (let k = 0; k < n; k++) {
      const v = band(k, n);
      const bh = Math.max(3 * dpr, v * h * 0.8);
      const x = gap + k * (bw + gap);
      const grad = g.createLinearGradient(0, h, 0, h - bh);
      grad.addColorStop(0, col.a);
      grad.addColorStop(1, col.v);
      g.fillStyle = grad;
      g.globalAlpha = 0.5 + v * 0.5;
      g.fillRect(x, h - bh, bw, bh);
      g.globalAlpha = 0.18;
      g.fillRect(x, 0, bw, Math.min(bh * 0.25, h * 0.2)); // отражение сверху
    }
    g.globalAlpha = 1;
  }
  requestAnimationFrame(vizFrame);
}
