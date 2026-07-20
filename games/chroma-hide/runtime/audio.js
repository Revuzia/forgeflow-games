/**
 * CHROMA HIDE — runtime/audio.js
 * Procedural WebAudio — no asset files. Whistle, footstep, gunshot, catch, miss,
 * UI blip, plus a subtle ambient music bed. The AudioContext is created via the
 * (game_controls-wrapped) constructor, so the page's universal Mute button
 * suspends it automatically. All scheduling is envelope-based and cheap.
 */
export class GameAudio {
  constructor() { this.ctx = null; this.master = null; this._vol = 0.5; this._music = null; this._lastStep = 0; }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this._vol; this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") { try { this.ctx.resume(); } catch (e) {} }
    return this.ctx;
  }
  setVolume(v) { this._vol = Math.max(0, Math.min(1, v)); if (this.master) this.master.gain.value = this._vol; try { localStorage.setItem("chroma_vol", String(this._vol)); } catch (e) {} }
  loadVolume() { try { const v = parseFloat(localStorage.getItem("chroma_vol")); if (!isNaN(v)) this._vol = v; } catch (e) {} return this._vol; }

  _env(node, t0, a, d, peak, dest) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.connect(g); g.connect(dest || this.master); return g;
  }
  _noise(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 1; for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x40000000) - 1; }
    const src = this.ctx.createBufferSource(); src.buffer = buf; return src;
  }

  whistle() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(1650, t + 0.12); o.frequency.exponentialRampToValueAtTime(1100, t + 0.34);
    this._env(o, t, 0.03, 0.34, 0.22); o.start(t); o.stop(t + 0.4);
  }
  footstep() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    if (t - this._lastStep < 0.28) return; this._lastStep = t;
    const src = this._noise(0.09); const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380;
    src.connect(lp); this._env(lp, t, 0.005, 0.09, 0.10); src.start(t); src.stop(t + 0.1);
  }
  gunshot() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    const src = this._noise(0.16); const bp = c.createBiquadFilter(); bp.type = "lowpass"; bp.frequency.setValueAtTime(2200, t); bp.frequency.exponentialRampToValueAtTime(300, t + 0.14);
    src.connect(bp); this._env(bp, t, 0.002, 0.16, 0.32); src.start(t); src.stop(t + 0.18);
    const o = c.createOscillator(); o.type = "square"; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.1);
    this._env(o, t, 0.002, 0.1, 0.14); o.start(t); o.stop(t + 0.12);
  }
  catchSound() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    [660, 990].forEach((f, i) => { const o = c.createOscillator(); o.type = "triangle"; o.frequency.value = f; this._env(o, t + i * 0.08, 0.01, 0.14, 0.2); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.16); });
  }
  miss() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(); o.type = "square"; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.09);
    this._env(o, t, 0.005, 0.09, 0.08); o.start(t); o.stop(t + 0.11);
  }
  blip(up) {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(); o.type = "sine"; o.frequency.value = up ? 880 : 500; this._env(o, t, 0.005, 0.08, 0.12); o.start(t); o.stop(t + 0.1);
  }

  // Ambient music bed — a soft detuned drone + occasional pentatonic notes.
  startMusic() {
    const c = this._ensure(); if (!c || this._music) return;
    const bus = c.createGain(); bus.gain.value = 0.14; bus.connect(this.master);
    const drone = [];
    [55, 55.3, 82.5].forEach((f) => { const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f; const g = c.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(bus); o.start(); drone.push(o); });
    const scale = [220, 261.6, 293.7, 329.6, 392, 440];
    let step = 0;
    const iv = setInterval(() => {
      if (!this._music) return;
      const now = this.ctx.currentTime; step++;
      if (step % 2 === 0) {
        const f = scale[(this._pseudo(step) * scale.length) | 0];
        const o = this.ctx.createOscillator(); o.type = "triangle"; o.frequency.value = f;
        this._env(o, now, 0.4, 1.8, 0.08, bus); o.start(now); o.stop(now + 2.4);
      }
    }, 1400);
    this._music = { bus, drone, iv };
  }
  stopMusic() {
    if (!this._music) return;
    clearInterval(this._music.iv);
    try { this._music.drone.forEach((o) => o.stop()); this._music.bus.disconnect(); } catch (e) {}
    this._music = null;
  }
  _pseudo(n) { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }
}
