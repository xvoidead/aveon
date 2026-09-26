'use strict';
// Таймер сна: через заданное время (или в конце трека) музыка минуту плавно затихает и встаёт на паузу.
// Будильник: в заданное время волна (или последний трек, или альбом) включается и минуту нарастает.
// Будильник срабатывает, пока плеер открыт (можно свёрнутым или в трее).
// Общие глобальные: state, api, audio, decks, $, esc, toast, saveCfg, showMenu, ask, togglePlay,
// waveStart, playFrom, loadTrack.

const sleep = { at: 0, endOfTrack: false, fading: false, timer: 0 };

function sleepLeft() { return sleep.at ? Math.max(0, sleep.at - Date.now()) : 0; }
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function setSleep(minutes) {
  cancelSleep(true);
  if (minutes === 'track') {
    sleep.endOfTrack = true;
    sleepTrackId = state.track?.id || null;
    toast('Остановлю в конце этого трека');
  } else {
    sleep.at = Date.now() + minutes * 60000;
    toast(`Таймер сна: ${minutes} мин — потом музыка плавно затихнет`);
  }
  renderSleepChip();
}

function cancelSleep(silent) {
  const was = sleep.at || sleep.endOfTrack;
  sleep.at = 0;
  sleep.endOfTrack = false;
  if (sleep.fading) { sleep.fading = false; decks.forEach((d) => { d.volume = 1; }); }
  renderSleepChip();
  if (was && !silent) toast('Таймер сна выключен');
}

// Минута затихания — громкостью самих плееров, настройки громкости не трогаем
function fadeToSleep() {
  if (sleep.fading) return;
  sleep.fading = true;
  const start = performance.now();
  const step = () => {
    if (!sleep.fading) return;
    const k = Math.min(1, (performance.now() - start) / 60000);
    decks.forEach((d) => { d.volume = Math.max(0, 1 - k); });
    if (k < 1) { requestAnimationFrame(step); return; }
    if (!audio.paused) togglePlay();
    decks.forEach((d) => { d.volume = 1; });
    sleep.fading = false;
    sleep.at = 0;
    sleep.endOfTrack = false;
    renderSleepChip();
    toast('Спокойной ночи — музыка на паузе');
  };
  requestAnimationFrame(step);
}

setInterval(() => {
  if (sleep.at && !sleep.fading && Date.now() >= sleep.at - 60000) fadeToSleep();
  if (sleep.at || sleep.endOfTrack) renderSleepChip();
  checkAlarm();
}, 1000);

// «В конце трека»: как только трек сменился — стоп
let sleepTrackId = null;
onAudio('play', () => {
  if (sleep.endOfTrack && sleepTrackId && state.track?.id !== sleepTrackId) {
    togglePlay();
    cancelSleep(true);
    toast('Трек закончился — музыка на паузе');
  }
  sleepTrackId = state.track?.id || null;
});
onAudio('ended', () => { if (sleep.endOfTrack) { cancelSleep(true); toast('Трек закончился — спокойной ночи'); } });

// Плашка на сцене: сколько осталось; клик — отменить
function renderSleepChip() {
  let chip = $('#sleep-chip');
  if (!sleep.at && !sleep.endOfTrack) { chip?.remove(); return; }
  if (!chip) {
    chip = document.createElement('button');
    chip.id = 'sleep-chip';
    chip.className = 'mode-chip';
    chip.onclick = () => cancelSleep();
    $('.now').after(chip);
  }
  chip.innerHTML = `<svg><use href="#i-moon"/></svg><span>${sleep.endOfTrack ? 'до конца трека' : `сон через ${mmss(sleepLeft())}`}</span>`;
  chip.title = 'Отменить таймер сна';
}

function sleepMenuItems() {
  const on = sleep.at || sleep.endOfTrack;
  return [
    { note: on ? (sleep.endOfTrack ? 'Таймер: до конца трека' : `Таймер: ${mmss(sleepLeft())}`) : 'Таймер сна' },
    ...[15, 30, 45, 60, 90].map((m) => ({ label: `Через ${m} минут`, icon: 'i-moon', onClick: () => setSleep(m) })),
    { label: 'В конце трека', icon: 'i-moon', onClick: () => setSleep('track') },
    ...(on ? [{ label: 'Выключить таймер', icon: 'i-close', danger: true, onClick: () => cancelSleep() }] : []),
  ];
}

// ---------- будильник ----------

const ALARM_DEFAULTS = { on: false, time: '08:00', days: [1, 2, 3, 4, 5], play: 'wave', ramp: 60 };
const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const alarmCfg = () => ({ ...ALARM_DEFAULTS, ...(state.cfg?.alarm || {}) });
let alarmFiredKey = '';

function checkAlarm() {
  const a = alarmCfg();
  if (!a.on || !state.cfg) return;
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const key = `${now.toDateString()} ${a.time}`;
  if (hm !== a.time || alarmFiredKey === key) return;
  if (a.days.length && !a.days.includes(now.getDay())) return;
  alarmFiredKey = key;
  ringAlarm(a);
}

// Музыка нарастает с тишины — громкостью самих плееров
async function ringAlarm(a) {
  cancelSleep(true);
  decks.forEach((d) => { d.volume = 0; });
  if (a.play === 'wave') await waveStart();
  else if (a.play === 'last' && state.track) { if (audio.paused) togglePlay(); }
  else if (a.play.startsWith('album:')) {
    try { const al = await api.albums.get(a.play.slice(6)); if (al.tracks.length) playFrom(al.tracks, 0); } catch {}
  } else if (state.track && audio.paused) togglePlay();
  else await waveStart();
  const start = performance.now();
  const ramp = () => {
    const k = Math.min(1, (performance.now() - start) / (a.ramp * 1000));
    decks.forEach((d) => { d.volume = k; });
    if (k < 1) requestAnimationFrame(ramp);
  };
  requestAnimationFrame(ramp);
  if (typeof islandNotify === 'function') islandNotify('Доброе утро! Будильник');
  toast('Доброе утро! Будильник сработал');
}

async function openAlarm() {
  let dlg = $('#alarm');
  if (!dlg) {
    dlg = document.createElement('div');
    dlg.className = 'modal';
    dlg.id = 'alarm';
    dlg.hidden = true;
    document.body.appendChild(dlg);
    dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) dlg.hidden = true; });
  }
  const a = alarmCfg();
  const albums = state.albums || [];
  dlg.innerHTML = `<div class="sheet alarm-sheet" role="dialog" aria-labelledby="alarm-title">
    <div class="sheet-head"><h2 id="alarm-title">Будильник</h2><button class="icon-btn" data-close aria-label="Закрыть"><svg><use href="#i-close"/></svg></button></div>
    <div class="sheet-body">
      <div class="alarm-clock">
        <input type="time" id="alarm-time" value="${esc(a.time)}" aria-label="Время">
        <label class="switch"><input type="checkbox" id="alarm-on" ${a.on ? 'checked' : ''} aria-label="Будильник включён"><span></span></label>
      </div>
      <div class="alarm-days" role="group" aria-label="Дни">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button data-day="${d}" class="${a.days.includes(d) ? 'on' : ''}">${DAYS[d]}</button>`).join('')}</div>
      <div class="field"><label for="alarm-play">Что играть</label><div class="ctl"><select class="input" id="alarm-play">
        <option value="wave" ${a.play === 'wave' ? 'selected' : ''}>Волну</option>
        <option value="last" ${a.play === 'last' ? 'selected' : ''}>То, что играло последним</option>
        ${albums.map((al) => `<option value="album:${esc(al.id)}" ${a.play === `album:${al.id}` ? 'selected' : ''}>Альбом «${esc(al.title)}»</option>`).join('')}
      </select></div></div>
      <div class="field"><label for="alarm-ramp">Нарастает</label><div class="ctl"><input type="range" id="alarm-ramp" min="10" max="180" step="10" value="${a.ramp}"><span class="val" id="alarm-ramp-v">${a.ramp} с</span></div></div>
      <p class="sec-desc">Будильник срабатывает, пока авеон запущен — можно свёрнутым или в трее. Ни одного дня не выбрано — один раз, в ближайшее время.</p>
    </div>
  </div>`;
  dlg.hidden = false;
  const save = (patch) => saveCfg({ alarm: { ...alarmCfg(), ...patch } });
  dlg.querySelector('[data-close]').onclick = () => { dlg.hidden = true; };
  dlg.querySelector('#alarm-time').onchange = (e) => save({ time: e.target.value, on: true }).then(() => { dlg.querySelector('#alarm-on').checked = true; });
  dlg.querySelector('#alarm-on').onchange = (e) => save({ on: e.target.checked });
  dlg.querySelector('#alarm-play').onchange = (e) => save({ play: e.target.value });
  dlg.querySelector('#alarm-ramp').oninput = (e) => { dlg.querySelector('#alarm-ramp-v').textContent = `${e.target.value} с`; };
  dlg.querySelector('#alarm-ramp').onchange = (e) => save({ ramp: +e.target.value });
  dlg.querySelectorAll('[data-day]').forEach((b) => {
    b.onclick = () => {
      b.classList.toggle('on');
      save({ days: [...dlg.querySelectorAll('[data-day].on')].map((x) => +x.dataset.day) });
    };
  });
}
