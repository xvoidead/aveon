// iOS: страница живёт на локальном сервере приложения (http://127.0.0.1:port), и всё, что приходит
// из интернета — обложки и сам поток — идёт через /proxy?u=… . Так они того же происхождения, что и
// страница: иначе WebKit не даёт прочитать картинку (палитра из обложки) и не отдаёт звук в Web Audio
// (бочка, эквалайзер) — ровно то, что на Android решает перехват запросов с CORS-заголовками.
const ON = process.platform === 'ios';

const KEYS = new Set(['cover', 'thumb', 'img', 'image', 'picture', 'poster', 'avatar']);

/** Адрес для проксирования (на других платформах — как есть). */
export function proxied(url) {
  if (!ON || typeof url !== 'string' || !url) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  return `${location.origin}/proxy?u=${encodeURIComponent(url)}`;
}

/** То же, но для результата потока: {url, hls}. */
export function proxiedStream(st) {
  if (!ON || !st || typeof st !== 'object') return st;
  const out = { ...st };
  if (typeof out.url === 'string') out.url = proxied(out.url);
  return out;
}

/** Обход результата: картинки переписываем, вложенные треки — тоже. */
export function mapMedia(value, depth = 0) {
  if (!ON || depth > 6) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((v) => mapMedia(v, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' && KEYS.has(k)) out[k] = proxied(v);
    else out[k] = mapMedia(v, depth + 1);
  }
  return out;
}

export const proxyOn = ON;
