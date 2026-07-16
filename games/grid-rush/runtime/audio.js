/** Grid Rush — lightweight WebAudio SFX (no external assets required). */
export class RaceAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._thruster = null;
    this._gain = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this._gain = this.ctx.createGain();
    this._gain.gain.value = 0.22;
    this._gain.connect(this.ctx.destination);
    return this.ctx;
  }

  resume() {
    const c = this.ensure();
    if (c && c.state === 'suspended') void c.resume();
  }

  setMuted(m) {
    this.muted = !!m;
    if (this._gain) this._gain.gain.value = this.muted ? 0 : 0.22;
  }

  tone(freq, dur = 0.08, type = 'square', vol = 0.35, slide = 0) {
    if (this.muted) return;
    const c = this.ensure();
    if (!c) return;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(this._gain || c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  countdown() {
    this.tone(440, 0.12, 'triangle', 0.3);
  }
  go() {
    this.tone(660, 0.18, 'sawtooth', 0.32, 200);
    this.tone(880, 0.22, 'square', 0.18, 120);
  }
  pickup() {
    this.tone(720, 0.07, 'sine', 0.28, 280);
    this.tone(980, 0.1, 'triangle', 0.2, 100);
  }
  useItem() {
    this.tone(280, 0.1, 'sawtooth', 0.25, 180);
  }
  hit() {
    this.tone(90, 0.18, 'square', 0.4, -40);
    this.tone(55, 0.25, 'sawtooth', 0.22, -20);
  }
  drift() {
    this.tone(180 + Math.random() * 40, 0.04, 'sawtooth', 0.08, 30);
  }
  checkpoint() {
    this.tone(520, 0.08, 'sine', 0.22, 160);
  }
  finish() {
    this.tone(440, 0.12, 'triangle', 0.3, 0);
    setTimeout(() => this.tone(554, 0.12, 'triangle', 0.28), 100);
    setTimeout(() => this.tone(659, 0.2, 'triangle', 0.3), 200);
  }
  thrusterLevel(amount) {
    // continuous thruster noise via quiet pulses — avoid heavy loop
    if (this.muted || amount < 0.35) return;
    if (Math.random() > 0.08) return;
    this.tone(70 + amount * 40, 0.05, 'sawtooth', 0.04 * amount, 10);
  }
}
