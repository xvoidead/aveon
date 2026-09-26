// Скретч обложкой (renderer/scratch.js): звук проходит насквозь и заодно пишется в кольцевой буфер
// на последние 12 секунд. Когда пластинку хватают, звук берётся из буфера со скоростью руки —
// вперёд, назад, стоп — с интерполяцией между сэмплами, как игла по винилу.
class Scratch extends AudioWorkletProcessor {
  constructor() {
    super();
    this.len = Math.round(sampleRate * 12);
    this.buf = [new Float32Array(this.len), new Float32Array(this.len)];
    this.w = 0;          // сколько сэмплов записано всего (растёт всегда)
    this.scratch = false;
    this.p = 0;          // позиция чтения в «записанных» сэмплах
    this.pStart = 0;
    this.rate = 0;       // текущая скорость (1 — как обычно, <0 — назад)
    this.target = 0;     // скорость руки; к ней плавно подтягиваемся — как у тяжёлого диска
    this.fade = 0;       // 0 — живой звук, 1 — из буфера; короткий переход без щелчков
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'start') {
        this.scratch = true;
        this.p = this.w;
        this.pStart = this.w;
        this.rate = d.rate ?? 1;
        this.target = this.rate;
      } else if (d.type === 'rate') {
        this.target = d.rate;
      } else if (d.type === 'stop') {
        this.scratch = false;
        this.port.postMessage({ type: 'offset', sec: (this.p - this.pStart) / sampleRate });
      }
    };
  }

  read(ch, pos) {
    const b = this.buf[ch];
    const i = Math.floor(pos);
    const f = pos - i;
    const a = b[((i % this.len) + this.len) % this.len];
    const c = b[(((i + 1) % this.len) + this.len) % this.len];
    return a + (c - a) * f;
  }

  process(inputs, outputs) {
    const inp = inputs[0] || [];
    const out = outputs[0];
    const n = out[0].length;
    const l = inp[0], r = inp[1] || inp[0];
    for (let i = 0; i < n; i++) {
      const liveL = l ? l[i] : 0, liveR = r ? r[i] : 0;
      if (!this.scratch) {
        // пишем живой звук, пока пластинку не держат
        const k = this.w % this.len;
        this.buf[0][k] = liveL;
        this.buf[1][k] = liveR;
        this.w++;
      }
      this.fade += ((this.scratch ? 1 : 0) - this.fade) * 0.004;
      let sL = 0, sR = 0;
      if (this.fade > 0.0005) {
        this.rate += (this.target - this.rate) * 0.0015;
        this.p += this.rate;
        // дальше записанного вперёд не уедешь, раньше начала буфера — тоже
        const min = this.w - this.len + 2, max = this.w - 1;
        if (this.p < min) { this.p = min; this.rate = 0; }
        if (this.p > max) { this.p = max; this.rate = 0; }
        sL = this.read(0, this.p);
        sR = this.read(1, this.p);
      }
      out[0][i] = liveL * (1 - this.fade) + sL * this.fade;
      if (out[1]) out[1][i] = liveR * (1 - this.fade) + sR * this.fade;
    }
    return true;
  }
}

registerProcessor('aveon-scratch', Scratch);
