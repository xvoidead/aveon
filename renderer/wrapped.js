'use strict';
// Итоги года — по приколу, как истории: сколько слушал, любимые треки и артисты, лучший день,
// «кто ты как слушатель». Последняя карточка сохраняется картинкой, чтобы кинуть друзьям.
// Считается из локальной статистики (extras.js: statsAll, splitArtists, MONTHS, MONTHS_GEN).
// Общие глобальные: state, $, esc, toast, plural, playFrom, api.

const wr = { open: false, i: 0, slides: [], data: null, timer: 0, t0: 0 };
const WR_SLIDE_MS = 7000;

function wrappedYear() {
  const all = statsAll();
  const y = new Date().getFullYear();
  const sumYear = (yy) => Object.entries(all.days).filter(([k]) => k.startsWith(`${yy}-`)).reduce((a, [, v]) => a + v, 0);
  // в январе прошлый год интереснее, если в новом ещё почти ничего не наслушано
  return new Date().getMonth() === 0 && sumYear(y) < 3600 && sumYear(y - 1) > 3600 ? y - 1 : y;
}

function wrappedData(year) {
  const all = statsAll();
  const pre = `${year}-`;
  const days = Object.entries(all.days).filter(([k]) => k.startsWith(pre));
  const total = days.reduce((a, [, v]) => a + v, 0);
  const bestDay = days.reduce((b, d) => (d[1] > (b?.[1] || 0) ? d : b), null);
  const months = Array(12).fill(0);
  let weekend = 0;
  for (const [k, v] of days) {
    const d = new Date(`${k}T12:00`);
    months[d.getMonth()] += v;
    if (d.getDay() === 0 || d.getDay() === 6) weekend += v;
  }
  const tracks = [];
  const artists = new Map();
  for (const rec of Object.values(all.tracks)) {
    let sec = 0, plays = 0;
    for (const [mk, m] of Object.entries(rec.m || {})) if (mk.startsWith(pre)) { sec += m.sec || 0; plays += m.plays || 0; }
    if (sec < 1) continue;
    tracks.push({ t: rec.t, sec, plays });
    const names = splitArtists(rec.t?.artist);
    for (const n of names) {
      const a = artists.get(n) || { name: n, sec: 0, plays: 0, cover: '', coverSec: 0 };
      a.sec += sec / names.length;
      a.plays += plays;
      if (rec.t?.cover && sec > a.coverSec) { a.cover = rec.t.cover; a.coverSec = sec; }
      artists.set(n, a);
    }
  }
  tracks.sort((a, b) => b.plays - a.plays || b.sec - a.sec);
  const arts = [...artists.values()].sort((a, b) => b.sec - a.sec);
  const plays = tracks.reduce((a, t) => a + t.plays, 0);
  const bestMonth = months.indexOf(Math.max(...months));
  return { year, total, activeDays: days.filter(([, v]) => v > 60).length, bestDay, months, bestMonth, weekend, tracks, arts, plays };
}

// Кто ты как слушатель — по тому, как распределено время
function wrappedPersona(d) {
  const top = d.tracks[0];
  const uniq = d.tracks.length;
  const hours = d.total / 3600;
  if (top && d.plays > 20 && top.plays / d.plays > 0.12) return { name: 'Однолюб', text: `«${top.t.title}» звучал${top.plays > 1 ? ` ${top.plays} ${plural(top.plays, 'раз', 'раза', 'раз')}` : ''}. Своё найдено — зачем искать дальше?` };
  if (d.arts[0] && d.arts[0].sec / d.total > 0.3) return { name: 'Фанат', text: `Почти треть года — ${d.arts[0].name}. Это уже не плейлист, это отношения.` };
  if (uniq > 40 && d.plays && uniq / d.plays > 0.6) return { name: 'Исследователь', text: `${uniq} разных треков. Одно и то же дважды — не твой стиль.` };
  if (hours > 300) return { name: 'Марафонец', text: `${Math.round(hours)} часов музыки. Наушники, кажется, уже часть тебя.` };
  if (d.weekend / d.total > 0.45) return { name: 'Музыка по выходным', text: 'Будни — для дел, суббота с воскресеньем — для звука.' };
  return { name: 'Ценитель', text: 'Слушаешь в меру и со вкусом. Каждый трек — по делу.' };
}

function wrappedComparison(sec) {
  const h = sec / 3600;
  if (h >= 16) return `Это как ${Math.floor(h / 8)} ${plural(Math.floor(h / 8), 'раз', 'раза', 'раз')} долететь из Москвы во Владивосток`;
  if (h >= 2) return `Это ${Math.round(h / 1.6)} ${plural(Math.round(h / 1.6), 'фильм', 'фильма', 'фильмов')} подряд`;
  return 'Хорошее начало. Дальше — больше';
}

const wrCover = (src, cls = '') => (src ? `<img class="${cls}" src="${esc(src)}" alt="" draggable="false">` : `<div class="${cls} wr-nocover"></div>`);
const wrMin = (s) => Math.round(s / 60).toLocaleString('ru-RU');

function wrappedSlides(d) {
  const p = wrappedPersona(d);
  const top = d.tracks[0];
  const art = d.arts[0];
  const s = [];
  s.push({ tone: 'amber', html: `<div class="wr-year" aria-hidden="true">${d.year}</div><h2 class="wr-h">Твой ${d.year} в авеоне</h2><p class="wr-p">Собрали всё, что у тебя звучало. Жми, чтобы листать.</p>` });
  s.push({ tone: 'oak', html: `<p class="wr-p">В этом году — </p><div class="wr-big">${wrMin(d.total)}</div><h2 class="wr-h">${plural(Math.round(d.total / 60), 'минута', 'минуты', 'минут')} музыки</h2><p class="wr-p">${wrappedComparison(d.total)}. Музыка звучала ${d.activeDays} ${plural(d.activeDays, 'день', 'дня', 'дней')}.</p>` });
  if (top) s.push({ tone: 'voice', html: `${wrCover(top.t.cover, 'wr-cover spin')}<p class="wr-p">Трек года</p><h2 class="wr-h">${esc(top.t.title)}</h2><p class="wr-p">${esc(top.t.artist || '')} · ${top.plays} ${plural(top.plays, 'прослушивание', 'прослушивания', 'прослушиваний')}</p>`, play: [top.t] });
  if (d.tracks.length > 1) s.push({ tone: 'oak', html: `<h2 class="wr-h">Пятёрка треков</h2><ol class="wr-list">${d.tracks.slice(0, 5).map((t) => `<li>${wrCover(t.t.cover, 'wr-thumb')}<div><b>${esc(t.t.title)}</b><span>${esc(t.t.artist || '')}</span></div><em>${t.plays}</em></li>`).join('')}</ol>`, play: d.tracks.slice(0, 5).map((t) => t.t) });
  if (art) s.push({ tone: 'amber', html: `${wrCover(art.cover, 'wr-cover round')}<p class="wr-p">Артист года</p><h2 class="wr-h">${esc(art.name)}</h2><p class="wr-p">${Math.max(1, Math.round((art.sec / d.total) * 100))}% всего времени — ${wrMin(art.sec)} мин</p>` });
  if (d.arts.length > 1) s.push({ tone: 'voice', html: `<h2 class="wr-h">Пятёрка артистов</h2><ol class="wr-list">${d.arts.slice(0, 5).map((a) => `<li>${wrCover(a.cover, 'wr-thumb round')}<div><b>${esc(a.name)}</b><span>${wrMin(a.sec)} мин</span></div></li>`).join('')}</ol>` });
  if (d.bestDay) {
    const [, m, dd] = d.bestDay[0].split('-').map(Number);
    const max = Math.max(...d.months) || 1;
    s.push({ tone: 'oak', html: `<p class="wr-p">Самый музыкальный день</p><h2 class="wr-h">${dd} ${MONTHS_GEN[m - 1]}</h2><p class="wr-p">${wrMin(d.bestDay[1])} минут за один день. А лучший месяц — ${MONTHS[d.bestMonth]}.</p><div class="wr-months" aria-hidden="true">${d.months.map((v, i) => `<i class="${i === d.bestMonth ? 'on' : ''}" style="--h:${Math.max(3, (v / max) * 100).toFixed(0)}%"></i>`).join('')}</div>` });
  }
  s.push({ tone: 'amber', html: `<p class="wr-p">Ты как слушатель —</p><div class="wr-persona">${esc(p.name)}</div><p class="wr-p">${esc(p.text)}</p>` });
  s.push({ tone: 'final', html: `<canvas class="wr-card" width="1080" height="1350" aria-label="Итоговая карточка"></canvas><div class="wr-actions"><button class="btn primary" data-wr="save">Сохранить картинку</button><button class="btn" data-wr="copy">Скопировать</button><button class="btn" data-wr="again">Сначала</button></div>`, final: true });
  return s.map((x) => ({ ...x, persona: p }));
}

function openWrapped() {
  const year = wrappedYear();
  const d = wrappedData(year);
  if (d.total < 600) { toast(`За ${year} год пока почти ничего не наслушано — включай музыку, итоги соберутся сами`); return; }
  wr.data = d;
  wr.slides = wrappedSlides(d);
  let el = $('#wrapped');
  if (!el) {
    el = document.createElement('section');
    el.id = 'wrapped';
    el.className = 'wrapped';
    el.setAttribute('aria-label', 'Итоги года');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-wr-close]')) { closeWrapped(); return; }
      const act = e.target.closest('[data-wr]')?.dataset.wr;
      if (act === 'save') { wrappedSave(); return; }
      if (act === 'copy') { wrappedCopy(); return; }
      if (act === 'again') { wrGo(0); return; }
      if (act === 'play') { const sl = wr.slides[wr.i]; if (sl.play) playFrom(sl.play, 0); return; }
      if (e.target.closest('button, .wr-card')) return;
      wrGo(wr.i + (e.clientX < innerWidth / 3 ? -1 : 1));
    });
  }
  el.innerHTML = `<div class="wr-bars">${wr.slides.map(() => '<i><b></b></i>').join('')}</div>
    <button class="icon-btn wr-close" data-wr-close aria-label="Закрыть итоги"><svg><use href="#i-close"/></svg></button>
    <div class="wr-stage" aria-live="polite"></div>`;
  el.hidden = false;
  wr.open = true;
  wrGo(0);
}

function closeWrapped() {
  wr.open = false;
  cancelAnimationFrame(wr.timer);
  const el = $('#wrapped');
  if (el) el.hidden = true;
}

function wrGo(i) {
  if (i >= wr.slides.length) { closeWrapped(); return; }
  wr.i = Math.max(0, i);
  const sl = wr.slides[wr.i];
  const el = $('#wrapped');
  el.dataset.tone = sl.tone;
  const stage = el.querySelector('.wr-stage');
  stage.innerHTML = `<div class="wr-slide">${sl.html}${sl.play ? '<button class="btn wr-play" data-wr="play"><svg><use href="#i-play"/></svg><span>Послушать</span></button>' : ''}</div>`;
  el.querySelectorAll('.wr-bars i').forEach((b, k) => { b.classList.toggle('done', k < wr.i); b.querySelector('b').style.width = k < wr.i ? '100%' : '0'; });
  if (sl.final) drawWrappedCard(stage.querySelector('.wr-card'));
  cancelAnimationFrame(wr.timer);
  wr.t0 = performance.now();
  // сама листается, но последнюю карточку не торопим
  const tick = () => {
    if (!wr.open) return;
    const k = Math.min(1, (performance.now() - wr.t0) / WR_SLIDE_MS);
    const bar = el.querySelectorAll('.wr-bars i b')[wr.i];
    if (bar) bar.style.width = `${(sl.final ? 1 : k) * 100}%`;
    if (k >= 1 && !sl.final) { wrGo(wr.i + 1); return; }
    wr.timer = requestAnimationFrame(tick);
  };
  wr.timer = requestAnimationFrame(tick);
}

document.addEventListener('keydown', (e) => {
  if (!wr.open) return;
  if (e.key === 'Escape') { e.stopPropagation(); closeWrapped(); }
  else if (e.key === 'ArrowRight' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); wrGo(wr.i + 1); }
  else if (e.key === 'ArrowLeft') { e.stopPropagation(); e.preventDefault(); wrGo(wr.i - 1); }
}, true);

// ---------- итоговая карточка ----------

function wrLoadImg(src) {
  return new Promise((res) => {
    if (!src) { res(null); return; }
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
    setTimeout(() => res(null), 4000);
  });
}

function wrFit(g, text, max) {
  let s = text;
  while (s.length > 1 && g.measureText(s).width > max) s = s.slice(0, -1);
  return s === text ? s : `${s.trimEnd()}…`;
}

async function drawWrappedCard(c) {
  const d = wr.data;
  const g = c.getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  const amber = cs.getPropertyValue('--amber').trim() || '#f0a63a';
  const voice = cs.getPropertyValue('--voice').trim() || '#9aa8ff';
  const oak = cs.getPropertyValue('--oak').trim() || '#1b1411';
  const font = cs.getPropertyValue('--display').trim() || 'sans-serif';
  const W = c.width, H = c.height;
  g.fillStyle = oak;
  g.fillRect(0, 0, W, H);
  // крупный год — фоном, наполовину за краем
  g.save();
  g.globalAlpha = 0.14;
  g.fillStyle = amber;
  g.font = `800 300px ${font}`;
  g.textBaseline = 'alphabetic';
  g.fillText(String(d.year), 60, H - 50);
  g.restore();
  // круги-дорожки пластинки справа сверху
  for (let k = 0; k < 9; k++) {
    g.beginPath();
    g.arc(W - 120, 170, 60 + k * 26, 0, Math.PI * 2);
    g.strokeStyle = k % 3 === 0 ? voice : amber;
    g.globalAlpha = 0.25 - k * 0.02;
    g.lineWidth = 3;
    g.stroke();
  }
  g.globalAlpha = 1;
  const left = 84;
  g.fillStyle = amber;
  g.font = `700 44px ${font}`;
  g.fillText(`авеон · итоги ${d.year}`, left, 130);
  g.fillStyle = '#f4e9dc';
  g.font = `800 150px ${font}`;
  g.fillText(wrMin(d.total), left, 320);
  g.font = `500 40px ${font}`;
  g.fillStyle = 'rgba(244,233,220,0.7)';
  g.fillText('минут музыки', left, 380);
  const cols = [[left, 'Треки', d.tracks.slice(0, 5).map((t) => t.t.title)], [W / 2 + 20, 'Артисты', d.arts.slice(0, 5).map((a) => a.name)]];
  for (const [x, head, list] of cols) {
    g.fillStyle = voice;
    g.font = `700 34px ${font}`;
    g.fillText(head, x, 500);
    g.font = `500 36px ${font}`;
    list.forEach((name, i) => {
      g.fillStyle = i === 0 ? '#f4e9dc' : 'rgba(244,233,220,0.75)';
      g.fillText(wrFit(g, `${i + 1}  ${name}`, W / 2 - 110), x, 570 + i * 62);
    });
  }
  const p = wr.slides[0]?.persona || wrappedPersona(d);
  g.fillStyle = amber;
  g.beginPath();
  g.roundRect(left, 900, W - left * 2, 170, 36);
  g.fill();
  g.fillStyle = oak;
  g.font = `600 32px ${font}`;
  g.fillText('Ты как слушатель', left + 44, 965);
  g.font = `800 60px ${font}`;
  g.fillText(wrFit(g, p.name, W - left * 2 - 88), left + 44, 1038);
  const cover = await wrLoadImg(d.tracks[0]?.t.cover);
  if (cover && wr.open) {
    g.save();
    g.beginPath();
    g.arc(W - 120, 170, 58, 0, Math.PI * 2);
    g.clip();
    g.drawImage(cover, W - 178, 112, 116, 116);
    g.restore();
  }
}

function wrCardBlob() {
  const c = $('#wrapped .wr-card');
  return new Promise((res) => {
    try { c.toBlob((b) => res(b), 'image/png'); } catch { res(null); } // чужая обложка без CORS «портит» холст
  });
}

async function wrappedSave() {
  const b = await wrCardBlob();
  if (!b) { toast('Не получилось сохранить картинку', 'err'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `aveon-${wr.data.year}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function wrappedCopy() {
  const b = await wrCardBlob();
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
    toast('Картинка скопирована — вставляй в чат');
  } catch { toast('Не получилось скопировать — сохрани картинкой', 'err'); }
}
