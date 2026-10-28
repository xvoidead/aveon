'use strict';
// «Дальше»: ближайшие треки очереди под управлением плеера (виден в дизайне «Авеон», aveon.css).
// Читает ту же очередь, по которой идут next/prev (app.js → state.queue, state.order, state.pos),
// поэтому перемешивание и повтор здесь те же. Нажал на трек — очередь переходит к нему.
// Перерисовывают app.js → showNow и toggleShuffle; в руме гостем очередь чужая — список только для вида.
// Общие глобальные из app.js: state, $, esc, loadTrack, Together.

const UPNEXT_MAX = 8;
const upnextEl = $('#upnext');

// Позиции в state.order, которые пойдут после текущей: недоступные пропускаем, в конце — по кругу, если повтор всего
function upnextPositions() {
  const n = state.order.length;
  const out = [];
  if (!n || state.cfg.repeat === 'one') return out;
  for (let step = 1; step < n && out.length < UPNEXT_MAX; step++) {
    let p = state.pos + step;
    if (p >= n) {
      if (state.cfg.repeat !== 'all') break;
      p %= n;
    }
    if (state.queue[state.order[p]]?.playable !== false) out.push(p);
  }
  return out;
}

function renderUpNext() {
  if (!upnextEl) return;
  const list = upnextPositions();
  upnextEl.hidden = !list.length;
  if (!list.length) { upnextEl.innerHTML = ''; return; }
  const guest = Together.guest?.();
  upnextEl.classList.toggle('guest', !!guest);
  upnextEl.innerHTML = `<h3 class="upnext-head">Дальше</h3><ol class="upnext-list">${list.map((p, i) => {
    const t = state.queue[state.order[p]];
    const pic = t.cover ? `<img src="${esc(t.cover)}" alt="" loading="lazy">` : '<i>♪</i>';
    return `<li style="--i:${i}"><button class="upnext-row" data-pos="${p}"${guest ? ' disabled' : ''} title="${esc(t.title)}${t.artist ? ` — ${esc(t.artist)}` : ''}">
      <span class="upnext-pic">${pic}</span><span class="upnext-text"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span></button></li>`;
  }).join('')}</ol>`;
}
window.renderUpNext = renderUpNext;

upnextEl?.addEventListener('click', (e) => {
  const b = e.target.closest('.upnext-row');
  if (!b || b.disabled) return;
  const p = +b.dataset.pos;
  const t = state.queue[state.order[p]];
  if (!t) return;
  state.pos = p;
  loadTrack(t);
});

renderUpNext();
