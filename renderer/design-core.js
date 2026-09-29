'use strict';
// Свой дизайн: каталог частей плеера, проверка дизайна и сборка CSS из него (редактор — designer.js,
// применение — look.js → applyLook). Без DOM: те же функции проверяют тесты в Node (scripts/design-core.test.js).
// В CSS попадают только значения, прошедшие cleanDesign: цвета #rrggbb или токены, числа в пределах,
// варианты из списков. Поэтому чужой код дизайна не может ни сломать разметку, ни загрузить что-то из сети.
(function (root) {
  const BASES = ['barrel', 'form', 'zen', 'glass'];
  const MAX_DESIGNS = 30;
  const CODE_PREFIX = 'AVD1.';
  const CODE_MAX = 32 * 1024;

  // Шрифты общие с настройками оформления (look.js → FONTS). kind — группа в выборе шрифта (designer.js),
  // files — стили @fontsource, которые look.js → ensureFont подключает, только когда шрифт выбран
  const FONTS = {
    unbounded: { name: 'Unbounded', kind: 'display', css: '"Unbounded", "Segoe UI", sans-serif' },
    manrope: { name: 'Manrope', kind: 'sans', css: '"Manrope", "Segoe UI", sans-serif' },
    jost: { name: 'Jost', kind: 'sans', css: '"Jost", "Segoe UI", sans-serif' },
    onest: { name: 'Onest', kind: 'sans', css: '"Onest", "Segoe UI", sans-serif' },
    inter: { name: 'Inter', kind: 'sans', css: '"Inter", "Segoe UI", sans-serif', files: ['inter/400', 'inter/500', 'inter/600', 'inter/700'] },
    montserrat: { name: 'Montserrat', kind: 'sans', css: '"Montserrat", "Segoe UI", sans-serif', files: ['montserrat/400', 'montserrat/500', 'montserrat/600', 'montserrat/700'] },
    rubik: { name: 'Rubik', kind: 'sans', css: '"Rubik", "Segoe UI", sans-serif', files: ['rubik/400', 'rubik/500', 'rubik/600', 'rubik/700'] },
    nunito: { name: 'Nunito', kind: 'sans', css: '"Nunito", "Segoe UI", sans-serif', files: ['nunito/400', 'nunito/500', 'nunito/600', 'nunito/700'] },
    comfortaa: { name: 'Comfortaa', kind: 'sans', css: '"Comfortaa", "Segoe UI", sans-serif', files: ['comfortaa/400', 'comfortaa/500', 'comfortaa/600', 'comfortaa/700'] },
    raleway: { name: 'Raleway', kind: 'sans', css: '"Raleway", "Segoe UI", sans-serif', files: ['raleway/400', 'raleway/500', 'raleway/600', 'raleway/700'] },
    exo2: { name: 'Exo 2', kind: 'sans', css: '"Exo 2", "Segoe UI", sans-serif', files: ['exo-2/400', 'exo-2/500', 'exo-2/600', 'exo-2/700'] },
    oswald: { name: 'Oswald', kind: 'sans', css: '"Oswald", "Segoe UI", sans-serif', files: ['oswald/400', 'oswald/500', 'oswald/600', 'oswald/700'] },
    ubuntu: { name: 'Ubuntu', kind: 'sans', css: '"Ubuntu", "Segoe UI", sans-serif', files: ['ubuntu/400', 'ubuntu/500', 'ubuntu/700'] },
    system: { name: 'Системный', kind: 'sans', css: 'system-ui, "Segoe UI", Roboto, sans-serif' },
    playfair: { name: 'Playfair Display', kind: 'serif', css: '"Playfair Display", Georgia, "Times New Roman", serif', files: ['playfair-display/400', 'playfair-display/500', 'playfair-display/600', 'playfair-display/700'] },
    ptserif: { name: 'PT Serif', kind: 'serif', css: '"PT Serif", Georgia, "Times New Roman", serif', files: ['pt-serif/400', 'pt-serif/700'] },
    robotoslab: { name: 'Roboto Slab', kind: 'serif', css: '"Roboto Slab", Georgia, "Times New Roman", serif', files: ['roboto-slab/400', 'roboto-slab/500', 'roboto-slab/600', 'roboto-slab/700'] },
    lora: { name: 'Lora', kind: 'serif', css: '"Lora", Georgia, "Times New Roman", serif', files: ['lora/400', 'lora/500', 'lora/600', 'lora/700'] },
    yeseva: { name: 'Yeseva One', kind: 'serif', css: '"Yeseva One", Georgia, "Times New Roman", serif', files: ['yeseva-one/400'] },
    serif: { name: 'Georgia', kind: 'serif', css: 'Georgia, "Times New Roman", "Noto Serif", serif' },
    jetbrains: { name: 'JetBrains Mono', kind: 'mono', css: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace', files: ['jetbrains-mono/400', 'jetbrains-mono/500', 'jetbrains-mono/600', 'jetbrains-mono/700'] },
    firacode: { name: 'Fira Code', kind: 'mono', css: '"Fira Code", "Cascadia Mono", Consolas, monospace', files: ['fira-code/400', 'fira-code/500', 'fira-code/600', 'fira-code/700'] },
    mono: { name: 'Cascadia Mono', kind: 'mono', css: '"Cascadia Mono", Consolas, "Roboto Mono", monospace' },
    russo: { name: 'Russo One', kind: 'display', css: '"Russo One", "Segoe UI", sans-serif', files: ['russo-one/400'] },
    pixel: { name: 'Press Start 2P', kind: 'display', css: '"Press Start 2P", "Segoe UI", sans-serif', files: ['press-start-2p/400'] },
    lobster: { name: 'Lobster', kind: 'display', css: '"Lobster", "Segoe UI", sans-serif', files: ['lobster/400'] },
    pacifico: { name: 'Pacifico', kind: 'display', css: '"Pacifico", "Segoe UI", sans-serif', files: ['pacifico/400'] },
    caveat: { name: 'Caveat', kind: 'display', css: '"Caveat", "Segoe UI", sans-serif', files: ['caveat/400', 'caveat/500', 'caveat/600', 'caveat/700'] },
    marck: { name: 'Marck Script', kind: 'display', css: '"Marck Script", "Segoe UI", sans-serif', files: ['marck-script/400'] },
  };
  const FONT_KINDS = [['sans', 'Без засечек'], ['serif', 'С засечками'], ['mono', 'Моноширинные'], ['display', 'Особые']];

  // Палитра — те же переменные, что у готовых дизайнов, без «--». Первые девять — фон и текст:
  // если задан хоть один, палитра из обложки фон больше не перекрашивает (look.js → SKIN_FIXED)
  const PALETTE = [
    ['oak', 'Фон окна'], ['oak-2', 'Сцена'], ['rivet', 'Поверхности'], ['rivet-2', 'Поверхности ярче'],
    ['hoop-dim', 'Линии'], ['hoop', 'Обручи'], ['text', 'Текст'], ['text-2', 'Текст тише'], ['text-3', 'Подписи'],
    ['amber', 'Акцент'], ['voice', 'Голоса и бочка'], ['danger', 'Ошибки'],
  ];
  const BG_KEYS = PALETTE.slice(0, 9).map(([k]) => k);

  // Цвет части: свой #rrggbb или токен — цвет, который меняется вместе с темой и обложкой
  const TOKENS = [
    ['accent', 'Акцент', '--amber'], ['voice', 'Голоса', '--voice'], ['text', 'Текст', '--text'],
    ['text-3', 'Подписи', '--text-3'], ['bg', 'Фон', '--oak'], ['surface', 'Поверхность', '--rivet'],
  ];
  const HEX = /^#[0-9a-f]{6}$/i;

  const SHADOWS = {
    none: 'none', soft: '0 6px 18px rgb(0 0 0 / .25)', strong: '0 18px 50px rgb(0 0 0 / .55)',
    glow: '0 0 28px color-mix(in srgb, var(--amber) 60%, transparent)',
  };
  const TEXT_SHADOWS = {
    none: 'none', soft: '0 1px 3px rgb(0 0 0 / .35)', strong: '0 2px 10px rgb(0 0 0 / .6)', glow: '0 0 14px var(--amber)',
  };

  const PROPS = {
    color: { label: 'Цвет', type: 'color' },
    track: { label: 'Дорожка', type: 'color' },
    fill: { label: 'Фон', type: 'fill' },
    opacity: { label: 'Плотность фона', type: 'range', min: 0, max: 100, step: 5, unit: '%', def: 100 },
    radius: { label: 'Скругление', type: 'range', min: 0, max: 100, step: 5, unit: '%', def: 30 },
    size: { label: 'Размер', type: 'range', min: 50, max: 200, step: 5, unit: '%', def: 100 },
    font: { label: 'Шрифт', type: 'enum', options: Object.entries(FONTS).map(([id, f]) => [id, f.name]) },
    weight: { label: 'Толщина', type: 'enum', options: [['300', 'Тонкий'], ['400', 'Обычный'], ['500', 'Средний'], ['600', 'Полужирный'], ['700', 'Жирный'], ['800', 'Чёрный']] },
    align: { label: 'Выравнивание', type: 'enum', options: [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']] },
    caps: { label: 'Заглавными', type: 'bool' },
    shadow: { label: 'Тень', type: 'enum', options: [['none', 'Нет'], ['soft', 'Мягкая'], ['strong', 'Сильная'], ['glow', 'Свечение']] },
    border: { label: 'Рамка', type: 'border' },
    hidden: { label: 'Скрыть', type: 'bool' },
    move: { label: 'Сдвиг', type: 'move' }, // { x, y } в px — тянут саму часть на плеере (designer.js)
  };

  const GROUPS = [
    { id: 'window', name: 'Окно' },
    { id: 'stage', name: 'Сцена', sel: '.stage' },
    { id: 'library', name: 'Библиотека', sel: '.library' },
  ];

  // block — прямой ребёнок сцены или библиотеки: его можно двигать выше и ниже (CSS order, обе — колонки flex).
  // parent — часть внутри блока. pick: false — кликом не выбрать (тот же элемент, что у соседней части).
  // round: 'pct' — скругление в процентах (100 — круг), иначе в px (100 — таблетка). text — тень для текста.
  // map — своё превращение свойства в CSS: [подселектор, объявления][]; цвету приходит уже готовый CSS-цвет
  const PARTS = [
    { id: 'stagebg', group: 'window', name: 'Фон сцены', sel: '.stage', props: ['fill', 'opacity'] },
    { id: 'libbg', group: 'window', name: 'Фон библиотеки', sel: '.library', props: ['fill', 'opacity'] },

    { id: 'top', group: 'stage', block: true, name: 'Шапка «авеон»', sel: '.stage-top', props: ['color', 'size', 'hidden'] },
    { id: 'barrel', group: 'stage', block: true, name: 'Бочка', sel: '.barrel', props: ['size', 'hidden'] },
    { id: 'cover', group: 'stage', parent: 'barrel', name: 'Обложка', sel: '.porthole', props: ['radius', 'shadow', 'border'], round: 'pct' },
    { id: 'hoops', group: 'stage', parent: 'barrel', name: 'Обручи', sel: '.hoops', props: ['color', 'hidden'],
      map: { color: (c) => [[' .hoop', `stroke: ${c}`]] } },
    { id: 'viz', group: 'stage', parent: 'barrel', name: 'Спектр', sel: '.viz', props: ['hidden'] },
    { id: 'badge', group: 'stage', parent: 'barrel', name: 'Надпись «в бочке»', sel: '.in-barrel', props: ['color', 'fill', 'hidden'] },
    { id: 'now', group: 'stage', block: true, name: 'Название и артист', sel: '.now', props: ['align', 'hidden'] },
    { id: 'title', group: 'stage', parent: 'now', name: 'Название трека', sel: '.now-title', props: ['color', 'size', 'font', 'weight', 'caps', 'shadow', 'hidden'], text: true },
    { id: 'artist', group: 'stage', parent: 'now', name: 'Артист', sel: '.now-artist', props: ['color', 'size', 'font', 'weight', 'caps', 'hidden'] },
    { id: 'together', group: 'stage', block: true, name: 'Слушать вместе', sel: '.together-chip', props: ['color', 'fill', 'radius', 'hidden'] },
    { id: 'seek', group: 'stage', block: true, name: 'Перемотка', sel: '.progress-row', props: ['color', 'track', 'size', 'hidden'], labels: { color: 'Заливка' },
      map: { color: (c) => [[' .slider-fill', `background: ${c}`]], track: (c) => [[' .slider::before', `background: ${c}`]] } },
    { id: 'time', group: 'stage', parent: 'seek', name: 'Время', sel: '.progress-row .time', props: ['color', 'size', 'font'] },
    { id: 'controls', group: 'stage', block: true, name: 'Кнопки управления', sel: '.controls', props: ['color', 'size', 'hidden'], labels: { color: 'Цвет значков' },
      map: { color: (c) => [[' .icon-btn', `color: ${c}`]] } },
    { id: 'play', group: 'stage', parent: 'controls', name: 'Кнопка «играть»', sel: '.controls .play-btn', props: ['color', 'fill', 'opacity', 'radius', 'size', 'shadow', 'border'], round: 'pct' },
    { id: 'volume', group: 'stage', block: true, name: 'Громкость и кнопки', sel: '.volume-row', props: ['color', 'hidden'], labels: { color: 'Цвет' },
      map: { color: (c) => [[' .icon-btn', `color: ${c}`], [' .slider-fill', `background: ${c}`]] } },
    { id: 'foot', group: 'stage', block: true, name: 'Звонок и аккаунт', sel: '.stage-foot', props: ['hidden'] },
    { id: 'call', group: 'stage', parent: 'foot', name: 'Звонок Discord', sel: '.call', props: ['fill', 'opacity', 'radius', 'border', 'hidden'] },
    { id: 'account', group: 'stage', parent: 'foot', name: 'Аккаунт', sel: '.stage-account', props: ['color'] },

    { id: 'tabs', group: 'library', block: true, name: 'Вкладки', sel: '.lib-top', props: [] },
    { id: 'tab', group: 'library', parent: 'tabs', name: 'Вкладка', sel: '.source', props: ['color', 'size', 'font', 'weight', 'caps'] },
    { id: 'friends', group: 'library', parent: 'tabs', name: 'Кнопка «Друзья»', sel: '#open-friends', props: ['color', 'fill', 'opacity', 'radius', 'border', 'hidden'], round: 'pct' },
    { id: 'tabon', group: 'library', parent: 'tabs', name: 'Выбранная вкладка', sel: '.source.active', props: ['color', 'fill', 'radius'], pick: false,
      map: { color: (c) => [['', `color: ${c}`], ['::after', `background: ${c}`]] } },
    { id: 'search', group: 'library', block: true, name: 'Поиск', sel: '.search', props: ['color', 'fill', 'opacity', 'radius', 'border', 'hidden'] },
    { id: 'shelf', group: 'library', block: true, name: 'Плейлисты', sel: '.collections-wrap', props: ['hidden'] },
    { id: 'head', group: 'library', block: true, name: 'Заголовок раздела', sel: '.lib-head', props: ['hidden'] },
    { id: 'h1', group: 'library', parent: 'head', name: 'Название раздела', sel: '.lib-head h1', props: ['color', 'size', 'font', 'weight', 'caps', 'shadow'], text: true },
    { id: 'list', group: 'library', block: true, name: 'Список треков', sel: ':is(.tracklist, .empty)', props: [] },
    { id: 'row', group: 'library', parent: 'list', name: 'Строка трека', sel: '.row', props: ['fill', 'opacity', 'radius', 'border'] },
    { id: 'rowhover', group: 'library', parent: 'list', name: 'Строка под курсором', sel: '.row:hover', props: ['fill', 'opacity'], pick: false },
    { id: 'rowplaying', group: 'library', parent: 'list', name: 'Играющая строка', sel: '.row.playing', props: ['fill', 'opacity', 'color'], pick: false, labels: { color: 'Цвет названия' },
      map: { color: (c) => [[' .t-title', `color: ${c}`]] } },
    { id: 'rowcover', group: 'library', parent: 'list', name: 'Обложка в строке', sel: '.row .num', props: ['radius'] },
    { id: 'rtitle', group: 'library', parent: 'list', name: 'Название в строке', sel: '.row .t-title', props: ['color', 'size', 'font', 'weight'] },
    { id: 'rartist', group: 'library', parent: 'list', name: 'Артист в строке', sel: '.row .t-artist', props: ['color', 'size'] },
    { id: 'rtime', group: 'library', parent: 'list', name: 'Длительность', sel: '.row .col-time', props: ['color', 'hidden'] },
  ];
  // Сдвинуть и увеличить (Shift + колесо на плеере) можно любую часть, кроме фонов окна (это целые колонки)
  // и состояний вроде «строка под курсором»
  for (const p of PARTS) {
    if (p.group === 'window' || p.pick === false || p.sel.includes(':hover')) continue;
    // добавленный размер — через scale: zoom не увеличивает то, чему размер задан в процентах (обложка и т. п.)
    if (!p.props.includes('size')) { p.props.push('size'); p.scaleSize = true; }
    p.props.push('move');
  }
  const PART_BY_ID = new Map(PARTS.map((p) => [p.id, p]));

  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined);

  function cleanColor(v) {
    if (typeof v !== 'string') return undefined;
    if (HEX.test(v)) return v.toLowerCase();
    return TOKENS.some(([t]) => t === v) ? v : undefined;
  }
  const colorCss = (v) => (HEX.test(v) ? v : `var(${TOKENS.find(([t]) => t === v)[2]})`);

  function cleanProp(prop, v) {
    const def = PROPS[prop];
    switch (def.type) {
      case 'color': return cleanColor(v);
      case 'range': return num(v, def.min, def.max);
      case 'enum': return typeof v === 'string' && def.options.some(([o]) => o === v) ? v : undefined;
      case 'bool': return v === true ? true : undefined;
      case 'fill': {
        if (!isObj(v)) return undefined;
        if (v.kind === 'none') return { kind: 'none' };
        const a = cleanColor(v.a);
        if (!a) return undefined;
        if (v.kind === 'solid') return { kind: 'solid', a };
        const b = cleanColor(v.b);
        if (v.kind === 'gradient' && b) return { kind: 'gradient', a, b, angle: num(v.angle, 0, 360) ?? 180 };
        return undefined;
      }
      case 'border': {
        if (!isObj(v)) return undefined;
        const w = num(v.w, 0, 4), c = cleanColor(v.c);
        return w && c ? { w, c } : undefined;
      }
      case 'move': {
        if (!isObj(v)) return undefined;
        const x = num(v.x, -3000, 3000) || 0, y = num(v.y, -3000, 3000) || 0;
        return x || y ? { x, y } : undefined;
      }
      default: return undefined;
    }
  }

  function newDesignId() {
    let id = '';
    while (id.length < 8) id += Math.random().toString(36).slice(2);
    return id.slice(0, 8);
  }

  // Дизайн из чего угодно (конфиг, код от друга, черновик редактора): только известные поля и допустимые значения
  function cleanDesign(raw) {
    const r = isObj(raw) ? raw : {};
    const d = {
      id: typeof r.id === 'string' && /^[a-z0-9]{4,12}$/.test(r.id) ? r.id : newDesignId(),
      name: (typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '') || 'Мой дизайн',
      base: BASES.includes(r.base) ? r.base : 'barrel',
      palette: {},
      accentFromCover: r.accentFromCover !== false,
      fonts: { display: '', text: '' },
      radius: num(r.radius, 0, 250) ?? 100,
      parts: {},
      order: {},
    };
    const pal = isObj(r.palette) ? r.palette : {};
    for (const [k] of PALETTE) {
      if (own(pal, k) && typeof pal[k] === 'string' && HEX.test(pal[k])) d.palette[k] = pal[k].toLowerCase();
    }
    const fonts = isObj(r.fonts) ? r.fonts : {};
    for (const k of ['display', 'text']) {
      if (typeof fonts[k] === 'string' && own(FONTS, fonts[k])) d.fonts[k] = fonts[k];
    }
    const parts = isObj(r.parts) ? r.parts : {};
    for (const part of PARTS) {
      if (!own(parts, part.id) || !isObj(parts[part.id])) continue;
      const vals = parts[part.id], out = {};
      for (const p of part.props) {
        if (!own(vals, p)) continue;
        const v = cleanProp(p, vals[p]);
        if (v !== undefined) out[p] = v;
      }
      if (Object.keys(out).length) d.parts[part.id] = out;
    }
    const order = isObj(r.order) ? r.order : {};
    for (const g of GROUPS) {
      if (!g.sel || !own(order, g.id) || !Array.isArray(order[g.id])) continue;
      const ids = [...new Set(order[g.id].filter((id) => PART_BY_ID.get(id)?.block && PART_BY_ID.get(id).group === g.id))];
      if (ids.length) d.order[g.id] = ids;
    }
    return d;
  }

  // Блоки группы по порядку дизайна: сначала переставленные, остальные — как в разметке
  function orderedBlocks(design, group) {
    const blocks = PARTS.filter((p) => p.block && p.group === group);
    const saved = (design.order?.[group] || []).map((id) => blocks.find((b) => b.id === id)).filter(Boolean);
    return [...saved, ...blocks.filter((b) => !saved.includes(b))];
  }

  // :not(#_) поднимает правила до уровня id: они перебивают стили основ (html.skin-form .row…) без !important,
  // а инлайн-стили скриптов (--m, скретч, анимации) остаются главнее
  const SCOPE = 'html.skin-design:not(#_)';

  function fillCss(f, opacity) {
    if (f.kind === 'none') return 'none';
    const mix = (c) => (opacity == null || opacity >= 100 ? colorCss(c) : `color-mix(in srgb, ${colorCss(c)} ${opacity}%, transparent)`);
    return f.kind === 'solid' ? mix(f.a) : `linear-gradient(${f.angle}deg, ${mix(f.a)}, ${mix(f.b)})`;
  }
  function radiusCss(part, v) {
    if (part.round === 'pct') return v >= 100 ? '50%' : `${v / 2}%`;
    return v >= 100 ? '999px' : `${Math.round(v * 0.4)}px`;
  }
  function propCss(part, prop, v, vals) {
    const custom = part.map?.[prop];
    if (custom) return custom(PROPS[prop].type === 'color' ? colorCss(v) : v);
    switch (prop) {
      case 'color': return [['', `color: ${colorCss(v)}`]];
      case 'fill': return [['', `background: ${fillCss(v, vals.opacity)}`]];
      case 'radius': return [['', `border-radius: ${radiusCss(part, v)}`]];
      case 'size': return [['', part.scaleSize ? `scale: ${v / 100}` : `zoom: ${v / 100}`]];
      case 'font': return [['', `font-family: ${FONTS[v].css}`]];
      case 'weight': return [['', `font-weight: ${v}`]];
      case 'align': return [['', `text-align: ${v}`]];
      case 'caps': return [['', 'text-transform: uppercase; letter-spacing: .04em']];
      case 'shadow': return [['', part.text ? `text-shadow: ${TEXT_SHADOWS[v]}` : `box-shadow: ${SHADOWS[v]}`]];
      case 'border': return [['', `outline: ${v.w}px solid ${colorCss(v.c)}; outline-offset: -${v.w}px`]];
      case 'hidden': return [['', 'display: none']];
      case 'move': return [['', `translate: ${v.x}px ${v.y}px`]];
      default: return []; // opacity — внутри fill
    }
  }

  function designCss(design) {
    const d = cleanDesign(design);
    const rules = [];
    for (const g of GROUPS) {
      if (!g.sel || !d.order[g.id]) continue;
      // всё, чего нет в каталоге (добавленное скриптами), — в конец группы
      rules.push(`${SCOPE} ${g.sel} > * { order: 100; }`);
      orderedBlocks(d, g.id).forEach((b, i) => rules.push(`${SCOPE} ${g.sel} > ${b.sel} { order: ${i + 1}; }`));
    }
    for (const part of PARTS) {
      const vals = d.parts[part.id];
      if (!vals) continue;
      for (const [prop, v] of Object.entries(vals)) {
        for (const [sub, decl] of propCss(part, prop, v, vals)) rules.push(`${SCOPE} ${part.sel}${sub} { ${decl}; }`);
      }
    }
    return rules.join('\n');
  }

  const paletteVars = (d) => Object.fromEntries(Object.entries(d.palette).map(([k, v]) => [`--${k}`, v]));
  const fixesBg = (d) => BG_KEYS.some((k) => d.palette[k]);

  // Код дизайна: AVD1. + base64 от JSON без id. Мессенджеры режут длинные строки — пробелы и переносы пропускаем
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const unb64 = (s) => decodeURIComponent(escape(atob(s)));
  function designCode(design) {
    const { id, ...rest } = cleanDesign(design);
    return CODE_PREFIX + b64(JSON.stringify(rest));
  }
  function readDesignCode(code) {
    const s = String(code ?? '').replace(/\s+/g, '');
    if (!s.startsWith(CODE_PREFIX) || s.length > CODE_MAX) return null;
    try {
      const raw = JSON.parse(unb64(s.slice(CODE_PREFIX.length)));
      if (!isObj(raw)) return null;
      const { id, ...rest } = raw;
      return cleanDesign(rest);
    } catch {
      return null;
    }
  }

  const api = {
    BASES, MAX_DESIGNS, CODE_PREFIX, FONTS, FONT_KINDS, PALETTE, TOKENS, PROPS, GROUPS, PARTS,
    newDesignId, cleanDesign, orderedBlocks, designCss, paletteVars, fixesBg, designCode, readDesignCode,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DesignCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
