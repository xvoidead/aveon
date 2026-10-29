// Голосовое управление: «дальше», «назад», «стоп», «продолжай», «громче», «тише» — без кнопок и без интернета.
// Распознаёт Vosk (vosk-browser, WebAssembly) по модели из src/voice.js — в невидимой рамке voice-host.html. Звук берём из того же микрофона,
// что и детектор голоса для бочки (mic в app.js), с тем же шумо- и эхоподавлением: музыка плеера вычитается.
// Команда засчитывается, только если фраза целиком — одно это слово: «давай дальше про работу» трек не переключит.
// Список слов (grammar) в vosk-browser не работает с кириллицей, поэтому распознаём свободно и сравниваем фразу целиком.

const VOICE_COMMANDS = {
  'дальше': { note: '⏭ дальше', run: () => next() },
  'назад': { note: '⏮ назад', run: () => { if (Together.guest()) Together.askSkip('prev'); else prev(true); } },
  'стоп': { note: '⏸ стоп', run: () => { if (state.track && !audio.paused) togglePlay(); } },
  'продолжай': { note: '▶ продолжай', run: () => { if (!state.track || audio.paused) togglePlay(); } },
  'громче': { note: () => `🔊 громче: ${Math.round(state.cfg.volume * 100)}%`, run: () => setVolume(Math.min(1, state.cfg.volume + VOICE_VOL_STEP), true) },
  'тише': { note: () => `🔉 тише: ${Math.round(state.cfg.volume * 100)}%`, run: () => setVolume(Math.max(0, state.cfg.volume - VOICE_VOL_STEP), true) },
};
const VOICE_VOL_STEP = 0.1; // вдвое крупнее стрелок: повторять слово дольше, чем жать клавишу

const voice = {
  ready: false, // модель скачана
  downloading: false,
  progress: 0,
  error: '',
  loading: null, // Promise загрузки модели в распознаватель
  host: null, // voiceHost из рамки voice-host.html
  rec: null,
  tap: null, // { stream, src, node } — к какому потоку микрофона подключены
};

const voiceOn = () => !IS_MOBILE && !!state.cfg?.voice?.enabled;
// app.js (duckTick): держать микрофон открытым и вне звонка
const voiceWantsMic = () => voiceOn() && voice.ready && !voice.error;

// Рамка с vosk.js (~6 МБ) создаётся, только когда голосовое управление включено
function loadVoiceHost() {
  document.querySelector('iframe.voice-host')?.remove(); // осталась от неудачной попытки
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.className = 'voice-host';
    f.src = 'voice-host.html';
    f.hidden = true;
    f.onload = () => (f.contentWindow.voiceHost ? resolve(f.contentWindow.voiceHost) : reject(new Error('Не загрузился vosk.js')));
    f.onerror = () => reject(new Error('Не загрузился voice-host.html'));
    document.body.append(f);
  });
}

function voiceLoadModel() {
  voice.loading ||= (async () => {
    const host = await loadVoiceHost();
    await host.load('media://voice/model');
    voice.host = host;
  })().catch((e) => {
    voice.error = `Распознавание не запустилось: ${e.message || e}`;
    voice.loading = null;
    renderVoiceStatus();
  });
  return voice.loading;
}

function voiceHeard(text) {
  const cmd = VOICE_COMMANDS[text.trim().toLowerCase()];
  if (!cmd || locked()) return;
  cmd.run();
  hkNote(typeof cmd.note === 'function' ? cmd.note() : cmd.note); // app.js: на острове, если окно не в фокусе, иначе уведомлением
}

// Распознавать тишину — треть ядра впустую. Поэтому Vosk получает звук, только когда в микрофоне что-то громче
// фона (порог ниже, чем у детектора бочки: отсеивает сам Vosk), плюс ~0,6 с до этого, чтобы не съесть начало
// слова, и ~1,2 с после — по этой паузе он понимает, что фраза кончилась
const VOICE_PREROLL = 7; // кусков по 4096 сэмплов (~85 мс при 48 кГц)
const VOICE_TAIL = 14;
const gate = { pre: [], left: 0 };

function voiceGate(rec, chunk) {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  const loud = Math.sqrt(sum / chunk.length) > micAbsNeed(state.cfg.duck.micSensitivity) * 0.5; // app.js
  if (loud) {
    if (!gate.left) gate.pre.forEach((c) => rec.feed(c));
    gate.pre = [];
    gate.left = VOICE_TAIL;
  }
  if (gate.left) { rec.feed(chunk); gate.left--; return; }
  gate.pre.push(chunk);
  if (gate.pre.length > VOICE_PREROLL) gate.pre.shift();
}

async function voiceAttach() {
  if (voice.tap?.stream === mic.stream) return;
  voiceDetach();
  const stream = mic.stream;
  voice.tap = { stream }; // занято, пока подключаемся
  try {
    await voiceLoadModel();
    if (!voice.host) return;
    await ctx.audioWorklet.addModule('voice-worklet.js'); // повторный addModule того же файла ничего не делает
    if (voice.tap?.stream !== stream || mic.stream !== stream) return; // пока грузились, микрофон сменился
    const rate = ctx.sampleRate;
    const rec = voice.host.recognizer(rate, voiceHeard);
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'voice-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (e) => voiceGate(rec, e.data);
    src.connect(node);
    voice.rec = rec;
    voice.tap = { stream, src, node };
  } catch (e) {
    voice.error = `Распознавание не запустилось: ${e.message || e}`;
    voiceDetach();
    renderVoiceStatus();
  }
}

function voiceDetach() {
  if (!voice.tap) return;
  try { voice.tap.src?.disconnect(); } catch {}
  if (voice.tap.node) voice.tap.node.port.onmessage = null;
  voice.rec?.remove();
  voice.rec = null;
  voice.tap = null;
}

// Каждый такт app.js (duckTick) после micStart/micStop
function voiceTick() {
  const want = voiceWantsMic() && !!mic.stream;
  if (want && voice.tap?.stream !== mic.stream) voiceAttach();
  else if (!want && voice.tap) voiceDetach();
}

async function refreshVoice() {
  if (IS_MOBILE) return;
  const s = await api.voice.status().catch(() => null);
  if (!s) return;
  voice.ready = s.ready;
  voice.downloading = s.downloading;
  voice.progress = s.progress;
  if (s.error && !voice.error) voice.error = s.error;
}

async function voiceDownload() {
  voice.error = '';
  voice.downloading = true;
  renderVoiceStatus();
  try {
    await api.voice.download();
    voice.ready = true;
  } catch (e) {
    voice.error = e.message;
  }
  voice.downloading = false;
  renderVoiceStatus();
}

if (!IS_MOBILE && api.voice) {
  api.voice.onProgress((p) => { voice.progress = p; renderVoiceStatus(); });
  refreshVoice(); // модель уже скачана — микрофон откроется без захода в настройки
}

// ---- настройки (app.js → renderSettings) ----

function voiceStatusText() {
  if (voice.error) return voice.error;
  if (voice.downloading) return `Скачивается модель распознавания: ${Math.round(voice.progress * 100)}%`;
  if (!voice.ready) return 'Нужна модель распознавания речи, около 45 МБ. Скачается один раз при включении.';
  if (!voiceOn()) return 'Модель скачана.';
  return voice.tap?.node ? 'Слушаю.' : 'Запускается…';
}

function renderVoiceStatus() {
  const el = $('#voice-status');
  if (!el) return;
  el.textContent = voiceStatusText();
  el.classList.toggle('err', !!voice.error);
  const btn = $('#voice-retry');
  if (btn) btn.hidden = !voice.error || voice.downloading;
}

function voiceSettingsHtml() {
  const on = !!state.cfg.voice?.enabled;
  return `<section class="sec desktop-only" data-sec="voice">
      <h3 class="sec-title">Голосовое управление</h3>
      <p class="sec-desc">Скажи отдельным словом, с паузой до и после: «дальше», «назад», «стоп», «продолжай», «громче» или «тише». Слово посреди фразы командой не считается. Работает из того же микрофона, что выбран выше, и вне звонка тоже. Речь распознаётся на этом компьютере, звук никуда не отправляется.</p>
      <div class="field"><label>Слушать команды</label><div class="ctl"><label class="switch"><input type="checkbox" id="voice-on" ${on ? 'checked' : ''} aria-label="Слушать команды"><span></span></label></div></div>
      <p class="sec-desc" id="voice-status"></p>
      <button class="btn" id="voice-retry" hidden>Попробовать снова</button>
    </section>`;
}

function bindVoiceSettings(body) {
  const sw = $('#voice-on', body);
  if (!sw) return;
  renderVoiceStatus();
  refreshVoice().then(renderVoiceStatus);
  sw.onchange = async () => {
    await saveCfg({ voice: { enabled: sw.checked } });
    voice.error = '';
    if (sw.checked && !voice.ready && !voice.downloading) voiceDownload();
    renderVoiceStatus();
  };
  $('#voice-retry', body).onclick = () => {
    voice.error = '';
    voice.loading = null;
    if (!voice.ready) voiceDownload(); else renderVoiceStatus();
  };
}

// Строка «Слушаю.» появляется, когда распознавание подключилось
setInterval(() => { if (voiceOn() && $('#voice-status')) renderVoiceStatus(); }, 1000);
