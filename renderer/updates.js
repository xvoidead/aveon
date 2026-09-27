'use strict';

// ---------- автообновления ----------
// Качает главный процесс (src/updater.js). Здесь: плашка «Обновление готово — перезапустить»
// и строка статуса вверху «Что нового» (changelog.js) с кнопкой «Проверить обновления».

let updState = { state: 'idle' };
let updCardFor = ''; // для какой версии плашку уже показали (и закрыли «позже»)

function updText(s) {
  switch (s.state) {
    case 'checking': return 'Ищу обновления…';
    case 'none': return 'У тебя последняя версия';
    case 'downloading': return `Качаю ${s.version || 'обновление'}${s.percent ? ` · ${s.percent}%` : ''}`;
    case 'ready': return `Версия ${s.version} скачана — поставится при перезапуске`;
    case 'error': return 'Не получилось проверить обновления';
    case 'dev': return 'Обновления — только в установленном приложении';
    default: return '';
  }
}

// Плашка справа снизу, над подсказками: одна на версию, «позже» — поставится при выходе
function showUpdateCard(s) {
  if (s.state !== 'ready' || updCardFor === s.version || IS_MOBILE) return;
  updCardFor = s.version;
  const el = document.createElement('div');
  el.className = 'toast update-card';
  el.innerHTML = `<div><b>Обновление ${esc(s.version)} готово</b><small>Перезапусти плеер, чтобы поставить</small></div>
    <button class="btn primary" data-upd="now">Перезапустить</button>
    <button class="btn" data-upd="later">Позже</button>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-upd]');
    if (!b) return;
    if (b.dataset.upd === 'now') api.update.install();
    el.classList.add('hide');
    setTimeout(() => el.remove(), 400);
  });
  $('#toasts').append(el);
}

function renderUpdateLine() {
  const body = $('#cl-body');
  if (!body || IS_MOBILE) return;
  let line = $('#upd-line');
  if (!line) {
    line = document.createElement('div');
    line.id = 'upd-line';
    line.className = 'upd-line';
    line.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.upd === 'now') { api.update.install(); return; }
      updState = { state: 'checking' };
      renderUpdateLine();
      updState = await api.update.check().catch(() => updState);
      renderUpdateLine();
    });
  }
  if (line.parentElement !== body) body.prepend(line);
  const s = updState;
  const busy = s.state === 'checking' || s.state === 'downloading';
  line.innerHTML = `<span>${esc(updText(s) || 'Обновления ставятся сами')}</span>${
    s.state === 'ready' ? '<button class="btn primary" data-upd="now">Перезапустить</button>'
    : s.state === 'dev' ? '' : `<button class="btn"${busy ? ' disabled' : ''}>Проверить обновления</button>`}`;
}

if (api.update) {
  api.update.status().then((s) => { updState = s; showUpdateCard(s); }).catch(() => {});
  api.update.onEvent((s) => {
    updState = s;
    showUpdateCard(s);
    if ($('#changelog') && !$('#changelog').hidden) renderUpdateLine();
  });
}
