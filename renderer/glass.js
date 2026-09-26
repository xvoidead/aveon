'use strict';

// ---------- liquid glass ----------
// Порт шейдера Liquid Glass от @preyneyv (shadertoy.com/view/wfGXzh), повторяет Liquid Glass из iOS 26.
// Формулы и константы те же, что в шейдере (вкладки Common и Image):
//  - преломление только в полосе у кромки шириной REFR_DIM; сила растёт к краю по 1 − cos,
//    сдвиг — внутрь, против нормали, до REFR_MAG от размера окна;
//  - у каждого канала свой показатель преломления (REFR_IOR, усиленный REFR_ABERRATION) —
//    отсюда радужная кромка;
//  - тонкий обод EDGE_DIM: направленный блик (RIM_LIGHT) и отражение яркого фона (bloom),
//    смешанные «экраном» и наложенные «светлее».
// Фон здесь — живое содержимое окна: карта смещений и обод считаются на canvas из SDF
// скруглённого прямоугольника панели и подключаются SVG-фильтром через backdrop-filter.

// Константы из Common (в долях высоты / размера окна, как UV в шейдере)
const LG = {
  EPS_PIX: 2,
  REFR_DIM: 0.05,
  REFR_MAG: 0.1,
  REFR_ABERRATION: 5,
  REFR_IOR: [1.51, 1.52, 1.53],
  EDGE_DIM: 0.003,
  RIM_LIGHT: [-Math.SQRT1_2, -Math.SQRT1_2], // normalize(vec2(-1, 1)) в шейдере; у DOM ось y вниз
  RIM_ALPHA: 0.15,
};

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

// Стеклянные только всплывающие панели. tint — подложка для читаемости текста (TINT_COLOR
// в шейдере), blur — BLUR_AMOUNT: в шейдере по умолчанию размытия нет
const GLASS_TARGETS = [
  ['.sheet', { tint: 0.74, blur: 0 }],
  ['.menu', { tint: 0.78, blur: 0 }],
  ['.together', { tint: 0.74, blur: 0 }],
  ['.toast', { tint: 0.7, blur: 0 }],
];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerpN = (min, max, v) => Math.min(1, Math.max(0, (v - min) / (max - min)));

// Карты для одной панели: смещение для R, G, B (x и y в красном и зелёном), цвет блика и маска обода
function glassMaps(w, h, r, W, H, strength) {
  const EPS = LG.EPS_PIX;
  const DIM = LG.REFR_DIM * H;
  const EDGE = Math.max(1, LG.EDGE_DIM * H);
  const g = LG.REFR_IOR[1];
  const ior = LG.REFR_IOR.map((v) => g + (v - g) * LG.REFR_ABERRATION); // mix(vec3(ior.g), ior, ABERRATION)
  const magX = LG.REFR_MAG * W * strength, magY = LG.REFR_MAG * H * strength;
  const scale = 2 * Math.max(magX, magY) + 2; // feDisplacementMap: сдвиг = scale · (C − 0.5)
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); return { c, x, img: x.createImageData(w, h) }; };
  const maps = [mk(), mk(), mk()];
  const rim = mk(), mask = mk();
  const hx = w / 2, hy = h / 2;
  r = Math.min(r, hx, hy);
  const bx = hx - r, by = hy - r;
  for (let y = 0; y < h; y++) {
    const py = y + 0.5 - hy;
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx;
      // sdgBox: расстояние до кромки (минус внутри) и градиент — нормаль наружу
      const wx = Math.abs(px) - bx, wy = Math.abs(py) - by;
      const sx = px < 0 ? -1 : 1, sy = py < 0 ? -1 : 1;
      let d, nx, ny;
      const gmax = Math.max(wx, wy);
      if (gmax > 0) {
        const qx = Math.max(wx, 0), qy = Math.max(wy, 0), l = Math.hypot(qx, qy) || 1;
        d = l - r; nx = sx * qx / l; ny = sy * qy / l;
      } else {
        d = gmax - r;
        if (wx > wy) { nx = sx; ny = 0; } else { nx = 0; ny = sy; }
      }
      const i = (y * w + x) * 4;
      // refractionLayer
      let boundary = lerpN(-DIM, EPS, d);
      boundary *= 1 - smooth(0, EPS, d);
      const cosB = 1 - Math.cos(boundary * Math.PI / 2);
      for (let k = 0; k < 3; k++) {
        const ratio = Math.pow(cosB, ior[k]);
        const m = maps[k].img.data;
        m[i] = Math.round(255 * (0.5 - (nx * magX * ratio) / scale));
        m[i + 1] = Math.round(255 * (0.5 - (ny * magY * ratio) / scale));
        m[i + 2] = 128; m[i + 3] = 255;
      }
      // tintLayer: обод и направленный блик
      const edge = Math.min(smooth(EPS, 0, d), lerpN(-EDGE, 0, d));
      const cosE = 1 - Math.cos(edge * Math.PI / 2);
      const light = Math.round(255 * LG.RIM_ALPHA * Math.abs(nx * LG.RIM_LIGHT[0] + ny * LG.RIM_LIGHT[1]));
      const rd = rim.img.data;
      rd[i] = rd[i + 1] = rd[i + 2] = light; rd[i + 3] = 255;
      const md = mask.img.data;
      md[i] = md[i + 1] = md[i + 2] = 255; md[i + 3] = Math.round(255 * cosE);
    }
  }
  const url = (m) => { m.x.putImageData(m.img, 0, 0); return m.c.toDataURL(); };
  return { maps: maps.map(url), rim: url(rim), mask: url(mask), scale };
}

function glassFilter(w, h, r, opts) {
  const W = innerWidth, H = innerHeight, s = glass.strength;
  const key = `${w}x${h}r${r}|${W}x${H}|${opts.blur}|${s}`;
  if (glass.filters.has(key)) return glass.filters.get(key);
  glass.seq = (glass.seq || 0) + 1;
  const id = `lg${glass.seq}`;
  const m = glassMaps(w, h, r, W, H, s);
  const f = document.createElementNS(GLASS_SVG, 'filter');
  f.id = id;
  f.setAttribute('x', '0'); f.setAttribute('y', '0');
  f.setAttribute('width', w); f.setAttribute('height', h);
  f.setAttribute('filterUnits', 'userSpaceOnUse');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  const img = (href, result) => `<feImage href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="${result}"/>`;
  const only = (k) => ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0'].map((row, i) => (i === k ? row : '0 0 0 0 0')).join(' ') + ' 0 0 0 1 0';
  const src = opts.blur ? 'bg' : 'SourceGraphic';
  f.innerHTML = `
    ${img(m.maps[0], 'mr')}${img(m.maps[1], 'mg')}${img(m.maps[2], 'mb')}
    ${opts.blur ? `<feGaussianBlur in="SourceGraphic" stdDeviation="${opts.blur}" edgeMode="duplicate" result="bg"/>` : ''}
    <feDisplacementMap in="${src}" in2="mr" scale="${m.scale}" xChannelSelector="R" yChannelSelector="G" result="dr"/>
    <feDisplacementMap in="${src}" in2="mg" scale="${m.scale}" xChannelSelector="R" yChannelSelector="G" result="dg"/>
    <feDisplacementMap in="${src}" in2="mb" scale="${m.scale}" xChannelSelector="R" yChannelSelector="G" result="db"/>
    <feColorMatrix in="dr" type="matrix" values="${only(0)}" result="r"/>
    <feColorMatrix in="dg" type="matrix" values="${only(1)}" result="g"/>
    <feColorMatrix in="db" type="matrix" values="${only(2)}" result="b"/>
    <feBlend in="r" in2="g" mode="screen" result="rg"/>
    <feBlend in="rg" in2="b" mode="screen" result="col"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="6" edgeMode="duplicate" result="soft"/>
    <feComponentTransfer in="soft" result="hi">
      <feFuncR type="linear" slope="1.25" intercept="-0.25"/><feFuncG type="linear" slope="1.25" intercept="-0.25"/><feFuncB type="linear" slope="1.25" intercept="-0.25"/>
    </feComponentTransfer>
    <feBlend in="SourceGraphic" in2="hi" mode="screen" result="refl"/>
    ${img(m.rim, 'rim')}
    <feBlend in="refl" in2="rim" mode="screen" result="merged"/>
    <feBlend in="col" in2="merged" mode="lighten" result="edgeCol"/>
    ${img(m.mask, 'mask')}
    <feComposite in="edgeCol" in2="mask" operator="in" result="edgeOnly"/>
    <feComposite in="edgeOnly" in2="col" operator="over"/>`;
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
  const key = `${w}x${h}r${r}|${innerWidth}x${innerHeight}|${glass.strength}`; // сила преломления зависит и от размеров окна
  if (rec.key === key) return;
  rec.key = key;
  el.style.backdropFilter = `url(#${glassFilter(w, h, r, rec.opts)})`;
  el.style.setProperty('--lg-tint', `${Math.round(rec.opts.tint * 100)}%`);
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
  if (glass.filters.size < 40) return;
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
}

// Размер окна входит в формулы шейдера — после ресайза пересчитываем карты (с задержкой)
let glassResizeTimer = 0;
window.addEventListener('resize', () => {
  if (!glass.on) return;
  clearTimeout(glassResizeTimer);
  glassResizeTimer = setTimeout(() => { for (const el of glass.els.keys()) glassApply(el); glassPrune(); }, 250);
});

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
  for (const el of glass.els.keys()) { el.style.backdropFilter = ''; el.style.removeProperty('--lg-tint'); el.classList.remove('lg'); }
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
