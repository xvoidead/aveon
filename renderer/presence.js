'use strict';

// ---------- статус в Discord ----------
// Окно сообщает главному процессу, что играет и с какой секунды; тот собирает Rich Presence
// (src/discord.js). На паузе статус убирается, как у Spotify.

let presenceTimer = null;
let discordStatus = { enabled: false, connected: false };

// «Слушать вместе» в статусе: (2 из 10). Код комнаты не светим — только его отпечаток
function partyId(code) {
  let h = 0;
  for (const c of `aveon:${code}`) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `aveon-${(h >>> 0).toString(36)}`;
}

function sendPresence() {
  clearTimeout(presenceTimer);
  presenceTimer = null;
  const t = state.track;
  const room = Together.room;
  api.discord.update(t ? {
    track: slimTrack(t),
    playing: !audio.paused,
    pos: audio.currentTime || 0,
    duration: isFinite(audio.duration) ? audio.duration : t.duration || 0,
    via: state.via,
    party: room && room.members.length > 1 ? { id: partyId(room.code), size: room.members.length } : null,
  } : null);
}

// Несколько событий подряд (смена трека: pause → play → durationchange) — одно обновление
function queuePresence() {
  if (!presenceTimer) presenceTimer = setTimeout(sendPresence, 400);
}

for (const ev of ['play', 'pause', 'seeked', 'durationchange', 'ended']) onAudio(ev, queuePresence);
api.together.onEvent(queuePresence);

// ---- раздел в настройках ----

async function refreshDiscordStatus() {
  try { discordStatus = await api.discord.status(); } catch {}
}

function discordSection() {
  const c = state.cfg.discord || {};
  const s = discordStatus;
  const on = c.enabled !== false;
  const stateText = !on ? 'выключен' : s.connected ? 'показывается' : 'Discord не запущен';
  return `<section class="sec" data-sec="discord">
    <h3 class="sec-title">Статус в Discord<span class="state ${on && s.connected ? 'ok' : ''}">${stateText}</span></h3>
    <p class="sec-desc">Как у Spotify: «Слушает» с названием трека, исполнителем, обложкой и полосой прогресса. Альбом — при наведении на обложку, значок в углу — откуда играет трек. На паузе статус пропадает.</p>
    <div class="field"><label>Показывать, что слушаю</label><div class="ctl"><label class="switch"><input type="checkbox" id="discord-on" ${on ? 'checked' : ''} aria-label="Показывать, что слушаю"><span></span></label></div></div>
  </section>`;
}

function bindDiscord(body) {
  const sw = $('#discord-on', body);
  if (!sw) return;
  const after = async () => {
    lastPresenceReset();
    await new Promise((r) => setTimeout(r, 700)); // дать время на рукопожатие с Discord
    await refreshDiscordStatus();
    renderSettings();
  };
  sw.onchange = async () => {
    await saveCfg({ discord: { enabled: sw.checked } });
    after();
  };
}

// После смены настроек — отправить статус заново, даже если трек тот же
function lastPresenceReset() { sendPresence(); }
