'use strict';
// Свои дизайны (настройки → «Оформление» → «Мои дизайны»): копия, код, удаление, а ниже — конструктор.
// Части плеера и их свойства — в design-core.js; применяет дизайн look.js → applyLook.
// Общие глобальные: из app.js — $, $$, esc, toast, ask, api, showMenu, openSettings, closeSettings;
// из look.js — SKINS, LOOK_DEFAULTS, lookCfg, saveLook, rerenderLook, applyLook, activeDesign, baseSkinId, designDraft.

// ---------- мои дизайны ----------

function uniqueName(name, designs) {
  let n = name, i = 2;
  while (designs.some((d) => d.name === n)) n = `${name} ${i++}`;
  return n;
}

const findDesign = (id) => (lookCfg().designs || []).find((d) => d.id === id);

// Добавить копией (новый id, имя без повторов) и сразу включить
async function addDesign(raw) {
  const designs = lookCfg().designs || [];
  if (designs.length >= DesignCore.MAX_DESIGNS) {
    toast(`Уже ${DesignCore.MAX_DESIGNS} дизайнов — удали какой-нибудь`, 'err');
    return false;
  }
  const d = { ...DesignCore.cleanDesign(raw), id: DesignCore.newDesignId() };
  d.name = uniqueName(d.name, designs);
  await saveLook({ designs: [...designs, d], skin: `d:${d.id}` });
  rerenderLook();
  return true;
}

async function duplicateDesign(id) {
  const d = findDesign(id);
  if (d) await addDesign({ ...d, name: `${d.name} — копия` });
}

async function copyDesignCode(id) {
  const d = findDesign(id);
  if (!d) return;
  try { await api.copy(DesignCore.designCode(d)); toast('Код дизайна скопирован'); } catch (e) { toast(e.message, 'err'); }
}

async function importDesign(code) {
  const d = DesignCore.readDesignCode(code);
  if (!d) { toast('Это не код дизайна', 'err'); return; }
  if (await addDesign(d)) toast('Дизайн добавлен');
}

async function deleteDesign(id) {
  const d = findDesign(id);
  if (!d) return;
  const ok = await ask({ title: `Удалить «${d.name}»?`, text: 'Вернуть его можно будет только кодом, если он где-то сохранён.', ok: 'Удалить', input: false, danger: true });
  if (ok === null) return;
  const l = lookCfg();
  const patch = { designs: (l.designs || []).filter((x) => x.id !== id) };
  if (l.skin === `d:${id}`) patch.skin = SKINS[d.base] ? d.base : LOOK_DEFAULTS.skin; // был выбран — остаётся его основа
  await saveLook(patch);
  rerenderLook();
}

function designMenu(id, anchor) {
  showMenu([
    { label: 'Изменить', icon: 'i-pencil', onClick: () => openDesigner(id) },
    { label: 'Копия', icon: 'i-copy', onClick: () => duplicateDesign(id) },
    { label: 'Скопировать код', icon: 'i-share', onClick: () => copyDesignCode(id) },
    { sep: true },
    { label: 'Удалить', icon: 'i-trash', danger: true, onClick: () => deleteDesign(id) },
  ], { anchor });
}

// ---------- конструктор ----------
// Правим черновик dz.draft; look.js → applyLook показывает его вместо сохранённого (designDraft), пока панель открыта.
// Ключи полей: top:<поле>, pal:<цвет>, font:display|text, part:<часть>:<свойство>[.<подполе>]

let dz = null; // { draft, orig, part, tab, picking }
const dzEl = document.createElement('aside');
dzEl.className = 'dz';
dzEl.hidden = true;
dzEl.setAttribute('role', 'dialog');
dzEl.setAttribute('aria-label', 'Конструктор дизайна');
document.body.append(dzEl);

const hexCtx = document.createElement('canvas').getContext('2d');
// Цвет переменной прямо сейчас — в #rrggbb для <input type="color">, пока свой цвет не задан
function currentHex(cssVar) {
  hexCtx.fillStyle = '#000000';
  hexCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || '#000000';
  return /^#[0-9a-f]{6}$/i.test(hexCtx.fillStyle) ? hexCtx.fillStyle : '#000000';
}
const tokenVar = (t) => DesignCore.TOKENS.find(([id]) => id === t)?.[2];
const dzPart = (id) => DesignCore.PARTS.find((p) => p.id === id);
// Видна ли часть в плеере сейчас (в этой основе её может не быть совсем)
function partVisible(part) {
  const el = document.querySelector(part.sel.replace(/:hover/g, ''));
  return !!el && el.getClientRects().length > 0;
}

function openDesigner(id) {
  if (dz) return;
  const l = lookCfg();
  const saved = id ? (l.designs || []).find((d) => d.id === id) : null;
  let draft;
  if (saved) draft = DesignCore.cleanDesign(saved);
  else {
    // новый — из того, что на экране: копия своего дизайна или чистый лист на текущей основе
    const cur = activeDesign(l);
    const base = baseSkinId(l);
    draft = cur
      ? { ...DesignCore.cleanDesign(cur), id: DesignCore.newDesignId(), name: `${cur.name} — копия` }
      : DesignCore.cleanDesign({ base, name: uniqueName('Мой дизайн', l.designs || []), accentFromCover: !SKINS[base].accent });
  }
  dz = { draft, orig: JSON.stringify(draft), part: null, tab: 'common', picking: false };
  closeSettings();
  dzEl.hidden = false;
  document.documentElement.classList.add('dz-open');
  renderDz(false);
  setPicking(true); // сразу можно нажать на часть плеера или потащить её
  previewDz();
  $('#dz-name', dzEl).focus();
}

// Превью не чаще раза в кадр: ползунки шлют input на каждый пиксель, а applyLook обходит все CSS-правила
let dzFrame = 0;
function previewDz() {
  if (dzFrame) return;
  dzFrame = requestAnimationFrame(() => {
    dzFrame = 0;
    if (!dz) return;
    designDraft = DesignCore.cleanDesign(dz.draft);
    applyLook();
  });
}

function endDz() {
  setPicking(false);
  pop = null;
  popEl.hidden = true;
  cancelAnimationFrame(dzFrame);
  dzFrame = 0;
  dz = null;
  designDraft = null;
  dzEl.hidden = true;
  document.documentElement.classList.remove('dz-open');
  applyLook();
  openSettings('skin');
}

async function cancelDz() {
  if (!dz) return;
  if (JSON.stringify(dz.draft) !== dz.orig) {
    const ok = await ask({ title: 'Выйти без сохранения?', text: 'Изменения в этом дизайне пропадут.', ok: 'Выйти', input: false, danger: true });
    if (ok === null) return;
  }
  endDz();
}

async function saveDz() {
  const d = DesignCore.cleanDesign(dz.draft);
  const designs = lookCfg().designs || [];
  const others = designs.filter((x) => x.id !== d.id);
  const exists = others.length < designs.length; // дизайн могли удалить на другом устройстве, пока его правили
  if (!exists && designs.length >= DesignCore.MAX_DESIGNS) {
    toast(`Уже ${DesignCore.MAX_DESIGNS} дизайнов — удали какой-нибудь`, 'err');
    return;
  }
  d.name = uniqueName(d.name, others);
  // черновик ещё на экране — сохранение подменяет его тем же дизайном без мигания
  await saveLook({ designs: exists ? designs.map((x) => (x.id === d.id ? d : x)) : [...designs, d], skin: `d:${d.id}` });
  endDz();
  toast('Дизайн сохранён');
}

const DZ_OBJ = { fill: () => ({ kind: 'solid', a: 'accent', b: 'voice', angle: 135 }), border: () => ({ w: 2, c: 'accent' }) };

// Записать значение по ключу поля; null — «как в основе» (значение убирается)
function dzSet(key, v) {
  const d = dz.draft;
  const [kind, a, b] = key.split(':');
  if (kind === 'top') d[a] = v;
  else if (kind === 'pal') { if (v == null) delete d.palette[a]; else d.palette[a] = v; }
  else if (kind === 'font') d.fonts[a] = v ?? '';
  else if (kind === 'part') {
    const [prop, sub] = b.split('.');
    const vals = d.parts[a] || (d.parts[a] = {});
    if (sub) vals[prop] = { ...(vals[prop] || DZ_OBJ[prop]()), [sub]: v };
    else if (v == null) delete vals[prop];
    else vals[prop] = v;
    if (!Object.keys(vals).length) delete d.parts[a];
  }
  previewDz();
}

// ---------- разметка панели ----------

const dzField = (label, ctl) => `<div class="dz-field"><label>${esc(label)}</label><div class="dz-ctl">${ctl}</div></div>`;
const dzClear = (key, on) => (on ? `<button class="icon-btn small dz-clear" data-dz-clear="${key}" title="Как в основе" aria-label="Как в основе"><svg><use href="#i-close"/></svg></button>` : '');
const dzSeg = (key, opts, cur) => `<div class="seg dz-seg">${opts.map(([v, label]) => `<button data-dz-set="${key}" data-v="${esc(v)}" class="${cur === v ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
function dzRange(key, def, v) {
  return `<input type="range" data-dz-range="${key}" data-unit="${def.unit}" min="${def.min}" max="${def.max}" step="${def.step}" value="${v ?? def.def}" aria-label="${esc(def.label)}">
    <span class="val" data-dz-val="${key}">${v == null ? '—' : `${v}${def.unit}`}</span>${dzClear(key, v != null)}`;
}
// Цвет — кнопка-образец, сам выбор во всплывающей пипетке (openCp). clear — «×» рядом; tokens — цвета темы в пипетке
function dzColor(key, v, fallbackVar, clear = true, tokens = true) {
  const css = typeof v === 'string' && v.startsWith('#') ? v : currentHex(tokenVar(v) || fallbackVar);
  const name = v == null ? 'Как в основе' : v.startsWith('#') ? v : DesignCore.TOKENS.find(([t]) => t === v)[1];
  return `<button class="cp-btn${v == null ? ' unset' : ''}" data-dz-cp="${key}" data-fallback="${fallbackVar}" data-tokens="${tokens ? 1 : 0}" data-reset="${clear ? 1 : 0}" style="--c: ${css}" aria-label="Цвет: ${esc(name)}"><i></i><span>${esc(name)}</span></button>${clear ? dzClear(key, v != null) : ''}`;
}
// Шрифт — кнопка с названием этим же шрифтом, список — во всплывашке (openFp)
function dzFont(key, v, emptyLabel) {
  const f = DesignCore.FONTS[v];
  if (f) ensureFont(v);
  return `<button class="fp-btn" data-dz-fp="${key}" data-empty="${esc(emptyLabel)}"${f ? ` style="font-family: ${esc(f.css)}"` : ''}>${esc(f ? f.name : emptyLabel)}<svg><use href="#i-chevron-r"/></svg></button>`;
}

function commonBody(d) {
  const fontSel = (k) => dzFont(`font:${k}`, d.fonts[k], 'Как в основе');
  return `<section class="dz-sec"><h4>Основа</h4>
      <p class="dz-hint">Раскладка и стиль, на которых строится дизайн.</p>
      ${dzSeg('top:base', DesignCore.BASES.map((b) => [b, SKINS[b].name]), d.base)}</section>
    <section class="dz-sec"><h4>Палитра</h4>
      <p class="dz-hint">Не заданный цвет берётся из основы и обложки.</p>
      <div class="dz-colors">${DesignCore.PALETTE.map(([k, label]) => `<div class="dz-pal${d.palette[k] ? ' set' : ''}">
        <button class="cp-btn cp-dot${d.palette[k] ? '' : ' unset'}" data-dz-cp="pal:${k}" data-fallback="--${k}" data-tokens="0" data-reset="1" style="--c: ${d.palette[k] || currentHex(`--${k}`)}" aria-label="${label}"><i></i></button><span>${label}</span>${dzClear(`pal:${k}`, !!d.palette[k])}</div>`).join('')}</div>
      ${dzField('Акцент из обложки', `<label class="switch"><input type="checkbox" data-dz-bool="top:accentFromCover" ${d.accentFromCover ? 'checked' : ''} aria-label="Акцент из обложки"><span></span></label>`)}
    </section>
    <section class="dz-sec"><h4>Шрифты</h4>${dzField('Заголовки', fontSel('display'))}${dzField('Текст', fontSel('text'))}</section>
    <section class="dz-sec"><h4>Скругления</h4>${dzField('Все углы', `<input type="range" data-dz-range="top:radius" data-unit="%" min="0" max="250" step="10" value="${d.radius}" aria-label="Скругления"><span class="val" data-dz-val="top:radius">${d.radius}%</span>`)}</section>`;
}

function dzNode(d, p) {
  const vals = d.parts[p.id];
  const hidden = !!vals?.hidden;
  const seen = hidden || partVisible(p);
  const eye = p.props.includes('hidden')
    ? `<button class="icon-btn small" data-dz-eye="${p.id}" aria-pressed="${!hidden}" title="${hidden ? 'Показать' : 'Скрыть'}" aria-label="${hidden ? 'Показать' : 'Скрыть'} «${esc(p.name)}»"><svg><use href="#i-${hidden ? 'eye-off' : 'eye'}"/></svg></button>` : '';
  return `<li class="dz-node${p.parent ? ' child' : ''}${hidden ? ' off' : ''}${seen ? '' : ' missing'}">
    <button class="dz-node-name" data-dz-part="${p.id}"${seen ? '' : ' title="Сейчас не видно в плеере"'}>${esc(p.name)}${vals ? '<i class="dz-dot"></i>' : ''}</button>${eye}</li>`;
}

function treeBody(d) {
  return `<p class="dz-hint dz-tip">На плеере: нажми на часть — откроются её настройки, зажми и тяни — сдвинешь куда угодно, Shift + колесо — размер.</p>${DesignCore.GROUPS.map((g) => {
    const tops = g.sel ? DesignCore.orderedBlocks(d, g.id) : DesignCore.PARTS.filter((p) => p.group === g.id && !p.parent);
    const items = tops.map((p) => dzNode(d, p)
      + DesignCore.PARTS.filter((c) => c.parent === p.id).map((c) => dzNode(d, c)).join('')).join('');
    return `<section class="dz-sec"><h4>${g.name}</h4><ol class="dz-tree">${items}</ol></section>`;
  }).join('')}`;
}

function propRow(part, prop, v) {
  const def = DesignCore.PROPS[prop];
  const key = `part:${part.id}:${prop}`;
  const label = part.labels?.[prop] || def.label;
  switch (def.type) {
    case 'color': return dzField(label, dzColor(key, v, '--text'));
    case 'range': return dzField(label, dzRange(key, def, v));
    case 'bool': return dzField(label, `<label class="switch"><input type="checkbox" data-dz-bool="${key}" ${v ? 'checked' : ''} aria-label="${esc(label)}"><span></span></label>`);
    case 'enum':
      if (prop === 'font') return dzField(label, dzFont(key, v, 'Как везде'));
      return dzField(label, `${dzSeg(key, def.options, v)}${dzClear(key, v != null)}`);
    case 'fill': {
      let out = dzField(label, `${dzSeg(`${key}.kind`, [['none', 'Нет'], ['solid', 'Цвет'], ['gradient', 'Градиент']], v?.kind)}${dzClear(key, !!v)}`);
      if (v && v.kind !== 'none') out += dzField(v.kind === 'gradient' ? 'Цвет 1' : 'Цвет', dzColor(`${key}.a`, v.a, '--amber', false));
      if (v?.kind === 'gradient') {
        out += dzField('Цвет 2', dzColor(`${key}.b`, v.b, '--voice', false));
        out += dzField('Угол', `<input type="range" data-dz-range="${key}.angle" data-unit="°" min="0" max="360" step="15" value="${v.angle}" aria-label="Угол"><span class="val" data-dz-val="${key}.angle">${v.angle}°</span>`);
      }
      return out;
    }
    case 'border':
      return dzField(label, `<input type="range" data-dz-range="${key}.w" data-unit=" px" min="0" max="4" step="1" value="${v?.w ?? 0}" aria-label="Толщина рамки"><span class="val" data-dz-val="${key}.w">${v ? `${v.w} px` : '—'}</span>${dzClear(key, !!v)}`)
        + (v ? dzField('Цвет рамки', dzColor(`${key}.c`, v.c, '--amber', false)) : '');
    case 'move':
      return dzField(label, `<span class="dz-move">${v ? `${v.x < 0 ? '←' : '→'} ${Math.abs(v.x)} · ${v.y < 0 ? '↑' : '↓'} ${Math.abs(v.y)} px` : 'на месте — тяни часть на плеере'}</span>${dzClear(key, !!v)}`);
    default: return '';
  }
}

function partBody(d, id) {
  const part = dzPart(id);
  const vals = d.parts[id] || {};
  // плотность фона имеет смысл, только когда фон задан
  const rows = part.props.filter((p) => p !== 'opacity' || (vals.fill && vals.fill.kind !== 'none')).map((p) => propRow(part, p, vals[p]));
  return `<button class="btn dz-back" id="dz-back"><svg><use href="#i-chevron-l"/></svg>Все части</button>
    <h4 class="dz-part-title">${esc(part.name)}</h4>
    ${vals.hidden || partVisible(part) ? '' : `<p class="dz-hint">Сейчас этой части не видно: в основе «${SKINS[d.base].name}» её нет или она спрятана.</p>`}
    ${rows.length ? rows.join('') : '<p class="dz-hint">У блока настраиваются части внутри, а сам блок можно двигать стрелками в списке.</p>'}
    ${Object.keys(vals).length ? `<button class="btn danger dz-reset" data-dz-reset="${id}">Сбросить часть</button>` : ''}`;
}

function renderDz(keepScroll = true) {
  if (!dz) return;
  const top = keepScroll ? $('.dz-body', dzEl)?.scrollTop || 0 : 0;
  const d = dz.draft;
  dzEl.innerHTML = `<div class="dz-head">
      <input class="input dz-name" id="dz-name" maxlength="40" spellcheck="false" value="${esc(d.name)}" aria-label="Название дизайна">
      <button class="icon-btn${dz.picking ? ' on' : ''}" id="dz-pick" aria-pressed="${dz.picking}" title="Выбирать и двигать части на плеере" aria-label="Выбирать и двигать части на плеере"><svg><use href="#i-focus"/></svg></button>
      <button class="icon-btn" id="dz-close" title="Закрыть" aria-label="Закрыть"><svg><use href="#i-close"/></svg></button>
    </div>
    <div class="seg dz-tabs">${[['common', 'Общее'], ['parts', 'Части']].map(([id, name]) => `<button data-dz-tab="${id}" class="${dz.tab === id ? 'on' : ''}">${name}</button>`).join('')}</div>
    <div class="dz-body">${dz.tab === 'common' ? commonBody(d) : dz.part ? partBody(d, dz.part) : treeBody(d)}</div>
    <div class="dz-foot"><button class="btn" id="dz-cancel">Отмена</button><button class="btn primary" id="dz-save">Сохранить</button></div>`;
  $('.dz-body', dzEl).scrollTop = top;
  if (pop) pop.anchor = $(`[data-dz-${pop.kind}="${pop.key}"]`, dzEl) || pop.anchor; // всплывашка открыта — держится за новую кнопку
}

// ---------- события панели ----------

dzEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !dz) return;
  const ds = b.dataset;
  if (b.id === 'dz-close' || b.id === 'dz-cancel') { cancelDz(); return; }
  if (b.id === 'dz-save') { saveDz(); return; }
  if (b.id === 'dz-pick') { setPicking(!dz.picking); return; }
  if (b.id === 'dz-back') { dz.part = null; renderDz(false); return; }
  if (ds.dzTab) { dz.tab = ds.dzTab; dz.part = null; renderDz(false); return; }
  if (ds.dzPart) { dz.part = ds.dzPart; renderDz(false); return; }
  if (ds.dzCp) { openCp(b); return; }
  if (ds.dzFp) { openFp(b); return; }
  if (ds.dzSet) dzSet(ds.dzSet, ds.v);
  else if (ds.dzClear) dzSet(ds.dzClear, null);
  else if (ds.dzEye) dzSet(`part:${ds.dzEye}:hidden`, dz.draft.parts[ds.dzEye]?.hidden ? null : true);
  else if (ds.dzReset) { delete dz.draft.parts[ds.dzReset]; previewDz(); }
  else return;
  renderDz();
});

dzEl.addEventListener('input', (e) => {
  const t = e.target;
  if (!dz) return;
  if (t.id === 'dz-name') { dz.draft.name = t.value; return; }
  if (t.dataset.dzRange) {
    const key = t.dataset.dzRange;
    dzSet(key, +t.value);
    const val = $(`[data-dz-val="${key}"]`, dzEl);
    if (val) val.textContent = `${t.value}${t.dataset.unit || ''}`;
  }
});

// По отпусканию ползунка — перерисовать: появились «×» и зависимые поля
dzEl.addEventListener('change', (e) => {
  const t = e.target;
  if (!dz) return;
  if (t.dataset.dzBool) dzSet(t.dataset.dzBool, t.dataset.dzBool.startsWith('part:') ? (t.checked || null) : t.checked);
  else if (t.dataset.dzSelect) dzSet(t.dataset.dzSelect, t.value || null);
  else if (!t.dataset.dzRange) return;
  renderDz();
});

// Esc: выйти из выбора кликом → из свойств части → из редактора. Открытый диалог закрывается сам (app.js → ask)
document.addEventListener('keydown', (e) => {
  if (!dz || e.key !== 'Escape' || !$('#dialog').hidden) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (pop) closePop();
  else if (dz.picking) setPicking(false);
  else if (dz.part) { dz.part = null; renderDz(false); }
  else cancelDz();
}, true);

// ---------- выбор части кликом по плееру ----------
// Рамка идёт за курсором по самой вложенной части из каталога; клик перехватываем на захвате — плеер его не видит

const dzHi = document.createElement('div');
dzHi.className = 'dz-hi';
dzHi.hidden = true;
dzHi.innerHTML = '<span></span>';
document.body.append(dzHi);
const PICKABLE = DesignCore.PARTS.filter((p) => p.pick !== false);

function setPicking(on) {
  if (!dz) return;
  dz.picking = on;
  document.documentElement.classList.toggle('dz-picking', on);
  dzHi.hidden = true;
  const b = $('#dz-pick', dzEl);
  if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
}

function partAt(target) {
  for (let n = target instanceof Element ? target : null; n && n !== document.body; n = n.parentElement) {
    if (n === dzEl || n === popEl) return null;
    const part = PICKABLE.find((p) => n.matches(p.sel));
    if (part) return { part, el: n };
  }
  return null;
}

document.addEventListener('pointermove', (e) => {
  if (!dz?.picking || drag?.moved) return;
  const hit = partAt(e.target);
  if (!hit) { dzHi.hidden = true; return; }
  // координаты экранные, а стиль — внутри zoom на <html> (look.js → размер интерфейса), как в showMenu (app.js)
  const r = hit.el.getBoundingClientRect(), z = parseFloat(document.documentElement.style.zoom) || 1;
  Object.assign(dzHi.style, { left: `${r.left / z}px`, top: `${r.top / z}px`, width: `${r.width / z}px`, height: `${r.height / z}px` });
  dzHi.classList.toggle('low', r.top / z < 34);
  dzHi.firstChild.textContent = hit.part.name;
  dzHi.hidden = false;
}, true);

const dzSwallow = (e) => { if (dz?.picking && !inDz(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } };
for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) document.addEventListener(type, dzSwallow, true);
document.addEventListener('click', (e) => {
  if (!dz?.picking || inDz(e.target)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const hit = partAt(e.target);
  if (!hit) return;
  dz.tab = 'parts';
  dz.part = hit.part.id;
  renderDz(false);
}, true);

// ---------- перетаскивание частей на плеере ----------
// Зажал часть и повёл (дальше 4 px) — она едет за курсором; отпустил — сдвиг в черновике и открыты её настройки.
// Пока тянут, сдвиг — во временном <style>, а не через applyLook: тот обходит все правила и дёргал бы кадры

// Экранных px на один px сдвига — произведение zoom по цепочке предков (интерфейс, размер части).
// Не по getBoundingClientRect: его искажают transform нажатия (:active { scale(.95) }) и scale размера,
// а translate от них не растёт — часть уезжала не туда, куда тянули
function zoomOf(el) {
  let z = 1;
  for (let n = el; n; n = n.parentElement) z *= parseFloat(getComputedStyle(n).zoom) || 1;
  return z;
}

const dragStyle = document.createElement('style');
document.head.append(dragStyle);
let drag = null; // { part, el, x0, y0, start, scale, moved, x, y }

function hiOver(el, name) {
  const r = el.getBoundingClientRect(), z = parseFloat(document.documentElement.style.zoom) || 1;
  Object.assign(dzHi.style, { left: `${r.left / z}px`, top: `${r.top / z}px`, width: `${r.width / z}px`, height: `${r.height / z}px` });
  dzHi.classList.toggle('low', r.top / z < 34);
  dzHi.firstChild.textContent = name;
  dzHi.hidden = false;
}

// на window, а не на document: там раньше, чем dzSwallow гасит нажатия режима выбора
addEventListener('pointerdown', (e) => {
  if (!dz?.picking || e.button !== 0 || inDz(e.target)) return;
  const hit = partAt(e.target);
  if (!hit) return;
  // саму часть двигать нельзя (вкладка) — тянем ту, в которой она лежит (строку вкладок)
  let part = hit.part;
  while (part && !part.props.includes('move')) part = part.parent ? dzPart(part.parent) : null;
  if (!part) return;
  const el = (part.moveSel && document.querySelector(part.moveSel)) || hit.el.closest(part.sel.replace(/:hover/g, '')) || hit.el;
  const start = dz.draft.parts[part.id]?.move || { x: 0, y: 0 };
  drag = { part, el, x0: e.clientX, y0: e.clientY, start, scale: zoomOf(el), moved: false, x: start.x, y: start.y };
}, true);

addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) { drag.moved = true; document.documentElement.classList.add('dz-dragging'); }
  drag.x = Math.round(drag.start.x + dx / drag.scale);
  drag.y = Math.round(drag.start.y + dy / drag.scale);
  dragStyle.textContent = `${(drag.part.moveSel || drag.part.sel).replace(/:hover/g, '')} { translate: ${drag.x}px ${drag.y}px !important; }`;
  hiOver(drag.el, `${drag.part.name} · ${drag.x}, ${drag.y}`);
}, true);

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.documentElement.classList.remove('dz-dragging');
  if (!d.moved || !dz) { dragStyle.textContent = ''; return; }
  dzHi.hidden = true;
  dzSet(`part:${d.part.id}:move`, d.x || d.y ? { x: d.x, y: d.y } : null);
  requestAnimationFrame(() => { dragStyle.textContent = ''; }); // после кадра превью: сдвиг уже в стилях дизайна
  dz.tab = 'parts';
  dz.part = d.part.id;
  renderDz(false);
  // клик после отпускания — это конец перетаскивания, а не выбор
  const eat = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
  addEventListener('click', eat, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', eat, true), 0);
}
addEventListener('pointerup', endDrag, true);
addEventListener('pointercancel', endDrag, true);

// Shift + колесо над частью — её размер, шагом 5 %. Chromium с Shift крутит вбок: шаг приходит в deltaX
addEventListener('wheel', (e) => {
  if (!dz?.picking || !e.shiftKey || drag?.moved || inDz(e.target)) return;
  const hit = partAt(e.target);
  if (!hit || !hit.part.props.includes('size')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const delta = e.deltaY || e.deltaX;
  if (!delta) return;
  const def = DesignCore.PROPS.size;
  const cur = dz.draft.parts[hit.part.id]?.size ?? def.def;
  const next = Math.min(def.max, Math.max(def.min, cur + (delta < 0 ? def.step : -def.step)));
  dzSet(`part:${hit.part.id}:size`, next === def.def ? null : next);
  dz.tab = 'parts';
  dz.part = hit.part.id;
  renderDz(false);
  requestAnimationFrame(() => requestAnimationFrame(() => { if (dz) hiOver(hit.el, `${hit.part.name} · ${next}%`); })); // рамка — по новому размеру
}, { capture: true, passive: false });

// ---------- всплывашки: пипетка цвета и выбор шрифта ----------
// Живут вне панели (у неё overflow: hidden) и слева от неё — над плеером, который тут же показывает результат

const popEl = document.createElement('div');
popEl.className = 'pop';
popEl.hidden = true;
document.body.append(popEl);
let pop = null; // { kind: 'cp' | 'fp', key, anchor, … }
const inDz = (t) => dzEl.contains(t) || popEl.contains(t);

// Ключ поля → текущее значение в черновике (обратное dzSet)
function dzGet(key) {
  const d = dz.draft;
  const [kind, a, b] = key.split(':');
  if (kind === 'pal') return d.palette[a];
  if (kind === 'font') return d.fonts[a] || undefined;
  if (kind === 'part') {
    const [prop, sub] = b.split('.');
    const v = d.parts[a]?.[prop];
    return sub ? v?.[sub] : v;
  }
  return d[a];
}

function placePop(anchor) {
  const z = parseFloat(document.documentElement.style.zoom) || 1; // как в showMenu (app.js)
  const r = anchor.getBoundingClientRect();
  popEl.hidden = false;
  const w = popEl.offsetWidth * z, h = popEl.offsetHeight * z;
  const left = Math.max(8, Math.min(dzEl.getBoundingClientRect().left - w - 10, innerWidth - w - 8)); // вплотную слева от панели
  const top = Math.max(8, Math.min(r.top - 24, innerHeight - h - 8));
  popEl.style.left = `${left / z}px`;
  popEl.style.top = `${top / z}px`;
}

// Закрыть. Снаружи нажали на другую кнопку панели — перерисовываем её после клика, иначе клик уйдёт в пустоту
function closePop(render = true) {
  if (!pop) return;
  if (pop.kind === 'cp') {
    const v = dzGet(pop.key);
    if (typeof v === 'string' && v.startsWith('#') && v !== pop.start) cpRemember(v);
  }
  pop = null;
  popEl.hidden = true;
  popEl.innerHTML = '';
  if (render) { renderDz(); return; }
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(renderDz, 0); } };
  document.addEventListener('click', go, { once: true });
  setTimeout(go, 800);
}
document.addEventListener('pointerdown', (e) => {
  if (pop && !popEl.contains(e.target) && !pop.anchor.contains(e.target)) closePop(false);
}, true);

// ---- пипетка ----

const CP_PRESETS = ['#ffffff', '#e8e1d5', '#b9b5ad', '#8e8e93', '#48484a', '#2a2a2e', '#18181b', '#0b0b0d', '#000000',
  '#ff5a5f', '#ff8a3d', '#f0a63a', '#f5d547', '#7ed49a', '#2ec4b6', '#5cc8e8', '#4f7cff', '#9aa8ff',
  '#c792ea', '#ff8ac6', '#ff3da6', '#b5838d', '#8d6e63', '#556b2f', '#1f4e5f', '#3d2b56', '#5b1a1a'];
const cpRecent = () => { try { const a = JSON.parse(localStorage.getItem('aveon.cp.recent') || '[]'); return Array.isArray(a) ? a.slice(0, 9) : []; } catch { return []; } };
function cpRemember(hex) {
  try { localStorage.setItem('aveon.cp.recent', JSON.stringify([hex, ...cpRecent().filter((c) => c !== hex)].slice(0, 9))); } catch {}
}

function openCp(btn) {
  const key = btn.dataset.dzCp;
  if (pop?.key === key) { closePop(); return; }
  if (pop) closePop(false);
  pop = { kind: 'cp', key, anchor: btn, start: dzGet(key), fallback: btn.dataset.fallback, tokens: btn.dataset.tokens === '1', reset: btn.dataset.reset === '1' };
  renderCp();
  placePop(btn);
}

const cpHex = (v) => (typeof v === 'string' && v.startsWith('#') ? v : currentHex(tokenVar(v) || pop.fallback));
function renderCp() {
  const v = dzGet(pop.key);
  const hex = cpHex(v);
  const sw = (c, title) => `<button class="cp-sw${v === c ? ' on' : ''}" data-cp-v="${c}" style="--c: ${c}" title="${esc(title || c)}" aria-label="${esc(title || c)}"></button>`;
  const recent = cpRecent();
  popEl.innerHTML = `${pop.tokens ? `<h5>Цвета темы</h5><div class="cp-grid">${DesignCore.TOKENS.map(([t, name, cssVar]) => `<button class="cp-sw${v === t ? ' on' : ''}" data-cp-v="${t}" style="--c: var(${cssVar})" title="${esc(name)}" aria-label="${esc(name)}"></button>`).join('')}</div>
      <p class="cp-note">Меняются вместе с обложкой и основой</p>` : ''}
    <h5>Готовые</h5><div class="cp-grid">${CP_PRESETS.map((c) => sw(c)).join('')}</div>
    ${recent.length ? `<h5>Недавние</h5><div class="cp-grid">${recent.map((c) => sw(c)).join('')}</div>` : ''}
    <h5>Свой</h5>
    <div class="cp-sv" data-cp-drag="sv" aria-label="Насыщенность и яркость"><i></i></div>
    <div class="cp-row">${window.EyeDropper ? `<button class="icon-btn small cp-drop" data-cp-drop title="Взять цвет с экрана" aria-label="Взять цвет с экрана"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg></button>` : ''}
      <div class="cp-hue" data-cp-drag="hue" aria-label="Оттенок"><i></i></div></div>
    <div class="cp-row"><i class="cp-now"></i><input class="input" data-cp-hex value="${hex}" maxlength="7" spellcheck="false" aria-label="Код цвета"></div>
    ${pop.reset ? `<button class="btn cp-reset" data-cp-reset${v == null ? ' disabled' : ''}>Как в основе</button>` : ''}`;
  pop.hsv = hexToHsv(hex);
  cpThumbs(hex);
}

// HSV ⇄ #rrggbb. Оттенок держим в pop.hsv сами: у серого он теряется, и полоса прыгала бы в красный
function hexToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max };
}
function hsvToHex({ h, s, v }) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `#${[5, 3, 1].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('')}`;
}
// Ползунки пипетки — по pop.hsv, образец и поле — по цвету
function cpThumbs(hex) {
  const { h, s, v } = pop.hsv;
  const sv = $('.cp-sv', popEl);
  sv.style.setProperty('--h', h.toFixed(1));
  $('i', sv).style.cssText = `left: ${s * 100}%; top: ${(1 - v) * 100}%; background: ${hex}`;
  $('.cp-hue i', popEl).style.cssText = `left: ${(h / 360) * 100}%; background: hsl(${h.toFixed(1)} 100% 50%)`;
  $('.cp-now', popEl).style.setProperty('--c', hex);
  const inp = $('[data-cp-hex]', popEl);
  if (inp !== document.activeElement) inp.value = hex;
}

// Выбрали цвет — черновик и кнопка в панели меняются сразу; саму панель перерисуем при закрытии.
// keepHsv — цвет пришёл с ползунков пипетки: их положение уже верное, пересчёт из hex его бы сбил
function cpSet(v, keepHsv = false) {
  dzSet(pop.key, v);
  const hex = cpHex(v);
  pop.anchor.style.setProperty('--c', hex);
  pop.anchor.classList.remove('unset');
  const name = $('span', pop.anchor);
  if (name) name.textContent = v.startsWith('#') ? v : DesignCore.TOKENS.find(([t]) => t === v)[1];
  for (const b of $$('.cp-sw', popEl)) b.classList.toggle('on', b.dataset.cpV === v);
  if (!keepHsv) pop.hsv = hexToHsv(hex);
  cpThumbs(hex);
  const reset = $('[data-cp-reset]', popEl);
  if (reset) reset.disabled = false;
}

// ---- выбор шрифта: группами, каждое название — своим шрифтом ----

function openFp(btn) {
  const key = btn.dataset.dzFp;
  if (pop?.key === key) { closePop(); return; }
  if (pop) closePop(false);
  pop = { kind: 'fp', key, anchor: btn };
  const cur = dzGet(key) || '';
  for (const id of Object.keys(DesignCore.FONTS)) ensureFont(id);
  const item = (id, name, css) => `<button class="fp-item${cur === id ? ' on' : ''}" data-fp-v="${id}"${css ? ` style="font-family: ${esc(css)}"` : ''}>${esc(name)}</button>`;
  popEl.innerHTML = `<div class="fp-list">${item('', btn.dataset.empty)}${DesignCore.FONT_KINDS.map(([kind, title]) => `<h5>${esc(title)}</h5>${Object.entries(DesignCore.FONTS).filter(([, f]) => f.kind === kind).map(([id, f]) => item(id, f.name, f.css)).join('')}`).join('')}</div>`;
  placePop(btn);
  $('.fp-item.on', popEl)?.scrollIntoView({ block: 'center' });
}

popEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !pop) return;
  if (b.dataset.cpV) cpSet(b.dataset.cpV);
  else if (b.hasAttribute('data-cp-drop')) {
    // пипетка с экрана (Chromium EyeDropper): ткнуть в любое место, хоть в обложку
    const key = pop.key;
    new EyeDropper().open().then((r) => { if (pop?.key === key) cpSet(r.sRGBHex.toLowerCase()); }).catch(() => {});
  }
  else if (b.hasAttribute('data-cp-reset')) { dzSet(pop.key, null); closePop(); }
  else if (b.dataset.fpV !== undefined) { dzSet(pop.key, b.dataset.fpV || null); closePop(); }
});
popEl.addEventListener('input', (e) => {
  const t = e.target;
  if (!pop) return;
  if (t.hasAttribute('data-cp-hex')) {
    const m = t.value.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (!m) return;
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    cpSet(`#${h.toLowerCase()}`);
  }
});
addEventListener('resize', () => { if (pop) closePop(); });
// Квадрат (насыщенность × яркость) и полоса оттенка: тянешь — цвет меняется на лету
popEl.addEventListener('pointerdown', (e) => {
  const area = e.target.closest('[data-cp-drag]');
  if (!area || !pop || e.button !== 0) return;
  e.preventDefault();
  area.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const r = area.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    if (area.dataset.cpDrag === 'hue') pop.hsv.h = x * 360;
    else { pop.hsv.s = x; pop.hsv.v = 1 - y; }
    cpSet(hsvToHex(pop.hsv), true);
  };
  const up = () => { area.removeEventListener('pointermove', move); area.removeEventListener('pointerup', up); area.removeEventListener('pointercancel', up); };
  area.addEventListener('pointermove', move);
  area.addEventListener('pointerup', up);
  area.addEventListener('pointercancel', up);
  move(e);
});
