'use strict';

// ---------- эквалайзер в отдельном окне ----------
// Окно раскрывается вниз от кнопки эквалайзера и может выходить за край плеера (src/eqpop.js).
// Звук живёт в окне плеера, поэтому каждое изменение уходит туда (api.eqpop.live), а настройки
// сохраняются как обычно (cfg:set) и синхронизируются через аккаунт.
// «Поделиться» и «Вставить код» выполняет окно плеера — там есть диалоги и уведомления.

const api = window.tishe;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pop = { eq: null, anim: 0, liveRaf: 0, glide: false, naming: null };
const EQ_ANIM_MS = 360;
const mine = () => pop.eq.custom || [];
const sameGains = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
const values = () => (pop.eq.enabled ? { gains: [...pop.eq.gains], preamp: pop.eq.preamp } : { gains: EQ_FREQS.map(() => 0), preamp: 0 });

// ---- связь с окном плеера ----

// Пока тянешь ползунок — не чаще раза за кадр; glide — звук перетекает плавно (смена пресета)
function live(glide = false) {
  pop.glide = pop.glide || glide;
  if (pop.liveRaf) return;
  pop.liveRaf = requestAnimationFrame(() => {
    pop.liveRaf = 0;
    api.eqpop.live({ ...pop.eq, _glide: pop.glide });
    pop.glide = false;
  });
}

async function save() {
  const { enabled, preset, gains, preamp, custom = [] } = pop.eq;
  try { await api.config.set({ eq: { enabled, preset, gains: [...gains], preamp, custom } }); } catch {}
  live();
}

const close = () => api.eqpop.close();

// ---- отрисовка ----

function render() {
  const e = pop.eq;
  $('#eq').classList.toggle('off', !e.enabled);
  $('#eq-enabled').checked = e.enabled;
  $('#eq-presets').innerHTML = [...EQ_PRESETS.map(([id, label]) => [id, label]), ...(e.preset === 'custom' ? [['custom', 'Свой']] : [])]
    .map(([id, label]) => `<button data-preset="${id}" class="${e.preset === id ? 'on' : ''}">${label}</button>`).join('');
  const own = mine().find((p) => p.id === e.preset);
  $('#eq-mine').innerHTML = `<span class="eq-mine-label">мои</span>${mine().map((p) => `
    <span class="chip${e.preset === p.id ? ' active' : ''}" data-mine="${esc(p.id)}" role="button" tabindex="0" title="${esc(p.name)}">
      <span>${esc(p.name)}</span>
      <button class="chip-more" data-mine-more="${esc(p.id)}" aria-label="Действия с пресетом" aria-haspopup="menu"><svg><use href="#i-more"/></svg></button>
    </span>`).join('')}
    ${own ? '' : `<button class="chip plain new" id="eq-save-as"><svg><use href="#i-plus"/></svg><span>${mine().length ? 'Сохранить текущий' : 'Сохранить как свой пресет'}</span></button>`}
    <button class="chip plain new" id="eq-paste" title="Пресет, которым поделился друг"><svg><use href="#i-code"/></svg><span>Вставить код</span></button>`;
  $('#eq-bands').innerHTML = EQ_FREQS.map((f, i) => `
    <div class="eq-band">
      <span class="db ${e.gains[i] ? 'on' : ''}" data-db="${i}">${fmtDb(e.gains[i])}</span>
      <input type="range" data-band="${i}" min="${-EQ_MAX}" max="${EQ_MAX}" step="0.5" value="${e.gains[i]}" aria-label="${fmtHz(f)} Гц" title="Двойной клик — в ноль">
      <span class="hz">${fmtHz(f)}</span>
    </div>`).join('');
  $('#eq-preamp').value = e.preamp;
  $('#eq-preamp-val').textContent = `${fmtDb(e.preamp)} дБ`;
  draw();
}

function draw(gains) {
  drawEqCurveOn($('#eq-curve'), $('#eq-panel'), Array.isArray(gains) ? gains : values().gains);
}

// Плавная смена: ползунки, подписи, предусилитель и кривая едут к новым значениям
async function transition(change) {
  const from = values();
  change();
  live(true);
  save();
  render();
  cancelAnimationFrame(pop.anim);
  const to = values();
  const inputs = $$('#eq-bands input');
  const pre = $('#eq-preamp');
  for (const el of [...inputs, pre]) el.step = 'any';
  const t0 = performance.now();
  const frame = (now) => {
    const k = 1 - Math.pow(1 - Math.min(1, (now - t0) / EQ_ANIM_MS), 3);
    const gains = to.gains.map((g, i) => from.gains[i] + (g - from.gains[i]) * k);
    gains.forEach((g, i) => {
      inputs[i].value = g;
      const shown = Math.round(g * 2) / 2;
      const db = $(`[data-db="${i}"]`);
      db.textContent = fmtDb(shown);
      db.classList.toggle('on', !!shown);
    });
    const p = from.preamp + (to.preamp - from.preamp) * k;
    pre.value = p;
    $('#eq-preamp-val').textContent = `${fmtDb(Math.round(p * 2) / 2)} дБ`;
    draw(gains);
    if (k < 1) { pop.anim = requestAnimationFrame(frame); return; }
    for (const el of [...inputs, pre]) el.step = '0.5';
  };
  pop.anim = requestAnimationFrame(frame);
}

// ---- ползунки ----

$('#eq-bands').addEventListener('input', (e) => {
  const i = e.target.dataset?.band;
  if (i == null) return;
  pop.eq.gains[+i] = +e.target.value;
  pop.eq.preset = 'custom';
  const db = $(`[data-db="${i}"]`);
  db.textContent = fmtDb(pop.eq.gains[+i]);
  db.classList.toggle('on', !!pop.eq.gains[+i]);
  draw();
  live();
});
$('#eq-bands').addEventListener('change', () => {
  const back = mine().find((p) => sameGains(p.gains, pop.eq.gains) && p.preamp === pop.eq.preamp);
  if (back) pop.eq.preset = back.id;
  save();
  render();
});
$('#eq-bands').addEventListener('dblclick', (e) => {
  const i = e.target.dataset?.band;
  if (i == null) return;
  pop.eq.gains[+i] = 0;
  pop.eq.preset = 'custom';
  save();
  render();
});
$('#eq-preamp').addEventListener('input', (e) => {
  pop.eq.preamp = +e.target.value;
  $('#eq-preamp-val').textContent = `${fmtDb(pop.eq.preamp)} дБ`;
  live();
});
$('#eq-preamp').addEventListener('change', save);

$('#eq-presets').addEventListener('click', (e) => {
  const id = e.target.closest('button')?.dataset.preset;
  const p = EQ_PRESETS.find(([pid]) => pid === id);
  if (!p) return;
  const boost = Math.max(0, ...p[2]); // запас по громкости, как в eq.js
  transition(() => Object.assign(pop.eq, { preset: id, gains: [...p[2]], preamp: -Math.round(boost) / 2, enabled: true }));
});
$('#eq-enabled').addEventListener('change', (e) => transition(() => { pop.eq.enabled = e.target.checked; }));
$('#eq-reset').onclick = () => transition(() => Object.assign(pop.eq, { preset: 'flat', gains: EQ_FREQS.map(() => 0), preamp: 0 }));
$('#eq-close').onclick = close;

// ---- свои пресеты ----

function useMine(id) {
  const p = mine().find((x) => x.id === id);
  if (p) transition(() => Object.assign(pop.eq, { preset: p.id, gains: [...p.gains], preamp: p.preamp, enabled: true }));
}

// Имя пресета спрашиваем прямо в попапе: строка ввода вместо ряда пресетов
function askName(value, onOk) {
  pop.naming = onOk;
  $('#eq-name').hidden = false;
  $('#eq-mine').hidden = true;
  const input = $('#eq-name-input');
  input.value = value;
  input.focus();
  input.select();
}
function stopNaming() {
  pop.naming = null;
  $('#eq-name').hidden = true;
  $('#eq-mine').hidden = false;
}
$('#eq-name').onsubmit = (e) => {
  e.preventDefault();
  const name = $('#eq-name-input').value.trim().slice(0, 40);
  if (!name) { $('#eq-name-input').focus(); return; }
  const fn = pop.naming;
  stopNaming();
  fn?.(name);
};
$('#eq-name-cancel').onclick = stopNaming;

function saveAs(name) {
  const list = [...mine()];
  const same = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
  const p = { id: same?.id || `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, gains: [...pop.eq.gains], preamp: pop.eq.preamp };
  if (same) list[list.indexOf(same)] = p; else list.push(p);
  Object.assign(pop.eq, { custom: list, preset: p.id });
  save();
  render();
}

function presetMenu(id, anchor) {
  const p = mine().find((x) => x.id === id);
  if (!p) return;
  const changed = !(sameGains(p.gains, pop.eq.gains) && p.preamp === pop.eq.preamp);
  showMenu([
    { label: 'Включить', icon: 'i-eq', onClick: () => useMine(id) },
    ...(changed ? [{ label: 'Записать сюда текущие полосы', icon: 'i-refresh', onClick: () => {
      pop.eq.custom = mine().map((x) => (x.id === id ? { ...x, gains: [...pop.eq.gains], preamp: pop.eq.preamp } : x));
      pop.eq.preset = id;
      save(); render();
    } }] : []),
    { label: 'Переименовать', icon: 'i-pencil', onClick: () => askName(p.name, (name) => {
      pop.eq.custom = mine().map((x) => (x.id === id ? { ...x, name } : x));
      save(); render();
    }) },
    { label: 'Поделиться', icon: 'i-share', onClick: () => api.eqpop.action({ type: 'share', preset: p }) },
    { sep: true },
    { label: 'Удалить', icon: 'i-trash', danger: true, onClick: () => {
      pop.eq.custom = mine().filter((x) => x.id !== id);
      if (pop.eq.preset === id) pop.eq.preset = 'custom';
      save(); render();
    } },
  ], anchor);
}

$('#eq-mine').addEventListener('click', (e) => {
  if (e.target.closest('#eq-save-as')) { askName('', saveAs); return; }
  if (e.target.closest('#eq-paste')) { api.eqpop.action({ type: 'paste' }); return; }
  const more = e.target.closest('[data-mine-more]');
  if (more) {
    e.stopPropagation();
    if (!$('#menu').hidden) { closeMenu(); return; }
    presetMenu(more.dataset.mineMore, more);
    return;
  }
  const chip = e.target.closest('[data-mine]');
  if (chip) useMine(chip.dataset.mine);
});
$('#eq-mine').addEventListener('contextmenu', (e) => {
  const chip = e.target.closest('[data-mine]');
  if (!chip) return;
  e.preventDefault();
  presetMenu(chip.dataset.mine, chip.querySelector('.chip-more'));
});

// ---- меню внутри попапа ----

function showMenu(items, anchor) {
  const menu = $('#menu');
  menu.innerHTML = '';
  for (const it of items) {
    if (it.sep) { menu.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); continue; }
    const b = document.createElement('button');
    b.className = `menu-item${it.danger ? ' danger' : ''}`;
    b.innerHTML = `<svg><use href="#${it.icon}"/></svg><span>${esc(it.label)}</span>`;
    b.onclick = () => { closeMenu(); it.onClick(); };
    menu.append(b);
  }
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${r.bottom + 4 + menu.offsetHeight > innerHeight - 8 ? r.top - menu.offsetHeight - 4 : r.bottom + 4}px`;
}
function closeMenu() { $('#menu').hidden = true; }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#menu, [data-mine-more]')) closeMenu(); });

// ---- открытие и клавиши ----

async function load() {
  const cfg = await api.config.get();
  pop.eq = { ...cfg.eq, gains: [...cfg.eq.gains], custom: [...(cfg.eq.custom || [])] };
  render();
  requestAnimationFrame(() => draw()); // кривой нужны размеры ползунков после раскладки
}

// Палитру ставим сразу: плавный переход цветов из styles.css (1,2 с) тут не нужен —
// иначе кривая успевает нарисоваться прежним цветом
document.documentElement.style.transition = 'none';

api.eqpop.onOpen(async ({ theme, up } = {}) => {
  // палитра из обложки — как у окна плеера
  for (const [k, v] of Object.entries(theme || {})) document.documentElement.style.setProperty(k, v);
  stopNaming();
  closeMenu();
  await load();
  // выезжает из-под кнопки: вниз, а если внизу не хватило экрана — вверх
  const sheet = $('#eq');
  sheet.classList.toggle('up', !!up);
  sheet.classList.remove('appear');
  void sheet.offsetWidth;
  sheet.classList.add('appear');
});
// эквалайзер поменяли не здесь (синхронизация, код от друга)
api.eqpop.onRefresh(() => { if (!pop.naming) load(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#menu').hidden) { closeMenu(); return; }
    if (pop.naming) { stopNaming(); return; }
    close();
    return;
  }
  if (e.target.matches('input:not([type="range"]), textarea') || e.ctrlKey || e.altKey) return;
  if (e.code === 'KeyE') close();
});
window.addEventListener('resize', () => { if (pop.eq) draw(); });
