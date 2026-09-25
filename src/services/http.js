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

module.exports = { request, HttpError };
