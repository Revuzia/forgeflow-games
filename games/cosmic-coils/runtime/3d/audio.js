/**
 * Cosmic Coils — runtime/3d/audio.js
 * 100% procedural Web Audio: a generative per-biome score (pads + bass pulse +
 * scale-locked arps — different scale/tempo/timbre per biome) plus synthesized
 * SFX. Nothing here is shared with any other ForgeFlow game (house rule).
 * Web Audio safety per house notes: linear ramps only near zero, finite clamps,
 * scheduler wrapped in try/catch. Exposes window.__AUDIO_CTX__ for the page bar.
 */

const clamp01 = (v) => Math.max(0.0001, Math.min(1, Number.isFinite(v) ? v : 0.0001));

const BIOME_MUSIC = {
  //           root  scale (semitones)          bpm  padWave   arpWave    dark
  verdant: { root: 57, scale: [0, 2, 4, 7, 9, 11], bpm: 92, pad: "triangle", arp: "sine", dark: 0.25 },
  ember:   { root: 50, scale: [0, 1, 4, 5, 7, 8],  bpm: 104, pad: "sawtooth", arp: "square", dark: 0.7 },
  glacier: { root: 62, scale: [0, 2, 6, 7, 11],    bpm: 84, pad: "sine",     arp: "triangle", dark: 0.35 },
  dune:    { root: 55, scale: [0, 1, 4, 5, 7, 8, 11], bpm: 98, pad: "triangle", arp: "sawtooth", dark: 0.5 },
  abyss:   { root: 47, scale: [0, 3, 5, 7, 10],    bpm: 78, pad: "sawtooth", arp: "sine", dark: 0.85 },
};
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.musicOn = true;
    this.musicVol = parseFloat(localStorage.getItem("cc_vol_music") ?? "0.7");
    this.sfxVol = parseFloat(localStorage.getItem("cc_vol_sfx") ?? "0.9");
    this._sched = null;
    this._boostGain = null;
    this._stormGain = null;
    this._nextBar = 0;
    this._bar = 0;
    this._biome = "verdant";
    this._seedN = 1;
  }

  /** must be called from a user gesture (menu PLAY click) */
  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    window.__AUDIO_CTX__ = this.ctx; // page control-bar mute integration
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = clamp01(this.musicVol) * 0.9;
    this.musicBus.connect(this.master);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = clamp01(this.sfxVol);
    this.sfxBus.connect(this.master);
    // music master filter for storm "pressure"
    this.musicFilter = this.ctx.createBiquadFilter();
    this.musicFilter.type = "lowpass";
    this.musicFilter.frequency.value = 18000;
    this.musicFilter.connect(this.musicBus);
    // continuous boost whoosh (gain-gated noise)
    this._makeBoostLoop();
    this._makeStormLoop();
    this.started = true;
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  setMusicVol(v) { this.musicVol = v; localStorage.setItem("cc_vol_music", String(v)); if (this.musicBus) this.musicBus.gain.value = clamp01(v) * 0.9; }
  setSfxVol(v) { this.sfxVol = v; localStorage.setItem("cc_vol_sfx", String(v)); if (this.sfxBus) this.sfxBus.gain.value = clamp01(v); }

  _noiseBuf(sec = 1.2) {
    if (this._nb) return this._nb;
    const n = Math.floor(this.ctx.sampleRate * sec);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this._nb = buf;
    return buf;
  }

  _makeBoostLoop() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(); src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 0.7;
    this._boostGain = this.ctx.createGain();
    this._boostGain.gain.value = 0;
    src.connect(f); f.connect(this._boostGain); this._boostGain.connect(this.sfxBus);
    src.start();
    this._boostFilter = f;
  }
  setBoost(on, dt) {
    if (!this.started) return;
    const g = this._boostGain.gain;
    const target = on ? 0.16 : 0;
    g.value = g.value + (target - g.value) * Math.min(1, (dt || 0.016) * 8);
    if (on) this._boostFilter.frequency.value = 700 + Math.random() * 500;
  }

  _makeStormLoop() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(); src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 420; f.Q.value = 0.4;
    this._stormGain = this.ctx.createGain();
    this._stormGain.gain.value = 0;
    src.connect(f); f.connect(this._stormGain); this._stormGain.connect(this.sfxBus);
    src.start();
  }
  setStorm(intensity, dt) {
    if (!this.started) return;
    const g = this._stormGain.gain;
    const target = clamp01(intensity) * 0.14 - 0.0001;
    g.value = g.value + (Math.max(0, target) - g.value) * Math.min(1, (dt || 0.016) * 2);
    if (this.musicFilter) {
      const want = 18000 - clamp01(intensity) * 14000;
      this.musicFilter.frequency.value += (want - this.musicFilter.frequency.value) * Math.min(1, (dt || 0.016) * 2);
    }
  }

  // ── generative music ───────────────────────────────────────────────────────
  setBiome(biome, seed) {
    this._biome = BIOME_MUSIC[biome] ? biome : "verdant";
    this._seedN = (seed >>> 0) || 1;
    this._bar = 0;
  }
  _rand() { // deterministic-ish per match music variation
    this._seedN = (Math.imul(this._seedN, 1664525) + 1013904223) >>> 0;
    return this._seedN / 4294967296;
  }

  update(dt) {
    if (!this.started || !this.musicOn) return;
    try {
      const now = this.ctx.currentTime;
      if (now + 0.25 > this._nextBar) this._scheduleBar(Math.max(now + 0.05, this._nextBar));
    } catch (e) { /* scheduler must never kill the frame */ }
  }

  _scheduleBar(t0) {
    const M = BIOME_MUSIC[this._biome];
    const beat = 60 / M.bpm;
    const bar = beat * 4;
    this._nextBar = t0 + bar;
    const b = this._bar++;
    const prog = [0, 3, 4, 2][b % 4]; // scale-degree progression
    const root = M.root + M.scale[prog % M.scale.length] - 12;

    // pad: two detuned oscillators, slow envelope
    if (b % 2 === 0) {
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator();
        o.type = M.pad;
        o.frequency.value = midiHz(root) * (1 + det / 4000);
        const g = this.ctx.createGain();
        const lv = 0.045 * (1 - M.dark * 0.3);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(lv, t0 + bar * 0.6);
        g.gain.linearRampToValueAtTime(0.0001, t0 + bar * 2);
        const f = this.ctx.createBiquadFilter();
        f.type = "lowpass"; f.frequency.value = 900 + (1 - M.dark) * 1400;
        o.connect(f); f.connect(g); g.connect(this.musicFilter);
        o.start(t0); o.stop(t0 + bar * 2.05);
      }
      // fifth above, quieter
      const o5 = this.ctx.createOscillator();
      o5.type = "sine";
      o5.frequency.value = midiHz(root + 7);
      const g5 = this.ctx.createGain();
      g5.gain.setValueAtTime(0.0001, t0);
      g5.gain.linearRampToValueAtTime(0.03, t0 + bar);
      g5.gain.linearRampToValueAtTime(0.0001, t0 + bar * 2);
      o5.connect(g5); g5.connect(this.musicFilter);
      o5.start(t0); o5.stop(t0 + bar * 2.05);
    }

    // bass pulse on beats
    for (let i = 0; i < 4; i++) {
      if (i === 3 && this._rand() < 0.4) continue;
      const t = t0 + i * beat;
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(midiHz(root - 12), t);
      o.frequency.linearRampToValueAtTime(midiHz(root - 12) * 0.99, t + 0.2);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.015);
      g.gain.linearRampToValueAtTime(0.0001, t + beat * 0.85);
      o.connect(g); g.connect(this.musicFilter);
      o.start(t); o.stop(t + beat);
    }

    // arp: 8ths, wander the scale
    let deg = Math.floor(this._rand() * M.scale.length);
    for (let i = 0; i < 8; i++) {
      if (this._rand() < 0.22) continue; // breathing room
      const t = t0 + i * beat * 0.5;
      deg = (deg + (this._rand() < 0.5 ? 1 : this._rand() < 0.5 ? -1 : 2) + M.scale.length * 4) % (M.scale.length * 2);
      const oct = deg >= M.scale.length ? 12 : 0;
      const note = M.root + 12 + oct + M.scale[deg % M.scale.length];
      const o = this.ctx.createOscillator();
      o.type = M.arp;
      o.frequency.value = midiHz(note);
      const g = this.ctx.createGain();
      const lv = 0.028 * (1 - M.dark * 0.25);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(lv, t + 0.012);
      g.gain.linearRampToValueAtTime(0.0001, t + beat * 0.46);
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 2400;
      o.connect(f); f.connect(g); g.connect(this.musicFilter);
      o.start(t); o.stop(t + beat * 0.5);
    }

    // glacier/abyss shimmer bell on bar start
    if ((this._biome === "glacier" || this._biome === "abyss") && b % 2 === 1) {
      const note = M.root + 24 + M.scale[Math.floor(this._rand() * M.scale.length)];
      const o = this.ctx.createOscillator();
      o.type = "sine"; o.frequency.value = midiHz(note);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.01);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 2.2);
      o.connect(g); g.connect(this.musicFilter);
      o.start(t0); o.stop(t0 + 2.3);
    }
  }

  // ── SFX ────────────────────────────────────────────────────────────────────
  _env(t, a, peak, d) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.linearRampToValueAtTime(0.0001, t + a + d);
    g.connect(this.sfxBus);
    return g;
  }
  _tone(type, f0, f1, t, a, peak, d) {
    if (!this.started) return;
    try {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, f0), t);
      if (f1) o.frequency.linearRampToValueAtTime(Math.max(20, f1), t + a + d);
      o.connect(this._env(t, a, peak, d));
      o.start(t); o.stop(t + a + d + 0.02);
    } catch (e) {}
  }
  eat(tier, combo = 0) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const base = tier === 9 ? 660 : tier === 2 ? 520 : tier === 3 ? 400 : 440;
    const f = base * Math.pow(1.06, Math.min(12, combo));
    this._tone("sine", f, f * 1.35, t, 0.01, 0.14, 0.09);
    if (tier >= 2 || tier === 9) this._tone("triangle", f * 1.5, f * 2, t + 0.03, 0.01, 0.09, 0.12);
  }
  boostTick() { /* covered by loop */ }
  death(self) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this._tone("sawtooth", self ? 320 : 260, 60, t, 0.02, self ? 0.24 : 0.14, 0.5);
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf();
      const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1200;
      src.connect(f); f.connect(this._env(t, 0.01, self ? 0.3 : 0.16, 0.45));
      src.start(t); src.stop(t + 0.5);
    } catch (e) {}
  }
  kill() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this._tone("triangle", 523, 523, t, 0.01, 0.16, 0.1);
    this._tone("triangle", 784, 784, t + 0.09, 0.01, 0.16, 0.16);
  }
  ui() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this._tone("sine", 700, 900, t, 0.005, 0.08, 0.05);
  }
  respawn() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) this._tone("sine", 400 + i * 140, 400 + i * 140, t + i * 0.05, 0.01, 0.07, 0.14);
  }
  thunder() {
    if (!this.started) return;
    try {
      const t = this.ctx.currentTime + 0.05 + Math.random() * 0.4;
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf();
      src.playbackRate.value = 0.35;
      const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 240;
      src.connect(f); f.connect(this._env(t, 0.03, 0.3, 1.6));
      src.start(t); src.stop(t + 1.8);
    } catch (e) {}
  }
  suspend() { if (this.ctx && this.ctx.state === "running") this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {}); }
}
