// Кнопки «назад / пауза / вперёд» в превью окна на панели задач Windows (как у Spotify).
// Иконки рисуем прямо здесь: белые глифы 32×32 (16×16 при масштабе 2), без файлов-картинок.
const { nativeImage } = require('electron');

const SIZE = 32;
const SCALE = SIZE / 16;
const SS = 4; // сглаживание: 4×4 выборки на пиксель

// Фигуры в координатах 16×16
const tri = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const s = (px, py, qx, qy) => (x - qx) * (py - qy) - (px - qx) * (y - qy);
  const d1 = s(ax, ay, bx, by), d2 = s(bx, by, cx, cy), d3 = s(cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const any = (...fs) => (x, y) => fs.some((f) => f(x, y));

const SHAPES = {
  play: tri(5, 3.5, 5, 12.5, 12.5, 8),
  pause: any(rect(4.5, 3.5, 7, 12.5), rect(9, 3.5, 11.5, 12.5)),
  next: any(tri(3.5, 3.5, 3.5, 12.5, 10, 8), rect(10.5, 3.5, 12.5, 12.5)),
  prev: any(tri(12.5, 3.5, 12.5, 12.5, 6, 8), rect(3.5, 3.5, 5.5, 12.5)),
};

function draw(inside) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (inside((px + (sx + 0.5) / SS) / SCALE, (py + (sy + 0.5) / SS) / SCALE)) hit++;
        }
      }
      const a = Math.round((hit / (SS * SS)) * 255);
      const i = (py * SIZE + px) * 4;
      buf[i] = buf[i + 1] = buf[i + 2] = a; // BGRA, альфа предумножена: белый = a
      buf[i + 3] = a;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE, scaleFactor: SCALE });
}

let icons = null;
let state = { playing: false, hasTrack: false };

function update(win, onAction, next = {}) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  state = { ...state, ...next };
  if (!icons) icons = Object.fromEntries(Object.entries(SHAPES).map(([k, f]) => [k, draw(f)]));
  const off = state.hasTrack ? [] : ['disabled'];
  win.setThumbarButtons([
    { tooltip: 'Предыдущий трек', icon: icons.prev, flags: off, click: () => onAction('prev') },
    state.playing
      ? { tooltip: 'Пауза', icon: icons.pause, click: () => onAction('toggle') }
      : { tooltip: 'Играть', icon: icons.play, click: () => onAction('toggle') },
    { tooltip: 'Следующий трек', icon: icons.next, flags: off, click: () => onAction('next') },
  ]);
}

module.exports = { update };
