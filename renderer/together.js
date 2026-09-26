'use strict';

// ---------- слушать вместе ----------
// Рума на сервере авеона. Кто включил трек, поставил паузу или перемотал — отправляет состояние
// { track, playing, pos }, остальные подстраиваются. Ведущий (последний, кто сменил трек) переключает
// трек, когда тот заканчивается, и раз в несколько секунд напоминает, где он сейчас, — так у всех
// одно и то же место даже после подвисаний сети.
// Звук не передаётся: каждый играет трек сам, через свой сервис или найденный аналог (см. main.js).

const BEAT_EVERY = 4000;     // как часто ведущий напоминает позицию
const DRIFT_CHECK = 2000;
const DRIFT_MAX = 0.8;       // с, больше — перематываем к ведущему

const Together = {
  room: null,        // { code, you, members, driver, connected }
  remote: null,      // последнее чужое состояние: { id, playing, pos, t0 } — pos была в момент t0 (performance.now)
  holdUntil: 0,      // до этого момента свои события плеера не отправляем (это мы применяем чужое)
  applying: false,
  busy: false,

  active() { return !!this.room && this.room.members.length > 0; },
  isDriver() { return !!this.room && this.lead() === this.room.you; },
  // Ведущий ушёл — ведёт тот, кто в руме дольше всех
  lead() { return this.room?.driver || this.room?.members[0]?.id || null; },
  hold(ms) { this.holdUntil = Math.max(this.holdUntil, performance.now() + ms); },
  quiet() { return this.applying || performance.now() < this.holdUntil; },

  // ---- точки встраивания в плеер (app.js) ----
  beforeLoad() { this.hold(20000); },
  loadFailed() { this.holdUntil = 0; },
  afterLoad(track) {
    if (this.applying) { this.holdUntil = 0; this.hold(1500); return; }
    this.holdUntil = 0;
    this.send();
  },
  waitsOnEnd() { return this.active() && this.room.members.length > 1 && !this.isDriver(); },

  expected() {
    const r = this.remote;
    if (!r) return 0;
    return r.pos + (r.playing ? (performance.now() - r.t0) / 1000 : 0);
  },

  send(beat = false) {
    if (!this.room || !state.track) return;
    api.together.send({ track: shareable(state.track), playing: !audio.paused, pos: +(audio.currentTime || 0).toFixed(2) }, beat);
    this.room.driver = this.room.you;
    this.remote = null;
    renderTogetherChip();
  },
};

// Что уходит другу: без путей к файлам и протухающих ссылок
function shareable(t) {
  const s = slimTrack(t);
  delete s.shared;
  if (t.source === 'local') s.ref = {};
  if (s.cover && !/^https?:/i.test(s.cover)) s.cover = '';
  return s;
}

// Свои действия с плеером → в руму
for (const ev of ['play', 'pause', 'seeked']) {
  onAudio(ev, () => {
    if (!Together.room || Together.quiet() || !state.track) return;
    if (ev === 'pause' && audio.ended) return; // конец трека — не пауза
    Together.send();
  });
}

// Чужое состояние → в свой плеер
async function applyRemote(st, age, { beat = false } = {}) {
  const T = Together;
  T.remote = { id: st.track.id, playing: st.playing, pos: st.pos, t0: performance.now() - Math.max(0, age) };
  if (!state.track || state.track.id !== st.track.id) {
    const t = { ...st.track, shared: true };
    state.queue = [t];
    state.order = [0];
    state.pos = 0;
    T.applying = true;
    try { await loadTrack(t, { autoplay: st.playing, startAt: () => T.expected() }); } finally { T.applying = false; }
    return;
  }
  const want = T.expected();
  T.hold(1000);
  if (Math.abs((audio.currentTime || 0) - want) > (beat ? 1.2 : 0.5) && isFinite(audio.duration || Infinity)) {
    audio.currentTime = Math.min(want, (audio.duration || want + 1) - 0.25);
  }
  if (st.playing && audio.paused) audio.play().catch(() => {});
  if (!st.playing && !audio.paused) audio.pause();
}

// Ведущий напоминает позицию, остальные подтягиваются, если уехали
setInterval(() => {
  const T = Together;
  if (T.isDriver() && T.room.members.length > 1 && state.track && !audio.paused) T.send(true);
}, BEAT_EVERY);

setInterval(() => {
  const T = Together;
  const r = T.remote;
  if (!T.room || T.isDriver() || !r || !r.playing || audio.paused || T.quiet()) return;
  if (state.track?.id !== r.id || audio.readyState < 3) return;
  const want = T.expected();
  if (Math.abs(audio.currentTime - want) > DRIFT_MAX && want < (audio.duration || Infinity) - 1) {
    T.hold(800);
    audio.currentTime = want;
  }
}, DRIFT_CHECK);

// ---- события из главного процесса ----

const firstName = (name) => String(name || '').split(/\s+/)[0];

// Аватары участников: свой — из настроек, чужие — с сервера (через главный процесс, с кэшем)
const tgAvatars = new Map(); // `${user}:${avatar}` → data:… или '' (нет / не загрузился)

function memberAvatar(m) {
  const r = Together.room;
  if (r && m.id === r.you) return state.account.avatar || '';
  return tgAvatars.get(`${m.user}:${m.avatar}`) || '';
}

function loadAvatars() {
  const r = Together.room;
  if (!r) return;
  for (const m of r.members) {
    if (!m.avatar || !m.user || m.id === r.you) continue;
    const key = `${m.user}:${m.avatar}`;
    if (tgAvatars.has(key)) continue;
    tgAvatars.set(key, '');
    api.together.avatar(m.user, m.avatar).then((url) => {
      tgAvatars.set(key, url || '');
      if (url) { renderTogether(); renderTogetherChip(); }
    }).catch(() => {});
  }
}

function avatarHtml(m, cls = 'together-avatar') {
  const url = memberAvatar(m);
  return `<span class="${cls}${url ? ' pic' : ''}">${url ? `<img src="${esc(url)}" alt="">` : esc(firstName(m.name).slice(0, 1).toUpperCase())}</span>`;
}

api.together.onEvent((ev) => {
  const T = Together;
  const was = T.room;
  T.room = ev.room;
  switch (ev.type) {
    case 'state': {
      const fresh = ev.state.track.id !== state.track?.id; // до применения: потом трек уже будет тем же
      applyRemote(ev.state, ev.age, { beat: ev.beat });
      if (fresh && !ev.beat && !ev.initial && ev.by) toast(`${firstName(ev.by)} включает «${ev.state.track.title}»`);
      break;
    }
    case 'members':
      if (ev.joined) toast(`${firstName(ev.joined)} теперь слушает с тобой`);
      if (ev.left) toast(`${firstName(ev.left)} вышел из румы`);
      // новенькому сразу показываем, что играет у нас
      if (ev.joined && T.isDriver() && state.track) T.send();
      break;
    case 'reconnecting':
      break;
    case 'closed':
      T.remote = null;
      if (was) toast(ev.error || 'Ты вышел из румы', ev.error ? 'err' : '');
      break;
    case 'error':
      toast(ev.error, 'err');
      break;
    default:
  }
  renderTogether();
  renderTogetherChip();
});

// ---------- панель «Слушать вместе» ----------
// Рума живёт на сцене, под «сейчас играет»: плашка всегда на виду (без румы — «слушать вместе»),
// панель открывается прямо под ней. Рума — про текущий трек, поэтому и место рядом с ним.

const togetherEl = $('#together');
const togetherBtn = $('#together-chip');

function memberNames(exceptMe = true) {
  const r = Together.room;
  if (!r) return [];
  return r.members.filter((m) => !exceptMe || m.id !== r.you).map((m) => firstName(m.name));
}

function renderTogetherChip() {
  const r = Together.room;
  requestAnimationFrame(placeTogether); // плашка поменяла ширину — панель снова по центру
  const chip = togetherBtn;
  chip.classList.toggle('idle', !r);
  if (!r) {
    chip.classList.remove('offline');
    $('#together-chip-faces').innerHTML = '';
    $('#together-chip-text').textContent = 'слушать вместе';
    chip.title = 'Создать руму или войти по коду друга';
    return;
  }
  const others = memberNames();
  loadAvatars();
  chip.title = `Рума ${r.code}`;
  const faces = r.members.filter((m) => m.id !== r.you).slice(0, 3);
  $('#together-chip-faces').innerHTML = faces.map((m) => avatarHtml(m, 'together-face')).join('');
  chip.classList.toggle('offline', !r.connected);
  $('#together-chip-text').textContent = !r.connected ? 'связь с румой…'
    : others.length ? `слушаете вместе · ${others.join(', ')}` : `рума ${r.code} · ждём друга`;
}

function renderTogether() {
  if (togetherEl.hidden) return;
  requestAnimationFrame(placeTogether);
  const r = Together.room;
  if (!r) {
    togetherEl.innerHTML = `
      <h2 class="together-title">Слушать вместе</h2>
      <p class="together-desc">Создай руму и отправь код другу. Трек, пауза и перемотка будут у вас общими.</p>
      <button class="btn primary together-wide" id="tg-create">Создать руму</button>
      <div class="together-or"><span>или</span></div>
      <form class="together-join" id="tg-join-form" autocomplete="off">
        <input class="input together-code-input" id="tg-code" placeholder="КОД ДРУГА" maxlength="7" spellcheck="false" aria-label="Код румы">
        <button class="btn" type="submit">Войти</button>
      </form>
      <p class="together-note">У друга трек играет через его Яндекс Музыку или SoundCloud. Свои файлы плеер находит там же по названию.</p>`;
    $('#tg-create').onclick = () => enterRoom(() => api.together.create());
    $('#tg-join-form').onsubmit = (e) => {
      e.preventDefault();
      const code = $('#tg-code').value.trim();
      if (!code) { $('#tg-code').focus(); return; }
      enterRoom(() => api.together.join(code));
    };
    $('#tg-code').oninput = (e) => { e.target.value = e.target.value.toUpperCase(); };
    return;
  }
  const lead = Together.lead();
  togetherEl.innerHTML = `
    <h2 class="together-title">Рума</h2>
    <button class="together-code" id="tg-copy" title="Скопировать код">
      <span>${esc(r.code)}</span><svg><use href="#i-copy"/></svg>
    </button>
    <p class="together-desc">${r.members.length > 1 ? 'Слушаете вместе. Любой может сменить трек, поставить паузу или перемотать.' : 'Отправь этот код другу — пусть введёт его у себя в «Слушать вместе».'}</p>
    <ul class="together-members">
      ${r.members.map((m) => `<li>${avatarHtml(m)}
        <span class="together-name">${esc(m.name)}${m.id === r.you ? ' <em>ты</em>' : ''}</span>
        ${m.id === lead && r.members.length > 1 ? '<span class="together-lead">ведёт</span>' : ''}</li>`).join('')}
    </ul>
    ${r.connected ? '' : '<p class="together-note warn">Связь пропала, переподключаюсь…</p>'}
    <button class="btn danger together-wide" id="tg-leave">Выйти из румы</button>`;
  $('#tg-copy').onclick = async () => {
    if (await copyText(r.code)) toast('Код скопирован'); else toast(`Код румы: ${r.code}`); // share.js
  };
  $('#tg-leave').onclick = async () => {
    await api.together.leave();
    Together.room = null;
    Together.remote = null;
    renderTogether();
    renderTogetherChip();
  };
}

async function enterRoom(fn) {
  if (Together.busy) return;
  Together.busy = true;
  $$('button', togetherEl).forEach((b) => { b.disabled = true; });
  try {
    Together.room = await fn();
    // создали руму и уже что-то играет — сразу сообщаем, что
    if (Together.room && !Together.room.driver && state.track) Together.send();
  } catch (e) {
    toast(e.message, 'err');
  }
  Together.busy = false;
  renderTogether();
  renderTogetherChip();
}

// Панель — под плашкой на сцене, по центру от неё; не влезает вниз — встаёт над плашкой
function placeTogether() {
  if (togetherEl.hidden) return;
  const r = togetherBtn.getBoundingClientRect();
  const w = togetherEl.offsetWidth, h = togetherEl.offsetHeight, gap = 10, edge = 12;
  const left = Math.min(Math.max(edge, r.left + r.width / 2 - w / 2), innerWidth - w - edge);
  let top = r.bottom + gap;
  if (top + h > innerHeight - edge) top = Math.max(edge, r.top - gap - h);
  togetherEl.style.left = `${left}px`;
  togetherEl.style.top = `${top}px`;
}
window.addEventListener('resize', placeTogether);

function openTogether() {
  if (typeof closeFriends === 'function') closeFriends(); // friends.js
  togetherEl.hidden = false;
  togetherBtn.setAttribute('aria-expanded', 'true');
  renderTogether();
  ($('#tg-code', togetherEl) || $('#tg-copy', togetherEl))?.focus();
}

function closeTogether() {
  togetherEl.hidden = true;
  togetherBtn.setAttribute('aria-expanded', 'false');
}

togetherBtn.onclick = () => (togetherEl.hidden ? openTogether() : closeTogether());
document.addEventListener('pointerdown', (e) => {
  if (!togetherEl.hidden && !togetherEl.contains(e.target) && !togetherBtn.contains(e.target)) closeTogether();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !togetherEl.hidden) { e.stopPropagation(); closeTogether(); }
}, true);

// после перезапуска окна (dev) — вернуть состояние румы
renderTogetherChip();
api.together.status().then((r) => { Together.room = r; renderTogetherChip(); }).catch(() => {});
