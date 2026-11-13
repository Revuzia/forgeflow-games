/**
 * CHROMA HIDE — runtime/audio.js
 * Procedural WebAudio — no asset files, so the whole soundtrack costs 0 download bytes.
 *
 * Everything positional routes through a PannerNode fed by setListener(), because in a
 * hide-and-seek game hearing WHERE a sound came from is the seeker's primary sense and
 * the hider's main risk: the taunt whistle only means something if it leaks a direction.
 * Non-positional cues (UI, phase stings, your own heartbeat) bypass the panner.
 *
 * The AudioContext is created via the (game_controls-wrapped) constructor, so the page's
 * universal Mute button suspends it automatically. All scheduling is envelope-based.
 */
export class GameAudio {
  constructor() {
    this.ctx = null; this.master = null; this._vol = 0.5; this._music = null;
    this._lastStep = 0; this._spray = null; this._amb = null; this._lastBeat = 0;
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this._vol; this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 1.0; this.sfxBus.connect(this.master);
    }
    if (this.ctx.state === "suspended") { try { this.ctx.resume(); } catch (e) {} }
    return this.ctx;
  }
  setVolume(v) { this._vol = Math.max(0, Math.min(1, v)); if (this.master) this.master.gain.value = this._vol; try { localStorage.setItem("chroma_vol", String(this._vol)); } catch (e) {} }
  loadVolume() { try { const v = parseFloat(localStorage.getItem("chroma_vol")); if (!isNaN(v)) this._vol = v; } catch (e) {} return this._vol; }

  /** Put the listener where the player is, facing where they look. Called every frame. */
  setListener(x, z, yaw) {
    const c = this.ctx; if (!c || !c.listener) return;
    const L = c.listener, fx = Math.sin(yaw || 0), fz = Math.cos(yaw || 0);
    if (L.positionX) {
      const t = c.currentTime;
      L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(1.5, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(0, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else if (L.setPosition) {                       // Safari / older WebAudio
      L.setPosition(x, 1.5, z); L.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Destination for a world sound. Falls back to the flat bus when it has no position. */
  _at(x, z) {
    const c = this.ctx;
    if (x == null || z == null || !c.createPanner) return this.sfxBus;
    const p = c.createPanner();
    p.panningModel = "HRTF"; p.distanceModel = "inverse";
    p.refDistance = 3; p.maxDistance = 45; p.rolloffFactor = 1.4;
    if (p.positionX) { const t = c.currentTime; p.positionX.setValueAtTime(x, t); p.positionY.setValueAtTime(1.2, t); p.positionZ.setValueAtTime(z, t); }
    else if (p.setPosition) p.setPosition(x, 1.2, z);
    p.connect(this.sfxBus);
    return p;
  }

  _env(node, t0, a, d, peak, dest) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.connect(g); g.connect(dest || this.sfxBus || this.master); return g;
  }
  _noise(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 1; for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x40000000) - 1; }
    const src = this.ctx.createBufferSource(); src.buffer = buf; return src;
  }
  _tone(type, freq, t, a, d, peak, dest) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    this._env(o, t, a, d, peak, dest); o.start(t); o.stop(t + a + d + 0.02); return o;
  }

  // ── gameplay, positional ───────────────────────────────────────────────────
  whistle(x, z) {
    const c = this._ensure(); if (!c) return; const t = c.currentTime; const dest = this._at(x, z);
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(1650, t + 0.12); o.frequency.exponentialRampToValueAtTime(1100, t + 0.34);
    this._env(o, t, 0.03, 0.34, 0.22, dest); o.start(t); o.stop(t + 0.4);
  }

  /**
   * Footfall, coloured by what you are walking on. One filter setting for every surface
   * made three very different maps sound like one room; each step also jitters in
   * frequency and level so a run does not machine-gun the same sample.
   */
  footstep(surface, x, z) {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    if (t - this._lastStep < 0.28) return; this._lastStep = t;
    const dest = this._at(x, z);
    const J = (v, f) => v * (1 + (Math.random() - 0.5) * 2 * f);
    const S = {
      carpet:   { type: "lowpass",  freq: 240, peak: 0.06, click: 0 },
      tile:     { type: "lowpass",  freq: 900, peak: 0.10, click: 2500 },
      checker:  { type: "lowpass",  freq: 900, peak: 0.10, click: 2500 },
      concrete: { type: "lowpass",  freq: 760, peak: 0.10, click: 2100 },
      asphalt:  { type: "lowpass",  freq: 520, peak: 0.09, click: 0, tail: 0.04 },
      wood:     { type: "lowpass",  freq: 620, peak: 0.09, click: 1400 },
      metal:    { type: "bandpass", freq: 1600, peak: 0.12, click: 3200, tail: 0.12 },
    }[surface] || { type: "lowpass", freq: 380, peak: 0.10, click: 0 };
    const src = this._noise(0.09 + (S.tail || 0));
    const f = c.createBiquadFilter(); f.type = S.type; f.frequency.value = J(S.freq, 0.12);
    src.connect(f); this._env(f, t, 0.005, 0.09 + (S.tail || 0), J(S.peak, 0.20), dest);
    src.start(t); src.stop(t + 0.1 + (S.tail || 0));
    if (S.click) {                                   // hard floors get a heel tick
      const cs = this._noise(0.03), cf = c.createBiquadFilter();
      cf.type = "bandpass"; cf.frequency.value = J(S.click, 0.12); cf.Q.value = 1.6;
      cs.connect(cf); this._env(cf, t, 0.002, 0.03, 0.04, dest); cs.start(t); cs.stop(t + 0.04);
    }
  }

  gunshot(x, z) {
    const c = this._ensure(); if (!c) return; const t = c.currentTime; const dest = this._at(x, z);
    const src = this._noise(0.16); const bp = c.createBiquadFilter(); bp.type = "lowpass"; bp.frequency.setValueAtTime(2200, t); bp.frequency.exponentialRampToValueAtTime(300, t + 0.14);
    src.connect(bp); this._env(bp, t, 0.002, 0.16, 0.32, dest); src.start(t); src.stop(t + 0.18);
    const o = c.createOscillator(); o.type = "square"; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.1);
    this._env(o, t, 0.002, 0.1, 0.14, dest); o.start(t); o.stop(t + 0.12);
  }
  catchSound(x, z) {
    const c = this._ensure(); if (!c) return; const t = c.currentTime; const dest = this._at(x, z);
    [660, 990].forEach((f, i) => this._tone("triangle", f, t + i * 0.08, 0.01, 0.14, 0.2, dest));
  }
  miss(x, z) {
    const c = this._ensure(); if (!c) return; const t = c.currentTime; const dest = this._at(x, z);
    const o = c.createOscillator(); o.type = "square"; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.09);
    this._env(o, t, 0.005, 0.09, 0.08, dest); o.start(t); o.stop(t + 0.11);
  }
  /** Empty magazine: a dry mechanical click, deliberately nothing like a shot. */
  dryfire(x, z) {
    const c = this._ensure(); if (!c) return; const t = c.currentTime; const dest = this._at(x, z);
    const s1 = this._noise(0.02), f1 = c.createBiquadFilter();
    f1.type = "bandpass"; f1.frequency.value = 2600; f1.Q.value = 3;
    s1.connect(f1); this._env(f1, t, 0.001, 0.02, 0.10, dest); s1.start(t); s1.stop(t + 0.03);
    this._tone("square", 140, t + 0.01, 0.002, 0.03, 0.05, dest);
  }

  // ── the paint kit: the signature verb was completely silent ─────────────────
  /** Aerosol hiss, held while the button is down. spray(true) starts, spray(false) stops. */
  spray(on) {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    if (!on) {
      if (this._spray) { const s = this._spray; this._spray = null; try { s.g.gain.cancelScheduledValues(t); s.g.gain.setValueAtTime(s.g.gain.value, t); s.g.gain.linearRampToValueAtTime(0.0001, t + 0.12); s.src.stop(t + 0.16); } catch (e) {} }
      return;
    }
    if (this._spray) return;
    const src = this._noise(2.0); src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3800; bp.Q.value = 0.7;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.15, t + 0.04);
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(this.sfxBus);
    src.start(t);
    this._spray = { src, g };
  }
  /** One brush stroke — a short damp swish. */
  brush() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    const src = this._noise(0.09), bp = c.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.setValueAtTime(1500, t); bp.frequency.linearRampToValueAtTime(2400, t + 0.09); bp.Q.value = 0.9;
    src.connect(bp); this._env(bp, t, 0.008, 0.09, 0.09); src.start(t); src.stop(t + 0.1);
  }
  /** Rattle of the ball bearing — fired on tool change, so switching tools feels physical. */
  canShake() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    for (let i = 0; i < 3; i++) {
      const s = this._noise(0.025), f = c.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 900 + i * 120; f.Q.value = 2.5;
      s.connect(f); this._env(f, t + i * 0.09, 0.002, 0.025, 0.07); s.start(t + i * 0.09); s.stop(t + i * 0.09 + 0.04);
    }
  }
  /** Suction thump when you cling to something. */
  stick() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.13);
    this._env(o, t, 0.004, 0.13, 0.16); o.start(t); o.stop(t + 0.15);
    const s = this._noise(0.05), f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700;
    s.connect(f); this._env(f, t, 0.002, 0.05, 0.06); s.start(t); s.stop(t + 0.06);
  }
  jump() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(); o.type = "triangle";
    o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(560, t + 0.09);
    this._env(o, t, 0.004, 0.09, 0.07); o.start(t); o.stop(t + 0.11);
  }

  /**
   * Proximity tension. `p` is 0..1 (1 = a seeker is right on top of you). Rate and pitch
   * both rise, which is what makes it readable without a UI element — genre standard is
   * that the hider feels the threat before they see it.
   */
  heartbeat(p) {
    const c = this._ensure(); if (!c || !(p > 0.05)) return;
    const t = c.currentTime;
    const gap = 1.05 - 0.62 * Math.min(1, p);
    if (t - this._lastBeat < gap) return;
    this._lastBeat = t;
    const peak = 0.05 + 0.13 * p;
    for (let i = 0; i < 2; i++) {
      const o = c.createOscillator(); o.type = "sine";
      const f0 = (54 + 12 * p) * (i ? 0.86 : 1);
      o.frequency.setValueAtTime(f0 * 1.7, t + i * 0.15); o.frequency.exponentialRampToValueAtTime(f0, t + i * 0.15 + 0.1);
      this._env(o, t + i * 0.15, 0.012, 0.16, peak * (i ? 0.7 : 1));
      o.start(t + i * 0.15); o.stop(t + i * 0.15 + 0.2);
    }
  }

  // ── UI voice, deliberately separate from gameplay ───────────────────────────
  click()  { const c = this._ensure(); if (!c) return; this._tone("triangle", 1200, c.currentTime, 0.003, 0.03, 0.09); }
  hover()  { const c = this._ensure(); if (!c) return; this._tone("sine", 2000, c.currentTime, 0.002, 0.018, 0.04); }
  select() { const c = this._ensure(); if (!c) return; const t = c.currentTime; this._tone("triangle", 880, t, 0.004, 0.07, 0.10); this._tone("triangle", 1320, t + 0.07, 0.004, 0.09, 0.09); }
  back()   { const c = this._ensure(); if (!c) return; const t = c.currentTime; this._tone("triangle", 660, t, 0.004, 0.07, 0.09); this._tone("triangle", 440, t + 0.06, 0.004, 0.09, 0.08); }
  error()  { const c = this._ensure(); if (!c) return; this._tone("square", 200, c.currentTime, 0.005, 0.14, 0.10); }
  toggle() { const c = this._ensure(); if (!c) return; this._tone("square", 1500, c.currentTime, 0.002, 0.02, 0.05); }
  blip(up) { const c = this._ensure(); if (!c) return; this._tone("sine", up ? 880 : 500, c.currentTime, 0.005, 0.08, 0.12); }

  // ── phase stings: the round pivot used to happen in total silence ──────────
  countdown(n) {
    const c = this._ensure(); if (!c) return;
    this._tone("triangle", n <= 1 ? 1320 : 760, c.currentTime, 0.004, 0.11, 0.13);
  }
  /** Hiders released — go and hide. */
  roundStart() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    [523, 659, 784].forEach((f, i) => this._tone("triangle", f, t + i * 0.1, 0.01, 0.2, 0.13));
  }
  /** Seeker released — the loudest dramatic beat in the round. */
  huntStart() {
    const c = this._ensure(); if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.7);
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
    o.connect(lp); this._env(lp, t, 0.02, 0.7, 0.22); o.start(t); o.stop(t + 0.75);
    [392, 466].forEach((f, i) => this._tone("square", f, t + 0.05 + i * 0.12, 0.008, 0.18, 0.09));
  }
  win()  { const c = this._ensure(); if (!c) return; const t = c.currentTime; [523, 659, 784, 1047].forEach((f, i) => this._tone("triangle", f, t + i * 0.11, 0.01, 0.3, 0.15)); }
  lose() { const c = this._ensure(); if (!c) return; const t = c.currentTime; [392, 330, 262].forEach((f, i) => this._tone("triangle", f, t + i * 0.16, 0.01, 0.36, 0.13)); }

  /**
   * Room tone. An office hums, a street rumbles, a supermarket buzzes with refrigeration —
   * a single shared drone made all three maps feel like the same place.
   */
  startAmbience(kind) {
    const c = this._ensure(); if (!c) return;
    this.stopAmbience();
    const P = {
      office:      { lp: 300, gain: 0.045, hum: 120 },
      street:      { lp: 190, gain: 0.055, hum: 0 },
      supermarket: { lp: 420, gain: 0.040, hum: 100 },
    }[kind] || { lp: 260, gain: 0.04, hum: 0 };
    const src = this._noise(3.0); src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = P.lp;
    const g = c.createGain(); g.gain.value = 0.0001;
    src.connect(lp); lp.connect(g); g.connect(this.master);
    g.gain.linearRampToValueAtTime(P.gain, c.currentTime + 1.5);
    src.start();
    const parts = [src];
    if (P.hum) {                                     // mains hum for the indoor maps
      const o = c.createOscillator(); o.type = "sine"; o.frequency.value = P.hum;
      const og = c.createGain(); og.gain.value = 0.012;
      o.connect(og); og.connect(g); o.start(); parts.push(o);
    }
    this._amb = { parts, g };
  }
  stopAmbience() {
    if (!this._amb) return;
    const a = this._amb; this._amb = null;
    try { a.parts.forEach((p) => p.stop()); a.g.disconnect(); } catch (e) {}
  }

  /**
   * Phase music. The only place sample audio earns its bytes: a menu theme and a hunt
   * theme, 1.22 MB of CC0 total, fetched lazily so nothing blocks the first frame and a
   * player who dives straight into a round never pays for the menu track.
   * Crossfades, so the pivot into HUNT is a musical event rather than a hard cut.
   */
  async playTrack(name, { loop = true, gain = 0.32, fade = 1.5 } = {}) {
    const c = this._ensure(); if (!c) return;
    if (this._trackName === name) return;
    this._trackName = name;
    if (!this._trackBus) { this._trackBus = c.createGain(); this._trackBus.gain.value = 0; this._trackBus.connect(this.master); }
    if (!name) return this.stopTrack(fade);
    this._buffers = this._buffers || {};
    if (!this._buffers[name]) {
      try {
        const res = await fetch(`assets/music/${name}.ogg`);
        this._buffers[name] = await c.decodeAudioData(await res.arrayBuffer());
      } catch (e) { this._trackName = null; return; }        // music is never load-bearing
      if (this._trackName !== name) return;                  // phase moved on while decoding
    }
    const t = c.currentTime;
    if (this._track) { const old = this._track; try { old.g.gain.cancelScheduledValues(t); old.g.gain.setValueAtTime(old.g.gain.value, t); old.g.gain.linearRampToValueAtTime(0.0001, t + fade); old.src.stop(t + fade + 0.1); } catch (e) {} }
    const src = c.createBufferSource(); src.buffer = this._buffers[name]; src.loop = loop;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + fade);
    src.connect(g); g.connect(this._trackBus); this._trackBus.gain.value = 1; src.start(t);
    this._track = { src, g };
  }
  stopTrack(fade = 1.0) {
    const c = this.ctx; if (!c || !this._track) { this._trackName = null; return; }
    const t = c.currentTime, old = this._track;
    this._track = null; this._trackName = null;
    try { old.g.gain.cancelScheduledValues(t); old.g.gain.setValueAtTime(old.g.gain.value, t); old.g.gain.linearRampToValueAtTime(0.0001, t + fade); old.src.stop(t + fade + 0.1); } catch (e) {}
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
