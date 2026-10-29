// Внутри renderer/voice-host.html: загрузка модели и распознаватель для renderer/voice.js
window.voiceHost = {
  model: null,
  async load(url) {
    this.model ||= await Vosk.createModel(url, -1); // распакованная модель кэшируется в IndexedDB
  },
  // onText(text) — на каждую законченную фразу (после паузы)
  recognizer(sampleRate, onText) {
    const rec = new this.model.KaldiRecognizer(sampleRate);
    rec.on('result', (m) => { if (m?.result?.text) onText(m.result.text); });
    return {
      // Float32Array из главного окна — «чужой» для этой рамки, а vosk проверяет instanceof: копируем в свой
      feed: (samples) => rec.acceptWaveformFloat(new Float32Array(samples), sampleRate),
      remove: () => rec.remove(),
    };
  },
};
