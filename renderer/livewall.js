'use strict';
// Живые обои: спектр по кругу вокруг обложки, как у бочки, только на весь рабочий стол.
const api = window.tishe;
const $ = (s) => document.querySelector(s);
const canvas = $('#c');
const g = canvas.getContext('2d');
let st = null;
let lastId = null;
let shown = new Array(48).fill(0);

api.island.onWallConfig((c) => {
  document.body.className = `style-${c.style || 'both'}${c.title === false ? ' no-title' : ''}`;
  document.documentElement.style.setProperty('--dim', String((c.dim ?? 45) / 100));
});

api.island.onState((s) => {
  st = s;
  if (!s.hasTrack) return;
  const root = document.documentElement.style;
  if (s.amber) root.setProperty('--amber', s.amber);
  if (s.voice) root.setProperty('--voice', s.voice);
  root.setProperty('--m', String(s.m || 0));
  if (s.id !== lastId) {
    lastId = s.id;
    const url = s.cover ? `url("${String(s.cover).replace(/"/g, '%22').replace(/-t300x300\./, '-t500x500.')}")` : '';
    $('#bg').style.backgroundImage = url;
    $('#disc').style.backgroundImage = url;
  }
  $('#t').textContent = s.title;
  $('#a').textContent = s.artist;
  $('#l').textContent = s.line || '';
});

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  g.clearRect(0, 0, w, h);
  const spec = st?.playing && st.spec ? st.spec : null;
  const n = shown.length;
  for (let i = 0; i < n; i++) shown[i] += ((spec ? spec[i] : 0) - shown[i]) * 0.35;
  const cx = w / 2, cy = h * 0.46;
  const inner = Math.min(w, h) * 0.15;
  const reach = Math.min(w, h) * 0.16;
  const color = getComputedStyle(document.documentElement).getPropertyValue((st?.m || 0) > 0.5 ? '--voice' : '--amber').trim() || '#f0a63a';
  g.lineCap = 'round';
  g.lineWidth = Math.max(3, w / 420);
  g.strokeStyle = color;
  const bars = n * 2; // зеркально: басы сверху, верха снизу с обеих сторон
  for (let i = 0; i < bars; i++) {
    const half = i < n ? i : bars - 1 - i;
    const v = shown[half];
    const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const len = v * reach + 2;
    g.globalAlpha = 0.25 + v * 0.75;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
    g.stroke();
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
