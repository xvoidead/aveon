// Мини-обёртка над fetch: таймаут, JSON и понятные ошибки.
class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(url, { method = 'GET', headers = {}, body, timeout = 15000, raw = false } = {}) {
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout) });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = json?.error?.message || json?.error_description || json?.error?.name || json?.error || text.slice(0, 200) || res.statusText;
    throw new HttpError(res.status, `HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, json);
  }
  return json ?? text;
}

// Сервер перегружен (503, «serveroverloaded», 429): ждём, пока освободится, с нарастающей паузой, но не дольше maxWait.
// Остальные ошибки (404, нет сети и т. д.) сразу идут наверх.
const BUSY = new Set([429, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function requestPatient(url, opts, { maxWait = 90000 } = {}) {
  const t0 = Date.now();
  for (let wait = 2000; ; wait = Math.min(wait * 2, 15000)) {
    try {
      return await request(url, opts);
    } catch (e) {
      if (!(e instanceof HttpError) || !BUSY.has(e.status) || Date.now() - t0 + wait > maxWait) throw e;
      console.warn(`${new URL(url).host}: HTTP ${e.status}, повтор через ${wait / 1000} с`);
      await sleep(wait);
    }
  }
}

module.exports = { request, requestPatient, HttpError };
