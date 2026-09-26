'use strict';
// Скачанные для офлайна: трек, обложка и текст лежат на диске и играют без интернета.
// Скачать — из меню трека или кнопкой «Скачать всё» над списком; смотреть — Альбомы → «Скачанные».
// Качает главный процесс по одному треку (src/resolve.js → download, src/cache.js → pinned).
// Общие глобальные из app.js: state, api, $, esc, toast, plural, openView, renderTracks, showEmpty, summary.

const DL = {
  done: new Set(),    // `${source}:${id}` скачанных
  pending: new Set(), // в очереди или качаются сейчас
  batch: 0,           // сколько поставили в очередь с последнего «всё скачалось»
  failed: 0,
};
const dlKey = (t) => `${t.source}:${t.id}`;
const canDownload = (t) => t && t.source !== 'local' && t.playable !== false;

async function loadDownloadState() {
  try {
    const s = await api.downloads.state();
    DL.done = new Set(s.done);
    DL.pending = new Set(s.pending);
  } catch {}
}

// Значок в строке трека (app.js → rowHtml)
function dlTag(t) {
  const k = dlKey(t);
  if (DL.done.has(k)) return '<span class="tag dl" title="Скачан — играет без интернета"><svg><use href="#i-download"/></svg></span>';
  if (DL.pending.has(k)) return '<span class="tag dl wait" title="Качается"><svg><use href="#i-download"/></svg></span>';
  return '';
}

// Пункт в меню трека (app.js → openTrackMenu)
function dlMenuItems(t) {
  if (!canDownload(t)) return [];
  const k = dlKey(t);
  if (DL.done.has(k)) return [{ label: 'Убрать из скачанных', icon: 'i-download', onClick: () => undownload([t]) }];
  if (DL.pending.has(k)) return [{ label: 'Качается…', icon: 'i-download', muted: true, onClick: () => {} }];
  return [{ label: 'Скачать для офлайна', icon: 'i-download', onClick: () => download([t]) }];
}

async function download(tracks) {
  const list = tracks.filter((t) => canDownload(t) && !DL.done.has(dlKey(t)) && !DL.pending.has(dlKey(t)));
  if (!list.length) { toast(tracks.length > 1 ? 'Всё уже скачано' : 'Уже скачан'); return; }
  list.forEach((t) => DL.pending.add(dlKey(t)));
  DL.batch += list.length;
  refreshDownloadMarks();
  toast(list.length === 1 ? `Качаю «${list[0].title}»` : `Качаю ${list.length} ${plural(list.length, 'трек', 'трека', 'треков')} — можно слушать дальше`);
  try { await api.downloads.add(list); } catch (e) { toast(e.message, true); }
}

async function undownload(tracks) {
  await api.downloads.remove(tracks).catch((e) => toast(e.message, true));
  tracks.forEach((t) => DL.done.delete(dlKey(t)));
  refreshDownloadMarks();
  if (state.view === 'albums' && state.sub === 'downloads') openView('albums', 'downloads');
}

// Значки в видимом списке — без полной перерисовки
function refreshDownloadMarks() {
  for (const row of document.querySelectorAll('#tracklist .row')) {
    const t = state.shown[+row.dataset.i];
    if (!t) continue;
    const box = row.querySelector('.t-artist');
    if (!box) continue;
    box.querySelector('.tag.dl')?.remove();
    const html = dlTag(t);
    if (html) box.insertAdjacentHTML('afterbegin', html);
  }
  if (state.view === 'albums') renderCollections();
}

// Главный процесс сообщает: встал в очередь, качается, готово, ошибка, удалён
api.downloads.onEvent((ev) => {
  const d = ev?.download;
  if (!d) return;
  if (d.state === 'cleared') { DL.done.clear(); DL.pending.clear(); }
  else if (d.state === 'queued' || d.state === 'loading') DL.pending.add(d.key);
  else {
    DL.pending.delete(d.key);
    if (d.state === 'done') DL.done.add(d.key);
    if (d.state === 'removed') DL.done.delete(d.key);
    if (d.state === 'error') DL.failed++;
  }
  refreshDownloadMarks();
  if (!DL.pending.size && DL.batch) {
    const ok = DL.batch - DL.failed;
    toast(DL.failed
      ? `Скачано ${ok} из ${DL.batch}: у ${DL.failed} ${plural(DL.failed, 'трека', 'треков', 'треков')} поток нельзя сохранить`
      : `Скачано: ${ok} ${plural(ok, 'трек', 'трека', 'треков')} — слушай без интернета`, !!DL.failed);
    DL.batch = 0;
    DL.failed = 0;
    if (state.view === 'albums' && state.sub === 'downloads') openView('albums', 'downloads');
  }
});

// Раздел Альбомы → «Скачанные» (app.js → openView)
async function openDownloads(seq) {
  state.album = null;
  $('#view-title').textContent = 'Скачанные';
  let list = [];
  try { list = await api.downloads.list(); } catch {}
  if (seq !== viewSeq) return;
  if (!list.length) {
    showEmpty({ title: 'Пока ничего не скачано', text: 'Открой меню трека (⋯) и выбери «Скачать для офлайна» или нажми «Скачать всё» над плейлистом. Скачанные треки играют без интернета — вместе с обложкой и текстом.' });
    return;
  }
  renderTracks(list, `${summary(list)} · играют без интернета`);
}

// Кнопки над списком (app.js → renderActions)
function dlActions(add) {
  if (state.view === 'albums' && state.sub === 'downloads') {
    if (state.shown.length) {
      const b = add('', 'i-trash', async () => {
        const ok = await ask({ title: 'Удалить все скачанные?', text: 'Треки останутся в своих сервисах — просто перестанут играть без интернета.', ok: 'Удалить', input: false, danger: true });
        if (ok === null) return;
        await api.cache.clear('downloads');
        openView('albums', 'downloads');
      });
      b.setAttribute('aria-label', 'Удалить все скачанные');
      b.title = 'Удалить все скачанные';
    }
    return;
  }
  const can = state.shown.filter(canDownload);
  if (!can.length) return;
  const left = can.filter((t) => !DL.done.has(dlKey(t))).length;
  const b = add('', 'i-download', () => download(can));
  const label = left ? `Скачать всё (${left})` : 'Всё скачано';
  b.setAttribute('aria-label', label);
  b.title = label;
  if (!left) b.classList.add('done');
}

loadDownloadState().then(refreshDownloadMarks);
