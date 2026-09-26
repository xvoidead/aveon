'use strict';

// ---------- liquid glass ----------
// Стекло как в шейдере «Liquid Glass» (shadertoy.com/view/wfGXzh): панель — выпуклая линза со
// скруглёнными углами. Внутри содержимое за ней видно почти как есть, у кромки оно преломляется
// (тянется к центру), цвета чуть расходятся (хроматическая аберрация), по краю — блик.
//
// Как устроено: для каждой панели своя карта смещений (canvas → картинка), где R и G — куда сдвинуть
// пиксель фона. Карта считается из расстояния до кромки скруглённого прямоугольника (SDF), как в
// шейдере. SVG-фильтр с feDisplacementMap подключается через backdrop-filter: url(#…), поэтому
// преломляется настоящее содержимое окна под панелью. Три смещения с разной силой — по одному на
// канал R, G, B — дают радужную кромку.

const GLASS_SVG = 'http://www.w3.org/2000/svg';
const glass = {
  on: false,
  defs: null,
  filters: new Map(), // ключ размеров → id фильтра
  els: new Map(),     // элемент → { opts, key }
  ro: null,
  mo: null,
  strength: 1,
};

// Что делаем стеклянным и насколько: blur — матовость, scale — сила преломления (px),
// bevel — ширина выпуклой кромки (px)
const GLASS_TARGETS = [
  ['.sheet', { blur: 14, scale: 54, bevel: 30 }],
  ['.menu', { blur: 12, scale: 36, bevel: 16 }],
  ['.together', { blur: 12, scale: 44, bevel: 22 }],
  ['.toast', { blur: 10, scale: 36, bevel: 14 }],
  ['.search', { blur: 3, scale: 44, bevel: 20 }],
  ['.call', { blur: 6, scale: 40, bevel: 16 }],
  ['.pf-hero, .pf-card', { blur: 8, scale: 40, bevel: 22 }],
  ['.me', { blur: 3, scale: 26, bevel: 12 }],
  ['.fs-controls', { blur: 4, scale: 40, bevel: 22 }],
  ['.head-actions .btn:not(.primary)', { blur: 3, scale: 24, bevel: 10 }],
  ['.collections .chip:not(.active)', { blur: 3, scale: 22, bevel: 10 }],
];

// ---- карта смещений ----

function glassMap(w, h, r, bevel) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const hx = w / 2, hy = h / 2;
  r = Math.min(r, hx, hy);
  const bx = hx - r, by = hy - r;
  for (let y = 0; y < h; y++) {
    const py = y + 0.5 - hy;
    const ay = Math.abs(py);
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx;
      const ax = Math.abs(px);
      // расстояние до кромки скруглённого прямоугольника (отрицательное внутри) и нормаль наружу
      const qx = ax - bx, qy = ay - by;
      let dist, nx, ny;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        dist = len - r;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
      } else if (qx > qy) {
        dist = qx - r; nx = Math.sign(px); ny = 0;
      } else {
        dist = qy - r; nx = 0; ny = Math.sign(py);
      }
      // 0 в глубине панели, 1 на самой кромке. Профиль выпуклый: у края преломление резко растёт
      const t = Math.min(1, Math.max(0, 1 + dist / bevel));
      const m = Math.pow(t, 2.4);
      const i = (y * w + x) * 4;
      d[i] = 128 - nx * m * 127;     // R: сдвиг по x — к центру панели
      d[i + 1] = 128 - ny * m * 127; // G: сдвиг по y
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

function glassFilter(w, h, r, opts) {
  const s = glass.strength;
  const key = `${w}x${h}r${r}b${opts.bevel}s${opts.scale}m${opts.blur}k${s}`;
  if (glass.filters.has(key)) return glass.filters.get(key);
  const id = `lg${glass.filters.size}`;
  const scale = opts.scale * s;
  const f = document.createElementNS(GLASS_SVG, 'filter');
  f.id = id;
  f.setAttribute('x', '0'); f.setAttribute('y', '0');
  f.setAttribute('width', w); f.setAttribute('height', h);
  f.setAttribute('filterUnits', 'userSpaceOnUse');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  const channel = (k) => ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0']
    .map((row, i) => (i === k ? row : '0 0 0 0 0')).join(' ') + ' 0 0 0 1 0';
  f.innerHTML = `
    <feImage href="${glassMap(w, h, r, opts.bevel)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="${opts.blur}" edgeMode="duplicate" result="bg"/>
    <feDisplacementMap in="bg" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="dr"/>
    <feDisplacementMap in="bg" in2="map" scale="${scale * 0.94}" xChannelSelector="R" yChannelSelector="G" result="dg"/>
    <feDisplacementMap in="bg" in2="map" scale="${scale * 0.88}" xChannelSelector="R" yChannelSelector="G" result="db"/>
    <feColorMatrix in="dr" type="matrix" values="${channel(0)}" result="r"/>
    <feColorMatrix in="dg" type="matrix" values="${channel(1)}" result="g"/>
    <feColorMatrix in="db" type="matrix" values="${channel(2)}" result="b"/>
    <feBlend in="r" in2="g" mode="screen" result="rg"/>
    <feBlend in="rg" in2="b" mode="screen"/>`;
  glass.defs.append(f);
  glass.filters.set(key, id);
  return id;
}

// ---- панели ----

function glassApply(el) {
  const rec = glass.els.get(el);
  if (!rec || !glass.on) return;
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (!w || !h) return; // скрыта — пересчитаем, когда появится (ResizeObserver)
  const r = Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0);
  const key = `${w}x${h}r${r}`;
  if (rec.key === key && rec.strength === glass.strength) return;
  rec.key = key;
  rec.strength = glass.strength;
  const id = glassFilter(w, h, r, rec.opts);
  el.style.backdropFilter = `url(#${id}) saturate(1.35) brightness(1.06)`;
}

function glassTrack(el, opts) {
  if (glass.els.has(el)) return;
  glass.els.set(el, { opts, key: '' });
  el.classList.add('lg');
  glass.ro.observe(el);
  glassApply(el);
}

function glassScan(root = document) {
  for (const [sel, opts] of GLASS_TARGETS) {
    if (root.matches?.(sel)) glassTrack(root, opts);
    root.querySelectorAll?.(sel).forEach((el) => glassTrack(el, opts));
  }
}

// Фильтров копится по одному на размер: при смене размеров окна их становится много — чистим
function glassPrune() {
  if (glass.filters.size < 120) return;
  glass.defs.innerHTML = '';
  glass.filters.clear();
  for (const rec of glass.els.values()) rec.key = '';
  for (const el of glass.els.keys()) glassApply(el);
}

function glassEnable() {
  if (glass.on) return;
  glass.on = true;
  document.body.classList.add('liquid-glass');
  if (!glass.defs) {
    const svg = document.createElementNS(GLASS_SVG, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    glass.defs = document.createElementNS(GLASS_SVG, 'defs');
    svg.append(glass.defs);
    document.body.append(svg);
  }
  glass.ro = new ResizeObserver((entries) => {
    for (const e of entries) glassApply(e.target);
    glassPrune();
  });
  // Новые панели (тосты, перерисованные чипы и кнопки) подхватываем сами
  glass.mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1) glassScan(n);
      for (const n of m.removedNodes) if (n.nodeType === 1) glassForget(n);
    }
  });
  glass.mo.observe(document.body, { childList: true, subtree: true });
  glassScan();
  glassBackdrop(state.track?.cover);
}

function glassForget(root) {
  for (const el of [...glass.els.keys()]) {
    if (root === el || root.contains(el)) { glass.ro?.unobserve(el); glass.els.delete(el); }
  }
}

function glassDisable() {
  if (!glass.on) return;
  glass.on = false;
  document.body.classList.remove('liquid-glass');
  glass.ro?.disconnect();
  glass.mo?.disconnect();
  for (const el of glass.els.keys()) { el.style.backdropFilter = ''; el.classList.remove('lg'); }
  glass.els.clear();
}

function applyGlass() {
  const ui = state.cfg.ui || {};
  const strength = Math.max(0.2, Math.min(1.6, +ui.glassStrength || 1));
  if (strength !== glass.strength) {
    glass.strength = strength;
    for (const rec of glass.els.values()) rec.key = '';
    for (const el of glass.els.keys()) glassApply(el);
  }
  if (ui.glass) glassEnable(); else glassDisable();
}

// ---- фон под стеклом ----
// Стеклу нужно, что преломлять: позади всего окна — размытая обложка трека и пятна цвета палитры

function glassBackdrop(cover) {
  const bg = $('#glass-bg');
  if (!bg) return;
  bg.style.setProperty('--cover', cover ? `url("${String(cover).replace(/"/g, '%22')}")` : 'none');
}
