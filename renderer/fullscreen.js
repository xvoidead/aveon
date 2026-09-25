// ---------- во весь экран ----------
// Окно разворачивается на весь экран: размытая обложка на фоне, крупная карточка трека и текст песни.
// Панель текста (extras.js) на это время переезжает сюда целиком — со всей синхронизацией и караоке.

const fsEl = $('#fs');
const fsProg = $('#fs-progress');
const fs = { raf: 0, idle: 0, trackId: undefined, paused: null, seeking: false, lyricsWasOpen: false, home: null };
const fsOpen = () => !fsEl.hidden;

// Обложки сервисов приходят маленькими — на весь экран просим крупнее
function bigCover(url) {
  return (url || '').replace(/\/300x300$/, '/600x600').replace('-t300x300.', '-t500x500.');
}

function enterFs() {
  if (fsOpen()) return;
  const lyricsEl = $('#lyrics');
  fs.home = { parent: lyricsEl.parentNode, next: lyricsEl.nextSibling };
  fs.lyricsWasOpen = lyricsOpen();
  closeStats();
  $('#fs-lyrics').append(lyricsEl);
  fsEl.hidden = false;
  openLyrics(); // загрузит текст текущего трека, если его ещё нет
  api.win.action('fullscreen-on');
  fs.trackId = undefined;
  fsLoop();
  fsWake();
}

function exitFs(fromWindow = false) {
  if (!fsOpen()) return;
  fsEl.hidden = true;
  cancelAnimationFrame(fs.raf);
  clearTimeout(fs.idle);
  fs.home.parent.insertBefore($('#lyrics'), fs.home.next);
  if (!fs.lyricsWasOpen) closeLyrics();
  else syncLyrics(true);
  if (!fromWindow) api.win.action('fullscreen-off');
}

function fsRender() {
  const t = state.track;
  fs.trackId = t?.id;
  $('#fs-title').textContent = t?.title || 'Ничего не играет';
  $('#fs-artist').textContent = t ? t.artist || 'Исполнитель неизвестен' : 'Выбери трек в библиотеке';
  const cover = bigCover(t?.cover);
  const css = cover ? `url("${cover.replace(/"/g, '%22')}")` : '';
  $('#fs-cover').style.backgroundImage = css;
  $('#fs-cover').textContent = cover ? '' : '♪';
  $('#fs-bg').style.backgroundImage = css;
}

// Время и кнопка паузы — каждый кадр, но DOM трогаем только при изменениях
function fsLoop() {
  cancelAnimationFrame(fs.raf);
  const tick = () => {
    if (!fsOpen()) return;
    if (fs.trackId !== state.track?.id) fsRender();
    const d = audio.duration || state.track?.duration || 0;
    if (!fs.seeking) {
      const c = audio.currentTime || 0;
      setSlider(fsProg, d ? c / d : 0);
      const cur = fmt(c);
      if ($('#fs-cur').textContent !== cur) $('#fs-cur').textContent = cur;
    }
    const dur = fmt(d);
    if ($('#fs-dur').textContent !== dur) $('#fs-dur').textContent = dur;
    if (fs.paused !== audio.paused) {
      fs.paused = audio.paused;
      $('#fs-play use').setAttribute('href', audio.paused ? '#i-play' : '#i-pause');
      $('#fs-play').setAttribute('aria-label', audio.paused ? 'Играть' : 'Пауза');
    }
    fs.raf = requestAnimationFrame(tick);
  };
  fs.paused = null;
  fs.raf = requestAnimationFrame(tick);
}

// Через 3 секунды без движения прячем кнопки и курсор — остаются обложка и текст
function fsWake() {
  fsEl.classList.remove('idle');
  clearTimeout(fs.idle);
  fs.idle = setTimeout(() => { if (!fs.seeking) fsEl.classList.add('idle'); }, 3000);
}

makeSlider(fsProg, {
  onInput: (f) => {
    fs.seeking = true;
    const d = audio.duration || state.track?.duration || 0;
    setSlider(fsProg, f);
    $('#fs-cur').textContent = fmt(f * d);
  },
  onChange: (f) => {
    const d = audio.duration || 0;
    if (d) audio.currentTime = f * d;
    fs.seeking = false;
    fsWake();
  },
});

$('#fs-play').onclick = togglePlay;
$('#fs-prev').onclick = prev;
$('#fs-next').onclick = () => next();
$('#fs-exit').onclick = () => exitFs();
$('#btn-fs').onclick = enterFs;
for (const ev of ['pointermove', 'pointerdown', 'wheel']) fsEl.addEventListener(ev, fsWake, { passive: true });

// Окно вышло из полноэкранного режима само (например, через Windows) — закрываем и слой
api.win.onState((s) => { if (s?.fullscreen === false) exitFs(true); });

document.addEventListener('keydown', (e) => {
  if (locked()) return; // под экраном входа (app.js) клавиши плеера не работают
  if (e.target.matches('input, textarea, select') || e.ctrlKey || e.altKey) return;
  const modal = ['#settings', '#eq', '#editor', '#dialog'].some((id) => !$(id).hidden);
  if (e.code === 'KeyF' && !modal) { fsOpen() ? exitFs() : enterFs(); return; }
  if (e.key === 'Escape' && fsOpen() && !modal && $('#menu').hidden) exitFs();
  if (fsOpen()) fsWake();
});
