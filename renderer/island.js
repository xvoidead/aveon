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
let lastLine = '';
let peekTimer = 0;
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

// Угол, к которому прижата капсула (src/island.js → anchor): снизу — раскрывается вверх, слева —
// вправо, справа — влево; капли встают со стороны экрана, а не у края (island.css)
api.island.onConfig((c) => {
  const pos = c.pos || 'top';
  const cl = document.body.classList;
  cl.toggle('v-bottom', pos.startsWith('bottom'));
  cl.toggle('h-left', pos.endsWith('left'));
  cl.toggle('h-right', pos.endsWith('right'));
  wakeGoo();
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
  // Уведомление остров не раскрывает: событие уходит в каплю слева (renderSideEv — она подпрыгивает),
  // а прочитать его — в ленте раскрытого острова
  document.body.classList.toggle('hidden', !s.hasTrack && !previewing);
  if (!s.hasTrack) return;
  if (s.amber) setVar('--amber', s.amber);
  if (s.voice) setVar('--voice', s.voice);
  setVar('--m', String(s.m || 0));
  // басы нужны только пульсу — без него переменную 15 раз в секунду не трогаем
  setVar('--bass', String(s.playing && s.opts?.pulse ? s.bars?.[0] || 0 : 0));

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
  setIcon($('#b-play'), s.playing ? '#i-pause' : '#i-play');
  if (s.device && s.device.at !== devAt) {
    // первое состояние после запуска острова — старую смену устройства не показываем
    const fresh = devAt !== null && Date.now() - s.device.at < 4000;
    devAt = s.device.at;
    if (fresh) showDevice(s.device);
  } else if (devAt === null) devAt = s.device?.at ?? 0;
  pill.classList.toggle('can-like', !!s.likeable);
  pill.classList.toggle('src-sc', s.source === 'sc');
  renderLike(!!s.liked);
  $('#b-barrel').classList.toggle('on', !!s.manual);
  // пять уровней спектра → семь полосок волной от центра, как в iOS: басы посередине, верха по краям
  const lv = s.bars || [];
  bars.forEach((el, i) => {
    const v = `scaleY(${((18 + (lv[WAVE[i]] || 0) * 82) / 100).toFixed(2)})`;
    if (el.style.transform !== v) el.style.transform = v;
  });
  renderSide(s.friends);
  renderSideEv();
  if (pill.className !== lastClass) { lastClass = pill.className; wakeGoo(); }
});
let lastClass = '';
const WAVE = [4, 2, 1, 0, 1, 3, 4];

// Смена значка — новый проявляется из размытия, как SF Symbols в iOS
function setIcon(btn, href) {
  const use = btn.querySelector('use');
  if (use.getAttribute('href') === href) return;
  use.setAttribute('href', href);
  const svg = btn.querySelector('svg');
  svg.classList.remove('sym-swap');
  void svg.getBoundingClientRect();
  svg.classList.add('sym-swap');
}

// Сменилось устройство вывода — свёрнутый остров на три секунды показывает значок и название,
// как при подключении AirPods. Раскрытый не трогаем: там кнопки
let devAt = null;
let devName = '';
let devTimer = 0;
function showDevice(d) {
  if (is('open')) return;
  devName = d.name;
  $('#disc .dev-ico use').setAttribute('href', d.kind === 'headphones' ? '#i-headphones' : '#i-speaker');
  pill.classList.remove('peek');
  pill.classList.add('dev');
  renderLabel();
  clearTimeout(devTimer);
  devTimer = setTimeout(() => { pill.classList.remove('dev'); renderLabel(); }, 3000);
}
const vars = {};
function setVar(k, v) {
  if (vars[k] === v) return;
  vars[k] = v;
  document.documentElement.style.setProperty(k, v);
}

// Капли справа от свёрнутой капсулы, как вторая активность в iOS: друг слушает — его аватарка,
// есть уведомления — последнее (аватарка или значок) и сколько их. Видны ли — решает tick
const setHtml = (box, html) => { if (box._html !== html) { box._html = html; box.innerHTML = html; } };
function renderSide(f) {
  const x = f?.count ? f.live[0] : null;
  const bg = x && avatarCss(x.av);
  setHtml($('#side'), !x ? '' : bg ? `<i class="pic" style='background-image:${bg}'></i>` : `<i>${esc(x.letter)}</i>`);
}
// в капле — только непрочитанные: пришедшие с тех пор, как остров раскрывали (лента помнит два часа)
let seenAt = Date.now();
const unseen = () => (st?.events || []).filter((e) => e.at > seenAt);
let evShown = 0;
function renderSideEv() {
  const n = unseen().length;
  // значок чата цветом акцента; больше одного — ещё и сколько
  setHtml($('#side-ev'), n ? `<svg><use href="#i-chat"/></svg>${n > 1 ? `<b>${n > 9 ? '9+' : n}</b>` : ''}` : '');
  // пришло новое — капля коротко подпрыгивает (вместо раскрытой капсулы с текстом)
  if (n > evShown && evShown >= 0) {
    const el = $('#side-ev');
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  evShown = n;
}
const sides = () => [...document.querySelectorAll('.side.on')];

// Что написано в капсуле: уведомление > название (раскрыта) > бочка > строка текста
// Свёрнутая капсула растёт под текст: обложка + текст + полоски. Ширина меняется плавно (CSS transition).
// Не влезает даже в самую широкую — шрифт чуть меньше, и только потом многоточие
const MIN_W = 200, MAX_W = 660; // окно 780: справа ещё место под две капли (друг и уведомления)
const measure = document.createElement('span');
measure.className = 'measure';
document.body.appendChild(measure);
// шрифт догрузился — ширина, замеренная по запасному шрифту, уже неверна
document.fonts?.ready.then(() => { fitKey = ''; renderLabel(); });

let fitKey = '';
function fitWidth() {
  const b = $('#p-title');
  const key = `${pill.className}|${b.innerHTML}`;
  if (key === fitKey) return;
  fitKey = key;
  if (expanded()) { pill.style.width = ''; b.style.fontSize = ''; return; }
  const extra = 6 + 26 + 10 + 10 + (pill.classList.contains('no-bars') ? 0 : 30) + 16; // поля, обложка, отступы, 7 полосок
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
  if (is('dev') && !expanded()) text = devName;
  else if (expanded()) text = st.title || '';
  else if (is('lyric')) text = st.lyric?.gap ? '♪ ♪ ♪' : st.lyric?.cur || '';
  else if ((st.m || 0) > 0.5) text = st.manual ? 'в бочке' : 'говорят — в бочке';
  else text = st.title || '';
  // текста песни нет — в свёрнутом острове название и исполнитель
  const credit = !expanded() && !is('dev') && !is('lyric') && (st.m || 0) <= 0.5 && st.artist;
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
  const html = `${f.live.map((x) => {
    const bg = avatarCss(x.av);
    return `<i title="${esc(x.name)} — ${esc(x.title)}"${bg ? ` class="pic" style='background-image:${bg}'` : ''}>${bg ? '' : esc(x.letter)}</i>`;
  }).join('')}<span><em>${parts.join(' · ')}</em></span>`;
  // перерисовка на каждом тике сбрасывала бы бегущую строку — меняем, только если что-то поменялось
  if (html === box._html) return;
  box._html = html;
  box.innerHTML = html;
}

// Новый трек — капсула на пару секунд показывает, что заиграло
function peek() {
  if (is('open') || is('notice')) return;
  pill.classList.add('peek');
  renderLabel();
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { pill.classList.remove('peek'); renderLabel(); }, 3500);
}

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

// Силуэты для слоя .goo повторяют капсулу и капли (размер, скругление, прозрачность).
// Замерять их каждый кадр дорого (пересчёт стилей и раскладки 60–144 раза в секунду, даже когда остров
// спрятан), а каждая правка силуэта заново прогоняет SVG-фильтр. Поэтому следим покадрово, только пока
// капсула или капли движутся (идёт их transition или анимация), а в покое — раз в полсекунды.
// Сам слой .goo — не во всё окно 780×420, а по капсуле и каплям с полями под размытие и тень:
// фильтр считает в разы меньше пикселей
const goo = { box: $('.goo'), pill: $('#g-pill'), ev: $('#g-ev'), side: $('#g-side') };
const GOO_PAD = 28; // размытие (stdDeviation 6 → ~18 px) и тень (смещение 4 + размытие 12)
let gooAwake = 0;
let gooSynced = 0;
const wakeGoo = () => { gooAwake = performance.now() + 700; };
for (const ev of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationiteration', 'animationend']) {
  document.addEventListener(ev, (e) => {
    const t = e.target;
    if (t === pill || t === document.body || t.classList?.contains('side')) wakeGoo();
  });
}
function gooPlace(g, r, origin, radius, op) {
  const key = `${(r.left - origin.x).toFixed(1)},${(r.top - origin.y).toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)},${radius},${op.toFixed(2)}`;
  if (g._key === key) return;
  g._key = key;
  g.style.transform = `translate(${r.left - origin.x}px, ${r.top - origin.y}px)`;
  g.style.width = `${r.width}px`;
  g.style.height = `${r.height}px`;
  g.style.borderRadius = radius;
  g.style.opacity = op;
}
function syncGoo() {
  gooSynced = performance.now();
  const cs = getComputedStyle(pill);
  const parts = [[goo.pill, pill.getBoundingClientRect(), cs.borderRadius, +cs.opacity]];
  // капля — полностью чёрная, как только появилась хоть на полкапли: иначе не слипается с капсулой
  for (const [g, el] of [[goo.ev, $('#side-ev')], [goo.side, $('#side')]]) {
    const r = el.getBoundingClientRect();
    parts.push([g, r, '50%', Math.min(1, r.width / 14)]);
  }
  const vis = parts.filter(([, r]) => r.width > 0 && r.height > 0);
  const x = Math.floor(Math.min(...vis.map(([, r]) => r.left), 1e6) - GOO_PAD);
  const y = Math.floor(Math.min(...vis.map(([, r]) => r.top), 1e6) - GOO_PAD);
  const w = Math.ceil(Math.max(...vis.map(([, r]) => r.right), 0) + GOO_PAD) - x;
  const h = Math.ceil(Math.max(...vis.map(([, r]) => r.bottom), 0) + GOO_PAD) - y;
  const boxKey = vis.length ? `${x},${y},${w},${h}` : 'none';
  if (goo.box._key !== boxKey) {
    goo.box._key = boxKey;
    goo.box.style.transform = vis.length ? `translate(${x}px, ${y}px)` : '';
    goo.box.style.width = vis.length ? `${w}px` : '0';
    goo.box.style.height = vis.length ? `${h}px` : '0';
  }
  for (const [g, r, radius, op] of parts) gooPlace(g, r, { x, y }, radius, op);
}

function tick() {
  const now = performance.now();
  if (now < gooAwake || now - gooSynced > 500) syncGoo();
  const drops = !!st?.hasTrack && !expanded() && !document.body.classList.contains('hidden');
  $('#side').classList.toggle('on', drops && is('friend-live'));
  $('#side-ev').classList.toggle('on', drops && unseen().length > 0);
  const fill = letterFill();
  if (fill !== null) {
    const v = `${(fill * 100).toFixed(1)}%`;
    $('#p-title').style.setProperty('--fill', v);
    $('#l-cur').style.setProperty('--fill', v);
  }
  if (st?.hasTrack && is('open')) {
    const dur = st.duration || 0;
    // тянут полосу — показываем, куда перемотается, а не где играет
    const pos = seekDrag ? seekDrag.f * dur : st.playing ? st.pos + (Date.now() - st.at) / 1000 : st.pos;
    $('#t-cur').textContent = fmt(dur ? Math.min(pos, dur) : pos);
    $('#t-dur').textContent = dur ? `-${fmt(dur - Math.min(pos, dur))}` : '0:00'; // справа — сколько осталось, как в iOS
    $('#seek-fill').style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0';
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Наведение: капсула раскрывается. Зашёл ли курсор и ушёл ли, решает только главный процесс
// (src/hover.js, по часам и с задержкой на уход): mouseleave и :hover здесь врут, когда окно
// переключается «пропускать клики / ловить», — капсула сворачивалась под курсором, и кнопки не нажимались
function pointerIn() {
  api.island.log?.('pointerIn', pill.className);
  clearTimeout(leaveTimer);
  if (is('open')) { api.island.hover(true); return; } // уже раскрыт — но ловить мышь напомнить (вдруг сбросили)
  pill.classList.remove('peek', 'notice', 'dev');
  pill.classList.add('open');
  seenAt = Date.now(); // раскрыли — уведомления видны в ленте, капля больше не нужна
  renderSideEv();
  renderLabel();
  fitWidth();
  window.sendPillRect?.(); // сразу, не дожидаясь кадра
  requestAnimationFrame(fitLyricLine); // строку текста меряем, когда у неё появилась ширина
  api.island.hover(true);
}
function pointerOut() {
  api.island.log?.('pointerOut', pill.className, 'hover', pill.matches(':hover'));
  clearTimeout(leaveTimer);
  pill.classList.remove('open');
  sideZone = null;
  renderLabel();
}
// Раскрывается по нажатию, как в iOS; наведение только подсвечивает капсулу
pill.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || is('open')) return;
  e.preventDefault();
  pointerIn();
});
// Редактор места (src/islandedit.js) просит показать остров раскрытым — видно, куда он откроется.
// Мышь в это время у редактора, так что наведение и уход курсора сюда не приходят
api.island.onDemo?.((on) => {
  clearTimeout(leaveTimer);
  if (on) {
    pill.classList.remove('peek', 'notice', 'dev');
    pill.classList.add('open');
    requestAnimationFrame(fitLyricLine);
  } else pill.classList.remove('open');
  sideZone = null;
  renderLabel();
  fitWidth();
  window.sendPillRect?.();
});

// главный процесс: курсор над капсулой — подсветка; ушёл (уже с задержкой) — свернуть
api.island.onPointer((on) => {
  api.island.log?.('onPointer', on);
  pill.classList.toggle('hover', on === true);
  if (on === 'reset') { // окно прячут: свернуться сразу, без задержки и без проверки :hover
    clearTimeout(leaveTimer);
    pill.classList.remove('open');
    sideZone = null;
    renderLabel();
    return;
  }
  if (!on && seekDrag) { outWhileDrag = true; return; } // тянут перемотку — свернёмся, когда отпустят
  if (!on) pointerOut();
});

const act = (type, extra) => api.island.action({ type, ...extra });
$('#b-play').onclick = () => act('thumb', { action: 'toggle' });
$('#b-prev').onclick = () => act('thumb', { action: 'prev' });
$('#b-next').onclick = () => act('thumb', { action: 'next' });
$('#b-barrel').onclick = () => act('barrel');
$('#b-sc').onclick = () => act('sc'); // найти этот трек в SoundCloud — в окне плеера (island-feed.js)

// «нравится»: сердечко меняется сразу (плеер пришлёт liked чуть позже); второе нажатие — убрать лайк
function renderLike(on) {
  const b = $('#b-like');
  if (b.classList.contains('on') === on) return;
  b.classList.toggle('on', on);
  b.title = on ? 'Убрать из «Мне нравится»' : 'Нравится';
  b.querySelector('use').setAttribute('href', on ? '#i-heart-fill' : '#i-heart');
}
$('#b-like').onclick = () => {
  const b = $('#b-like');
  renderLike(!b.classList.contains('on'));
  b.classList.remove('pop');
  void b.offsetWidth;
  b.classList.add('pop');
  act('like');
};

$('#disc').onclick = () => { if (is('open')) act('focus'); }; // свёрнутый: нажатие раскрывает остров, а не плеер
// нажатие на каплю — раскрыть остров: там строка «кто что слушает» и лента уведомлений
let sideZone = null;
for (const el of document.querySelectorAll('.side')) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !el.classList.contains('on')) return;
    sideZone = el.getBoundingClientRect();
    pointerIn();
  });
}
// Перемотка как в iOS (и как в плеере, app.js → makeSlider): держишь — полоса толще, тянешь за
// край — вытягивается резинкой и по отпусканию пружинит обратно; перематываем по отпусканию
const RUBBER = 16;
let seekDrag = null; // { f } — пока тянут
let outWhileDrag = false; // курсор ушёл с капсулы посреди перемотки — свернём, когда отпустят
function seekAt(e) {
  const bar = $('#seek');
  const r = bar.getBoundingClientRect();
  seekDrag.f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const over = e.clientX > r.right ? e.clientX - r.right : e.clientX < r.left ? e.clientX - r.left : 0;
  const a = Math.sign(over) * RUBBER * (1 - 1 / ((Math.abs(over) / RUBBER) * 0.55 + 1));
  bar.style.setProperty('--sx', String(1 + Math.abs(a) / (bar.offsetWidth || 1)));
  bar.style.setProperty('--tx', `${Math.min(0, a)}px`);
}
$('#seek').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !st?.duration) return;
  const bar = e.currentTarget;
  bar.setPointerCapture(e.pointerId);
  bar.classList.add('drag');
  seekDrag = { f: 0 };
  outWhileDrag = false;
  seekAt(e);
  const move = (ev) => seekAt(ev);
  const up = (ev) => {
    if (ev.type === 'pointerup') seekAt(ev);
    const pos = seekDrag.f * st.duration;
    act('seek', { pos });
    bar.classList.remove('drag');
    bar.style.setProperty('--sx', '1');
    bar.style.setProperty('--tx', '0px');
    bar.removeEventListener('pointermove', move);
    bar.removeEventListener('pointerup', up);
    bar.removeEventListener('pointercancel', up);
    // плеер пришлёт новую позицию чуть позже — до тех пор держим ту, куда отпустили
    st = { ...st, pos, at: Date.now() };
    seekDrag = null;
    if (outWhileDrag) pointerOut();
  };
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', up);
  bar.addEventListener('pointercancel', up);
});
// колесо над островом — громкость
pill.addEventListener('wheel', (e) => { e.preventDefault(); act('volume', { delta: e.deltaY < 0 ? 0.05 : -0.05 }); }, { passive: false });

// Где панель — главному процессу (src/hover.js): над ней окно ловит мышь, даже если сама панель —
// область перетаскивания и движение мыши сюда не приходит
(() => {
  let last = '';
  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  const send = () => {
    const el = document.querySelector('#pill');
    if (!el) return;
    let r = el.getBoundingClientRect();
    // раскрыли нажатием на кружок друга — его место тоже «наше», пока остров раскрыт: иначе курсор,
    // оставшийся там, где был кружок (правее широкой капсулы), сразу свернул бы остров
    if (sideZone && is('open')) {
      const l = Math.min(r.left, sideZone.left), t = Math.min(r.top, sideZone.top);
      r = { left: l, top: t, width: Math.max(r.right, sideZone.right) - l, height: Math.max(r.bottom, sideZone.bottom) - t };
    }
    const rect = box(r);
    // над каплями окно ловит мышь (иначе клик проходит насквозь), но наведение остров не раскрывает
    const drops = sides();
    if (drops.length) rect.extra = drops.map((d) => box(d.getBoundingClientRect()));
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


// временно: любое нажатие в острове — в журнал (куда попало, в каком состоянии капсула)
document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  api.island.log?.('pointerdown', `${t.tagName}#${t.id}.${String(t.className).replace(/\s+/g, '.')}`, 'text', (t.textContent || '').slice(0, 20), 'pill', pill.className, 'at', e.clientX, e.clientY, 'pillRect', pill.getBoundingClientRect().toJSON());
}, true);
