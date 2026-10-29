// Треки Яндекс Музыки без цензуры — по открытой базе аддона FckCensor (github.com/Hazzz895/FckCensor).
// Её список (list_v2.json) сопоставляет id трека Яндекса mp3-файлу без запикивания, а ещё правит
// названия, обложки и исполнителей, которые в РФ закрыты звёздочками. Файлы лежат на GitHub, токен
// Яндекса для них не нужен — так играют и треки, удалённые с сервиса.
const store = require('../store');
const { request } = require('./http');

const LIST = 'https://raw.githubusercontent.com/Hazzz895/FckCensorData/main/list_v2.json';
const FRESH = 6 * 3600 * 1000; // список обновляется нечасто — перечитываем раз в 6 часов

let audio = new Map(); // id трека Яндекса → ссылка на mp3
let tracks = new Map(); // id трека → поля для подмены (title, coverUri, artists, durationMs)
let albums = new Map(); // id альбома → поля для подмены (title, coverUri, artists, volumes)
let homes = new Map(); // id трека → альбом из списка, куда FckCensor его вернул (для обложки удалённых треков)
let loadedAt = 0;
let loading = null;

const https = (u) => (/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`);
const clean = (o) => { const { __fckCensor, ...rest } = o || {}; return rest; };

// Источники в списке идут по приоритету: что встретилось раньше, то и берём
function build(list) {
  const a = new Map();
  const t = new Map();
  const al = new Map();
  for (const src of list?.sources || []) {
    for (const [id, v] of Object.entries(src.tracks || {})) if (!t.has(id)) t.set(id, clean(v));
    for (const [id, v] of Object.entries(src.albums || {})) if (!al.has(id)) al.set(id, clean(v));
    for (const st of src.tracksStorages || []) {
      const tpl = st.urlTemplate;
      const url = (raw) => (typeof raw === 'number' || !String(raw).includes('://')) && tpl ? tpl.replace('%%', String(raw)) : String(raw);
      for (const [id, v] of Object.entries(st.tracks || {})) {
        const raw = v && typeof v === 'object' ? v.url : v;
        if (raw != null && !a.has(id)) a.set(id, https(url(raw)));
      }
      if (!tpl) continue;
      for (const item of st.trackIds || []) {
        const id = String(typeof item === 'number' ? item : item.id);
        if (!a.has(id)) a.set(id, https(tpl.replace('%%', id)));
      }
    }
  }
  // Удалённые треки Яндекс отдаёт без обложки и альбома — берём их у альбома, в который трек вернули
  const h = new Map();
  for (const [albumId, v] of al) {
    if (!v.coverUri) continue;
    for (const x of (v.volumes || []).flat()) if (x?.id && !h.has(String(x.id))) h.set(String(x.id), { id: Number(albumId), title: v.title, coverUri: v.coverUri });
  }
  audio = a;
  tracks = t;
  albums = al;
  homes = h;
}

// Сначала — копия с диска (чтобы подмена работала сразу и без сети), потом свежий список из сети.
// Если копия есть, сеть не ждём: новый список подхватится в фоне
function load() {
  if (Date.now() - loadedAt < FRESH) return Promise.resolve();
  if (!loadedAt && !audio.size) {
    try { const saved = store.read('fckcensor'); if (saved) build(saved); } catch {}
  }
  loading ||= request(LIST, { timeout: 20000 })
    .then((list) => {
      if (!list?.sources) throw new Error('пустой список');
      build(list);
      try { store.write('fckcensor', list); } catch {}
      loadedAt = Date.now();
    })
    .catch((e) => {
      console.warn('fckcensor:', e.message);
      loadedAt = Date.now() - FRESH + 5 * 60 * 1000; // не вышло — попробуем через 5 минут
    })
    .finally(() => { loading = null; });
  return audio.size ? Promise.resolve() : loading;
}

// ym:123 / 123 → ссылка на mp3 без цензуры или null
const rawId = (id) => String(id || '').replace(/^ym:/, '');
const audioFor = (id) => audio.get(rawId(id)) || null;

// Сырые данные трека / альбома из API Яндекса с поправками из списка
function patchTrack(t) {
  if (!t) return t;
  const fix = tracks.get(String(t.id));
  const out = fix ? { ...t, ...fix } : t;
  const home = !out.coverUri && !out.albums?.[0]?.coverUri && homes.get(String(t.id));
  return home ? { ...out, coverUri: home.coverUri, albums: out.albums?.length ? out.albums : [home] } : out;
}

function patchAlbum(a) {
  const fix = a && albums.get(String(a.id));
  return fix ? { ...a, ...fix } : a;
}

module.exports = { load, audioFor, patchTrack, patchAlbum };
