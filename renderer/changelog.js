'use strict';

// ---------- что нового ----------
// Список изменений по версиям. Кнопка — в профиле. Если при запуске версия выше той, что уже
// показывали (config.seenVersion), окно открывается само — один раз на версию.

const CHANGELOG = [
  {
    v: '1.3.0',
    title: 'Профили друзей, волна и тихий остров',
    items: [
      'Клик по другу открывает его профиль: что слушает сейчас, сколько слушал, любимые артисты и треки — любой включается у себя',
      'Волна — бесконечный поток под твой вкус, с диджеем; эфир и шкала приёмника',
      'Треки можно скачать для офлайна — на компьютере и на телефоне',
      'Остров прячется, когда на экране игра (настройки острова), и сам встаёт на монитор, где курсор',
      'Остров держится поверх полноэкранных окон, плавно растёт под длину строки, его кнопки снова нажимаются',
      'Статус в Discord снова виден друзьям',
      'Плашку звонка на сцене можно убрать: настройки → оформление',
      'Кнопки окна снова появляются и нажимаются при плеере справа; кнопки внизу выровнены',
      'Всплывающие окна больше не перекрывают плеер прозрачными полями',
      '«Что нового» — это окно; объявления от админов',
    ],
  },
  {
    v: '1.2.0',
    title: 'Сообщения и оформление под себя',
    items: [
      'Сообщения между друзьями: текст и треки, «Отправить другу» в меню любого трека',
      'Позвать друга в руму или попроситься к нему',
      'Аватарки друзей в острове',
      'Оформление под себя: темы, цвета, шрифты, фон, бочка, вкладки',
      'Плеер снизу, сверху или справа',
      'Остров поверх всех окон, своё место на экране, текст по буквам',
      'Мини-плеер с плавной сменой строк, значок в трее, горячие клавиши, живые обои, «кино»',
      'Реакция на звук настраивается',
      'Исправлен вход в Spotify и статус в Discord',
    ],
  },
  {
    v: '1.1.0',
    title: 'Друзья',
    items: [
      'Друзья по логину: заявки, видно, кто что слушает, трек друга можно включить у себя',
      'Комната стала румой и переехала на сцену, под «сейчас играет»',
      'Кэш треков и текстов — видно, сколько места занято',
    ],
  },
];

// 1.10.0 > 1.9.0: сравниваем по числам, а не строкой
function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

let appVersion = '';
let changelogEl = null;

function changelogHtml(sinceVersion) {
  return CHANGELOG.map((r) => {
    const fresh = sinceVersion != null && cmpVersion(r.v, sinceVersion) > 0;
    return `<section class="cl-release${fresh ? ' fresh' : ''}">
      <h3><span class="cl-v">${esc(r.v)}</span>${esc(r.title)}${r.v === appVersion ? '<em>у тебя</em>' : ''}</h3>
      <ul>${r.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    </section>`;
  }).join('');
}

// since — версия, с которой обновились: всё новее неё подсвечено
function openChangelog(since = null) {
  if (!changelogEl) {
    changelogEl = document.createElement('div');
    changelogEl.className = 'modal';
    changelogEl.id = 'changelog';
    changelogEl.hidden = true;
    changelogEl.innerHTML = `<div class="sheet cl-sheet" role="dialog" aria-labelledby="cl-title">
      <div class="sheet-head"><h2 id="cl-title">Что нового</h2>
        <button class="icon-btn" id="cl-close" aria-label="Закрыть"><svg><use href="#i-close"/></svg></button></div>
      <div class="sheet-body cl-body" id="cl-body"></div></div>`;
    document.body.append(changelogEl);
    $('#cl-close', changelogEl).onclick = closeChangelog;
    changelogEl.addEventListener('pointerdown', (e) => { if (e.target === changelogEl) closeChangelog(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !changelogEl.hidden) { e.stopPropagation(); closeChangelog(); }
    }, true);
  }
  $('#cl-title', changelogEl).textContent = since ? `Авеон обновился до ${appVersion}` : 'Что нового';
  $('#cl-body', changelogEl).innerHTML = changelogHtml(since);
  changelogEl.hidden = false;
}

function closeChangelog() {
  if (changelogEl) changelogEl.hidden = true;
}

// при запуске: версия выросла с прошлого раза — показываем, что поменялось
(async function checkChangelog() {
  for (let i = 0; i < 50 && !state.cfg; i++) await new Promise((r) => setTimeout(r, 200));
  try { appVersion = await api.app.version(); } catch { return; }
  const seen = state.cfg?.seenVersion || '';
  if (cmpVersion(appVersion, seen || '0') <= 0) return;
  saveCfg({ seenVersion: appVersion }).catch(() => {});
  // первый запуск вообще (ни альбомов, ни аккаунта) — не заваливаем списком
  if (!seen && !state.account.loggedIn) return;
  setTimeout(() => openChangelog(seen || CHANGELOG[1]?.v || null), 1200);
})();
