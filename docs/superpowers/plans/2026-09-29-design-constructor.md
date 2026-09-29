# Конструктор своего дизайна — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Юзер без кода собирает свой дизайн плеера: палитра, шрифты, скругления и настройки каждой части плеера, выбранной кликом или из списка. Дизайн синхронизируется через аккаунт, делиться им можно кодом `AVD1.`.

**Architecture:** Чистый модуль `renderer/design-core.js` держит каталог частей и свойств, очищает дизайн и собирает из него CSS. Он работает без DOM и покрыт тестами `node --test`. `renderer/look.js` применяет активный дизайн (или черновик редактора) в `applyLook` и показывает карточки «Мои дизайны». `renderer/designer.js` — панель редактора и выбор части кликом. Дизайны лежат в `config.look.designs`, который уже синхронизируется через аккаунт.

**Tech Stack:** Electron 44 (Chromium), обычные `<script>` без сборки (общие глобальные между файлами), CSS-переменные, Node `node:test` для тестов ядра.

**Spec:** `docs/superpowers/specs/2026-09-29-design-constructor-design.md`

## Global Constraints

- Весь текст интерфейса и комментарии в коде — на русском, в стиле соседнего кода: короткие комментарии «зачем», без лишнего.
- Новых зависимостей не добавлять.
- Только главное окно на компьютере. Телефон (Android/Compose) не трогаем.
- До 30 дизайнов (`MAX_DESIGNS = 30`). Код дизайна — до 32 КБ (`CODE_MAX = 32 * 1024`), префикс `AVD1.`.
- Каждое сгенерированное CSS-правило начинается с `html.skin-design:not(#_) `.
- Цвет в дизайне — только `#rrggbb` или токен из `TOKENS`. Остальные значения — числа в пределах или варианты из списков.
- В рабочей копии лежат чужие незакоммиченные правки (`renderer/island.css`, `renderer/island.js`, `*.bak`, `.playwright-mcp/`). Их не коммитить: `git add` только файлы задачи.
- Коммиты: короткое сообщение на русском, как в `git log`, без строки `Co-Authored-By`.

## Review Focus

1. Код дизайна прислали через мессенджер с переносами строк или пробелами внутри → он должен читаться. Тест — в задаче 1 («код с пробелами и переносами»).
2. Активный дизайн удалили на другом устройстве, и пришла синхронизация → плеер показывает дизайн по умолчанию и не падает. Ручная проверка в задаче 2, шаг 4.
3. Юзер в редакторе жмёт Esc, пока открыт диалог «Выйти без сохранения?» → закрывается только диалог, редактор остаётся. Ручная проверка в задаче 4, шаг 7, пункт 6.
4. Размер интерфейса не 100 % (зум на `<html>`) → рамка выбора части стоит ровно на части. Ручная проверка в задаче 4, шаг 7, пункт 7.
5. Вставлен старый код оформления `AVL1.` с мусором в `designs` → мусор очищается и не больше 30 дизайнов. Ручная проверка в задаче 3, шаг 5; очистку `cleanDesign` покрывает тест задачи 1.

---

### Task 1: Ядро — каталог, очистка, CSS, коды

**Files:**
- Create: `renderer/design-core.js`
- Create: `scripts/design-core.test.js`
- Modify: `package.json` (скрипт `test:design`)

**Interfaces:**
- Consumes: ничего.
- Produces: глобальный `DesignCore` (в Node — `module.exports`) с полями:
  - `BASES: string[]` — `['barrel','form','zen','glass']`
  - `MAX_DESIGNS: 30`, `CODE_PREFIX: 'AVD1.'`
  - `FONTS: { [id]: { name, css } }`
  - `PALETTE: [key, label][]` — ключи без `--`
  - `TOKENS: [id, label, cssVar][]`
  - `PROPS: { [prop]: { label, type, min?, max?, step?, unit?, def?, options? } }`
  - `GROUPS: { id, name, sel? }[]`
  - `PARTS: { id, group, name, sel, props, block?, parent?, pick?, round?, text?, labels?, map? }[]`
  - `newDesignId(): string` — 8 символов `[a-z0-9]`
  - `cleanDesign(raw): Design`
  - `orderedBlocks(design, groupId): Part[]`
  - `designCss(design): string`
  - `paletteVars(design): { '--oak': '#…', … }`
  - `fixesBg(design): boolean`
  - `designCode(design): string`
  - `readDesignCode(code): Design | null`
  - `Design = { id, name, base, palette, accentFromCover, fonts: { display, text }, radius, parts, order }`

- [ ] **Step 1: Написать тесты**

`scripts/design-core.test.js`:

```js
'use strict';
// Ядро своего дизайна (renderer/design-core.js): очистка, CSS и коды. Запуск: npm run test:design
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/design-core.js');

const SCOPE = 'html.skin-design:not(#_) ';

test('пустой вход — пустой дизайн на «Бочке»', () => {
  const d = D.cleanDesign(null);
  assert.match(d.id, /^[a-z0-9]{8}$/);
  assert.equal(d.name, 'Мой дизайн');
  assert.equal(d.base, 'barrel');
  assert.deepEqual(d.palette, {});
  assert.deepEqual(d.fonts, { display: '', text: '' });
  assert.equal(d.radius, 100);
  assert.equal(d.accentFromCover, true);
  assert.deepEqual(d.parts, {});
  assert.deepEqual(d.order, {});
});

test('cleanDesign выкидывает неизвестное и битое, числа — в пределы', () => {
  const d = D.cleanDesign({
    id: 'BAD ID', name: '  x'.repeat(50), base: 'nope',
    palette: { oak: '#ABCDEF', text: 'red', 'oak-2': '#fff', evil: '#000000' },
    fonts: { display: 'jost', text: 'comic' }, radius: 9999,
    parts: {
      cover: { radius: 250, shadow: 'glow', color: '#ffffff', evil: 1 },
      nope: { color: '#000000' },
      play: { fill: { kind: 'solid', a: 'red; background:url(http://x)' } },
      title: { color: 'accent', size: -5, caps: 'yes' },
      __proto__: { hidden: true },
    },
    order: { stage: ['now', 'now', 'cover', 'x', 'barrel'], library: 'list' },
  });
  assert.match(d.id, /^[a-z0-9]{8}$/);
  assert.equal(d.name.length, 40);
  assert.equal(d.base, 'barrel');
  assert.deepEqual(d.palette, { oak: '#abcdef' });
  assert.deepEqual(d.fonts, { display: 'jost', text: '' });
  assert.equal(d.radius, 250);
  assert.deepEqual(d.parts, { cover: { radius: 100, shadow: 'glow' }, title: { color: 'accent', size: 50 } });
  assert.deepEqual(d.order, { stage: ['now', 'barrel'] });
});

test('designCss: всё под html.skin-design:not(#_), значения по каталогу', () => {
  const css = D.designCss({
    parts: {
      cover: { radius: 100, border: { w: 2, c: 'accent' } },
      play: { fill: { kind: 'gradient', a: '#112233', b: 'voice', angle: 90 }, opacity: 50 },
      title: { hidden: true },
      seek: { color: '#ff0000' },
    },
  });
  for (const line of css.split('\n')) assert.ok(line.startsWith(SCOPE), line);
  assert.ok(css.includes(`${SCOPE}.porthole { border-radius: 50%; }`));
  assert.ok(css.includes(`${SCOPE}.porthole { outline: 2px solid var(--amber); outline-offset: -2px; }`));
  assert.ok(css.includes('linear-gradient(90deg, color-mix(in srgb, #112233 50%, transparent), color-mix(in srgb, var(--voice) 50%, transparent))'));
  assert.ok(css.includes(`${SCOPE}.now-title { display: none; }`));
  assert.ok(css.includes(`${SCOPE}.progress-row .slider-fill { background: #ff0000; }`));
});

test('designCss не пропускает подсунутые строки', () => {
  const evil = 'red;}body{background:url(https://evil.example/x.png)} @import "x";';
  const css = D.designCss({
    name: evil, palette: { oak: evil },
    parts: {
      title: { color: evil, font: evil, weight: evil, shadow: evil },
      play: { fill: { kind: 'solid', a: evil }, border: { w: 2, c: evil } },
    },
    order: { stage: [evil] },
  });
  assert.equal(css, '');
});

test('порядок блоков: сохранённые первыми, остальные следом', () => {
  const css = D.designCss({ order: { stage: ['controls', 'barrel'] } });
  assert.ok(css.includes(`${SCOPE}.stage > * { order: 100; }`));
  assert.ok(css.includes(`${SCOPE}.stage > .controls { order: 1; }`));
  assert.ok(css.includes(`${SCOPE}.stage > .barrel { order: 2; }`));
  assert.ok(css.includes(`${SCOPE}.stage > .stage-top { order: 3; }`));
  assert.ok(!css.includes('.library > *'));
  assert.deepEqual(D.orderedBlocks({ order: {} }, 'library').map((p) => p.id), ['tabs', 'search', 'shelf', 'head', 'list']);
});

test('код дизайна туда и обратно', () => {
  const d = D.cleanDesign({ name: 'Ночной неон', base: 'glass', palette: { amber: '#ff3da6' }, parts: { cover: { radius: 40 } }, order: { library: ['list'] } });
  const code = D.designCode(d);
  assert.ok(code.startsWith('AVD1.'));
  const back = D.readDesignCode(code);
  const { id: _a, ...want } = d;
  const { id: newId, ...got } = back;
  assert.deepEqual(got, want);
  assert.match(newId, /^[a-z0-9]{8}$/);
});

test('код с пробелами и переносами внутри читается', () => {
  const code = D.designCode({ name: 'С переносами', palette: { oak: '#101018' } });
  const messy = `  ${code.slice(0, 12)}\n${code.slice(12, 30)} \r\n${code.slice(30)}  `;
  assert.equal(D.readDesignCode(messy).name, 'С переносами');
});

test('битый, чужой и огромный код отклоняется', () => {
  assert.equal(D.readDesignCode('AVD1.@@@'), null);
  assert.equal(D.readDesignCode('AVL1.e30='), null);
  assert.equal(D.readDesignCode('AVD1.' + Buffer.from('[1,2]').toString('base64')), null);
  assert.equal(D.readDesignCode('AVD1.' + 'A'.repeat(40000)), null);
  assert.equal(D.readDesignCode(null), null);
});

test('paletteVars и fixesBg', () => {
  assert.deepEqual(D.paletteVars(D.cleanDesign({ palette: { amber: '#ff0000', 'oak-2': '#000000' } })), { '--oak-2': '#000000', '--amber': '#ff0000' });
  assert.equal(D.fixesBg(D.cleanDesign({ palette: { amber: '#ff0000' } })), false);
  assert.equal(D.fixesBg(D.cleanDesign({ palette: { text: '#ffffff' } })), true);
});
```

Порядок ключей в `paletteVars` задаёт `PALETTE`: `oak-2` идёт раньше `amber`. `deepEqual` порядок ключей не проверяет, так что тест от него не зависит.

- [ ] **Step 2: Добавить скрипт и убедиться, что тесты падают**

В `package.json` в `"scripts"` после `"tester"` добавить:

```json
    "tester": "electron . --tester",
    "test:design": "node --test scripts/design-core.test.js"
```

Run: `npm run test:design`
Expected: FAIL — `Cannot find module '../renderer/design-core.js'`

- [ ] **Step 3: Написать ядро**

`renderer/design-core.js`:

```js
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

  // Шрифты общие с настройками оформления (look.js → FONTS)
  const FONTS = {
    unbounded: { name: 'Unbounded', css: '"Unbounded", "Segoe UI", sans-serif' },
    manrope: { name: 'Manrope', css: '"Manrope", "Segoe UI", sans-serif' },
    jost: { name: 'Jost', css: '"Jost", "Segoe UI", sans-serif' },
    onest: { name: 'Onest', css: '"Onest", "Segoe UI", sans-serif' },
    system: { name: 'Системный', css: 'system-ui, "Segoe UI", Roboto, sans-serif' },
    serif: { name: 'С засечками', css: 'Georgia, "Times New Roman", "Noto Serif", serif' },
    mono: { name: 'Моноширинный', css: '"Cascadia Mono", Consolas, "Roboto Mono", monospace' },
  };

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
    { id: 'title', group: 'stage', parent: 'now', name: 'Название трека', sel: '.now-title', props: ['color', 'size', 'font', 'weight', 'caps', 'shadow'], text: true },
    { id: 'artist', group: 'stage', parent: 'now', name: 'Артист', sel: '.now-artist', props: ['color', 'size', 'font', 'weight', 'caps'] },
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
      case 'size': return [['', `zoom: ${v / 100}`]];
      case 'font': return [['', `font-family: ${FONTS[v].css}`]];
      case 'weight': return [['', `font-weight: ${v}`]];
      case 'align': return [['', `text-align: ${v}`]];
      case 'caps': return [['', 'text-transform: uppercase; letter-spacing: .04em']];
      case 'shadow': return [['', part.text ? `text-shadow: ${TEXT_SHADOWS[v]}` : `box-shadow: ${SHADOWS[v]}`]];
      case 'border': return [['', `outline: ${v.w}px solid ${colorCss(v.c)}; outline-offset: -${v.w}px`]];
      case 'hidden': return [['', 'display: none']];
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
    BASES, MAX_DESIGNS, CODE_PREFIX, FONTS, PALETTE, TOKENS, PROPS, GROUPS, PARTS,
    newDesignId, cleanDesign, orderedBlocks, designCss, paletteVars, fixesBg, designCode, readDesignCode,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DesignCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm run test:design`
Expected: PASS, 9 тестов, 0 упавших.

Если упал тест `__proto__` в `cleanDesign`: литерал `{ __proto__: {...} }` задаёт прототип, а не своё поле. `own()` его пропускает, и `parts` остаются без лишнего — именно это тест и проверяет.

- [ ] **Step 5: Commit**

```bash
git add renderer/design-core.js scripts/design-core.test.js package.json
git commit -m "Свой дизайн: ядро — каталог частей, очистка, CSS и коды"
```

---

### Task 2: Применение дизайна в плеере

**Files:**
- Modify: `renderer/index.html` (строка с `<script src="look.js">`)
- Modify: `renderer/look.js` (`LOOK_DEFAULTS`, `FONTS`, стили, `applyLook`, `radiusOrig`, `skinSection`)
- Modify: `renderer/extras.js` (`setTheme`, проверка `skinOwn`)

**Interfaces:**
- Consumes: `DesignCore.cleanDesign`, `DesignCore.designCss`, `DesignCore.paletteVars`, `DesignCore.fixesBg`, `DesignCore.FONTS` (задача 1).
- Produces (глобальные в `look.js`, их используют задачи 3–5):
  - `let designDraft = null` — черновик редактора; когда не `null`, `applyLook` показывает его.
  - `activeDesign(l = look): Design | null`
  - `baseSkinId(l = look): string` — ключ `SKINS`, на котором сейчас стоит плеер.
  - `LOOK_DEFAULTS.designs = []`; `look.skin` для своего дизайна — `'d:<id>'`.
  - `window.SKIN_VOICE: boolean` — читает `extras.js`.

- [ ] **Step 1: Подключить ядро**

В `renderer/index.html` заменить:

```html
  <script src="look.js"></script>
```

на:

```html
  <script src="design-core.js"></script>
  <script src="look.js"></script>
```

- [ ] **Step 2: Правки в `look.js`**

2a. В `LOOK_DEFAULTS` после `fsLyrics: true,` добавить:

```js
  designs: [],           // свои дизайны (designer.js, design-core.js); выбранный — skin: 'd:<id>'
```

2b. Заменить весь блок `const FONTS = { … };` (от `const FONTS = {` до закрывающей `};`) на:

```js
const FONTS = DesignCore.FONTS; // общие со своими дизайнами (design-core.js)
```

2c. После строки `document.head.appendChild(lookStyle);` добавить:

```js
// Свой дизайн: правила из design-core.js → designCss. Отдельный <style>, чтобы менять его, не трогая переменные
const designStyle = document.createElement('style');
designStyle.id = 'look-design';
document.head.appendChild(designStyle);

// Дизайн на экране: черновик из редактора (designer.js) или сохранённый и выбранный
let designDraft = null;
function activeDesign(l = look) {
  if (designDraft) return designDraft;
  if (typeof l.skin !== 'string' || !l.skin.startsWith('d:')) return null;
  const found = (l.designs || []).find((d) => d?.id === l.skin.slice(2));
  return found ? DesignCore.cleanDesign(found) : null;
}
// Готовый дизайн под экраном: основа своего, выбранный готовый; свой удалили (например, на другом устройстве) — по умолчанию
function baseSkinId(l = look) {
  const d = activeDesign(l);
  if (d) return d.base;
  if (SKINS[l.skin]) return l.skin;
  return String(l.skin).startsWith('d:') ? LOOK_DEFAULTS.skin : 'barrel';
}
```

2d. В `applyLook` заменить начало функции — от `const skin = SKINS[look.skin] || SKINS.barrel;` до строки `lookStyle.textContent = …` включительно — на:

```js
  const design = activeDesign();
  const skinId = baseSkinId();
  const skin = SKINS[skinId];
  const mode = skinMode(skin);
  const palette = mode ? skin.palettes[mode] : skin.palette;
  const vars = palette ? { ...palette } : themeVars(look);
  if (look.voice) vars['--voice'] = look.voice;
  // Свой дизайн: его цвета главнее темы и основы; акцент фиксированный, только если он не «из обложки»
  const own = design ? DesignCore.paletteVars(design) : {};
  Object.assign(vars, own);
  const fixedAccent = design ? (design.accentFromCover ? null : own['--amber'] || skin.accent) : skin.accent;
  if (look.accentMode === 'fixed') vars['--amber'] = look.accent;
  else if (fixedAccent) vars['--amber'] = fixedAccent;
  // extras.js → setTheme: палитра обложки не перекрашивает фон, акцент и голоса дизайнов со своими цветами;
  // на светлом фоне акцент из обложки темнее, а фон сцены — готовая размытая обложка (ambientFrom)
  window.SKIN_FIXED = !!palette || (!!design && DesignCore.fixesBg(design));
  window.SKIN_ACCENT = !!fixedAccent;
  window.SKIN_VOICE = !!own['--voice'];
  window.SKIN_LIGHT = mode === 'light';
  window.SKIN_AMBIENT = !!skin.ambient;
  // Спектр и вращение пластинки дизайну не нужны — выключаем в том, что читают их циклы (app.js, scratch.js),
  // сами настройки не трогаем: в другом дизайне они вернутся
  if (skin.noViz || skin.noVinyl) {
    window.LOOK = { ...look, ...(skin.noViz ? { viz: false } : {}), ...(skin.noVinyl ? { vinyl: false, scratch: false } : {}) };
  }
  const display = design?.fonts.display || (skin.display && look.display === LOOK_DEFAULTS.display ? skin.display : look.display);
  const text = design?.fonts.text || (skin.text && look.text === LOOK_DEFAULTS.text ? skin.text : look.text);
  vars['--display'] = (FONTS[display] || FONTS.unbounded).css;
  vars['--ui'] = (FONTS[text] || FONTS.onest).css;
  vars['--lyrics-scale'] = String(look.lyricsSize / 100);
  vars['--wall-blur'] = `${look.wallBlur}px`;
  vars['--wall-dim'] = String(look.wallDim / 100);
  lookStyle.textContent = `:root { ${Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ')} }`;
  const css = design ? DesignCore.designCss(design) : '';
  if (designStyle.textContent !== css) designStyle.textContent = css;
```

2e. В `const cls = {` заменить строку:

```js
    ...Object.fromEntries(Object.keys(SKINS).filter((id) => id !== 'barrel').map((id) => [`skin-${id}`, look.skin === id])),
```

на:

```js
    ...Object.fromEntries(Object.keys(SKINS).filter((id) => id !== 'barrel').map((id) => [`skin-${id}`, skinId === id])),
    'skin-design': !!design,
```

2f. Заменить строку:

```js
  applyRadius((look.radius / 100) * (skin.radius || 1));
```

на:

```js
  applyRadius((look.radius / 100) * (skin.radius || 1) * (design ? design.radius / 100 : 1));
```

2g. Заменить `const radiusOrig = new Map();` на `const radiusOrig = new WeakMap(); // правила своего дизайна пересоздаются на каждое изменение — старые не держим`.

2h. В `skinSection` заменить `${SKINS[l.skin]?.palettes ? ` на `${SKINS[baseSkinId(l)]?.palettes ? `.

- [ ] **Step 3: Голоса из дизайна в `extras.js`**

В `setTheme` заменить строку:

```js
    const skinOwn = (window.SKIN_FIXED && BG_VARS.includes(k)) || (window.SKIN_ACCENT && k === '--amber');
```

на:

```js
    const skinOwn = (window.SKIN_FIXED && BG_VARS.includes(k)) || (window.SKIN_ACCENT && k === '--amber') || (window.SKIN_VOICE && k === '--voice');
```

- [ ] **Step 4: Проверить в приложении**

Run: `npm run dev`. Если DevTools не открылись сами — Ctrl+Shift+I.

1. Плеер выглядит как до правок. В консоли нет ошибок.
2. Включить трек. В консоли выполнить:

```js
saveLook({ designs: [{ id: 'test1234', name: 'Тест', base: 'barrel', palette: { oak: '#101018', 'oak-2': '#15152a', amber: '#ff3da6' }, accentFromCover: false, fonts: { display: 'mono' }, parts: { cover: { radius: 20, shadow: 'glow' }, title: { caps: true, color: 'accent' }, play: { fill: { kind: 'gradient', a: 'accent', b: 'voice', angle: 135 } } }, order: { stage: ['controls'] } }], skin: 'd:test1234' })
```

   Ожидается: тёмно-синий фон, который не перекрашивается обложкой; розовый акцент; заголовки моноширинные; обложка квадратная со скруглением и розовым свечением; название трека розовое и заглавными; кнопка «играть» с градиентом; кнопки управления стоят над бочкой; у `<html>` есть класс `skin-design`.
3. `saveLook({ designs: [{ ...look.designs[0], base: 'glass' }] })` → раскладка «Стекла», свои цвета остались.
4. Удаление на другом устройстве (Review Focus 2): `saveLook({ designs: [] })` → плеер переходит на «Стекло» (дизайн по умолчанию), ошибок нет. Потом `saveLook({ skin: 'glass' })`.
5. «Настройки → Оформление»: готовые дизайны переключаются как раньше, шрифты из списка меняются.

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html renderer/look.js renderer/extras.js
git commit -m "Свой дизайн: плеер применяет выбранный дизайн"
```

---

### Task 3: «Мои дизайны» в настройках — карточки, копия, код, удаление

**Files:**
- Create: `renderer/designer.js` (первая часть — действия с дизайнами)
- Modify: `renderer/index.html` (подключить `designer.js` после `look.js`)
- Modify: `renderer/look.js` (`skinSection`, `bindLook`, `pasteLook`, сброс)
- Modify: `renderer/styles.css` (после блока `.skin-mock, .skin-mock * { text-transform: none; }`)

**Interfaces:**
- Consumes: `activeDesign`, `baseSkinId`, `LOOK_DEFAULTS.designs` (задача 2); `DesignCore.*` (задача 1); из `app.js` — `$`, `$$`, `esc`, `toast`, `ask`, `api.copy`, `showMenu`; из `look.js` — `lookCfg`, `saveLook`, `rerenderLook`, `SKINS`, `LOOK_DEFAULTS`.
- Produces (глобальные в `designer.js`):
  - `uniqueName(name: string, designs: Design[]): string`
  - `addDesign(raw): Promise<boolean>` — добавить копией с новым id и включить.
  - `duplicateDesign(id)`, `copyDesignCode(id)`, `deleteDesign(id)`, `importDesign(code)` — всё `Promise<void>`.
  - `designMenu(id: string, anchor: Element): void`

- [ ] **Step 1: `designer.js` — действия с дизайнами**

`renderer/designer.js`:

```js
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
    { label: 'Копия', icon: 'i-copy', onClick: () => duplicateDesign(id) },
    { label: 'Скопировать код', icon: 'i-share', onClick: () => copyDesignCode(id) },
    { sep: true },
    { label: 'Удалить', icon: 'i-trash', danger: true, onClick: () => deleteDesign(id) },
  ], { anchor });
}
```

В `renderer/index.html` после `<script src="look.js"></script>` добавить строку `<script src="designer.js"></script>`.

- [ ] **Step 2: Карточки в `skinSection` (`look.js`)**

Заменить функцию `skinSection` целиком:

```js
// Выбор дизайна: карточки с маленьким макетом каждого; свои — тем же макетом в своих цветах (designer.js)
function skinSection(l) {
  const mock = (id, d) => `<span class="skin-mock is-${id}" aria-hidden="true"${d ? ` style="${Object.entries(DesignCore.paletteVars(d)).map(([k, v]) => `${k}:${v}`).join(';')}"` : ''}>
    <span class="sm-rail"><i></i><i></i><i></i><i></i></span>
    <span class="sm-stage"><span class="sm-cover"></span><span class="sm-t"></span><span class="sm-a"></span><span class="sm-bar"></span><span class="sm-play"></span></span>
    <span class="sm-lib"><span class="sm-h"${d ? ` data-label="${esc(d.name)}"` : ''}></span>${'<span class="sm-row"><i></i><b></b></span>'.repeat(5)}</span>
  </span>`;
  const designs = (l.designs || []).map((d) => DesignCore.cleanDesign(d));
  const card = (d) => `<div class="look-skin look-design${l.skin === `d:${d.id}` ? ' on' : ''}" role="button" tabindex="0" data-design="${d.id}">
    ${mock(d.base, d)}<span class="skin-name">${esc(d.name)}</span><small>На основе «${SKINS[d.base].name}»</small>
    <button class="icon-btn small look-design-more" data-design-more="${d.id}" aria-label="Ещё: «${esc(d.name)}»" aria-haspopup="menu" aria-expanded="false"><svg><use href="#i-more"/></svg></button></div>`;
  return `<section class="sec" data-sec="skin">
    <h3 class="sec-title">Дизайн</h3>
    <p class="sec-desc">Внешний вид всего плеера. Акцент, шрифты и остальное ниже работают во всех.</p>
    <div class="look-skins">${Object.entries(SKINS).map(([id, s]) => `<button class="look-skin${l.skin === id ? ' on' : ''}" data-skin="${id}">
      ${mock(id)}<span class="skin-name">${s.name}</span><small>${s.desc}</small></button>`).join('')}</div>
    ${designs.length ? `<h4 class="look-sub">Мои дизайны</h4><div class="look-skins">${designs.map(card).join('')}</div>` : ''}
    ${SKINS[baseSkinId(l)]?.palettes ? `<div class="field"><label>Тема</label><div class="ctl">${seg('glassMode', [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']], l.glassMode)}</div></div>` : ''}
  </section>`;
}
```

- [ ] **Step 3: Обработчики в `bindLook`, вставка кода, сброс (`look.js`)**

3a. В `bindLook` после строки с `$$('[data-skin]', body).forEach(…)` добавить:

```js
  $$('[data-design]', body).forEach((c) => {
    const pick = async () => { await saveLook({ skin: `d:${c.dataset.design}` }); rerenderLook(); };
    c.onclick = (e) => { if (!e.target.closest('[data-design-more]')) pick(); };
    c.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); pick(); } };
  });
  $$('[data-design-more]', body).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); designMenu(b.dataset.designMore, b); }; });
```

3b. Заменить функцию `pasteLook` целиком:

```js
async function pasteLook() {
  const code = await ask({ title: 'Вставить код', text: 'Код оформления начинается с AVL1., код дизайна — с AVD1. Своя картинка фона останется как есть.', ok: 'Применить', value: '' });
  if (!code) return;
  if (code.trim().startsWith(DesignCore.CODE_PREFIX)) { await importDesign(code); return; } // designer.js
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(code.trim().replace(/^AVL1\./, '')))));
    const clean = Object.fromEntries(Object.entries(data).filter(([k]) => k in LOOK_DEFAULTS && k !== 'wallpaper'));
    if ('designs' in clean) clean.designs = (Array.isArray(clean.designs) ? clean.designs : []).slice(0, DesignCore.MAX_DESIGNS).map((d) => DesignCore.cleanDesign(d));
    await saveLook(clean);
    rerenderLook();
    toast('Оформление применено');
  } catch {
    toast('Это не код оформления', true);
  }
}
```

3c. В обработчике `#look-reset` заменить текст подтверждения и сохранение:

```js
    const ok = await ask({ title: 'Сбросить оформление?', text: 'Тема, цвета, шрифты, размеры и вкладки вернутся как было. Картинка фона уберётся, свои дизайны останутся.', ok: 'Сбросить', input: false, danger: true });
```

и

```js
    await saveLook({ ...LOOK_DEFAULTS, designs: look.designs });
```

- [ ] **Step 4: Стили карточек (`styles.css`)**

После строки `.skin-mock, .skin-mock * { text-transform: none; }` добавить:

```css
/* свои дизайны (designer.js): тот же макет в цветах дизайна, подпись — название дизайна */
.look-sub { margin: 18px 0 0; font: 500 13px var(--ui); color: var(--text-3); }
.look-design { position: relative; cursor: pointer; }
.look-design-more { position: absolute; top: 12px; right: 12px; background: color-mix(in srgb, var(--oak-2) 85%, transparent); }
.skin-mock .sm-h[data-label] { overflow: hidden; text-overflow: ellipsis; }
.skin-mock .sm-h[data-label]::before { content: attr(data-label); font: 700 12px var(--display); letter-spacing: -0.02em; }
```

- [ ] **Step 5: Проверить в приложении**

`npm run dev`, в консоли создать дизайн, как в задаче 2 (шаг 4.2). Затем «Настройки → Оформление»:

1. Под готовыми дизайнами есть «Мои дизайны» с карточкой «Тест»: макет в синем и розовом, подпись «Тест», карточка выделена.
2. Клик по «Бочке» → дизайн сменился, «Тест» больше не выделен. Клик по «Тест» → снова свой. Tab до карточки и Enter → включается.
3. «⋯» → «Копия» → появилась «Тест — копия», она выбрана. «⋯» → «Скопировать код» → тост. «⋯» → «Удалить» → подтверждение → карточка пропала, а если она была выбрана, включилась её основа.
4. «Вставить код» + скопированный код → «Дизайн добавлен», имя «Тест 2», если «Тест» уже есть. «Вставить код» + `AVD1.мусор` → «Это не код дизайна».
5. Старый код с мусором (Review Focus 5): «Скопировать код оформления», затем в консоли подменить: `api.copy('AVL1.' + btoa(unescape(encodeURIComponent(JSON.stringify({ ...lookCfg(), designs: [{ name: 'X', parts: { title: { color: 'url(x)' } } }, 5, null] })))))` и вставить код → в «Моих дизайнах» 3 карточки: «X» и две «Мой дизайн» (из `5` и `null`). Ошибок нет, у «X» название трека обычного цвета.
6. «Сбросить всё» → оформление сброшено, «Мои дизайны» на месте.

- [ ] **Step 6: Commit**

```bash
git add renderer/designer.js renderer/index.html renderer/look.js renderer/styles.css
git commit -m "Свой дизайн: «Мои дизайны» в настройках — выбор, копия, код, удаление"
```

---

### Task 4: Конструктор — панель, «Общее», «Части», выбор кликом

**Files:**
- Modify: `renderer/designer.js` (дописать в конец; добавить «Изменить» в `designMenu`)
- Modify: `renderer/look.js` (`skinSection`: карточка «Создать дизайн»; `bindLook`: её обработчик)
- Modify: `renderer/styles.css` (в конец файла)
- Modify: `renderer/index.html` (спрайт иконок, после `<symbol id="i-focus" …>`)

**Interfaces:**
- Consumes: всё из задач 1–3; `designDraft`, `activeDesign`, `baseSkinId`, `applyLook` (задача 2); `uniqueName`, `designMenu` (задача 3); `closeSettings`, `openSettings(sec)` из `app.js`.
- Produces: `openDesigner(id: string | null): void` — `null` создаёт новый дизайн из того, что на экране.

- [ ] **Step 1: Редактор — дописать в конец `designer.js`**

```js
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
```

- [ ] **Step 2: «Изменить» в меню дизайна**

В `designMenu` (начало `designer.js`) первой строкой массива добавить:

```js
    { label: 'Изменить', icon: 'i-pencil', onClick: () => openDesigner(id) },
```

- [ ] **Step 3: Карточка «Создать дизайн» (`look.js`)**

3a. В `skinSection` заменить строку:

```js
    ${designs.length ? `<h4 class="look-sub">Мои дизайны</h4><div class="look-skins">${designs.map(card).join('')}</div>` : ''}
```

на:

```js
    <h4 class="look-sub">Мои дизайны</h4>
    <div class="look-skins">${designs.map(card).join('')}<button class="look-skin look-design-new" id="look-design-new">
      <span class="skin-mock look-design-plus" aria-hidden="true"><svg><use href="#i-plus"/></svg></span>
      <span class="skin-name">Создать дизайн</span><small>Цвета, шрифты и каждая часть плеера — без кода</small></button></div>
```

3b. В `bindLook` после обработчиков `[data-design-more]` добавить:

```js
  $('#look-design-new', body).onclick = () => openDesigner(null); // designer.js
```

- [ ] **Step 4: Стили панели (`styles.css`, в конец файла)**

```css
/* =====================================================================================
   КОНСТРУКТОР СВОЕГО ДИЗАЙНА (designer.js). Панель справа, плеер сдвигается влево и служит превью.
   У панели своя постоянная палитра: что бы юзер ни сделал с цветами дизайна, редактор остаётся читаемым
   ===================================================================================== */
.look-design-plus { grid-template-columns: 1fr; place-items: center; background: none; box-shadow: none; outline: 1.5px dashed var(--rivet-2); outline-offset: -1.5px; }
.look-design-plus svg { width: 28px; height: 28px; color: var(--text-3); }

.dz {
  --oak: #121214; --oak-2: #1a1a1d; --rivet: #232327; --rivet-2: #303035; --hoop-dim: #4a4a50; --hoop: #8e8e93;
  --text: #f2f2f4; --text-2: #c4c4c9; --text-3: #8f8f96; --danger: #ff7b6b;
  --display: "Onest", "Segoe UI", sans-serif; --ui: "Onest", "Segoe UI", sans-serif;
  color-scheme: dark;
  position: fixed; top: 44px; right: 12px; bottom: 12px; z-index: 30; width: 360px;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--oak-2); color: var(--text); border: 1px solid var(--rivet-2); border-radius: 18px;
  box-shadow: 0 30px 80px rgb(0 0 0 / .55); animation: rise .2s cubic-bezier(.2, .9, .3, 1.1);
  font: 400 14px/1.45 var(--ui); text-transform: none; -webkit-app-region: no-drag;
}
html.dz-open body { padding-right: 384px; }
.dz-head { display: flex; align-items: center; gap: 6px; padding: 12px 12px 8px 14px; }
.dz-name { height: 36px; font: 600 15px var(--display); }
.dz-head .icon-btn.on { color: var(--oak); background: var(--amber); }
.dz-tabs { display: flex; margin: 0 14px 6px; }
.dz-tabs button { flex: 1; }
.dz-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 14px 14px; }
.dz-sec { padding: 12px 0; border-bottom: 1px solid var(--rivet-2); }
.dz-sec:last-child { border-bottom: 0; }
.dz-sec h4, .dz-part-title { margin: 0 0 8px; font: 600 13px var(--display); color: var(--text); }
.dz-hint { margin: 0 0 10px; font-size: 12.5px; color: var(--text-3); line-height: 1.45; }
.dz-field { display: grid; grid-template-columns: 104px 1fr; align-items: center; gap: 10px; margin: 8px 0; }
.dz-field > label { color: var(--text-2); font-size: 13px; }
.dz-ctl { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
.dz-ctl input[type="range"] { min-width: 90px; }
.dz-ctl .val { min-width: 40px; text-align: right; color: var(--text-3); font-size: 12px; font-variant-numeric: tabular-nums; }
.dz-ctl select.input { height: 32px; }
.dz-seg button { padding: 5px 10px; font-size: 12.5px; }
.dz-colors { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; margin-bottom: 8px; }
.dz-pal { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12.5px; color: var(--text-3); }
.dz-pal.set { color: var(--text); }
.dz-pal span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dz input[type="color"] { width: 30px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: none; cursor: pointer; flex: none; }
.dz-pal:not(.set) input[type="color"], .dz-ctl input[type="color"]:not(.on) { opacity: .55; }
.dz-token { width: 22px; height: 22px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgb(255 255 255 / .15); flex: none; }
.dz-token.on { box-shadow: 0 0 0 2px var(--oak-2), 0 0 0 4px var(--text); }
.dz-clear { width: 24px; height: 24px; color: var(--text-3); }
.dz-clear svg { width: 13px; height: 13px; }
.dz-tree { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.dz-node { display: flex; align-items: center; gap: 2px; border-radius: 8px; }
.dz-node:hover { background: var(--rivet); }
.dz-node.child { padding-left: 16px; }
.dz-node.off .dz-node-name, .dz-node.missing .dz-node-name { color: var(--text-3); }
.dz-node.missing .dz-node-name { font-style: italic; }
.dz-node-name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 7px 8px; text-align: left; white-space: nowrap; overflow: hidden; }
.dz-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--amber); flex: none; }
.dz-node .icon-btn:disabled { opacity: .3; cursor: default; }
.dz-back { margin: 4px 0 10px; }
.dz-reset { margin-top: 12px; }
.dz-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px 14px; border-top: 1px solid var(--rivet-2); }

/* выбор части кликом: всё кликабельно (без областей перетаскивания окна), рамка над частью под курсором */
html.dz-picking :not(.dz, .dz *) { -webkit-app-region: no-drag !important; cursor: crosshair !important; }
.dz-hi {
  position: fixed; z-index: 29; pointer-events: none; border-radius: 8px;
  outline: 2px solid var(--amber); outline-offset: 2px; background: color-mix(in srgb, var(--amber) 14%, transparent);
  transition: left .08s ease, top .08s ease, width .08s ease, height .08s ease;
}
.dz-hi span {
  position: absolute; left: -2px; bottom: calc(100% + 6px); padding: 3px 8px; border-radius: 6px;
  background: var(--amber); color: #111; font: 600 12px var(--ui); white-space: nowrap; text-transform: none;
}
.dz-hi.low span { bottom: auto; top: calc(100% + 6px); }
```

- [ ] **Step 5: Иконки «глаз» для списка частей (`index.html`)**

После строки с `<symbol id="i-focus"` вставить:

```html
    <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/></symbol>
    <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M4 4l16 16M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.9 3.7M6.3 7.6A15.7 15.7 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
```

- [ ] **Step 6: Прогнать тесты ядра**

Run: `npm run test:design`
Expected: PASS, 9 тестов.

- [ ] **Step 7: Проверить в приложении**

`npm run dev`, включить трек. «Настройки → Оформление → Дизайн → Создать дизайн»:

1. Настройки закрылись, справа панель, плеер сдвинулся влево. В поле названия «Мой дизайн» (или «Мой дизайн 2»).
2. «Общее»: основа «Форма» → раскладка сразу «Формы». Цвет «Фон окна» → фон меняется, пока тянешь в палитре; появился «×», по нему цвет возвращается. «Акцент из обложки» выкл + свой «Акцент» → акцент не меняется со сменой трека. Шрифт «Моноширинный», скругления 0 % → всё квадратное.
3. «Части»: есть «Окно», «Сцена», «Библиотека». В основе «Бочка» «Шапка «авеон»» серая курсивом. Глаз у «Громкость и кнопки» → блок пропал, иконка перечёркнута. Стрелки у «Кнопки управления» вверх → кнопки над бочкой. «Обложка» → «Скругление» 100 → круг, «Тень» → «Свечение», «Рамка» 3 px, токен «Голоса». «Строка трека» → «Фон» → «Градиент», два цвета, угол, «Плотность фона» 40 %. «Сбросить часть» → всё ушло.
4. Прицел → навести на обложку, название, кнопку «играть», вкладку, строку трека: рамка с подписью стоит ровно на части; трек при клике не запускается, окно не тащится. Клик по кнопке «играть» → открылись её свойства, прицел выключен. Esc в режиме прицела → выключается.
5. «Сохранить» → панель закрылась, открылись настройки на «Дизайне», новая карточка выбрана и выглядит в своих цветах. Перезапуск приложения → дизайн на месте.
6. «⋯» → «Изменить» → что-нибудь поменять → Esc → «Выйти без сохранения?» → ещё раз Esc (Review Focus 3) → закрылся только диалог, редактор открыт. «Отмена» → «Выйти» → всё как до правки.
7. Размер интерфейса 120 % (Review Focus 4): «Оформление → Размер интерфейса» 120 %, открыть «Изменить», прицел → рамка ровно на частях. Вернуть 100 %.
8. Все четыре основы по очереди: выбрать кликом обложку, кнопку «играть», строку трека, вкладку — свойства применяются. Если в какой-то основе часть не красится, найти в `styles.css` правило основы и поправить селектор части в `PARTS`, а тесты ядра прогнать снова.

- [ ] **Step 8: Commit**

```bash
git add renderer/designer.js renderer/look.js renderer/styles.css renderer/index.html
git commit -m "Конструктор своего дизайна: панель, части плеера и выбор кликом"
```

---

### Task 5: Финальная проверка

**Files:** нет новых.

- [ ] **Step 1: Тесты**

Run: `npm run test:design`
Expected: PASS, 9 тестов.

- [ ] **Step 2: Прогон по спеке**

Открыть `docs/superpowers/specs/2026-09-29-design-constructor-design.md`, раздел «Проверка → Вручную», и пройти каждый пункт в `npm start` (без `--dev`). Особенно: синхронизация — изменить дизайн на одном компьютере, войти тем же аккаунтом на другом (или выйти и войти) → дизайн приехал.

- [ ] **Step 3: Посмотреть, что в коммитах нет лишнего**

Run: `git log --stat -6` и `git status --short`
Expected: в коммитах только файлы из этого плана. `renderer/island.*`, `*.bak` и `.playwright-mcp/` по-прежнему не закоммичены.
