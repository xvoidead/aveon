'use strict';

// ---------- админка ----------
// Только для логинов из AVEON_ADMINS на сервере (server/aveon_api/admin.py). Кнопка — в профиле.
// Обзор (кто онлайн и что слушает, румы, цифры), пользователи (поиск, выкинуть, заблокировать,
// сменить имя) и объявление, которое увидят все.
// Здесь же — показ объявления у всех: баннер сверху, один раз на объявление.

const ADM = { tab: 'overview', overview: null, users: null, q: '', error: '', loading: false, timer: null };
let adminEl = null;

function admAgo(sec) {
  return sec ? syncedAgo(sec * 1000) : 'никогда'; // app.js
}

function admBytes(n) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.round(n / 1024)} КБ`;
}

function admOverviewHtml() {
  const o = ADM.overview;
  if (!o) return ADM.error ? `<p class="together-note warn">${esc(ADM.error)}</p>` : '<div class="spinner small"></div>';
  const u = o.users, s = o.stats;
  const num = (v, t) => `<div><b>${v}</b><small>${esc(t)}</small></div>`;
  return `
    <div class="adm-nums">
      ${num(u.total, 'пользователей')}${num(`+${u.today}`, 'за сутки')}${num(`+${u.week}`, 'за неделю')}
      ${num(u.active_day, 'заходили сегодня')}${num(u.active_week, 'за неделю')}${num(o.online.length, 'слушают сейчас')}
      ${num(s.friendships, 'дружб')}${num(s.messages, 'сообщений')}${num(`+${s.messages_day}`, 'сообщений за сутки')}
      ${num(o.rooms.length, 'рум')}${num(s.sessions, 'сессий')}${num(admBytes(o.db_size), 'база')}
    </div>
    <h3 class="fr-sub">Слушают сейчас <span>${o.online.length}</span></h3>
    ${o.online.length ? `<ul class="adm-list">${o.online.map((x) => `<li>
      <b>${esc(x.name)}</b><small>@${esc(x.login)}</small>
      <span class="adm-track">${x.playing ? '▶' : '❚❚'} ${esc(x.title)}${x.artist ? ` — ${esc(x.artist)}` : ''}</span></li>`).join('')}</ul>`
      : '<p class="together-desc">Никто</p>'}
    <h3 class="fr-sub">Румы <span>${o.rooms.length}</span></h3>
    ${o.rooms.length ? `<ul class="adm-list">${o.rooms.map((r) => `<li>
      <b>${esc(r.code)}</b><small>${r.members.map(esc).join(', ')}</small>
      <span class="adm-track">${r.track ? `♪ ${esc(r.track)}` : 'ничего не играет'}</span></li>`).join('')}</ul>`
      : '<p class="together-desc">Ни одной</p>'}
    <p class="together-note">${u.banned ? `Заблокировано: ${u.banned} · ` : ''}обновлено ${esc(new Date(o.now * 1000).toLocaleTimeString('ru'))}</p>`;
}

function admUsersHtml() {
  const list = ADM.users;
  const body = !list ? (ADM.error ? `<p class="together-note warn">${esc(ADM.error)}</p>` : '<div class="spinner small"></div>')
    : !list.length ? '<p class="together-desc">Никого не нашлось</p>'
    : `<ul class="adm-list adm-users">${list.map((x) => `<li class="${x.banned ? 'banned' : ''}">
      <div class="adm-user-main"><b>${esc(x.name)}${x.admin ? ' <em class="fr-tag">админ</em>' : ''}${x.banned ? ' <em class="fr-tag adm-ban-tag">заблокирован</em>' : ''}</b>
        <small>@${esc(x.login)} · id ${x.id} · с ${esc(new Date(x.created * 1000).toLocaleDateString('ru'))} · был ${esc(admAgo(x.last_seen))} · сессий ${x.sessions} · друзей ${x.friends}</small></div>
      <button class="icon-btn small" data-adm-more="${x.id}" aria-label="Действия" aria-haspopup="menu"><svg><use href="#i-more"/></svg></button>
    </li>`).join('')}</ul>`;
  return `<form class="together-join adm-search" id="adm-search" autocomplete="off">
      <input class="input" id="adm-q" placeholder="логин или имя" value="${esc(ADM.q)}" spellcheck="false">
      <button class="btn" type="submit">Найти</button></form>${body}`;
}

function admAnnounceHtml() {
  return `<p class="together-desc">Объявление увидят все, кто в аккаунте на этом сервере: баннер сверху окна, один раз. Новое объявление заменяет старое.</p>
    <textarea class="input adm-text" id="adm-text" maxlength="500" rows="4" placeholder="например: сервер перезапустится в 23:00"></textarea>
    <div class="row-actions">
      <button class="btn primary" id="adm-send">Отправить всем</button>
      <button class="btn" id="adm-clear">Убрать объявление</button>
    </div>`;
}

function renderAdmin() {
  if (!adminEl || adminEl.hidden) return;
  const tabs = [['overview', 'Обзор'], ['users', 'Пользователи'], ['announce', 'Объявление']];
  $('#adm-tabs', adminEl).innerHTML = tabs.map(([id, t]) => `<button class="${ADM.tab === id ? 'on' : ''}" data-adm-tab="${id}">${t}</button>`).join('');
  const body = $('#adm-body', adminEl);
  const typed = $('#adm-q', body)?.value;
  body.innerHTML = ADM.tab === 'overview' ? admOverviewHtml() : ADM.tab === 'users' ? admUsersHtml() : admAnnounceHtml();
  if (typed !== undefined && $('#adm-q', body)) $('#adm-q', body).value = typed;
  $$('[data-adm-tab]', adminEl).forEach((b) => { b.onclick = () => { ADM.tab = b.dataset.admTab; ADM.error = ''; renderAdmin(); loadAdmin(); }; });
  const search = $('#adm-search', body);
  if (search) search.onsubmit = (e) => { e.preventDefault(); ADM.q = $('#adm-q', body).value.trim(); ADM.users = null; renderAdmin(); loadAdmin(); };
  $$('[data-adm-more]', body).forEach((b) => { b.onclick = () => admUserMenu(+b.dataset.admMore, b); });
  const send = $('#adm-send', body);
  if (send) send.onclick = async () => {
    const text = $('#adm-text', body).value.trim();
    if (!text) { $('#adm-text', body).focus(); return; }
    try { await api.admin.announce(text); toast('Объявление отправлено'); $('#adm-text', body).value = ''; } catch (e) { toast(e.message, 'err'); }
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
    { label: `Скопировать @${x.login}`, icon: 'i-copy', onClick: () => copyText(`@${x.login}`) },
    { label: 'Сменить имя', icon: 'i-pencil', onClick: async () => {
      const name = await ask({ title: `Имя для @${x.login}`, value: x.name, ok: 'Сохранить' });
      if (name && name !== x.name) run(() => api.admin.rename(x.id, name), 'Имя изменено');
    } },
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
    if (ADM.tab === 'overview') ADM.overview = await api.admin.overview();
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
        <button class="icon-btn" id="adm-close" aria-label="Закрыть"><svg><use href="#i-close"/></svg></button></div>
      <nav class="adm-tabs" id="adm-tabs"></nav>
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
  ADM.timer = setInterval(() => { if (ADM.tab === 'overview') loadAdmin(); }, 10000); // обзор живой
}

function closeAdmin() {
  if (adminEl) adminEl.hidden = true;
  clearInterval(ADM.timer);
}

// ---------- объявление для всех ----------

const ANNOUNCE_EVERY = 5 * 60 * 1000;

function seenAnnounce() {
  try { return localStorage.getItem('aveon.announce') || ''; } catch { return ''; }
}

function showAnnounce(a) {
  if (!a?.text || String(a.id) === seenAnnounce()) return;
  $('#announce')?.remove();
  const el = document.createElement('div');
  el.id = 'announce';
  el.className = 'announce';
  el.innerHTML = `<svg><use href="#i-shield"/></svg><span>${esc(a.text)}</span><button class="icon-btn small" aria-label="Закрыть"><svg><use href="#i-close"/></svg></button>`;
  el.querySelector('button').onclick = () => {
    try { localStorage.setItem('aveon.announce', String(a.id)); } catch {}
    el.remove();
  };
  document.body.append(el);
}

async function checkAnnounce() {
  if (!state.account.loggedIn) return;
  try { showAnnounce(await api.announcement()); } catch {}
}

setInterval(checkAnnounce, ANNOUNCE_EVERY);
setTimeout(checkAnnounce, 5000);
