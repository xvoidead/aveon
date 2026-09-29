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

function moveBlock(group, id, dir) {
  const ids = DesignCore.orderedBlocks(dz.draft, group).map((p) => p.id);
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  dz.draft.order[group] = ids;
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
// Цвет части: токены (меняются с темой и обложкой) или свой; clear — показывать «×»
function dzColor(key, v, fallbackVar, clear = true) {
  const mine = typeof v === 'string' && v.startsWith('#');
  return `${DesignCore.TOKENS.map(([t, name, cssVar]) => `<button class="dz-token${v === t ? ' on' : ''}" data-dz-set="${key}" data-v="${t}" style="--c: var(${cssVar})" title="${name}" aria-label="${name}"></button>`).join('')}
    <input type="color" class="${mine ? 'on' : ''}" data-dz-color="${key}" value="${mine ? v : currentHex(tokenVar(v) || fallbackVar)}" aria-label="Свой цвет">${clear ? dzClear(key, v != null) : ''}`;
}

function commonBody(d) {
  const fontSel = (k) => `<select class="input" data-dz-select="font:${k}"><option value="">Как в основе</option>${Object.entries(DesignCore.FONTS).map(([id, f]) => `<option value="${id}" ${d.fonts[k] === id ? 'selected' : ''}>${f.name}</option>`).join('')}</select>`;
  return `<section class="dz-sec"><h4>Основа</h4>
      <p class="dz-hint">Раскладка и стиль, на которых строится дизайн.</p>
      ${dzSeg('top:base', DesignCore.BASES.map((b) => [b, SKINS[b].name]), d.base)}</section>
    <section class="dz-sec"><h4>Палитра</h4>
      <p class="dz-hint">Не заданный цвет берётся из основы и обложки.</p>
      <div class="dz-colors">${DesignCore.PALETTE.map(([k, label]) => `<div class="dz-pal${d.palette[k] ? ' set' : ''}">
        <input type="color" data-dz-color="pal:${k}" value="${d.palette[k] || currentHex(`--${k}`)}" aria-label="${label}"><span>${label}</span>${dzClear(`pal:${k}`, !!d.palette[k])}</div>`).join('')}</div>
      ${dzField('Акцент из обложки', `<label class="switch"><input type="checkbox" data-dz-bool="top:accentFromCover" ${d.accentFromCover ? 'checked' : ''} aria-label="Акцент из обложки"><span></span></label>`)}
    </section>
    <section class="dz-sec"><h4>Шрифты</h4>${dzField('Заголовки', fontSel('display'))}${dzField('Текст', fontSel('text'))}</section>
    <section class="dz-sec"><h4>Скругления</h4>${dzField('Все углы', `<input type="range" data-dz-range="top:radius" data-unit="%" min="0" max="250" step="10" value="${d.radius}" aria-label="Скругления"><span class="val" data-dz-val="top:radius">${d.radius}%</span>`)}</section>`;
}

function dzNode(d, p, move) {
  const vals = d.parts[p.id];
  const hidden = !!vals?.hidden;
  const seen = hidden || partVisible(p);
  const eye = p.props.includes('hidden')
    ? `<button class="icon-btn small" data-dz-eye="${p.id}" aria-pressed="${!hidden}" title="${hidden ? 'Показать' : 'Скрыть'}" aria-label="${hidden ? 'Показать' : 'Скрыть'} «${esc(p.name)}»"><svg><use href="#i-${hidden ? 'eye-off' : 'eye'}"/></svg></button>` : '';
  const arrows = move
    ? `<button class="icon-btn small" data-dz-move="${p.id}" data-group="${move.group}" data-dir="-1" ${move.i === 0 ? 'disabled' : ''} aria-label="Выше"><svg style="transform:rotate(90deg)"><use href="#i-chevron-l"/></svg></button>
      <button class="icon-btn small" data-dz-move="${p.id}" data-group="${move.group}" data-dir="1" ${move.i === move.n - 1 ? 'disabled' : ''} aria-label="Ниже"><svg style="transform:rotate(90deg)"><use href="#i-chevron-r"/></svg></button>` : '';
  return `<li class="dz-node${p.parent ? ' child' : ''}${hidden ? ' off' : ''}${seen ? '' : ' missing'}">
    <button class="dz-node-name" data-dz-part="${p.id}"${seen ? '' : ' title="Сейчас не видно в плеере"'}>${esc(p.name)}${vals ? '<i class="dz-dot"></i>' : ''}</button>${eye}${arrows}</li>`;
}

function treeBody(d) {
  return DesignCore.GROUPS.map((g) => {
    const tops = g.sel ? DesignCore.orderedBlocks(d, g.id) : DesignCore.PARTS.filter((p) => p.group === g.id && !p.parent);
    const items = tops.map((p, i) => dzNode(d, p, g.sel ? { i, n: tops.length, group: g.id } : null)
      + DesignCore.PARTS.filter((c) => c.parent === p.id).map((c) => dzNode(d, c)).join('')).join('');
    return `<section class="dz-sec"><h4>${g.name}</h4><ol class="dz-tree">${items}</ol></section>`;
  }).join('');
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
      if (prop === 'font') return dzField(label, `<select class="input" data-dz-select="${key}"><option value="">Как везде</option>${def.options.map(([o, n]) => `<option value="${o}" ${v === o ? 'selected' : ''}>${n}</option>`).join('')}</select>`);
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
      <button class="icon-btn${dz.picking ? ' on' : ''}" id="dz-pick" aria-pressed="${dz.picking}" title="Выбрать часть на плеере" aria-label="Выбрать часть на плеере"><svg><use href="#i-focus"/></svg></button>
      <button class="icon-btn" id="dz-close" title="Закрыть" aria-label="Закрыть"><svg><use href="#i-close"/></svg></button>
    </div>
    <div class="seg dz-tabs">${[['common', 'Общее'], ['parts', 'Части']].map(([id, name]) => `<button data-dz-tab="${id}" class="${dz.tab === id ? 'on' : ''}">${name}</button>`).join('')}</div>
    <div class="dz-body">${dz.tab === 'common' ? commonBody(d) : dz.part ? partBody(d, dz.part) : treeBody(d)}</div>
    <div class="dz-foot"><button class="btn" id="dz-cancel">Отмена</button><button class="btn primary" id="dz-save">Сохранить</button></div>`;
  $('.dz-body', dzEl).scrollTop = top;
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
  if (ds.dzSet) dzSet(ds.dzSet, ds.v);
  else if (ds.dzClear) dzSet(ds.dzClear, null);
  else if (ds.dzEye) dzSet(`part:${ds.dzEye}:hidden`, dz.draft.parts[ds.dzEye]?.hidden ? null : true);
  else if (ds.dzMove) moveBlock(ds.group, ds.dzMove, +ds.dir);
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
  } else if (t.dataset.dzColor) dzSet(t.dataset.dzColor, t.value.toLowerCase());
});

// По отпусканию ползунка и закрытию палитры — перерисовать: появились «×» и зависимые поля
dzEl.addEventListener('change', (e) => {
  const t = e.target;
  if (!dz) return;
  if (t.dataset.dzBool) dzSet(t.dataset.dzBool, t.dataset.dzBool.startsWith('part:') ? (t.checked || null) : t.checked);
  else if (t.dataset.dzSelect) dzSet(t.dataset.dzSelect, t.value || null);
  else if (!t.dataset.dzRange && !t.dataset.dzColor) return;
  renderDz();
});

// Esc: выйти из выбора кликом → из свойств части → из редактора. Открытый диалог закрывается сам (app.js → ask)
document.addEventListener('keydown', (e) => {
  if (!dz || e.key !== 'Escape' || !$('#dialog').hidden) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (dz.picking) setPicking(false);
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
    if (n === dzEl) return null;
    const part = PICKABLE.find((p) => n.matches(p.sel));
    if (part) return { part, el: n };
  }
  return null;
}

document.addEventListener('pointermove', (e) => {
  if (!dz?.picking) return;
  const hit = partAt(e.target);
  if (!hit) { dzHi.hidden = true; return; }
  // координаты экранные, а стиль — внутри zoom на <html> (look.js → размер интерфейса), как в showMenu (app.js)
  const r = hit.el.getBoundingClientRect(), z = parseFloat(document.documentElement.style.zoom) || 1;
  Object.assign(dzHi.style, { left: `${r.left / z}px`, top: `${r.top / z}px`, width: `${r.width / z}px`, height: `${r.height / z}px` });
  dzHi.classList.toggle('low', r.top / z < 34);
  dzHi.firstChild.textContent = hit.part.name;
  dzHi.hidden = false;
}, true);

const dzSwallow = (e) => { if (dz?.picking && !dzEl.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } };
for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) document.addEventListener(type, dzSwallow, true);
document.addEventListener('click', (e) => {
  if (!dz?.picking || dzEl.contains(e.target)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const hit = partAt(e.target);
  if (!hit) return;
  dz.tab = 'parts';
  dz.part = hit.part.id;
  setPicking(false);
  renderDz(false);
}, true);
