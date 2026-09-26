'use strict';
// Совместные плейлисты: один список на несколько человек, каждый добавляет свои треки, правки видны
// всем. Живут на сервере аккаунтов (src/account.js → collab), открываются во вкладке «Альбомы»
// (state.sub = 'collab:КОД'). Пока плейлист открыт, раз в 15 секунд проверяем, не добавил ли кто-то новое.
// Общие глобальные: state, api, $, esc, toast, ask, showMenu, openView, renderTracks, showEmpty, summary,
// plural, firstName, copyText, prettyCode, shareable, viewSeq.

const Collab = { list: [], cur: null, poll: 0, loaded: false };
const COLLAB_POLL_MS = 15000;
const collabSub = () => (state.view === 'albums' && state.sub?.startsWith('collab:') ? state.sub.slice(7) : null);

async function loadCollabs() {
  if (!state.account.loggedIn) { Collab.list = []; return; }
  try { Collab.list = (await api.collab('list')) || []; } catch { Collab.list = []; } // старый сервер — просто без них
  Collab.loaded = true;
  if (state.view === 'albums') renderCollections();
}

// Фишки в ряду «Альбомов» (app.js → renderCollections)
function collabChips(chip) {
  if (!state.account.loggedIn) return;
  if (!Collab.loaded) loadCollabs();
  for (const c of Collab.list) {
    chip(c.title, { active: state.sub === `collab:${c.code}`, icon: 'i-together', count: c.count, onClick: () => openView('albums', `collab:${c.code}`) });
  }
  chip('Совместный', { icon: 'i-together', onClick: (e) => collabNewMenu(e) });
}

function collabNewMenu(e) {
  showMenu([
    { label: 'Создать совместный плейлист', icon: 'i-plus', onClick: () => createCollab() },
    { label: 'Войти по коду друга', icon: 'i-code', onClick: () => joinCollabAsk() },
  ], { anchor: e?.currentTarget || e?.target });
}

async function createCollab(tracks = []) {
  const title = await ask({ title: 'Совместный плейлист', text: 'Создай и отправь код друзьям — каждый сможет добавлять свои треки, а список будет общим.', ok: 'Создать', value: '' });
  if (!title) return;
  try {
    const { code } = await api.collab('create', null, { title, tracks: tracks.map(shareable) });
    await loadCollabs();
    openView('albums', `collab:${code}`);
    collabCopyCode(code, title);
  } catch (e) { toast(e.message, 'err'); }
}

async function joinCollabAsk() {
  const text = await ask({ title: 'Войти в совместный плейлист', text: 'Вставь код, который прислал друг.', ok: 'Войти', value: '' });
  if (text) joinCollab(text);
}

async function joinCollab(text) {
  const code = String(text).toUpperCase().replace(/^.*COLLAB:/, '').replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) { toast('Код совместного плейлиста — восемь букв и цифр', 'err'); return; }
  try {
    const c = await api.collab('join', code);
    await loadCollabs();
    openView('albums', `collab:${c.code}`);
    toast(`Ты в плейлисте «${c.title}»`);
  } catch (e) { toast(e.message, 'err'); }
}

async function collabCopyCode(code, title) {
  const text = `aveon:collab:${prettyCode(code)}`;
  const ok = await copyText(text);
  toast(ok ? `Код «${title}» скопирован — отправь друзьям, они нажмут Ctrl+V в авеоне` : `Код: ${prettyCode(code)}`);
}

// ---------- открытый плейлист ----------

async function openCollab(code, seq) {
  state.album = null;
  let c;
  try { c = await api.collab('get', code); } catch (e) {
    if (seq !== viewSeq) return;
    Collab.cur = null;
    showEmpty({ title: 'Плейлист не открылся', text: e.message, actions: [['К альбомам', () => openView('albums')]] });
    await loadCollabs();
    return;
  }
  if (seq !== viewSeq) return;
  Collab.cur = c;
  renderCollab(false);
  clearInterval(Collab.poll);
  Collab.poll = setInterval(pollCollab, COLLAB_POLL_MS);
}

async function pollCollab() {
  const code = collabSub();
  if (!code || !Collab.cur || Collab.cur.code !== code) { clearInterval(Collab.poll); return; }
  if (document.hidden) return;
  try {
    const c = await api.collab('get', code);
    if (c.rev === Collab.cur.rev || collabSub() !== code) return;
    const added = c.tracks.length - Collab.cur.tracks.length;
    const last = c.tracks[c.tracks.length - 1];
    Collab.cur = c;
    renderCollab(true);
    if (added > 0 && last?.by?.name) toast(`${firstName(last.by.name)} добавляет «${last.title}»`);
  } catch {}
}

function renderCollab(keepScroll) {
  const c = Collab.cur;
  if (!c || collabSub() !== c.code) return;
  $('#view-title').textContent = c.title;
  const who = c.members.map((m) => firstName(m.name));
  const people = who.length > 1 ? `вместе: ${who.slice(0, 4).join(', ')}${who.length > 4 ? ` и ещё ${who.length - 4}` : ''}` : 'пока только ты — отправь код друзьям';
  if (!c.tracks.length) {
    showEmpty({
      title: 'Плейлист пока пустой',
      text: `Добавляй треки через «⋯» → «${c.title}». Код для друзей: ${prettyCode(c.code)}.`,
      actions: [['Скопировать код', () => collabCopyCode(c.code, c.title), true]],
    });
    return;
  }
  const q = (state.queries.albums || '').trim().toLowerCase();
  const tracks = q ? c.tracks.filter((t) => `${t.title} ${t.artist} ${t.by?.name || ''}`.toLowerCase().includes(q)) : c.tracks;
  if (!tracks.length) { showEmpty({ title: 'Ничего не нашлось', text: 'В этом плейлисте нет совпадений.' }); return; }
  const list = $('#tracklist');
  const top = list.scrollTop;
  // кто добавил — на месте альбома; треки играют как присланные другом (share.js: cleanTrack)
  const shown = tracks.map((x) => { const t = cleanTrack(x); return t && { ...t, album: x.by?.name ? `добавлено: ${firstName(x.by.name)}` : t.album }; }).filter(Boolean);
  renderTracks(shown, `${summary(tracks)} · ${people}`);
  if (keepScroll) list.scrollTop = top;
}

// Кнопки над списком (app.js → renderActions)
function collabActions(add) {
  const c = Collab.cur;
  if (!c || collabSub() !== c.code) return;
  const iconBtn = (icon, fn, label) => { const b = add('', icon, fn); b.setAttribute('aria-label', label); b.title = label; };
  iconBtn('i-copy', () => collabCopyCode(c.code, c.title), 'Скопировать код для друзей');
  iconBtn('i-pencil', async () => {
    const title = await ask({ title: 'Переименовать плейлист', value: c.title, ok: 'Сохранить' });
    if (!title || title === c.title) return;
    try { await api.collab('rename', c.code, { title }); c.title = title; await loadCollabs(); renderCollab(true); } catch (e) { toast(e.message, 'err'); } // сервер пустит только владельца
  }, 'Переименовать');
  iconBtn('i-enter', async () => {
    const ok = await ask({ title: `Выйти из «${c.title}»?`, text: 'Плейлист останется у остальных. Вернуться можно по коду.', ok: 'Выйти', input: false, danger: true });
    if (ok === null) return;
    try { await api.collab('leave', c.code); Collab.cur = null; await loadCollabs(); openView('albums'); } catch (e) { toast(e.message, 'err'); }
  }, 'Выйти из плейлиста');
}

// «⋯» у трека: добавить в совместный (app.js → albumMenuItems) и убрать из открытого (openTrackMenu)
function collabMenuItems(tracks) {
  const open = collabSub();
  const lists = Collab.list.filter((c) => c.code !== open);
  if (!lists.length) return [];
  return [{ note: 'В совместный плейлист' }, ...lists.map((c) => ({ label: c.title, icon: 'i-together', count: c.count, onClick: () => addToCollab(c, tracks) }))];
}

async function addToCollab(c, tracks) {
  try {
    await api.collab('add', c.code, { tracks: tracks.map(shareable) });
    toast(tracks.length === 1 ? `Добавлено в «${c.title}» — друзья увидят` : `Треки добавлены в «${c.title}»`);
    loadCollabs();
  } catch (e) { toast(e.message, 'err'); }
}

function collabRemoveItem(t) {
  const c = Collab.cur;
  if (!c || collabSub() !== c.code) return null;
  return {
    label: 'Убрать из плейлиста', icon: 'i-trash', danger: true,
    onClick: async () => {
      try {
        await api.collab('remove', c.code, { ids: [t.id.replace(/^shared:/, '')] });
        Collab.cur = await api.collab('get', c.code);
        renderCollab(true);
        loadCollabs();
      } catch (e) { toast(e.message, 'err'); } // убрать может добавивший или владелец
    },
  };
}
