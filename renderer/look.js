'use strict';
// Оформление под себя (настройки → «Оформление»): тема, акцент, шрифты, размер интерфейса, скругления,
// плотность списка, фон и своя картинка, вид бочки, текст песен, источники в меню, анимации.
// Всё хранится в config.look и синхронизируется через аккаунт; картинка фона — только на этом устройстве.
// Общие глобальные из app.js: state, api, $, $$, esc, toast, ask, saveCfg, VIEWS, NAMES, IS_MOBILE, openView.

const LOOK_DEFAULTS = {
  skin: 'barrel',        // дизайн целиком, см. SKINS
  glassMode: 'auto',     // «Стекло»: auto — как в системе, light | dark
  theme: 'oak',          // см. THEMES; custom — свой оттенок фона
  hue: 25,               // custom: оттенок фона 0…360
  sat: 30,               // custom: насыщенность фона, %
  accentMode: 'cover',   // cover — акцент из обложки; fixed — всегда свой цвет
  accent: '#f0a63a',
  voice: '',             // цвет голосов и бочки; пусто — подбирается сам
  display: 'unbounded',  // шрифт заголовков, см. FONTS
  text: 'onest',         // шрифт текста
  scale: 100,            // размер интерфейса, %
  radius: 100,           // скругления, %
  density: 'normal',     // compact | normal | cozy
  covers: true,          // обложки в списке треков
  albumCol: true,        // колонка «альбом»
  timeCol: true,         // длительность
  motion: 'full',        // full | calm | off
  viz: true,             // спектр вокруг бочки
  vizPower: 100,         // длина лучей спектра, %
  spin: false,           // внутренний обруч вращается, пока играет музыка
  porthole: 'circle',    // circle | rounded | square — форма обложки в бочке
  stageBg: 'glow',       // glow — свечение акцентом; cover — размытая обложка; flat — ровный цвет
  wallpaper: false,      // своя картинка на фоне (сама картинка — store 'wallpaper')
  wallBlur: 24,          // px
  wallDim: 55,           // затемнение, %
  lyricsSize: 100,       // %
  lyricsAlign: 'left',   // left | center
  lyricsBlur: true,      // неактивные строки чуть размыты
  lyricsLetters: true,   // richsync: текущее слово заливается по буквам
  sources: null,         // порядок вкладок библиотеки; null — как по умолчанию
  hidden: [],            // скрытые вкладки
  startView: 'last',     // last — где остановился; иначе id вкладки
  badge: true,           // плашка «в бочке» на обложке
  vinyl: true,           // обложка крутится как пластинка, пока играет (scratch.js)
  scratch: true,         // обложку можно схватить и скретчить
  dock: 'left',          // где плеер на компьютере: left | right | bottom | top
  reactGain: 100,        // реакция на звук: чувствительность, % (спектр, остров, обои, пульс)
  reactSmooth: 70,       // плавность: 0 — дёргается за каждым ударом, 90 — течёт медленно
  reactCover: false,     // обложка в бочке пульсирует на басах
  reactGlow: false,      // свечение за бочкой дышит с громкостью
  reactHoops: false,     // обручи бочки вздрагивают на басах
  fsStyle: 'classic',    // во весь экран: classic — обложка слева, текст справа; cinema — «кино», всё по центру
  fsBg: 'cover',         // cover — размытая обложка; gradient — переливы цветов обложки; plain — ровный фон
  fsMotion: true,        // фон медленно плывёт
  fsClock: false,        // часы в углу
  fsLyrics: true,        // текст песни во весь экран
};

// Фон: [оттенок, насыщенность %] — светлоты те же, что у палитры из обложки (extras.js → setTheme)
const THEMES = {
  oak: { name: 'Дуб', hue: 20, sat: 26 },
  graphite: { name: 'Графит', hue: 220, sat: 6 },
  midnight: { name: 'Полночь', hue: 228, sat: 34 },
  forest: { name: 'Лес', hue: 150, sat: 24 },
  wine: { name: 'Вино', hue: 345, sat: 32 },
  plum: { name: 'Слива', hue: 280, sat: 26 },
  sea: { name: 'Море', hue: 195, sat: 34 },
  oled: { name: 'Чёрная', hue: 0, sat: 0, oled: true },
  custom: { name: 'Свой', hue: null, sat: null },
};

// Дизайны целиком. «Форма» — другая раскладка в духе Material 3 Expressive: слева панель навигации
// с иконками, библиотека и плеер — отдельные большие карточки, обложка — волнистый «цветок», который
// крутится, перемотка — бегущая волна, кнопка «играть» меняет форму. Цвета поверхностей подмешивают
// акцент из обложки. Весь вид — в styles.css (html.skin-form)
// У дизайна может быть: display/text — шрифты по умолчанию (ключи FONTS; свой выбор в настройках главнее),
// radius — множитель скруглений, palette — свои цвета вместо темы (тогда и «фон в цвет обложки» выключен),
// accent — свой акцент вместо цвета обложки.
// Сам вид — в styles.css под html.skin-<id>
const SKINS = {
  barrel: { name: 'Бочка', desc: 'Круглая обложка в обручах, вкладки сверху' },
  form: { name: 'Форма', desc: 'Панель навигации слева, карточки, живые формы и волны', display: 'manrope', text: 'manrope', radius: 1.5 },
  // Дзен: светлая бумага, тушь, энсо вокруг обложки и красная печать — единственный цвет
  zen: {
    name: 'Дзен', desc: 'Светлая бумага, тушь, круг энсо и красная печать', display: 'jost', text: 'jost', radius: 0.3,
    palette: { '--oak': '#f4f4f1', '--oak-2': '#efeeea', '--rivet': '#e6e5e0', '--rivet-2': '#dad8d2', '--hoop-dim': '#c2c0b9', '--hoop': '#8f8d86', '--text': '#1d1d1b', '--text-2': '#55534e', '--text-3': '#85837c' },
    accent: '#c43a31',
  },
  // Стекло: светлая или тёмная тема (palettes), акцент — из обложки. Фон сцены — обложка, заранее размытая
  // в маленькую картинку (extras.js → ambientFrom), поэтому нигде нет ни CSS-блюра, ни backdrop-filter:
  // «стекло» — полупрозрачная заливка поверх уже размытого фона, выглядит так же, а стоит ничего.
  // Обложка квадратная — спектр и вращение пластинки выключены (noViz, noVinyl), их циклы даже не запускаются
  glass: {
    name: 'Стекло', desc: 'Светлая и тёмная тема, стекло поверх цвета обложки', display: 'onest', text: 'onest',
    palettes: {
      light: { '--oak': '#f5f5f3', '--oak-2': '#ecebe8', '--rivet': '#ffffff', '--rivet-2': '#e3e3e0', '--hoop-dim': '#c7c7cc', '--hoop': '#8e8e93', '--text': '#1c1c1e', '--text-2': '#4f4f54', '--text-3': '#6c6c70', '--voice': '#5b48db', '--danger': '#c4302b' },
      dark: { '--oak': '#0a0a0b', '--oak-2': '#121214', '--rivet': '#1c1c1e', '--rivet-2': '#2c2c2e', '--hoop-dim': '#48484a', '--hoop': '#8e8e93', '--text': '#f5f5f7', '--text-2': '#c7c7cc', '--text-3': '#98989d', '--voice': '#a89bff' },
    },
    ambient: true, noViz: true, noVinyl: true,
  },
};

// «Стекло» в режиме «как в системе» следит за темой Windows
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function skinMode(skin) {
  if (!skin.palettes) return null;
  if (look.glassMode === 'light' || look.glassMode === 'dark') return look.glassMode;
  return darkQuery.matches ? 'dark' : 'light';
}
darkQuery.addEventListener('change', () => { if (SKINS[look.skin]?.palettes && look.glassMode === 'auto') applyLook(); });

const ACCENTS = ['#f0a63a', '#ff7b6b', '#f5d547', '#7ed49a', '#5cc8e8', '#9aa8ff', '#c792ea', '#ff8ac6', '#e8e1d5'];

const FONTS = {
  unbounded: { name: 'Unbounded', css: '"Unbounded", "Segoe UI", sans-serif' },
  manrope: { name: 'Manrope', css: '"Manrope", "Segoe UI", sans-serif' },
  jost: { name: 'Jost', css: '"Jost", "Segoe UI", sans-serif' },
  onest: { name: 'Onest', css: '"Onest", "Segoe UI", sans-serif' },
  system: { name: 'Системный', css: 'system-ui, "Segoe UI", Roboto, sans-serif' },
  serif: { name: 'С засечками', css: 'Georgia, "Times New Roman", "Noto Serif", serif' },
  mono: { name: 'Моноширинный', css: '"Cascadia Mono", Consolas, "Roboto Mono", monospace' },
};

let look = { ...LOOK_DEFAULTS };
window.LOOK = look; // спектр в app.js читает viz / vizPower

const lookCfg = () => ({ ...LOOK_DEFAULTS, ...(state.cfg?.look || {}) });
const lookHsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l * 100)}%)`;

// ---------- применение ----------

const lookStyle = document.createElement('style');
lookStyle.id = 'look-vars';
document.head.appendChild(lookStyle);

function themeVars(l) {
  const t = THEMES[l.theme] || THEMES.oak;
  if (t.oled) {
    return { '--oak': '#000', '--oak-2': '#070707', '--rivet': '#121212', '--rivet-2': '#1c1c1c', '--hoop-dim': '#3a3a3a', '--hoop': '#777', '--text': '#f2f2f2', '--text-2': '#b8b8b8', '--text-3': '#858585' };
  }
  const h = t.hue ?? l.hue, s = t.sat ?? l.sat;
  return {
    '--oak': lookHsl(h, s, 0.075), '--oak-2': lookHsl(h, s, 0.1),
    '--rivet': lookHsl(h, s * 0.9, 0.135), '--rivet-2': lookHsl(h, s * 0.85, 0.175),
    '--hoop-dim': lookHsl(h, s * 0.5, 0.3), '--hoop': lookHsl(h, s * 0.35, 0.5),
    '--text': lookHsl(h, Math.min(30, s + 10), 0.93), '--text-2': lookHsl(h, Math.min(16, s), 0.74), '--text-3': lookHsl(h, Math.min(10, s), 0.57),
  };
}

function applyLook() {
  look = lookCfg();
  window.LOOK = look;
  const root = document.documentElement;
  const skin = SKINS[look.skin] || SKINS.barrel;
  const mode = skinMode(skin);
  const palette = mode ? skin.palettes[mode] : skin.palette;
  const vars = palette ? { ...palette } : themeVars(look);
  if (look.accentMode === 'fixed') vars['--amber'] = look.accent;
  else if (skin.accent) vars['--amber'] = skin.accent;
  if (look.voice) vars['--voice'] = look.voice;
  // extras.js → setTheme: палитра обложки не перекрашивает фон и акцент дизайнов со своими цветами;
  // на светлом фоне акцент из обложки темнее, а фон сцены — готовая размытая обложка (ambientFrom)
  window.SKIN_FIXED = !!palette;
  window.SKIN_ACCENT = !!skin.accent;
  window.SKIN_LIGHT = mode === 'light';
  window.SKIN_AMBIENT = !!skin.ambient;
  // Спектр и вращение пластинки дизайну не нужны — выключаем в том, что читают их циклы (app.js, scratch.js),
  // сами настройки не трогаем: в другом дизайне они вернутся
  if (skin.noViz || skin.noVinyl) {
    window.LOOK = { ...look, ...(skin.noViz ? { viz: false } : {}), ...(skin.noVinyl ? { vinyl: false, scratch: false } : {}) };
  }
  const display = skin.display && look.display === LOOK_DEFAULTS.display ? skin.display : look.display;
  const text = skin.text && look.text === LOOK_DEFAULTS.text ? skin.text : look.text;
  vars['--display'] = (FONTS[display] || FONTS.unbounded).css;
  vars['--ui'] = (FONTS[text] || FONTS.onest).css;
  vars['--lyrics-scale'] = String(look.lyricsSize / 100);
  vars['--wall-blur'] = `${look.wallBlur}px`;
  vars['--wall-dim'] = String(look.wallDim / 100);
  lookStyle.textContent = `:root { ${Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ')} }`;

  // Размер интерфейса: CSS zoom масштабирует всё сразу, и раскладка остаётся живой
  root.style.zoom = look.scale === 100 ? '' : String(look.scale / 100);
  root.style.setProperty('--ui-zoom', String(look.scale / 100)); // 100vh внутри zoom — в пикселях без него (styles.css, обложка «Стекла»)
  const cls = {
    ...Object.fromEntries(Object.keys(SKINS).filter((id) => id !== 'barrel').map((id) => [`skin-${id}`, look.skin === id])),
    'glass-light': mode === 'light', 'glass-dark': mode === 'dark',
    'look-compact': look.density === 'compact', 'look-cozy': look.density === 'cozy',
    'look-no-covers': !look.covers, 'look-no-album': !look.albumCol, 'look-no-time': !look.timeCol,
    'look-calm': look.motion === 'calm', 'look-still': look.motion === 'off',
    'look-no-viz': !look.viz, 'look-spin': look.spin,
    'look-port-rounded': look.porthole === 'rounded', 'look-port-square': look.porthole === 'square',
    'look-stage-cover': look.stageBg === 'cover', 'look-stage-flat': look.stageBg === 'flat',
    'look-wall': look.wallpaper && !!wallpaperUrl, 'look-lyrics-center': look.lyricsAlign === 'center',
    'look-lyrics-sharp': !look.lyricsBlur, 'look-no-badge': !look.badge,
    'look-react-cover': look.reactCover, 'look-react-glow': look.reactGlow, 'look-react-hoops': look.reactHoops,
    // префикс look-: классы на <html> не должны совпадать с классами элементов (у часов — .fs-clock)
    'look-fs-cinema': look.fsStyle === 'cinema', 'look-fs-gradient': look.fsBg === 'gradient', 'look-fs-plain': look.fsBg === 'plain',
    'look-fs-motion': look.fsMotion, 'look-fs-clock': look.fsClock, 'look-fs-no-lyrics': !look.fsLyrics,
    'dock-right': !IS_MOBILE && look.dock === 'right', 'dock-bottom': !IS_MOBILE && look.dock === 'bottom', 'dock-top': !IS_MOBILE && look.dock === 'top',
  };
  for (const [k, on] of Object.entries(cls)) root.classList.toggle(k, on);
  applyRadius((look.radius / 100) * (skin.radius || 1));
  requestAnimationFrame(() => moveSourceInk?.(true)); // app.js: вкладки то сверху, то слева
  applySources();
  reapplyTheme?.(); // extras.js: палитра из обложки знает, трогать ли акцент
}

// Скругления разбросаны по всем стилям числами, поэтому масштабируем их прямо в правилах
const radiusOrig = new Map();
function applyRadius(f) {
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    walkRules(rules, f);
  }
}
function walkRules(rules, f) {
  for (const r of rules) {
    if (r.cssRules) walkRules(r.cssRules, f);
    if (!r.style) continue;
    let orig = radiusOrig.get(r);
    if (orig === undefined) {
      orig = r.style.getPropertyValue('border-radius') || '';
      radiusOrig.set(r, orig);
    }
    if (!orig || /%|var\(/.test(orig)) continue;
    // 99px/999px — «таблетка», её оставляем круглой
    const scaled = orig.replace(/(\d*\.?\d+)px/g, (m, n) => (+n >= 99 ? m : `${(+n * f).toFixed(1)}px`));
    r.style.setProperty('border-radius', scaled, r.style.getPropertyPriority('border-radius'));
  }
}

// Вкладки библиотеки: свой порядок и скрытые
function sourceOrder() {
  const saved = (look.sources || []).filter((v) => VIEWS.includes(v));
  return [...saved, ...VIEWS.filter((v) => !saved.includes(v))];
}
function applySources() {
  const nav = $('#sources');
  if (!nav) return;
  for (const id of sourceOrder()) {
    const b = $(`.source[data-view="${id}"]`, nav);
    if (!b) continue;
    nav.appendChild(b);
    b.hidden = look.hidden.includes(id);
  }
  window.refitSources?.(); // app.js: что не влезло — в «ещё»
}

// Какую вкладку открыть при запуске (app.js → init)
function lookStartView(last) {
  const v = look.startView;
  const want = v && v !== 'last' && VIEWS.includes(v) ? v : last;
  if (!look.hidden.includes(want)) return want;
  return sourceOrder().find((id) => !look.hidden.includes(id)) || 'local';
}

// Сцена «размытая обложка»: картинка текущего трека (extras.js → applyThemeFrom)
function lookCover(url) {
  document.documentElement.style.setProperty('--cover-img', url ? `url("${String(url).replace(/"/g, '%22')}")` : 'none');
}

// ---------- своя картинка на фоне ----------

let wallpaperUrl = '';
const wallEl = document.createElement('div');
wallEl.className = 'look-wallpaper';
document.body.prepend(wallEl);

async function loadWallpaper() {
  try { wallpaperUrl = (await api.store.get('wallpaper'))?.url || ''; } catch { wallpaperUrl = ''; }
  wallEl.style.backgroundImage = wallpaperUrl ? `url("${wallpaperUrl}")` : '';
  applyLook();
}

// Картинку ужимаем до 1920 px по большей стороне, чтобы не хранить мегабайты
function pickWallpaper() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = () => {
    const file = inp.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = async () => {
      const k = Math.min(1, 1920 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.86);
      URL.revokeObjectURL(img.src);
      await api.store.set('wallpaper', { url });
      await saveLook({ wallpaper: true });
      await loadWallpaper();
      rerenderLook();
    };
    img.onerror = () => toast('Не получилось открыть картинку', true);
    img.src = URL.createObjectURL(file);
  };
  inp.click();
}

async function dropWallpaper() {
  await api.store.set('wallpaper', null);
  await saveLook({ wallpaper: false });
  await loadWallpaper();
  rerenderLook();
}

// ---------- сохранение ----------

async function saveLook(patch) {
  Object.assign(look, patch);
  if (state.cfg) state.cfg.look = { ...(state.cfg.look || {}), ...patch };
  applyLook(); // сразу видно, пока настройки сохраняются
  await saveCfg({ look: patch });
}

// Код оформления: всё, кроме картинки фона — можно отправить другу или перенести вручную
function lookCode() {
  const { wallpaper, ...rest } = lookCfg();
  return `AVL1.${btoa(unescape(encodeURIComponent(JSON.stringify(rest))))}`;
}
async function pasteLook() {
  const code = await ask({ title: 'Вставить код оформления', text: 'Код начинается с AVL1. Своя картинка фона останется как есть.', ok: 'Применить', value: '' });
  if (!code) return;
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(code.trim().replace(/^AVL1\./, '')))));
    const clean = Object.fromEntries(Object.entries(data).filter(([k]) => k in LOOK_DEFAULTS && k !== 'wallpaper'));
    await saveLook(clean);
    rerenderLook();
    toast('Оформление применено');
  } catch {
    toast('Это не код оформления', true);
  }
}

// ---------- раздел в настройках ----------

const seg = (key, opts, cur) => `<div class="seg" data-look-seg="${key}">${opts.map(([v, label]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
const sw = (key, label, on) => `<div class="field"><label>${label}</label><div class="ctl"><label class="switch"><input type="checkbox" data-look-bool="${key}" ${on ? 'checked' : ''} aria-label="${label}"><span></span></label></div></div>`;
const range = (key, label, min, max, step, val, unit) => `<div class="field"><label for="lk-${key}">${label}</label><div class="ctl">
  <input type="range" id="lk-${key}" data-look-range="${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${val}">
  <span class="val" data-look-val="${key}">${val}${unit}</span></div></div>`;

// Только на компьютере: где стоит плеер (остров, мини-плеер и прочее — в разделе «Остров и окна», desk.js)
function dockSection(l) {
  if (IS_MOBILE) return '';
  return `<section class="sec" data-sec="dock">
    <h3 class="sec-title">Где плеер</h3>
    <div class="field"><label>Плеер</label><div class="ctl">${seg('dock', [['left', 'Слева'], ['right', 'Справа'], ['bottom', 'Снизу'], ['top', 'Сверху']], l.dock)}</div></div>
  </section>`;
}

// Выбор дизайна: две карточки с маленьким макетом каждого
function skinSection(l) {
  const mock = (id) => `<span class="skin-mock is-${id}" aria-hidden="true">
    <span class="sm-rail"><i></i><i></i><i></i><i></i></span>
    <span class="sm-stage"><span class="sm-cover"></span><span class="sm-t"></span><span class="sm-a"></span><span class="sm-bar"></span><span class="sm-play"></span></span>
    <span class="sm-lib"><span class="sm-h"></span>${'<span class="sm-row"><i></i><b></b></span>'.repeat(5)}</span>
  </span>`;
  return `<section class="sec" data-sec="skin">
    <h3 class="sec-title">Дизайн</h3>
    <p class="sec-desc">Внешний вид всего плеера. Акцент, шрифты и остальное ниже работают во всех.</p>
    <div class="look-skins">${Object.entries(SKINS).map(([id, s]) => `<button class="look-skin${l.skin === id ? ' on' : ''}" data-skin="${id}">
      ${mock(id)}<span class="skin-name">${s.name}</span><small>${s.desc}</small></button>`).join('')}</div>
    ${SKINS[l.skin]?.palettes ? `<div class="field"><label>Тема</label><div class="ctl">${seg('glassMode', [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']], l.glassMode)}</div></div>` : ''}
  </section>`;
}

function lookSection() {
  const l = lookCfg();
  const order = sourceOrder();
  return `${skinSection(l)}${dockSection(l)}

  <section class="sec" data-sec="theme">
    <h3 class="sec-title">Тема</h3>
    <p class="sec-desc">Цвет фона всего плеера. «Фон в цвет обложки» ниже перекрашивает его под трек, пока тот играет.</p>
    <div class="look-themes">${Object.entries(THEMES).map(([id, t]) => {
      const v = themeVars({ ...l, theme: id });
      return `<button class="look-theme${l.theme === id ? ' on' : ''}" data-theme="${id}" style="--a:${v['--oak']};--b:${v['--rivet-2']};--c:${v['--hoop']}"><i></i><span>${t.name}</span></button>`;
    }).join('')}</div>
    <div class="sub-fields" ${l.theme === 'custom' ? '' : 'data-off'}>
      ${range('hue', 'Оттенок фона', 0, 359, 1, l.hue, '°')}
      ${range('sat', 'Насыщенность фона', 0, 60, 1, l.sat, '%')}
    </div>
    <div class="field"><label>Фон в цвет обложки</label><div class="ctl"><label class="switch"><input type="checkbox" id="tint-bg" ${(state.cfg.ui?.tintBg ?? !IS_MOBILE) ? 'checked' : ''} aria-label="Фон в цвет обложки"><span></span></label></div></div>
  </section>

  <section class="sec" data-sec="colors">
    <h3 class="sec-title">Цвета</h3>
    <div class="field"><label>Акцент</label><div class="ctl">${seg('accentMode', [['cover', 'Из обложки'], ['fixed', 'Свой']], l.accentMode)}</div></div>
    <div class="field" ${l.accentMode === 'fixed' ? '' : 'hidden'}><label>Цвет акцента</label><div class="ctl look-swatches">
      ${ACCENTS.map((c) => `<button class="look-swatch${c === l.accent ? ' on' : ''}" data-accent="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}
      <input type="color" id="look-accent" value="${esc(l.accent)}" aria-label="Свой цвет акцента">
    </div></div>
    <div class="field"><label>Цвет бочки и голосов</label><div class="ctl look-swatches">
      <button class="btn${l.voice ? '' : ' on'}" id="look-voice-auto">Сам</button>
      <input type="color" id="look-voice" value="${esc(l.voice || '#9aa8ff')}" aria-label="Цвет бочки">
    </div></div>
  </section>

  <section class="sec" data-sec="type">
    <h3 class="sec-title">Шрифты и размер</h3>
    <div class="field"><label>Заголовки</label><div class="ctl"><select class="input" data-look-select="display">${Object.entries(FONTS).map(([id, f]) => `<option value="${id}" ${l.display === id ? 'selected' : ''}>${f.name}</option>`).join('')}</select></div></div>
    <div class="field"><label>Текст</label><div class="ctl"><select class="input" data-look-select="text">${Object.entries(FONTS).map(([id, f]) => `<option value="${id}" ${l.text === id ? 'selected' : ''}>${f.name}</option>`).join('')}</select></div></div>
    ${range('scale', 'Размер интерфейса', 80, 130, 5, l.scale, '%')}
    ${range('radius', 'Скругления', 0, 200, 10, l.radius, '%')}
    <div class="field"><label>Названия треков как есть</label><div class="ctl"><label class="switch"><input type="checkbox" id="keep-titles" ${state.cfg.ui?.keepTitles ? 'checked' : ''} aria-label="Названия треков как есть"><span></span></label></div></div>
  </section>

  <section class="sec" data-sec="bg">
    <h3 class="sec-title">Фон</h3>
    <div class="field"><label>За бочкой</label><div class="ctl">${seg('stageBg', [['glow', 'Свечение'], ['cover', 'Обложка'], ['flat', 'Ровный']], l.stageBg)}</div></div>
    <div class="field"><label>Своя картинка</label><div class="ctl">
      <button class="btn" id="look-wall-pick"><svg><use href="#i-palette"/></svg>${l.wallpaper ? 'Сменить' : 'Выбрать'}</button>
      ${l.wallpaper ? '<button class="btn danger" id="look-wall-drop">Убрать</button>' : ''}
    </div></div>
    <div class="sub-fields" ${l.wallpaper ? '' : 'data-off'}>
      ${range('wallBlur', 'Размытие', 0, 60, 2, l.wallBlur, ' px')}
      ${range('wallDim', 'Затемнение', 0, 90, 5, l.wallDim, '%')}
    </div>
  </section>

  <section class="sec" data-sec="barrel">
    <h3 class="sec-title">Бочка</h3>
    <div class="field"><label>Обложка</label><div class="ctl">${seg('porthole', [['circle', 'Круг'], ['rounded', 'Скруглённая'], ['square', 'Квадрат']], l.porthole)}</div></div>
    ${sw('viz', 'Спектр вокруг бочки', l.viz)}
    <div class="sub-fields" ${l.viz ? '' : 'data-off'}>${range('vizPower', 'Длина лучей', 30, 250, 10, l.vizPower, '%')}</div>
    ${sw('spin', 'Обруч крутится, пока играет', l.spin)}
    ${sw('badge', 'Надпись «в бочке»', l.badge)}
    ${sw('vinyl', 'Обложка крутится как пластинка', l.vinyl)}
    ${sw('scratch', 'Скретч: схвати обложку и крути', l.scratch)}
  </section>

  <section class="sec" data-sec="react">
    <h3 class="sec-title">Реакция на звук</h3>
    <p class="sec-desc">Как сильно и как плавно всё отвечает на музыку: спектр вокруг бочки, остров, живые обои. Ниже — что ещё качает в такт.</p>
    ${range('reactGain', 'Чувствительность', 30, 300, 10, l.reactGain, '%')}
    ${range('reactSmooth', 'Плавность', 0, 90, 5, l.reactSmooth, '%')}
    ${sw('reactCover', 'Обложка пульсирует на басах', l.reactCover)}
    ${sw('reactGlow', 'Свечение за бочкой дышит', l.reactGlow)}
    ${sw('reactHoops', 'Обручи вздрагивают на басах', l.reactHoops)}
  </section>

  <section class="sec" data-sec="list">
    <h3 class="sec-title">Библиотека</h3>
    <div class="field"><label>Плотность списка</label><div class="ctl">${seg('density', [['compact', 'Плотно'], ['normal', 'Обычно'], ['cozy', 'Просторно']], l.density)}</div></div>
    ${sw('covers', 'Обложки в списке', l.covers)}
    ${IS_MOBILE ? '' : sw('albumCol', 'Колонка «альбом»', l.albumCol)}
    ${IS_MOBILE ? '' : sw('timeCol', 'Длительность', l.timeCol)}
    <div class="field"><label>При запуске открывать</label><div class="ctl"><select class="input" data-look-select="startView">
      <option value="last" ${l.startView === 'last' ? 'selected' : ''}>Где остановился</option>
      ${order.map((id) => `<option value="${id}" ${l.startView === id ? 'selected' : ''}>${esc(NAMES[id])}</option>`).join('')}
    </select></div></div>
    <p class="sec-desc">Вкладки: порядок стрелками, лишние можно спрятать.</p>
    <ol class="look-sources">${order.map((id, i) => `<li>
      <label class="switch small"><input type="checkbox" data-source-show="${id}" ${l.hidden.includes(id) ? '' : 'checked'} aria-label="Показывать «${esc(NAMES[id])}»"><span></span></label>
      <span class="look-src-name">${esc(NAMES[id])}</span>
      <button class="icon-btn small" data-source-move="${id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Выше"><svg style="transform:rotate(90deg)"><use href="#i-chevron-l"/></svg></button>
      <button class="icon-btn small" data-source-move="${id}" data-dir="1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Ниже"><svg style="transform:rotate(90deg)"><use href="#i-chevron-r"/></svg></button>
    </li>`).join('')}</ol>
  </section>

  <section class="sec" data-sec="fsmode">
    <h3 class="sec-title">Во весь экран</h3>
    <p class="sec-desc">Клавиша F или кнопка у плеера. «Кино» — обложка и текст крупно по центру, как в Apple Music.</p>
    <div class="field"><label>Вид</label><div class="ctl">${seg('fsStyle', [['classic', 'Обычный'], ['cinema', 'Кино']], l.fsStyle)}</div></div>
    <div class="field"><label>Фон</label><div class="ctl">${seg('fsBg', [['cover', 'Обложка'], ['gradient', 'Переливы'], ['plain', 'Ровный']], l.fsBg)}</div></div>
    ${sw('fsMotion', 'Фон медленно плывёт', l.fsMotion)}
    ${sw('fsLyrics', 'Текст песни', l.fsLyrics)}
    ${sw('fsClock', 'Часы в углу', l.fsClock)}
  </section>

  <section class="sec" data-sec="lyricslook">
    <h3 class="sec-title">Текст песни</h3>
    ${range('lyricsSize', 'Размер текста', 70, 160, 5, l.lyricsSize, '%')}
    <div class="field"><label>Выравнивание</label><div class="ctl">${seg('lyricsAlign', [['left', 'Слева'], ['center', 'По центру']], l.lyricsAlign)}</div></div>
    ${sw('lyricsBlur', 'Размывать неактивные строки', l.lyricsBlur)}
    ${sw('lyricsLetters', 'Заливать по буквам, если у текста есть время слов', l.lyricsLetters)}
  </section>

  <section class="sec" data-sec="motion">
    <h3 class="sec-title">Анимации и прочее</h3>
    <div class="field"><label>Анимации</label><div class="ctl">${seg('motion', [['full', 'Все'], ['calm', 'Спокойные'], ['off', 'Без анимаций']], l.motion)}</div></div>
    ${IS_MOBILE ? '' : `<div class="field"><label>Плашка звонка на сцене</label><div class="ctl"><label class="switch"><input type="checkbox" id="call-panel" ${state.cfg.ui?.callPanel !== false ? 'checked' : ''} aria-label="Плашка звонка на сцене"><span></span></label></div></div>`}
    ${IS_MOBILE ? '' : `<div class="field"><label>Прятать кнопки окна</label><div class="ctl"><label class="switch"><input type="checkbox" id="autohide-win" ${state.cfg.ui?.autoHideWin !== false ? 'checked' : ''} aria-label="Прятать кнопки окна"><span></span></label></div></div>`}
    <div class="row-actions">
      <button class="btn" id="look-copy"><svg><use href="#i-share"/></svg>Скопировать код оформления</button>
      <button class="btn" id="look-paste"><svg><use href="#i-code"/></svg>Вставить код</button>
      <button class="btn danger" id="look-reset">Сбросить всё</button>
    </div>
  </section>`;
}

// Перерисовать только разделы оформления, сохранив прокрутку
function rerenderLook() {
  const body = $('#settings-body');
  if (!body || $('#settings').hidden) return;
  const secs = $$('[data-look-root]', body);
  if (!secs.length) return;
  const top = body.scrollTop;
  const wrap = document.createElement('div');
  wrap.innerHTML = lookSection();
  const fresh = [...wrap.children];
  fresh.forEach((s) => { s.dataset.lookRoot = '1'; s.hidden = SEC_TAB[s.dataset.sec] !== settingsTab; });
  secs[0].before(...fresh);
  secs.forEach((s) => s.remove());
  bindLook(body);
  body.scrollTop = top;
}

function bindLook(body) {
  $$('[data-sec="skin"], [data-sec="dock"], [data-sec="theme"], [data-sec="colors"], [data-sec="type"], [data-sec="bg"], [data-sec="barrel"], [data-sec="react"], [data-sec="list"], [data-sec="lyricslook"], [data-sec="fsmode"], [data-sec="motion"]', body)
    .forEach((s) => { s.dataset.lookRoot = '1'; });

  $$('[data-skin]', body).forEach((b) => { b.onclick = async () => { await saveLook({ skin: b.dataset.skin }); rerenderLook(); }; });
  $$('[data-theme]', body).forEach((b) => { b.onclick = async () => { await saveLook({ theme: b.dataset.theme }); rerenderLook(); }; });
  $$('[data-look-seg]', body).forEach((g) => {
    $$('button', g).forEach((b) => { b.onclick = async () => { await saveLook({ [g.dataset.lookSeg]: b.dataset.v }); rerenderLook(); }; });
  });
  $$('[data-look-bool]', body).forEach((inp) => { inp.onchange = async () => { await saveLook({ [inp.dataset.lookBool]: inp.checked }); rerenderLook(); }; });
  $$('[data-look-select]', body).forEach((sel) => { sel.onchange = () => saveLook({ [sel.dataset.lookSelect]: sel.value }); });
  $$('[data-look-range]', body).forEach((inp) => {
    const key = inp.dataset.lookRange;
    inp.oninput = () => {
      $(`[data-look-val="${key}"]`, body).textContent = `${inp.value}${inp.dataset.unit}`;
      if (key !== 'scale') { Object.assign(look, { [key]: +inp.value }); state.cfg.look = { ...(state.cfg.look || {}), [key]: +inp.value }; applyLook(); }
    };
    inp.onchange = () => saveLook({ [key]: +inp.value }); // размер меняем по отпусканию — иначе ползунок уезжает из-под пальца
  });
  $$('[data-accent]', body).forEach((b) => { b.onclick = async () => { await saveLook({ accent: b.dataset.accent }); rerenderLook(); }; });
  const accent = $('#look-accent', body);
  if (accent) { accent.oninput = () => { look.accent = accent.value; state.cfg.look = { ...(state.cfg.look || {}), accent: accent.value }; applyLook(); }; accent.onchange = () => saveLook({ accent: accent.value }); }
  const voice = $('#look-voice', body);
  voice.oninput = () => { state.cfg.look = { ...(state.cfg.look || {}), voice: voice.value }; applyLook(); };
  voice.onchange = async () => { await saveLook({ voice: voice.value }); rerenderLook(); };
  $('#look-voice-auto', body).onclick = async () => { await saveLook({ voice: '' }); rerenderLook(); };

  $('#look-wall-pick', body).onclick = pickWallpaper;
  const drop = $('#look-wall-drop', body);
  if (drop) drop.onclick = dropWallpaper;

  $$('[data-source-show]', body).forEach((inp) => {
    inp.onchange = async () => {
      const id = inp.dataset.sourceShow;
      const hidden = inp.checked ? look.hidden.filter((x) => x !== id) : [...new Set([...look.hidden, id])];
      if (hidden.length >= VIEWS.length) { inp.checked = true; toast('Хотя бы одна вкладка должна остаться', true); return; }
      await saveLook({ hidden });
      if (hidden.includes(state.view)) openView(lookStartView('local'));
    };
  });
  $$('[data-source-move]', body).forEach((b) => {
    b.onclick = async () => {
      const order = sourceOrder();
      const i = order.indexOf(b.dataset.sourceMove);
      const j = i + +b.dataset.dir;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      await saveLook({ sources: order });
      rerenderLook();
    };
  });

  $('#tint-bg', body).onchange = (e) => {
    state.cfg.ui.tintBg = e.target.checked;
    reapplyTheme();
    saveCfg({ ui: { tintBg: e.target.checked } });
  };
  $('#keep-titles', body).onchange = (e) => {
    document.body.classList.toggle('keep-titles', e.target.checked);
    saveCfg({ ui: { keepTitles: e.target.checked } });
  };
  const callPanel = $('#call-panel', body);
  if (callPanel) callPanel.onchange = (e) => {
    state.cfg.ui.callPanel = e.target.checked; // renderCall (app.js) спрячет плашку сам
    saveCfg({ ui: { callPanel: e.target.checked } });
  };
  const autohide = $('#autohide-win', body);
  if (autohide) autohide.onchange = (e) => {
    state.cfg.ui.autoHideWin = e.target.checked;
    applyWinAutohide();
    saveCfg({ ui: { autoHideWin: e.target.checked } });
  };

  $('#look-copy', body).onclick = async () => {
    try { await api.copy(lookCode()); toast('Код оформления скопирован'); } catch (e) { toast(e.message, true); }
  };
  $('#look-paste', body).onclick = pasteLook;
  $('#look-reset', body).onclick = async () => {
    const ok = await ask({ title: 'Сбросить оформление?', text: 'Тема, цвета, шрифты, размеры и вкладки вернутся как было. Картинка фона уберётся.', ok: 'Сбросить', input: false, danger: true });
    if (ok === null) return;
    await api.store.set('wallpaper', null).catch(() => {});
    wallpaperUrl = '';
    wallEl.style.backgroundImage = '';
    await saveLook({ ...LOOK_DEFAULTS });
    rerenderLook();
  };
}

loadWallpaper();

// ---------- реакция на звук: басы и громкость → CSS (--beat, --level) ----------
// Считаем прямо из анализатора звука (app.js → fx.analyser), только пока что-то из этого включено
const reactBins = new Uint8Array(2048);
let beat = 0, level = 0;
let beatShown = '', levelShown = '';

// Общие для всех: чувствительность и сглаживание (спектр в app.js, остров в island-feed.js)
const reactGain = () => (window.LOOK?.reactGain ?? 100) / 100;
const reactSmooth = () => Math.min(0.95, (window.LOOK?.reactSmooth ?? 70) / 100);
function reactStep(prev, x) {
  const s = reactSmooth();
  return x > prev ? prev + (x - prev) * (1 - s * 0.6) : prev * s + x * (1 - s);
}

function reactLoop() {
  if (window.WIN_MOVING) { requestAnimationFrame(reactLoop); return; } // окно тащат — пульс замер (app.js)
  const on = look.reactCover || look.reactGlow || look.reactHoops;
  const root = document.documentElement.style;
  if (on && fx.analyser && !audio.paused && !document.hidden) {
    const data = reactBins.subarray(0, fx.analyser.frequencyBinCount);
    fx.analyser.getByteFrequencyData(data);
    let b = 0, sum = 0;
    for (let k = 1; k < 8; k++) b = Math.max(b, data[k]);
    for (let k = 0; k < 200; k++) sum += data[k];
    beat = reactStep(beat, Math.min(1, Math.pow(b / 255, 2.2) * reactGain()));
    level = reactStep(level, Math.min(1, (sum / 200 / 255) * 1.6 * reactGain()));
  } else {
    beat *= 0.85;
    level *= 0.85;
  }
  // В корень пишем, только когда число изменилось: каждая запись — пересчёт стилей всей страницы,
  // а при выключенной реакции значения затухают до нуля и дальше кадры ничего не стоят
  const b = beat.toFixed(3), lv = level.toFixed(3);
  if (b !== beatShown) { root.setProperty('--beat', b); beatShown = b; }
  if (lv !== levelShown) { root.setProperty('--level', lv); levelShown = lv; }
  requestAnimationFrame(reactLoop);
}
requestAnimationFrame(reactLoop);
