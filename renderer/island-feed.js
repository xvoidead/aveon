'use strict';
// Окно плеера → остров поверх всех окон (src/island.js): что играет, позиция, бочка, 5 полос спектра,
// цвета акцента и голосов. Пока играет — ~15 раз в секунду, на паузе — изредка.
// Общие глобальные из app.js: state, api, audio, fx, duck, onAudio, togglePlay, next, prev, IS_MOBILE.

(() => {
  if (IS_MOBILE || !api.island) return;

  const bins = new Uint8Array(1024);
  const smooth = [0, 0, 0, 0, 0];
  let lastSent = 0;

  // 5 полос по частотам, как на иконке эквалайзера: бас → верха
  function levels() {
    if (!fx.analyser || audio.paused) return smooth.map(() => 0);
    const data = bins.subarray(0, fx.analyser.frequencyBinCount);
    fx.analyser.getByteFrequencyData(data);
    const edges = [1, 6, 18, 48, 120, 300];
    for (let b = 0; b < 5; b++) {
      let v = 0;
      for (let k = edges[b]; k < Math.min(edges[b + 1], data.length); k++) v = Math.max(v, data[k]);
      const x = Math.pow(v / 255, 1.6);
      smooth[b] = x > smooth[b] ? x : smooth[b] * 0.72 + x * 0.28;
    }
    return smooth.map((v) => +v.toFixed(2));
  }

  function snapshot() {
    const t = state.track;
    if (!t) return { hasTrack: false };
    return {
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
      bars: levels(),
    };
  }

  function push() {
    lastSent = performance.now();
    api.island.push(snapshot());
  }

  setInterval(() => {
    const busy = !audio.paused || duck.m > 0.01;
    if (busy || performance.now() - lastSent > 1500) push();
  }, 66);
  for (const ev of ['play', 'pause', 'seeked', 'loadedmetadata', 'emptied']) onAudio(ev, push);

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
    }
    setTimeout(push, 50);
  });
})();
