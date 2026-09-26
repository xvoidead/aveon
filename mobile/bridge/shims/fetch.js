// fetch для src/ на Android: запрос делает нативный HttpURLConnection (AveonPlugin.fetch),
// поэтому CORS не мешает — как в главном процессе Electron. Ответ — обычный Response.
import { Aveon, b64ToBytes, bytesToB64 } from '../native.js';

const enc = (s) => new TextEncoder().encode(s);

async function bodyToB64(body) {
  if (body == null) return null;
  if (typeof body === 'string') return bytesToB64(enc(body));
  if (body instanceof URLSearchParams) return bytesToB64(enc(body.toString()));
  if (body instanceof ArrayBuffer) return bytesToB64(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) return bytesToB64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  if (body instanceof Blob) return bytesToB64(new Uint8Array(await body.arrayBuffer()));
  return bytesToB64(enc(String(body)));
}

function headersObj(h) {
  const out = {};
  new Headers(h || {}).forEach((v, k) => { out[k] = v; });
  return out;
}

function abortError(signal) {
  const timeout = signal?.reason?.name === 'TimeoutError';
  return new DOMException(timeout ? 'The operation timed out.' : 'The operation was aborted.', timeout ? 'TimeoutError' : 'AbortError');
}

export async function nativeFetch(input, init = {}) {
  const req = input instanceof Request ? input : null;
  const url = String(req ? req.url : input);
  const method = (init.method || req?.method || 'GET').toUpperCase();
  const headers = headersObj(init.headers || req?.headers);
  if (init.body instanceof URLSearchParams && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  const body = await bodyToB64(init.body);
  const signal = init.signal;
  if (signal?.aborted) throw abortError(signal);

  const call = Aveon.fetch({ url, method, headers, body, timeout: 30000 });
  const aborted = signal && new Promise((_, reject) => signal.addEventListener('abort', () => reject(abortError(signal)), { once: true }));
  const r = await (aborted ? Promise.race([call, aborted]) : call);
  if (r.error) throw new TypeError(`fetch failed: ${r.error}`);
  const nullBody = [101, 204, 205, 304].includes(r.status);
  const res = new Response(nullBody ? null : b64ToBytes(r.body), { status: r.status, statusText: r.statusText || '', headers: r.headers || {} });
  Object.defineProperty(res, 'url', { value: r.url || url });
  return res;
}
