// Musixmatch: тексты с временем каждого слова (richsync) — для самоцензуры.
// API клиента Musixmatch для macOS. Токен он выдаёт редко (на частые запросы отвечает капчей),
// поэтому токен храним в настройках, а после капчи какое-то время не просим новый.
const config = require('../config');
const { request } = require('./http');
const { cleanTitle, firstArtist } = require('./lyrics');

const API = 'https://apic.musixmatch.com/ws/1.1/';
const APP = 'mac-ios-v2.0';
const HEADERS = { 'User-Agent': 'Musixmatch/0.19.4' };
const COOLDOWN = 10 * 60 * 1000;

const cache = new Map();
let blockedUntil = 0;

function block() {
  config.set({ mxm: { token: '' } });
  blockedUntil = Date.now() + COOLDOWN;
}

async function token() {
  const saved = config.get().mxm.token;
  if (saved) return saved;
  if (Date.now() < blockedUntil) throw new Error('Musixmatch просил капчу, попробую позже');
  const u = new URL(API + 'token.get');
  u.search = new URLSearchParams({ app_id: APP, format: 'json' }).toString();
  const res = await get(u);
  const t = res?.message?.body?.user_token;
  if (!t || /^0+$/.test(t)) {
    block();
    throw new Error('Musixmatch не выдал токен, попробую позже');
  }
  config.set({ mxm: { token: t } });
  return t;
}

// Соединение с Musixmatch иногда рвётся ещё на TLS — такие сбои повторяем
async function get(u) {
  for (let i = 0; ; i++) {
    try {
      return await request(u, { headers: HEADERS, timeout: 12000 });
    } catch (e) {
      if (i >= 2 || e.status) throw e; // e.status — сервер ответил, повтор не поможет
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
}

async function call(method, params, retry = true) {
  const u = new URL(API + method);
  u.search = new URLSearchParams({ ...params, app_id: APP, usertoken: await token(), format: 'json' }).toString();
  const res = await get(u);
  const h = res?.message?.header || {};
  if (h.status_code === 401) {
    // renew — токен устарел, берём новый один раз; captcha — ждём
    if (h.hint === 'captcha') { block(); throw new Error('Musixmatch просит капчу, попробую позже'); }
    config.set({ mxm: { token: '' } });
    if (retry) return call(method, params, false);
    throw new Error('Musixmatch не принял токен');
  }
  if (h.status_code === 404) return null;
  if (h.status_code !== 200) throw new Error(`Musixmatch ответил ${h.status_code}${h.hint ? ` (${h.hint})` : ''}`);
  return res.message.body;
}

// { kind: 'words', lines: [{ ts, te, words: [{ t, text }] }] } — время каждого слова
// { kind: 'lrc', lrc } — только время строк
// null — трека нет или текста нет
async function find(track) {
  if (cache.has(track.id)) return cache.get(track.id);
  const artist = firstArtist(track.artist);
  const params = { q_track: cleanTitle(track.title, artist), q_artist: artist };
  if (track.ref?.isrc) params.track_isrc = track.ref.isrc;
  if (track.duration) params.q_duration = String(track.duration);

  let result = null;
  const t = (await call('matcher.track.get', params))?.track;
  const sameLength = t && (!track.duration || !t.track_length || Math.abs(t.track_length - track.duration) <= 8);
  if (sameLength && t.has_richsync) {
    const body = (await call('track.richsync.get', { track_id: t.track_id }))?.richsync?.richsync_body;
    if (body) {
      result = {
        kind: 'words',
        lines: JSON.parse(body).map((l) => ({
          ts: l.ts,
          te: l.te,
          words: l.l.filter((w) => w.c.trim()).map((w) => ({ t: l.ts + w.o, text: w.c.trim() })),
        })),
      };
    }
  }
  if (!result && sameLength && t.has_subtitles) {
    const body = (await call('track.subtitle.get', { track_id: t.track_id, subtitle_format: 'lrc' }))?.subtitle?.subtitle_body;
    if (body) result = { kind: 'lrc', lrc: body };
  }
  cache.set(track.id, result);
  return result;
}

module.exports = { find };
