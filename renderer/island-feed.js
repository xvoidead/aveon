'use strict';
// Окно плеера → остров, мини-плеер, живые обои и трей (главный процесс раздаёт одно состояние всем):
// что играет, позиция, бочка, спектр, строка текста песни, друзья, уведомления, цвета.
// Пока играет — ~15 раз в секунду (с живыми обоями — 30), на паузе — изредка.
// Общие глобальные из app.js и соседей: state, api, audio, fx, duck, Friends, Together, parseLRC, …

const ISLAND_OPTS = { lyrics: true, friends: true, notify: true, pulse: true, rainbow: false };
const islandOpt = (k) => ({ ...ISLAND_OPTS, ...(state.cfg?.island || {}) })[k];

// Уведомление в острове: заявка в друзья, друг включил трек, кто-то зашёл в комнату…
const islandNotices = [];
function islandNotify(text, kind = 'info') {
  if (IS_MOBILE || !api.island || !islandOpt('notify')) return;
  islandNotices.push({ id: `${Date.now()}-${Math.random()}`, text, kind });
  if (islandNotices.length > 5) islandNotices.shift();
}

(() => {
  if (IS_MOBILE || !api.island) return;

  const bins = new Uint8Array(2048);
  const smooth = [0, 0, 0, 0, 0];
  const spec = new Array(48).fill(0);
  let lastSent = 0;

  // 5 полос для острова: бас → верха
  function levels(data) {
    const edges = [1, 6, 18, 48, 120, 300];
    for (let b = 0; b < 5; b++) {
      let v = 0;
      for (let k = edges[b]; k < Math.min(edges[b + 1], data.length); k++) v = Math.max(v, data[k]);
      const x = Math.min(1, Math.pow(v / 255, 1.6) * reactGain()); // look.js: реакция на звук
      smooth[b] = reactStep(smooth[b], x);
    }
    return smooth.map((v) => +v.toFixed(2));
  }

  // 48 полос для живых обоев — по логарифму частот, как спектр вокруг бочки
  function spectrum(data) {
    const n = spec.length;
    for (let i = 0; i < n; i++) {
      const lo = Math.floor(Math.pow(i / n, 1.8) * data.length * 0.7);
      const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.8) * data.length * 0.7));
      let v = 0;
      for (let k = lo; k < hi; k++) v = Math.max(v, data[k]);
      const x = Math.min(1, Math.pow(v / 255, 1.4) * reactGain());
      spec[i] = reactStep(spec[i], x);
    }
    return spec.map((v) => +v.toFixed(2));
  }

  // ---- строка текста песни: грузим текст трека заранее, даже если панель текста закрыта ----
  const lyr = { id: null, lines: [] };
  async function loadLyr(t) {
    lyr.id = t.id;
    lyr.lines = [];
    try {
      const r = await api.lyrics(t);
      if (lyr.id !== t.id) return;
      if (r.words?.length) lyr.lines = r.words.map((l) => ({ t: l.ts, text: l.words.map((w) => w.text).join(' ').replace(/- /g, '-') }));
      else if (r.synced) lyr.lines = parseLRC(r.synced); // extras.js
    } catch {}
  }
  // Строки вокруг текущей: остров показывает текущую, раскрытый — ещё предыдущую и следующую.
  // gap — проигрыш: до первой строки или пустая строка в LRC
  function lyricNow() {
    const t = state.track;
    const none = { prev: '', cur: '', next: '', gap: false, has: false };
    if (!t || !(islandOpt('lyrics') || state.cfg?.mini?.lyrics !== false)) return none;
    if (lyr.id !== t.id) { loadLyr(t); return none; }
    if (!lyr.lines.length) return none;
    const now = audio.currentTime + 0.2;
    let i = -1;
    while (i + 1 < lyr.lines.length && lyr.lines[i + 1].t <= now) i++;
    const text = (k) => (lyr.lines[k]?.text || '').trim();
    const cur = text(i);
    return { prev: i > 0 ? text(i - 1) : '', cur, next: text(i + 1), gap: !cur, has: true };
  }

  // ---- друзья: кто слушает прямо сейчас, и кто из них только что включил новый трек ----
  const heard = new Map(); // id друга → id его трека
  function friendsNow() {
    if (!islandOpt('friends')) return null;
    const list = (Friends.data?.friends || []).filter((f) => f.now?.playing);
    for (const f of list) {
      const key = f.now.track.id || `${f.now.track.title}|${f.now.track.artist}`;
      if (heard.has(f.id) && heard.get(f.id) !== key) islandNotify(`${firstName(f.name)} слушает «${f.now.track.title}»`, 'friend');
      heard.set(f.id, key);
    }
    const room = Together.room;
    return {
      live: list.slice(0, 4).map((f) => ({ name: f.name, letter: (f.name || '?').trim()[0]?.toUpperCase() || '?', title: f.now.track.title || '' })),
      count: list.length,
      room: room && room.members.length > 1 ? room.members.length : 0,
    };
  }

  function snapshot(wall) {
    const t = state.track;
    const base = { notice: islandNotices[0] || null };
    if (!t) return { ...base, hasTrack: false };
    let bars = [0, 0, 0, 0, 0];
    let full = null;
    if (fx.analyser && !audio.paused) {
      const data = bins.subarray(0, fx.analyser.frequencyBinCount);
      fx.analyser.getByteFrequencyData(data);
      bars = levels(data);
      if (wall) full = spectrum(data);
    }
    return {
      ...base,
      hasTrack: true,
      id: t.id,
      title: t.title || '',
      artist: t.artist || '',
      cover: t.cover || '',
      playing: !audio.paused,
      pos: audio.currentTime || 0,
      duration: isFinite(audio.duration) ? audio.duration : t.duration || 0,
      at: Date.now(),
      m: +duck.m.toFixed(2),
      manual: !!duck.forced,
      amber: vizColor('amber'),
      voice: vizColor('voice'),
      bars,
      spec: full,
      ...(() => { const l = lyricNow(); return { line: l.cur, lyric: l }; })(),
      friends: friendsNow(),
      opts: { pulse: islandOpt('pulse'), rainbow: islandOpt('rainbow'), lyrics: islandOpt('lyrics'), miniLyrics: state.cfg?.mini?.lyrics !== false },
    };
  }

  function push() {
    lastSent = performance.now();
    const wall = !!state.cfg?.livewall?.enabled;
    api.island.push(snapshot(wall));
  }

  // уведомление показывается ~4 секунды, потом следующее
  setInterval(() => { if (islandNotices.length) islandNotices.shift(); }, 4000);

  let tick = 0;
  setInterval(() => {
    tick++;
    const wall = !!state.cfg?.livewall?.enabled;
    const busy = !audio.paused || duck.m > 0.01;
    // 30 кадров с обоями, иначе 15; на паузе — раз в полторы секунды
    if (busy && (wall || tick % 2 === 0)) push();
    else if (performance.now() - lastSent > 1500) push();
  }, 33);
  for (const ev of ['play', 'pause', 'seeked', 'loadedmetadata', 'emptied']) onAudio(ev, push);

  // «Слушать вместе»: кто-то зашёл или вышел
  api.together.onEvent((ev) => {
    if (ev.type === 'members' && ev.joined?.length) islandNotify(`${ev.joined.map((m) => firstName(m.name || 'друг')).join(', ')} — в комнате`, 'together');
  });

  api.island.onAction((a) => {
    if (locked()) return;
    if (a.type === 'thumb') {
      if (a.action === 'toggle') togglePlay();
      else if (a.action === 'next') next();
      else if (a.action === 'prev') prev();
    } else if (a.type === 'barrel') {
      toggleForcedBarrel();
    } else if (a.type === 'seek' && isFinite(audio.duration)) {
      audio.currentTime = Math.max(0, Math.min(audio.duration, a.pos));
    } else if (a.type === 'volume') {
      setVolume(Math.max(0, Math.min(1, state.cfg.volume + a.delta)), true);
    }
    setTimeout(push, 50);
  });
})();
