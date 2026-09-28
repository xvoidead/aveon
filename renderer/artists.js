// ---------- артисты ----------
// Вкладка «Артисты» собирает всю библиотеку: свои файлы, свои альбомы и лайки подключённых сервисов.
// Страница артиста — его дискография из Яндекс Музыки (популярное, альбомы, синглы) и то, что есть
// у тебя, сложенное по альбомам. Совместные треки («A feat. B») есть у обоих артистов.
// state.sub: ключ артиста, для открытого альбома — «ключ\u0001ym:id альбома».

const ART_SOURCES = ['ym', 'sc', 'sp'];
const SUB_SEP = '\u0001';
const art = {
  tracks: [], index: new Map(), sort: 'name', loading: new Set(), seq: 0,
  names: new Map(),  // ключ → имя, для артистов, которых нет в библиотеке (открыли по ссылке)
  disco: new Map(),  // ключ → { status: loading | ok | none | error, data, error }
  albums: new Map(), // ym:id → альбом с треками
  ymHints: new Map(), // ключ → id артиста в Яндекс Музыке (из поиска), чтобы не искать по имени
};

const artistKey = (name) => String(name || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const normTitle = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}()]+/gu, ' ').trim();
// Чей вариант трека показывать, если он есть в нескольких местах
const SOURCE_RANK = { local: 0, ym: 1, sc: 2, sp: 3 };

// Имена исполнителей ссылками — для строк треков и «сейчас играет».
// Разделители («, », « & », « feat. ») остаются текстом как были
function artistLinks(s) {
  if (!s) return '';
  return s.split(/(\s*,\s*|\s+&\s+|\s+feat\.?\s+|\s+ft\.?\s+)/i)
    .map((part, i) => (i % 2 ? esc(part) : part.trim() ? `<span class="a-link" data-artist="${esc(part.trim())}">${esc(part)}</span>` : ''))
    .join('');
}

async function collectLibrary() {
  const seen = new Set();
  const out = [];
  const add = (list) => { for (const t of list || []) if (t?.id && !seen.has(t.id)) { seen.add(t.id); out.push(t); } };
  add(state.opened);
  add(state.local);
  const albums = await Promise.all(state.albums.map((a) => api.albums.get(a.id).then((x) => x.tracks).catch(() => [])));
  albums.forEach(add);
  for (const src of ART_SOURCES) add(state.cache[`${src}:likes`]);
  return out;
}

// Лайки подключённых сервисов, которые ещё не загружались, подтягиваем в фоне
function loadMissingLikes() {
  for (const src of ART_SOURCES) {
    const key = `${src}:likes`;
    if (state.cache[key] || art.loading.has(src) || !serviceReady(src)) continue;
    if (src === 'sc' && !state.cfg.has['sc.token'] && !state.cfg.sc.profile) continue;
    art.loading.add(src);
    api.source.collection(src, 'likes')
      .then((tracks) => { state.cache[key] = tracks; })
      .catch(() => {})
      .finally(() => {
        art.loading.delete(src);
        if (state.view === 'artists') openArtists(state.sub, { keepScroll: true });
      });
  }
}

function buildIndex(tracks) {
  const index = new Map();
  for (const t of tracks) {
    const names = splitArtists(t.artist);
    for (const name of names.length ? names : ['']) {
      const key = artistKey(name);
      let a = index.get(key);
      if (!a) index.set(key, (a = { key, names: new Map(), tracks: [], cover: '' }));
      a.names.set(name, (a.names.get(name) || 0) + 1);
      a.tracks.push(t);
      if (!a.cover && t.cover) a.cover = t.cover;
    }
  }
  // Как писать имя: самый частый вариант написания
  for (const a of index.values()) {
    a.name = [...a.names].sort((x, y) => y[1] - x[1])[0][0] || 'Исполнитель неизвестен';
    a.count = uniqueTracks(a.tracks).length; // без повторов — как на странице артиста
  }
  return index;
}

function sourcesLine() {
  const parts = [];
  if (state.local.length || state.opened.length) parts.push('свои файлы');
  if (state.albums.length) parts.push('альбомы');
  for (const src of ART_SOURCES) if (state.cache[`${src}:likes`]) parts.push(`лайки ${NAMES[src]}`);
  const loading = [...art.loading].map((s) => NAMES[s]);
  return (parts.length ? `Из: ${parts.join(', ')}` : '') + (loading.length ? `${parts.length ? '. ' : ''}Подтягиваю лайки: ${loading.join(', ')}…` : '');
}

// Артист из библиотеки или «пустой» — если открыли по ссылке того, чьих треков у тебя нет
function artistFor(key) {
  return art.index.get(key) || { key, name: art.names.get(key) || key, tracks: [], cover: '', count: 0 };
}

async function openArtists(sub, { keepScroll = false } = {}) {
  const seq = ++art.seq;
  const scroll = $('#tracklist').scrollTop;
  if (!art.tracks.length) showEmpty({ loading: true, text: 'Собираю артистов…' });
  const tracks = await collectLibrary();
  if (seq !== art.seq || state.view !== 'artists') return;
  art.tracks = tracks;
  art.index = buildIndex(tracks);
  loadMissingLikes();
  const [key, albumId] = (sub || '').split(SUB_SEP);
  // своих артистов нет (ни файлов, ни лайков) — вместо пустого раздела последний, у кого был
  const last = !key && !art.index.size && lastArtist();
  if (last) {
    art.names.set(last.key, last.name);
    if (last.ym && !art.ymHints.has(last.key)) art.ymHints.set(last.key, last.ym);
    openView('artists', last.key);
    return;
  }
  if (key && albumId) openDiscAlbum(artistFor(key), albumId);
  else if (key) renderArtist(artistFor(key));
  else renderArtistGrid();
  if (keepScroll) $('#tracklist').scrollTop = scroll;
}

function renderArtistChips(artist, inAlbum = false) {
  const box = $('#collections');
  box.innerHTML = '';
  const chip = (label, icon, active, onClick) => {
    const b = document.createElement('button');
    b.className = `chip${active ? ' active' : ''}`;
    b.innerHTML = `${icon ? `<svg><use href="#${icon}"/></svg>` : ''}<span>${esc(label)}</span>`;
    b.onclick = onClick;
    box.append(b);
  };
  if (artist) {
    // своих артистов нет — «Все артисты» вернули бы сюда же, кнопка не нужна
    if (art.index.size) chip('Все артисты', 'i-prev', false, () => openView('artists'));
    // к артисту из альбома — сначала запоминаем, где обложка альбома: при смене раздела список очищают,
    // а она потом полетит обратно на свою карточку (zoomFly)
    if (inAlbum) chip(artist.name, 'i-user', false, () => { rememberAlbumPic(); openView('artists', artist.key); });
    return;
  }
  if (!art.index.size) return; // артистов нет — и сортировать нечего
  chip('А–Я', '', art.sort === 'name', () => { art.sort = 'name'; renderArtistGrid(); });
  chip('Больше треков', '', art.sort === 'count', () => { art.sort = 'count'; renderArtistGrid(); });
}

function renderArtistGrid() {
  $('#content').classList.remove('hero-on');
  renderArtistChips(null);
  $('#view-title').textContent = NAMES.artists;
  const q = artistKey(state.queries.artists);
  let list = [...art.index.values()].filter((a) => a.key && (!q || a.key.includes(q)));
  list.sort(art.sort === 'count'
    ? (x, y) => y.count - x.count || x.name.localeCompare(y.name, 'ru')
    : (x, y) => x.name.localeCompare(y.name, 'ru'));
  if (!art.index.size) {
    showEmpty({
      title: art.loading.size ? 'Собираю артистов…' : 'Артистов пока нет',
      text: art.loading.size ? sourcesLine() : 'Здесь появятся исполнители из твоих файлов, альбомов и лайков подключённых сервисов.',
      loading: !!art.loading.size,
      actions: art.loading.size ? [] : [['Добавить папку', addFolder, true], ['Настройки', () => openSettings()]],
    });
    renderArtistChips(null);
    return;
  }
  if (!list.length) { showEmpty({ title: 'Никого не нашлось', text: 'Среди твоих артистов нет такого имени.' }); renderArtistChips(null); return; }
  state.shown = [];
  $('#empty').hidden = true;
  const el = $('#tracklist');
  el.hidden = false;
  el.innerHTML = `<div class="artist-grid">${list.map((a) => `
    <button class="artist-card" data-artist-key="${esc(a.key)}">
      <span class="artist-pic">${a.cover ? `<img loading="lazy" decoding="async" src="${esc(a.cover)}" alt="">` : esc(a.name.trim()[0]?.toUpperCase() || '♪')}</span>
      <span class="artist-card-name">${esc(a.name)}</span>
      <span class="artist-count">${a.count} ${plural(a.count, 'трек', 'трека', 'треков')}</span>
    </button>`).join('')}</div>`;
  $('#view-sub').textContent = `${list.length} ${plural(list.length, 'артист', 'артиста', 'артистов')}. ${sourcesLine()}`;
  renderActions();
}

// Треки без повторов: одна песня из разных мест — один раз, свой файл важнее сервиса
function uniqueTracks(tracks) {
  const best = new Map();
  for (const t of tracks) {
    const k = normTitle(t.title);
    const cur = best.get(k);
    const score = (x) => (x.playable === false ? 10 : 0) + (x.preview ? 5 : 0) + (SOURCE_RANK[x.source] ?? 9);
    if (!cur || score(t) < score(cur)) best.set(k, t);
  }
  return [...best.values()];
}

function artistAlbums(artist) {
  const q = normTitle(state.queries.artists);
  const tracks = uniqueTracks(artist.tracks).filter((t) => !q || normTitle(`${t.title} ${t.album}`).includes(q));
  const groups = new Map();
  for (const t of tracks) {
    const k = normTitle(t.album);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { key: k, titles: new Map(), tracks: [], cover: '' }));
    g.titles.set(t.album, (g.titles.get(t.album) || 0) + 1);
    g.tracks.push(t);
    if (!g.cover && t.cover) g.cover = t.cover;
  }
  const list = [...groups.values()].map((g) => ({ ...g, title: g.key ? [...g.titles].sort((x, y) => y[1] - x[1])[0][0] : '' }));
  // Сначала альбомы (больше треков — выше), в конце треки без альбома
  list.sort((x, y) => (!x.key) - (!y.key) || y.tracks.length - x.tracks.length || x.title.localeCompare(y.title, 'ru'));
  return list;
}

// ---------- дискография из Яндекс Музыки ----------

// id артиста в Яндексе из треков библиотеки — так не нужно искать по имени
function ymArtistId(artist) {
  if (art.ymHints.has(artist.key)) return art.ymHints.get(artist.key); // открыли из поиска Яндекса
  for (const t of artist.tracks) {
    const a = t.source === 'ym' && t.ref?.artists?.find((x) => artistKey(x.name) === artist.key);
    if (a) return a.id;
  }
  return null;
}

async function loadDisco(artist) {
  art.disco.set(artist.key, { status: 'loading' });
  let entry;
  try {
    const data = await api.artist.info(artist.name, ymArtistId(artist));
    entry = data ? { status: 'ok', data } : { status: 'none' };
  } catch (e) {
    entry = { status: 'error', error: e.message };
  }
  art.disco.set(artist.key, entry);
  if (state.view === 'artists' && state.sub === artist.key) renderArtist(artistFor(artist.key), { keepScroll: true });
}

function discoCards(albums, libTitles) {
  return `<div class="disc-grid">${albums.map((a) => {
    const mine = libTitles.get(normTitle(a.title));
    const meta = [a.year, a.count ? `${a.count} ${plural(a.count, 'трек', 'трека', 'треков')}` : ''].filter(Boolean).join(' · ');
    return `<button class="disc-card" data-disc="${esc(a.id)}">
      <span class="disc-pic">${a.cover ? `<img loading="lazy" decoding="async" src="${esc(a.cover)}" alt="">` : '♪'}${mine ? `<span class="disc-mine">у тебя ${mine}</span>` : ''}</span>
      <span class="disc-title">${esc(a.title)}</span>
      <span class="disc-meta">${meta}</span>
    </button>`;
  }).join('')}</div>`;
}

// ---------- шапка артиста ----------
// Фоновое видео артиста из Яндекса (или крупное фото), аватарка, имя и слушатели за месяц

const fmtNum = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '').replace('.', ',')} млн`
  : n >= 1e4 ? `${Math.round(n / 1e3)} тыс.` : n.toLocaleString('ru'));
// После «млн» и «тыс.» — всегда «слушателей», иначе по обычным правилам
const pluralNum = (n, one, few, many) => (n >= 1e4 ? many : plural(n, one, few, many));

function heroHtml(artist, disco, loading) {
  const photo = disco?.cover || artist.cover;
  const banner = disco?.banner || photo;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bg = disco?.video && !calm
    ? `<video class="hero-bg" src="${esc(disco.video)}" poster="${esc(banner)}" autoplay muted loop playsinline disablepictureinpicture></video>`
    : `<div class="hero-bg${banner ? '' : ' empty'}" data-bg="${esc(banner || '')}"></div>`;
  const stats = [];
  if (disco?.listeners != null) {
    const d = disco.listenersDelta;
    const delta = d ? ` <span class="${d > 0 ? 'up' : 'down'}" title="За месяц">${d > 0 ? '↑' : '↓'} ${fmtNum(Math.abs(d))}</span>` : '';
    stats.push(`<b>${fmtNum(disco.listeners)}</b> ${pluralNum(disco.listeners, 'слушатель', 'слушателя', 'слушателей')} за месяц${delta}`);
  }
  if (disco?.likes) stats.push(`<b>${fmtNum(disco.likes)}</b> ${pluralNum(disco.likes, 'лайк', 'лайка', 'лайков')}`);
  if (!disco && artist.count) stats.push(`у тебя ${artist.count} ${plural(artist.count, 'трек', 'трека', 'треков')}`);
  if (loading) stats.push('загружаю из Яндекс Музыки…');
  const years = disco?.years || [];
  const meta = [...(disco?.countries || []), years.length > 1 ? years.join('–') : years.length ? `с ${years[0]}` : ''].filter(Boolean).join(' · ');
  const color = /^#[0-9a-f]{6}$/i.test(disco?.color || '') ? ` style="--hero:${disco.color}"` : '';
  const canPlay = state.shown.length > 0;
  return `<section class="artist-hero"${color}>
    ${bg}
    <div class="hero-shade"></div>
    <div class="hero-body">
      <span class="hero-pic">${photo ? `<img src="${esc(photo)}" alt="">` : esc(artist.name.trim()[0]?.toUpperCase() || '♪')}</span>
      <div class="hero-text">
        <span class="hero-kind">Артист</span>
        <h2 class="hero-name">${esc(artist.name)}</h2>
        ${stats.length ? `<p class="hero-stats">${stats.join('<i>·</i>')}</p>` : ''}
        ${meta ? `<p class="hero-meta">${esc(meta)}</p>` : ''}
        <div class="hero-actions">
          <button class="btn primary" data-hero="play" ${canPlay ? '' : 'disabled'}><svg><use href="#i-play"/></svg><span>Слушать</span></button>
          <button class="btn" data-hero="shuffle" ${canPlay ? '' : 'disabled'}><svg><use href="#i-shuffle"/></svg><span>Вперемешку</span></button>
        </div>
      </div>
    </div>
  </section>`;
}

const sectionHead = (title, count) => `<h3 class="disc-h">${esc(title)}${count != null ? `<span>${count}</span>` : ''}</h3>`;

// Последний артист, на чьей странице был — его и открываем, если своих артистов нет
function lastArtist() {
  try { const a = JSON.parse(localStorage.getItem('aveon.lastArtist') || 'null'); return a?.key ? a : null; } catch { return null; }
}
function rememberArtist(artist) {
  try { localStorage.setItem('aveon.lastArtist', JSON.stringify({ key: artist.key, name: artist.name, ym: ymArtistId(artist) || null })); } catch {}
}

function renderArtist(artist, { keepScroll = false } = {}) {
  rememberArtist(artist);
  renderArtistChips(artist);
  $('#view-title').textContent = artist.name;
  const d = art.disco.get(artist.key);
  if (!d || (d.status === 'error' && !keepScroll)) loadDisco(artist);
  const disco = d?.status === 'ok' ? d.data : null;
  const q = normTitle(state.queries.artists);
  const match = (s) => !q || normTitle(s).includes(q);

  const lib = artistAlbums(artist);
  const libTracks = lib.flatMap((g) => g.tracks);
  const libTitles = new Map();
  for (const t of uniqueTracks(artist.tracks)) if (t.album) libTitles.set(normTitle(t.album), (libTitles.get(normTitle(t.album)) || 0) + 1);
  const popular = disco ? disco.popular.filter((t) => match(t.title)).slice(0, 5) : [];
  const albums = disco ? disco.albums.filter((a) => a.type === 'album' && match(a.title)) : [];
  const singles = disco ? disco.albums.filter((a) => a.type === 'single' && match(a.title)) : [];

  const loading = !d || d.status === 'loading';
  if (!loading && !popular.length && !albums.length && !singles.length && !libTracks.length) {
    showEmpty({ title: 'Ничего не нашлось', text: q ? 'У этого артиста нет таких треков и релизов.' : 'У этого артиста пока ничего нет.' });
    renderArtistChips(artist);
    return;
  }

  const scroll = $('#tracklist').scrollTop;
  state.shown = [...popular, ...libTracks];
  $('#empty').hidden = true;
  const el = $('#tracklist');
  el.hidden = false;
  let i = 0;
  const parts = [heroHtml(artist, disco, loading)];
  $('#content').classList.add('hero-on'); // заголовок раздела прячем — имя уже в шапке
  if (popular.length) parts.push(`<section class="disc-sec">${sectionHead('Популярное')}${popular.map((t) => rowHtml(t, i++)).join('')}</section>`);
  if (loading && !popular.length) parts.push('<div class="disc-loading"><div class="spinner"></div><span>Загружаю дискографию из Яндекс Музыки…</span></div>');
  if (d?.status === 'error') parts.push(`<p class="disc-note">Дискография не загрузилась: ${esc(d.error)}. Открой артиста ещё раз, чтобы повторить.</p>`);
  if (albums.length) parts.push(`<section class="disc-sec">${sectionHead('Альбомы', albums.length)}${discoCards(albums, libTitles)}</section>`);
  if (singles.length) parts.push(`<section class="disc-sec">${sectionHead('Синглы и EP', singles.length)}${discoCards(singles, libTitles)}</section>`);
  if (libTracks.length) {
    parts.push(`<section class="disc-sec">${sectionHead('В твоей библиотеке', libTracks.length)}${lib.map((g) => {
      const from = i;
      const rows = g.tracks.map((t) => rowHtml(t, i++)).join('');
      const title = g.key ? esc(g.title) : 'Отдельные треки';
      return `<section class="artist-album">
        <div class="album-head">
          <span class="album-pic">${g.cover ? `<img loading="lazy" src="${esc(g.cover)}" alt="">` : '♪'}</span>
          <span class="album-meta"><b>${title}</b><span>${summary(g.tracks)}</span></span>
          <button class="icon-btn" data-play-from="${from}" data-play-count="${g.tracks.length}" aria-label="Играть «${title}»" title="Играть"><svg><use href="#i-play"/></svg></button>
        </div>
        ${rows}
      </section>`;
    }).join('')}</section>`);
  }
  // вернулись из альбома этого артиста — обложка улетает из шапки альбома обратно на свою карточку
  const back = zoom.back?.key === artist.key ? zoom.back : null;
  const fromRect = back?.rect;
  const fromSrc = back?.src;
  zoom.back = null;
  el.innerHTML = parts.join('');
  const bg = el.querySelector('.hero-bg[data-bg]');
  if (bg?.dataset.bg) bg.style.backgroundImage = `url("${bg.dataset.bg.replace(/"/g, '%22')}")`;
  // вернулись из альбома — страница там же, откуда его открыли: карточка на месте, и обложке есть куда вернуться
  el.scrollTop = back?.scroll != null ? back.scroll : keepScroll ? scroll : 0;
  if (fromRect) requestAnimationFrame(() => zoomFly(fromRect, el.querySelector(`.disc-card[data-disc="${CSS.escape(back.id)}"] .disc-pic`), fromSrc, back.radius));

  const bits = [];
  if (disco) bits.push(`${disco.albums.length} ${plural(disco.albums.length, 'релиз', 'релиза', 'релизов')} в Яндекс Музыке`);
  else if (d?.status === 'none') bits.push(state.cfg.has['ym.token'] ? 'В Яндекс Музыке не нашёлся' : 'Подключи Яндекс Музыку, чтобы видеть всю дискографию');
  if (libTracks.length) bits.push(`у тебя ${summary(libTracks)}`);
  $('#view-sub').textContent = bits.join(' · ');
  markPlaying();
  renderActions();
}

// ---- zoom-переход, как в iOS 18: обложка из сетки артиста перелетает в шапку альбома и обратно ----
// Летит копия обложки поверх всего (position: fixed), настоящая в шапке появляется, когда долетела.
// zoom.from — откуда вылетела (запомнили при нажатии на карточку), zoom.back — альбом, из которого вернулись
const zoom = { from: null, back: null };
// скругление обложки как есть в этом дизайне (в px страницы): копия начинает с него и приходит к скруглению цели
const radius = (el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
const noMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('look-still');
function zoomFly(from, toEl, src, fromRadius) {
  if (!from || !toEl || noMotion()) return;
  for (const old of document.querySelectorAll('.zoom-clip')) old.remove(); // прошлый полёт, если не доиграл
  // Цель может быть за краем списка в первый миг (шапка ещё сворачивается или разворачивается) — летим всё равно:
  // копия каждый кадр ищет цель заново и обрезается рамкой списка
  if (!toEl.getBoundingClientRect().width) return;
  // Размер интерфейса (look.js → zoom на <html>): прямоугольники приходят уже в экранных пикселях, а копия
  // лежит внутри увеличенной страницы — её координаты делим на масштаб, иначе при 95% она промахивалась
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  // Летит внутри рамки списка, как в iOS: над вкладками, поиском и кнопками раздела не проходит
  const clip = document.createElement('div');
  clip.className = 'zoom-clip';
  const f = document.createElement('div');
  f.className = 'zoom-fly';
  f.innerHTML = src ? `<img src="${esc(src)}" alt="">` : '♪';
  clip.append(f);
  document.body.append(clip);
  toEl.style.visibility = 'hidden';
  // Каждый кадр — заново где цель и где список: пока летит, страница может сдвинуться (шапка библиотеки
  // разворачивается после прокрутки, окно меняют по размеру, догружаются картинки). Раньше копия летела
  // в точку, замеренную в первый миг, и промахивалась на сдвиг
  const T = 480;
  const t0 = performance.now();
  const ease = (x) => 1 - (1 - x) ** 3; // мягкое торможение без перелёта
  const lerp = (a, b, k) => a + (b - a) * k;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    toEl.style.visibility = '';
    clip.remove();
  };
  const frame = () => {
    if (done) return;
    if (!toEl.isConnected) { finish(); return; } // раздел сменили посреди полёта
    const k = ease(Math.min(1, (performance.now() - t0) / T));
    const list = $('#tracklist').getBoundingClientRect();
    const to = toEl.getBoundingClientRect();
    Object.assign(clip.style, { left: `${list.left / z}px`, top: `${list.top / z}px`, width: `${list.width / z}px`, height: `${list.height / z}px` });
    const w = lerp(from.width, to.width, k), h = lerp(from.height, to.height, k);
    Object.assign(f.style, {
      left: `${(lerp(from.left, to.left, k) - list.left) / z}px`,
      top: `${(lerp(from.top, to.top, k) - list.top) / z}px`,
      width: `${w / z}px`, height: `${h / z}px`,
      borderRadius: `${lerp(fromRadius, radius(toEl), k)}px`,
    });
    if (k >= 1) finish(); else requestAnimationFrame(frame);
  };
  frame();
  setTimeout(finish, 1200); // кадры не шли (окно спрятали) — обложку всё равно вернуть
}

function rememberAlbumPic() {
  const pic = $('#tracklist .alb-pic');
  if (!pic || !zoom.back) return;
  zoom.back.rect = pic.getBoundingClientRect();
  zoom.back.src = pic.querySelector('img')?.getAttribute('src');
  zoom.back.radius = radius(pic);
}

// Шапка альбома: крупная обложка, тип, название, год и кнопки — сюда и прилетает обложка
function albumHeroHtml(artist, album, tracks) {
  const kind = album.type === 'single' ? 'Сингл' : 'Альбом';
  const meta = [artist.name, album.year, summary(tracks)].filter(Boolean).join(' · ');
  return `<section class="alb-hero">
    <span class="alb-pic">${album.cover ? `<img src="${esc(album.cover)}" alt="">` : '♪'}</span>
    <div class="alb-text">
      <span class="alb-kind">${kind}</span>
      <h2 class="alb-name">${esc(album.title)}</h2>
      <p class="alb-meta">${esc(meta)}</p>
      <div class="alb-actions">
        <button class="btn primary" data-hero="play"><svg><use href="#i-play"/></svg><span>Слушать</span></button>
        <button class="btn" data-hero="shuffle"><svg><use href="#i-shuffle"/></svg><span>Вперемешку</span></button>
      </div>
    </div>
  </section>`;
}

async function openDiscAlbum(artist, id) {
  $('#content').classList.remove('hero-on');
  renderArtistChips(artist, true);
  const known = art.disco.get(artist.key)?.data?.albums.find((a) => a.id === id);
  $('#view-title').textContent = known?.title || 'Альбом';
  let album = art.albums.get(id);
  if (!album) {
    showEmpty({ loading: true, text: 'Загружаю альбом…' });
    renderArtistChips(artist, true);
    try {
      album = await api.artist.album(id);
      art.albums.set(id, album);
    } catch (e) {
      if (state.sub !== `${artist.key}${SUB_SEP}${id}`) return;
      showEmpty({ title: 'Альбом не загрузился', text: e.message, actions: [['Повторить', () => openView('artists', state.sub), true]] });
      renderArtistChips(artist, true);
      return;
    }
    if (state.view !== 'artists' || state.sub !== `${artist.key}${SUB_SEP}${id}`) return;
  }
  $('#view-title').textContent = album.title;
  const q = normTitle(state.queries.artists);
  const tracks = album.tracks.filter((t) => !q || normTitle(t.title).includes(q));
  const head = [artist.name, album.year, album.type === 'single' ? 'сингл' : ''].filter(Boolean).join(' · ');
  if (!tracks.length) { showEmpty({ title: 'Ничего не нашлось', text: 'В этом альбоме нет таких треков.' }); renderArtistChips(artist, true); return; }
  renderTracks(tracks, `${head} · ${summary(tracks)}`);
  const list = $('#tracklist');
  list.insertAdjacentHTML('afterbegin', albumHeroHtml(artist, { ...known, ...album }, tracks));
  $('#content').classList.add('hero-on'); // название уже в шапке альбома
  renderArtistChips(artist, true);
  zoom.back = { key: artist.key, id, scroll: zoom.from?.id === id ? zoom.from.scroll : null };
  // прилетели с карточки артиста (не дольше полутора секунд назад — иначе альбом грузился, и лететь поздно)
  const z = zoom.from;
  zoom.from = null;
  if (z && z.id === id && performance.now() - z.at < 1500) {
    zoomFly(z.rect, list.querySelector('.alb-pic'), album.cover || known?.cover, z.radius);
    list.classList.remove('zoom-in');
    void list.offsetWidth;
    list.classList.add('zoom-in'); // треки проявляются следом за обложкой
    clearTimeout(zoom.timer);
    zoom.timer = setTimeout(() => list.classList.remove('zoom-in'), 900); // иначе проявлялись бы при каждой перерисовке
  }
}

// ---- артисты в поиске сервиса: строка карточек над найденными треками ----
const fmtFans = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} млн` : n >= 1e3 ? `${Math.round(n / 1e3)} тыс.` : String(n));

function renderSearchArtists(list) {
  document.querySelector('#tracklist .search-artists')?.remove();
  if (!list?.length) return;
  const row = document.createElement('section');
  row.className = 'search-artists';
  row.setAttribute('aria-label', 'Артисты');
  row.innerHTML = `<h3>Артисты</h3><div class="sa-row">${list.map((a, i) => `
    <button class="sa-card" data-sa="${i}" title="${esc(a.name)}">
      <span class="sa-pic">${a.cover ? `<img src="${esc(a.cover)}" alt="" loading="lazy">` : `<i>${esc((a.name || '?').trim()[0]?.toUpperCase() || '?')}</i>`}</span>
      <b>${esc(a.name)}</b>
      ${a.followers ? `<small>${fmtFans(a.followers)} ${a.source === 'ym' ? plural(a.followers, 'слушатель', 'слушателя', 'слушателей') : plural(a.followers, 'подписчик', 'подписчика', 'подписчиков')}</small>` : ''}
    </button>`).join('')}</div>${state.shown.length ? '<h3>Треки</h3>' : ''}`;
  $('#tracklist').prepend(row);
  row.querySelectorAll('.sa-card').forEach((b) => {
    b.onclick = () => {
      const a = list[+b.dataset.sa];
      if (a.ymId) art.ymHints.set(artistKey(a.name), a.ymId);
      openArtist(a.name);
    };
  });
}

function openArtist(name) {
  const key = artistKey(name);
  if (!key) return;
  if (!art.names.has(key)) art.names.set(key, name);
  openView('artists', key);
}

$('#tracklist').addEventListener('click', (e) => {
  const card = e.target.closest('.artist-card');
  if (card) { openView('artists', card.dataset.artistKey); return; }
  const disc = e.target.closest('.disc-card');
  if (disc) {
    const pic = disc.querySelector('.disc-pic');
    zoom.from = { id: disc.dataset.disc, rect: pic.getBoundingClientRect(), radius: radius(pic), at: performance.now(), scroll: $('#tracklist').scrollTop };
    openView('artists', `${state.sub.split(SUB_SEP)[0]}${SUB_SEP}${disc.dataset.disc}`);
    return;
  }
  const hero = e.target.closest('[data-hero]');
  if (hero && state.shown.length) {
    const shuffle = hero.dataset.hero === 'shuffle';
    if (!!state.cfg.shuffle !== shuffle) toggleShuffle();
    playFrom(state.shown, shuffle ? Math.floor(Math.random() * state.shown.length) : 0);
    return;
  }
  const play = e.target.closest('[data-play-from]');
  if (play) {
    const from = +play.dataset.playFrom;
    playFrom(state.shown.slice(from, from + +play.dataset.playCount), 0);
  }
});

// Имя исполнителя — ссылка на его страницу: в списках треков и в «сейчас играет»
document.addEventListener('click', (e) => {
  const link = e.target.closest('.a-link');
  if (!link || locked()) return;
  e.stopPropagation();
  if (!$('#fs').hidden) exitFs();
  openArtist(link.dataset.artist);
}, true);
