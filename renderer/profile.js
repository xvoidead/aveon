'use strict';

// ---------- профиль ----------
// Слева сверху — кто вошёл и как давно синхронизировались. Клик открывает страницу профиля поверх
// библиотеки: имя, что подключено (сервисы, Discord, микрофон, папки), статистика прослушивания
// (рисует extras.js в #stats), устройства аккаунта и действия с ним.

const profileEl = $('#profile');
const profileBtn = $('#open-profile');
const pf = { devices: null, devicesError: '', loadingDevices: false };

const profileOpen = () => !profileEl.hidden;
const displayName = () => state.account.name || state.account.login || 'гость';
const initial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();
const avatarUrl = () => state.cfg.ui?.avatar || '';

// Аватар: своя картинка или первая буква имени на градиенте
function paintAvatar(el, name) {
  const url = avatarUrl();
  el.classList.toggle('has-pic', !!url);
  el.style.backgroundImage = url ? `url("${url}")` : '';
  el.textContent = url ? '' : initial(name);
}

// Картинка → квадрат 256×256 по центру, JPEG. Небольшой, чтобы спокойно синхронизироваться
function cropAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error('Это не картинка')); return; }
    if (file.size > 20 * 1024 * 1024) { reject(new Error('Картинка больше 20 МБ')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Картинка не открылась')); };
    img.src = url;
  });
}

async function setAvatar(dataUrl) {
  await saveCfg({ ui: { avatar: dataUrl } });
  renderMe();
  if (profileOpen()) renderProfileParts(['hero']);
}

function pickAvatar() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await setAvatar(await cropAvatar(file));
      toast('Аватар обновлён');
    } catch (e) { toast(e.message, 'err'); }
  };
  input.click();
}

function avatarMenu(anchor) {
  showMenu([
    { label: avatarUrl() ? 'Загрузить другое фото' : 'Загрузить фото', icon: 'i-user', onClick: pickAvatar },
    ...(avatarUrl() ? [{ sep: true }, { label: 'Убрать фото', icon: 'i-trash', danger: true, onClick: () => setAvatar('').then(() => toast('Аватар убран')) }] : []),
  ], { anchor });
}

function syncLine() {
  const a = state.account;
  if (!a.loggedIn) return 'не в аккаунте';
  if (a.syncing) return 'синхронизация…';
  if (a.error) return 'нет связи с сервером';
  return a.lastSync ? `синхронизировано ${syncedAgo(a.lastSync)}` : 'ещё не синхронизировано';
}

// Плашка слева сверху
function renderMe() {
  const name = displayName();
  paintAvatar($('#me-avatar'), name);
  $('#me-name').textContent = name;
  const sub = $('#me-sub');
  sub.textContent = syncLine();
  sub.classList.toggle('err', !!state.account.error);
  profileBtn.title = `${name} — профиль и статистика`;
}
setInterval(renderMe, 30000); // «5 мин назад» стареет само

// ---- что подключено ----

function connections() {
  const c = state.cfg;
  const d = c.duck;
  const tracks = state.local.length;
  const folders = c.localFolders.length;
  return [
    {
      id: 'ym', name: 'Яндекс Музыка', on: !!c.has['ym.token'], brand: '#ffcc00',
      detail: c.has['ym.token'] ? 'поиск, «Мне нравится», плейлисты' : 'нужен OAuth-токен',
    },
    {
      id: 'sc', name: 'SoundCloud', on: !!c.sc.clientId, brand: '#ff5500',
      detail: !c.sc.clientId ? 'нужен client_id' : c.has['sc.token'] ? 'поиск и лайки по токену' : c.sc.profile ? 'поиск и лайки профиля' : 'только поиск',
    },
    {
      id: 'sp', name: 'Spotify', on: !!state.sp.connected, brand: '#1ed760',
      detail: state.sp.connected ? `вход: ${state.sp.name || 'выполнен'}` : 'лайки и плейлисты',
    },
    {
      id: 'discord', name: 'Discord', on: c.discord?.enabled !== false && discordStatus.connected, brand: '#5865f2',
      detail: c.discord?.enabled === false ? 'статус выключен' : discordStatus.connected ? 'статус «Слушает» виден' : 'Discord не запущен',
    },
    {
      id: 'mic', name: 'Микрофон', on: d.enabled && d.includeMic && !mic.error, brand: 'var(--voice)',
      detail: !d.includeMic ? 'на твой голос не реагирует' : mic.error ? `недоступен: ${mic.error}` : 'бочка и на твой голос',
    },
    {
      id: 'local', name: 'Свои файлы', on: folders > 0, brand: 'var(--amber)',
      detail: folders ? `${folders} ${plural(folders, 'папка', 'папки', 'папок')}, ${tracks} ${plural(tracks, 'трек', 'трека', 'треков')}` : 'папки не добавлены',
    },
  ];
}

function connectionsHtml() {
  const list = connections();
  const n = list.filter((x) => x.on).length;
  return `<h2 class="pf-h">Подключено <span>${n} из ${list.length}</span></h2>
    <div class="pf-conn">${list.map((x) => `
      <button class="pf-service${x.on ? ' on' : ''}" data-conn="${x.id}" style="--brand:${x.brand}">
        <span class="pf-dot"></span>
        <span class="pf-service-main"><b>${esc(x.name)}</b><small>${esc(x.detail)}</small></span>
        <span class="pf-service-go">${x.on ? 'настроить' : 'подключить'}</span>
      </button>`).join('')}
    </div>`;
}

// ---- устройства ----

function deviceAgo(sec) {
  return syncedAgo(sec * 1000).replace('ещё не было', 'давно');
}

function devicesHtml() {
  let body;
  if (pf.devicesError) body = `<p class="muted">Список не загрузился: ${esc(pf.devicesError)}</p>`;
  else if (!pf.devices) body = '<div class="spinner small"></div>';
  else {
    body = `<ul class="pf-devices">${pf.devices.map((s) => `
      <li><svg><use href="#i-device"/></svg>
        <span class="pf-device-main"><b>${esc(s.device || 'без имени')}</b><small>${s.current ? 'это устройство' : `был в сети ${esc(deviceAgo(s.last_used))}`}</small></span>
        ${s.current ? '<span class="pf-here">здесь</span>' : ''}</li>`).join('')}</ul>`;
  }
  const others = pf.devices ? pf.devices.filter((s) => !s.current).length : 0;
  return `<h2 class="pf-h">Устройства${pf.devices ? ` <span>${pf.devices.length}</span>` : ''}</h2>${body}
    ${others ? '<button class="btn" id="pf-logout-all">Выйти на других устройствах</button>' : ''}`;
}

async function loadDevices() {
  if (pf.loadingDevices || !state.account.loggedIn) return;
  pf.loadingDevices = true;
  try {
    const me = await api.account.me();
    pf.devices = me.sessions || [];
    pf.devicesError = '';
  } catch (e) {
    pf.devicesError = e.message;
  }
  pf.loadingDevices = false;
  if (profileOpen()) renderProfileParts(['devices']);
}

// ---- страница ----

function heroHtml() {
  const a = state.account;
  const name = displayName();
  const host = (a.server || '').replace(/^https?:\/\//, '');
  return `
    <button class="pf-avatar" id="pf-avatar" aria-label="Сменить аватар" title="Сменить аватар" aria-haspopup="menu"></button>
    <div class="pf-who">
      <div class="pf-name"><h1>${esc(name)}</h1>
        <button class="icon-btn small" id="pf-rename" aria-label="Изменить имя" title="Изменить имя"><svg><use href="#i-pencil"/></svg></button></div>
      <p class="pf-login">@${esc(a.login || '')}${host ? ` · ${esc(host)}` : ''}</p>
      <p class="pf-sync${a.error ? ' err' : ''}">${esc(syncLine())}${a.error ? `: ${esc(a.error)}` : ''}</p>
    </div>
    <div class="pf-hero-actions">
      <button class="btn primary" id="pf-sync"${a.syncing ? ' disabled' : ''}><svg><use href="#i-refresh"/></svg>Синхронизировать</button>
      <button class="btn" id="pf-settings"><svg><use href="#i-settings"/></svg>Настройки</button>
    </div>`;
}

function accountHtml() {
  return `<h2 class="pf-h">Аккаунт</h2>
    <p class="muted pf-note">Альбомы, эквалайзер, настройки бочки и статистика одинаковые на всех твоих компьютерах. Токены сервисов, папки с музыкой и микрофон остаются только здесь.</p>
    <div class="row-actions">
      <button class="btn" id="pf-password">Сменить пароль</button>
      <button class="btn" id="pf-logout">Выйти</button>
      <button class="btn danger" id="pf-delete">Удалить аккаунт</button>
    </div>`;
}

const PF_PARTS = {
  hero: ['#pf-hero', heroHtml],
  conn: ['#pf-connected', connectionsHtml],
  devices: ['#pf-devices', devicesHtml],
  account: ['#pf-account', accountHtml],
};

function renderProfileParts(parts = Object.keys(PF_PARTS)) {
  for (const p of parts) {
    const [sel, html] = PF_PARTS[p];
    $(sel, profileEl).innerHTML = html();
  }
  bindProfile();
}

function renderProfile() {
  renderProfileParts();
  renderStats(); // extras.js
}

function openProfile({ to } = {}) {
  closeLyrics();
  closeMenu();
  stats.month = stats.month || monthKey();
  profileEl.hidden = false;
  profileBtn.setAttribute('aria-expanded', 'true');
  refreshDiscordStatus().then(() => { if (profileOpen()) renderProfileParts(['conn']); }); // presence.js
  renderProfile();
  loadDevices();
  const scroller = $('.profile-scroll', profileEl);
  if (to === 'stats') requestAnimationFrame(() => $('#stats').scrollIntoView({ block: 'start' }));
  else scroller.scrollTop = 0;
}

function closeProfile() {
  if (!profileOpen()) return;
  profileEl.hidden = true;
  profileBtn.setAttribute('aria-expanded', 'false');
}

function bindProfile() {
  const on = (id, fn) => { const el = $(id, profileEl); if (el) el.onclick = fn; };
  const av = $('#pf-avatar', profileEl);
  if (av) {
    paintAvatar(av, displayName());
    av.onclick = () => (av.getAttribute('aria-expanded') === 'true' ? closeMenu() : avatarMenu(av));
  }
  on('#pf-settings', () => openSettings());
  on('#pf-rename', async () => {
    const name = await ask({ title: 'Как тебя зовут', text: 'Имя видят друзья в «Слушать вместе» и в кодах альбомов.', value: state.account.name || '', ok: 'Сохранить' });
    if (!name || name === state.account.name) return;
    try {
      state.account = await api.account.rename(name);
      toast('Имя сохранено');
      renderMe();
      renderProfileParts(['hero']);
    } catch (err) { toast(err.message, 'err'); }
  });
  on('#pf-sync', async (e) => {
    e.currentTarget.disabled = true;
    try { await api.account.sync(); toast('Синхронизировано'); } catch (err) { toast(err.message, 'err'); }
    state.account = await api.account.status().catch(() => state.account);
    renderMe();
    if (profileOpen()) renderProfileParts(['hero']);
  });
  on('#pf-password', async () => {
    const old = await ask({ title: 'Смена пароля', text: 'Текущий пароль', ok: 'Дальше', password: true });
    if (!old) return;
    const next = await ask({ title: 'Смена пароля', text: 'Новый пароль, не короче 8 символов. На других устройствах нужно будет войти заново.', ok: 'Сменить', password: true });
    if (!next) return;
    try { await api.account.password(old, next); toast('Пароль изменён'); pf.devices = null; loadDevices(); } catch (err) { toast(err.message, 'err'); }
  });
  on('#pf-logout-all', async () => {
    try {
      const r = await api.account.logoutAll();
      toast(r.closed ? `Закрыто сессий: ${r.closed}` : 'Других сессий нет');
      loadDevices();
    } catch (err) { toast(err.message, 'err'); }
  });
  on('#pf-logout', async () => {
    const ok = await ask({ title: 'Выйти из аккаунта?', text: 'Альбомы и статистика останутся на этом компьютере. Чтобы слушать дальше, нужно будет войти снова.', ok: 'Выйти', input: false });
    if (!ok) return;
    state.account = await api.account.logout();
    closeProfile();
    showAuth();
    toast('Выход выполнен. Альбомы и статистика остались на этом компьютере');
  });
  on('#pf-delete', async () => {
    const password = await ask({
      title: 'Удалить аккаунт?',
      text: 'С сервера пропадут альбомы, настройки и статистика. На этом компьютере всё останется. Введи пароль, чтобы подтвердить.',
      ok: 'Удалить', danger: true, password: true,
    });
    if (!password) return;
    try {
      state.account = await api.account.remove(password);
      closeProfile();
      setAuthMode('register');
      showAuth();
      toast('Аккаунт удалён');
    } catch (err) { toast(err.message, 'err'); }
  });
  $$('[data-conn]', profileEl).forEach((b) => { b.onclick = () => openSettings(b.dataset.conn); });
}

profileBtn.onclick = () => (profileOpen() ? closeProfile() : openProfile());
$('#profile-close').onclick = closeProfile;
// Esc закрывает профиль, только если поверх него ничего не открыто. Слушаем на погружении:
// иначе обработчик app.js успел бы закрыть настройки, и тот же Esc закрыл бы и профиль
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !profileOpen() || locked()) return;
  if (['#settings', '#eq', '#editor', '#dialog', '#fs'].some((id) => !$(id).hidden) || !$('#menu').hidden || !$('#together').hidden) return;
  closeProfile();
}, true);
window.addEventListener('resize', () => { if (profileOpen()) renderStats(); });

// Аккаунт поменялся (синхронизация, вход, выход) — обновляем плашку и открытый профиль
api.account.onEvent(() => {
  renderMe();
  if (profileOpen()) renderProfileParts(['hero']);
});
