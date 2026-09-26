'use strict';

// ---------- поделиться альбомом или пресетом эквалайзера ----------
// Альбом кладётся на сервер аккаунтов и получает короткий код (AB3D-7KQM). Если сервер старый
// или недоступен — код собирается прямо из данных: aveon:album:<сжатый JSON>. Пресет эквалайзера
// маленький, у него код всегда такой: aveon:eq:<JSON>.
// Друг вставляет код в «Открыть по коду» (или просто Ctrl+V в окне) и получает свою копию.

const SHARE_KINDS = { album: 'альбом', eq: 'пресет эквалайзера' };
const SHORT_CODE = /(?:^|[^A-Za-z0-9])(?:aveon:)?([A-HJ-NP-Z2-9]{4})-?([A-HJ-NP-Z2-9]{4})(?![A-Za-z0-9])/i;
const INLINE_CODE = /aveon:(album|eq):([A-Za-z0-9_-]+)/;
const MAX_IMPORT_TRACKS = 5000;

// ---- упаковка ----

function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function packInline(kind, data) {
  const json = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return `aveon:${kind}:${b64url(new Uint8Array(await new Response(json).arrayBuffer()))}`;
}

async function unpackInline(payload) {
  const text = new Blob([unb64url(payload)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(text).text());
}

// Есть ли в тексте код авеона. Короткий код без префикса узнаём, только если это весь текст —
// иначе любое восьмибуквенное слово в буфере обмена казалось бы кодом
function findShareCode(text, { loose = false } = {}) {
  text = String(text || '').trim();
  const inline = INLINE_CODE.exec(text);
  if (inline) return { kind: inline[1], inline: inline[2] };
  const short = SHORT_CODE.exec(text);
  if (short && (loose || /aveon:/i.test(text) || text.replace(/[\s-]/g, '').length === 8)) return { code: (short[1] + short[2]).toUpperCase() };
  return null;
}

const prettyCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

async function copyText(text) {
  try { await api.copy(text); return true; } catch { return false; } // navigator.clipboard в окне запрещён — см. main.js
}

// ---- отправить ----

// Что уходит другу из альбома: без путей к файлам и протухающих ссылок (shareable — together.js)
function albumSnapshot(album) {
  return { title: album.title, tracks: album.tracks.map(shareable) };
}

async function shareAlbum(album) {
  if (!album) return;
  if (!album.tracks.length) { toast('Альбом пустой — делиться пока нечем'); return; }
  const data = albumSnapshot(album);
  let text, short = true;
  try {
    text = `aveon:${prettyCode(await api.share.put('album', data))}`;
  } catch {
    short = false;
    text = await packInline('album', data);
  }
  const copied = await copyText(text);
  const locals = album.tracks.filter((t) => t.source === 'local').length;
  await ask({
    title: copied ? 'Код альбома скопирован' : 'Код альбома',
    text: `${short ? text.replace('aveon:', '') : 'Код длинный, потому что сервер аккаунтов недоступен.'} Отправь его другу: в авеоне он откроет «Альбомы → По коду» или просто нажмёт Ctrl+V.${locals ? ` Свои файлы (${locals}) у друга найдутся в Яндекс Музыке или SoundCloud по названию.` : ''}`,
    value: text, ok: copied ? 'Готово' : 'Скопировать', input: true,
  }).then((ok) => { if (ok && !copied) copyText(text).then((c) => c && toast('Код скопирован')); });
}

async function shareEqPreset(p) {
  if (!p) return;
  const text = await packInline('eq', { name: p.name, gains: p.gains, preamp: p.preamp });
  const copied = await copyText(text);
  toast(copied ? `Код пресета «${p.name}» скопирован. Друг вставит его в эквалайзере или просто нажмёт Ctrl+V` : text);
}

// ---- открыть ----

function cleanTrack(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !['local', 'ym', 'sc', 'sp'].includes(t.source)) return null;
  const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
  const url = (v) => (typeof v === 'string' && /^https:\/\//i.test(v) ? v.slice(0, 1000) : '');
  const out = {
    id: str(t.id, 200), source: t.source, title: str(t.title) || 'Без названия', artist: str(t.artist), album: str(t.album),
    duration: Number.isFinite(+t.duration) ? +t.duration : 0, cover: url(t.cover), link: url(t.link),
    playable: t.playable !== false, preview: !!t.preview, ref: t.ref && typeof t.ref === 'object' ? t.ref : {},
  };
  // Трек друга играет как в «Слушать вместе»: через тот же сервис, если он подключён, иначе
  // находится по названию в Яндекс Музыке или SoundCloud. Своего файла друга у нас нет вовсе
  out.shared = true;
  if (t.source === 'local') { out.ref = {}; out.id = `shared:${out.id}`; }
  return out;
}

function cleanEq(d) {
  const gains = Array.isArray(d?.gains) ? d.gains.slice(0, EQ_FREQS.length).map((v) => Math.max(-EQ_MAX, Math.min(EQ_MAX, Math.round((+v || 0) * 2) / 2))) : [];
  if (gains.length !== EQ_FREQS.length) return null;
  return { name: String(d.name || 'Пресет друга').slice(0, 40), gains, preamp: Math.max(-12, Math.min(6, Math.round((+d.preamp || 0) * 2) / 2)) };
}

async function readShare(found) {
  if (found.inline) return { kind: found.kind, data: await unpackInline(found.inline) };
  return api.share.get(found.code);
}

async function importShare(text) {
  const found = findShareCode(text, { loose: true });
  if (!found) { toast('Это не похоже на код альбома или пресета', 'err'); return; }
  let share;
  try { share = await readShare(found); } catch (e) { toast(e.message || 'Код не открылся', 'err'); return; }
  const from = share.by ? ` от ${share.by}` : '';

  if (share.kind === 'eq') {
    const p = cleanEq(share.data);
    if (!p) { toast('Код пресета повреждён', 'err'); return; }
    const ok = await ask({ title: `Пресет «${p.name}»${from}`, text: 'Добавить его в свои пресеты эквалайзера и включить?', ok: 'Добавить', input: false });
    if (!ok) return;
    const same = eqMine().some((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (same) p.name = `${p.name} (${share.by || 'друг'})`.slice(0, 40);
    await eqAddMine(p);
    if (!eqOpen()) openEq();
    toast(`Пресет «${p.name}» добавлен`);
    return;
  }

  if (share.kind === 'album') {
    const tracks = (Array.isArray(share.data?.tracks) ? share.data.tracks : []).slice(0, MAX_IMPORT_TRACKS).map(cleanTrack).filter(Boolean);
    const title = String(share.data?.title || 'Альбом друга').slice(0, 120);
    if (!tracks.length) { toast('В этом альбоме нет треков', 'err'); return; }
    const locals = tracks.filter((t) => t.source === 'local').length;
    const name = await ask({
      title: `Альбом${from}`,
      text: `${summary(tracks)}. Он сохранится у тебя копией: можно переименовать сейчас.${locals ? ` ${locals} ${plural(locals, 'трек', 'трека', 'треков')} — свои файлы друга, плеер найдёт их в Яндекс Музыке или SoundCloud.` : ''}`,
      value: title, ok: 'Добавить альбом',
    });
    if (!name) return;
    try {
      const a = await api.albums.import(name, tracks);
      await refreshAlbums();
      openView('albums', a.id);
      toast(`Альбом «${name}» добавлен`);
    } catch (e) { toast(e.message, 'err'); }
    return;
  }
  toast('Этот код не для авеона', 'err');
}

async function openShareCode() {
  const text = await ask({ title: 'Открыть по коду', text: 'Вставь код альбома или пресета эквалайзера, который прислал друг.', ok: 'Открыть', value: '' });
  if (text) importShare(text);
}

// Ctrl+V в любом месте окна (кроме полей ввода) с кодом в буфере — сразу открываем
document.addEventListener('paste', (e) => {
  if (locked() || e.target.matches?.('input, textarea, select, [contenteditable]')) return;
  const text = e.clipboardData?.getData('text') || '';
  if (!findShareCode(text)) return;
  e.preventDefault();
  importShare(text);
});
