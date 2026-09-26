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
    // Эффекты, которые идут сами (переходы и цензура в app.js): запись при этом не останавливается
    this.fx = null;      // reverse | scratch | stutter | tape | backspin | brake
    this.fxT = 0;        // сколько сэмплов прошло с начала эффекта
    this.fxDur = 0;      // длина эффекта в сэмплах (для переходов)
    this.loop = 0;       // stutter: начало повторяемого кусочка
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'fx') {
        this.fx = d.mode || null;
        if (!this.fx) this.freeze = false;
        this.fxT = 0;
        this.fxDur = Math.round((d.dur || 1) * sampleRate);
        if (this.fx) {
          // Откуда читать: вперёд и «туда-сюда» — чуть позади записанного, чтобы было что играть.
          // Переходы (перемотка, тормоз) замораживают запись: после них звучит уже новый трек
          const back = { brake: 0.65, backspin: 0.2, tape: 0.12, scratch: 0.25 }[this.fx] || 0;
          this.p = this.w - 1 - Math.round(back * sampleRate);
          this.freeze = this.fx === 'brake' || this.fx === 'backspin';
          this.rate = d.mode === 'backspin' || d.mode === 'brake' || d.mode === 'tape' ? 1 : this.fx === 'reverse' ? -1 : 0;
          this.loop = this.w - Math.round(sampleRate * 0.09);
        }
        return;
      }
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

  // Скорость «иглы» для эффекта: время t — в секундах от начала
  fxRate() {
    const t = this.fxT / sampleRate;
    const k = Math.min(1, this.fxT / Math.max(1, this.fxDur));
    switch (this.fx) {
      case 'reverse': return -1;                                     // слово задом наперёд
      case 'scratch': return 2.4 * Math.sin(2 * Math.PI * 5 * t);   // диджей возит пластинку туда-сюда
      case 'tape': return Math.max(0, 1 - t / 0.22);                 // плёнку зажало — звук сползает вниз
      case 'stutter': {                                              // заикание: один кусочек по кругу
        const slice = Math.round(sampleRate * 0.09);
        this.p = this.loop + (this.fxT % slice) - 1;
        return 0;
      }
      case 'backspin': return k < 0.12 ? 1 - (k / 0.12) * 6 : -5 * Math.pow(1 - (k - 0.12) / 0.88, 2); // рывок назад и затухание
      case 'brake': return Math.pow(1 - k, 1.6);                    // пластинку остановили рукой
      default: return 1;
    }
  }

  process(inputs, outputs) {
    const inp = inputs[0] || [];
    const out = outputs[0];
    const n = out[0].length;
    const l = inp[0], r = inp[1] || inp[0];
    for (let i = 0; i < n; i++) {
      const liveL = l ? l[i] : 0, liveR = r ? r[i] : 0;
      if (!this.scratch && !this.freeze) { // эффекты цензуры пишут дальше: буфер нужен им самим
        // пишем живой звук, пока пластинку не держат
        const k = this.w % this.len;
        this.buf[0][k] = liveL;
        this.buf[1][k] = liveR;
        this.w++;
      }
      const wet = this.scratch || !!this.fx;
      this.fade += ((wet ? 1 : 0) - this.fade) * (this.fx ? 0.02 : 0.004);
      let sL = 0, sR = 0;
      if (this.fade > 0.0005) {
        let still = false;
        if (this.fx && !this.scratch) {
          const r = this.fxRate();
          this.p += r;
          this.fxT++;
          still = this.fx !== 'stutter' && Math.abs(r) < 0.02; // игла стоит — тишина, а не «залипший» сэмпл
        } else {
          this.rate += (this.target - this.rate) * 0.0015;
          this.p += this.rate;
        }
        // дальше записанного вперёд не уедешь, раньше начала буфера — тоже
        const min = this.w - this.len + 2, max = this.w - 1;
        if (this.p < min) { this.p = min; this.rate = 0; }
        if (this.p > max) { this.p = max; this.rate = 0; }
        if (!still) {
          sL = this.read(0, this.p);
          sR = this.read(1, this.p);
        }
      }
      out[0][i] = liveL * (1 - this.fade) + sL * this.fade;
      if (out[1]) out[1][i] = liveR * (1 - this.fade) + sR * this.fade;
    }
    return true;
  }
}

registerProcessor('aveon-scratch', Scratch);
