'use strict';
// Умная громкость: все треки звучат одинаково громко — тихие подтягиваются, громкие приглушаются.
// Меряем среднюю мощность трека по ходу игры (fx.normAn — до регулятора fx.norm), ведём усиление
// к цели плавно. Громкость трека запоминаем: в следующий раз он сразу звучит ровно.
// Настройка: Звук → «Умная громкость». Граф — в app.js (ensureGraph).

const SV_TARGET_DB = -17;   // целевая средняя громкость (RMS, дБ полной шкалы)
const SV_MIN_DB = -10, SV_MAX_DB = 8;
const SV_KEY = 'aveon:loudness';
const sv = { id: null, pow: 0, n: 0, started: 0, gainDb: 0, known: {} };
const svBuf = new Float32Array(2048);

try { sv.known = JSON.parse(localStorage.getItem(SV_KEY) || '{}'); } catch { sv.known = {}; }
const svOn = () => state.cfg?.smartVolume !== false;

function svSave() {
  const keys = Object.keys(sv.known);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete sv.known[k];
  try { localStorage.setItem(SV_KEY, JSON.stringify(sv.known)); } catch {}
}

function svSetGain(db, tc) {
  if (!fx.norm) return;
  sv.gainDb = db;
  fx.norm.gain.setTargetAtTime(Math.pow(10, db / 20), ctx.currentTime, tc);
}

// Новый трек: знакомый — сразу нужное усиление, новый — начинаем с нуля и быстро подстраиваемся
function svTrack() {
  const t = state.track;
  if (!t || sv.id === t.id) return;
  if (sv.id && sv.n > 20) { sv.known[sv.id] = +(10 * Math.log10(sv.pow)).toFixed(1); svSave(); }
  sv.id = t.id;
  sv.pow = 0;
  sv.n = 0;
  sv.started = performance.now();
  if (!svOn()) { svSetGain(0, 0.1); return; }
  const k = sv.known[t.id];
  svSetGain(k != null ? Math.max(SV_MIN_DB, Math.min(SV_MAX_DB, SV_TARGET_DB - k)) : 0, 0.3);
}

setInterval(() => {
  if (!fx.normAn || audio.paused) return;
  svTrack();
  if (!svOn()) { if (sv.gainDb !== 0) svSetGain(0, 0.4); return; }
  fx.normAn.getFloatTimeDomainData(svBuf);
  let sum = 0;
  for (let i = 0; i < svBuf.length; i++) sum += svBuf[i] * svBuf[i];
  const p = sum / svBuf.length;
  if (p < 1e-5) return; // тишина между песнями и в паузах не в счёт (−50 дБ)
  sv.n++;
  sv.pow += (p - sv.pow) / Math.min(sv.n, 600); // средняя мощность за ~2 минуты
  const want = Math.max(SV_MIN_DB, Math.min(SV_MAX_DB, SV_TARGET_DB - 10 * Math.log10(sv.pow)));
  // в начале трека подстраиваемся быстро, потом — едва заметно
  const early = performance.now() - sv.started < 6000;
  if (Math.abs(want - sv.gainDb) > 0.3) svSetGain(want, early ? 0.8 : 3);
}, 200);
