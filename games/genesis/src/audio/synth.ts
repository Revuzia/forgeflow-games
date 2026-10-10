// GENESIS — WebAudio building blocks shared by the SFX catalog, the instruments, the ambience beds and the spatial
// emitters: envelopes, glides, oscillators, filters, buffer sources, an organ wave, and `Knob`, a parameter smoother
// that only touches the automation timeline when a value really moves (the frame loop sets dozens of targets per
// frame; most do not change).

/** linear attack to `peak`, hold, then an exponential release; returns when the voice is effectively silent */
export function envelope(p: AudioParam, t: number, a: number, hold: number, rel: number, peak: number): number {
  const at = Math.max(0.002, a);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + at);
  if (hold > 0) p.setValueAtTime(peak, t + at + hold);
  p.setTargetAtTime(0, t + at + Math.max(0, hold), Math.max(0.004, rel / 5));
  return t + at + Math.max(0, hold) + rel;
}

/** a percussive envelope: near-instant attack, exponential decay over `d` seconds; returns the end */
export function perc(p: AudioParam, t: number, d: number, peak: number, a = 0.002): number {
  return envelope(p, t, a, 0, d, peak);
}

/** exponential glide of a positive parameter (a frequency) from v0 to v1 over `dur` */
export function glide(p: AudioParam, t: number, v0: number, v1: number, dur: number): void {
  p.setValueAtTime(Math.max(1e-3, v0), t);
  if (v1 !== v0) p.exponentialRampToValueAtTime(Math.max(1e-3, v1), t + Math.max(0.005, dur));
}

export function osc(ctx: BaseAudioContext, type: OscillatorType | PeriodicWave, f: number, t: number, end: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  if (type instanceof PeriodicWave) o.setPeriodicWave(type); else o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (detune) o.detune.setValueAtTime(detune, t);
  o.start(t);
  o.stop(end + 0.02);
  return o;
}

export function bq(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.707, gainDb = 0): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = Math.max(10, Math.min(ctx.sampleRate * 0.49, f));
  b.Q.value = q;
  if (gainDb) b.gain.value = gainDb;
  return b;
}

export function gainNode(ctx: BaseAudioContext, v = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

/** a buffer source; a looping one starts at `offset` (any point of a seamless loop is a good start) */
export function bufSrc(ctx: BaseAudioContext, buf: AudioBuffer, t: number, end: number | null, rate = 1, loop = false, offset = 0): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = loop;
  s.playbackRate.setValueAtTime(rate, t);
  s.start(t, loop ? offset % buf.duration : Math.max(0, offset));
  if (end != null) s.stop(end + 0.02);
  return s;
}

/** connect nodes in series; returns the last */
export function link(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

const ORGAN = new WeakMap<BaseAudioContext, PeriodicWave>();
/** drawbar organ: 8′ 4′ 2⅔′ 2′ 1⅗′ 1′ (harmonics 1 2 3 4 5 8) — a church / town hall organ */
export function organWave(ctx: BaseAudioContext): PeriodicWave {
  let w = ORGAN.get(ctx);
  if (!w) {
    const n = 9;
    const re = new Float32Array(n), im = new Float32Array(n);
    const amps: Record<number, number> = { 1: 1, 2: 0.75, 3: 0.45, 4: 0.4, 5: 0.18, 6: 0.22, 8: 0.15 };
    for (let k = 1; k < n; k++) im[k] = amps[k] ?? 0;
    w = ctx.createPeriodicWave(re, im, { disableNormalization: false });
    ORGAN.set(ctx, w);
  }
  return w;
}

const REED = new WeakMap<BaseAudioContext, PeriodicWave>();
/** a nasal reed / bird-syrinx tone: odd harmonics with a formant lift */
export function reedWave(ctx: BaseAudioContext): PeriodicWave {
  let w = REED.get(ctx);
  if (!w) {
    const n = 12;
    const re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (k % 2 ? 1 : 0.35) / k * (k === 3 || k === 5 ? 1.8 : 1);
    w = ctx.createPeriodicWave(re, im);
    REED.set(ctx, w);
  }
  return w;
}

/**
 * A smoothed AudioParam: `set` glides toward a value with time constant `tau`, and skips the call when the value has
 * not moved (so a frame loop can drive dozens of parameters without flooding the automation timeline).
 */
export class Knob {
  readonly p: AudioParam;
  private last = NaN;
  constructor(p: AudioParam) { this.p = p; }
  set(v: number, now: number, tau = 0.1): void {
    if (!Number.isFinite(v)) return;
    const eps = 1e-4 * Math.max(1, Math.abs(v));
    if (Math.abs(v - this.last) < eps) return;
    this.p.setTargetAtTime(v, now, tau);
    this.last = v;
  }
  /** jump (cancel pending ramps) */
  hard(v: number, now: number): void {
    this.p.cancelScheduledValues(now);
    this.p.setValueAtTime(v, now);
    this.last = v;
  }
  get value(): number { return this.last; }
}

export function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
