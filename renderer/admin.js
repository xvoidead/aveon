'use strict';

// ---------- админка ----------
// Только для логинов из AVEON_ADMINS на сервере (server/aveon_api/admin.py). Кнопка — в профиле.
// Пульт: эфир (кто что слушает, с бегущими полосками), румы с «зайти», графики за 30 дней,
// рейтинг месяца и общий топ сервера. Пользователи: поиск, имя, выкинуть, блок, личное уведомление.
// Объявление всем — можно с «треком дня» (у всех кнопка ▶).
// Здесь же — показ объявлений и личных уведомлений у всех: баннер сверху, один раз.

const ADM = { tab: 'overview', overview: null, fetchedAt: 0, users: null, q: '', error: '', loading: false, timer: null, tick: null, dayTrack: false };
let adminEl = null;
const admAvatars = new Map(); // `${id}:${at}` → data:… | ''

function admAgo(sec) {
  return sec ? syncedAgo(sec * 1000) : 'никогда'; // app.js
}

function admBytes(n) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.round(n / 1024)} КБ`;
}

function admHours(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`;
}

function admUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
}

// аватарка: грузим через тот же канал, что у друзей (src/account.js avatarOf), с кэшем
function admFace(p, cls = 'adm-face') {
  const key = `${p.id}:${p.avatar}`;
  if (p.avatar && !admAvatars.has(key)) {
    admAvatars.set(key, '');
    api.friends.avatar(p.id, p.avatar).then((u) => { admAvatars.set(key, u || ''); if (u) renderAdmin(); }).catch(() => {});
  }
  const url = admAvatars.get(key) || '';
  const letter = esc(String(p.name || p.login || '?').trim()[0]?.toUpperCase() || '?');
  return `<span class="${cls}${url ? ' pic' : ''}" title="${esc(p.name || '')}">${url ? `<img src="${esc(url)}" alt="">` : letter}</span>`;
}

function admCover(t, cls = 'adm-cover') {
  return `<span class="${cls}">${t?.cover && /^https?:/i.test(t.cover) ? `<img src="${esc(t.cover)}" alt="">` : '♪'}</span>`;
}

// столбики за 30 дней: последний — сегодня
function admBars(values, label) {
  const max = Math.max(1, ...values);
  const day = (i) => new Date(Date.now() - (values.length - 1 - i) * 86400000).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
  return `<div class="adm-chart">
    <div class="adm-chart-head"><b>${values.reduce((a, b) => a + b, 0)}</b><small>${emo(label)} за 30 дней</small></div>
    <div class="adm-bars">${values.map((v, i) => `<i style="--h:${Math.max(3, (v / max) * 100)}%" class="${v ? '' : 'zero'}" title="${esc(day(i))}: ${v}"></i>`).join('')}</div>
  </div>`;
}

// где сейчас трек у слушателя: позиция на момент at плюс сколько прошло
function admPos(x) {
  const o = ADM.overview;
  let pos = x.pos || 0;
  if (x.playing) pos += (o.now_ms - x.at) / 1000 + (performance.now() - ADM.fetchedAt) / 1000;
  return x.track?.duration ? Math.min(pos, x.track.duration) : pos;
}

function admOverviewHtml() {
  const o = ADM.overview;
  if (!o) return ADM.error ? `<p class="together-note warn">${emo(ADM.error)}</p>` : '<div class="spinner small"></div>';
  const u = o.users, s = o.stats, top = o.top || { tracks: [], artists: [], leaders: [], total: 0 };
  const kpi = (big, label, sub = '', cls = '') => `<div class="adm-kpi ${cls}"><b>${big}</b><span>${emo(label)}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const live = o.online.filter((x) => x.playing);
  const maxArtist = Math.max(1, ...top.artists.map((a) => a.sec));
  const medal = ['🥇', '🥈', '🥉'];
  const maxLeader = Math.max(1, ...top.leaders.map((l) => l.sec));
  return `
    <div class="adm-kpis">
      ${kpi(u.total, 'пользователей', `+${u.today} сегодня · +${u.week} за неделю`)}
      ${kpi(`<i class="adm-dot"></i>${live.length}`, 'слушают сейчас', `${o.online.length} в сети`, 'live')}
      ${kpi(u.active_day, 'заходили сегодня', `${u.active_week} за неделю`)}
      ${kpi(s.messages, 'сообщений', `+${s.messages_day} за сутки`)}
      ${kpi(s.friendships, 'дружб', `${s.requests} заявок ждут`)}
      ${kpi(admHours(top.total), 'наслушано всеми', `база ${admBytes(o.db_size)}`)}
    </div>

    <h3 class="adm-h">В эфире <span>${o.online.length}</span></h3>
    ${o.online.length ? `<div class="adm-air">${o.online.map((x, i) => `
      <div class="adm-air-card${x.playing ? ' playing' : ''}">
        <div class="adm-air-art">${admCover(x.track, 'adm-air-cover')}${admFace(x, 'adm-face adm-air-face')}</div>
        <div class="adm-air-text">
          <small>${emo(x.name)} · ${x.playing ? 'слушает' : 'на паузе'}</small>
          <b>${emo(x.track?.title || '')}</b>
          <span>${emo(x.track?.artist || '')}</span>
          ${x.track?.duration ? `<span class="fr-bar"><i data-adm-bar="${i}" style="width:${Math.min(100, (admPos(x) / x.track.duration) * 100).toFixed(1)}%"></i></span>` : ''}
        </div>
        <button class="icon-btn small" data-adm-air="${i}" title="Включить у себя"><svg><use href="#i-play"/></svg></button>
      </div>`).join('')}</div>` : '<p class="together-desc">Тишина — никто ничего не слушает</p>'}

    ${o.rooms.length ? `<h3 class="adm-h">Румы <span>${o.rooms.length}</span></h3>
      <div class="adm-rooms">${o.rooms.map((r) => `<div class="adm-room">
        <div class="adm-room-faces">${r.members.slice(0, 5).map((m) => admFace(m)).join('')}</div>
        <div class="adm-room-text"><b>${emo(r.code)}</b><small>${r.track ? `${r.playing ? '▶' : '❚❚'} ${esc(r.track.title || '')}` : 'ничего не играет'} · ${r.members.length} ${plural(r.members.length, 'человек', 'человека', 'человек')}</small></div>
        <button class="btn fr-btn" data-adm-join="${esc(r.code)}"${Together.room?.code === r.code ? ' disabled' : ''}>${Together.room?.code === r.code ? 'Ты здесь' : 'Зайти'}</button>
      </div>`).join('')}</div>` : ''}

    <div class="adm-charts">
      ${admBars(o.series?.users || [], 'регистраций')}
      ${admBars(o.series?.messages || [], 'сообщений')}
    </div>

    <div class="adm-cols">
      <div>
        <h3 class="adm-h">Слушатели месяца</h3>
        ${top.leaders.length ? `<ol class="adm-leaders">${top.leaders.map((l, i) => `<li>
          <span class="adm-place">${medal[i] || i + 1}</span>${admFace(l)}
          <span class="adm-leader-text"><b>${emo(l.name)}</b><span class="adm-leader-bar"><i style="width:${((l.sec / maxLeader) * 100).toFixed(1)}%"></i></span></span>
          <small>${emo(admHours(l.sec))}</small></li>`).join('')}</ol>` : '<p class="together-desc">Пока пусто</p>'}
      </div>
      <div>
        <h3 class="adm-h">Топ сервера</h3>
        ${top.tracks.length ? `<div class="adm-top">${top.tracks.map((x, i) => `<button class="fr-track" data-adm-top="${i}" title="Включить у себя">
          <span class="adm-rank">${i + 1}</span>${admCover(x.track, 'fr-track-cover')}
          <span class="fr-track-text"><b>${emo(x.track.title)}</b><small>${emo(x.track.artist || '')} · ${x.users} ${plural(x.users, 'слушатель', 'слушателя', 'слушателей')} · ${esc(admHours(x.sec))}</small></span>
          <svg><use href="#i-play"/></svg></button>`).join('')}</div>` : '<p class="together-desc">Пока пусто</p>'}
      </div>
    </div>

    ${top.artists.length ? `<h3 class="adm-h">Артисты сервера</h3>
      <div class="adm-cloud">${top.artists.map((a) => `<span style="--w:${(0.35 + 0.65 * (a.sec / maxArtist)).toFixed(2)}" title="${esc(admHours(a.sec))}">${emo(a.name)}</span>`).join('')}</div>` : ''}

    <p class="together-note adm-foot">сервер работает ${esc(admUptime(o.uptime || 0))} · сессий ${s.sessions} · поделились ${s.shares} раз${u.banned ? ` · заблокировано ${u.banned}` : ''} · обновлено ${esc(new Date(o.now * 1000).toLocaleTimeString('ru'))}</p>`;
}

function admUsersHtml() {
  const list = ADM.users;
  const body = !list ? (ADM.error ? `<p class="together-note warn">${emo(ADM.error)}</p>` : '<div class="spinner small"></div>')
    : !list.length ? '<p class="together-desc">Никого не нашлось</p>'
    : `<ul class="adm-list adm-users">${list.map((x) => `<li class="${x.banned ? 'banned' : ''}">
      ${admFace({ id: x.id, avatar: x.avatar_at, name: x.name })}
      <div class="adm-user-main"><b>${emo(x.name)}${x.admin ? ' <em class="fr-tag">админ</em>' : ''}${x.banned ? ' <em class="fr-tag adm-ban-tag">заблокирован</em>' : ''}</b>
        <small>@${esc(x.login)} · с ${esc(new Date(x.created * 1000).toLocaleDateString('ru'))} · был ${esc(admAgo(x.last_seen))} · ${x.sessions} ${plural(x.sessions, 'сессия', 'сессии', 'сессий')} · ${x.friends} ${plural(x.friends, 'друг', 'друга', 'друзей')}</small></div>
      <button class="icon-btn small" data-adm-more="${x.id}" aria-label="Действия" aria-haspopup="menu"><svg><use href="#i-more"/></svg></button>
    </li>`).join('')}</ul>`;
  return `<form class="together-join adm-search" id="adm-search" autocomplete="off">
      <input class="input" id="adm-q" placeholder="логин или имя" value="${esc(ADM.q)}" spellcheck="false">
      <button class="btn" type="submit">Найти</button></form>${body}`;
}

function admAnnounceHtml() {
  const t = state.track;
  return `<p class="together-desc">Объявление увидят все, кто в аккаунте на этом сервере: баннер сверху окна, один раз. Новое заменяет старое.</p>
    <textarea class="input adm-text" id="adm-text" maxlength="500" rows="4" placeholder="например: сервер перезапустится в 23:00"></textarea>
    <label class="adm-daytrack${t ? '' : ' off'}">
      <input type="checkbox" id="adm-track"${t ? '' : ' disabled'}${ADM.dayTrack && t ? ' checked' : ''}>
      ${t ? `${admCover(t, 'fr-track-cover')}<span><b>Трек дня</b><small>«${esc(t.title)}» — у всех в баннере кнопка ▶</small></span>`
    : '<span><b>Трек дня</b><small>включи трек, чтобы прикрепить его к объявлению</small></span>'}
    </label>
    <div class="row-actions">
      <button class="btn primary" id="adm-send">Отправить всем</button>
      <button class="btn" id="adm-clear">Убрать объявление</button>
    </div>`;
}

function renderAdmin() {
  if (!adminEl || adminEl.hidden) return;
  const tabs = [['overview', 'Пульт'], ['users', 'Пользователи'], ['announce', 'Объявление']];
  $('#adm-tabs', adminEl).innerHTML = tabs.map(([id, t]) => `<button class="${ADM.tab === id ? 'on' : ''}" data-adm-tab="${id}">${t}</button>`).join('');
  const body = $('#adm-body', adminEl);
  const scroll = body.scrollTop;
  const typed = $('#adm-q', body)?.value;
  const text = $('#adm-text', body)?.value;
  body.innerHTML = ADM.tab === 'overview' ? admOverviewHtml() : ADM.tab === 'users' ? admUsersHtml() : admAnnounceHtml();
  body.scrollTop = scroll;
  if (typed !== undefined && $('#adm-q', body)) $('#adm-q', body).value = typed;
  if (text !== undefined && $('#adm-text', body)) $('#adm-text', body).value = text;
  $$('[data-adm-tab]', adminEl).forEach((b) => { b.onclick = () => { ADM.tab = b.dataset.admTab; ADM.error = ''; renderAdmin(); loadAdmin(); }; });
  bindAdmin(body);
}

function bindAdmin(body) {
  const o = ADM.overview;
  $$('[data-adm-air]', body).forEach((b) => {
    b.onclick = () => { const x = o?.online[+b.dataset.admAir]; if (x?.track) { playShared(x.track, x.playing ? admPos(x) : 0); toast(`Слушаешь с ${firstName(x.name)}`); } };
  });
  $$('[data-adm-top]', body).forEach((b) => {
    b.onclick = () => { const x = o?.top.tracks[+b.dataset.admTop]; if (x) { playShared(x.track); toast(`Включаю «${x.track.title}»`); } };
  });
  $$('[data-adm-join]', body).forEach((b) => {
    b.onclick = async () => { await enterRoom(() => api.together.join(b.dataset.admJoin)); renderAdmin(); }; // together.js
  });
  const search = $('#adm-search', body);
  if (search) search.onsubmit = (e) => { e.preventDefault(); ADM.q = $('#adm-q', body).value.trim(); ADM.users = null; renderAdmin(); loadAdmin(); };
  $$('[data-adm-more]', body).forEach((b) => { b.onclick = () => admUserMenu(+b.dataset.admMore, b); });
  const track = $('#adm-track', body);
  if (track) track.onchange = () => { ADM.dayTrack = track.checked; };
  const send = $('#adm-send', body);
  if (send) send.onclick = async () => {
    const text = $('#adm-text', body).value.trim();
    if (!text) { $('#adm-text', body).focus(); return; }
    const t = ADM.dayTrack && state.track ? shareable(state.track) : null; // together.js
    try {
      await api.admin.announce(text, t);
      toast(t ? 'Объявление с треком дня отправлено' : 'Объявление отправлено');
      $('#adm-text', body).value = '';
    } catch (e) { toast(e.message, 'err'); }
  };
  const clear = $('#adm-clear', body);
  if (clear) clear.onclick = async () => {
    try { await api.admin.announce(''); toast('Объявление убрано'); } catch (e) { toast(e.message, 'err'); }
  };
}

function admUserMenu(id, anchor) {
  const x = ADM.users?.find((u) => u.id === id);
  if (!x) return;
  const run = async (fn, ok) => {
    try { await fn(); toast(ok); ADM.users = null; renderAdmin(); loadAdmin(); } catch (e) { toast(e.message, 'err'); }
  };
  showMenu([
    { note: `@${x.login} · id ${x.id}` },
    { label: 'Личное уведомление', icon: 'i-chat', onClick: async () => {
      const text = await ask({ title: `Уведомление для ${x.name}`, text: 'Увидит баннером сверху окна, один раз.', ok: 'Отправить' });
      if (text) run(() => api.admin.notify(x.id, text), 'Уведомление отправлено');
    } },
    { label: 'Сменить имя', icon: 'i-pencil', onClick: async () => {
      const name = await ask({ title: `Имя для @${x.login}`, value: x.name, ok: 'Сохранить' });
      if (name && name !== x.name) run(() => api.admin.rename(x.id, name), 'Имя изменено');
    } },
    { label: `Скопировать @${x.login}`, icon: 'i-copy', onClick: () => copyText(`@${x.login}`) },
    { label: 'Выкинуть со всех устройств', icon: 'i-device', onClick: () => run(() => api.admin.kick(x.id), `@${x.login} вышел отовсюду`) },
    { sep: true },
    x.banned
      ? { label: 'Разблокировать', icon: 'i-shield', onClick: () => run(() => api.admin.ban(x.id, false), `@${x.login} разблокирован`) }
      : { label: 'Заблокировать', icon: 'i-shield', danger: true, onClick: async () => {
        const ok = await ask({ title: `Заблокировать @${x.login}?`, text: 'Выйдет со всех устройств и не сможет войти, пока не разблокируешь.', ok: 'Заблокировать', danger: true, input: false });
        if (ok) run(() => api.admin.ban(x.id, true), `@${x.login} заблокирован`);
      } },
  ], { anchor });
}

async function loadAdmin() {
  if (ADM.loading) return;
  ADM.loading = true;
  try {
    if (ADM.tab === 'overview') { ADM.overview = await api.admin.overview(); ADM.fetchedAt = performance.now(); }
    else if (ADM.tab === 'users') ADM.users = (await api.admin.users(ADM.q)).users;
    ADM.error = '';
  } catch (e) {
    ADM.error = e.message;
  }
  ADM.loading = false;
  renderAdmin();
}

function openAdmin() {
  if (!state.account.admin) return;
  if (!adminEl) {
    adminEl = document.createElement('div');
    adminEl.className = 'modal';
    adminEl.id = 'admin';
    adminEl.hidden = true;
    adminEl.innerHTML = `<div class="sheet adm-sheet" role="dialog" aria-labelledby="adm-title">
      <div class="sheet-head"><h2 id="adm-title">Админка</h2>
        <nav class="adm-tabs" id="adm-tabs"></nav>
        <button class="icon-btn" id="adm-close" aria-label="Закрыть"><svg><use href="#i-close"/></svg></button></div>
      <div class="sheet-body adm-body" id="adm-body"></div></div>`;
    document.body.append(adminEl);
    $('#adm-close', adminEl).onclick = closeAdmin;
    adminEl.addEventListener('pointerdown', (e) => { if (e.target === adminEl) closeAdmin(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !adminEl.hidden && $('#menu').hidden && $('#dialog').hidden) { e.stopPropagation(); closeAdmin(); }
    }, true);
  }
  adminEl.hidden = false;
  renderAdmin();
  loadAdmin();
  clearInterval(ADM.timer);
  clearInterval(ADM.tick);
  ADM.timer = setInterval(() => { if (ADM.tab === 'overview' && !document.hidden) loadAdmin(); }, 10000); // пульт живой
  // полоски в эфире бегут сами, между опросами
  ADM.tick = setInterval(() => {
    if (ADM.tab !== 'overview' || !ADM.overview) return;
    for (const el of $$('[data-adm-bar]', adminEl)) {
      const x = ADM.overview.online[+el.dataset.admBar];
      if (x?.playing && x.track?.duration) el.style.width = `${Math.min(100, (admPos(x) / x.track.duration) * 100).toFixed(1)}%`;
    }
  }, 1000);
}

function closeAdmin() {
  if (adminEl) adminEl.hidden = true;
  clearInterval(ADM.timer);
  clearInterval(ADM.tick);
}

// ---------- объявление и личное уведомление — у всех ----------

const ANNOUNCE_EVERY = 3 * 60 * 1000;

function seenKey(kind) { return `aveon.${kind}`; }
function seen(kind) {
  try { return localStorage.getItem(seenKey(kind)) || ''; } catch { return ''; }
}

function showBanner(kind, a) {
  if (!a?.text || String(a.id) === seen(kind)) return;
  if ($(`#banner-${kind}`)?.dataset.id !== String(a.id)) { // новое — сказать и в острове (баннер не видно, пока плеер свёрнут)
    islandNotify(kind === 'notice' ? `${a.by ? `${a.by}: ` : ''}${a.text}` : a.track?.title ? `Трек дня: «${a.track.title}» — ${a.text}` : a.text, 'admin',
      null, a.track?.title ? [{ label: '▶ Включить', primary: true, do: 'play', arg: a.track }] : []);
  }
  $(`#banner-${kind}`)?.remove();
  const el = document.createElement('div');
  el.id = `banner-${kind}`;
  el.dataset.id = String(a.id);
  el.className = `announce${kind === 'notice' ? ' notice' : ''}`;
  const t = a.track;
  el.innerHTML = `<svg><use href="#i-${kind === 'notice' ? 'chat' : 'shield'}"/></svg>
    <span>${kind === 'notice' && a.by ? `<b>${emo(a.by)}:</b> ` : ''}${emo(a.text)}</span>
    ${t?.title ? `<button class="announce-track" title="Включить">${admCover(t, 'fr-track-cover')}<span><b>${emo(t.title)}</b><small>${emo(t.artist || '')}</small></span><svg><use href="#i-play"/></svg></button>` : ''}
    <button class="icon-btn small announce-close" aria-label="Закрыть"><svg><use href="#i-close"/></svg></button>`;
  el.querySelector('.announce-close').onclick = () => {
    try { localStorage.setItem(seenKey(kind), String(a.id)); } catch {}
    el.remove();
  };
  const play = el.querySelector('.announce-track');
  if (play) play.onclick = () => { playShared(t); toast(`Трек дня: «${t.title}»`); }; // friends.js
  // личное — ниже общего, если оба
  if (kind === 'notice' && $('#banner-announce')) el.style.top = '104px';
  document.body.append(el);
}

async function checkAnnounce() {
  if (!state.account.loggedIn) return;
  let r = null;
  try { r = await api.announcement(); } catch {}
  if (!r) return;
  showBanner('announce', r.announce);
  showBanner('notice', r.notice);
}

setInterval(checkAnnounce, ANNOUNCE_EVERY);
setTimeout(checkAnnounce, 5000);
