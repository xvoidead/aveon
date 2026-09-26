'use strict';
// Раздел «Кэш» в настройках: сколько места занимают треки и тексты, лимит, очистка (src/cache.js).
// Общие глобальные из app.js: state, api, $, $$, esc, toast, saveCfg, renderSettings.

let cacheInfo = null;
const CACHE_LIMITS = [500, 1024, 2048, 5120, 10240]; // МБ

function fmtBytes(n) {
  if (!n) return '0 МБ';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / 1024 / 1024)} МБ`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1).replace('.', ',')} ГБ`;
}

const limitLabel = (mb) => (mb < 1024 ? `${mb} МБ` : `${mb / 1024} ГБ`);

async function refreshCacheInfo() {
  try { cacheInfo = await api.cache.info(); } catch {}
  return cacheInfo;
}

function cacheBadge() {
  return cacheInfo ? fmtBytes(cacheInfo.tracks.bytes + (cacheInfo.downloads?.bytes || 0) + cacheInfo.lyrics.bytes) : '';
}

function cacheSection() {
  const i = cacheInfo || { tracks: { count: 0, bytes: 0 }, lyrics: { count: 0, bytes: 0 }, downloading: 0, keep: true, limitMb: 2048 };
  const limit = i.limitMb * 1024 * 1024;
  const used = Math.min(1, i.tracks.bytes / limit);
  return `<section class="sec" data-sec="cache">
    <h3 class="sec-title">Кэш<span class="state">${fmtBytes(i.tracks.bytes + (i.downloads?.bytes || 0) + i.lyrics.bytes)}</span></h3>
    <p class="sec-desc">Треки из Яндекс Музыки, SoundCloud и Spotify сохраняются сами, пока ты их слушаешь, и дальше играют с ${IS_MOBILE ? 'телефона' : 'диска'} — сразу и без интернета. Тексты песен хранятся все и целиком. Когда треки упираются в лимит, удаляются те, что слушал давнее всего.</p>
    <div class="cache-meter" role="img" aria-label="Треки занимают ${fmtBytes(i.tracks.bytes)} из ${limitLabel(i.limitMb)}">
      <div class="cache-bar"><i style="width:${(used * 100).toFixed(1)}%"></i></div>
      <div class="cache-legend"><b>${fmtBytes(i.tracks.bytes)}</b> из ${limitLabel(i.limitMb)}${i.downloading ? `<span class="cache-dl">сохраняется ${i.downloading}</span>` : ''}</div>
    </div>
    <div class="cache-rows">
      <div class="cache-row">
        <div><b>Треки</b><small>${i.tracks.count} ${plural(i.tracks.count, 'трек', 'трека', 'треков')} · ${fmtBytes(i.tracks.bytes)}</small></div>
        <button class="btn" data-cache-clear="tracks" ${i.tracks.count ? '' : 'disabled'}>Очистить</button>
      </div>
      <div class="cache-row">
        <div><b>Скачанные</b><small>${i.downloads?.count || 0} ${plural(i.downloads?.count || 0, 'трек', 'трека', 'треков')} · ${fmtBytes(i.downloads?.bytes || 0)} · лимит их не трогает</small></div>
        <button class="btn" data-cache-clear="downloads" ${i.downloads?.count ? '' : 'disabled'}>Удалить</button>
      </div>
      <div class="cache-row">
        <div><b>Тексты песен</b><small>${i.lyrics.count} ${plural(i.lyrics.count, 'текст', 'текста', 'текстов')} · ${fmtBytes(i.lyrics.bytes)}</small></div>
        <button class="btn" data-cache-clear="lyrics" ${i.lyrics.bytes ? '' : 'disabled'}>Очистить</button>
      </div>
    </div>
    <div class="field"><label>Сохранять треки</label><div class="ctl"><label class="switch"><input type="checkbox" id="cache-keep" ${i.keep ? 'checked' : ''} aria-label="Сохранять треки"><span></span></label></div></div>
    <div class="field"><label>Место под треки</label><div class="ctl"><div class="seg" id="cache-limit">
      ${CACHE_LIMITS.map((mb) => `<button data-mb="${mb}" class="${mb === i.limitMb ? 'on' : ''}">${limitLabel(mb)}</button>`).join('')}
    </div></div></div>
  </section>`;
}

// Перерисовать только раздел «Кэш», не трогая остальные настройки
async function rerenderCache() {
  await refreshCacheInfo();
  const sec = $('#settings-body [data-sec="cache"]');
  if (!sec) return;
  sec.outerHTML = cacheSection();
  $('#settings-body [data-sec="cache"]').hidden = settingsTab !== 'cache';
  bindCache($('#settings-body'));
  renderSettingsNav();
}

function bindCache(body) {
  const sec = $('[data-sec="cache"]', body);
  if (!sec) return;
  $$('[data-cache-clear]', sec).forEach((b) => {
    b.onclick = async () => {
      const kind = b.dataset.cacheClear;
      const tracks = kind === 'tracks';
      const ok = await ask({
        title: kind === 'downloads' ? 'Удалить все скачанные?' : tracks ? 'Удалить сохранённые треки?' : 'Удалить сохранённые тексты?',
        text: 'Они сохранятся заново, когда снова их включишь.',
        ok: 'Удалить', input: false, danger: true,
      });
      if (ok === null) return;
      await api.cache.clear(b.dataset.cacheClear).catch((e) => toast(e.message, true));
      rerenderCache();
    };
  });
  $('#cache-keep', sec).onchange = async (e) => { await saveCfg({ cache: { keep: e.target.checked } }); rerenderCache(); };
  $$('#cache-limit button', sec).forEach((b) => {
    b.onclick = async () => { await saveCfg({ cache: { limitMb: +b.dataset.mb } }); rerenderCache(); };
  });
}

// Трек сохранился — если открыт раздел «Кэш», цифры обновятся сразу
api.cache.onChange(() => {
  if (!$('#settings').hidden && settingsTab === 'cache') rerenderCache();
  else refreshCacheInfo();
});
refreshCacheInfo();
