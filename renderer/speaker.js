'use strict';
// Колонка (src/speaker.js): кнопка «Играть на колонке» в плеере, индикатор связи и раздел в настройках.
// Общие глобальные из app.js: state, api, audio, speakerMode, loadTrack, next, updatePlayState, $, $$, esc, toast, saveCfg.

let spk = { configured: false, online: false, playing: false, track: '', checked: false };
let spkBusy = false;
// Сдвиг текста относительно позиции колонки, мс (настройка speaker.syncMs): плюс — текст раньше, минус — позже
const spkSyncMs = () => state.cfg.speaker?.syncMs ?? 0;
let spkStartAt = 0; // когда трек начался на колонке (Date.now() минус позиция), 0 — не играет
let spkShown = 0; // последнее показанное время: назад полоса не прыгает
let spkBase = 0; // с какой секунды колонка начала трек (поток отдаём со сдвигом, см. speaker-core.js)
let spkSynced = false; // колонка уже сама сообщила позицию этого трека
let spkWant = null; // трек, который ждёт своей очереди на колонку

function spkTitle() {
  if (!spk.configured) return 'Играть на колонке';
  if (!spk.online) return 'Колонка не отвечает';
  return speakerMode ? 'Колонка включена: всё играет на ней. Нажми, чтобы вернуть звук на компьютер' : 'Включить колонку: всё, что играешь в Авеоне, пойдёт на неё';
}

function paintSpeaker() {
  const b = $('#btn-speaker');
  if (!b) return;
  b.hidden = !spk.configured;
  b.classList.toggle('online', spk.online);
  b.classList.toggle('offline', spk.configured && spk.checked && !spk.online);
  b.classList.toggle('busy', spkBusy);
  b.setAttribute('aria-pressed', String(speakerMode));
  b.title = spkTitle();
  b.setAttribute('aria-label', b.title);
  if (speakerMode) updatePlayState();
}

// Связь с колонкой: отвечает ли по SSH и играет ли сейчас
async function refreshSpeaker() {
  if (spkBusy) return spk;
  const was = spk.playing;
  try { spk = { ...(await api.speaker.status()), checked: true }; } catch { spk = { ...spk, online: false, checked: true }; }
  if (spkBusy) return spk; // пока спрашивали, начали играть новый трек: ответ устарел
  paintSpeaker();
  paintSpeakerSection();
  // трек закончился на колонке — как 'ended' у обычного плеера
  if (speakerMode && was && !spk.playing && spk.online && !spkWant) speakerEnded();
  return spk;
}

// Позиция в треке на колонке: у неё мы позицию не спрашиваем, считаем от момента, когда она заиграла
function speakerPosition() {
  if (!spkStartAt) return spkBase;
  const d = state.track?.duration || 0;
  let p = spkBase + (Date.now() - spkStartAt) / 1000 + spkSyncMs() / 1000;
  if (d) p = Math.min(p, d);
  // назад время не идёт: поправка приходит и чуть больше, и чуть меньше прежней, а полоса должна только ползти вперёд
  spkShown = p > spkShown ? p : spkShown;
  return spkShown;
}

// Перемотка: плееру колонки команду не послать, поэтому запускаем его заново, а поток отдаём с нужной секунды
function speakerSeek(sec) {
  if (state.track) speakerSend(state.track, Math.max(0, sec));
}

// Ползунок громкости в окне ведёт и громкость колонки. Шлём не чаще, чем раз в треть секунды: каждый вызов — ssh
let volTimer = 0;
let volWant = -1;
function speakerVolume(v) {
  volWant = v;
  if (volTimer) return;
  volTimer = setTimeout(() => {
    volTimer = 0;
    if (speakerMode && spk.playing) api.speaker.volume(volWant).catch(() => {});
  }, 300);
}

// Трек кончился на колонке — как 'ended' у обычного плеера
function speakerEnded() {
  spk = { ...spk, playing: false };
  spkBase = 0;
  spkShown = 0;
  if (state.cfg.repeat === 'one' && state.track) speakerSend(state.track);
  else next(true);
}

// Рукопожатие с колонкой: она сама присылает позицию трека раз в секунду и сообщение о конце (смотритель в
// src/speaker-core.js, через туннель). Время прихода минус позиция = момент начала трека: без опросов и задержки ssh
api.speaker.onEvent((ev) => {
  if (!speakerMode) return;
  if (ev.type === 'key') { if (ev.key === 'up') next(); else prev(); return; } // двойной тап по громкости на колонке
  if (ev.id !== state.track?.id) return;
  if (ev.type === 'end') { if (!spkBusy) speakerEnded(); return; }
  if (ev.type === 'base') { spkBase = ev.ms / 1000; return; } // колонка начала не с начала: столько получилось отрезать
  // Каждая весть колонки чуть уточняет момент старта. Прыгать на новую оценку нельзя: время в окне дёргалось бы
  // туда-сюда, — поэтому подводим к ней понемногу, а разом только когда расхождение слишком велико (трек начали заново)
  const start = ev.at - ev.ms;
  if (!spkSynced || Math.abs(start - spkStartAt) > 2000) spkStartAt = start;
  else spkStartAt += (start - spkStartAt) * 0.15;
  spkSynced = true;
  if (!spk.playing) { spk = { ...spk, online: true, playing: true }; paintSpeaker(); }
});

// Отправка на колонку: пока идёт одна, новые треки не пересекаются, а остаётся только последний
async function speakerSend(track, at = 0) {
  spkWant = { track, at };
  if (spkBusy) return;
  spkBusy = true;
  paintSpeaker();
  while (spkWant) {
    const { track: t, at } = spkWant;
    spkWant = null;
    spkStartAt = 0;
    spkSynced = false;
    spkBase = at;
    spkShown = at;
    renderProgress();
    try {
      await api.speaker.play(t, at);
      if (!spkSynced) spkStartAt = Date.now(); // грубо, пока колонка сама не сообщила позицию
      spk = { ...spk, online: true, playing: true, track: t.title || '', checked: true };
    } catch (e) {
      toast(`Колонка: ${e.message}`, 'err');
      spkWant = null;
      spkBusy = false;
      speakerMode = false; // не вышло: возвращаем звук на компьютер и включаем этот же трек у себя
      paintSpeaker();
      refreshSpeaker();
      loadTrack(t, { startAt: at });
      return;
    }
  }
  spkBusy = false;
  paintSpeaker();
}

// Кнопка паузы в этом режиме: колонка паузу не умеет — остановка, а «играть» начинает трек сначала
async function speakerPlayPause() {
  if (spkBusy) return;
  if (spk.playing) {
    spkBusy = true;
    const at = speakerPosition(); // где остановились, оттуда и продолжим
    try { await api.speaker.stop(); } catch (e) { toast(e.message, 'err'); }
    spk = { ...spk, playing: false };
    spkStartAt = 0;
    spkBase = at;
    spkBusy = false;
    paintSpeaker();
    updatePlayState();
    renderProgress();
  } else if (state.track) {
    speakerSend(state.track, spkBase);
  }
}

async function speakerModeToggle() {
  if (!spk.configured) return;
  if (speakerMode) {
    speakerMode = false;
    spkWant = null;
    spkBusy = true;
    try { await api.speaker.stop(); } catch (e) { toast(e.message, 'err'); }
    spkBusy = false;
    spkStartAt = 0;
    spk = { ...spk, playing: false };
    paintSpeaker();
    updatePlayState();
    toast('Звук снова на компьютере');
    return;
  }
  if (!spk.online) { await refreshSpeaker(); if (!spk.online) { toast('Колонка не отвечает по SSH', 'err'); return; } }
  speakerMode = true;
  toast('Всё, что включаешь, играет на колонке');
  // трек продолжится на колонке с той же секунды; на паузе — с неё же, когда нажмут «играть»
  const at = state.track ? audio.currentTime : 0;
  spkBase = at;
  spkShown = at;
  if (!audio.paused) { audio.pause(); speakerSend(state.track, at); }
  paintSpeaker();
  updatePlayState();
}

$('#btn-speaker').onclick = speakerModeToggle;

// ---- настройки ----

function speakerState() {
  if (!state.cfg.speaker?.enabled) return ['', 'выкл'];
  if (!spk.configured) return ['', 'не задана'];
  if (!spk.checked) return ['', 'проверка…'];
  if (!spk.online) return ['', 'нет связи'];
  return ['ok', spk.playing ? 'играет' : 'на связи'];
}

function speakerSection() {
  if (IS_MOBILE) return '';
  const c = state.cfg.speaker || {};
  const [cls, label] = speakerState();
  return `<section class="sec" data-sec="speaker">
    <h3 class="sec-title">Колонка<span class="state ${cls}" id="spk-state">${label}</span></h3>
    <p class="sec-desc">Яндекс Станция Лайт 2 с доступом по SSH. Кнопка в плеере передаёт ей текущий трек: звук идёт через компьютер, поэтому Авеон должен быть запущен. Громкостью колонки правит ползунок в окне, прежняя вернётся сама.</p>
    <div class="field"><label>Играть на колонке</label><div class="ctl"><label class="switch"><input type="checkbox" id="spk-on" ${c.enabled ? 'checked' : ''} aria-label="Играть на колонке"><span></span></label></div></div>
    <div class="sub-fields" ${c.enabled ? '' : 'data-off'}>
    <div class="field"><label for="spk-host">Колонка</label><div class="ctl">
      <input class="input" id="spk-host" value="${esc(c.host || '')}" placeholder="lite2 или root@192.168.0.102" spellcheck="false" autocomplete="off">
    </div></div>
    <div class="field"><label>Время трека на часах колонки</label><div class="ctl"><label class="switch"><input type="checkbox" id="spk-display" ${c.display !== false ? 'checked' : ''} aria-label="Время трека на часах колонки"><span></span></label></div></div>
    <div class="field"><label>Двойной тап по громкости<br><small>+ следующий трек, − предыдущий</small></label><div class="ctl"><label class="switch"><input type="checkbox" id="spk-keys" ${c.keys !== false ? 'checked' : ''} aria-label="Двойной тап по громкости переключает треки"><span></span></label></div></div>
    <div class="field"><label for="spk-sync">Сдвиг текста и полосы<br><small>плюс — раньше, минус — позже</small></label><div class="ctl">
      <input type="range" id="spk-sync" min="-1500" max="1500" step="50" value="${c.syncMs ?? 0}"><output id="spk-sync-v">${c.syncMs ?? 0} мс</output>
    </div></div>
    <div class="row-actions"><button class="btn" id="spk-check"><svg><use href="#i-refresh"/></svg>Проверить связь</button></div>
    <p class="sec-desc" id="spk-msg">${esc(spk.checked && spk.configured && !spk.online ? spk.error || '' : '')}</p>
    </div>
  </section>`;
}

function paintSpeakerSection() {
  const st = $('#spk-state');
  if (!st) return;
  const [cls, label] = speakerState();
  st.className = 'state ' + cls;
  st.textContent = label;
  const msg = $('#spk-msg');
  if (msg) msg.textContent = spk.checked && spk.configured && !spk.online ? spk.error || '' : '';
}

function bindSpeaker(body) {
  const sec = $('[data-sec="speaker"]', body);
  if (!sec) return;
  $('#spk-on', sec).onchange = async (e) => {
    const on = e.target.checked;
    if (!on && speakerMode) await speakerModeToggle(); // выключаем функцию: звук возвращаем на компьютер
    await saveCfg({ speaker: { enabled: on } });
    $('.sub-fields', sec).toggleAttribute('data-off', !on);
    spk = { ...spk, configured: on && !!state.cfg.speaker?.host, online: false, checked: false };
    paintSpeaker();
    paintSpeakerSection();
    refreshSpeaker();
  };
  $('#spk-host', sec).onchange = async (e) => {
    await saveCfg({ speaker: { host: e.target.value.trim() } });
    spk = { ...spk, configured: !!state.cfg.speaker?.enabled && !!state.cfg.speaker?.host, online: false, checked: false };
    paintSpeaker();
    paintSpeakerSection();
    refreshSpeaker();
  };
  $('#spk-display', sec).onchange = (e) => saveCfg({ speaker: { display: e.target.checked } });
  $('#spk-keys', sec).onchange = (e) => saveCfg({ speaker: { keys: e.target.checked } });
  const sync = $('#spk-sync', sec);
  sync.oninput = () => { $('#spk-sync-v', sec).textContent = `${sync.value} мс`; };
  sync.onchange = () => saveCfg({ speaker: { syncMs: +sync.value } });
  $('#spk-check', sec).onclick = async () => {
    spk = { ...spk, checked: false };
    paintSpeakerSection();
    await refreshSpeaker();
  };
}

setInterval(() => { if (speakerMode && spk.playing && spkStartAt) renderProgress(); }, 500);
// Связь проверяем раз в полминуты, а пока колонка играет за нас — каждые 2 секунды: так видно позицию и конец трека
setInterval(() => { if (!document.hidden && spk.configured) refreshSpeaker(); }, 30000);
setInterval(() => { if (speakerMode && spk.playing && !spkBusy) refreshSpeaker(); }, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && spk.configured) refreshSpeaker(); });
if (!IS_MOBILE) refreshSpeaker();
