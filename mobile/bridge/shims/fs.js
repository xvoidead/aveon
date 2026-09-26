// fs для src/ на Android. Все JSON-файлы (config, albums, stats…) загружаются в память при запуске
// (fsLoad), читаются синхронно, а пишутся сразу в память и по очереди на диск. На диске они
// зашифрованы ключом из Android Keystore (AveonPlugin.fsWrite). Картинки пишутся как есть —
// их отдаёт WebView по адресу /_media/art.
import { Buffer } from 'buffer';
import { Aveon, bytesToB64 } from '../native.js';

const files = new Map(); // '/aveon/config.json' → строка
let chain = Promise.resolve();
const queue = (fn) => { chain = chain.then(fn).catch((e) => console.warn('fs:', e?.message || e)); return chain; };

const rel = (p) => String(p).replace(/^\/aveon\/?/, '');
const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });

export async function preload() {
  const r = await Aveon.fsLoad();
  for (const [name, text] of Object.entries(r.files || {})) files.set(`/aveon/${name}`, text);
}

export function flushed() { return chain; }

function isBinary(data) { return typeof data !== 'string'; }

export function readFileSync(p, enc) {
  if (!files.has(p)) throw enoent(p);
  const text = files.get(p);
  return enc ? text : Buffer.from(text, 'utf8');
}

export function writeFileSync(p, data) {
  if (isBinary(data)) {
    const b64 = bytesToB64(new Uint8Array(data));
    queue(() => Aveon.fsWriteBinary({ name: rel(p), data: b64 }));
    return;
  }
  files.set(p, String(data));
  if (p.endsWith('.tmp')) return; // сразу же будет renameSync — пишем уже под настоящим именем
  queue(() => Aveon.fsWrite({ name: rel(p), text: String(data) }));
}

export function renameSync(from, to) {
  if (!files.has(from)) throw enoent(from);
  const text = files.get(from);
  files.delete(from);
  files.set(to, text);
  queue(() => Aveon.fsWrite({ name: rel(to), text }));
}

export function unlinkSync(p) {
  files.delete(p);
  queue(() => Aveon.fsDelete({ name: rel(p) }));
}

export function existsSync(p) {
  return files.has(p) || p === '/aveon';
}

export function mkdirSync() {}

export const promises = {
  async writeFile(p, data) { writeFileSync(p, data); await chain; },
  async readFile(p, enc) { return readFileSync(p, enc); },
  async unlink(p) { unlinkSync(p); await chain; },
  async stat(p) { if (!files.has(p)) throw enoent(p); return { size: files.get(p).length, mtimeMs: 0 }; },
  async readdir() { return []; },
};

export default { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync, promises, preload, flushed };
