'use strict';
// Главная: всё понемногу. Приветствие, эфир волны (кнопка — сразу включить, баннер — на страницу
// волны), что часто слушаешь, свои плейлисты и плейлисты сервисов, свои артисты, друзья в эфире.
// Всё — из того, что уже есть: статистика (extras.js → stats), альбомы, коллекции сервисов, друзья.
// Общие глобальные: state, api, stats, Friends, Wave, $, esc, plural, playFrom, openView, openArtist,
// waveStart, waveCfg, waveMode, serviceReady, monthKey, NAMES.

const HOME_SERVICES = ['ym', 'sc', 'sp'];

function homeGreeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  const name = String(state.account?.name || '').trim().split(/\s+/)[0];
  return name ? `${part}, ${name}` : part;
}

const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

// Одна строка под приветствием: сколько музыки в этом месяце и кто из друзей в эфире
function homeLine() {
  const m = monthKey();
  let sec = 0;
  for (const r of Object.values(stats?.data?.tracks || {})) sec += r.m?.[m]?.sec || 0;
  const parts = [];
  const hours = Math.round(sec / 3600);
  if (hours >= 1) parts.push(`В ${MONTHS_IN[new Date().getMonth()]} — ${hours} ${plural(hours, 'час', 'часа', 'часов')} музыки.`);
  else if (sec > 60) parts.push(`В ${MONTHS_IN[new Date().getMonth()]} — ${Math.round(sec / 60)} минут музыки.`);
  const live = (Friends.data?.friends || []).filter((f) => f.now?.playing).length;
  if (live) parts.push(live === 1 ? 'Сейчас слушает друг.' : `Сейчас слушают ${live} ${plural(live, 'друг', 'друга', 'друзей')}.`);
  return parts.join(' ') || 'Здесь соберётся твоё: что слушаешь, плейлисты, артисты.';
}

// Часто слушаешь: этот месяц, если набралось, иначе за всё время
function topTracks(n = 6) {
  const m = monthKey();
  const all = Object.values(stats?.data?.tracks || {}).filter((r) => r.t && r.t.playable !== false);
  const month = all.filter((r) => r.m?.[m]?.sec > 30).sort((a, b) => b.m[m].sec - a.m[m].sec);
  const list = month.length >= 4 ? month : all.sort((a, b) => b.sec - a.sec);
  return list.slice(0, n).map((r) => r.t);
}

function topArtists(n = 12) {
  const by = new Map();
  for (const r of Object.values(stats?.data?.tracks || {})) {
    if (!r.t) continue;
    for (const name of splitArtists(r.t.artist).slice(0, 2)) {
      const k = artistKey(name);
      if (!k) continue;
      const a = by.get(k) || { name, sec: 0, cover: '' };
      a.sec += r.sec;
      if (!a.cover && r.t.cover) a.cover = r.t.cover;
      by.set(k, a);
    }
  }
  return [...by.values()].sort((a, b) => b.sec - a.sec).slice(0, n);
}

// Свои альбомы, «Скачанные» и плейлисты подключённых сервисов
function homePlaylists() {
  const out = [];
  if (DL.done.size) out.push({ title: 'Скачанные', meta: `${DL.done.size} ${plural(DL.done.size, 'трек', 'трека', 'треков')} без интернета`, icon: 'i-download', open: () => openView('albums', 'downloads') });
  for (const a of state.albums) out.push({ title: a.title, meta: `${a.count} ${plural(a.count, 'трек', 'трека', 'треков')}, свой альбом`, cover: a.cover, icon: 'i-list', open: () => openView('albums', a.id) });
  for (const src of HOME_SERVICES) {
    if (!serviceReady(src)) continue;
    for (const c of (state.collections[src] || []).slice(0, 8)) {
      out.push({ title: c.title, meta: NAMES[src], cover: c.cover, icon: c.id === 'likes' ? 'i-heart' : 'i-list', open: () => openView(src, c.id) });
    }
  }
  return out;
}

function tileHtml(t, i) {
  const cover = t.cover ? `<img src="${esc(t.cover)}" alt="" loading="lazy">` : `<i>${esc((t.title || '?').trim()[0]?.toUpperCase() || '♪')}</i>`;
  return `<button class="h-tile" data-tile="${i}"><span class="h-tile-pic">${cover}<svg><use href="#i-play"/></svg></span>
    <span class="h-tile-text"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span></button>`;
}

function renderHome() {
  let box = $('#home');
  if (!box) {
    box = document.createElement('section');
    box.id = 'home';
    box.className = 'home';
    $('#tracklist').before(box);
  }
  box.hidden = false;
  $('#content').classList.add('home-on');
  $('#tracklist').hidden = true;
  $('#empty').hidden = true;
  state.shown = [];

  const ym = waveMode() === 'ym';
  const cfg = waveCfg();
  const moodWord = { active: 'бодрое', fun: 'весёлое', calm: 'спокойное', sad: 'грустное' }[cfg.mood];
  const divWord = { favorite: 'из любимого', discover: 'незнакомое', popular: 'популярное' }[cfg.diversity];
  const waveNote = [ym && moodWord, divWord].filter(Boolean).join(', ') || (ym ? 'Из твоей Яндекс Музыки' : 'Из того, что ты слушаешь');
  const tracks = topTracks();
  const artists = topArtists();
  const lists = homePlaylists();
  const friends = (Friends.data?.friends || []).filter((f) => f.now?.playing).slice(0, 6);

  box.innerHTML = `
    <header class="h-hello">
      <h1>${esc(homeGreeting())}</h1>
      <p>${esc(homeLine())}</p>
    </header>

    <div class="h-wave" id="h-wave" role="link" tabindex="0" aria-label="Открыть волну">
      <canvas id="h-wave-air" aria-hidden="true"></canvas>
      <button class="h-wave-go" id="h-wave-go" aria-label="${Wave.active ? 'Волна играет' : 'Включить волну'}"><svg><use href="#${Wave.active && !audio.paused ? 'i-pause' : 'i-play'}"/></svg></button>
      <div class="h-wave-text"><b>${ym ? 'Моя волна' : 'Своя волна'}</b><span>${esc(waveNote)}${cfg.dj ? ', с диджеем' : ''}</span></div>
    </div>

    ${[11, 0].includes(new Date().getMonth()) && tracks.length ? `<button class="h-wrapped" id="h-wrapped"><b>Итоги ${wrappedYear()}</b><span>Сколько музыки, любимые треки и кто ты как слушатель</span></button>` : ''}

    ${tracks.length ? `<section class="h-sec"><div class="h-head"><h2>Часто слушаешь</h2></div>
      <div class="h-tiles">${tracks.map(tileHtml).join('')}</div></section>` : ''}

    ${lists.length ? `<section class="h-sec"><div class="h-head"><h2>Твои плейлисты</h2><button class="h-more" data-go="albums">все альбомы</button></div>
      <div class="h-row">${lists.map((l, i) => `<button class="h-card" data-list="${i}">
        <span class="h-card-pic">${l.cover ? `<img src="${esc(l.cover)}" alt="" loading="lazy">` : `<svg><use href="#${l.icon}"/></svg>`}</span>
        <b>${esc(l.title)}</b><small>${esc(l.meta)}</small></button>`).join('')}</div></section>` : ''}

    ${artists.length ? `<section class="h-sec"><div class="h-head"><h2>Твои артисты</h2><button class="h-more" data-go="artists">все артисты</button></div>
      <div class="h-row">${artists.map((a, i) => `<button class="h-artist" data-artist-i="${i}">
        <span class="h-artist-pic">${a.cover ? `<img src="${esc(a.cover)}" alt="" loading="lazy">` : `<i>${esc(a.name.trim()[0]?.toUpperCase() || '?')}</i>`}</span>
        <b>${esc(a.name)}</b></button>`).join('')}</div></section>` : ''}

    ${friends.length ? `<section class="h-sec"><div class="h-head"><h2>Друзья сейчас слушают</h2></div>
      <div class="h-row">${friends.map((f, i) => `<button class="h-friend" data-friend-i="${i}">
        <span class="h-friend-pic">${f.now.track.cover ? `<img src="${esc(f.now.track.cover)}" alt="" loading="lazy">` : ''}</span>
        <span class="h-friend-text"><b>${esc(f.name)}</b><small>${esc(f.now.track.title)}${f.now.track.artist ? ` — ${esc(f.now.track.artist)}` : ''}</small></span></button>`).join('')}</div></section>` : ''}

    ${!tracks.length && !artists.length ? `<p class="h-empty">Послушай что-нибудь — здесь появятся любимые треки и артисты. Или просто включи волну.</p>` : ''}`;

  // --- действия ---
  box.querySelectorAll('[data-tile]').forEach((b) => { b.onclick = () => playFrom(tracks, +b.dataset.tile); });
  box.querySelectorAll('[data-list]').forEach((b) => { b.onclick = () => lists[+b.dataset.list].open(); });
  box.querySelectorAll('[data-artist-i]').forEach((b) => { b.onclick = () => openArtist(artists[+b.dataset.artistI].name); });
  box.querySelectorAll('[data-friend-i]').forEach((b) => { b.onclick = () => openFriendProfile(friends[+b.dataset.friendI].id); });
  $('#h-wrapped')?.addEventListener('click', openWrapped); // wrapped.js
  box.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => openView(b.dataset.go); });
  const card = $('#h-wave');
  card.onclick = (e) => { if (!e.target.closest('#h-wave-go')) openView('wave'); };
  card.onkeydown = (e) => { if (e.key === 'Enter') openView('wave'); };
  $('#h-wave-go').onclick = () => {
    if (Wave.active) togglePlay();
    else waveStart();
    openView('wave');
  };
  box.querySelectorAll('.h-row').forEach((row) => {
    row.addEventListener('wheel', (e) => {
      if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    }, { passive: false });
  });

  // плейлисты сервисов подгружаются в фоне — появятся, как придут
  for (const src of HOME_SERVICES) {
    if (serviceReady(src) && !state.collections[src]) loadCollections(src).then(() => { if (state.view === 'home') renderHome(); });
  }
}

function leaveHome() {
  const box = $('#home');
  if (box) box.hidden = true;
  $('#content').classList.remove('home-on');
}

// Эфир на баннере волны — те же тонкие линии, что на странице волны, только тише
let homePhase = 0;
function drawHomeAir() {
  const c = $('#h-wave-air');
  if (c && !$('#home')?.hidden && !document.hidden) {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth * dpr, h = c.clientHeight * dpr;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    const still = document.documentElement.classList.contains('look-still') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) homePhase += Wave.active && !audio.paused ? 0.02 : 0.007;
    const amber = getComputedStyle(document.documentElement).getPropertyValue('--amber').trim() || '#f0a63a';
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.lineWidth = (k === 2 ? 2 : 1) * dpr;
      g.strokeStyle = amber;
      g.globalAlpha = k === 2 ? 0.8 : 0.22;
      const y0 = h * (0.25 + k * 0.125);
      for (let x = 0; x <= w; x += 5 * dpr) {
        const t = x / w;
        const y = y0 + Math.sin(t * Math.PI * (1.8 + k * 0.4) + homePhase * (1 + k * 0.2) + k) * h * 0.06 * (0.4 + t);
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  requestAnimationFrame(drawHomeAir);
}
requestAnimationFrame(drawHomeAir);
