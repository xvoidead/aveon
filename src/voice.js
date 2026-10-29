// Голосовое управление: модель распознавания речи Vosk (русская, ~45 МБ) скачивается один раз в userData/voice.
// Окно (renderer/voice.js) загружает её через media://voice/model — распознавание целиком на этом компьютере.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip';
const MODEL_SIZE = 46236750; // если сервер не прислал Content-Length — для процентов

const modelFile = () => path.join(app.getPath('userData'), 'voice', 'vosk-model-small-ru-0.22.zip');

let downloading = null; // Promise текущей загрузки
let progress = 0;
let lastError = '';

function status() {
  return { ready: fs.existsSync(modelFile()), downloading: !!downloading, progress, error: lastError };
}

// onProgress(0…1) — для полоски в настройках
function download(onProgress = () => {}) {
  if (fs.existsSync(modelFile())) return Promise.resolve(status());
  if (downloading) return downloading;
  lastError = '';
  progress = 0;
  downloading = (async () => {
    const file = modelFile();
    const part = file + '.part';
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    try {
      const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(15 * 60000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = +res.headers.get('content-length') || MODEL_SIZE;
      let got = 0;
      let shown = 0;
      const body = Readable.fromWeb(res.body);
      body.on('data', (chunk) => {
        got += chunk.length;
        progress = Math.min(1, got / total);
        if (progress - shown >= 0.01) { shown = progress; onProgress(progress); }
      });
      await pipeline(body, fs.createWriteStream(part));
      await fs.promises.rename(part, file);
      progress = 1;
      onProgress(1);
    } catch (e) {
      await fs.promises.unlink(part).catch(() => {});
      lastError = `Не удалось скачать модель: ${e.message}`;
      throw new Error(lastError);
    } finally {
      downloading = null;
    }
    return status();
  })();
  return downloading;
}

// Для media://voice/model (main.js)
const fileOf = () => (fs.existsSync(modelFile()) ? modelFile() : null);

module.exports = { status, download, fileOf };
