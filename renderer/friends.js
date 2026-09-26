'use strict';

// ---------- друзья ----------
// Друзья по логину и что они слушают (server/aveon_api/friends.py). Свой трек окно отправляет
// в главный процесс (src/friends.js), тот — на сервер. Список друзей обновляется сам: чаще, пока
// панель открыта. Трек друга можно включить у себя — с начала или с того же места, где сейчас он.

const FR_POLL_OPEN = 10 * 1000;
const FR_POLL_CLOSED = 60 * 1000;

const Friends = {
  data: null,        // ответ /api/friends
  fetchedAt: 0,      // performance.now() в момент ответа — чтобы позиция друга «шла» между опросами
  error: '',
  loading: false,
  seenIncoming: null, // id заявок, о которых уже сказали
  busy: new Set(),   // id, по которым сейчас идёт запрос
};

const friendsEl = $('#friends');
const friendsBtn = $('#open-friends');

// ---- свой трек → друзьям ----

let frNowTimer = null;

function sendNow() {
  clearTimeout(frNowTimer);
  frNowTimer = null;
  if (!state.account.loggedIn) return;
  const t = state.track;
  api.friends.now(t ? { track: shareable(t), playing: !audio.paused, pos: audio.currentTime || 0 } : null); // shareable — together.js
}

// смена трека даёт несколько событий подряд — отправляем одно
function queueNow() {
  clearTimeout(frNowTimer);
  frNowTimer = setTimeout(sendNow, 800);
}

for (const ev of ['play', 'pause', 'seeked', 'durationchange', 'ended']) onAudio(ev, queueNow);

// ---- список ----

const frAvatars = new Map(); // `${id}:${avatar}` → data:… или ''

function frAvatarHtml(p, live = false) {
  const url = frAvatars.get(`${p.id}:${p.avatar}`) || '';
  if (p.avatar && !frAvatars.has(`${p.id}:${p.avatar}`)) {
    frAvatars.set(`${p.id}:${p.avatar}`, '');
    api.friends.avatar(p.id, p.avatar).then((u) => {
      frAvatars.set(`${p.id}:${p.avatar}`, u || '');
      if (u) renderFriends();
    }).catch(() => {});
  }
  const letter = esc(firstName(p.name || p.login).slice(0, 1).toUpperCase()); // firstName — together.js
  return `<span class="together-avatar fr-avatar${url ? ' pic' : ''}">${url ? `<img src="${esc(url)}" alt="">` : letter}${live ? '<i class="fr-live"></i>' : ''}</span>`;
}

// Где сейчас друг в треке, с: сервер прислал позицию на момент at, с тех пор прошло время
function friendPos(n) {
  if (!n) return 0;
  let pos = n.pos;
  if (n.playing) pos += (Friends.data.now - n.at) / 1000 + (performance.now() - Friends.fetchedAt) / 1000;
  const dur = n.track.duration || 0;
  return dur ? Math.min(pos, dur) : pos;
}

// Когда это было по нашим часам: серверное время переводим через разницу в ответе
function friendAgo(n) {
  return syncedAgo(Date.now() - (Friends.data.now - n.at) - (performance.now() - Friends.fetchedAt));
}

function trackLine(t) {
  return `${t.title || 'без названия'}${t.artist ? ` — ${t.artist}` : ''}`;
}

function friendStatus(f) {
  const n = f.now;
  if (!n) return '<small class="fr-status">сейчас ничего не слушает</small>';
  if (n.playing) {
    const dur = n.track.duration || 0;
    const pct = dur ? Math.min(100, (friendPos(n) / dur) * 100) : 0;
    return `<small class="fr-status live"><svg><use href="#i-play"/></svg><span>${esc(trackLine(n.track))}</span></small>
      ${dur ? `<span class="fr-bar"><i data-fr-bar="${f.id}" style="width:${pct.toFixed(1)}%"></i></span>` : ''}`;
  }
  if (n.live) return `<small class="fr-status"><span>на паузе · ${esc(trackLine(n.track))}</span></small>`;
  return `<small class="fr-status"><span>${esc(trackLine(n.track))} · ${esc(friendAgo(n))}</span></small>`;
}

function friendItem(f) {
  const n = f.now;
  const canPlay = !!n?.track;
  return `<li class="fr-item">
    <button class="fr-main" data-fr-play="${f.id}" ${canPlay ? `title="Включить у себя: ${esc(trackLine(n.track))}"` : 'tabindex="-1"'}${canPlay ? '' : ' disabled'}>
      ${frAvatarHtml(f, !!n?.playing)}
      <span class="fr-text"><b>${esc(f.name)}</b>${friendStatus(f)}</span>
    </button>
    <button class="icon-btn small" data-fr-more="${f.id}" aria-label="Ещё" aria-haspopup="menu"><svg><use href="#i-more"/></svg></button>
  </li>`;
}

function requestItem(p, kind) {
  const busy = Friends.busy.has(p.id) ? ' disabled' : '';
  const actions = kind === 'in'
    ? `<button class="btn primary fr-btn" data-fr-accept="${p.id}"${busy}>Принять</button>
       <button class="icon-btn small" data-fr-remove="${p.id}" aria-label="Отклонить" title="Отклонить"${busy}><svg><use href="#i-close"/></svg></button>`
    : `<button class="icon-btn small" data-fr-remove="${p.id}" aria-label="Отозвать заявку" title="Отозвать заявку"${busy}><svg><use href="#i-close"/></svg></button>`;
  return `<li class="fr-item fr-request">
    <span class="fr-main static">${frAvatarHtml(p)}<span class="fr-text"><b>${esc(p.name)}</b><small class="fr-status">@${esc(p.login)}</small></span></span>
    ${actions}
  </li>`;
}

function renderFriendsBadge() {
  const n = Friends.data?.incoming.length || 0;
  $('#friends-badge').hidden = !n;
  friendsBtn.title = n ? `Друзья · ${n} ${plural(n, 'заявка', 'заявки', 'заявок')}` : 'Друзья';
}

function renderFriends() {
  renderFriendsBadge();
  if (friendsEl.hidden) return;
  const d = Friends.data;
  const login = state.account.login || '';
  const typed = $('#fr-login', friendsEl)?.value || '';
  const focused = document.activeElement?.id === 'fr-login';
  const scroll = $('.fr-scroll', friendsEl)?.scrollTop || 0;
  let body;
  if (!d) {
    body = Friends.error
      ? `<p class="together-note warn">${esc(Friends.error)}</p>`
      : '<div class="spinner small"></div>';
  } else {
    const listening = d.friends.filter((f) => f.now?.playing).length;
    body = `
      ${d.incoming.length ? `<h3 class="fr-sub">Хотят дружить <span>${d.incoming.length}</span></h3>
        <ul class="fr-list">${d.incoming.map((p) => requestItem(p, 'in')).join('')}</ul>` : ''}
      ${d.friends.length ? `<h3 class="fr-sub">${listening ? `Слушают сейчас <span>${listening} из ${d.friends.length}</span>` : `Все друзья <span>${d.friends.length}</span>`}</h3>
        <ul class="fr-list">${d.friends.map(friendItem).join('')}</ul>`
        : '<p class="together-desc fr-empty">Пока никого. Добавь друга по логину — здесь будет видно, кто что слушает, и любой трек можно включить у себя.</p>'}
      ${d.outgoing.length ? `<h3 class="fr-sub">Ждут ответа <span>${d.outgoing.length}</span></h3>
        <ul class="fr-list">${d.outgoing.map((p) => requestItem(p, 'out')).join('')}</ul>` : ''}
      ${Friends.error ? `<p class="together-note warn">${esc(Friends.error)}</p>` : ''}`;
  }
  const sharing = state.cfg.friends?.share !== false;
  friendsEl.innerHTML = `
    <h2 class="together-title">Друзья</h2>
    <form class="together-join" id="fr-add-form" autocomplete="off">
      <input class="input" id="fr-login" placeholder="логин друга" maxlength="33" spellcheck="false" aria-label="Логин друга">
      <button class="btn" type="submit">Добавить</button>
    </form>
    ${login ? `<button class="fr-mine" id="fr-copy-login" title="Скопировать"><span>твой логин <b>@${esc(login)}</b> — отправь его другу</span><svg><use href="#i-copy"/></svg></button>` : ''}
    <div class="fr-scroll">${body}</div>
    <div class="field fr-share"><label for="fr-share">Показывать друзьям, что я слушаю</label>
      <div class="ctl"><label class="switch"><input type="checkbox" id="fr-share" ${sharing ? 'checked' : ''}><span></span></label></div></div>`;
  const input = $('#fr-login', friendsEl);
  input.value = typed;
  if (focused) input.focus();
  $('.fr-scroll', friendsEl).scrollTop = scroll;
  bindFriends();
}

function bindFriends() {
  $('#fr-add-form', friendsEl).onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#fr-login', friendsEl);
    const login = input.value.trim();
    if (!login) { input.focus(); return; }
    const btn = $('#fr-add-form button', friendsEl);
    btn.disabled = true;
    try {
      const r = await api.friends.add(login);
      input.value = '';
      toast(r.status === 'friends' ? 'Теперь вы друзья' : `Заявка отправлена @${login.replace(/^@/, '').toLowerCase()}`);
      await loadFriends();
    } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false;
  };
  const copy = $('#fr-copy-login', friendsEl);
  if (copy) copy.onclick = async () => {
    const text = `@${state.account.login}`;
    if (await copyText(text)) toast('Логин скопирован'); else toast(`Твой логин: ${text}`); // share.js
  };
  $('#fr-share', friendsEl).onchange = async (e) => {
    await saveCfg({ friends: { share: e.target.checked } });
    toast(e.target.checked ? 'Друзья видят, что ты слушаешь' : 'Друзья больше не видят, что ты слушаешь');
    if (e.target.checked) sendNow();
  };
  $$('[data-fr-accept]', friendsEl).forEach((b) => { b.onclick = () => friendAction(+b.dataset.frAccept, 'accept'); });
  $$('[data-fr-remove]', friendsEl).forEach((b) => { b.onclick = () => friendAction(+b.dataset.frRemove, 'remove'); });
  $$('[data-fr-play]', friendsEl).forEach((b) => {
    b.onclick = () => {
      const f = friendById(+b.dataset.frPlay);
      if (f?.now) playFriend(f, !f.now.playing);
    };
  });
  $$('[data-fr-more]', friendsEl).forEach((b) => {
    b.onclick = () => (b.getAttribute('aria-expanded') === 'true' ? closeMenu() : friendMenu(friendById(+b.dataset.frMore), b));
  });
}

const friendById = (id) => Friends.data?.friends.find((f) => f.id === id) || null;

async function friendAction(id, action) {
  if (Friends.busy.has(id)) return;
  Friends.busy.add(id);
  renderFriends();
  try {
    if (action === 'accept') {
      await api.friends.accept(id);
      toast('Теперь вы друзья');
    } else {
      await api.friends.remove(id);
    }
  } catch (e) { toast(e.message, 'err'); }
  Friends.busy.delete(id);
  await loadFriends();
}

function friendMenu(f, anchor) {
  if (!f) return;
  const n = f.now;
  const items = [];
  if (n?.track) {
    if (n.playing) items.push({ label: 'Включить с того же места', icon: 'i-play', onClick: () => playFriend(f, false) });
    items.push({ label: n.playing ? 'Включить с начала' : `Включить «${n.track.title}»`, icon: n.playing ? 'i-prev' : 'i-play', onClick: () => playFriend(f, true) });
    items.push({ sep: true });
  }
  items.push({ label: `Скопировать @${f.login}`, icon: 'i-copy', onClick: async () => { if (await copyText(`@${f.login}`)) toast('Логин скопирован'); } });
  items.push({ sep: true });
  items.push({
    label: 'Удалить из друзей', icon: 'i-trash', danger: true,
    onClick: async () => {
      const ok = await ask({ title: `Удалить ${f.name} из друзей?`, text: 'Вы больше не будете видеть треки друг друга. Добавиться снова можно по логину.', ok: 'Удалить', danger: true, input: false });
      if (ok) friendAction(f.id, 'remove');
    },
  });
  showMenu(items, { anchor });
}

// Трек друга — у себя. Играет через свой сервис или найденный аналог, как в «Слушать вместе»
function playFriend(f, fromStart) {
  const n = f.now;
  if (!n?.track) return;
  const t = { ...n.track, shared: true };
  const at = fromStart ? 0 : friendPos(n);
  const t0 = performance.now();
  state.queue = [t];
  state.order = [0];
  state.pos = 0;
  // позицию считаем, когда поток уже готов: пока искали трек, друг ушёл дальше
  loadTrack(t, { startAt: at ? () => at + (performance.now() - t0) / 1000 : 0 });
  toast(fromStart ? `Включаю «${t.title}» с начала` : `Слушаешь с ${firstName(f.name)} с того же места`);
}

async function loadFriends() {
  if (!state.account.loggedIn || Friends.loading) return;
  Friends.loading = true;
  try {
    const d = await api.friends.list();
    const fresh = d.incoming.filter((p) => Friends.seenIncoming && !Friends.seenIncoming.has(p.id));
    Friends.seenIncoming = new Set(d.incoming.map((p) => p.id));
    for (const p of fresh) {
      toast(`${firstName(p.name)} (@${p.login}) хочет добавить тебя в друзья`);
      islandNotify(`${firstName(p.name)} хочет в друзья`, 'friend'); // island-feed.js
    }
    Friends.data = d;
    Friends.fetchedAt = performance.now();
    Friends.error = '';
  } catch (e) {
    Friends.error = e.message;
  }
  Friends.loading = false;
  renderFriends();
}

// опрос: чаще, пока панель открыта; окно свёрнуто — реже
let frPollAt = 0;
setInterval(() => {
  if (!state.account.loggedIn) return;
  const every = friendsEl.hidden || document.hidden ? FR_POLL_CLOSED : FR_POLL_OPEN;
  if (performance.now() - frPollAt < every) return;
  frPollAt = performance.now();
  loadFriends();
}, 2000);

// полоски прогресса у тех, кто слушает, идут сами
setInterval(() => {
  if (friendsEl.hidden || !Friends.data) return;
  for (const el of $$('[data-fr-bar]', friendsEl)) {
    const n = friendById(+el.dataset.frBar)?.now;
    if (n?.playing && n.track.duration) el.style.width = `${Math.min(100, (friendPos(n) / n.track.duration) * 100).toFixed(1)}%`;
  }
}, 1000);

// ---- панель ----

function openFriends() {
  closeTogether(); // together.js — панели на одном месте
  friendsEl.hidden = false;
  friendsBtn.setAttribute('aria-expanded', 'true');
  renderFriends();
  frPollAt = performance.now();
  loadFriends();
  $('#fr-login', friendsEl)?.focus();
}

function closeFriends() {
  friendsEl.hidden = true;
  friendsBtn.setAttribute('aria-expanded', 'false');
}

friendsBtn.onclick = () => (friendsEl.hidden ? openFriends() : closeFriends());
document.addEventListener('pointerdown', (e) => {
  if (friendsEl.hidden || friendsEl.contains(e.target) || friendsBtn.contains(e.target)) return;
  if ($('#menu').contains(e.target) || $('#dialog').contains(e.target)) return; // меню друга и подтверждение — часть панели
  closeFriends();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || friendsEl.hidden) return;
  if (!$('#menu').hidden || !$('#dialog').hidden) return; // сначала закроется меню или диалог
  e.stopPropagation();
  closeFriends();
}, true);

// вошли в аккаунт (или в другой) — сразу говорим серверу, что играет, и грузим друзей
let frLogin = null;
api.account.onEvent(() => {
  const login = state.account.loggedIn ? state.account.login : null;
  if (login === frLogin) return;
  frLogin = login;
  Friends.data = null;
  Friends.seenIncoming = null;
  frAvatars.clear();
  if (login) { sendNow(); loadFriends(); } else { closeFriends(); renderFriendsBadge(); }
});

// первый запуск: аккаунт загружается в init() (app.js) — ждём его
(async function startFriends() {
  for (let i = 0; i < 50 && !state.cfg; i++) await new Promise((r) => setTimeout(r, 200));
  if (!state.account.loggedIn) return;
  frLogin = state.account.login;
  loadFriends();
})();
