'use strict';
// Мини-плеер: то же состояние, что у острова (island-feed.js), кнопки уходят в окно плеера.
const api = window.tishe;
const $ = (s) => document.querySelector(s);
const card = $('#card');
let st = null;
let lastId = null;

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

api.island.onState((s) => {
  st = s;
  if (!s.hasTrack) {
    $('#title').textContent = 'ничего не играет';
    $('#artist').textContent = '';
    $('#line').textContent = '';
    return;
  }
  const root = document.documentElement.style;
  if (s.amber) root.setProperty('--amber', s.amber);
  if (s.voice) root.setProperty('--voice', s.voice);
  root.setProperty('--m', String(s.m || 0));
  if (s.id !== lastId) {
    lastId = s.id;
    const url = s.cover ? `url("${String(s.cover).replace(/"/g, '%22')}")` : '';
    $('#cover').style.backgroundImage = url;
    $('#cover').textContent = url ? '' : '♪';
    $('#bg').style.backgroundImage = url;
  }
  $('#title').textContent = s.title;
  $('#artist').textContent = s.artist;
  const line = s.opts?.miniLyrics === false ? '' : s.line || '';
  $('#line').textContent = line;
  card.classList.toggle('lyric', !!line);
  card.classList.toggle('barrel', (s.m || 0) > 0.5);
  $('#b-play use').setAttribute('href', s.playing ? '#i-pause' : '#i-play');
  $('#b-barrel').classList.toggle('on', !!s.manual);
});

function tick() {
  if (st?.hasTrack) {
    const pos = st.playing ? st.pos + (Date.now() - st.at) / 1000 : st.pos;
    const dur = st.duration || 0;
    $('#fill').style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0';
    $('#time').textContent = fmt(dur ? Math.min(pos, dur) : pos);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

const act = (type, extra) => api.island.action({ type, ...extra });
$('#b-play').onclick = () => act('thumb', { action: 'toggle' });
$('#b-prev').onclick = () => act('thumb', { action: 'prev' });
$('#b-next').onclick = () => act('thumb', { action: 'next' });
$('#b-barrel').onclick = () => act('barrel');
$('#b-open').onclick = () => act('focus');
$('#cover').onclick = () => act('focus');
$('#b-close').onclick = () => act('mini-close');
$('#seek').onclick = (e) => {
  if (!st?.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  act('seek', { pos: ((e.clientX - r.left) / r.width) * st.duration });
};
card.addEventListener('wheel', (e) => act('volume', { delta: e.deltaY < 0 ? 0.05 : -0.05 }), { passive: true });
