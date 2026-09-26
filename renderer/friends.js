'use strict';

// ---------- друзья ----------
// Друзья по логину и что они слушают (server/aveon_api/friends.py). Свой трек окно отправляет
// в главный процесс (src/friends.js), тот — на сервер. Список друзей обновляется сам: чаще, пока
// панель открыта. Трек друга можно включить у себя — с начала или с того же места, где сейчас он.

const FR_POLL_OPEN = 10 * 1000;
const FR_POLL_CLOSED = 20 * 1000; // приглашения в руму не должны ждать долго

const Friends = {
  data: null,        // ответ /api/friends
  fetchedAt: 0,      // performance.now() в момент ответа — чтобы позиция друга «шла» между опросами
  error: '',
  loading: false,
  seenIncoming: null, // id заявок, о которых уже сказали
  seenInvites: null,  // `${id}:${code}` приглашений в руму, о которых уже сказали
  seenKnocks: null,   // id друзей, которые просятся в руму и о которых уже сказали
  knocked: new Map(), // к кому мы попросились → когда: его приглашение принимаем сами
  seenMsg: new Map(), // от кого → id последнего непрочитанного, о котором уже сказали
  msgPrimed: false,   // первый опрос: о старых непрочитанных не тостим, их видно по счётчику
  unreadWas: new Map(), // сколько непрочитанного было при прошлой отрисовке: вырос — счётчик подпрыгивает
  viewAnim: null,     // 'in' — открыли чат или профиль, 'back' — вернулись к списку (анимация перехода)
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

// Аватарка друга: data:… из кэша; нет в кэше — грузим и перерисовываем панель. '' — аватарки нет
function friendAvatarUrl(p) {
  if (!p?.avatar) return '';
  const key = `${p.id}:${p.avatar}`;
  if (!frAvatars.has(key)) {
    frAvatars.set(key, '');
    api.friends.avatar(p.id, p.avatar).then((u) => {
      frAvatars.set(key, u || '');
      if (u) renderFriends();
    }).catch(() => {});
  }
  return frAvatars.get(key) || '';
}

function frAvatarHtml(p, live = false) {
  const url = friendAvatarUrl(p);
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
  return `<li class="fr-item">
    <button class="fr-main" data-fr-open="${f.id}" title="Профиль ${esc(f.name)}">
      ${frAvatarHtml(f, !!n?.playing)}
      <span class="fr-text"><b class="fr-name"><span>${esc(f.name)}</span>${f.in_room ? '<em class="fr-tag">в руме</em>' : ''}</b>${friendStatus(f)}</span>
    </button>
    <button class="icon-btn small fr-chat-btn" data-fr-chat="${f.id}" aria-label="Написать" title="Написать"><svg><use href="#i-chat"/></svg>${f.unread ? `<i class="fr-unread${f.unread > (Friends.unreadWas.get(f.id) || 0) ? ' pop' : ''}">${f.unread > 9 ? '9+' : f.unread}</i>` : ''}</button>
    ${roomButton(f)}
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

// Кнопка румы у друга: мы в руме — позвать; он в руме — попроситься; никто — создать и позвать
function roomAction(f) {
  if (Together.room) return 'invite';
  return f.in_room ? 'knock' : 'invite';
}

function roomButton(f) {
  const act = roomAction(f);
  const knocked = Friends.knocked.has(f.id);
  const title = act === 'knock' ? (knocked ? 'Просьба отправлена, ждём ответа' : 'Попроситься в руму')
    : Together.room ? `Позвать в руму ${Together.room.code}` : 'Создать руму и позвать';
  return `<button class="icon-btn small${act === 'knock' ? ' fr-knock' : ''}" data-fr-room="${f.id}" aria-label="${esc(title)}" title="${esc(title)}"${knocked && act === 'knock' ? ' disabled' : ''}><svg><use href="#i-${act === 'knock' ? 'enter' : 'together'}"/></svg></button>`;
}

function knockItem(p) {
  return `<li class="fr-item fr-request">
    <span class="fr-main static">${frAvatarHtml(p)}<span class="fr-text"><b>${esc(p.name)}</b><small class="fr-status">просится к тебе</small></span></span>
    <button class="btn primary fr-btn" data-fr-letin="${p.id}">Пустить</button>
    <button class="icon-btn small" data-fr-unknock="${p.id}" aria-label="Не пускать" title="Не пускать"><svg><use href="#i-close"/></svg></button>
  </li>`;
}

function inviteItem(p) {
  const here = Together.room?.code === p.code;
  return `<li class="fr-item fr-request">
    <span class="fr-main static">${frAvatarHtml(p)}<span class="fr-text"><b>${esc(p.name)}</b><small class="fr-status">рума ${esc(p.code)}</small></span></span>
    ${here ? '<small class="fr-status">ты уже там</small>' : `<button class="btn primary fr-btn" data-fr-join="${p.id}">Войти</button>`}
    <button class="icon-btn small" data-fr-dismiss="${p.id}" aria-label="Не пойду" title="Не пойду"><svg><use href="#i-close"/></svg></button>
  </li>`;
}

function renderFriendsBadge() {
  const n = Friends.data?.incoming.length || 0;
  const unread = (Friends.data?.friends || []).reduce((a, f) => a + (f.unread || 0), 0);
  const inv = unread + (Friends.data?.invites?.length || 0) + (Together.room ? Friends.data?.knocks?.length || 0 : 0);
  $('#friends-badge').hidden = !n && !inv;
  friendsBtn.title = inv ? `Друзья · зовут в руму` : n ? `Друзья · ${n} ${plural(n, 'заявка', 'заявки', 'заявок')}` : 'Друзья';
}

function renderFriends() {
  renderFriendsBadge();
  if (friendsEl.hidden) return;
  if (Friends.viewAnim) {
    const cls = Friends.viewAnim === 'back' ? 'view-back' : 'view-in';
    Friends.viewAnim = null;
    friendsEl.classList.remove('view-in', 'view-back');
    requestAnimationFrame(() => {
      friendsEl.classList.add(cls);
      setTimeout(() => friendsEl.classList.remove(cls), 400);
    });
  }
  requestAnimationFrame(placeFriends);
  if (Chat.id) { renderChat(); return; }
  if (FP.id) { renderFriendProfile(); return; }
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
    const invites = d.invites || [];
    const knocks = Together.room ? d.knocks || [] : [];
    body = `
      ${knocks.length ? `<h3 class="fr-sub">Просятся в руму</h3>
        <ul class="fr-list">${knocks.map(knockItem).join('')}</ul>` : ''}
      ${invites.length ? `<h3 class="fr-sub">Зовут в руму</h3>
        <ul class="fr-list">${invites.map(inviteItem).join('')}</ul>` : ''}
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
  for (const f of d?.friends || []) Friends.unreadWas.set(f.id, f.unread || 0);
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
  $$('[data-fr-open]', friendsEl).forEach((b) => { b.onclick = () => openFriendProfile(+b.dataset.frOpen); });
  $$('[data-fr-chat]', friendsEl).forEach((b) => { b.onclick = () => openChat(+b.dataset.frChat); });
  $$('[data-fr-room]', friendsEl).forEach((b) => {
    b.onclick = () => {
      const f = friendById(+b.dataset.frRoom);
      if (f) (roomAction(f) === 'knock' ? knockFriend(f) : inviteFriend(f));
    };
  });
  $$('[data-fr-letin]', friendsEl).forEach((b) => { b.onclick = () => letIn(+b.dataset.frLetin); });
  $$('[data-fr-unknock]', friendsEl).forEach((b) => { b.onclick = () => refuseKnock(+b.dataset.frUnknock); });
  $$('[data-fr-join]', friendsEl).forEach((b) => { b.onclick = () => joinInvite(+b.dataset.frJoin); });
  $$('[data-fr-dismiss]', friendsEl).forEach((b) => { b.onclick = () => dismissInvite(+b.dataset.frDismiss); });
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
  const items = [
    ...(FP.id === f.id ? [] : [{ label: 'Профиль', icon: 'i-user', onClick: () => openFriendProfile(f.id) }]),
    { label: 'Написать', icon: 'i-chat', onClick: () => openChat(f.id) }, { sep: true },
  ];
  if (n?.track) {
    if (n.playing) items.push({ label: 'Включить с того же места', icon: 'i-play', onClick: () => playFriend(f, false) });
    items.push({ label: n.playing ? 'Включить с начала' : `Включить «${n.track.title}»`, icon: n.playing ? 'i-prev' : 'i-play', onClick: () => playFriend(f, true) });
    items.push({ sep: true });
  }
  if (roomAction(f) === 'knock') items.push({ label: 'Попроситься в руму', icon: 'i-enter', onClick: () => knockFriend(f) });
  else items.push({ label: Together.room ? 'Позвать в руму' : 'Создать руму и позвать', icon: 'i-together', onClick: () => inviteFriend(f) });
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

// ---- рума с друзьями ----

// Позвать друга: румы нет — сначала создаём (together.js), потом отправляем другу её код
async function inviteFriend(f) {
  if (!f) return;
  if (!Together.room) await enterRoom(() => api.together.create());
  const code = Together.room?.code;
  if (!code) return;
  try {
    await api.friends.invite(f.id, code);
    toast(`${firstName(f.name)} получит приглашение в руму ${code}`);
  } catch (e) { toast(e.message, 'err'); }
}

async function knockFriend(f) {
  try {
    await api.friends.knock(f.id);
    Friends.knocked.set(f.id, Date.now());
    toast(`Просьба ушла ${firstName(f.name)} — как пустит, зайдёшь сам`);
  } catch (e) { toast(e.message, 'err'); }
  renderFriends();
}

// Пустить: просто зовём его в свою руму, а его плеер войдёт сам (он же просился)
async function letIn(id) {
  const p = Friends.data?.knocks?.find((x) => x.id === id);
  if (!p) return;
  Friends.data.knocks = Friends.data.knocks.filter((x) => x.id !== id);
  await inviteFriend(p);
  renderFriends();
}

async function refuseKnock(id) {
  if (Friends.data?.knocks) Friends.data.knocks = Friends.data.knocks.filter((x) => x.id !== id);
  renderFriends();
  api.friends.unknock(id).catch(() => {});
}

async function joinInvite(id) {
  const p = Friends.data?.invites?.find((x) => x.id === id);
  if (!p) return;
  await enterRoom(() => api.together.join(p.code));
  if (Together.room?.code === p.code) {
    api.friends.dismiss(id).catch(() => {});
    Friends.data.invites = Friends.data.invites.filter((x) => x.id !== id);
    closeFriends();
    toast(`Ты в руме с ${firstName(p.name)}`);
  }
  renderFriends();
}

async function dismissInvite(id) {
  if (Friends.data?.invites) Friends.data.invites = Friends.data.invites.filter((x) => x.id !== id);
  renderFriends();
  api.friends.dismiss(id).catch(() => {});
}

// Трек от друга — у себя: через свой сервис или найденный аналог. at — с какой секунды
function playShared(track, at = 0) {
  const t = { ...track, shared: true };
  const t0 = performance.now();
  state.queue = [t];
  state.order = [0];
  state.pos = 0;
  // позицию считаем, когда поток уже готов: пока искали трек, друг ушёл дальше
  loadTrack(t, { startAt: at ? () => at + (performance.now() - t0) / 1000 : 0 });
  return t;
}

// Трек друга — у себя. Играет через свой сервис или найденный аналог, как в «Слушать вместе»
function playFriend(f, fromStart) {
  const n = f.now;
  if (!n?.track) return;
  const t = playShared(n.track, fromStart ? 0 : friendPos(n));
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
      islandNotify(`${firstName(p.name)} хочет в друзья`, 'friend', p); // island-feed.js
    }
    const inv = d.invites || [];
    const newInv = inv.filter((p) => Friends.seenInvites && !Friends.seenInvites.has(`${p.id}:${p.code}`));
    Friends.seenInvites = new Set(inv.map((p) => `${p.id}:${p.code}`));
    const knocks = d.knocks || [];
    const newKnocks = knocks.filter((p) => Friends.seenKnocks && !Friends.seenKnocks.has(p.id));
    Friends.seenKnocks = new Set(knocks.map((p) => p.id));
    for (const p of newKnocks) {
      toast(`${firstName(p.name)} просится к тебе в руму — открой «Друзья»`);
      islandNotify(`${firstName(p.name)} просится в руму`, 'friend', p);
    }
    for (const f of d.friends) {
      const last = f.last;
      const seen = Friends.seenMsg.get(f.id) || 0;
      if (last) Friends.seenMsg.set(f.id, Math.max(seen, last.id));
      if (!last || !Friends.msgPrimed || last.id <= seen) continue;
      if (Chat.id === f.id && !friendsEl.hidden) continue; // чат открыт — сообщение и так видно
      const what = last.track_title ? `♪ ${last.track_title}` : last.text;
      toast(`${firstName(f.name)}: ${what}`);
      islandNotify(`${firstName(f.name)}: ${what}`, 'friend', f); // island-feed.js
    }
    Friends.msgPrimed = true;
    Friends.data = d;
    if (Chat.id) loadChat();
    // просились — и нас позвали: заходим сами
    const accepted = !Together.room && inv.find((p) => Date.now() - (Friends.knocked.get(p.id) || 0) < 10 * 60 * 1000);
    for (const p of newInv) {
      if (p === accepted) continue;
      toast(`${firstName(p.name)} зовёт тебя в руму — открой «Друзья»`);
      islandNotify(`${firstName(p.name)} зовёт в руму`, 'friend', p); // island-feed.js
    }
    if (accepted) {
      Friends.knocked.delete(accepted.id);
      joinInvite(accepted.id);
    }
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

// Панель — под кнопкой «Друзья», правым краем к ней: при любой раскладке (плеер справа, снизу…)
// она у кнопки, а не у края окна поверх сцены
function placeFriends() {
  if (friendsEl.hidden) return;
  const r = friendsBtn.getBoundingClientRect();
  const w = friendsEl.offsetWidth, h = friendsEl.offsetHeight, edge = 12;
  const left = Math.min(Math.max(edge, r.right - w), innerWidth - w - edge);
  let top = r.bottom + 8;
  if (top + h > innerHeight - edge) top = Math.max(edge, innerHeight - edge - h);
  friendsEl.style.left = `${left}px`;
  friendsEl.style.top = `${top}px`;
}
window.addEventListener('resize', placeFriends);

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
  Friends.seenInvites = null;
  Friends.seenKnocks = null;
  Friends.knocked.clear();
  Friends.seenMsg.clear();
  Friends.msgPrimed = false;
  Chat.id = null;
  FP.id = null;
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

// вошли в руму или вышли — кнопки у друзей меняются: «позвать» ↔ «попроситься»
api.together.onEvent(() => renderFriends());

// ---------- сообщения ----------
// Чат открывается в той же панели вместо списка. Пока он открыт — опрос чаще.
// В сообщении может быть трек: его можно включить у себя одной кнопкой.

const CHAT_POLL = 4000;
const Chat = { id: null, messages: [], loading: false, sending: false, error: '', more: true, shown: new Set(), stagger: false };

function openChat(id) {
  if (!friendById(id)) return;
  if (friendsEl.hidden) openFriends();
  Chat.id = id;
  Chat.shown = new Set();
  Chat.stagger = true; // первые сообщения появляются лесенкой
  Friends.viewAnim = 'in';
  Chat.messages = [];
  Chat.error = '';
  Chat.more = true;
  renderFriends();
  loadChat().then(() => $('#fr-text', friendsEl)?.focus());
}

function closeChat() {
  Chat.id = null;
  Friends.viewAnim = 'back';
  renderFriends();
  loadFriends(); // счётчик непрочитанного обнулился
}

async function loadChat(older = false) {
  const id = Chat.id;
  if (!id || Chat.loading) return;
  Chat.loading = true;
  try {
    const before = older ? Chat.messages[0]?.id : undefined;
    const { messages } = await api.friends.messages(id, before);
    if (Chat.id !== id) return;
    if (older) {
      Chat.messages = [...messages, ...Chat.messages];
      Chat.more = messages.length >= 50;
    } else {
      // новые дописываем, уже показанные не трогаем
      const known = new Set(Chat.messages.map((m) => m.id));
      const fresh = messages.filter((m) => !known.has(m.id));
      const first = !Chat.messages.length;
      if (first) Chat.more = messages.length >= 50;
      if (!fresh.length && !first) return;
      Chat.messages = [...Chat.messages, ...fresh].sort((a, b) => a.id - b.id);
    }
    Chat.error = '';
  } catch (e) {
    Chat.error = e.message;
  } finally {
    Chat.loading = false;
  }
  renderFriends();
}

function msgTime(sec) {
  const d = new Date(sec * 1000);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('ru', today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// fromEnd — какое сообщение с конца: при открытии чата последние появляются лесенкой снизу вверх
function msgHtml(m, fromEnd) {
  const t = m.track;
  const cover = t?.cover && /^https?:/i.test(t.cover) ? `<img src="${esc(t.cover)}" alt="">` : '<span>♪</span>';
  const enter = !Chat.shown.has(m.id);
  const delay = enter && Chat.stagger ? Math.max(0, 11 - Math.min(fromEnd, 11)) * 28 : 0;
  const cls = `${m.mine ? ' mine' : ''}${enter ? ' enter' : ''}${m.pending ? ' pending' : ''}${m.justSent ? ' sent' : ''}`;
  m.justSent = false;
  return `<div class="fr-msg${cls}"${delay ? ` style="--d:${delay}ms"` : ''} title="${esc(m.pending ? 'отправляется…' : msgTime(m.created))}">
    ${t ? `<button class="fr-track" data-msg-play="${m.id}" title="Включить у себя">
      <span class="fr-track-cover">${cover}</span>
      <span class="fr-track-text"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span>
      <svg><use href="#i-play"/></svg></button>` : ''}
    ${m.text ? `<p>${esc(m.text)}</p>` : ''}
  </div>`;
}

function renderChat() {
  const f = friendById(Chat.id);
  if (!f) { Chat.id = null; renderFriends(); return; }
  const oldList = $('.fr-msgs', friendsEl);
  const atBottom = !oldList || oldList.scrollHeight - oldList.scrollTop - oldList.clientHeight < 40;
  const fromBottom = oldList ? oldList.scrollHeight - oldList.scrollTop : 0;
  const typed = $('#fr-text', friendsEl)?.value || '';
  const focused = document.activeElement?.id === 'fr-text';
  let body;
  if (!Chat.messages.length) {
    body = Chat.error ? `<p class="together-note warn">${esc(Chat.error)}</p>`
      : Chat.loading ? '<div class="spinner small"></div>'
      : `<p class="together-desc fr-empty">Напиши ${esc(firstName(f.name))} или отправь, что сейчас играет.</p>`;
  } else {
    body = `${Chat.more ? '<button class="fr-older" id="fr-older">раньше</button>' : ''}${Chat.messages.map((m, i, all) => msgHtml(m, all.length - 1 - i)).join('')}
      ${Chat.error ? `<p class="together-note warn">${esc(Chat.error)}</p>` : ''}`;
  }
  const now = state.track;
  friendsEl.innerHTML = `
    <div class="fr-chat-head">
      <button class="icon-btn small" id="fr-back" aria-label="К друзьям" title="К друзьям"><svg><use href="#i-chevron-l"/></svg></button>
      ${frAvatarHtml(f, !!f.now?.playing)}
      <span class="fr-text"><b>${esc(f.name)}</b>${friendStatus(f)}</span>
    </div>
    <div class="fr-scroll fr-msgs">${body}</div>
    <form class="fr-compose" id="fr-compose" autocomplete="off">
      <button type="button" class="icon-btn small" id="fr-attach" title="${now ? `Отправить «${esc(now.title)}»` : 'Сейчас ничего не играет'}" aria-label="Отправить, что сейчас играет"${now ? '' : ' disabled'}><svg><use href="#i-share"/></svg></button>
      <input class="input" id="fr-text" maxlength="2000" placeholder="сообщение" aria-label="Сообщение">
      <button class="btn primary fr-send" type="submit"${Chat.sending ? ' disabled' : ''}>Отправить</button>
    </form>`;
  for (const m of Chat.messages) Chat.shown.add(m.id); // показанные больше не анимируем
  if (Chat.messages.length) Chat.stagger = false;
  const list = $('.fr-msgs', friendsEl);
  list.scrollTop = atBottom ? list.scrollHeight : list.scrollHeight - fromBottom;
  const input = $('#fr-text', friendsEl);
  input.value = typed;
  if (focused) input.focus();
  $('#fr-back', friendsEl).onclick = closeChat;
  const older = $('#fr-older', friendsEl);
  if (older) older.onclick = () => loadChat(true);
  $('#fr-attach', friendsEl).onclick = () => { if (state.track) sendMessage(Chat.id, { track: shareable(state.track) }); };
  $('#fr-compose', friendsEl).onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    input.value = '';
    sendMessage(Chat.id, { text }).then((ok) => {
      const box = $('#fr-text', friendsEl);
      if (!ok && box && !box.value) box.value = text; // не ушло — возвращаем текст
      box?.focus();
    });
  };
  $$('[data-msg-play]', friendsEl).forEach((b) => {
    b.onclick = () => {
      const m = Chat.messages.find((x) => x.id === +b.dataset.msgPlay);
      if (m?.track) { playShared(m.track); toast(`Включаю «${m.track.title}»`); }
    };
  });
}

async function sendMessage(id, body) {
  if (Chat.sending) return false;
  Chat.sending = true;
  // своё сообщение видно сразу, полупрозрачным; ответ сервера заменяет его настоящим
  const temp = Chat.id === id
    ? { id: `tmp${Date.now()}`, mine: true, text: body.text || '', track: body.track || null, created: Date.now() / 1000, pending: true }
    : null;
  if (temp) Chat.messages = [...Chat.messages, temp];
  if (Chat.id === id) renderFriends();
  try {
    const { message } = await api.friends.send(id, body);
    if (Chat.id === id) {
      Chat.shown.add(message.id);
      message.justSent = true;
      const already = Chat.messages.some((m) => m.id === message.id); // опрос чата успел принести его раньше
      if (already) Chat.messages = Chat.messages.filter((m) => m !== temp);
      else Chat.messages = temp ? Chat.messages.map((m) => (m === temp ? message : m)) : [...Chat.messages, message];
    }
    return true;
  } catch (e) {
    if (temp) Chat.messages = Chat.messages.filter((m) => m !== temp);
    toast(e.message, 'err');
    return false;
  } finally {
    Chat.sending = false;
    renderFriends();
  }
}

// «Отправить другу» из меню трека (app.js)
function sendTrackMenu(t, pos) {
  const list = Friends.data?.friends || [];
  if (!list.length) { toast('Сначала добавь друзей — кнопка «Друзья» сверху'); return; }
  showMenu([
    { note: `«${t.title}» — кому?` },
    ...list.slice(0, 30).map((f) => ({
      label: f.name, icon: 'i-user',
      onClick: async () => {
        if (await sendMessage(f.id, { track: shareable(t) })) toast(`«${t.title}» отправлен ${firstName(f.name)}`);
      },
    })),
  ], pos);
}

setInterval(() => {
  if (Chat.id && !friendsEl.hidden && !document.hidden) loadChat();
}, CHAT_POLL);

// ---------- профиль друга ----------
// Открывается кликом по другу, в той же панели. Что слушает сейчас, кнопки «написать» и «рума»,
// сводка его статистики с сервера: сколько слушал, любимые треки и артисты (треки включаются у себя)

const FP = { id: null, data: null, error: '', loading: false };

function openFriendProfile(id) {
  if (!friendById(id)) return;
  FP.id = id;
  Friends.viewAnim = 'in';
  FP.data = null;
  FP.error = '';
  renderFriends();
  loadFriendProfile();
}

function closeFriendProfile() {
  FP.id = null;
  Friends.viewAnim = 'back';
  renderFriends();
}

async function loadFriendProfile() {
  const id = FP.id;
  if (!id || FP.loading) return;
  FP.loading = true;
  try {
    const d = await api.friends.profile(id);
    if (FP.id !== id) return;
    FP.data = d;
    FP.fetchedAt = performance.now();
    FP.error = '';
  } catch (e) {
    if (FP.id === id) FP.error = e.message;
  } finally {
    FP.loading = false;
  }
  renderFriends();
}

function fpDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function fpDate(sec) {
  return new Date(sec * 1000).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fpCover(t, cls = 'fr-track-cover') {
  const img = t?.cover && /^https?:/i.test(t.cover) ? `<img src="${esc(t.cover)}" alt="">` : '<span>♪</span>';
  return `<span class="${cls}">${img}</span>`;
}

function renderFriendProfile() {
  const f = friendById(FP.id);
  if (!f) { FP.id = null; renderFriends(); return; }
  const d = FP.data;
  const n = f.now; // свежее из списка друзей (опрашивается чаще профиля)
  const scroll = $('.fr-scroll', friendsEl)?.scrollTop || 0;
  const act = roomAction(f);
  const roomLabel = act === 'knock' ? (Friends.knocked.has(f.id) ? 'Просьба отправлена' : 'Попроситься в руму')
    : Together.room ? 'Позвать в руму' : 'Создать руму и позвать';

  let nowHtml = '';
  if (n?.track) {
    const state = n.playing ? 'слушает сейчас' : n.live ? 'на паузе' : `последний трек · ${friendAgo(n)}`;
    nowHtml = `<div class="fp-now${n.playing ? ' live' : ''}">
      ${fpCover(n.track, 'fp-now-cover')}
      <div class="fp-now-text"><small>${esc(state)}</small><b>${esc(n.track.title)}</b><span>${esc(n.track.artist || '')}</span>
        ${n.playing && n.track.duration ? `<span class="fr-bar"><i data-fr-bar="${f.id}" style="width:${Math.min(100, (friendPos(n) / n.track.duration) * 100).toFixed(1)}%"></i></span>` : ''}
      </div>
      <div class="fp-now-actions">
        ${n.playing ? '<button class="btn primary fr-btn" id="fp-sync">С того же места</button>' : ''}
        <button class="btn fr-btn" id="fp-start">${n.playing ? 'С начала' : 'Включить'}</button>
      </div>
    </div>`;
  } else {
    nowHtml = '<p class="together-desc fp-quiet">Сейчас ничего не слушает</p>';
  }

  let statsHtml;
  if (!d) {
    statsHtml = FP.error ? `<p class="together-note warn">${esc(FP.error)}</p>` : '<div class="spinner small"></div>';
  } else {
    const s = d.stats;
    statsHtml = !s.total ? '<p class="together-desc">Статистики пока нет — или слушает без аккаунта на этом сервере.</p>' : `
      <div class="fp-nums">
        <div><b>${esc(fpDuration(s.month))}</b><small>в этом месяце</small></div>
        <div><b>${esc(fpDuration(s.total))}</b><small>всего</small></div>
        <div><b>${s.days}</b><small>${plural(s.days, 'день', 'дня', 'дней')} с музыкой</small></div>
      </div>
      ${s.artists.length ? `<h3 class="fr-sub">Любимые артисты</h3>
        <div class="fp-artists">${s.artists.map((a) => `<span title="${esc(fpDuration(a.sec))}">${esc(a.name)}</span>`).join('')}</div>` : ''}
      ${s.tracks.length ? `<h3 class="fr-sub">Любимые треки</h3>
        <div class="fp-tracks">${s.tracks.map((x, i) => `<button class="fr-track" data-fp-play="${i}" title="Включить у себя">
          ${fpCover(x.track)}
          <span class="fr-track-text"><b>${esc(x.track.title)}</b><small>${esc(x.track.artist || '')} · ${x.plays} ${plural(x.plays, 'раз', 'раза', 'раз')}</small></span>
          <svg><use href="#i-play"/></svg></button>`).join('')}</div>` : ''}`;
  }

  friendsEl.innerHTML = `
    <div class="fr-chat-head">
      <button class="icon-btn small" id="fp-back" aria-label="К друзьям" title="К друзьям"><svg><use href="#i-chevron-l"/></svg></button>
      <span class="fr-text"><b>Профиль</b></span>
    </div>
    <div class="fr-scroll fp-body">
      <div class="fp-hero">
        ${frAvatarHtml(f, !!n?.playing).replace('fr-avatar', 'fr-avatar fp-avatar')}
        <div class="fp-who">
          <h2 class="fr-name"><span>${esc(f.name)}</span>${f.in_room ? '<em class="fr-tag">в руме</em>' : ''}</h2>
          <small>@${esc(f.login)}${f.since ? ` · друзья с ${esc(fpDate(f.since))}` : ''}</small>
        </div>
      </div>
      <div class="fp-actions">
        <button class="btn primary" id="fp-chat"><svg><use href="#i-chat"/></svg>Написать${f.unread ? ` <i class="fr-unread static">${f.unread}</i>` : ''}</button>
        <button class="btn" id="fp-room"${act === 'knock' && Friends.knocked.has(f.id) ? ' disabled' : ''}><svg><use href="#i-${act === 'knock' ? 'enter' : 'together'}"/></svg>${esc(roomLabel)}</button>
        <button class="icon-btn small" id="fp-more" aria-label="Ещё" aria-haspopup="menu"><svg><use href="#i-more"/></svg></button>
      </div>
      ${nowHtml}
      ${statsHtml}
    </div>`;
  $('.fr-scroll', friendsEl).scrollTop = scroll;
  const on = (sel, fn) => { const el = $(sel, friendsEl); if (el) el.onclick = fn; };
  on('#fp-back', closeFriendProfile);
  on('#fp-chat', () => openChat(f.id));
  on('#fp-room', () => (act === 'knock' ? knockFriend(f) : inviteFriend(f)));
  on('#fp-more', (e) => friendMenu(f, e.currentTarget));
  on('#fp-sync', () => playFriend(f, false));
  on('#fp-start', () => playFriend(f, true));
  $$('[data-fp-play]', friendsEl).forEach((b) => {
    b.onclick = () => {
      const x = FP.data?.stats.tracks[+b.dataset.fpPlay];
      if (x) { playShared(x.track); toast(`Включаю «${x.track.title}»`); }
    };
  });
}
