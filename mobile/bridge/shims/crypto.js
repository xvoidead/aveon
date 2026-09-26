// Синхронный crypto для src/: хэши и HMAC на @noble/hashes, случайные байты из WebCrypto
import { sha256 } from '@noble/hashes/sha2.js';
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { hmac } from '@noble/hashes/hmac.js';
import { Buffer } from 'buffer';

const ALGS = { sha256, md5, sha1 };
const bytes = (x) => (typeof x === 'string' ? new TextEncoder().encode(x) : new Uint8Array(x));

function digester(make) {
  const parts = [];
  const self = {
    update(x) { parts.push(bytes(x)); return self; },
    digest(enc) {
      const total = parts.reduce((n, p) => n + p.length, 0);
      const all = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { all.set(p, off); off += p.length; }
      const out = Buffer.from(make(all));
      return enc ? out.toString(enc) : out;
    },
  };
  return self;
}

export function createHash(alg) {
  const h = ALGS[alg];
  if (!h) throw new Error('hash ' + alg);
  return digester((data) => h(data));
}

export function createHmac(alg, key) {
  const h = ALGS[alg];
  if (!h) throw new Error('hmac ' + alg);
  return digester((data) => hmac(h, bytes(key), data));
}

export function randomBytes(n) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
}

export function randomUUID() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export default { createHash, createHmac, randomBytes, randomUUID };
