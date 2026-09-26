// Файлы кэша треков на Windows: userData/cache/audio. Играются через media://cache/ (main.js)
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const NAME = /^[a-f0-9]{24}\.(mp3|m4a|aac|ogg|webm|flac)$/;
const dir = () => path.join(app.getPath('userData'), 'cache', 'audio');

function fileOf(name) {
  return NAME.test(name || '') ? path.join(dir(), name) : null;
}

// Части (одна ссылка или сегменты HLS) пишутся подряд в один файл; готовый файл появляется
// только целиком — недокачанный .part при следующем запуске удалится
async function download(urls, name) {
  const file = fileOf(name);
  if (!file) throw new Error('bad cache name');
  await fs.promises.mkdir(dir(), { recursive: true });
  const part = file + '.part';
  const out = fs.createWriteStream(part);
  try {
    for (const url of urls) {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), out, { end: false });
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    await fs.promises.rename(part, file);
    return (await fs.promises.stat(file)).size;
  } catch (e) {
    out.destroy();
    await fs.promises.unlink(part).catch(() => {});
    throw e;
  }
}

async function remove(name) {
  await fs.promises.unlink(path.join(dir(), path.basename(name))).catch(() => {});
}

async function clear() {
  await fs.promises.rm(dir(), { recursive: true, force: true });
}

async function list() {
  let names = [];
  try { names = await fs.promises.readdir(dir()); } catch { return []; }
  const out = [];
  for (const name of names) {
    try { out.push({ name, size: (await fs.promises.stat(path.join(dir(), name))).size }); } catch {}
  }
  return out;
}

const url = (name) => `media://cache/?f=${name}`;

module.exports = { download, remove, clear, list, url, fileOf };
