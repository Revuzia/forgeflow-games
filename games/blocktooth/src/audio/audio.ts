// BLOCKTOOTH — audio engine + the procedural synth toolkit (CONTRACT.md §13).
//
// Procedural WebAudio ONLY: no sample files anywhere. Every sound and every music note is built
// from oscillators, looped noise buffers, biquads, a grit waveshaper and ONE shared reverb impulse
// that is itself generated from seeded noise at unlock time.
//
// Graph (built once per context):
//
//   voices ─┬─────────────────────────────► sfxBus (sfx volume) ─► shelf ─► glue ─► sfxOut ─┐
//           └─► sfxVerb ─► convolver A ──────┘                                            │
//   music  ─┬─────────────────────────────► musicBus (music vol) ─► duck ────────────────┤
//           └─► musicVerb ─► convolver B ────┘                                            ▼
//                                            master (master vol) ─► compressor ─► ×0.5 ─► soft clip ─► out
//
// Mix balance (PC-11): measured on busy play the music bus sat ~16 dB under the SFX bus (median
// music/sfx RMS 0.15). The SFX bus now has its own gentle glue compressor (dense crunch/debris
// stacks are levelled BEFORE they hit the shared master compressor, so they stop pumping the
// music down with them) and a −3 dB high shelf that takes the fizz off stacked debris voices;
// the music bus runs hotter (MUSIC_BUS_GAIN).
//
// Doctrine (GAME_DOCTRINE + the §13 note): exponentialRampToValueAtTime toward ~0 and non-finite
// values thrown into AudioParams both throw — this file only ever uses setValueAtTime +
// linearRampToValueAtTime, through helpers that clamp every value finite and into the param's
// range and swallow scheduling exceptions. Decays that should "feel" exponential are piecewise
// linear approximations that land on exactly 0.
//
// Safe everywhere: with no AudioContext (node, headless without audio, a browser that refuses)
// every method is a no-op, and nothing makes a sound before unlock() (first user gesture).

/** Hard cap on simultaneous SFX voices (the Sfx voice limiter steals above this). */
export const MAX_VOICES = 24;
/** music bus gain at music volume 1 (× vol²); was 0.8 — the score sat ~16 dB under busy SFX */
const MUSIC_BUS_GAIN = 1.6;
/**
 * WebAudio's DynamicsCompressorNode adds its own automatic makeup gain (Blink/WebKit/Gecko share the
 * algorithm). Measured in Chrome for the SFX glue below (thr −22 dB, knee 10, ratio 2.5): +6.15 dB on
 * every below-threshold signal (_harness/scratch/appfix/comp_makeup.py). sfxOut undoes it, so quiet
 * SFX pass at unity and only dense stacks come down (≈ −0.1 dB at −23 dBFS, ≈ −3.8 dB at −13.5 dBFS).
 */
const SFX_GLUE_MAKEUP_DB = 6.15;

// ─────────────────────────────── finite-safe param helpers ───────────────────────────────

/** v if finite, else fb. */
export function fin(v: number, fb = 0): number { return Number.isFinite(v) ? v : fb; }
/** finite clamp */
export function clampf(v: number, lo: number, hi: number): number {
  v = fin(v, lo);
  return v < lo ? lo : v > hi ? hi : v;
}

function pv(p: AudioParam, v: number): number {
  v = fin(v, fin(p.defaultValue, 0));
  const lo = fin(p.minValue, -3.4e38), hi = fin(p.maxValue, 3.4e38);
  return v < lo ? lo : v > hi ? hi : v;
}
function pt(t: number): number { t = fin(t, 0); return t < 0 ? 0 : t; }

/** setValueAtTime, finite + range clamped, never throws. */
export function setAt(p: AudioParam, v: number, t: number): void {
  try { p.setValueAtTime(pv(p, v), pt(t)); } catch { /* scheduling error: ignore (cosmetic) */ }
}
/** linearRampToValueAtTime, finite + range clamped, never throws. */
export function linTo(p: AudioParam, v: number, t: number): void {
  try { p.linearRampToValueAtTime(pv(p, v), pt(t)); } catch { /* ignore */ }
}

/**
 * Percussive envelope: 0 → peak over `att`, then an exponential-looking decay built from
 * `segs` linear segments that lands on exactly 0 at t + att + dec. `shape` = steepness
 * (e-folds over the decay). Returns the end time.
 */
export function envPerc(p: AudioParam, t: number, peak: number, att: number, dec: number, shape = 4, segs = 6): number {
  att = Math.max(0.0005, fin(att, 0.002)); dec = Math.max(0.002, fin(dec, 0.1));
  setAt(p, 0, t);
  linTo(p, peak, t + att);
  const e = Math.exp(-shape);
  for (let i = 1; i <= segs; i++) {
    const u = i / segs;
    linTo(p, peak * (Math.exp(-shape * u) - e) / (1 - e), t + att + dec * u);
  }
  return t + att + dec;
}

/** Attack → hold → exponential-looking release to exactly 0. Returns the end time. */
export function envAHR(p: AudioParam, t: number, peak: number, att: number, hold: number, rel: number, shape = 3): number {
  att = Math.max(0.0005, fin(att, 0.005)); hold = Math.max(0, fin(hold, 0)); rel = Math.max(0.004, fin(rel, 0.1));
  setAt(p, 0, t);
  linTo(p, peak, t + att);
  if (hold > 0) linTo(p, peak, t + att + hold);
  const t1 = t + att + hold;
  const e = Math.exp(-shape);
  for (let i = 1; i <= 5; i++) {
    const u = i / 5;
    linTo(p, peak * (Math.exp(-shape * u) - e) / (1 - e), t1 + rel * u);
  }
  return t1 + rel;
}

/** Frequency sweep f0 → f1 over dur, geometric (log-space) via `segs` linear segments. */
export function sweep(p: AudioParam, t: number, f0: number, f1: number, dur: number, segs = 6): void {
  f0 = Math.max(1, fin(f0, 100)); f1 = Math.max(1, fin(f1, 100)); dur = Math.max(0.001, fin(dur, 0.1));
  setAt(p, f0, t);
  const r = f1 / f0;
  for (let i = 1; i <= segs; i++) {
    const u = i / segs;
    linTo(p, f0 * Math.pow(r, u), t + dur * u);
  }
}

/** Piecewise-linear automation from a list of [time offset, value] points. */
export function curveTo(p: AudioParam, t: number, pts: readonly (readonly [number, number])[]): void {
  if (!pts.length) return;
  setAt(p, pts[0][1], t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) linTo(p, pts[i][1], t + pts[i][0]);
}

// ─────────────────────────────── node factories ───────────────────────────────

export type Ctx = BaseAudioContext;

export function mkGain(ac: Ctx, v = 1): GainNode {
  const g = ac.createGain();
  g.gain.value = fin(v, 0);
  return g;
}

export function mkFilter(ac: Ctx, type: BiquadFilterType, freq: number, Q = 0.707, gainDb = 0): BiquadFilterNode {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = clampf(freq, 10, ac.sampleRate * 0.49);
  f.Q.value = clampf(Q, 0.0001, 60);
  f.gain.value = clampf(gainDb, -40, 40);
  return f;
}

/** Oscillator started at t and stopped at stop. */
export function mkOsc(ac: Ctx, type: OscillatorType, freq: number, t: number, stop: number, detune = 0): OscillatorNode {
  const o = ac.createOscillator();
  o.type = type === 'custom' ? 'sine' : type;
  o.frequency.value = clampf(freq, 0, ac.sampleRate * 0.49);
  o.detune.value = clampf(detune, -4800, 4800);
  try { o.start(pt(t)); o.stop(pt(Math.max(fin(stop, t + 0.1), fin(t, 0) + 0.005))); } catch { /* ignore */ }
  return o;
}

/** Stereo panner (falls back to a unity gain where the panner is missing). */
export function mkPan(ac: Ctx, pan: number): AudioNode {
  const anyAc = ac as Ctx & { createStereoPanner?: () => StereoPannerNode };
  if (typeof anyAc.createStereoPanner === 'function') {
    const p = anyAc.createStereoPanner();
    p.pan.value = clampf(pan, -1, 1);
    return p;
  }
  return mkGain(ac, 1);
}

export type NoiseColor = 'white' | 'pink' | 'brown';
const noiseCache = new WeakMap<Ctx, Partial<Record<NoiseColor, AudioBuffer>>>();

/** 2.5 s mono noise buffer per context + colour (generated once, cosmetic Math.random is fine). */
export function noiseBuf(ac: Ctx, color: NoiseColor): AudioBuffer {
  let rec = noiseCache.get(ac);
  if (!rec) { rec = {}; noiseCache.set(ac, rec); }
  const hit = rec[color];
  if (hit) return hit;
  const len = Math.floor(ac.sampleRate * 2.5);
  const fade = Math.min(2048, len >> 3);
  // generate len + fade samples, then crossfade the overrun into the head: sample len-1 flows
  // straight into sample 0 (its true continuation), so looping beds have no seam or dropout
  const g = new Float32Array(len + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < g.length; i++) {
    const wv = Math.random() * 2 - 1;
    if (color === 'white') g[i] = wv * 0.9;
    else if (color === 'pink') {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + wv * 0.0555179; b1 = 0.99332 * b1 + wv * 0.0750759;
      b2 = 0.969 * b2 + wv * 0.153852; b3 = 0.8665 * b3 + wv * 0.3104856;
      b4 = 0.55 * b4 + wv * 0.5329522; b5 = -0.7616 * b5 - wv * 0.016898;
      g[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + wv * 0.5362) * 0.11;
      b6 = wv * 0.115926;
    } else {
      last = (last + 0.02 * wv) / 1.02;
      g[i] = last * 3.2;
    }
  }
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = g[i];
  for (let i = 0; i < fade; i++) {
    const k = i / fade;          // equal-power: the two noise streams are uncorrelated, so power stays flat
    d[i] = g[i] * Math.sqrt(k) + g[len + i] * Math.sqrt(1 - k);
  }
  rec[color] = buf;
  return buf;
}

/** Looping noise source started at t (random offset so repeats never phase-align), stopped at stop. */
export function mkNoise(ac: Ctx, color: NoiseColor, t: number, stop: number, rate = 1): AudioBufferSourceNode {
  const s = ac.createBufferSource();
  s.buffer = noiseBuf(ac, color);
  s.loop = true;
  s.playbackRate.value = clampf(rate, 0.05, 8);
  try { s.start(pt(t), Math.random() * 2); s.stop(pt(Math.max(fin(stop, t + 0.1), fin(t, 0) + 0.005))); } catch { /* ignore */ }
  return s;
}

const curveCache = new Map<string, Float32Array<ArrayBuffer>>();

/** Grit waveshaper (asymmetric soft saturation). amount 0..1. */
export function mkGrit(ac: Ctx, amount: number): WaveShaperNode {
  const a = Math.round(clampf(amount, 0, 1) * 20) / 20;
  const key = 'grit' + a;
  let c = curveCache.get(key);
  if (!c) {
    const n = 1024, k = 1 + a * 40;
    c = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const y = Math.tanh(k * (x + 0.08 * a * x * x)) / norm;
      c[i] = clampf(y, -1, 1);
    }
    curveCache.set(key, c);
  }
  const ws = ac.createWaveShaper();
  ws.curve = c;
  ws.oversample = 'none';
  return ws;
}

/** Master soft clip over an input range of ±2 (feed it ×0.5): transparent below 0.8, never exceeds 0.99. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const hit = curveCache.get('master');
  if (hit) return hit;
  const n = 4096;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;     // actual signal level (pre-scaled ×0.5 upstream)
    const ax = Math.abs(x);
    const y = ax < 0.8 ? ax : 0.8 + 0.19 * Math.tanh((ax - 0.8) / 0.19);
    c[i] = Math.sign(x) * Math.min(0.99, y);
  }
  curveCache.set('master', c);
  return c;
}

/** FM pair: carrier (type sine) with a sine modulator at ratio × f; returns nodes for enveloping. */
export function mkFM(ac: Ctx, f: number, ratio: number, index: number, t: number, stop: number, modType: OscillatorType = 'sine'): { car: OscillatorNode; mod: OscillatorNode; depth: GainNode } {
  const car = mkOsc(ac, 'sine', f, t, stop);
  const mod = mkOsc(ac, modType, f * ratio, t, stop);
  const depth = mkGain(ac, clampf(index * f * ratio, 0, 20000));
  mod.connect(depth);
  depth.connect(car.frequency);
  return { car, mod, depth };
}

/** Procedural stereo room/hall impulse (seeded noise, early reflections, progressive damping). */
function makeImpulse(ac: Ctx, seconds: number, decay: number): AudioBuffer {
  const sr = ac.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ac.createBuffer(2, len, sr);
  let seed = 0x5eed7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  const taps = [0.0113, 0.0171, 0.0237, 0.0311, 0.0419, 0.0533];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr;
      const env = Math.pow(1 - i / len, decay) * Math.exp(-tt * 1.4);
      // damping: the tail gets darker (one-pole lowpass whose coefficient falls with time)
      const k = 0.85 - 0.7 * (i / len);
      lp = lp + k * (rnd() - lp);
      d[i] = lp * env * 0.55;
    }
    for (let j = 0; j < taps.length; j++) {
      const idx = Math.floor((taps[j] + ch * 0.0037 * (j + 1)) * sr);
      if (idx < len) d[idx] += (j % 2 ? -1 : 1) * 0.5 * Math.pow(0.78, j);
    }
    // ramp the first ms in to avoid a click
    const r = Math.min(len, Math.floor(sr * 0.002));
    for (let i = 0; i < r; i++) d[i] *= i / r;
  }
  return buf;
}

// ─────────────────────────────── the engine ───────────────────────────────

export interface AudioEngineOptions {
  /** Render into this context (an OfflineAudioContext for verification). The engine is then
   *  "unlocked" immediately and never starts timers. */
  context?: BaseAudioContext;
}

type ACtor = new (opts?: AudioContextOptions) => AudioContext;

export class AudioEngine {
  private _ac: BaseAudioContext | null = null;
  private _live: AudioContext | null = null;
  private _sfx: GainNode | null = null;
  private _music: GainNode | null = null;
  private _duck: GainNode | null = null;
  private _master: GainNode | null = null;
  private _sfxVerb: GainNode | null = null;
  private _musicVerb: GainNode | null = null;
  private _unlocked = false;
  private _unlocking: Promise<void> | null = null;
  private _vol = { master: 0.8, music: 0.6, sfx: 0.8 };
  private _listeners: (() => void)[] = [];
  /** true when rendering into an injected (offline) context — no timers, time only moves while rendering */
  readonly offline: boolean;

  constructor(opts?: AudioEngineOptions) {
    this.offline = !!opts?.context;
    if (opts?.context) {
      this._ac = opts.context;
      try { this.build(opts.context); this._unlocked = true; } catch { this._ac = null; this._unlocked = false; }
      return;
    }
    // Belt and braces: any user gesture (re)unlocks — covers an app that unlocks once and a browser
    // that suspends the context again later (interruptions, backgrounded mobile tabs).
    try {
      const win = (globalThis as unknown as { window?: Window }).window;
      if (win && typeof win.addEventListener === 'function') {
        const kick = () => { if (!this.ready) void this.unlock(); };
        for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) win.addEventListener(ev, kick, { capture: true, passive: true });
      }
    } catch { /* no window: stay silent */ }
  }

  /** Fire queued onReady callbacks once the engine can actually make sound. */
  private flush(): void {
    if (!this.ready || !this._listeners.length) return;
    const ls = this._listeners.splice(0);
    for (const cb of ls) { try { cb(); } catch { /* ignore */ } }
  }

  /** The live AudioContext (null before unlock, when unavailable, or when rendering offline). */
  get ctx(): AudioContext | null { return this._live; }
  /** Whatever context the engine renders into (live or offline) — the synth code uses this. */
  get ac(): BaseAudioContext | null { return this._ac; }
  get sfxBus(): GainNode | null { return this._sfx; }
  get musicBus(): GainNode | null { return this._music; }
  /** Wet send into the shared procedural reverb (sfx side). */
  get sfxVerb(): GainNode | null { return this._sfxVerb; }
  /** Wet send into the shared procedural reverb (music side). */
  get musicVerb(): GainNode | null { return this._musicVerb; }
  /** Unlocked and able to make sound. */
  get ready(): boolean {
    // a live context the browser suspended again (interruption, backgrounding) is not "ready":
    // scheduling into a frozen clock would burst every queued sound on resume
    return this._unlocked && !!this._ac && !!this._sfx && (!this._live || this._live.state === 'running');
  }
  /** Context time (0 when no context). */
  get now(): number { return this._ac ? fin(this._ac.currentTime, 0) : 0; }

  /** Register a callback for the moment the engine becomes ready (fires immediately if already ready). */
  onReady(cb: () => void): void {
    if (this.ready) { try { cb(); } catch { /* ignore */ } return; }
    this._listeners.push(cb);
  }

  /** Create/resume the AudioContext. Call from a user gesture; safe to call repeatedly. */
  unlock(): Promise<void> {
    if (this._unlocking) return this._unlocking;
    this._unlocking = this.doUnlock().finally(() => { this._unlocking = null; });
    return this._unlocking;
  }

  private async doUnlock(): Promise<void> {
    try {
      if (!this._ac) {
        const g = globalThis as unknown as { AudioContext?: ACtor; webkitAudioContext?: ACtor };
        const C = g.AudioContext ?? g.webkitAudioContext;
        if (!C) return;                       // no WebAudio here — stay silent forever
        const live = new C({ latencyHint: 'interactive' });
        this._live = live;
        this._ac = live;
        this.build(live);
        try { live.addEventListener('statechange', () => this.flush()); } catch { /* ignore */ }
      }
      if (this._live && this._live.state !== 'running') {
        try { await this._live.resume(); } catch { /* the next gesture retries */ }
      }
      const running = !this._live || this._live.state === 'running';
      if (running) { this._unlocked = true; this.flush(); }
    } catch {
      // A broken audio stack must never break the game.
    }
  }

  /** Volumes 0..1 (Settings). Perceptual (squared) taper, smoothed over 60 ms. */
  setVolumes(master: number, music: number, sfx: number): void {
    this._vol.master = clampf(master, 0, 1);
    this._vol.music = clampf(music, 0, 1);
    this._vol.sfx = clampf(sfx, 0, 1);
    this.applyVolumes(0.06);
  }

  /**
   * Duck the music bus (e.g. under the MASS BREACH roar): down to (1 − depth) over 60 ms,
   * hold, then back to 1 over `release` seconds.
   */
  duck(depth: number, hold: number, release: number): void {
    const ac = this._ac, d = this._duck;
    if (!ac || !d || !this.ready) return;
    const t = ac.currentTime;
    const lvl = 1 - clampf(depth, 0, 0.95);
    try { d.gain.cancelScheduledValues(t); } catch { /* ignore */ }
    setAt(d.gain, d.gain.value, t);
    linTo(d.gain, lvl, t + 0.06);
    linTo(d.gain, lvl, t + 0.06 + clampf(hold, 0, 10));
    linTo(d.gain, 1, t + 0.06 + clampf(hold, 0, 10) + clampf(release, 0.05, 10));
  }

  private applyVolumes(ramp: number): void {
    const ac = this._ac;
    if (!ac || !this._master || !this._music || !this._sfx) return;
    const t = ac.currentTime;
    const taper = (v: number) => v * v;
    const set = (g: GainNode, v: number) => {
      try { g.gain.cancelScheduledValues(t); } catch { /* ignore */ }
      setAt(g.gain, g.gain.value, t);
      linTo(g.gain, v, t + ramp);
    };
    set(this._master, taper(this._vol.master) * 1.0);
    set(this._music, taper(this._vol.music) * MUSIC_BUS_GAIN);
    set(this._sfx, taper(this._vol.sfx) * 1.0);
  }

  private build(ac: BaseAudioContext): void {
    const master = mkGain(ac, 1);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const pre = mkGain(ac, 0.5);
    const clip = ac.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = 'none';
    master.connect(comp); comp.connect(pre); pre.connect(clip); clip.connect(ac.destination);

    const sfx = mkGain(ac, 1);
    const music = mkGain(ac, 1);
    const duck = mkGain(ac, 1);
    const sfxOut = mkGain(ac, Math.pow(10, -SFX_GLUE_MAKEUP_DB / 20));
    // SFX bus glue: a slow-ish, gentle compressor that only works when many voices stack (single
    // hits sit under the threshold and keep their transient), after a high shelf that softens the
    // stacked crunch / debris fizz
    const shelf = mkFilter(ac, 'highshelf', 5200, 0.707, -3);
    const glue = ac.createDynamicsCompressor();
    glue.threshold.value = -22;
    glue.knee.value = 10;   // SFX_GLUE_MAKEUP_DB was measured for exactly these settings
    glue.ratio.value = 2.5;
    glue.attack.value = 0.008;
    glue.release.value = 0.3;
    sfx.connect(shelf); shelf.connect(glue); glue.connect(sfxOut); sfxOut.connect(master);
    music.connect(duck); duck.connect(master);

    const ir = makeImpulse(ac, 2.4, 2.6);
    const convA = ac.createConvolver(); convA.normalize = true; convA.buffer = ir;
    const convB = ac.createConvolver(); convB.normalize = true; convB.buffer = ir;
    const sfxVerb = mkGain(ac, 1), musicVerb = mkGain(ac, 1);
    const retA = mkGain(ac, 0.9), retB = mkGain(ac, 0.8);
    sfxVerb.connect(convA); convA.connect(retA); retA.connect(sfx);
    musicVerb.connect(convB); convB.connect(retB); retB.connect(music);

    this._master = master; this._sfx = sfx; this._music = music; this._duck = duck;
    this._sfxVerb = sfxVerb; this._musicVerb = musicVerb;
    this.applyVolumes(0.001);
  }
}
