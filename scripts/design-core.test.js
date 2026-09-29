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
