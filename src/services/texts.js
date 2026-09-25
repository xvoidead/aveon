// Текст песни из всех источников — для панели текста и для цензуры.
// Порядок: Musixmatch с временем каждого слова → LRCLIB по строкам → Musixmatch по строкам →
// LRCLIB без таймкодов. from — откуда взят текст (подпись в панели).
const mxm = require('./musixmatch');
const lrclib = require('./lyrics');

const EMPTY = { from: null, words: null, synced: '', plain: '', instrumental: false };

async function find(track) {
  let mx = null;
  try { mx = await mxm.find(track); } catch (e) { console.warn('musixmatch:', e.message); }
  if (mx?.kind === 'words') return { ...EMPTY, from: 'musixmatch', words: mx.lines };

  let lr = null;
  try {
    lr = await lrclib.find(track);
  } catch (e) {
    if (mx?.kind !== 'lrc') throw e; // без запасного текста ошибку покажет панель
  }
  if (lr?.synced) return { ...EMPTY, ...lr, from: 'lrclib' };
  if (mx?.kind === 'lrc') return { ...EMPTY, from: 'musixmatch', synced: mx.lrc };
  if (lr?.plain || lr?.instrumental) return { ...EMPTY, ...lr, from: 'lrclib' };
  return EMPTY;
}

module.exports = { find };
