'use strict';
// Караоке: голос в треке приглушается (из левого канала вычитается правый — всё, что по центру,
// уходит; бас возвращается отдельно), а текст песни идёт крупно во весь экран.
// Граф — в app.js (ensureGraph: fx.kDry / fx.kWet / fx.kBass). Клавиша K.

const karaoke = { on: false };

function applyKaraoke() {
  if (!ctx || !fx.kDry) return;
  const t = ctx.currentTime;
  const on = karaoke.on;
  fx.kDry.gain.setTargetAtTime(on ? 0 : 1, t, 0.08);
  fx.kWet.gain.setTargetAtTime(on ? 0.95 : 0, t, 0.08);
  fx.kBass.gain.setTargetAtTime(on ? 0.9 : 0, t, 0.08);
}

// screen: false — только убрать голос, без экрана с текстом (горячая клавиша из другого окна)
function toggleKaraoke(force, { screen = true } = {}) {
  karaoke.on = typeof force === 'boolean' ? force : !karaoke.on;
  ensureGraph();
  applyKaraoke();
  document.documentElement.classList.toggle('karaoke-on', karaoke.on);
  if (!screen) return;
  if (karaoke.on) {
    enterFs(); // fullscreen.js: обложка и текст на весь экран
    toast('Караоке: голос убран, пой! Выйти — K или Esc');
  } else {
    toast('Караоке выключено');
  }
}

// Вышли из полноэкранного — караоке тоже заканчивается
new MutationObserver(() => {
  if (karaoke.on && $('#fs').hidden) toggleKaraoke(false);
}).observe($('#fs'), { attributes: true, attributeFilter: ['hidden'] });
