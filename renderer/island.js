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

// аватарки друзей: плеер присылает каждую один раз (s.avatars), дальше — только ключ
const avatars = new Map();
const avatarCss = (key) => {
  const url = key && avatars.get(key);
  return url ? `url("${url.replace(/"/g, '%22')}")` : '';
};
const coverCss = () => (st?.cover ? `url("${String(st.cover).replace(/"/g, '%22')}")` : '');

// Предпросмотр из настроек: капсула видна, даже если ничего не играет
let previewing = false;
api.island.onPreview((on) => {
  previewing = on;
  document.body.classList.toggle('hidden', !st?.hasTrack && !on);
  pill.classList.toggle('previewing', on);
  if (on && !st?.hasTrack) { $('#p-title').textContent = 'остров будет здесь'; $('#p-title').dataset.key = ''; }
});

api.island.onState((s) => {
  st = s;
  for (const [k, v] of Object.entries(s.avatars || {})) avatars.set(k, v);
  if (s.notice && s.notice.id !== lastNotice) {
    lastNotice = s.notice.id;
    notice(s.notice.text, s.notice.av);
  }
  document.body.classList.toggle('hidden', !s.hasTrack && !is('notice') && !previewing);
  if (!s.hasTrack) return;
  const root = document.documentElement.style;
  if (s.amber) root.setProperty('--amber', s.amber);
  if (s.voice) root.setProperty('--voice', s.voice);
  root.setProperty('--m', String(s.m || 0));
  root.setProperty('--bass', String(s.playing ? s.bars?.[0] || 0 : 0));

  if (s.id !== lastId) {
    const first = lastId === null;
    lastId = s.id;
    if (!is('notice')) $('#disc').style.backgroundImage = coverCss(); // в уведомлении там аватарка — вернём после
    if (!first) peek();
  }
  const o = s.opts || {};
  pill.classList.toggle('playing', !!s.playing);
  pill.classList.toggle('barrel', (s.m || 0) > 0.5);
  // движение от музыки: music — всё живое; calm — мягко; static — остров не реагирует на звук
  const motion = o.motion || 'music';
  pill.classList.toggle('pulse', !!o.pulse && motion === 'music');
  pill.classList.toggle('m-calm', motion === 'calm');
  pill.classList.toggle('m-static', motion === 'static');
  pill.classList.toggle('no-bars', o.bars === false);
  pill.classList.toggle('no-spin', o.spin === false || motion === 'static');
  pill.classList.toggle('rainbow', !!o.rainbow);
  const ly = o.lyrics ? s.lyric : null;
  pill.classList.toggle('lyric', !!ly?.has);
  // длинная строка — остров становится выше и переносит её на вторую строчку
  pill.classList.toggle('letters', !!ly?.letters);
  renderLyr(ly);
  pill.classList.toggle('friend-live', !!s.friends?.count);
  renderFriends(s.friends);
  renderLabel();
  $('#b-play use').setAttribute('href', s.playing ? '#i-pause' : '#i-play');
  $('#b-barrel').classList.toggle('on', !!s.manual);
  (s.bars || []).forEach((v, i) => { if (bars[i]) bars[i].style.height = `${Math.round(18 + v * 82)}%`; });
});

// Что написано в капсуле: уведомление > название (раскрыта) > бочка > строка текста
// Свёрнутая капсула растёт под текст: обложка + текст + полоски. Ширина меняется плавно (CSS transition).
// Не влезает даже в самую широкую — шрифт чуть меньше, и только потом многоточие
const MIN_W = 200, MAX_W = 760;
const measure = document.createElement('span');
measure.className = 'measure';
document.body.appendChild(measure);

function fitWidth() {
  const b = $('#p-title');
  if (expanded()) { pill.style.width = ''; b.style.fontSize = ''; return; }
  const extra = 6 + 26 + 10 + 10 + (pill.classList.contains('no-bars') ? 0 : 30) + 16; // поля, обложка, отступы, полоски
  measure.style.font = getComputedStyle(b).font;
  measure.innerHTML = b.innerHTML;
  let size = 13;
  measure.style.fontSize = `${size}px`;
  while (measure.offsetWidth + extra > MAX_W && size > 11) {
    size -= 0.5;
    measure.style.fontSize = `${size}px`;
  }
  b.style.fontSize = size === 13 ? '' : `${size}px`;
  pill.style.width = `${Math.round(Math.max(MIN_W, Math.min(MAX_W, measure.offsetWidth + extra)))}px`;
}

function renderLabel() {
  if (!st || is('notice')) return;
  const title = $('#p-title');
  let text;
  if (expanded()) text = st.title || '';
  else if (is('lyric')) text = st.lyric?.gap ? '♪ ♪ ♪' : st.lyric?.cur || '';
  else if ((st.m || 0) > 0.5) text = st.manual ? 'в бочке' : 'говорят — в бочке';
  else text = st.title || '';
  // текста песни нет — в свёрнутом острове название и исполнитель
  const credit = !expanded() && !is('lyric') && (st.m || 0) <= 0.5 && st.artist;
  const key = credit ? `${text}|${st.artist}` : text;
  if (title.dataset.key !== key) {
    title.dataset.key = key;
    if (credit) title.innerHTML = `${esc(text)}<span class="by"> · ${esc(st.artist)}</span>`;
    else title.textContent = text;
    // строка текста сменилась — мягко въезжает снизу
    if (is('lyric') && !expanded() && text !== lastLine) {
      title.classList.remove('swap');
      void title.offsetWidth;
      title.classList.add('swap');
    }
    lastLine = text;
  }
  $('#p-sub').textContent = st.artist || '';
  fitWidth();
}

// Раскрытый остров: предыдущая, текущая и следующая строки, как караоке
function renderLyr(ly) {
  const box = $('#lyr');
  const has = !!ly?.has;
  pill.classList.toggle('has-lyr', has);
  box.hidden = !has;
  if (!has) return;
  const cur = ly.gap ? '♪ ♪ ♪' : ly.cur;
  $('#l-prev').textContent = ly.prev;
  $('#l-next').textContent = ly.next;
  if ($('#l-cur').textContent !== cur) {
    $('#l-cur').textContent = cur;
    box.classList.remove('swap');
    void box.offsetWidth;
    box.classList.add('swap');
  }
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
  box.innerHTML = `${f.live.map((x) => {
    const bg = avatarCss(x.av);
    return `<i title="${esc(x.name)} — ${esc(x.title)}"${bg ? ` class="pic" style='background-image:${bg}'` : ''}>${bg ? '' : esc(x.letter)}</i>`;
  }).join('')}<span>${parts.join(' · ')}</span>`;
}

// Новый трек — капсула на пару секунд показывает, что заиграло
function peek() {
  if (is('open') || is('notice')) return;
  pill.classList.add('peek');
  renderLabel();
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { pill.classList.remove('peek'); renderLabel(); }, 3500);
}

// av — ключ аватарки друга: на время уведомления она вместо обложки
function notice(text, av = '') {
  if (is('open')) return;
  pill.classList.remove('peek');
  pill.classList.add('notice');
  const face = avatarCss(av);
  $('#disc').style.backgroundImage = face || coverCss();
  pill.classList.toggle('face', !!face);
  pill.style.width = '';
  document.body.classList.remove('hidden');
  $('#p-title').textContent = text;
  $('#p-sub').textContent = 'авеон';
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    pill.classList.remove('notice', 'face');
    $('#disc').style.backgroundImage = coverCss();
    if (!st?.hasTrack) document.body.classList.add('hidden');
    renderLabel();
  }, 3800);
}

// Позиция между сообщениями — сами, по часам
// Заливка по буквам (richsync): сколько букв текущей строки уже спето — по времени слов
function letterFill() {
  const ws = st?.lyric?.letters;
  if (!ws?.length || st.lyric.gap) return null;
  const pos = (st.playing ? st.pos + (Date.now() - st.at) / 1000 : st.pos) + 0.05;
  let done = 0, total = 0;
  for (const w of ws) {
    total += w.n;
    if (pos >= w.e) done += w.n;
    else if (pos > w.s) done += w.n * ((pos - w.s) / Math.max(0.05, w.e - w.s));
  }
  return total ? done / total : 0;
}

function tick() {
  const fill = letterFill();
  if (fill !== null) {
    const v = `${(fill * 100).toFixed(1)}%`;
    $('#p-title').style.setProperty('--fill', v);
    $('#l-cur').style.setProperty('--fill', v);
  }
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
  fitWidth();
});
// курсор ушёл за окно острова целиком — тоже «ушёл с капсулы»
document.addEventListener('mouseleave', () => pill.dispatchEvent(new Event('mouseleave')));
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
