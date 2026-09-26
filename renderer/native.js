'use strict';
// Android: интерфейс рисует Compose (mobile/android/app/src/main/java/com/aveon/player/ui), а движок —
// этот же плеер в WebView под ним. Здесь мост между ними: состояние плеера и библиотеки уходит
// в Compose (AveonUI.emit), команды из Compose приходят в NativeUI.call. Меню, диалоги и уведомления
// движка перехватываются и показываются нативно; панели (настройки, профиль, друзья, рума, вход…)
// отдаются «зеркалом» — деревом из заголовков, текста, кнопок и полей, которое Compose рисует по-своему.
// Так на телефоне работает всё то же, что на компьютере, а выглядит — по-другому.
// Подключается только в Android-сборке (mobile/build.mjs); без AveonUI (старая оболочка) ничего не делает.

(() => {
  const UI = window.AveonUI;
  if (!UI) return;
  document.documentElement.classList.add('native-ui');
  // Разметку под Compose никто не видит — раскладываем её как на компьютере: так в «зеркале» панелей
  // есть все подписи и поля, которые телефонная вёрстка прячет
  document.querySelector('link[href="mobile.css"]')?.remove();
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.content = 'width=1280';

  const J = (v) => JSON.stringify(v === undefined ? null : v);
  const emit = (type, data) => { try { UI.emit(type, J(data)); } catch (e) { console.warn('native emit', type, e); } };
  const abs = (u) => { if (!u) return ''; try { return new URL(u, location.href).href; } catch { return ''; } };
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const handlers = {};

  window.NativeUI = {
    call(id, name, args) {
      Promise.resolve()
        .then(() => {
          const fn = handlers[name];
          if (!fn) throw new Error(`нет команды ${name}`);
          return fn(...(args ? JSON.parse(args) : []));
        })
        .then((r) => UI.reply(id, true, J(r)), (e) => UI.reply(id, false, J(String(e?.message || e))));
    },
  };

  // ---------- треки ----------

  const isDl = (t) => { try { return DL.done.has(dlKey(t)); } catch { return false; } };
  const slim = (t) => t && ({
    id: t.id, title: t.title || '', artist: t.artist || '', album: t.album || '', duration: +t.duration || 0,
    cover: abs(t.cover), source: t.source || '', playable: t.playable !== false, preview: !!t.preview, dl: isDl(t),
  });

  // ---------- плеер ----------

  function playerState() {
    const t = state.track;
    const d = audio.duration;
    const m = duck.meter || {};
    const room = Together.room;
    return {
      track: slim(t),
      playing: !audio.paused,
      pos: audio.currentTime || 0,
      dur: isFinite(d) && d > 0 ? d : (t?.duration || 0),
      at: Date.now(),
      volume: state.cfg?.volume ?? 1,
      muted: !!state.muted,
      shuffle: !!state.cfg?.shuffle,
      repeat: state.cfg?.repeat || 'off',
      via: $('#now-via').hidden ? '' : txt($('#now-via')),
      barrel: +duck.m.toFixed(3),
      manual: !!m.manual,
      call: !!m.call,
      duckOn: !!state.cfg?.duck?.enabled,
      wave: !!Wave.active,
      waveLoading: !!Wave.loading,
      dj: !!duck.dj,
      karaoke: !!karaoke.on,
      sleep: sleep.endOfTrack ? -1 : sleep.at ? Math.round(sleepLeft() / 1000) : 0,
      focus: pomo.on ? { phase: pomo.phase, left: Math.round(focusLeft() / 1000), paused: !!pomo.paused, round: pomo.round } : null,
      room: room ? { code: room.code, connected: room.connected !== false, members: room.members.map((x) => firstName(x.name)), you: room.you } : null,
      friendsBadge: !$('#friends-badge').hidden,
      locked: locked(),
      hasQueue: state.queue.length > 1,
    };
  }

  let pushTimer = 0;
  function push() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => { pushTimer = 0; emit('player', playerState()); }, 40);
  }
  for (const ev of ['play', 'pause', 'loadedmetadata', 'emptied', 'seeked', 'ended', 'durationchange']) onAudio(ev, push);
  setInterval(push, 1000);
  const origShowNow = showNow;
  window.showNow = function (...a) { origShowNow.apply(this, a); push(); pushStats(); };

  // ---------- палитра: Compose красится теми же цветами, что и плеер (обложка, «Оформление») ----------

  const THEME_KEYS = ['--oak', '--oak-2', '--rivet', '--rivet-2', '--hoop', '--hoop-dim', '--text', '--text-2', '--text-3', '--amber', '--voice', '--danger'];
  let lastTheme = '';
  // Переменные бывают заданы как угодно (hex, hsl, color-mix) — через пробный элемент получаем rgb()
  const probe = document.createElement('i');
  probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
  document.body.appendChild(probe);
  function pushTheme() {
    const theme = Object.fromEntries(THEME_KEYS.map((k) => {
      probe.style.color = `var(${k})`;
      return [k.slice(2), getComputedStyle(probe).color];
    }));
    const s = J(theme);
    if (s !== lastTheme) { lastTheme = s; UI.emit('theme', s); }
  }
  new MutationObserver(pushTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
  setInterval(pushTheme, 1500);

  // ---------- аккаунт и статистика для виджетов ----------

  let lastAcc = '';
  function pushAccount() {
    const a = state.account || {};
    const s = J({ loggedIn: !!a.loggedIn, name: a.name || '', login: a.login || '', avatar: abs(a.avatar || ''), server: a.server || '' });
    if (s !== lastAcc) { lastAcc = s; UI.emit('account', s); }
  }
  setInterval(pushAccount, 2000);

  function pushStats() {
    try {
      const today = stats.data.days[dayKey()] || 0;
      const mk = monthKey();
      let month = 0;
      const by = new Map();
      for (const r of Object.values(stats.data.tracks)) {
        const sec = r.m?.[mk]?.sec || 0;
        month += sec;
        if (!sec || !r.t) continue;
        for (const n of splitArtists(r.t.artist).slice(0, 1)) by.set(n, (by.get(n) || 0) + sec);
      }
      const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
      emit('stats', { today: Math.round(today / 60), month: Math.round(month / 60), artist: top?.[0] || '', monthName: MONTHS_IN[new Date().getMonth()] }); // «в сентябре»
    } catch {}
  }
  setInterval(pushStats, 60000);

  // ---------- уведомления, меню, диалоги ----------

  window.toast = (msg, kind = '') => emit('toast', { msg: String(msg), kind: kind === true ? 'err' : kind || '' });

  let menuSeq = 0;
  let menuItems = null;
  window.showMenu = (items) => {
    menuItems = items;
    emit('menu', {
      id: ++menuSeq,
      items: items.map((it) => (it.sep ? { sep: true } : it.note ? { note: String(it.note) }
        : { label: String(it.label ?? ''), icon: it.icon || '', count: it.count != null ? String(it.count) : '', danger: !!it.danger, muted: !!it.muted })),
    });
  };
  window.closeMenu = () => {
    if (!menuItems) return;
    menuItems = null;
    emit('menuClose', menuSeq);
  };
  handlers.menuPick = (id, i) => {
    if (id !== menuSeq || !menuItems) return;
    const it = menuItems[i];
    menuItems = null;
    it?.onClick?.();
  };
  handlers.menuCancel = (id) => { if (id === menuSeq) menuItems = null; };

  let askSeq = 0;
  const asks = new Map();
  window.ask = (o) => new Promise((resolve) => {
    const id = ++askSeq;
    asks.set(id, resolve);
    emit('ask', { id, title: o.title || '', text: o.text || '', value: o.value || '', ok: o.ok || 'Готово', input: o.input !== false, danger: !!o.danger, password: !!o.password });
  });
  handlers.askDone = (id, result) => {
    const r = asks.get(id);
    asks.delete(id);
    r?.(result);
  };

  // ---------- команды плеера ----------

  Object.assign(handlers, {
    toggle: () => togglePlay(),
    next: () => next(),
    prev: () => prev(),
    seek: (sec) => { if (isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration - 0.2, sec)); push(); },
    volume: (v, persist) => setVolume(Math.max(0, Math.min(1, v)), !!persist),
    mute: () => toggleMute(),
    shuffle: () => { toggleShuffle(); push(); },
    repeat: () => { cycleRepeat(); push(); },
    barrel: () => { api.mobile.barrel(!duck.meter.manual); setTimeout(push, 100); },
    duckEnabled: (on) => saveCfg({ duck: { enabled: !!on } }).then(push),
    modes: () => $('#btn-modes').click(),
    addToAlbum: () => $('#btn-now-album').click(),
    findSc: () => $('#btn-now-sc').click(),
    artist: (name) => openArtist(name),
    trackArtists: () => splitArtists(state.track?.artist),
    player: () => playerState(),
    // очередь: что играет и что дальше
    queue: () => ({ tracks: state.order.map((i) => slim(state.queue[i])), pos: state.pos }),
    queuePlay: (p) => {
      if (p < 0 || p >= state.order.length) return;
      state.pos = p;
      loadTrack(state.queue[state.order[p]]);
    },
    together: () => openTogether(),
    friends: () => openFriends(),
    profile: () => openProfile(),
    settings: (sec) => openSettings(sec || undefined),
    react: (e) => sendReact(e),
    sleepCancel: () => cancelSleep(),
    focusPanel: () => openFocus(),
    karaokeOff: () => { if (karaoke.on) toggleKaraoke(false); if (!$('#fs').hidden) exitFs(); },
    ready: () => ready,
  });

  // ---------- скретч: пластинку в плеере крутят пальцем (scratch.js) ----------

  handlers.scratchStart = async () => {
    if (!scratchOn() || !state.track) return false;
    ensureGraph();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const node = await ensureScratchNode();
    if (!node) return false;
    vinyl.held = true;
    vinyl.last = { a: 0, t: performance.now() };
    vinyl.handRate = 0;
    vinyl.startTime = audio.currentTime;
    node.port.postMessage({ type: 'start', rate: audio.paused ? 0 : 1 });
    return true;
  };
  // deg — на сколько повернули пальцем с прошлого раза, ms — за сколько
  handlers.scratchMove = (deg, ms) => {
    if (!vinyl.held) return;
    const rate = Math.max(-4, Math.min(4, deg / (Math.max(1, ms) / 1000) / OMEGA));
    vinyl.angle += deg;
    vinyl.handRate = vinyl.handRate * 0.5 + rate * 0.5;
    vinyl.node?.port.postMessage({ type: 'rate', rate: vinyl.handRate });
    vinyl.last = { a: 0, t: performance.now() };
  };
  handlers.scratchEnd = () => {
    if (!vinyl.held) return;
    vinyl.held = false;
    vinyl.node?.port.postMessage({ type: 'stop' }); // ответит сдвигом → finishScratch
  };

  // ---------- реакции в руме: летят и над Compose-экраном ----------

  const origFly = flyReact;
  window.flyReact = (e, who) => {
    origFly(e, who); // бочка от 🛢 и прочее — в движке
    if (TG_REACTS.includes(e)) emit('react', { e, who: who || '' });
  };

  // ---------- текст песни ----------

  handlers.lyrics = async () => {
    const t = state.track;
    if (!t) return { none: true };
    const res = await api.lyrics(t);
    const out = { id: t.id, from: LYRICS_FROM[res.from] || '' };
    if (res.words?.length) out.words = res.words.map((l) => ({ t: l.ts, w: l.words.map((w) => ({ t: w.t, s: w.text })) }));
    else if (res.synced) out.lines = parseLRC(res.synced).map((l) => ({ t: l.t, s: l.text }));
    else if (res.plain) out.plain = res.plain;
    else if (res.instrumental) out.instrumental = true;
    return out;
  };
  handlers.letters = () => window.LOOK?.lyricsLetters !== false;

  // ---------- спектр для визуализатора и живой обложки ----------

  let specTimer = 0;
  const specBuf = new Uint8Array(2048);
  handlers.spectrum = (on) => {
    clearInterval(specTimer);
    if (!on) return;
    ensureGraph();
    specTimer = setInterval(() => {
      if (!fx.analyser) return;
      const n = fx.analyser.frequencyBinCount;
      const d = specBuf.subarray(0, n);
      if (audio.paused) d.fill(0); else fx.analyser.getByteFrequencyData(d);
      const bands = 48;
      const out = new Array(bands);
      for (let k = 0; k < bands; k++) {
        const lo = Math.floor(Math.pow(k / bands, 1.7) * n * 0.75);
        const hi = Math.max(lo + 1, Math.floor(Math.pow((k + 1) / bands, 1.7) * n * 0.75));
        let v = 0;
        for (let i = lo; i < hi; i++) if (d[i] > v) v = d[i];
        out[k] = v;
      }
      UI.emit('spec', out.join(','));
    }, 33);
  };

  // ---------- главная ----------

  let homeLists = [];
  let homeTop = [];
  handlers.home = () => {
    const ym = waveMode() === 'ym';
    const cfg = waveCfg();
    const moodWord = { active: 'бодрое', fun: 'весёлое', calm: 'спокойное', sad: 'грустное' }[cfg.mood];
    const divWord = { favorite: 'из любимого', discover: 'незнакомое', popular: 'популярное' }[cfg.diversity];
    homeTop = topTracks(8);
    homeLists = homePlaylists();
    for (const src of HOME_SERVICES) {
      if (serviceReady(src) && !state.collections[src]) loadCollections(src).then(() => emit('homeChanged'));
    }
    return {
      greeting: homeGreeting(),
      line: homeLine(),
      wave: { ym, note: [ym && moodWord, divWord].filter(Boolean).join(', ') || (ym ? 'Из твоей Яндекс Музыки' : 'Из того, что ты слушаешь'), dj: !!cfg.dj },
      tracks: homeTop.map(slim),
      lists: homeLists.map((l) => ({ title: l.title, meta: l.meta, cover: abs(l.cover), icon: l.icon })),
      artists: topArtists(12).map((a) => ({ name: a.name, cover: abs(a.cover) })),
      friends: (Friends.data?.friends || []).filter((f) => f.now?.playing).slice(0, 8)
        .map((f) => ({ id: f.id, name: f.name, title: f.now.track.title, artist: f.now.track.artist || '', cover: abs(f.now.track.cover) })),
      wrapped: [11, 0].includes(new Date().getMonth()) ? wrappedYear() : 0,
    };
  };
  handlers.homeTrack = (i) => playFrom(homeTop, i);
  handlers.homeList = (i) => homeLists[i]?.open();
  handlers.friendProfile = (id) => openFriendProfile(id);

  // ---------- волна ----------

  handlers.wave = () => {
    const cfg = waveCfg();
    const ym = waveMode() === 'ym';
    const keys = ym ? ['mood', 'diversity', 'language', 'dj'] : ['diversity', 'dj'];
    const upcoming = Wave.active ? state.order.slice(Math.max(0, state.pos) + 1).map((i) => slim(state.queue[i])).filter(Boolean) : [];
    return {
      ym,
      active: !!Wave.active,
      loading: !!Wave.loading,
      playing: Wave.active && !audio.paused,
      dj: !!duck.dj,
      words: keys.map((k) => {
        const { cur, opts } = waveChoice(k);
        return { key: k, title: WAVE_TITLES[k], cur, opts: opts.map(([v, s]) => ({ v, s })) };
      }),
      upcoming,
    };
  };
  handlers.waveGo = () => {
    if (Wave.active) togglePlay();
    else waveStart();
  };
  handlers.waveSet = (key, v) => setWave(key, v, { soon: true });
  handlers.waveLike = () => waveLike();
  handlers.waveDislike = () => waveDislike();
  handlers.waveUpcoming = (i) => handlers.queuePlay(state.pos + 1 + i);
  window.addEventListener('aveon-wave', () => handlers.waveGo()); // виджет «Волна» (мост → MediaService)

  // ---------- библиотека ----------
  // Разделы — те же, что на компьютере (openView). Содержимое читаем из разметки: заголовок, фишки
  // коллекций, кнопки над списком, пустое состояние и блоки списка (треки — индексами в state.shown).

  let nidSeq = 0;
  const nid = (el) => { if (!el.dataset.nid) el.dataset.nid = String(++nidSeq); return +el.dataset.nid; };
  const iconOf = (el) => el?.querySelector('use')?.getAttribute('href')?.replace('#', '') || '';

  handlers.open = async (view, sub) => { await openView(view, sub ?? null); lastLib = ''; libPush(true); };
  handlers.chip = (i) => $$('#collections .chip')[i]?.click();
  handlers.action = (i) => $$('#head-actions button')[i]?.click();
  handlers.emptyAction = (i) => $$('#empty .actions button')[i]?.click();
  handlers.row = (i) => {
    const t = state.shown[i];
    if (!t) return;
    if (state.track?.id === t.id) togglePlay();
    else if (t.playable !== false) playFrom(state.shown, i);
  };
  handlers.rowMenu = (i) => openTrackMenu(i, { x: 0, y: 0 });
  handlers.editTags = (i) => { const t = state.shown[i]; if (t?.source === 'local') openEditor(t); };
  handlers.search = (q, submit) => {
    searchInput.value = q;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (submit) $('#search-form').requestSubmit();
  };
  handlers.click = (id) => { document.querySelector(`[data-nid="${id}"]`)?.click(); };
  handlers.albumMove = async (from, to) => {
    if (!state.album) return;
    state.album = await api.albums.move(state.album.id, from, to);
    renderAlbum();
  };
  handlers.canReorder = () => canReorder();

  function card(b) {
    const img = b.querySelector('img:not(.emoji)');
    const pic = b.querySelector('.artist-pic, .disc-pic, .sa-pic, .h-card-pic, .h-artist-pic');
    return {
      id: nid(b),
      img: abs(img?.getAttribute('src')),
      title: txt(b.querySelector('.artist-card-name, .disc-title, b')) || txt(b),
      sub: txt(b.querySelector('.artist-count, .disc-meta, small')),
      badge: txt(b.querySelector('.disc-mine')),
      letter: img ? '' : txt(pic).slice(0, 2),
      round: b.matches('.artist-card, .sa-card, .h-artist'),
    };
  }

  function libBlocks(root) {
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c.hidden) continue;
        if (c.classList.contains('row')) {
          const i = +c.dataset.i;
          const last = out[out.length - 1];
          if (last?.t === 'rows' && last.from + last.n === i) last.n++;
          else out.push({ t: 'rows', from: i, n: 1 });
          continue;
        }
        if (/^H[1-4]$/.test(c.tagName)) {
          const count = c.querySelector('span');
          out.push({ t: 'h', s: txt(count ? c.firstChild : c), count: txt(count) });
          continue;
        }
        if (c.matches('.artist-grid, .disc-grid')) { out.push({ t: 'grid', items: [...c.querySelectorAll('button')].map(card) }); continue; }
        if (c.matches('.sa-row')) { out.push({ t: 'row', items: [...c.querySelectorAll('button')].map(card) }); continue; }
        if (c.matches('.artist-hero')) {
          const img = c.querySelector('.hero-pic img');
          const bg = c.querySelector('.hero-bg');
          out.push({
            t: 'hero', name: txt(c.querySelector('.hero-name')), stats: txt(c.querySelector('.hero-stats')).replace(/\s*·\s*/g, ' · '),
            meta: txt(c.querySelector('.hero-meta')), img: abs(img?.getAttribute('src')),
            banner: abs(bg?.dataset.bg || bg?.getAttribute('poster') || ''),
            buttons: [...c.querySelectorAll('.hero-actions button')].map((b) => ({ id: nid(b), s: txt(b), icon: iconOf(b), primary: b.classList.contains('primary'), disabled: b.disabled })),
          });
          continue;
        }
        if (c.matches('.album-head')) {
          const play = c.querySelector('button');
          out.push({ t: 'group', img: abs(c.querySelector('img')?.getAttribute('src')), title: txt(c.querySelector('b')), sub: txt(c.querySelector('.album-meta > span')), play: play ? nid(play) : 0 });
          continue;
        }
        if (c.matches('.disc-loading, .spinner')) { out.push({ t: 'loading', s: txt(c) }); continue; }
        if (c.tagName === 'P') { out.push({ t: 'p', s: txt(c) }); continue; }
        walk(c);
      }
    };
    walk(root);
    return out;
  }

  let lastShown = null;
  let lastShownLen = -1;
  let shownJson = '[]';
  let lastLib = '';
  function libSnapshot() {
    if (state.shown !== lastShown || state.shown.length !== lastShownLen) {
      lastShown = state.shown;
      lastShownLen = state.shown.length;
      shownJson = J(state.shown.map(slim));
    }
    const empty = $('#empty');
    const list = $('#tracklist');
    const snap = {
      view: state.view,
      sub: state.sub,
      title: txt($('#view-title')),
      sub2: txt($('#view-sub')),
      placeholder: searchInput.placeholder,
      query: searchInput.value,
      chips: $$('#collections .chip').map((b) => ({
        label: b.title || txt(b.querySelector('span:not(.count)')), active: b.classList.contains('active'),
        icon: iconOf(b), cover: abs(b.querySelector('img')?.getAttribute('src')), count: txt(b.querySelector('.count')),
      })),
      actions: $$('#head-actions button').map((b) => ({ s: txt(b), label: b.getAttribute('aria-label') || txt(b), icon: iconOf(b), primary: b.classList.contains('primary'), disabled: b.disabled })),
      empty: empty.hidden ? null : {
        title: txt(empty.querySelector('h3')), text: txt(empty.querySelector('p')), loading: !!empty.querySelector('.spinner'),
        actions: $$('.actions button', empty).map((b) => ({ s: txt(b), primary: b.classList.contains('primary') })),
      },
      blocks: list.hidden ? [] : libBlocks(list),
      reorder: typeof canReorder === 'function' && canReorder(),
    };
    return snap;
  }
  let libTimer = 0;
  function libPush(now) {
    const run = () => {
      libTimer = 0;
      const snap = J(libSnapshot());
      const key = snap + shownJson.length + (lastShown?.[0]?.id || '');
      if (key === lastLib) return;
      lastLib = key;
      UI.emit('library', `{"snap":${snap},"tracks":${shownJson}}`);
    };
    if (now) { clearTimeout(libTimer); run(); } else if (!libTimer) libTimer = setTimeout(run, 90);
  }
  new MutationObserver(() => libPush()).observe($('#content'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'disabled'] });
  handlers.library = () => { lastLib = ''; libPush(true); };

  // ---------- эквалайзер ----------

  let eqSave = 0;
  function eqSnap() {
    const e = state.cfg.eq;
    return {
      enabled: !!e.enabled, preset: e.preset, gains: [...e.gains], preamp: +e.preamp || 0, freqs: EQ_FREQS, max: EQ_MAX, name: eqPresetName(),
      presets: [...EQ_PRESETS.map(([id, name, gains]) => ({ id, name, gains, preamp: 0, mine: false })),
        ...eqMine().map((p) => ({ id: p.id, name: p.name, gains: p.gains, preamp: p.preamp || 0, mine: true }))],
    };
  }
  handlers.eq = () => eqSnap();
  handlers.eqSet = (patch) => {
    Object.assign(state.cfg.eq, patch);
    eqApply(!!patch.preset);
    clearTimeout(eqSave);
    eqSave = setTimeout(() => {
      const { enabled, preset, gains, preamp, custom } = state.cfg.eq;
      saveCfg({ eq: { enabled, preset, gains: [...gains], preamp, custom } });
    }, 300);
    return eqSnap();
  };
  handlers.eqSaveMine = async (name) => { await eqAddMine({ name, gains: state.cfg.eq.gains, preamp: state.cfg.eq.preamp }); return eqSnap(); };
  handlers.eqDeleteMine = async (id) => {
    const custom = eqMine().filter((p) => p.id !== id);
    state.cfg.eq.custom = custom;
    if (state.cfg.eq.preset === id) state.cfg.eq.preset = 'custom';
    await saveCfg({ eq: { custom, preset: state.cfg.eq.preset } });
    return eqSnap();
  };
  handlers.eqShare = (id) => { const p = eqMine().find((x) => x.id === id) || { name: eqPresetName(), gains: state.cfg.eq.gains, preamp: state.cfg.eq.preamp }; shareEqPreset(p); };
  handlers.eqPaste = () => openShareCode();

  // ---------- визуализатор, итоги года, караоке — нативно ----------

  window.openVisualizer = () => emit('open', { k: 'visualizer' });
  window.openWrapped = () => {
    const year = wrappedYear();
    const d = wrappedData(year);
    if (d.total < 600) { toast(`За ${year} год пока почти ничего не наслушано — включай музыку, итоги соберутся сами`); return; }
    const p = wrappedPersona(d);
    emit('open', {
      k: 'wrapped',
      data: {
        year, total: Math.round(d.total), activeDays: d.activeDays, months: d.months.map(Math.round), bestMonth: d.bestMonth,
        bestMonthName: MONTHS[d.bestMonth], bestDay: d.bestDay ? { key: d.bestDay[0], sec: Math.round(d.bestDay[1]) } : null,
        bestDayText: d.bestDay ? (() => { const [, m, dd] = d.bestDay[0].split('-').map(Number); return `${dd} ${MONTHS_GEN[m - 1]}`; })() : '',
        comparison: wrappedComparison(d.total),
        tracks: d.tracks.slice(0, 5).map((x) => ({ ...slim(x.t), plays: x.plays, sec: Math.round(x.sec) })),
        artists: d.arts.slice(0, 5).map((a) => ({ name: a.name, cover: abs(a.cover), sec: Math.round(a.sec), share: Math.max(1, Math.round((a.sec / d.total) * 100)) })),
        persona: p,
      },
    });
  };
  handlers.wrapped = () => openWrapped();
  handlers.wrappedPlay = (ids) => {
    const all = Object.values(statsAll().tracks).map((r) => r.t).filter(Boolean);
    const list = ids.map((id) => all.find((t) => t.id === id)).filter(Boolean);
    if (list.length) playFrom(list, 0);
  };

  // ---------- панели: зеркало разметки ----------
  // Дерево: h (заголовок), p (абзац), text, img, btn, switch, range, input, select, seg, field, nav,
  // list, box, form. Интерактивным узлам даём data-nid — по нему Compose присылает действия.

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'svg']);

  function visible(el) {
    if (el.hidden) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function labelOf(input) {
    return input.getAttribute('aria-label') || txt(input.closest('.field')?.querySelector(':scope > label'))
      || txt(input.labels?.[0]) || input.placeholder || '';
  }

  function inline(el) {
    // Эмодзи-картинки — обратно в символы, чтобы Compose нарисовал их сам
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1) {
        if (n.tagName === 'IMG' && n.classList.contains('emoji')) s += n.alt;
        else if (n.tagName === 'BR') s += '\n';
        else if (!SKIP.has(n.tagName) && visible(n)) s += inline(n);
      }
    }
    return s;
  }
  const clean = (s) => s.replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').trim();

  function kids(el) {
    const out = [];
    for (const c of el.childNodes) {
      if (c.nodeType === 3) {
        const s = clean(c.textContent);
        if (s) out.push({ t: 'text', s });
        continue;
      }
      if (c.nodeType !== 1 || SKIP.has(c.tagName)) continue;
      if (c.tagName === 'IMG' && c.classList.contains('emoji')) { out.push({ t: 'text', s: c.alt }); continue; }
      if (!visible(c)) continue;
      const n = mirror(c);
      if (n) out.push(n);
    }
    return out;
  }

  const hasCtl = (el) => !!el.querySelector('button, a[href], input, select, textarea, [role="button"], [tabindex="0"]');
  const clsOf = (el) => (typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 4).join(' ') : '');

  function mirror(el) {
    const tag = el.tagName;
    const cls = clsOf(el);
    if (tag === 'IMG') return { t: 'img', src: abs(el.getAttribute('src')), cls };
    if (tag === 'INPUT') {
      const type = el.type;
      if (type === 'hidden' || type === 'file') return null;
      if (type === 'checkbox' || type === 'radio') return { t: 'switch', id: nid(el), on: el.checked, label: labelOf(el), disabled: el.disabled };
      if (type === 'range') {
        const val = el.closest('.ctl, .field')?.querySelector('.val');
        return { t: 'range', id: nid(el), min: +el.min || 0, max: +(el.max || 100), step: el.step === 'any' ? 0 : +(el.step || 1), v: +el.value, label: labelOf(el), val: txt(val), disabled: el.disabled };
      }
      return { t: 'input', id: nid(el), type, v: el.value, ph: el.placeholder || '', label: labelOf(el), max: el.maxLength > 0 ? el.maxLength : 0, disabled: el.disabled };
    }
    if (tag === 'TEXTAREA') return { t: 'input', id: nid(el), type: 'multi', v: el.value, ph: el.placeholder || '', label: labelOf(el), disabled: el.disabled };
    if (tag === 'SELECT') {
      return { t: 'select', id: nid(el), v: el.value, label: labelOf(el), opts: [...el.options].map((o) => ({ v: o.value, s: o.textContent.trim() })), disabled: el.disabled };
    }
    const clickable = tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link' || el.getAttribute('role') === 'tab'
      || el.classList.contains('clickable');
    if (clickable) {
      const img = el.querySelector('img:not(.emoji)');
      const lines = [];
      if (el.children.length && [...el.children].some((c) => /^(SPAN|B|SMALL|STRONG|EM|I|DIV)$/.test(c.tagName) && txt(c))) {
        for (const c of el.querySelectorAll(':scope > *, :scope > * > b, :scope > * > small, :scope > * > span')) {
          if (c.children.length && [...c.children].some((x) => txt(x))) continue;
          if (!visible(c)) continue;
          const s = clean(inline(c));
          if (s && !lines.includes(s)) lines.push(s);
        }
      }
      return {
        t: 'btn', id: nid(el), s: lines.length > 1 ? lines.join(' · ') : clean(inline(el)) || txt(el), lines: lines.length > 1 ? lines : undefined, icon: iconOf(el), img: abs(img?.getAttribute('src')), cls,
        primary: el.classList.contains('primary'), danger: el.classList.contains('danger'),
        on: el.classList.contains('on') || el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true',
        disabled: !!el.disabled, label: el.getAttribute('aria-label') || el.title || '',
      };
    }
    if (/^H[1-6]$/.test(tag)) return { t: 'h', lvl: +tag[1], s: clean(inline(el)) };
    if (el.classList.contains('seg')) return { t: 'seg', kids: kids(el).filter((k) => k.t === 'btn') };
    if (el.classList.contains('field')) {
      const label = el.querySelector(':scope > label');
      const rest = kids(el).filter((k, i) => !(label && i === 0 && k.t === 'text'));
      const ctl = [...el.children].filter((c) => c !== label && visible(c)).flatMap((c) => { const n = mirror(c); return n ? [n] : []; });
      return { t: 'field', label: txt(label), kids: ctl.length ? ctl : rest };
    }
    if (tag === 'NAV') return { t: 'nav', kids: kids(el) };
    if (tag === 'FORM') return { t: 'form', id: nid(el), kids: kids(el) };
    if (tag === 'UL' || tag === 'OL') return { t: 'list', kids: kids(el) };
    if ((tag === 'P' || tag === 'SMALL' || tag === 'LABEL' || tag === 'SPAN' || tag === 'B' || tag === 'STRONG' || tag === 'EM' || tag === 'LI' || tag === 'DIV') && !hasCtl(el) && !el.querySelector('img:not(.emoji), h1, h2, h3, h4, ul, ol, .field, .seg')) {
      const s = clean(inline(el));
      if (!s) return null;
      return { t: tag === 'P' || tag === 'DIV' || tag === 'LI' ? 'p' : 'text', s, cls, b: tag === 'B' || tag === 'STRONG' };
    }
    const k = kids(el);
    if (!k.length) return null;
    if (k.length === 1 && !cls) return k[0];
    return { t: 'box', cls, kids: k, row: getComputedStyle(el).flexDirection === 'row' && getComputedStyle(el).display.includes('flex') };
  }

  // Какие панели есть и как их закрыть (кнопкой «назад» или смахиванием на телефоне)
  const PANELS = {
    auth: { sel: '#auth', title: 'Вход', close: null },
    settings: { sel: '#settings', title: 'Настройки', root: '#settings .sheet', close: () => closeSettings() },
    profile: { sel: '#profile', title: 'Профиль', close: () => closeProfile() },
    friends: { sel: '#friends', title: 'Друзья', close: () => closeFriends() },
    together: { sel: '#together', title: 'Слушать вместе', close: () => closeTogether() },
    editor: { sel: '#editor', title: 'Теги трека', close: () => closeEditor() },
    alarm: { sel: '#alarm', title: 'Будильник' },
    focus: { sel: '#focus', title: 'Фокус' },
    changelog: { sel: '#changelog', title: 'Что нового', close: () => closeChangelog() },
    admin: { sel: '#admin', title: 'Админка', close: () => closeAdmin() },
  };
  const panelState = {};
  let panelTimer = 0;

  function scanPanels() {
    for (const [key, p] of Object.entries(PANELS)) {
      const el = $(p.sel);
      const open = !!el && !el.hidden && visible(el);
      const st = panelState[key] || (panelState[key] = { open: false, json: '' });
      if (!open) {
        if (st.open) { st.open = false; st.json = ''; emit('panelClose', key); }
        continue;
      }
      const root = (p.root && $(p.root)) || el;
      const tree = kids(root);
      const json = J({ key, title: p.title, closable: key !== 'auth', kids: tree });
      if (json !== st.json || !st.open) {
        st.open = true;
        st.json = json;
        UI.emit('panel', json);
      }
    }
  }
  // Не откладываем бесконечно: плеер трогает разметку каждые 30 мс (шкалы звонка), поэтому не «после
  // затишья», а не чаще раза в 80 мс
  function panelsSoon() {
    if (panelTimer) return;
    panelTimer = setTimeout(() => { panelTimer = 0; scanPanels(); }, 80);
  }
  new MutationObserver((muts) => {
    // своя разметка (data-nid) не должна будить пересчёт
    if (muts.every((m) => m.type === 'attributes' && m.attributeName === 'data-nid')) return;
    panelsSoon();
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'disabled', 'value', 'checked', 'style'] });

  handlers.panelClose = (key) => {
    const p = PANELS[key];
    if (!p) return;
    if (p.close) p.close();
    else { const el = $(p.sel); if (el) el.hidden = true; }
    panelsSoon();
  };
  handlers.panels = () => { for (const s of Object.values(panelState)) s.json = ''; scanPanels(); };

  const find = (id) => document.querySelector(`[data-nid="${id}"]`);
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  Object.assign(handlers, {
    // клик по кнопке зеркала; pointerdown/up — для слайдеров и кнопок, что слушают не click
    tap: (id) => { const el = find(id); if (el && !el.disabled) el.click(); },
    setVal: (id, v, final) => {
      const el = find(id);
      if (!el) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        el.checked = !!v;
        fire(el, 'input');
        fire(el, 'change');
        return;
      }
      el.value = String(v);
      fire(el, 'input');
      if (final !== false) fire(el, 'change');
    },
    submit: (id) => {
      const el = find(id);
      if (!el) return;
      const form = el.tagName === 'FORM' ? el : el.form || el.closest('form');
      if (form) { form.requestSubmit(); return; }
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    },
  });

  // ---------- готовность ----------

  let ready = false;
  const boot = setInterval(() => {
    if (!state.cfg || document.readyState !== 'complete') return;
    clearInterval(boot);
    ready = true;
    pushTheme();
    pushAccount();
    pushStats();
    emit('player', playerState());
    libPush(true);
    scanPanels();
    emit('ready', { version: document.querySelector('meta[name="version"]')?.content || '' });
  }, 100);
})();
