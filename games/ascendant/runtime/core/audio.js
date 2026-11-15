/* ============================================================================
 * ASCENDANT — runtime/core/audio.js
 * Contract §5.  100% PROCEDURAL Web Audio. Zero audio files, zero fetches.
 *
 *   destination
 *     <- limiter (DynamicsCompressor)
 *        <- master (Gain) <- dcCut (Highpass 26 Hz)
 *           <- musicDuck <- musicBus <- bed.out  (5 generative beds)
 *           <- sfxBus    <- one-shot + looping voices
 *           <- verbReturn <- algorithmic FDN reverb <- per-voice sends
 *
 * Five musically distinct beds — neon / foundry / spire / temple / hub — each a
 * look-ahead-scheduled generative loop (25 ms tick, 120 ms horizon) built from
 * oscillators, noise buffers and biquads. `setTheme` crossfades over 1.2 s.
 *
 * Safety rules honoured throughout:
 *  • never exponentialRampToValueAtTime toward 0 (only linear ramps + setTarget)
 *  • every AudioParam value clamped finite before it is scheduled
 *  • every scheduled time clamped to >= ctx.currentTime
 *  • the whole scheduler tick is wrapped in try/catch
 *  • a suspended context (page mute from game_controls.js) is detected and the
 *    scheduler idles + resyncs instead of building a backlog. We never call
 *    ctx.resume() while the page-level mute is engaged.
 * ==========================================================================*/

const IS_BROWSER = typeof window !== 'undefined';

const LOOKAHEAD_MS = 25;
const HORIZON = 0.12;
const CROSSFADE = 1.2;
const MAX_VOICES = 30;

const DEFAULT_VOL = { master: 0.8, music: 0.6, sfx: 0.9 };

/* Looping (positional) sfx — `sfx()` returns a handle for these. */
const LOOP_SFX = { saw_whirr: 1, wind: 1, portal_hum: 1, lava_flow: 1 };

/* Contract §5 short names -> the full synthesised sound. */
const ALIAS = {
  land: 'land_soft',
  laser: 'laser_fire',
  crush: 'crusher_slam',
  vanish: 'vanish_warn',
  step: 'step_stone',
  saw: 'saw_whirr',
  portal: 'portal_hum',
  ui_cancel: 'ui_back',
};

/* Critical sounds that ignore the voice cap. */
const CRITICAL = { death: 1, finish: 1, checkpoint: 1, crusher_slam: 1, laser_fire: 1 };

/* --------------------------------------------------------------- helpers */
function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function fin(v, def) { return (typeof v === 'number' && Number.isFinite(v)) ? v : def; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/* Per-bed note material. Nothing is shared between beds — five separate ideas. */
const NEON_CHORDS = [
  { root: 45, arp: [57, 60, 64, 69], pad: [57, 60, 64, 72] },  // Am
  { root: 41, arp: [53, 57, 60, 65], pad: [53, 57, 60, 69] },  // F
  { root: 48, arp: [55, 60, 64, 67], pad: [55, 60, 64, 72] },  // C
  { root: 43, arp: [50, 55, 59, 62], pad: [50, 55, 59, 67] },  // G
];
const NEON_ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 3, 2, 1, 0];
const NEON_ARP_OCT = [0, 0, 0, 0, 0, 0, 0, 0, 12, 12, 12, 12, 0, 0, 0, 0];
const NEON_HAT = [0.55, 0, 0.22, 0.34, 0.55, 0, 0.26, 0.20, 0.55, 0, 0.22, 0.40, 0.55, 0.18, 0.30, 0.44];
const NEON_KICK = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const NEON_SUB = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];

const FOUNDRY_HITS = [1.0, 0, 0, 0.5, 0, 0, 0.75, 0, 0, 0, 0.62, 0.4, 0, 0, 0.85, 0];
const FOUNDRY_MOTIF = [[50, 53], [52, 55], [53, 56], [55, 58]];   // rising minor thirds
const FOUNDRY_PARTIALS = [1870, 2790, 4130, 5610, 7220];

const SPIRE_BELLS = [66, 73, 69, 78, 61, 76, 66, 73];
const SPIRE_PADS = [
  [42, 49, 54, 57, 61],   // F#m9
  [38, 45, 50, 57, 61],   // Dmaj7
  [37, 44, 49, 56, 61],   // C#m(add9)
  [35, 42, 47, 54, 59],   // Bm
];

const TEMPLE_PENTA = [64, 67, 69, 71, 74, 76, 79];
const TEMPLE_OSTINATO = [0, -1, 2, 4, -1, 1, 3, -1, 0, 2, -1, 5, 3, -1, 1, 4];
const TEMPLE_CHORDS = [
  [52, 59, 64, 67],   // Em
  [48, 55, 64, 67],   // Cmaj7
  [55, 59, 62, 67],   // G
  [50, 57, 62, 66],   // D
];
const TEMPLE_FORMANTS = [700, 1220, 2600];

const HUB_CHORDS = [
  [48, 55, 59, 62, 64],   // Cmaj9
  [45, 52, 55, 60, 64],   // Am7
  [41, 48, 52, 57, 60],   // Fmaj7
  [43, 50, 55, 59, 62],   // G6
];
const HUB_PLUCK = [0, -1, -1, 2, -1, 1, -1, 3];

/* Land/step surface personalities. */
const SURFACE_RING = {
  metal: [1420, 2340, 3510],
  ice: [2650, 4180, 6100],
  stone: [430, 780, 1180],
  grate: [1180, 1720, 2960],
  rubber: [180, 260, 420],
};

/* ==========================================================================
 * Audio
 * ========================================================================*/
export class Audio {
  constructor() {
    this.ctx = null;
    this.available = IS_BROWSER && !!(window.AudioContext || window.webkitAudioContext);
    this.ready = false;
    this.theme = null;

    this.vol = { master: DEFAULT_VOL.master, music: DEFAULT_VOL.music, sfx: DEFAULT_VOL.sfx };

    this._active = [];                    // beds currently scheduling (current + fading)
    this._pendingTheme = null;
    this._timer = 0;
    this._live = 0;          // music voices in flight
    this._sfxLive = 0;       // sfx voices in flight (the cap applies to these)
    this._inSfx = false;     // set while an sfx voice is being built
    this._loops = new Map();
    this._loopSeq = 1;
    this._lastPlay = Object.create(null); // per-name throttle
    this._pageMuted = false;
    this._rng = 1337;

    this._noiseBuf = null;
    this._pinkBuf = null;

    if (IS_BROWSER) {
      this._onMuteChange = (e) => {
        this._pageMuted = !!(e && e.detail && e.detail.muted);
        if (!this._pageMuted) this._resume();
        else this._resyncBeds();
      };
      window.addEventListener('mutechange', this._onMuteChange, false);
      try {
        if (window.__CONTROLS__ && window.__CONTROLS__.isMuted) this._pageMuted = !!window.__CONTROLS__.isMuted();
      } catch (e) {}
    }
  }

  /* ------------------------------------------------- deterministic-ish rng */
  _rand() {
    /* mulberry32 — keeps footstep jitter cheap and allocation free. */
    this._rng = (this._rng + 0x6D2B79F5) | 0;
    let t = this._rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  _jit(spread) { return 1 + (this._rand() * 2 - 1) * spread; }

  /* ====================================================================
   * init — MUST be called from a user gesture
   * ==================================================================*/
  init() {
    if (this.ctx) { this._resume(); return this; }
    if (!this.available) return this;
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      this.ctx = new AC();
    } catch (e) {
      this.available = false;
      return this;
    }

    try {
      this._buildBuffers();
      this._buildGraph();
      this.ready = true;
    } catch (e) {
      this.available = false;
      this.ready = false;
      return this;
    }

    this._resume();
    this._startScheduler();

    if (this._pendingTheme) {
      const t = this._pendingTheme;
      this._pendingTheme = null;
      this.setTheme(t);
    }
    return this;
  }

  _resume() {
    if (!this.ctx) return;
    if (this._pageMuted) return;                       // game_controls owns the mute
    if (this.ctx.state === 'suspended') {
      try { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    }
  }

  _buildBuffers() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * 2);

    const white = ctx.createBuffer(1, n, sr);
    const wd = white.getChannelData(0);
    for (let i = 0; i < n; i++) wd[i] = Math.random() * 2 - 1;
    this._noiseBuf = white;

    /* Pink-ish via the Paul Kellet economy filter — for wind/pads. */
    const pink = ctx.createBuffer(1, n, sr);
    const pd = pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      pd[i] = clamp(out, -1, 1);
    }
    this._pinkBuf = pink;
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -7;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.26;
    this.limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.vol.master;

    this.dcCut = ctx.createBiquadFilter();
    this.dcCut.type = 'highpass';
    this.dcCut.frequency.value = 26;
    this.dcCut.Q.value = 0.5;
    this.dcCut.connect(this.limiter);
    this.master.connect(this.dcCut);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.vol.music;
    this.musicDuck = ctx.createGain();
    this.musicDuck.gain.value = 1;
    this.musicBus.connect(this.musicDuck);
    this.musicDuck.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.vol.sfx;
    this.sfxBus.connect(this.master);

    this._buildReverb();
  }

  /** Feedback-delay-network reverb: 4 damped combs -> 2 allpass -> stereo. */
  _buildReverb() {
    const ctx = this.ctx;

    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 1;

    const pre = ctx.createDelay(0.2);
    pre.delayTime.value = 0.013;
    this.verbIn.connect(pre);

    const combSum = ctx.createGain();
    combSum.gain.value = 0.26;

    const times = [0.0297, 0.0371, 0.0411, 0.0437];
    const fbs = [0.805, 0.827, 0.783, 0.764];
    this._verbNodes = [pre, combSum];

    for (let i = 0; i < times.length; i++) {
      const d = ctx.createDelay(0.5);
      d.delayTime.value = times[i];
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3400;
      lp.Q.value = 0.4;
      const fb = ctx.createGain();
      fb.gain.value = fbs[i];
      pre.connect(d);
      d.connect(lp);
      lp.connect(fb);
      fb.connect(d);           // the cycle contains a DelayNode — legal + stable
      d.connect(combSum);
      this._verbNodes.push(d, lp, fb);
    }

    let node = combSum;
    const apTimes = [0.00507, 0.00171];
    for (let i = 0; i < apTimes.length; i++) {
      const g = 0.55;
      const sum = ctx.createGain(); sum.gain.value = 1;
      const d = ctx.createDelay(0.1); d.delayTime.value = apTimes[i];
      const fb = ctx.createGain(); fb.gain.value = g;
      const ff = ctx.createGain(); ff.gain.value = -g;
      const out = ctx.createGain(); out.gain.value = 1;
      node.connect(sum);
      sum.connect(d);
      d.connect(fb);
      fb.connect(sum);
      d.connect(out);
      sum.connect(ff);
      ff.connect(out);
      this._verbNodes.push(sum, d, fb, ff, out);
      node = out;
    }

    const tone = ctx.createBiquadFilter();
    tone.type = 'highpass';
    tone.frequency.value = 180;
    node.connect(tone);

    const spread = ctx.createDelay(0.05);
    spread.delayTime.value = 0.0093;
    tone.connect(spread);

    const merger = ctx.createChannelMerger(2);
    tone.connect(merger, 0, 0);
    spread.connect(merger, 0, 1);

    this.verbReturn = ctx.createGain();
    this.verbReturn.gain.value = 0.9;
    merger.connect(this.verbReturn);
    this.verbReturn.connect(this.master);
    this._verbNodes.push(tone, spread, merger);
  }

  /* ====================================================================
   * Param helpers — every value clamped, every time clamped
   * ==================================================================*/
  _at(t) {
    const now = this.ctx ? this.ctx.currentTime : 0;
    const v = fin(t, now);
    return v < now ? now : v;
  }

  _set(param, v, t) {
    try { param.setValueAtTime(clamp(fin(v, 0), -1e4, 1e4), this._at(t)); } catch (e) {}
  }

  _ramp(param, v, t) {
    try { param.linearRampToValueAtTime(clamp(fin(v, 0), -1e4, 1e4), this._at(t)); } catch (e) {}
  }

  _target(param, v, t, tau) {
    try { param.setTargetAtTime(clamp(fin(v, 0), -1e4, 1e4), this._at(t), Math.max(0.002, fin(tau, 0.05))); } catch (e) {}
  }

  /** Attack / decay envelope on a gain, never exponential toward zero. */
  _env(gain, t, peak, attack, decay, sustain, hold) {
    const p = clamp(fin(peak, 0.2), 0, 4);
    const a = Math.max(0.0008, fin(attack, 0.004));
    const d = Math.max(0.01, fin(decay, 0.2));
    const s = clamp(fin(sustain, 0), 0, 4);
    const h = Math.max(0, fin(hold, 0));
    this._set(gain, 0, t);
    this._ramp(gain, p, t + a);
    if (h > 0) {
      this._ramp(gain, p, t + a + h);
      this._ramp(gain, s, t + a + h + d);
    } else {
      this._ramp(gain, s, t + a + d);
    }
    return t + a + h + d;
  }

  _gain(v) { const g = this.ctx.createGain(); g.gain.value = clamp(fin(v, 1), 0, 8); return g; }

  _osc(type, freq, t) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = clamp(fin(freq, 440), 0.01, 20000);
    return o;
  }

  _filter(type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = clamp(fin(freq, 1000), 10, 20000);
    if (q !== undefined) f.Q.value = clamp(fin(q, 1), 0.0001, 40);
    return f;
  }

  _noise(rate, pink) {
    const s = this.ctx.createBufferSource();
    s.buffer = pink ? this._pinkBuf : this._noiseBuf;
    s.loop = true;
    s.playbackRate.value = clamp(fin(rate, 1), 0.06, 6);
    return s;
  }

  /**
   * Stop + auto-disconnect a finished voice.
   * Music and sfx are counted in separate buckets: the voice cap in sfx() must
   * never be tripped by a busy music bed, or gameplay audio would drop out.
   */
  _kill(stopAt, srcs, nodes) {
    const t = this._at(stopAt);
    let last = null;
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i];
      if (!s) continue;
      try { s.stop(t); } catch (e) {}
      last = s;
    }
    if (!last) return;
    const isSfx = this._inSfx;
    if (isSfx) this._sfxLive++; else this._live++;
    last.onended = () => {
      if (isSfx) this._sfxLive--; else this._live--;
      for (let i = 0; i < srcs.length; i++) { try { if (srcs[i]) srcs[i].disconnect(); } catch (e) {} }
      if (nodes) for (let i = 0; i < nodes.length; i++) { try { if (nodes[i]) nodes[i].disconnect(); } catch (e) {} }
    };
  }

  /** Per-voice reverb send into a specific wet bus. */
  _sendTo(dest, node, amount) {
    if (!dest || !(amount > 0)) return null;
    const g = this._gain(clamp(amount, 0, 1.5));
    node.connect(g);
    g.connect(dest);
    return g;
  }

  /** Per-voice reverb send straight to the global tank (sfx). */
  _send(node, amount) {
    return this._sendTo(this.verbIn, node, amount);
  }

  /* ====================================================================
   * Volumes / duck / mute
   * ==================================================================*/
  setVolumes(v) {
    if (!v || typeof v !== 'object') return;
    if (typeof v.master === 'number') this.vol.master = clamp(fin(v.master, DEFAULT_VOL.master), 0, 1);
    if (typeof v.music === 'number') this.vol.music = clamp(fin(v.music, DEFAULT_VOL.music), 0, 1);
    if (typeof v.sfx === 'number') this.vol.sfx = clamp(fin(v.sfx, DEFAULT_VOL.sfx), 0, 1);
    if (!this.ctx || !this.ready) return;
    const t = this.ctx.currentTime + 0.02;
    this._ramp(this.master.gain, this.vol.master, t);
    this._ramp(this.musicBus.gain, this.vol.music, t);
    this._ramp(this.sfxBus.gain, this.vol.sfx, t);
  }

  /** Dip the music bed (death / finish). */
  duck(ms) {
    if (!this.ctx || !this.ready) return;
    const d = clamp(fin(ms, 600), 80, 6000) / 1000;
    const t = this.ctx.currentTime;
    const g = this.musicDuck.gain;
    try { g.cancelScheduledValues(t); } catch (e) {}
    this._set(g, fin(g.value, 1), t);
    this._ramp(g, 0.22, t + 0.05);
    this._ramp(g, 0.22, t + d * 0.55);
    this._ramp(g, 1, t + d);
  }

  /* ====================================================================
   * Music beds + look-ahead scheduler
   * ==================================================================*/
  _startScheduler() {
    if (this._timer || !IS_BROWSER) return;
    this._timer = setInterval(() => this._tick(), LOOKAHEAD_MS);
  }

  _stopScheduler() {
    if (this._timer) { clearInterval(this._timer); this._timer = 0; }
  }

  _resyncBeds() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this._active.length; i++) {
      const b = this._active[i];
      if (b.nextTime < now) {
        /* Snap forward to the next bar so the phrase never restarts mid-beat. */
        const spb = b.stepsPerBar;
        b.stepIdx = Math.ceil(b.stepIdx / spb) * spb;
        b.nextTime = now + 0.05;
      }
    }
  }

  _tick() {
    try {
      const ctx = this.ctx;
      if (!ctx || !this.ready) return;
      if (ctx.state !== 'running') { this._resyncBeds(); return; }

      const now = ctx.currentTime;
      const horizon = now + HORIZON;

      for (let i = this._active.length - 1; i >= 0; i--) {
        const bed = this._active[i];
        if (bed.nextTime < now - 0.4) {
          const spb = bed.stepsPerBar;
          bed.stepIdx = Math.ceil(bed.stepIdx / spb) * spb;
          bed.nextTime = now + 0.03;
        }
        let guard = 0;
        while (bed.nextTime < horizon && guard++ < 64) {
          try { bed.step(bed, bed.stepIdx, bed.nextTime); } catch (e) { /* one bad step never stops the music */ }
          bed.stepIdx++;
          bed.nextTime += bed.stepDur;
        }
        if (bed.retireAt > 0 && now >= bed.retireAt) {
          this._teardownBed(bed);
          this._active.splice(i, 1);
        }
      }
    } catch (e) { /* the scheduler must never throw into the page */ }
  }

  /**
   * Crossfade to another bed over 1.2 s. Unknown ids stop the music cleanly.
   */
  setTheme(themeId) {
    const id = typeof themeId === 'string' ? themeId : null;
    if (!this.ctx || !this.ready) { this._pendingTheme = id; return; }
    if (this.theme === id) return;
    const now = this.ctx.currentTime;

    /* Retire whatever is playing. */
    for (let i = 0; i < this._active.length; i++) {
      const b = this._active[i];
      if (b.retireAt > 0) continue;
      this._ramp(b.out.gain, fin(b.out.gain.value, 1), now);
      this._ramp(b.out.gain, 0, now + CROSSFADE);
      this._ramp(b.rev.gain, fin(b.rev.gain.value, 1), now);
      this._ramp(b.rev.gain, 0, now + CROSSFADE);
      b.retireAt = now + CROSSFADE + 0.35;
    }

    this.theme = id;
    if (!id) return;

    const bed = this._makeBed(id);
    if (!bed) return;
    bed.retireAt = 0;
    bed.stepIdx = 0;
    bed.nextTime = now + 0.06;
    this._set(bed.out.gain, 0, now);
    this._ramp(bed.out.gain, bed.level, now + CROSSFADE);
    this._set(bed.rev.gain, 0, now);
    this._ramp(bed.rev.gain, bed.revLevel, now + CROSSFADE);
    this._active.push(bed);
  }

  _teardownBed(bed) {
    try { bed.out.disconnect(); } catch (e) {}
    if (bed.nodes) {
      for (let i = 0; i < bed.nodes.length; i++) { try { bed.nodes[i].disconnect(); } catch (e) {} }
    }
    if (bed.srcs) {
      const t = this.ctx ? this.ctx.currentTime : 0;
      for (let i = 0; i < bed.srcs.length; i++) { try { bed.srcs[i].stop(t); } catch (e) {} }
    }
  }

  _bedBase(id, bpm, stepsPerBeat, level, revAmount) {
    const out = this._gain(0);
    out.connect(this.musicBus);
    /* Wet bus starts silent and is crossfaded with the dry bus, otherwise a
       long pad tail keeps ringing in the reverb after the theme has changed. */
    const rev = this._gain(0);
    rev.connect(this.verbIn);
    return {
      id, bpm,
      stepsPerBeat,
      stepsPerBar: stepsPerBeat * 4,
      stepDur: 60 / bpm / stepsPerBeat,
      level: clamp(level, 0, 1.2),
      revLevel: clamp(revAmount, 0, 1),
      out, rev,
      nodes: [out, rev],
      srcs: [],
      stepIdx: 0,
      nextTime: 0,
      retireAt: 0,
      step: null,
    };
  }

  _makeBed(id) {
    switch (id) {
      case 'neon': return this._bedNeon();
      case 'foundry': return this._bedFoundry();
      case 'spire': return this._bedSpire();
      case 'temple': return this._bedTemple();
      case 'hub': return this._bedHub();
      default: return null;
    }
  }

  /* ------------------------------------------------------------- NEON
   * 96 BPM synthwave: detuned saw-stack arpeggio in A minor, a pad that is
   * sidechain-pumped by the kick, gated hats and a plucked sub.
   * ----------------------------------------------------------------- */
  _bedNeon() {
    const bed = this._bedBase('neon', 96, 4, 0.62, 0.20);
    const sc = this._gain(1);          // sidechain victim: pad only
    sc.connect(bed.out);
    bed.sidechain = sc;
    bed.nodes.push(sc);
    bed.step = (b, i, t) => this._stepNeon(b, i, t);
    return bed;
  }

  _stepNeon(bed, i, t) {
    const s = i % 16;
    const bar = Math.floor(i / 16) % 4;
    const ch = NEON_CHORDS[bar];

    /* Kick + sidechain pump */
    if (NEON_KICK[s]) {
      const o = this._osc('sine', 132, t);
      const g = this._gain(0);
      o.connect(g); g.connect(bed.out);
      this._set(o.frequency, 132, t);
      this._ramp(o.frequency, 44, t + 0.085);
      this._env(g.gain, t, 0.72, 0.002, 0.19, 0);
      const cl = this._noise(1.6, false);
      const cf = this._filter('bandpass', 2400, 1.2);
      const cg = this._gain(0);
      cl.connect(cf); cf.connect(cg); cg.connect(bed.out);
      this._env(cg.gain, t, 0.10, 0.001, 0.026, 0);
      cl.start(t, this._rand() * 1.6);
      o.start(t);
      this._kill(t + 0.28, [o, cl], [g, cf, cg]);

      const p = bed.sidechain.gain;
      this._set(p, 1, t);
      this._ramp(p, 0.24, t + 0.022);
      this._ramp(p, 1, t + 0.30);
    }

    /* Snare/clap on 2 and 4 */
    if (s === 4 || s === 12) {
      const n = this._noise(1, false);
      const bp = this._filter('bandpass', 1850, 1.0);
      const hp = this._filter('highpass', 620, 0.7);
      const g = this._gain(0);
      n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(bed.out);
      this._env(g.gain, t, 0.30, 0.002, 0.15, 0);
      const body = this._osc('triangle', 210, t);
      const bg = this._gain(0);
      body.connect(bg); bg.connect(bed.out);
      this._ramp(body.frequency, 150, t + 0.06);
      this._env(bg.gain, t, 0.13, 0.001, 0.07, 0);
      this._sendTo(bed.rev, g, 0.22);
      n.start(t, this._rand() * 1.5);
      body.start(t);
      this._kill(t + 0.24, [n, body], [bp, hp, g, bg]);
    }

    /* Gated hats */
    const hv = NEON_HAT[s];
    if (hv > 0) {
      const n = this._noise(this._jit(0.08), false);
      const hp = this._filter('highpass', 8200, 0.8);
      const bp = this._filter('bandpass', 11000, 0.9);
      const g = this._gain(0);
      n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(bed.out);
      const dur = hv > 0.5 ? 0.052 : 0.030;
      this._env(g.gain, t, hv * 0.13, 0.001, dur, 0);
      n.start(t, this._rand() * 1.7);
      this._kill(t + dur + 0.03, [n], [hp, bp, g]);
    }

    /* Saw-stack arpeggio */
    const arpN = ch.arp[NEON_ARP[s]] + NEON_ARP_OCT[s];
    const f = mtof(arpN);
    const lp = this._filter('lowpass', 2600, 7);
    const g = this._gain(0);
    lp.connect(g); g.connect(bed.out);
    const dets = [-9, 0, 9];
    const oscs = [];
    const vnodes = [lp, g];
    for (let k = 0; k < 3; k++) {
      const o = this._osc('sawtooth', f, t);
      o.detune.value = dets[k];
      const og = this._gain(k === 1 ? 0.34 : 0.24);
      o.connect(og); og.connect(lp);
      vnodes.push(og);
      oscs.push(o);
      o.start(t);
    }
    this._set(lp.frequency, 3200, t);
    this._ramp(lp.frequency, 760, t + 0.17);
    this._env(g.gain, t, 0.20, 0.004, 0.14, 0);
    this._sendTo(bed.rev, g, 0.16);
    this._kill(t + 0.22, oscs, vnodes);

    /* Sub bass pluck */
    if (NEON_SUB[s]) {
      const o = this._osc('sine', mtof(ch.root - 12), t);
      const o2 = this._osc('triangle', mtof(ch.root), t);
      const gg = this._gain(0);
      const g2 = this._gain(0.14);
      o.connect(gg); o2.connect(g2); g2.connect(gg); gg.connect(bed.out);
      this._env(gg.gain, t, 0.42, 0.005, 0.20, 0);
      o.start(t); o2.start(t);
      this._kill(t + 0.26, [o, o2], [gg, g2]);
    }

    /* Pad: one long chord per bar, through the sidechain */
    if (s === 0) {
      const dur = bed.stepDur * 16;
      const lp2 = this._filter('lowpass', 1500, 0.9);
      const pg = this._gain(0);
      lp2.connect(pg); pg.connect(bed.sidechain);
      const srcs = [];
      const vnodes = [lp2, pg];
      for (let k = 0; k < ch.pad.length; k++) {
        const o = this._osc(k % 2 === 0 ? 'sawtooth' : 'square', mtof(ch.pad[k]), t);
        o.detune.value = (k - 1.5) * 7;
        const og = this._gain(0.12);
        o.connect(og); og.connect(lp2);
        vnodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      this._set(pg.gain, 0, t);
      this._ramp(pg.gain, 0.30, t + 0.35);
      this._ramp(pg.gain, 0.30, t + dur - 0.25);
      this._ramp(pg.gain, 0, t + dur + 0.05);
      this._sendTo(bed.rev, pg, 0.18);
      this._kill(t + dur + 0.12, srcs, vnodes);
    }
  }

  /* ---------------------------------------------------------- FOUNDRY
   * 84 BPM industrial in D: inharmonic filtered-noise metal strikes, a heavy
   * detuned drone, and a minor-third motif that climbs every two bars.
   * ----------------------------------------------------------------- */
  _bedFoundry() {
    const bed = this._bedBase('foundry', 84, 4, 0.58, 0.34);
    bed.step = (b, i, t) => this._stepFoundry(b, i, t);
    return bed;
  }

  _stepFoundry(bed, i, t) {
    const s = i % 16;
    const bar = Math.floor(i / 16);

    /* Metal strike bank */
    const v = FOUNDRY_HITS[s];
    if (v > 0) {
      const n = this._noise(this._jit(0.1), false);
      const pre = this._filter('highpass', 300, 0.7);
      const out = this._gain(0);
      n.connect(pre);
      const nodes = [pre, out];
      for (let k = 0; k < FOUNDRY_PARTIALS.length; k++) {
        const bp = this._filter('bandpass', FOUNDRY_PARTIALS[k] * this._jit(0.02), 24);
        const bg = this._gain(0.9 / (1 + k * 0.65));
        pre.connect(bp); bp.connect(bg); bg.connect(out);
        nodes.push(bp, bg);
      }
      out.connect(bed.out);
      this._env(out.gain, t, v * 0.34, 0.0015, 0.44, 0);
      this._sendTo(bed.rev, out, 0.42);
      n.start(t, this._rand() * 1.6);
      this._kill(t + 0.55, [n], nodes);
    }

    /* Low anvil boom */
    if (s === 0 || s === 8) {
      const o = this._osc('sine', 66, t);
      const g = this._gain(0);
      o.connect(g); g.connect(bed.out);
      this._ramp(o.frequency, 36, t + 0.14);
      this._env(g.gain, t, s === 0 ? 0.55 : 0.34, 0.003, 0.34, 0);
      const th = this._noise(0.55, true);
      const lp = this._filter('lowpass', 220, 1.2);
      const tg = this._gain(0);
      th.connect(lp); lp.connect(tg); tg.connect(bed.out);
      this._env(tg.gain, t, 0.20, 0.002, 0.22, 0);
      o.start(t); th.start(t, this._rand() * 1.5);
      this._kill(t + 0.42, [o, th], [g, lp, tg]);
    }

    /* Drone — one long voice every 4 bars, with a slow filter sweep */
    if (s === 0 && bar % 4 === 0) {
      const dur = bed.stepDur * 16 * 4;
      const lp = this._filter('lowpass', 190, 3.2);
      const g = this._gain(0);
      lp.connect(g); g.connect(bed.out);
      const notes = [26, 33, 38, 45];
      const srcs = [];
      const vnodes = [lp, g];
      for (let k = 0; k < notes.length; k++) {
        const o = this._osc(k < 2 ? 'sawtooth' : 'triangle', mtof(notes[k]), t);
        o.detune.value = (k % 2 === 0 ? -7 : 8) + k * 2;
        const og = this._gain(k < 2 ? 0.30 : 0.16);
        o.connect(og); og.connect(lp);
        vnodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      this._set(lp.frequency, 175, t);
      this._ramp(lp.frequency, 430, t + dur * 0.5);
      this._ramp(lp.frequency, 180, t + dur);
      this._set(g.gain, 0, t);
      this._ramp(g.gain, 0.30, t + 1.6);
      this._ramp(g.gain, 0.30, t + dur - 1.2);
      this._ramp(g.gain, 0, t + dur + 0.1);
      this._sendTo(bed.rev, g, 0.20);
      this._kill(t + dur + 0.2, srcs, vnodes);
    }

    /* Rising minor-third motif, one pair per 2 bars */
    if (s === 0 && bar % 2 === 0) {
      const pair = FOUNDRY_MOTIF[Math.floor(bar / 2) % FOUNDRY_MOTIF.length];
      const beat = bed.stepDur * 4;
      for (let k = 0; k < 2; k++) {
        const at = t + k * beat * 2;
        const o = this._osc('square', mtof(pair[k]), at);
        const o2 = this._osc('sawtooth', mtof(pair[k] - 12), at);
        const lp = this._filter('lowpass', 900, 5);
        const g = this._gain(0);
        const g2 = this._gain(0.22);
        o.connect(lp); o2.connect(g2); g2.connect(lp);
        lp.connect(g); g.connect(bed.out);
        this._set(lp.frequency, 620, at);
        this._ramp(lp.frequency, 1800, at + 0.5);
        this._ramp(lp.frequency, 700, at + beat * 1.7);
        this._env(g.gain, at, 0.17, 0.09, 0.75, 0, beat * 0.85);
        this._sendTo(bed.rev, g, 0.5);
        o.start(at); o2.start(at);
        this._kill(at + beat * 1.9, [o, o2], [lp, g, g2]);
      }
    }

    /* Steam release every 8 bars */
    if (s === 12 && bar % 8 === 7) {
      const n = this._noise(1, true);
      const bp = this._filter('bandpass', 1100, 1.4);
      const g = this._gain(0);
      n.connect(bp); bp.connect(g); g.connect(bed.out);
      this._set(bp.frequency, 900, t);
      this._ramp(bp.frequency, 3400, t + 1.4);
      this._env(g.gain, t, 0.20, 0.28, 1.15, 0);
      this._sendTo(bed.rev, g, 0.3);
      n.start(t, this._rand() * 1.4);
      this._kill(t + 1.8, [n], [bp, g]);
    }
  }

  /* ------------------------------------------------------------ SPIRE
   * 72 BPM glacial ambient in F# minor: FM bells, a very wide detuned pad,
   * moving wind noise, and a sub pulse every four bars. No drums at all.
   * ----------------------------------------------------------------- */
  _bedSpire() {
    const bed = this._bedBase('spire', 72, 2, 0.58, 0.62);
    bed.step = (b, i, t) => this._stepSpire(b, i, t);
    return bed;
  }

  _stepSpire(bed, i, t) {
    const s = i % 8;
    const bar = Math.floor(i / 8);

    /* FM bell */
    if (s === 0 || s === 3 || s === 5) {
      const idx = (bar * 3 + s) % SPIRE_BELLS.length;
      const f = mtof(SPIRE_BELLS[idx] + (bar % 4 === 3 ? 12 : 0));
      const car = this._osc('sine', f, t);
      const mod = this._osc('sine', f * 3.51, t);
      const modG = this._gain(0);
      const g = this._gain(0);
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      mod.connect(modG);
      modG.connect(car.frequency);
      car.connect(g);
      if (pan) { pan.pan.value = clamp((this._rand() * 2 - 1) * 0.55, -1, 1); g.connect(pan); pan.connect(bed.out); }
      else g.connect(bed.out);
      this._set(modG.gain, f * 1.6, t);
      this._ramp(modG.gain, f * 0.05, t + 0.9);
      this._ramp(modG.gain, 0, t + 2.4);
      this._env(g.gain, t, 0.20, 0.004, 2.6, 0);
      this._sendTo(bed.rev, g, 0.85);
      car.start(t); mod.start(t);
      this._kill(t + 2.9, [car, mod], [modG, g, pan]);
    }

    /* Wide pad — a new 4-bar chord every 4 bars */
    if (s === 0 && bar % 4 === 0) {
      const dur = bed.stepDur * 8 * 4;
      const chord = SPIRE_PADS[Math.floor(bar / 4) % SPIRE_PADS.length];
      const lp = this._filter('lowpass', 980, 0.8);
      const g = this._gain(0);
      lp.connect(g); g.connect(bed.out);
      const srcs = [];
      const vnodes = [lp, g];
      const dets = [-11, -4, 0, 5, 12];
      for (let k = 0; k < chord.length; k++) {
        const o = this._osc(k % 2 === 0 ? 'sawtooth' : 'triangle', mtof(chord[k]), t);
        o.detune.value = dets[k % dets.length];
        const og = this._gain(0.13);
        const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        o.connect(og);
        if (pan) { pan.pan.value = clamp((k / (chord.length - 1)) * 1.5 - 0.75, -1, 1); og.connect(pan); pan.connect(lp); vnodes.push(pan); }
        else og.connect(lp);
        vnodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      this._set(g.gain, 0, t);
      this._ramp(g.gain, 0.34, t + 3.0);
      this._ramp(g.gain, 0.30, t + dur - 2.6);
      this._ramp(g.gain, 0, t + dur + 0.2);
      this._sendTo(bed.rev, g, 0.55);
      this._kill(t + dur + 0.4, srcs, vnodes);
    }

    /* Wind — overlapping 6 s noise voices */
    if (s === 0 && bar % 2 === 0) {
      const n = this._noise(0.55, true);
      const bp = this._filter('bandpass', 420, 1.1);
      const hp = this._filter('highpass', 190, 0.6);
      const g = this._gain(0);
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      n.connect(bp); bp.connect(hp); hp.connect(g);
      if (pan) { pan.pan.value = clamp((this._rand() * 2 - 1) * 0.7, -1, 1); g.connect(pan); pan.connect(bed.out); }
      else g.connect(bed.out);
      const dur = 6.2;
      this._set(bp.frequency, 330, t);
      this._ramp(bp.frequency, 880 * this._jit(0.2), t + dur * 0.45);
      this._ramp(bp.frequency, 360, t + dur);
      this._env(g.gain, t, 0.15, 1.7, 2.6, 0, 1.4);
      this._sendTo(bed.rev, g, 0.4);
      n.start(t, this._rand() * 1.5);
      this._kill(t + dur + 0.3, [n], [bp, hp, g, pan]);
    }

    /* Sub pulse */
    if (s === 0 && bar % 4 === 2) {
      const o = this._osc('sine', mtof(30), t);
      const g = this._gain(0);
      o.connect(g); g.connect(bed.out);
      this._env(g.gain, t, 0.34, 0.5, 1.9, 0, 0.4);
      o.start(t);
      this._kill(t + 3.0, [o], [g]);
    }
  }

  /* ----------------------------------------------------------- TEMPLE
   * 88 BPM airy orchestral-electronic: pentatonic pluck ostinato, a vowel
   * formant pad, soft taiko with flams, and a quiet shaker.
   * ----------------------------------------------------------------- */
  _bedTemple() {
    const bed = this._bedBase('temple', 88, 4, 0.60, 0.42);
    bed.step = (b, i, t) => this._stepTemple(b, i, t);
    return bed;
  }

  _stepTemple(bed, i, t) {
    const s = i % 16;
    const bar = Math.floor(i / 16);

    /* Pentatonic pluck ostinato */
    const oi = TEMPLE_OSTINATO[s];
    if (oi >= 0) {
      const n = TEMPLE_PENTA[(oi + (bar % 2 === 1 ? 1 : 0)) % TEMPLE_PENTA.length];
      const f = mtof(n);
      const o1 = this._osc('triangle', f, t);
      const o2 = this._osc('sine', f * 2, t);
      const lp = this._filter('lowpass', 3200, 6);
      const g = this._gain(0);
      const g2 = this._gain(0.26);
      o1.connect(lp); o2.connect(g2); g2.connect(lp);
      lp.connect(g); g.connect(bed.out);
      this._set(lp.frequency, 3600, t);
      this._ramp(lp.frequency, 900, t + 0.22);
      this._env(g.gain, t, 0.17, 0.002, 0.34, 0);
      this._sendTo(bed.rev, g, 0.42);
      o1.start(t); o2.start(t);
      this._kill(t + 0.42, [o1, o2], [lp, g, g2]);
    }

    /* Formant pad, one chord per 2 bars */
    if (s === 0 && bar % 2 === 0) {
      const dur = bed.stepDur * 16 * 2;
      const chord = TEMPLE_CHORDS[Math.floor(bar / 2) % TEMPLE_CHORDS.length];
      const src = this._gain(0.5);
      const out = this._gain(0);
      const nodes = [src, out];
      const fg = [1, 0.55, 0.25];
      for (let k = 0; k < TEMPLE_FORMANTS.length; k++) {
        const bp = this._filter('bandpass', TEMPLE_FORMANTS[k], 8 + k);
        const bg = this._gain(fg[k]);
        src.connect(bp); bp.connect(bg); bg.connect(out);
        nodes.push(bp, bg);
      }
      out.connect(bed.out);
      const srcs = [];
      for (let k = 0; k < chord.length; k++) {
        const o = this._osc('sawtooth', mtof(chord[k]), t);
        o.detune.value = (k - 1.5) * 6;
        const og = this._gain(0.16);
        o.connect(og); og.connect(src);
        nodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      this._set(out.gain, 0, t);
      this._ramp(out.gain, 0.40, t + 2.2);
      this._ramp(out.gain, 0.34, t + dur - 1.5);
      this._ramp(out.gain, 0, t + dur + 0.1);
      this._sendTo(bed.rev, out, 0.45);
      this._kill(t + dur + 0.25, srcs, nodes);
    }

    /* Soft taiko + flams */
    const flam = (bar % 2 === 1 && s === 15) || (bar % 4 === 3 && s === 7);
    if (s === 0 || s === 8 || flam) {
      const amp = s === 0 ? 0.5 : (s === 8 ? 0.36 : 0.20);
      const o = this._osc('sine', 82, t);
      const g = this._gain(0);
      o.connect(g); g.connect(bed.out);
      this._ramp(o.frequency, 48, t + 0.10);
      this._env(g.gain, t, amp, 0.003, 0.30, 0);
      const n = this._noise(0.8, true);
      const lp = this._filter('lowpass', 900, 1.1);
      const ng = this._gain(0);
      n.connect(lp); lp.connect(ng); ng.connect(bed.out);
      this._env(ng.gain, t, amp * 0.34, 0.002, 0.16, 0);
      this._sendTo(bed.rev, g, 0.28);
      o.start(t); n.start(t, this._rand() * 1.4);
      this._kill(t + 0.4, [o, n], [g, lp, ng]);
    }

    /* Shaker, 16ths, alternating accent */
    if (s % 2 === 1 || s % 4 === 0) {
      const acc = (s % 4 === 0) ? 0.055 : 0.028;
      const n = this._noise(this._jit(0.12), false);
      const hp = this._filter('highpass', 6400, 0.8);
      const g = this._gain(0);
      n.connect(hp); hp.connect(g); g.connect(bed.out);
      this._env(g.gain, t, acc, 0.001, 0.032, 0);
      n.start(t, this._rand() * 1.7);
      this._kill(t + 0.06, [n], [hp, g]);
    }

    /* High chime every 4 bars */
    if (s === 0 && bar % 4 === 1) {
      const o = this._osc('sine', mtof(88), t);
      const o2 = this._osc('sine', mtof(95), t);
      const g = this._gain(0);
      const g2 = this._gain(0.4);
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(bed.out);
      this._env(g.gain, t, 0.10, 0.01, 2.8, 0);
      this._sendTo(bed.rev, g, 0.9);
      o.start(t); o2.start(t + 0.09);
      this._kill(t + 3.1, [o, o2], [g, g2]);
    }
  }

  /* -------------------------------------------------------------- HUB
   * 74 BPM calm: a warm slow pad and a sparse echoing pluck. Nothing else —
   * the hub should feel like a held breath between worlds.
   * ----------------------------------------------------------------- */
  _bedHub() {
    const bed = this._bedBase('hub', 74, 2, 0.52, 0.36);
    const dl = this.ctx.createDelay(1.5);
    dl.delayTime.value = (60 / 74) * 0.75;
    const fb = this._gain(0.34);
    const dlp = this._filter('lowpass', 2200, 0.7);
    const dOut = this._gain(0.42);
    dl.connect(dlp); dlp.connect(fb); fb.connect(dl);
    dl.connect(dOut); dOut.connect(bed.out);
    bed.echo = dl;
    bed.nodes.push(dl, fb, dlp, dOut);
    bed.step = (b, i, t) => this._stepHub(b, i, t);
    return bed;
  }

  _stepHub(bed, i, t) {
    const s = i % 8;
    const bar = Math.floor(i / 8);

    /* Warm pad, one chord per 2 bars */
    if (s === 0 && bar % 2 === 0) {
      const dur = bed.stepDur * 8 * 2;
      const chord = HUB_CHORDS[Math.floor(bar / 2) % HUB_CHORDS.length];
      const lp = this._filter('lowpass', 760, 0.9);
      const g = this._gain(0);
      lp.connect(g); g.connect(bed.out);
      const srcs = [];
      const vnodes = [lp, g];
      for (let k = 0; k < chord.length; k++) {
        const o = this._osc(k === 0 ? 'sawtooth' : 'triangle', mtof(chord[k]), t);
        o.detune.value = (k - 2) * 5;
        const og = this._gain(k === 0 ? 0.10 : 0.14);
        const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        o.connect(og);
        if (pan) { pan.pan.value = clamp((k - 2) * 0.26, -1, 1); og.connect(pan); pan.connect(lp); vnodes.push(pan); }
        else og.connect(lp);
        vnodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      this._set(g.gain, 0, t);
      this._ramp(g.gain, 0.34, t + 2.5);
      this._ramp(g.gain, 0.30, t + dur - 1.8);
      this._ramp(g.gain, 0, t + dur + 0.15);
      this._sendTo(bed.rev, g, 0.36);
      this._kill(t + dur + 0.3, srcs, vnodes);
    }

    /* Sparse pluck into the echo */
    const pi = HUB_PLUCK[s];
    if (pi >= 0) {
      const chord = HUB_CHORDS[Math.floor(bar / 2) % HUB_CHORDS.length];
      const n = chord[(pi + bar) % chord.length] + 12;
      const o = this._osc('sine', mtof(n), t);
      const o2 = this._osc('triangle', mtof(n + 12), t);
      const g = this._gain(0);
      const g2 = this._gain(0.16);
      o.connect(g); o2.connect(g2); g2.connect(g);
      g.connect(bed.out);
      if (bed.echo) g.connect(bed.echo);
      this._env(g.gain, t, 0.15, 0.006, 0.9, 0);
      this._sendTo(bed.rev, g, 0.4);
      o.start(t); o2.start(t);
      this._kill(t + 1.0, [o, o2], [g, g2]);
    }
  }

  /* ====================================================================
   * Spatialisation
   * ==================================================================*/
  /**
   * @param {{pos?:object, listener?:object, ref?:number, max?:number}} opts
   * @returns {{gain:number, pan:number, dist:number}} SHARED module scratch —
   *   read the fields immediately; the next call overwrites them. This is
   *   deliberate: spatial sfx are evaluated every frame and must not allocate.
   */
  _spatial(opts) {
    const out = _spatialOut;
    out.gain = 1; out.pan = 0; out.dist = 0;
    if (!opts) return out;
    const p = opts.pos;
    const l = opts.listener;
    if (!p || !l) return out;

    const lp = l.position || l.pos || l;
    const lx = fin(lp.x, 0), ly = fin(lp.y, 0), lz = fin(lp.z, 0);
    const dx = fin(p.x, 0) - lx, dy = fin(p.y, 0) - ly, dz = fin(p.z, 0) - lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    out.dist = d;

    const ref = fin(opts.ref, 7);
    const max = fin(opts.max, 46);
    if (d >= max) { out.gain = 0; return out; }
    const k = d / ref;
    let g = 1 / (1 + k * k);
    g *= 1 - clamp((d - max * 0.62) / (max * 0.38), 0, 1);   // smooth cull to silence
    out.gain = clamp(g, 0, 1);

    /* Right vector: THREE camera matrixWorld, explicit .right, or a yaw. */
    let rx = 1, ry = 0, rz = 0;
    if (l.matrixWorld && l.matrixWorld.elements) {
      const e = l.matrixWorld.elements;
      rx = fin(e[0], 1); ry = fin(e[1], 0); rz = fin(e[2], 0);
    } else if (l.right) {
      rx = fin(l.right.x, 1); ry = fin(l.right.y, 0); rz = fin(l.right.z, 0);
    } else if (typeof l.yaw === 'number') {
      rx = Math.cos(l.yaw); ry = 0; rz = -Math.sin(l.yaw);
    }
    const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    if (d > 0.001) {
      const dot = (dx * rx + dy * ry + dz * rz) / (d * rl);
      /* Sources very close to the head stay centred (no ping-pong pan). */
      out.pan = clamp(dot, -1, 1) * clamp(d / 3.5, 0, 1) * 0.85;
    }
    return out;
  }

  /* ====================================================================
   * SFX
   * ==================================================================*/
  /**
   * Play a synthesised sound.
   * @param {string} name  see the switch below (aliases in ALIAS)
   * @param {object} [opts] {gain, rate, pos, listener, surface, impact, power,
   *                         ref, max, delay, loop}
   * @returns {object|undefined} a loop handle for looping sounds
   */
  sfx(name, opts) {
    if (!this.ctx || !this.ready || !this.available) return undefined;
    if (this.ctx.state !== 'running') {
      /* Suspended (page mute or pre-gesture). Never queue a backlog. */
      if (!this._pageMuted) this._resume();
      if (this.ctx.state !== 'running') return undefined;
    }
    let n = ALIAS[name] || name;
    if (typeof n !== 'string') return undefined;
    const o = opts || _emptyOpts;

    if (LOOP_SFX[n]) return this.loop(n, o);

    if (!CRITICAL[n] && this._sfxLive > MAX_VOICES) return undefined;

    /* Anti-machinegun: identical non-critical sounds get a small floor. */
    const now = this.ctx.currentTime;
    if (!CRITICAL[n]) {
      const last = this._lastPlay[n] || 0;
      if (now - last < 0.018) return undefined;
      this._lastPlay[n] = now;
    }

    const t = now + Math.max(0, fin(o.delay, 0)) + 0.002;
    const sp = this._spatial(o);
    if (sp.gain <= 0.0008) return undefined;
    const amp = clamp(fin(o.gain, 1), 0, 4) * sp.gain;
    if (amp <= 0.0008) return undefined;

    /* Every voice lands on this node: pan (if available) -> sfxBus. */
    let dest = this.sfxBus;
    let panNode = null;
    if (sp.pan !== 0 && this.ctx.createStereoPanner) {
      panNode = this.ctx.createStereoPanner();
      panNode.pan.value = clamp(sp.pan, -1, 1);
      panNode.connect(this.sfxBus);
      dest = panNode;
    }
    let airNode = null;
    if (sp.dist > 12) {
      airNode = this._filter('lowpass', clamp(15000 - (sp.dist - 12) * 320, 900, 15000), 0.7);
      airNode.connect(dest);
      dest = airNode;
    }

    this._inSfx = true;
    try {
      this._render(n, t, amp, o, dest, sp);
    } catch (e) { /* one broken sound never breaks the frame */ }
    finally { this._inSfx = false; }

    if (panNode || airNode) {
      /* Reclaim the shell nodes after the longest plausible tail. */
      setTimeout(() => {
        try { if (airNode) airNode.disconnect(); } catch (e) {}
        try { if (panNode) panNode.disconnect(); } catch (e) {}
      }, 4200);
    }
    return undefined;
  }

  _render(n, t, amp, o, dest, sp) {
    switch (n) {
      case 'jump': return this._sJump(t, amp, o, dest);
      case 'land_soft': return this._sLand(t, amp, o, dest, false);
      case 'land_hard': return this._sLand(t, amp, o, dest, true);
      case 'step_stone': return this._sStep(t, amp, o, dest, 'stone');
      case 'step_metal': return this._sStep(t, amp, o, dest, 'metal');
      case 'step_ice': return this._sStep(t, amp, o, dest, 'ice');
      case 'step_grate': return this._sStep(t, amp, o, dest, 'grate');
      case 'step_rubber': return this._sStep(t, amp, o, dest, 'rubber');
      case 'death': return this._sDeath(t, amp, o, dest);
      case 'checkpoint': return this._sCheckpoint(t, amp, o, dest);
      case 'coin': return this._sCoin(t, amp, o, dest);
      case 'finish': return this._sFinish(t, amp, o, dest);
      case 'laser_charge': return this._sLaserCharge(t, amp, o, dest);
      case 'laser_fire': return this._sLaserFire(t, amp, o, dest);
      case 'crusher_slam': return this._sCrusher(t, amp, o, dest);
      case 'lava_bubble': return this._sLavaBubble(t, amp, o, dest);
      case 'vanish_warn': return this._sVanishWarn(t, amp, o, dest);
      case 'bounce': return this._sBounce(t, amp, o, dest);
      case 'ui_move': return this._sUi(t, amp, dest, 620, 760, 0.035, 'triangle', 0.35);
      case 'ui_ok': return this._sUi(t, amp, dest, 660, 990, 0.13, 'sine', 0.8);
      case 'ui_back': return this._sUi(t, amp, dest, 620, 415, 0.14, 'triangle', 0.7);
      default: return undefined;
    }
  }

  /* ---- individual sounds ---- */

  _sJump(t, amp, o, dest) {
    const rate = clamp(fin(o.rate, 1), 0.5, 2);
    const o1 = this._osc('triangle', 215 * rate, t);
    const g = this._gain(0);
    o1.connect(g); g.connect(dest);
    this._set(o1.frequency, 205 * rate, t);
    this._ramp(o1.frequency, 445 * rate, t + 0.085);
    this._env(g.gain, t, 0.30 * amp, 0.003, 0.11, 0);
    const n = this._noise(1.5, false);
    const hp = this._filter('highpass', 1600, 0.7);
    const ng = this._gain(0);
    n.connect(hp); hp.connect(ng); ng.connect(dest);
    this._env(ng.gain, t, 0.055 * amp, 0.001, 0.06, 0);
    o1.start(t); n.start(t, this._rand() * 1.6);
    this._kill(t + 0.2, [o1, n], [g, hp, ng]);
  }

  _sLand(t, amp, o, dest, hard) {
    const surf = typeof o.surface === 'string' ? o.surface : 'stone';
    const impact = clamp(fin(o.impact, hard ? 18 : 7) / 22, 0.12, 1.35);
    const a = amp * (hard ? 1 : 0.62) * impact;

    const body = this._osc('sine', hard ? 195 : 152, t);
    const bg = this._gain(0);
    body.connect(bg); bg.connect(dest);
    this._ramp(body.frequency, hard ? 48 : 72, t + (hard ? 0.15 : 0.085));
    this._env(bg.gain, t, 0.55 * a, 0.002, hard ? 0.24 : 0.12, 0);

    const n = this._noise(this._jit(0.1), false);
    const lp = this._filter('lowpass', hard ? 1500 : 900, 1.0);
    const ng = this._gain(0);
    n.connect(lp); lp.connect(ng); ng.connect(dest);
    this._set(lp.frequency, hard ? 1900 : 1100, t);
    this._ramp(lp.frequency, 280, t + (hard ? 0.2 : 0.1));
    this._env(ng.gain, t, 0.24 * a, 0.001, hard ? 0.2 : 0.09, 0);

    const nodes = [bg, lp, ng];
    const srcs = [body, n];

    /* Surface colour: a short ring bank keyed to the material. */
    const ring = SURFACE_RING[surf] || SURFACE_RING.stone;
    const rq = surf === 'metal' ? 20 : (surf === 'ice' ? 14 : (surf === 'rubber' ? 3 : 5));
    const rdur = surf === 'metal' ? 0.55 : (surf === 'ice' ? 0.24 : (surf === 'rubber' ? 0.16 : 0.14));
    const rn = this._noise(this._jit(0.12), false);
    const rout = this._gain(0);
    rout.connect(dest);
    for (let k = 0; k < ring.length; k++) {
      const bp = this._filter('bandpass', ring[k] * this._jit(0.03), rq);
      const bg2 = this._gain(0.8 / (1 + k * 0.8));
      rn.connect(bp); bp.connect(bg2); bg2.connect(rout);
      nodes.push(bp, bg2);
    }
    nodes.push(rout);
    this._env(rout.gain, t, (hard ? 0.30 : 0.13) * a * (surf === 'rubber' ? 0.7 : 1), 0.0015, rdur, 0);
    srcs.push(rn);

    if (surf === 'rubber') {
      const b = this._osc('sine', 140, t);
      const bgg = this._gain(0);
      b.connect(bgg); bgg.connect(dest);
      this._ramp(b.frequency, 250, t + 0.05);
      this._ramp(b.frequency, 170, t + 0.14);
      this._env(bgg.gain, t, 0.20 * a, 0.004, 0.16, 0);
      b.start(t);
      srcs.push(b); nodes.push(bgg);
    }

    this._send(rout, hard ? 0.24 : 0.12);
    body.start(t);
    n.start(t, this._rand() * 1.5);
    rn.start(t, this._rand() * 1.5);
    this._kill(t + Math.max(0.45, rdur + 0.2), srcs, nodes);
  }

  _sStep(t, amp, o, dest, surf) {
    /* Pitch, filter and buffer offset all jitter — never a looped sample. */
    const j = this._jit(0.17);
    const a = amp * (0.9 + this._rand() * 0.22);
    const n = this._noise(clamp(1 * j, 0.5, 2), surf === 'stone');
    const g = this._gain(0);
    let f1, f2 = null, dur;

    switch (surf) {
      case 'metal':
        f1 = this._filter('bandpass', 2400 * j, 6);
        f2 = this._filter('peaking', 3350 * j, 4);
        f2.gain.value = 9;
        dur = 0.062;
        break;
      case 'ice':
        f1 = this._filter('highpass', 4200 * j, 0.9);
        f2 = this._filter('bandpass', 6200 * j, 8);
        dur = 0.044;
        break;
      case 'grate':
        f1 = this._filter('bandpass', 1700 * j, 3.2);
        f2 = this._filter('peaking', 900 * j, 2);
        f2.gain.value = 6;
        dur = 0.055;
        break;
      case 'rubber':
        f1 = this._filter('lowpass', 900 * j, 1.4);
        dur = 0.05;
        break;
      default:
        f1 = this._filter('bandpass', 1120 * j, 1.3);
        dur = 0.048;
        break;
    }

    n.connect(f1);
    if (f2) { f1.connect(f2); f2.connect(g); } else { f1.connect(g); }
    g.connect(dest);
    const peak = (surf === 'metal' ? 0.15 : surf === 'ice' ? 0.11 : surf === 'grate' ? 0.13 : 0.115) * a;
    this._env(g.gain, t, peak, 0.0012, dur, 0);

    const srcs = [n];
    const nodes = f2 ? [f1, f2, g] : [f1, g];

    if (surf === 'grate') {
      /* A second, slightly later rattle makes the metal grating read. */
      const n2 = this._noise(clamp(1.4 * this._jit(0.2), 0.5, 2.5), false);
      const bp = this._filter('bandpass', 2600 * this._jit(0.15), 5);
      const g2 = this._gain(0);
      n2.connect(bp); bp.connect(g2); g2.connect(dest);
      this._env(g2.gain, t + 0.021, peak * 0.55, 0.001, 0.038, 0);
      n2.start(t + 0.021, this._rand() * 1.6);
      srcs.push(n2); nodes.push(bp, g2);
    }
    if (surf === 'ice') {
      const tick = this._osc('sine', 5200 * j, t);
      const tg = this._gain(0);
      tick.connect(tg); tg.connect(dest);
      this._env(tg.gain, t, peak * 0.4, 0.001, 0.02, 0);
      tick.start(t);
      srcs.push(tick); nodes.push(tg);
    }

    n.start(t, this._rand() * 1.8);
    this._kill(t + 0.14, srcs, nodes);
  }

  _sDeath(t, amp, o, dest) {
    const a = amp;
    const saw = this._osc('sawtooth', 300, t);
    const sq = this._osc('square', 150, t);
    const lp = this._filter('lowpass', 2400, 4);
    const g = this._gain(0);
    const sg = this._gain(0.34);
    saw.connect(lp); sq.connect(sg); sg.connect(lp);
    lp.connect(g); g.connect(dest);
    this._ramp(saw.frequency, 58, t + 0.55);
    this._ramp(sq.frequency, 34, t + 0.55);
    this._set(lp.frequency, 2600, t);
    this._ramp(lp.frequency, 190, t + 0.5);
    this._env(g.gain, t, 0.42 * a, 0.004, 0.52, 0, 0.05);

    const sub = this._osc('sine', 92, t);
    const subg = this._gain(0);
    sub.connect(subg); subg.connect(dest);
    this._ramp(sub.frequency, 28, t + 0.45);
    this._env(subg.gain, t, 0.5 * a, 0.006, 0.5, 0);

    const n = this._noise(1, true);
    const bp = this._filter('bandpass', 1600, 1.1);
    const ng = this._gain(0);
    n.connect(bp); bp.connect(ng); ng.connect(dest);
    this._set(bp.frequency, 2200, t);
    this._ramp(bp.frequency, 260, t + 0.5);
    this._env(ng.gain, t, 0.22 * a, 0.004, 0.5, 0);

    this._send(g, 0.4);
    saw.start(t); sq.start(t); sub.start(t); n.start(t, this._rand() * 1.4);
    this._kill(t + 0.75, [saw, sq, sub, n], [lp, g, sg, subg, bp, ng]);
    this.duck(760);
  }

  _sCheckpoint(t, amp, o, dest) {
    const notes = [76, 83];   // E5, B5
    const srcs = [];
    const nodes = [];
    for (let k = 0; k < notes.length; k++) {
      const at = t + k * 0.085;
      const f = mtof(notes[k]);
      const o1 = this._osc('sine', f, at);
      const o2 = this._osc('triangle', f * 2.005, at);
      const g = this._gain(0);
      const g2 = this._gain(0.28);
      o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(dest);
      this._env(g.gain, at, 0.26 * amp * (k === 0 ? 1 : 0.9), 0.004, 0.42, 0);
      this._send(g, 0.6);
      o1.start(at); o2.start(at);
      srcs.push(o1, o2); nodes.push(g, g2);
    }
    /* Shimmer tail */
    const n = this._noise(1.4, false);
    const hp = this._filter('highpass', 5200, 0.8);
    const ng = this._gain(0);
    n.connect(hp); hp.connect(ng); ng.connect(dest);
    this._env(ng.gain, t, 0.05 * amp, 0.01, 0.38, 0);
    this._send(ng, 0.5);
    n.start(t, this._rand() * 1.5);
    srcs.push(n); nodes.push(hp, ng);
    this._kill(t + 0.72, srcs, nodes);
  }

  _sCoin(t, amp, o, dest) {
    const f1 = 1046, f2 = 1568;
    const o1 = this._osc('square', f1, t);
    const g1 = this._gain(0);
    o1.connect(g1); g1.connect(dest);
    this._env(g1.gain, t, 0.13 * amp, 0.001, 0.05, 0);
    const o2 = this._osc('square', f2, t + 0.048);
    const g2 = this._gain(0);
    o2.connect(g2); g2.connect(dest);
    this._env(g2.gain, t + 0.048, 0.13 * amp, 0.001, 0.13, 0);
    const spark = this._noise(1.9, false);
    const hp = this._filter('highpass', 7000, 0.9);
    const sg = this._gain(0);
    spark.connect(hp); hp.connect(sg); sg.connect(dest);
    this._env(sg.gain, t, 0.04 * amp, 0.001, 0.09, 0);
    this._send(g2, 0.35);
    o1.start(t); o2.start(t + 0.048); spark.start(t, this._rand() * 1.6);
    this._kill(t + 0.26, [o1, o2, spark], [g1, g2, hp, sg]);
  }

  _sFinish(t, amp, o, dest) {
    const notes = [72, 76, 79, 84];
    const srcs = [];
    const nodes = [];
    for (let k = 0; k < notes.length; k++) {
      const at = t + k * 0.105;
      const f = mtof(notes[k]);
      const lp = this._filter('lowpass', 3400, 3);
      const g = this._gain(0);
      lp.connect(g); g.connect(dest);
      for (let d = 0; d < 3; d++) {
        const os = this._osc('sawtooth', f, at);
        os.detune.value = (d - 1) * 11;
        const og = this._gain(0.2);
        os.connect(og); og.connect(lp);
        os.start(at);
        srcs.push(os); nodes.push(og);
      }
      this._set(lp.frequency, 4200, at);
      this._ramp(lp.frequency, 1400, at + 0.5);
      this._env(g.gain, at, 0.24 * amp, 0.008, k === 3 ? 1.1 : 0.4, 0, k === 3 ? 0.2 : 0.04);
      this._send(g, 0.55);
      nodes.push(lp, g);
    }
    const swell = this._osc('sine', mtof(48), t);
    const sg = this._gain(0);
    swell.connect(sg); sg.connect(dest);
    this._env(sg.gain, t, 0.34 * amp, 0.09, 1.2, 0, 0.2);
    swell.start(t);
    srcs.push(swell); nodes.push(sg);
    this._kill(t + 2.0, srcs, nodes);
    this.duck(1500);
  }

  _sLaserCharge(t, amp, o, dest) {
    const dur = clamp(fin(o.dur, 0.55), 0.15, 2.5);
    const os = this._osc('sawtooth', 180, t);
    const si = this._osc('sine', 180, t);
    const bp = this._filter('bandpass', 400, 6);
    const trem = this._gain(1);
    const g = this._gain(0);
    const sig = this._gain(0.5);
    os.connect(bp); si.connect(sig); sig.connect(bp);
    bp.connect(trem); trem.connect(g); g.connect(dest);
    this._ramp(os.frequency, 1450, t + dur);
    this._ramp(si.frequency, 1450, t + dur);
    this._set(bp.frequency, 380, t);
    this._ramp(bp.frequency, 2600, t + dur);
    this._env(g.gain, t, 0.17 * amp, dur * 0.55, 0.09, 0, dur * 0.4);
    /* Tremolo that accelerates as it charges — scheduled, no LFO node needed. */
    const steps = 18;
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      const at = t + dur * f * f;
      this._set(trem.gain, 1, at);
      this._ramp(trem.gain, 0.42, at + 0.008);
      this._ramp(trem.gain, 1, at + 0.016 + 0.02 * (1 - f));
    }
    this._send(g, 0.3);
    os.start(t); si.start(t);
    this._kill(t + dur + 0.15, [os, si], [bp, trem, g, sig]);
  }

  _sLaserFire(t, amp, o, dest) {
    const os = this._osc('sawtooth', 2200, t);
    const bp = this._filter('bandpass', 2600, 11);
    const g = this._gain(0);
    os.connect(bp); bp.connect(g); g.connect(dest);
    this._ramp(os.frequency, 250, t + 0.17);
    this._set(bp.frequency, 3400, t);
    this._ramp(bp.frequency, 420, t + 0.17);
    this._env(g.gain, t, 0.34 * amp, 0.0015, 0.19, 0);
    const n = this._noise(1.7, false);
    const hp = this._filter('highpass', 2400, 0.8);
    const ng = this._gain(0);
    n.connect(hp); hp.connect(ng); ng.connect(dest);
    this._env(ng.gain, t, 0.20 * amp, 0.001, 0.09, 0);
    const sub = this._osc('sine', 150, t);
    const sg = this._gain(0);
    sub.connect(sg); sg.connect(dest);
    this._ramp(sub.frequency, 52, t + 0.16);
    this._env(sg.gain, t, 0.24 * amp, 0.002, 0.18, 0);
    this._send(g, 0.36);
    os.start(t); n.start(t, this._rand() * 1.6); sub.start(t);
    this._kill(t + 0.34, [os, n, sub], [bp, g, hp, ng, sg]);
  }

  _sCrusher(t, amp, o, dest) {
    const a = amp * clamp(fin(o.power, 1), 0.3, 1.6);
    const body = this._osc('sine', 118, t);
    const bg = this._gain(0);
    body.connect(bg); bg.connect(dest);
    this._ramp(body.frequency, 31, t + 0.3);
    this._env(bg.gain, t, 0.78 * a, 0.002, 0.42, 0);

    const n = this._noise(0.85, false);
    const lp = this._filter('lowpass', 950, 1.1);
    const ng = this._gain(0);
    n.connect(lp); lp.connect(ng); ng.connect(dest);
    this._set(lp.frequency, 1500, t);
    this._ramp(lp.frequency, 130, t + 0.3);
    this._env(ng.gain, t, 0.42 * a, 0.001, 0.3, 0);

    const rn = this._noise(this._jit(0.1), false);
    const rout = this._gain(0);
    rout.connect(dest);
    const nodes = [bg, lp, ng, rout];
    const ring = SURFACE_RING.metal;
    for (let k = 0; k < ring.length; k++) {
      const bp = this._filter('bandpass', ring[k] * 0.72 * this._jit(0.03), 18);
      const bg2 = this._gain(0.7 / (1 + k));
      rn.connect(bp); bp.connect(bg2); bg2.connect(rout);
      nodes.push(bp, bg2);
    }
    this._env(rout.gain, t, 0.24 * a, 0.002, 0.75, 0);
    this._send(rout, 0.45);
    this._send(ng, 0.3);
    body.start(t); n.start(t, this._rand() * 1.4); rn.start(t, this._rand() * 1.4);
    this._kill(t + 1.0, [body, n, rn], nodes);
  }

  _sLavaBubble(t, amp, o, dest) {
    const j = this._jit(0.35);
    const f0 = 58 * j;
    const os = this._osc('sine', f0, t);
    const lp = this._filter('lowpass', 520, 2.2);
    const g = this._gain(0);
    os.connect(lp); lp.connect(g); g.connect(dest);
    this._set(os.frequency, f0, t);
    this._ramp(os.frequency, f0 * 3.1, t + 0.075);
    this._ramp(os.frequency, f0 * 1.35, t + 0.19);
    this._env(g.gain, t, 0.20 * amp, 0.008, 0.2, 0);
    const pop = this._noise(0.7 * j, true);
    const bp = this._filter('bandpass', 380 * j, 2);
    const pg = this._gain(0);
    pop.connect(bp); bp.connect(pg); pg.connect(dest);
    this._env(pg.gain, t + 0.06, 0.09 * amp, 0.002, 0.1, 0);
    this._send(g, 0.25);
    os.start(t); pop.start(t + 0.06, this._rand() * 1.5);
    this._kill(t + 0.34, [os, pop], [lp, g, bp, pg]);
  }

  _sVanishWarn(t, amp, o, dest) {
    const urgency = clamp(fin(o.power, 0.5), 0, 1);
    const f = 760 + urgency * 420;
    const o1 = this._osc('square', f, t);
    const o2 = this._osc('square', f * 1.5, t);
    const lp = this._filter('lowpass', 3600, 1.2);
    const g = this._gain(0);
    const g2 = this._gain(0.3);
    o1.connect(lp); o2.connect(g2); g2.connect(lp);
    lp.connect(g); g.connect(dest);
    this._env(g.gain, t, (0.075 + urgency * 0.06) * amp, 0.001, 0.048, 0);
    o1.start(t); o2.start(t);
    this._kill(t + 0.12, [o1, o2], [lp, g, g2]);
  }

  _sBounce(t, amp, o, dest) {
    /* `power` is the pad's target apex in metres — louder + brighter with height. */
    const p = clamp(fin(o.power, 4) / 8, 0.35, 2.2);
    const os = this._osc('sine', 175, t);
    const lp = this._filter('lowpass', 2400, 2);
    const g = this._gain(0);
    os.connect(lp); lp.connect(g); g.connect(dest);
    this._set(os.frequency, 165, t);
    this._ramp(os.frequency, 520 * Math.sqrt(p), t + 0.085);
    this._ramp(os.frequency, 300 * Math.sqrt(p), t + 0.17);
    this._env(g.gain, t, 0.34 * amp * clamp(p, 0.5, 1.4), 0.003, 0.2, 0);
    const sq = this._osc('triangle', 88, t);
    const sg = this._gain(0);
    sq.connect(sg); sg.connect(dest);
    this._ramp(sq.frequency, 210, t + 0.09);
    this._env(sg.gain, t, 0.18 * amp, 0.002, 0.16, 0);
    const n = this._noise(1.2, false);
    const bp = this._filter('bandpass', 320, 1.6);
    const ng = this._gain(0);
    n.connect(bp); bp.connect(ng); ng.connect(dest);
    this._env(ng.gain, t, 0.09 * amp, 0.001, 0.07, 0);
    this._send(g, 0.22);
    os.start(t); sq.start(t); n.start(t, this._rand() * 1.5);
    this._kill(t + 0.34, [os, sq, n], [lp, g, sg, bp, ng]);
  }

  _sUi(t, amp, dest, f0, f1, dur, type, revAmt) {
    const os = this._osc(type, f0, t);
    const g = this._gain(0);
    os.connect(g); g.connect(dest);
    this._set(os.frequency, f0, t);
    this._ramp(os.frequency, f1, t + dur * 0.6);
    this._env(g.gain, t, 0.16 * amp, 0.002, dur, 0);
    if (revAmt > 0) this._send(g, revAmt * 0.25);
    os.start(t);
    this._kill(t + dur + 0.08, [os], [g]);
  }

  /* ====================================================================
   * Looping, distance-attenuated sounds
   * ==================================================================*/
  /**
   * @returns {{id:number,name:string,setPos:Function,setListener:Function,
   *            setGain:Function,setRate:Function,stop:Function,alive:boolean}}
   */
  loop(name, opts) {
    const stub = _loopStub;
    if (!this.ctx || !this.ready) return stub;
    if (this.ctx.state !== 'running') { if (!this._pageMuted) this._resume(); }
    const n = ALIAS[name] || name;
    const o = opts || _emptyOpts;

    /* Reuse an existing handle when the caller supplies a stable key. */
    if (o.key !== undefined && this._loops.has(o.key)) {
      const h = this._loops.get(o.key);
      if (o.pos) h.setPos(o.pos, o.listener);
      return h;
    }

    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const out = this._gain(0);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const air = this._filter('lowpass', 15000, 0.7);
    out.connect(air);
    if (pan) { air.connect(pan); pan.connect(this.sfxBus); } else { air.connect(this.sfxBus); }

    const srcs = [];
    const nodes = [out, air];
    if (pan) nodes.push(pan);
    let baseGain = clamp(fin(o.gain, 1), 0, 3);

    if (n === 'saw_whirr') {
      /* Blade: two harmonically related saws + a tooth-rate tremolo + air noise. */
      const s1 = this._osc('sawtooth', 78, t);
      const s2 = this._osc('sawtooth', 117.4, t);
      const s3 = this._osc('square', 234, t);
      const lp = this._filter('lowpass', 2600, 3);
      const g1 = this._gain(0.5), g2 = this._gain(0.3), g3 = this._gain(0.1);
      s1.connect(g1); s2.connect(g2); s3.connect(g3);
      g1.connect(lp); g2.connect(lp); g3.connect(lp);
      const trem = this._gain(1);
      lp.connect(trem); trem.connect(out);
      const lfo = this._osc('sine', 24.5, t);
      const lfoG = this._gain(0.35);
      lfo.connect(lfoG); lfoG.connect(trem.gain);
      const air2 = this._noise(1, false);
      const bp = this._filter('bandpass', 1800, 5);
      const ag = this._gain(0.16);
      air2.connect(bp); bp.connect(ag); ag.connect(out);
      s1.start(t); s2.start(t); s3.start(t); lfo.start(t); air2.start(t, this._rand() * 1.4);
      srcs.push(s1, s2, s3, lfo, air2);
      nodes.push(lp, g1, g2, g3, trem, lfoG, bp, ag);
      baseGain *= 0.5;
    } else if (n === 'wind') {
      const nz = this._noise(0.6, true);
      const bp = this._filter('bandpass', 430, 0.9);
      const hp = this._filter('highpass', 170, 0.6);
      nz.connect(bp); bp.connect(hp); hp.connect(out);
      /* Slow, non-repeating-feeling sweep scheduled 40 s ahead and refreshed. */
      let at = t;
      for (let k = 0; k < 20; k++) {
        const f = 300 + this._rand() * 620;
        this._ramp(bp.frequency, f, at + 2.0);
        at += 2.0;
      }
      nz.start(t, this._rand() * 1.5);
      srcs.push(nz);
      nodes.push(bp, hp);
      baseGain *= 0.55;
    } else if (n === 'portal_hum') {
      const a1 = this._osc('sine', 110, t);
      const a2 = this._osc('sine', 110.7, t);
      const a3 = this._osc('sawtooth', 220, t);
      const shimmer = this._osc('sine', 1320, t);
      const lp = this._filter('lowpass', 620, 1.4);
      const g1 = this._gain(0.4), g2 = this._gain(0.4), g3 = this._gain(0.12), g4 = this._gain(0.035);
      a1.connect(g1); a2.connect(g2); a3.connect(g3);
      g1.connect(lp); g2.connect(lp); g3.connect(lp);
      const trem = this._gain(1);
      lp.connect(trem); trem.connect(out);
      shimmer.connect(g4); g4.connect(out);
      const lfo = this._osc('sine', 0.63, t);
      const lfoG = this._gain(0.22);
      lfo.connect(lfoG); lfoG.connect(trem.gain);
      a1.start(t); a2.start(t); a3.start(t); shimmer.start(t); lfo.start(t);
      srcs.push(a1, a2, a3, shimmer, lfo);
      nodes.push(lp, g1, g2, g3, g4, trem, lfoG);
      this._send(out, 0.5);
      baseGain *= 0.7;
    } else if (n === 'lava_flow') {
      const nz = this._noise(0.45, true);
      const lp = this._filter('lowpass', 380, 1.6);
      const bp = this._filter('bandpass', 160, 1.1);
      nz.connect(lp); lp.connect(bp); bp.connect(out);
      nz.start(t, this._rand() * 1.5);
      srcs.push(nz);
      nodes.push(lp, bp);
      baseGain *= 0.6;
    } else {
      try { out.disconnect(); air.disconnect(); if (pan) pan.disconnect(); } catch (e) {}
      return stub;
    }

    const self = this;
    const id = this._loopSeq++;
    const key = o.key !== undefined ? o.key : id;
    const handle = {
      id, key, name: n, alive: true,
      _base: baseGain,
      _listener: o.listener || null,
      setListener(l) { this._listener = l || null; return this; },
      setGain(g) {
        this._base = clamp(fin(g, 1), 0, 3);
        return this;
      },
      setRate(r) {
        const v = clamp(fin(r, 1), 0.2, 3);
        for (let i = 0; i < srcs.length; i++) {
          const s = srcs[i];
          if (s && s.playbackRate) { try { self._target(s.playbackRate, v, self.ctx.currentTime, 0.05); } catch (e) {} }
          else if (s && s.detune) { try { self._target(s.detune, (v - 1) * 1200, self.ctx.currentTime, 0.05); } catch (e) {} }
        }
        return this;
      },
      setPos(pos, listener) {
        if (!this.alive || !self.ctx) return this;
        if (listener) this._listener = listener;
        _spatialIn.pos = pos;
        _spatialIn.listener = this._listener;
        _spatialIn.ref = fin(o.ref, 8);
        _spatialIn.max = fin(o.max, 44);
        const sp = self._spatial(_spatialIn);
        const now = self.ctx.currentTime;
        self._target(out.gain, this._base * sp.gain, now, 0.06);
        if (pan) self._target(pan.pan, sp.pan, now, 0.08);
        self._target(air.frequency, clamp(15000 - Math.max(0, sp.dist - 10) * 340, 700, 15000), now, 0.1);
        return this;
      },
      stop(fadeMs) {
        if (!this.alive) return;
        this.alive = false;
        const f = clamp(fin(fadeMs, 140), 0, 4000) / 1000;
        const now = self.ctx ? self.ctx.currentTime : 0;
        try { out.gain.cancelScheduledValues(now); } catch (e) {}
        self._set(out.gain, fin(out.gain.value, 0), now);
        self._ramp(out.gain, 0, now + f);
        self._kill(now + f + 0.05, srcs, nodes);
        self._loops.delete(key);
      },
    };

    /* Initial placement + fade in. Positional loops ride up from 0 via the
       setTarget in setPos; non-positional ones get a plain linear fade. */
    const t0 = ctx.currentTime;
    this._set(out.gain, 0, t0);
    if (o.pos) handle.setPos(o.pos, o.listener);
    else this._ramp(out.gain, baseGain, t0 + 0.25);

    this._loops.set(key, handle);
    return handle;
  }

  /** Stop one loop by the key given to `loop(name, {key})`. */
  stopLoop(key, fadeMs) {
    const h = this._loops.get(key);
    if (h) h.stop(fadeMs);
  }

  /** Optional per-frame housekeeping — safe to call or to skip. */
  update(dt) {
    if (!this.ctx || !this.ready) return;
    if (this._loops.size > 48) {
      /* Runaway guard: something forgot to stop its loops. */
      let n = 0;
      for (const h of this._loops.values()) { if (n++ > 32) h.stop(60); }
    }
  }

  /* ====================================================================
   * Teardown
   * ==================================================================*/
  stopAll() {
    try {
      for (const h of Array.from(this._loops.values())) h.stop(80);
      this._loops.clear();
    } catch (e) {}
    for (let i = 0; i < this._active.length; i++) {
      const b = this._active[i];
      try {
        const now = this.ctx ? this.ctx.currentTime : 0;
        this._ramp(b.out.gain, 0, now + 0.15);
      } catch (e) {}
      setTimeout(() => { try { this._teardownBed(b); } catch (e) {} }, 260);
    }
    this._active.length = 0;
    this.theme = null;
    this._pendingTheme = null;
  }

  dispose() {
    this.stopAll();
    this._stopScheduler();
    if (IS_BROWSER && this._onMuteChange) {
      window.removeEventListener('mutechange', this._onMuteChange, false);
    }
    if (this.ctx) {
      const ctx = this.ctx;
      this.ready = false;
      setTimeout(() => { try { ctx.close(); } catch (e) {} }, 300);
      this.ctx = null;
    }
  }
}

/* Reusable scratch so spatial maths never allocates per call. */
const _spatialOut = { gain: 1, pan: 0, dist: 0 };
const _spatialIn = { pos: null, listener: null, ref: 8, max: 44 };
const _emptyOpts = Object.freeze({});
const _loopStub = Object.freeze({
  id: 0, key: 0, name: '', alive: false,
  setPos() { return this; }, setListener() { return this; },
  setGain() { return this; }, setRate() { return this; }, stop() {},
});


export default Audio;
