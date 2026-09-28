'use strict';
// Раздел «Остров и окна» (только на компьютере): остров поверх всех окон, мини-плеер, значок в трее,
// горячие клавиши на всю систему и живые обои. Всё живёт в главном процессе: src/island.js, mini.js,
// tray.js, hotkeys.js, livewall.js. Общие глобальные: state, api, $, $$, esc, toast, saveCfg, IS_MOBILE.

const DESK_DEFAULTS = {
  island: { enabled: true, pos: 'top', onlyAway: true, hideInGames: false, lyrics: true, friends: true, notify: true, pulse: false, rainbow: false, motion: 'music', bars: true, spin: false },
  mini: { onMinimize: false, top: true, opacity: 100, lyrics: true },
  tray: { enabled: true, closeToTray: false },
  livewall: { enabled: false, style: 'both', title: true, dim: 45 },
};
const HOTKEYS = [
  ['play', 'Играть / пауза'],
  ['next', 'Следующий трек'],
  ['prev', 'Предыдущий трек'],
  ['barrel', 'Бочка вручную'],
  ['show', 'Показать / спрятать плеер'],
  ['mini', 'Мини-плеер'],
  ['island', 'Остров вкл / выкл'],
  ['volUp', 'Громче'],
  ['volDown', 'Тише'],
  ['seekFwd', 'Вперёд на 10 секунд'],
  ['seekBack', 'Назад на 10 секунд'],
  ['mute', 'Без звука / со звуком'],
  ['shuffle', 'Перемешать вкл / выкл'],
  ['repeat', 'Повтор: выкл → список → трек'],
  ['wave', 'Волна: включить / пауза'],
  ['like', 'Нравится (в волне)'],
  ['karaoke', 'Караоке: убрать голос'],
  ['sleep', 'Таймер сна на 30 минут / выключить'],
];

const HK_DEFAULTS = {
  play: 'CommandOrControl+Alt+Space', next: 'CommandOrControl+Alt+Right', prev: 'CommandOrControl+Alt+Left',
  barrel: 'CommandOrControl+Alt+B', show: 'CommandOrControl+Alt+A', mini: 'CommandOrControl+Alt+M',
  island: 'CommandOrControl+Alt+I', volUp: 'CommandOrControl+Alt+Up', volDown: 'CommandOrControl+Alt+Down',
  seekFwd: 'CommandOrControl+Alt+Shift+Right', seekBack: 'CommandOrControl+Alt+Shift+Left', mute: 'CommandOrControl+Alt+0',
  shuffle: 'CommandOrControl+Alt+S', repeat: 'CommandOrControl+Alt+R', wave: 'CommandOrControl+Alt+W',
  like: 'CommandOrControl+Alt+L', karaoke: 'CommandOrControl+Alt+K', sleep: 'CommandOrControl+Alt+Z',
};

let desk = null; // ответ desk:status

const dcfg = (k) => ({ ...DESK_DEFAULTS[k], ...(state.cfg?.[k] || {}) });

async function refreshDesk() {
  if (IS_MOBILE) return;
  try { desk = await api.desk.status(); } catch {}
}

// Ctrl+Alt+Right → «Ctrl + Alt + →»
function prettyKey(acc) {
  if (!acc) return 'не задано';
  return acc.replace('CommandOrControl', 'Ctrl').replace('Super', 'Win').split('+')
    .map((k) => ({ Right: '→', Left: '←', Up: '↑', Down: '↓', Space: 'Пробел' }[k] || k)).join(' + ');
}

// Нажатие → сочетание в формате Electron (Accelerator)
function accelerator(e) {
  const keyMap = { ' ': 'Space', ArrowRight: 'Right', ArrowLeft: 'Left', ArrowUp: 'Up', ArrowDown: 'Down', '+': 'Plus', Escape: 'Esc' };
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  let key = keyMap[e.key] || e.key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3); // буква по месту на клавиатуре: раскладка не важна
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (key.length === 1) key = key.toUpperCase();
  const mods = [e.ctrlKey && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  if (!mods.length && !/^(F\d{1,2}|Media\w+|Volume\w+)$/.test(key)) return ''; // без модификаторов — только F-клавиши и медиа
  return [...mods, key].join('+');
}

const dSw = (group, key, label, on) => `<div class="field"><label>${label}</label><div class="ctl"><label class="switch"><input type="checkbox" data-desk="${group}.${key}" ${on ? 'checked' : ''} aria-label="${label}"><span></span></label></div></div>`;
const dSeg = (group, key, opts, cur) => `<div class="seg" data-desk-seg="${group}.${key}">${opts.map(([v, t]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
const dRange = (group, key, label, min, max, step, val, unit) => `<div class="field"><label>${label}</label><div class="ctl">
  <input type="range" data-desk-range="${group}.${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${val}">
  <span class="val">${val}${unit}</span></div></div>`;

function deskSection() {
  if (IS_MOBILE) return '';
  const i = dcfg('island'), m = dcfg('mini'), t = dcfg('tray'), w = { ...dcfg('livewall'), ...(desk?.livewall || {}) };
  const hk = { enabled: true, failed: [], ...HK_DEFAULTS, ...(state.cfg?.hotkeys || {}), ...(desk?.hotkeys || {}) };
  return `
  <section class="sec" data-sec="island">
    <h3 class="sec-title">Остров<span class="state ${i.enabled ? 'ok' : ''}">${i.enabled ? 'вкл' : 'выкл'}</span></h3>
    <p class="sec-desc">Чёрная капсула поверх всех окон и рабочего стола, как на айфоне. Наведи — раскроется: перемотка, кнопки, друзья. Колесо мыши над ней — громкость.</p>
    ${dSw('island', 'enabled', 'Остров поверх всех окон', i.enabled)}
    <div class="sub-fields" ${i.enabled ? '' : 'data-off'}>
      <div class="field"><label>Место на экране</label><div class="ctl"><button class="btn" id="isl-edit">Редактировать место острова</button></div></div>
      ${dSw('island', 'onlyAway', 'Только когда плеер свёрнут или не в фокусе', i.onlyAway)}
      ${dSw('island', 'hideInGames', 'Прятать, когда на экране игра', i.hideInGames)}
      ${dSw('island', 'lyrics', 'Строка текста песни, пока играет', i.lyrics)}
      ${dSw('island', 'friends', 'Друзья: кто слушает и кто в комнате', i.friends)}
      ${dSw('island', 'notify', 'Уведомления: заявки, друг включил трек, кто-то зашёл в комнату', i.notify)}
      <div class="field"><label>Движение от музыки</label><div class="ctl">${dSeg('island', 'motion', [['music', 'Живой'], ['calm', 'Спокойный'], ['static', 'Статичный']], i.motion)}</div></div>
      <p class="sec-desc">«Статичный» — остров не реагирует на звук: полоски замирают, обложка не крутится, ничего не пульсирует.</p>
      <div class="sub-fields" ${i.motion === 'static' ? 'data-off' : ''}>
        ${dSw('island', 'bars', 'Полоски спектра', i.bars)}
        ${dSw('island', 'spin', 'Обложка кружком и крутится, пока играет', i.spin)}
        ${i.motion === 'music' ? dSw('island', 'pulse', 'Пульсирует в такт басам', i.pulse) : ''}
      </div>
      ${dSw('island', 'rainbow', 'Переливающаяся обводка цветами обложки', i.rainbow)}
    </div>
  </section>

  <section class="sec" data-sec="mini">
    <h3 class="sec-title">Мини-плеер<span class="state ${desk?.mini ? 'ok' : ''}">${desk?.mini ? 'открыт' : 'закрыт'}</span></h3>
    <p class="sec-desc">Маленькое окно с обложкой, строкой текста и кнопками. Тащи его за любое пустое место — место запомнится.</p>
    <div class="row-actions"><button class="btn primary" id="desk-mini">${desk?.mini ? 'Закрыть мини-плеер' : 'Открыть мини-плеер'}</button></div>
    ${dSw('mini', 'onMinimize', 'Сворачивать плеер в мини-плеер', m.onMinimize)}
    ${dSw('mini', 'top', 'Поверх всех окон', m.top)}
    ${dSw('mini', 'lyrics', 'Строка текста песни', m.lyrics)}
    ${dRange('mini', 'opacity', 'Прозрачность', 30, 100, 5, m.opacity, '%')}
  </section>

  <section class="sec" data-sec="tray">
    <h3 class="sec-title">Значок в трее</h3>
    ${dSw('tray', 'enabled', 'Значок рядом с часами', t.enabled)}
    <div class="sub-fields" ${t.enabled ? '' : 'data-off'}>${dSw('tray', 'closeToTray', 'Крестик прячет плеер в трей — музыка играет дальше', t.closeToTray)}</div>
  </section>

  <section class="sec" data-sec="hotkeys">
    <h3 class="sec-title">Горячие клавиши на всю систему</h3>
    <p class="sec-desc">Работают в любом окне — когда плеер свёрнут, спрятан в трей или открыта игра. Что поменялось, покажет остров. Нажми на сочетание и зажми новое; Backspace — убрать.</p>
    <div class="field"><label>Включены</label><div class="ctl"><label class="switch"><input type="checkbox" id="hk-enabled" ${hk.enabled ? 'checked' : ''} aria-label="Горячие клавиши"><span></span></label></div></div>
    <div class="sub-fields" ${hk.enabled ? '' : 'data-off'}>
      ${HOTKEYS.map(([id, label]) => `<div class="field"><label>${label}</label><div class="ctl">
        <button class="input hk${hk.failed.includes(id) ? ' hk-fail' : ''}" data-hk="${id}" title="${hk.failed.includes(id) ? 'Это сочетание занято другой программой' : ''}">${esc(prettyKey(hk[id]))}</button>
      </div></div>`).join('')}
      <div class="row-actions"><button class="btn" id="hk-reset">Сочетания по умолчанию</button></div>
    </div>
  </section>

  <section class="sec" data-sec="livewall">
    <h3 class="sec-title">Живые обои${w.running ? '<span class="state ok">на рабочем столе</span>' : ''}</h3>
    <p class="sec-desc">Рабочий стол оживает под музыку: размытая обложка, спектр по кругу и название трека прямо за иконками. Выключишь — вернутся обычные обои.</p>
    ${dSw('livewall', 'enabled', 'Живые обои', w.enabled)}
    ${w.error ? `<p class="sec-desc err">Не получилось: ${esc(w.error)}</p>` : ''}
    <div class="sub-fields" ${w.enabled ? '' : 'data-off'}>
      <div class="field"><label>Что показывать</label><div class="ctl">${dSeg('livewall', 'style', [['both', 'Всё'], ['spectrum', 'Спектр'], ['cover', 'Обложку']], w.style)}</div></div>
      ${dSw('livewall', 'title', 'Название трека и строка текста', w.title)}
      ${dRange('livewall', 'dim', 'Затемнение', 0, 90, 5, w.dim, '%')}
    </div>
  </section>`;
}

// ---- место острова: редактор на весь экран с сеткой (src/islandedit.js); новое место придёт через desk:changed ----
function bindIslPlace(body) {
  const b = $('#isl-edit', body);
  if (b) b.onclick = () => api.island.edit();
}

async function rerenderDesk() {
  await refreshDesk();
  const body = $('#settings-body');
  const secs = $$('[data-desk-root]', body);
  if (!secs.length || $('#settings').hidden) return;
  const top = body.scrollTop;
  const wrap = document.createElement('div');
  wrap.innerHTML = deskSection();
  const fresh = [...wrap.children];
  fresh.forEach((s) => { s.dataset.deskRoot = '1'; s.hidden = SEC_TAB[s.dataset.sec] !== settingsTab; });
  secs[0].before(...fresh);
  secs.forEach((s) => s.remove());
  bindDesk(body);
  renderSettingsNav();
  body.scrollTop = top;
}

async function saveDesk(group, patch) {
  await saveCfg({ [group]: patch });
  setTimeout(rerenderDesk, group === 'livewall' ? 1500 : 150); // обоям нужно время, чтобы встать за иконки
}

function bindDesk(body) {
  if (IS_MOBILE) return;
  $$('[data-sec="island"], [data-sec="mini"], [data-sec="tray"], [data-sec="hotkeys"], [data-sec="livewall"]', body).forEach((s) => { s.dataset.deskRoot = '1'; });
  $$('[data-desk]', body).forEach((inp) => {
    const [g, k] = inp.dataset.desk.split('.');
    inp.onchange = () => saveDesk(g, { [k]: inp.checked });
  });
  $$('[data-desk-seg]', body).forEach((segEl) => {
    const [g, k] = segEl.dataset.deskSeg.split('.');
    $$('button', segEl).forEach((b) => {
      b.onclick = () => saveDesk(g, { [k]: b.dataset.v });
    });
  });
  bindIslPlace(body);
  $$('[data-desk-range]', body).forEach((inp) => {
    const [g, k] = inp.dataset.deskRange.split('.');
    inp.oninput = () => { inp.nextElementSibling.textContent = `${inp.value}${inp.dataset.unit}`; saveCfg({ [g]: { [k]: +inp.value } }); };
  });
  const miniBtn = $('#desk-mini', body);
  if (miniBtn) miniBtn.onclick = async () => { await api.desk.miniToggle(); rerenderDesk(); };

  const hkOn = $('#hk-enabled', body);
  if (hkOn) hkOn.onchange = () => saveDesk('hotkeys', { enabled: hkOn.checked });
  $$('[data-hk]', body).forEach((b) => {
    b.onclick = () => {
      b.classList.add('rec');
      b.textContent = 'нажми сочетание…';
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') { done(); rerenderDesk(); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { done(); saveDesk('hotkeys', { [b.dataset.hk]: '' }); return; }
        const acc = accelerator(e);
        if (acc === null) return; // пока зажаты только модификаторы
        if (!acc) { b.textContent = 'нужен Ctrl, Alt или Shift'; return; }
        done();
        saveDesk('hotkeys', { [b.dataset.hk]: acc });
      };
      const done = () => { document.removeEventListener('keydown', onKey, true); b.classList.remove('rec'); b.removeEventListener('blur', cancel); };
      const cancel = () => { done(); rerenderDesk(); };
      document.addEventListener('keydown', onKey, true);
      b.addEventListener('blur', cancel, { once: true });
    };
  });
  const reset = $('#hk-reset', body);
  if (reset) reset.onclick = () => saveDesk('hotkeys', { ...HK_DEFAULTS });
}

// Остров или мини-плеер переключили из трея или клавишей — открытые настройки это покажут
if (!IS_MOBILE && api.desk) {
  api.desk.onChange(async () => {
    state.cfg = await api.config.get();
    if (!$('#settings').hidden && settingsTab === 'desk') rerenderDesk();
  });
}
