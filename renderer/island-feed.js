'use strict';
// Окно плеера → остров, мини-плеер, живые обои и трей (главный процесс раздаёт одно состояние всем):
// что играет, позиция, бочка, спектр, строка текста песни, друзья, уведомления, цвета.
// Пока играет — ~15 раз в секунду (с живыми обоями — 30), на паузе — изредка.
// Общие глобальные из app.js и соседей: state, api, audio, fx, duck, Friends, Together, parseLRC, …

const ISLAND_OPTS = { lyrics: true, friends: true, notify: true, pulse: false, rainbow: false, motion: 'music', bars: true, spin: false };
const islandOpt = (k) => ({ ...ISLAND_OPTS, ...(state.cfg?.island || {}) })[k];

// Уведомление в острове: заявка в друзья, друг включил трек, кто-то зашёл в комнату…
const islandNotices = [];
// person — друг, о котором уведомление: в острове вместо обложки его аватарка.
// actions — кнопки события [{ label, do, arg?, primary? }] (что делают — EVENT_DO). Всплывает уведомление
// как обычно (без кнопок), а в раскрытом острове внизу — лента последних событий с этими кнопками.
// Лента сохраняется (localStorage) и переживает перезапуск плеера
const HISTORY_KEEP = 2 * 3600 * 1000; // событие старше двух часов из ленты уходит
const islandHistory = (() => { // новые в начале; { id, text, kind, at, person, actions }
  try {
    const saved = JSON.parse(localStorage.getItem('aveon.events') || '[]');
    return Array.isArray(saved) ? saved.filter((e) => Date.now() - e.at < HISTORY_KEEP) : [];
  } catch { return []; }
})();
function saveHistory() {
  try { localStorage.setItem('aveon.events', JSON.stringify(islandHistory)); } catch {}
}

// что делают кнопки событий — все в окне плеера (friends.js, together.js)
const EVENT_DO = {
  chat: (id) => chatFromIsland(id),
  listen: (id) => { const f = friendById(id); if (f?.now) playFriend(f, false); else chatFromIsland(id); },
  accept: (id) => friendAction(id, 'accept'),
  decline: (id) => friendAction(id, 'remove'),
  join: (id) => joinInvite(id),
  nojoin: (id) => dismissInvite(id),
  letin: (id) => letIn(id),
  refuse: (id) => refuseKnock(id),
  room: () => { api.island.action({ type: 'focus' }); openTogether(); },
  play: (track) => { if (track?.title) playShared(track); },
};
function islandNotify(text, kind = 'info', person = null, actions = []) {
  if (IS_MOBILE || !api.island) return;
  const p = person ? { id: person.id, avatar: person.avatar, name: person.name } : null;
  const id = `${Date.now()}-${Math.random()}`;
  islandHistory.unshift({ id, text, kind, at: Date.now(), person: p, actions: actions.map(({ label, primary, do: d, arg }) => ({ label, primary, do: d, arg })) });
  if (islandHistory.length > 10) islandHistory.length = 10;
  saveHistory();
  if (!islandOpt('notify')) return;
  islandNotices.push({ id, text, kind, person: p });
  if (islandNotices.length > 5) islandNotices.shift();
  window.islandPushSoon?.(); // сразу, а не через 1,5 с, когда на паузе
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
      if (r.words?.length) lyr.lines = r.words.map((l) => ({ t: l.ts, words: l.words, text: l.words.map((w) => w.text).join(' ').replace(/- /g, '-') }));
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
    // richsync: время слов текущей строки — остров сам заливает буквы между сообщениями
    const words = lyr.lines[i]?.words;
    const letters = words && window.LOOK?.lyricsLetters !== false
      ? words.map((w, k) => ({ s: w.t, e: Math.min(words[k + 1]?.t ?? lyr.lines[i + 1]?.t ?? w.t + 1, w.t + 1.2), n: w.text.length + (k ? 1 : 0) }))
      : null;
    return { prev: i > 0 ? text(i - 1) : '', cur, next: text(i + 1), gap: !cur, has: true, letters };
  }

  // ---- друзья: кто слушает прямо сейчас, и кто из них только что включил новый трек ----
  const heard = new Map(); // id друга → { playing, said }: слушает ли и когда о нём последний раз сказали

  // Состояние уходит в остров до 30 раз в секунду — картинки туда не гоняем. Остров получает
  // аватарку один раз (avatars: {ключ: data:…}), дальше — только ключ. Раз в полминуты шлём заново:
  // вдруг остров перезапускался и всё забыл
  const sentAvatars = new Set();
  let newAvatars = {};
  setInterval(() => sentAvatars.clear(), 30000);
  function avatarKey(p) {
    const url = typeof friendAvatarUrl === 'function' ? friendAvatarUrl(p) : ''; // friends.js
    if (!url) return '';
    const key = `${p.id}:${p.avatar}`;
    if (!sentAvatars.has(key)) { sentAvatars.add(key); newAvatars[key] = url; }
    return key;
  }
  function friendsNow() {
    if (!islandOpt('friends')) return null;
    const list = (Friends.data?.friends || []).filter((f) => f.now?.playing);
    // «друг слушает» — только когда начал после тишины, не чаще раза в 10 минут на друга и не про тех,
    // кто с тобой в руме (раньше — на каждую смену трека у каждого друга)
    const t = Date.now();
    const inRoom = new Set((Together.room?.members || []).map((m) => m.user));
    for (const f of list) {
      const was = heard.get(f.id);
      if (was && !was.playing && t - was.said > 10 * 60 * 1000 && !inRoom.has(f.id)) {
        islandNotify(`${firstName(f.name)} слушает «${f.now.track.title}»`, 'friend', f, [
          { label: '▶ Слушать', primary: true, do: 'listen', arg: f.id },
          { label: 'Написать', do: 'chat', arg: f.id },
        ]);
        was.said = t;
      }
      heard.set(f.id, { playing: true, said: was ? was.said : t }); // уже слушал, когда плеер открыли — без уведомления
    }
    for (const [id, h] of heard) if (!list.some((f) => f.id === id)) h.playing = false;
    // кто сейчас молчит — тоже запоминаем: когда включит, это «начал после тишины»
    for (const f of Friends.data?.friends || []) if (!heard.has(f.id)) heard.set(f.id, { playing: false, said: 0 });
    const room = Together.room;
    return {
      live: list.slice(0, 4).map((f) => ({ name: f.name, letter: (f.name || '?').trim()[0]?.toUpperCase() || '?', title: f.now.track.title || '', av: avatarKey(f) })),
      count: list.length,
      room: room && room.members.length > 1 ? room.members.length : 0,
    };
  }

  // ---- устройство вывода: сменилось (надел наушники) — остров на пару секунд показывает, куда теперь
  // идёт звук, как при подключении AirPods. Плеер играет в устройство по умолчанию: его и смотрим
  let output = null; // { id, name, kind, at } — at: когда сменилось (0 — таким был при запуске)
  function describe(label) {
    const clean = String(label || '').replace(/^(по умолчанию|default|связь|communications)\s*-\s*/i, '').trim();
    // «Наушники (WH-1000XM4 Stereo)» → «WH-1000XM4 Stereo»; «Динамики (Realtek(R) Audio)» → «Realtek(R) Audio»
    const m = clean.match(/^([^(]+?)\s*\((.+)\)$/);
    const name = (m && /^(динамики|наушники|гарнитура|speakers?|headphones|headset|earphones)$/i.test(m[1]) ? m[2] : clean).trim();
    const kind = /науш|гарнитур|headphone|headset|earphone|airpods|buds|hands-free|wh-|wf-/i.test(clean) ? 'headphones' : 'speaker';
    return { name, kind };
  }
  async function checkOutput() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const d = list.find((x) => x.kind === 'audiooutput' && x.deviceId === 'default') || list.find((x) => x.kind === 'audiooutput');
      if (!d) return;
      const id = `${d.groupId}|${d.label}`;
      if (output?.id === id) return;
      const first = !output;
      output = { id, ...describe(d.label), at: first ? 0 : Date.now() };
      if (first || !output.name) return;
      if (document.hasFocus()) toast(`Звук — в «${output.name}»`); // остров при открытом плеере не виден
      push();
    } catch {}
  }
  navigator.mediaDevices?.addEventListener('devicechange', () => setTimeout(checkOutput, 300)); // Windows меняет «по умолчанию» чуть позже
  checkOutput();

  function snapshot(wall) {
    const t = state.track;
    const n = islandNotices[0];
    if (n && !n.shownAt) n.shownAt = Date.now(); // с этого момента уведомление на экране
    const now = Date.now();
    while (islandHistory.length && now - islandHistory[islandHistory.length - 1].at > HISTORY_KEEP) islandHistory.pop();
    const events = islandHistory.slice(0, 3).map((e) => ({
      id: e.id, text: e.text, kind: e.kind, at: e.at,
      av: e.person ? avatarKey(e.person) : '', letter: e.person ? (e.person.name || '?').trim()[0]?.toUpperCase() : '',
      acts: e.actions.map((a, i) => ({ i, label: a.label, primary: !!a.primary })),
    }));
    const base = { events, notice: n ? { id: n.id, text: n.text, kind: n.kind, av: n.person ? avatarKey(n.person) : '' } : null,
      device: output?.at ? { name: output.name, kind: output.kind, at: output.at } : null };
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
      // «нравится» — только у треков Яндекс Музыки, и снять отсюда нельзя (app.js → renderNowLike)
      source: t.source,
      likeable: t.source === 'ym',
      liked: renderNowLike.has(t.id),
      opts: { motion: islandOpt('motion'), bars: islandOpt('bars'), spin: islandOpt('spin'), pulse: islandOpt('pulse'), rainbow: islandOpt('rainbow'), lyrics: islandOpt('lyrics'), miniLyrics: state.cfg?.mini?.lyrics !== false },
    };
  }

  function push() {
    lastSent = performance.now();
    const wall = !!state.cfg?.livewall?.enabled;
    const snap = snapshot(wall);
    if (Object.keys(newAvatars).length) { snap.avatars = newAvatars; newAvatars = {}; }
    api.island.push(snap);
  }

  window.islandPushSoon = () => push();
  // уведомление показывается 4,2 с с момента, когда ушло в остров, потом следующее.
  // Раньше очередь сдвигалась по часам раз в 4 с — пришедшее перед сдвигом пропадало, не показавшись
  setInterval(() => {
    const n = islandNotices[0];
    if (n?.shownAt && Date.now() - n.shownAt >= 4200) { islandNotices.shift(); push(); }
  }, 250);

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
    // сервер присылает имя строкой (together.py: joined / left) — раньше тут был .map и падало
    if (ev.type === 'members' && ev.joined) islandNotify(`${firstName(ev.joined)} — в руме`, 'together');
    if (ev.type === 'members' && ev.left) islandNotify(`${firstName(ev.left)} вышел из румы`, 'together');
  });

  api.island.onAction((a) => {
    if (locked()) return;
    // лента событий раскрытого острова: кнопка события (выполнить и убрать) или крестик (просто убрать)
    if (a.type === 'event') {
      const k = islandHistory.findIndex((x) => x.id === a.id);
      console.log('[остров] событие', a, 'нашлось', k >= 0, k >= 0 ? islandHistory[k].actions : null); // временно
      const ev = k >= 0 ? islandHistory[k] : null;
      if (k >= 0) { islandHistory.splice(k, 1); saveHistory(); }
      push();
      const b = a.i != null ? ev?.actions[a.i] : null;
      try { if (b) EVENT_DO[b.do]?.(b.arg); } catch (e) { console.warn('кнопка события:', e); }
      return;
    }
    if (a.type === 'thumb') {
      if (a.action === 'toggle') togglePlay();
      else if (a.action === 'next') next();
      else if (a.action === 'prev') prev();
    } else if (a.type === 'sc') {
      // «Найти в SoundCloud» из острова — как одноимённая кнопка у плеера: окно вперёд и поиск
      api.island.action({ type: 'focus' });
      $('#btn-now-sc').click();
    } else if (a.type === 'like') {
      $('#btn-like').click(); // тот же лайк, что у названия в плеере
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
