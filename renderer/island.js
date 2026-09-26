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
    notice(s.notice.text, s.notice.av, s.notice.kind);
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
  renderEvents(s.events || []);
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
    fitLyricLine();
    box.classList.remove('swap');
    void box.offsetWidth;
    box.classList.add('swap');
  }
}

// Длинная строка: сначала уменьшаем шрифт (до 12 px), не помещается и так — две строки,
// а капсула становится выше на строку (--lx), чтобы следующая строка текста не обрезалась
function fitLyricLine() {
  const el = $('#l-cur');
  el.classList.remove('two');
  let size = 15;
  el.style.fontSize = `${size}px`;
  if (!el.clientWidth) { pill.style.setProperty('--lx', '0px'); return; } // капсула свёрнута — посчитаем при раскрытии
  while (el.scrollWidth > el.clientWidth + 1 && size > 12) { size -= 0.5; el.style.fontSize = `${size}px`; }
  const two = el.scrollWidth > el.clientWidth + 1;
  el.classList.toggle('two', two);
  pill.style.setProperty('--lx', two ? '20px' : '0px');
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
// откуда уведомление — в подписи
const NOTICE_FROM = { friend: 'друзья', together: 'рума', admin: 'от админов', info: 'авеон' };
let pendingNotice = null; // пришло, пока остров раскрыт под курсором, — покажем, когда свернётся

// эмодзи картинками Apple, как в окне плеера (renderer/app.js → emojify)
const EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/';
const EMOJI_RE = /\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu;
const emo = (s) => esc(s).replace(EMOJI_RE, (e) => (/^[\u00a9\u00ae\u2122]$/.test(e) ? e
  : `<img class="emoji" src="${EMOJI_CDN}${[...e].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('-')}.png" alt="${e}">`));
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img.classList?.contains('emoji')) return;
  if (!img.dataset.retry && img.src.includes('-fe0f')) { img.dataset.retry = '1'; img.src = img.src.replace(/-fe0f/g, ''); return; }
  img.replaceWith(document.createTextNode(img.alt));
}, true);

function notice(text, av = '', kind = 'info') {
  if (is('open')) { pendingNotice = { text, av, kind, at: Date.now() }; return; }
  pill.classList.remove('peek');
  pill.classList.add('notice');
  const face = avatarCss(av);
  $('#disc').style.backgroundImage = face || coverCss();
  pill.classList.toggle('face', !!face);
  pill.style.width = '';
  document.body.classList.remove('hidden');
  const title = $('#p-title');
  title.innerHTML = emo(text);
  title.dataset.key = ''; // после уведомления renderLabel перепишет название заново
  $('#p-sub').textContent = NOTICE_FROM[kind] || 'авеон';
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

// Наведение: капсула раскрывается. Зашёл ли курсор и ушёл ли, решает только главный процесс
// (src/hover.js, по часам и с задержкой на уход): mouseleave и :hover здесь врут, когда окно
// переключается «пропускать клики / ловить», — капсула сворачивалась под курсором, и кнопки не нажимались
function pointerIn() {
  clearTimeout(leaveTimer);
  if (is('open')) { api.island.hover(true); return; } // уже раскрыт — но ловить мышь напомнить (вдруг сбросили)
  pill.classList.remove('peek', 'notice');
  pill.classList.add('open');
  renderLabel();
  fitWidth();
  window.sendPillRect?.(); // сразу, не дожидаясь кадра
  requestAnimationFrame(fitLyricLine); // строку текста меряем, когда у неё появилась ширина
  api.island.hover(true);
}
function pointerOut() {
  clearTimeout(leaveTimer);
  pill.classList.remove('open');
  renderLabel();
  // уведомление, пришедшее под курсором, — сейчас, если ещё свежее
  const p = pendingNotice;
  pendingNotice = null;
  if (p && Date.now() - p.at < 8000) notice(p.text, p.av, p.kind);
}
pill.addEventListener('mouseenter', pointerIn); // быстрее часов главного процесса, если событие пришло
// главный процесс: зашёл — раскрыть, ушёл (уже с задержкой) — свернуть
api.island.onPointer((on) => {
  if (on === 'reset') { // окно прячут: свернуться сразу, без задержки и без проверки :hover
    clearTimeout(leaveTimer);
    pill.classList.remove('open');
    pendingNotice = null;
    renderLabel();
    return;
  }
  if (on) pointerIn(); else pointerOut();
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

// Где панель — главному процессу (src/hover.js): над ней окно ловит мышь, даже если сама панель —
// область перетаскивания и движение мыши сюда не приходит
(() => {
  let last = '';
  const send = () => {
    const el = document.querySelector('#pill');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    const key = JSON.stringify(rect);
    if (key !== last) { last = key; api.popup?.rect(rect); }
  };
  // Капсула растёт ~0,4 с: пока меняется размер, шлём каждый кадр (ResizeObserver) — иначе кнопки
  // раскрытой капсулы какое-то время были «за границей» и клики уходили насквозь.
  // Раз в 150 мс — на случай, если капсула переехала, не меняя размера
  window.sendPillRect = send;
  new ResizeObserver(send).observe(document.querySelector('#pill'));
  setInterval(send, 150);
  send();
})();


// ---- лента событий в раскрытом острове: последние три, с кнопками и крестиком ----
const EV_ICON = { friend: '👋', together: '🎧', admin: '📣', info: '🔔' };
function evAgo(at) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? 'сейчас' : s < 3600 ? `${Math.round(s / 60)} мин` : `${Math.round(s / 3600)} ч`;
}

function renderEvents(list) {
  let box = $('#events');
  if (!box) {
    box = document.createElement('div');
    box.id = 'events';
    box.className = 'events';
    $('#friends').after(box);
    // по нажатию, а не по отпусканию: строка может перерисоваться между ними — и клик терялся бы
    box.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-ev]');
      if (!b || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      act('event', { id: b.dataset.ev, i: b.dataset.i === undefined ? null : +b.dataset.i });
    });
    setInterval(() => { for (const t of box.querySelectorAll('[data-at]')) t.textContent = evAgo(+t.dataset.at); }, 20000);
  }
  // пока есть события, строка «друг слушает» не нужна — событие о нём тоже будет в ленте
  $('#friends').classList.toggle('under-events', list.length > 0);
  pill.classList.toggle('has-events', list.length > 0);
  pill.style.setProperty('--ev', String(list.length));
  const html = list.map((e) => {
    const bg = avatarCss(e.av);
    const face = bg ? `<i class="pic" style='background-image:${bg}'></i>` : e.letter ? `<i>${esc(e.letter)}</i>` : `<i class="ico">${emo(EV_ICON[e.kind] || '🔔')}</i>`;
    return `<div class="ev">${face}<span class="ev-t">${emo(e.text)}</span><small data-at="${e.at}">${evAgo(e.at)}</small>
      ${e.acts.map((a) => `<button class="${a.primary ? 'primary' : ''}" data-ev="${esc(e.id)}" data-i="${a.i}">${esc(a.label)}</button>`).join('')}
      <button class="ev-x" data-ev="${esc(e.id)}" title="Убрать">×</button></div>`;
  }).join('');
  // перерисовываем, только если поменялось: состояние приходит 15 раз в секунду, клик по
  // пересозданной кнопке терялся бы
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}
