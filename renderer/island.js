'use strict';
// Остров поверх всех окон: состояние присылает окно плеера (island-feed.js) через главный процесс.
// Свёрнут — обложка и спектр; смена трека — на секунды показывает название; наведение — кнопки.
const api = window.tishe;
const $ = (s) => document.querySelector(s);
const pill = $('#pill');
const bars = [...document.querySelectorAll('.bars i')];

let st = null;
let lastId = null;
let peekTimer = 0;
let leaveTimer = 0;

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const isOpen = () => pill.classList.contains('open') || pill.classList.contains('peek');

api.island.onConfig((c) => {
  for (const p of ['top', 'left', 'right', 'bottom']) document.body.classList.toggle(`pos-${p}`, (c.pos || 'top') === p);
});

api.island.onState((s) => {
  st = s;
  document.body.classList.toggle('hidden', !s.hasTrack);
  if (!s.hasTrack) return;
  const root = document.documentElement.style;
  if (s.amber) root.setProperty('--amber', s.amber);
  if (s.voice) root.setProperty('--voice', s.voice);
  root.setProperty('--m', String(s.m || 0));

  if (s.id !== lastId) {
    const first = lastId === null;
    lastId = s.id;
    $('#disc').style.backgroundImage = s.cover ? `url("${String(s.cover).replace(/"/g, '%22')}")` : '';
    if (!first) peek();
  }
  pill.classList.toggle('playing', !!s.playing);
  pill.classList.toggle('barrel', (s.m || 0) > 0.5);
  renderLabel();
  $('#b-play use').setAttribute('href', s.playing ? '#i-pause' : '#i-play');
  $('#b-barrel').classList.toggle('on', !!s.manual);
  (s.bars || []).forEach((v, i) => { if (bars[i]) bars[i].style.height = `${Math.round(18 + v * 82)}%`; });
});

// Свёрнутый остров в бочке пишет, почему; раскрытый — название трека
function renderLabel() {
  if (!st) return;
  const barrel = (st.m || 0) > 0.5 && !isOpen();
  $('#p-title').textContent = barrel ? (st.manual ? 'в бочке' : 'говорят — в бочке') : st.title || '';
  $('#p-sub').textContent = st.artist || '';
}

// Новый трек — капсула на пару секунд показывает, что заиграло
function peek() {
  if (pill.classList.contains('open')) return;
  pill.classList.add('peek');
  renderLabel();
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { pill.classList.remove('peek'); renderLabel(); }, 3500);
}

// Позиция между сообщениями — сами, по часам
function tick() {
  if (st?.hasTrack && pill.classList.contains('open')) {
    const pos = st.playing ? st.pos + (Date.now() - st.at) / 1000 : st.pos;
    const dur = st.duration || 0;
    $('#t-cur').textContent = fmt(dur ? Math.min(pos, dur) : pos);
    $('#t-dur').textContent = fmt(dur);
    $('#seek-fill').style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0';
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Наведение: окно начинает ловить мышь, капсула раскрывается
pill.addEventListener('mouseenter', () => {
  clearTimeout(leaveTimer);
  api.island.hover(true);
  pill.classList.remove('peek');
  pill.classList.add('open');
  renderLabel();
});
pill.addEventListener('mouseleave', () => {
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    pill.classList.remove('open');
    api.island.hover(false);
    renderLabel();
  }, 220);
});

const act = (type, extra) => api.island.action({ type, ...extra });
$('#b-play').onclick = () => act('thumb', { action: 'toggle' });
$('#b-prev').onclick = () => act('thumb', { action: 'prev' });
$('#b-next').onclick = () => act('thumb', { action: 'next' });
$('#b-barrel').onclick = () => act('barrel');
$('#b-open').onclick = () => act('focus');
$('#disc').onclick = () => act('focus');
$('#seek').onclick = (e) => {
  if (!st?.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  act('seek', { pos: ((e.clientX - r.left) / r.width) * st.duration });
};
