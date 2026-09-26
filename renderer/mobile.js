'use strict';
// Телефонная раскладка (подключается только в Android-сборке, mobile/build.mjs): мини-плеер,
// экран «сейчас играет» поверх библиотеки, системная кнопка «назад», перемотка из уведомления.
// Общие глобальные из app.js и соседей: state, api, audio, $, $$, esc, togglePlay, next, …

(() => {
  if (!IS_MOBILE) return;
  const root = document.documentElement;

  // ---- мини-плеер ----
  const mini = document.createElement('div');
  mini.className = 'mini empty';
  mini.id = 'mini';
  mini.innerHTML = `
    <div class="mini-cover" id="mini-cover">♪</div>
    <div class="mini-text"><div class="mini-title" id="mini-title"></div><div class="mini-artist" id="mini-artist"></div></div>
    <button class="icon-btn" id="mini-play" aria-label="Играть"><svg><use href="#i-play"/></svg></button>
    <button class="icon-btn" id="mini-next" aria-label="Следующий трек"><svg><use href="#i-next"/></svg></button>
    <div class="mini-progress"><i id="mini-fill"></i></div>`;
  document.body.appendChild(mini);

  let shownId = null;
  function renderMini() {
    const t = state.track;
    mini.classList.toggle('empty', !t);
    if (!t) return;
    if (shownId !== t.id) {
      shownId = t.id;
      $('#mini-title').textContent = t.title || '';
      $('#mini-artist').textContent = t.artist || '';
      const c = $('#mini-cover');
      c.style.backgroundImage = t.cover ? `url("${t.cover.replace(/"/g, '%22')}")` : '';
      c.textContent = t.cover ? '' : '♪';
    }
    $('#mini-play use').setAttribute('href', audio.paused ? '#i-play' : '#i-pause');
    const d = audio.duration;
    $('#mini-fill').style.width = isFinite(d) && d > 0 ? `${(audio.currentTime / d) * 100}%` : '0';
    mini.classList.toggle('barrel-on', duck.m > 0.5);
  }
  setInterval(renderMini, 400);
  for (const ev of ['play', 'pause', 'loadedmetadata', 'emptied']) onAudio(ev, renderMini);

  $('#mini-play').onclick = (e) => { e.stopPropagation(); togglePlay(); renderMini(); };
  $('#mini-next').onclick = (e) => { e.stopPropagation(); next(); };
  mini.onclick = () => openNow();

  // ---- экран «сейчас играет» ----
  const stage = $('#stage');
  const head = document.createElement('button');
  head.className = 'now-close';
  head.setAttribute('aria-label', 'Свернуть');
  head.innerHTML = '<svg><use href="#i-chevron-r"/></svg><span class="grab"></span><span style="width:24px"></span>';
  stage.prepend(head);

  const nowOpen = () => root.classList.contains('now-open');
  function openNow() { root.classList.add('now-open'); stage.scrollTop = 0; }
  function closeNow() { root.classList.remove('now-open'); stage.style.transform = ''; }
  head.onclick = closeNow;

  // смахнуть вниз за верх экрана — свернуть
  let drag = null;
  stage.addEventListener('touchstart', (e) => {
    if (stage.scrollTop > 0 || e.target.closest('.slider, input, .switch')) return;
    drag = { y: e.touches[0].clientY, dy: 0 };
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (!drag) return;
    drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
    if (drag.dy > 6) { stage.classList.add('dragging'); stage.style.transform = `translateY(${drag.dy}px)`; }
  }, { passive: true });
  stage.addEventListener('touchend', () => {
    if (!drag) return;
    stage.classList.remove('dragging');
    if (drag.dy > 120) closeNow(); else stage.style.transform = '';
    drag = null;
  });

  // Текст песни и профиль живут в библиотеке — экран «сейчас играет» уступает им место
  for (const id of ['#btn-lyrics', '#open-profile']) $(id)?.addEventListener('click', () => closeNow());

  // Профиль и настройки доступны и из библиотеки: аватар рядом с «Слушать вместе»
  const me = document.createElement('button');
  me.className = 'icon-btn';
  me.setAttribute('aria-label', 'Профиль');
  me.innerHTML = '<svg><use href="#i-user"/></svg>';
  me.onclick = () => $('#open-profile').click();
  const set = document.createElement('button');
  set.className = 'icon-btn';
  set.setAttribute('aria-label', 'Настройки');
  set.innerHTML = '<svg><use href="#i-settings"/></svg>';
  set.onclick = () => openSettings();
  $('.lib-top').append(me, set);

  // ---- меню действий — шторкой снизу, с затемнением ----
  const scrim = document.createElement('div');
  scrim.className = 'menu-scrim';
  scrim.hidden = true;
  document.body.appendChild(scrim);
  new MutationObserver(() => { scrim.hidden = $('#menu').hidden; }).observe($('#menu'), { attributes: true, attributeFilter: ['hidden'] });
  scrim.addEventListener('pointerdown', () => closeMenu());

  // ---- перемотка из уведомления ----
  window.addEventListener('aveon-seek', (e) => {
    if (isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, e.detail));
  });

  // ---- системная кнопка «назад»: закрыть верхнее, иначе свернуть приложение ----
  const visible = (sel) => { const el = $(sel); return el && !el.hidden; };
  api.mobile.back(() => {
    if (!$('#menu').hidden) { closeMenu(); return; }
    if (document.querySelector('.eqpop-frame.open')) { api.eqpop.close(); return; }
    if (visible('#dialog')) { $('#dialog-cancel').click(); return; }
    if (visible('#editor')) { closeEditor(); return; }
    if (visible('#settings')) { closeSettings(); return; }
    if (visible('#together')) { closeTogether(); return; }
    if (visible('#fs')) { exitFs(); return; }
    if (nowOpen()) { closeNow(); return; }
    if (visible('#lyrics')) { closeLyrics(); return; }
    if (visible('#profile') && !locked()) { closeProfile(); return; }
    api.mobile.minimize();
  });
})();
