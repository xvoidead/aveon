'use strict';
// Остров поверх всех окон: состояние присылает окно плеера (island-feed.js) через главный процесс.
// Свёрнут — обложка и спектр (или строка текста песни); смена трека и уведомления на секунды
// раскрывают его; наведение — кнопки, перемотка, друзья.
const api = window.tishe;
const $ = (s) => document.querySelector(s);
const pill = $('#pill');
const bars = [...document.querySelectorAll('.bars i')];

let st = null;
let lastId = null;
let lastNotice = null;
let lastLine = '';
let peekTimer = 0;
let noticeTimer = 0;
let leaveTimer = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const is = (c) => pill.classList.contains(c);
const expanded = () => is('open') || is('peek') || is('notice');
const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many;
};

api.island.onConfig((c) => {
  for (const p of ['top', 'left', 'right', 'bottom']) document.body.classList.toggle(`pos-${p}`, (c.pos || 'top') === p);
});

api.island.onState((s) => {
  st = s;
  if (s.notice && s.notice.id !== lastNotice) {
    lastNotice = s.notice.id;
    notice(s.notice.text);
  }
  document.body.classList.toggle('hidden', !s.hasTrack && !is('notice'));
  if (!s.hasTrack) return;
  const root = document.documentElement.style;
  if (s.amber) root.setProperty('--amber', s.amber);
  if (s.voice) root.setProperty('--voice', s.voice);
  root.setProperty('--m', String(s.m || 0));
  root.setProperty('--bass', String(s.playing ? s.bars?.[0] || 0 : 0));

  if (s.id !== lastId) {
    const first = lastId === null;
    lastId = s.id;
    $('#disc').style.backgroundImage = s.cover ? `url("${String(s.cover).replace(/"/g, '%22')}")` : '';
    if (!first) peek();
  }
  const o = s.opts || {};
  pill.classList.toggle('playing', !!s.playing);
  pill.classList.toggle('barrel', (s.m || 0) > 0.5);
  pill.classList.toggle('pulse', !!o.pulse);
  pill.classList.toggle('rainbow', !!o.rainbow);
  pill.classList.toggle('lyric', !!(o.lyrics && s.line && s.playing));
  pill.classList.toggle('friend-live', !!s.friends?.count);
  renderFriends(s.friends);
  renderLabel();
  $('#b-play use').setAttribute('href', s.playing ? '#i-pause' : '#i-play');
  $('#b-barrel').classList.toggle('on', !!s.manual);
  (s.bars || []).forEach((v, i) => { if (bars[i]) bars[i].style.height = `${Math.round(18 + v * 82)}%`; });
});

// Что написано в капсуле: уведомление > название (раскрыта) > бочка > строка текста
function renderLabel() {
  if (!st || is('notice')) return;
  const title = $('#p-title');
  let text;
  if (expanded()) text = st.title || '';
  else if ((st.m || 0) > 0.5) text = st.manual ? 'в бочке' : 'говорят — в бочке';
  else if (is('lyric')) text = st.line;
  else text = st.title || '';
  if (title.textContent !== text) {
    title.textContent = text;
    // строка текста сменилась — мягко въезжает снизу
    if (is('lyric') && !expanded() && text !== lastLine) {
      title.classList.remove('swap');
      void title.offsetWidth;
      title.classList.add('swap');
    }
    lastLine = text;
  }
  $('#p-sub').textContent = st.artist || '';
}

function renderFriends(f) {
  const box = $('#friends');
  const has = !!(f && (f.count || f.room));
  pill.classList.toggle('has-friends', has);
  box.hidden = !has;
  if (!has) return;
  const parts = [];
  if (f.count) parts.push(f.count === 1 ? `${esc(f.live[0].name)} слушает «${esc(f.live[0].title)}»` : `${f.count} ${plural(f.count, 'друг слушает', 'друга слушают', 'друзей слушают')} музыку`);
  if (f.room) parts.push(`вместе: ${f.room}`);
  box.innerHTML = `${f.live.map((x) => `<i title="${esc(x.name)} — ${esc(x.title)}">${esc(x.letter)}</i>`).join('')}<span>${parts.join(' · ')}</span>`;
}

// Новый трек — капсула на пару секунд показывает, что заиграло
function peek() {
  if (is('open') || is('notice')) return;
  pill.classList.add('peek');
  renderLabel();
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { pill.classList.remove('peek'); renderLabel(); }, 3500);
}

function notice(text) {
  if (is('open')) return;
  pill.classList.remove('peek');
  pill.classList.add('notice');
  document.body.classList.remove('hidden');
  $('#p-title').textContent = text;
  $('#p-sub').textContent = 'авеон';
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    pill.classList.remove('notice');
    if (!st?.hasTrack) document.body.classList.add('hidden');
    renderLabel();
  }, 3800);
}

// Позиция между сообщениями — сами, по часам
function tick() {
  if (st?.hasTrack && is('open')) {
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
  pill.classList.remove('peek', 'notice');
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
// колесо над островом — громкость
pill.addEventListener('wheel', (e) => { e.preventDefault(); act('volume', { delta: e.deltaY < 0 ? 0.05 : -0.05 }); }, { passive: false });
