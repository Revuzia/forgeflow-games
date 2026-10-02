// WOBBLEHOARD audio: shared DSP helpers. Nothing here touches the DOM or Math.random(): the same code runs in a live
// AudioContext and in an OfflineAudioContext, and every random draw comes from a seeded mulberry32 stream.
import { mulberry32, clamp } from '../core/rng.ts';

export const TAU = Math.PI * 2;

/** Finite number or the default. Every public entry point funnels user numbers through this (AudioParam throws on NaN). */
export const fin = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
/** Finite and clamped to 0..1. */
export const c01 = (x: unknown, d = 0): number => clamp(fin(x, d), 0, 1);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Exponential (geometric) interpolation between two positive numbers. */
export const glerp = (a: number, b: number, t: number): number => a * Math.pow(b / a, t);

/** The seeded stream every voice draws from. */
export type Rng = () => number;
export const makeRng = (seed: number): Rng => mulberry32(seed >>> 0);
/** Uniform in [lo, hi). */
export const rr = (r: Rng, lo: number, hi: number): number => lo + (hi - lo) * r();
/** Log-uniform in [lo, hi). */
export const rlog = (r: Rng, lo: number, hi: number): number => lo * Math.pow(hi / lo, r());
/** Exponential waiting time with the given rate (events per second). */
export const rexp = (r: Rng, rate: number): number => -Math.log(1 - r()) / Math.max(rate, 1e-9);

/* ───────────── node bookkeeping: created vs disconnected, so the leak probe can prove the live count returns to 0 ───────────── */

export const nodeCounters = { created: 0, freed: 0, groupsOpened: 0, groupsFreed: 0 };
export const liveNodeCount = (): number => nodeCounters.created - nodeCounters.freed;
export const liveGroupCount = (): number => nodeCounters.groupsOpened - nodeCounters.groupsFreed;

type Ctx = BaseAudioContext;

/** Per-context scratch objects (noise buffer, periodic waves), created lazily and cached. */
interface CtxCache { noise: AudioBuffer | null; waves: Map<string, PeriodicWave> }
const caches = new WeakMap<BaseAudioContext, CtxCache>();
function cacheOf(ctx: Ctx): CtxCache {
  let c = caches.get(ctx);
  if (!c) { c = { noise: null, waves: new Map() }; caches.set(ctx, c); }
  return c;
}

/**
 * A 2.5 s mono noise buffer made in code from a fixed seed (not a sample: it is the noise generator WebAudio lacks).
 * Roughly gaussian (sum of three uniforms) so band-passed results do not clip the way raw uniform noise can.
 */
export function noiseBuffer(ctx: Ctx): AudioBuffer {
  const c = cacheOf(ctx);
  if (c.noise) return c.noise;
  const len = Math.floor(ctx.sampleRate * 2.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = mulberry32(0x5eed1e55);
  let mean = 0;
  for (let i = 0; i < len; i++) { const v = (r() + r() + r() - 1.5) * 0.9; d[i] = v; mean += v; }
  mean /= len;
  for (let i = 0; i < len; i++) d[i] -= mean; // exactly zero mean: no DC from the noise layers
  c.noise = buf;
  return buf;
}

/** A periodic wave from harmonic amplitudes h[1..n] (sine phase), cached per context. */
export function harmonicWave(ctx: Ctx, key: string, h: number[]): PeriodicWave {
  const c = cacheOf(ctx);
  let w = c.waves.get(key);
  if (!w) {
    const real = new Float32Array(h.length + 1);
    const imag = new Float32Array(h.length + 1);
    for (let i = 0; i < h.length; i++) imag[i + 1] = h[i];
    w = ctx.createPeriodicWave(real, imag);
    c.waves.set(key, w);
  }
  return w;
}

/* ───────────── Bag: owns the nodes of one voice group; frees them all when the last source has ended ───────────── */

export interface VoiceGroup {
  readonly kind: string;
  /** Context time at which this group will have fallen silent by itself (Infinity while a held voice is open). */
  readonly endTime: number;
  readonly alive: boolean;
  /** True once kill() has been called: the voice is fading out and no longer counts against the polyphony cap. */
  readonly dying: boolean;
  /** True for the held squish: never the first choice when stealing. */
  readonly held: boolean;
  /** Fade out quickly (default 20 ms) and free the nodes. Safe to call twice. */
  kill(fadeS?: number): void;
  /** Disconnect everything NOW (no fade). Used when the context is suspended and 'ended' events will not arrive. */
  free(): void;
}

export class Bag implements VoiceGroup {
  readonly kind: string;
  readonly ctx: Ctx;
  readonly held: boolean;
  /** Every voice routes through this gain: it is the group's fade handle. */
  readonly head: GainNode;
  endTime = Infinity;
  alive = true;
  /** Present when the group is panned (always for held voices, whose pan is live-updatable). */
  panner: StereoPannerNode | null = null;
  onFree: ((b: Bag) => void) | null = null;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private pending = 0;
  private killed = false;
  get dying(): boolean { return this.killed; }

  constructor(ctx: Ctx, out: AudioNode, kind: string, pan: number, held = false) {
    this.ctx = ctx;
    this.kind = kind;
    this.held = held;
    this.head = this.add(ctx.createGain());
    let tail: AudioNode = this.head;
    const p = clamp(fin(pan, 0), -1, 1);
    if ((held || Math.abs(p) > 0.01) && typeof ctx.createStereoPanner === 'function') {
      const sp = this.add(ctx.createStereoPanner());
      sp.pan.value = p;
      tail.connect(sp);
      tail = sp;
      this.panner = sp;
    }
    tail.connect(out);
    nodeCounters.groupsOpened++;
  }

  add<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    nodeCounters.created++;
    return n;
  }

  /** Register a scheduled source (it MUST be given a stop time). The bag frees itself when the last one ends. */
  src<T extends AudioScheduledSourceNode>(s: T): T {
    this.add(s);
    this.sources.push(s);
    this.pending++;
    s.onended = () => { if (--this.pending <= 0) this.free(); };
    return s;
  }

  gain(v: number): GainNode { const g = this.add(this.ctx.createGain()); g.gain.value = v; return g; }
  biquad(type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
    const b = this.add(this.ctx.createBiquadFilter());
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  }
  /** Oscillator started at `t`; stopped at `tEnd` when given (held voices stop it later through stopAll). */
  osc(type: OscillatorType, f: number, t: number, tEnd?: number): OscillatorNode {
    const o = this.src(this.ctx.createOscillator());
    o.type = type; o.frequency.value = f;
    o.start(t);
    if (tEnd !== undefined) o.stop(tEnd);
    return o;
  }
  /** Looped noise source, started at `t` from a random offset so two voices never play the same stretch. */
  noise(r: Rng, t: number, tEnd?: number): AudioBufferSourceNode {
    const s = this.src(this.ctx.createBufferSource());
    s.buffer = noiseBuffer(this.ctx);
    s.loop = true;
    s.start(t, r() * (s.buffer.duration - 0.05));
    if (tEnd !== undefined) s.stop(tEnd);
    return s;
  }
  /** Schedule the stop of every registered source (used by held voices when they end). */
  stopAll(t: number): void {
    for (const s of this.sources) { try { s.stop(t); } catch { /* already stopped */ } }
  }

  /** Fade out over `fadeS` starting at `atTime` (default: now, reading the live gain) and free the nodes. */
  kill(fadeS = 0.02, atTime?: number): void {
    if (!this.alive || this.killed) return;
    this.killed = true;
    const scripted = atTime !== undefined && Number.isFinite(atTime);
    const now = scripted ? Math.max(0, atTime as number) : this.ctx.currentTime;
    const f = clamp(fin(fadeS, 0.02), 0.004, 2);
    try {
      const g = this.head.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(scripted ? 1 : g.value, now);
      g.linearRampToValueAtTime(0, now + f);
    } catch { /* closed context: the stop() below still ends the voice */ }
    this.stopAll(now + f + 0.004);
    this.endTime = Math.min(this.endTime, now + f + 0.004);
    if (this.pending <= 0) this.free();
  }

  free(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* already gone */ } }
    for (const s of this.sources) s.onended = null;
    nodeCounters.freed += this.nodes.length;
    nodeCounters.groupsFreed++;
    this.nodes.length = 0;
    this.sources.length = 0;
    const cb = this.onFree;
    this.onFree = null;
    if (cb) cb(this);
  }
}

/* ───────────── bubbles ───────────── */

/**
 * One Minnaert bubble: an exponentially damped sine at f0 = 3.26 / r (r in metres) with a small upward chirp as the
 * bubble settles. Damping follows the usual thermal + viscous + radiation fit d = 0.13/r + 0.0072 r^-1.5 (1/s). The idea
 * is from the liquid-sound literature (a stream of such bubbles IS the sound of water); this code is our own.
 * Freed through its own 'ended' handler. `soft` > 1 lengthens the ring, `chirp` is the settle chirp (0.1 = textbook).
 * Returns the context time at which it is silent.
 */
export function bubble(
  ctx: Ctx, dest: AudioNode, t: number, radiusM: number, amp: number,
  chirp = 0.12, soft = 1,
): number {
  const r = clamp(fin(radiusM, 0.002), 0.0003, 0.03);
  const f0 = 3.26 / r;
  const d = (0.13 / r + 0.0072 / Math.pow(r, 1.5)) / Math.max(soft, 0.1);
  const T = clamp(7 / d, 0.006, 0.32);
  if (f0 > ctx.sampleRate * 0.45) return t;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  nodeCounters.created += 2;
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  // f(t) = f0 (1 + chirp * d * t): the textbook linear settle chirp, capped below Nyquist.
  o.frequency.linearRampToValueAtTime(Math.min(f0 * (1 + chirp * d * T), ctx.sampleRate * 0.45), t + T);
  const a = clamp(fin(amp, 0), 0, 4);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(a, t + 0.0007);
  g.gain.setTargetAtTime(0, t + 0.0007, 1 / d);
  o.connect(g);
  g.connect(dest);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } o.onended = null; nodeCounters.freed += 2; };
  o.start(t);
  o.stop(t + T + 0.01);
  return t + T + 0.01;
}

/** Soft-clip safety curve: transparent below ~0.55, smooth knee, hard ceiling at `ceil` (default -1 dBFS). */
export function softClipCurve(n = 4097, ceil = 0.89, knee = 0.55): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const span = ceil - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a < knee ? a : knee + span * Math.tanh((a - knee) / span);
    c[i] = Math.sign(x) * Math.min(y, ceil);
  }
  return c;
}
