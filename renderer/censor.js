// ---------- самоцензура ----------
// Main находит в тексте песни мат и наркотики и присылает отрезки времени. Пока играет такой
// отрезок, звук уходит в бочку и искажается выбранным способом (ветки графа — в app.js).

const cz = { c: 0, windows: [], trackId: null, info: null, loading: false, seq: 0 };

async function censorLoad(track) {
  const seq = ++cz.seq;
  cz.windows = [];
  cz.info = null;
  cz.trackId = track?.id || null;
  if (!track || !state.cfg.censor?.enabled) { censorStatus(); return; }
  cz.loading = true;
  censorStatus();
  try {
    const r = await api.censor.plan(track);
    if (seq !== cz.seq) return;
    cz.windows = r.windows;
    cz.info = r;
  } catch (e) {
    if (seq !== cz.seq) return;
    cz.info = { error: e.message };
  }
  cz.loading = false;
  censorStatus();
}

// Вызывается из duckTick каждые ~30 мс. Смотрим чуть вперёд: фильтрам нужно пару десятков мс
function censorTick(dt) {
  let want = 0;
  if (state.cfg?.censor?.enabled && cz.trackId === state.track?.id && !audio.paused) {
    const t = audio.currentTime + 0.03;
    for (const [s, e] of cz.windows) {
      if (s > t) break;
      if (t < e) { want = 1; break; }
    }
  }
  const tau = want > cz.c ? 12 : 60;
  cz.c += (want - cz.c) * (1 - Math.exp(-dt / tau));
  if (Math.abs(cz.c - want) < 0.01) cz.c = want;
}

function censorStatusText() {
  const c = state.cfg.censor;
  if (!c.enabled) return '';
  if (!state.track) return 'Включи трек — здесь будет видно, откуда взято время слов.';
  if (cz.loading) return 'Ищу текст текущего трека…';
  const i = cz.info;
  if (!i) return '';
  if (i.error) return `Не получилось найти текст: ${i.error}`;
  if (!i.from) return 'Для текущего трека нет синхронного текста, поэтому в нём цензура не работает.';
  const n = i.hits ? `Спрятано мест: ${i.hits}.` : 'Ничего прятать не нужно.';
  return i.precise
    ? `Текущий трек: время каждого слова из Musixmatch. ${n}`
    : `Текущий трек: текст по строкам из ${i.from === 'lrclib' ? 'LRCLIB' : 'Musixmatch'}, место слова в строке примерное. ${n}`;
}

function censorStatus() {
  const el = $('#cz-status');
  if (el) el.textContent = censorStatusText();
}

function censorSettingsHtml() {
  const c = state.cfg.censor;
  const seg = (key, items) => `<div class="seg" data-cz-seg="${key}">${items.map(([v, label]) => `<button data-v="${v}" class="${c[key] === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  const sw = (key, label) => `<div class="field"><label>${label}</label><div class="ctl"><label class="switch"><input type="checkbox" data-cz-bool="${key}" ${c[key] ? 'checked' : ''} aria-label="${label}"><span></span></label></div></div>`;
  return `
    <section class="sec" data-sec="censor">
      <h3 class="sec-title">Цензура в треках</h3>
      <p class="sec-desc">Мат и упоминания наркотиков прячутся прямо во время песни: слово уходит в бочку и коверкается. Время слов берётся из Musixmatch, там оно известно для каждого слова. Если такого текста нет, берутся строки из LRCLIB, и место слова внутри строки плеер оценивает по слогам, с запасом.</p>
      ${sw('enabled', 'Включено')}
      <div class="sub-fields" ${c.enabled ? '' : 'data-off'}>
        ${sw('profanity', 'Мат')}
        ${sw('drugs', 'Наркотики')}
        <div class="field"><label>Что прятать</label><div class="ctl">${seg('scope', [['word', 'Только слово'], ['line', 'Всю строку']])}</div></div>
        <div class="field"><label>Как коверкать</label><div class="ctl">${seg('effect', [['barrel', 'Бочка'], ['warble', 'Плывёт'], ['robot', 'Робот'], ['bleep', 'Пик'], ['mute', 'Тишина']])}</div></div>
        <div class="field"><label for="cz-custom">Свои слова</label><div class="ctl">
          <input class="input" id="cz-custom" value="${esc(c.custom.join(', '))}" placeholder="через запятую, ловится и начало слова" spellcheck="false">
        </div></div>
        <p class="sec-desc" id="cz-status">${esc(censorStatusText())}</p>
      </div>
    </section>`;
}

function bindCensorSettings(body) {
  const reload = () => censorLoad(state.track);
  $$('input[data-cz-bool]', body).forEach((inp) => {
    inp.onchange = async () => {
      await saveCfg({ censor: { [inp.dataset.czBool]: inp.checked } });
      if (inp.dataset.czBool === 'enabled') renderSettings();
      reload();
    };
  });
  $$('[data-cz-seg] button', body).forEach((b) => {
    b.onclick = async () => {
      const key = b.parentElement.dataset.czSeg;
      await saveCfg({ censor: { [key]: b.dataset.v } });
      $$('button', b.parentElement).forEach((x) => x.classList.toggle('on', x === b));
      if (key === 'scope') reload(); // способ искажения применяется сразу, без пересчёта
    };
  });
  $('#cz-custom', body).onchange = async (e) => {
    const custom = e.target.value.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    await saveCfg({ censor: { custom } });
    reload();
  };
}
