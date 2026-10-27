// GENESIS — the offline orchestra for the AUTHORED music (LIVING §0: "authored music"; CONTRACT §17).
//
// Pure TypeScript: no WebAudio, no Node APIs, deterministic (seeded noise), so a piece renders to the same PCM on any
// machine. The render driver (_harness/scratch/presentation/music/render.ts) turns the score modules (title.ts, eras.ts,
// stingers.ts) into PCM with these instruments, masters it (BS.1770 loudness, a lookahead peak limiter) and encodes Opus
// with ffmpeg into src/audio/assets/. The voices mirror the game's own WebAudio set (instruments.ts): bone flute and
// hummed voice, lyre and harp, bowed strings, horn, glass bells, frame drum and timpani, so an authored piece and the
// procedural score that alternates with it sound like one orchestra. Nothing here is imported by the shipped game.

export const SR = 48000;
const TAU = Math.PI * 2;

export interface Stereo { L: Float32Array; R: Float32Array }
export function stereo(n: number): Stereo { return { L: new Float32Array(n), R: new Float32Array(n) }; }

/** mulberry32: the seeded noise of every voice */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hz(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }

/** a note in seconds (score.ts converts beats) */
export interface Note { t: number; d: number; midi: number; v: number; pan?: number }

export type Inst =
  | 'strings' | 'violins' | 'cellos' | 'choir' | 'oohs' | 'horn' | 'flute' | 'boneflute' | 'reed' | 'harp' | 'lyre'
  | 'celesta' | 'glass' | 'bell' | 'drone' | 'bass' | 'pad' | 'organ' | 'timpani' | 'framedrum' | 'lowdrum' | 'shaker' | 'swell';

// ───────────────────────────── building blocks ─────────────────────────────

function polyblep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** Zavalishin's TPT state-variable filter */
class Svf {
  ic1 = 0; ic2 = 0; a1 = 0; a2 = 0; a3 = 0; k = 1; b = 0;
  set(fc: number, q: number): void {
    const g = Math.tan(Math.PI * Math.min(Math.max(fc, 10), SR * 0.45) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  low(v0: number): number {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.b = v1;
    return v2;
  }
  /** unity gain at the centre */
  band(v0: number): number { this.low(v0); return this.b * this.k; }
  high(v0: number): number { const lp = this.low(v0); return v0 - this.k * this.b - lp; }
}

function smooth01(x: number): number { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }

/** attack (smooth), sustain to d, then an exponential release reaching -40 dB at d + rel */
function env(t: number, d: number, a: number, rel: number): number {
  if (t < d) return t < a ? smooth01(t / a) : 1;
  const top = d < a ? smooth01(d / a) : 1;
  return top * Math.exp(-(t - d) * 4.6 / rel);
}

function panGains(p: number): [number, number] {
  const x = (Math.max(-1, Math.min(1, p)) + 1) * Math.PI / 4;
  return [Math.cos(x) * Math.SQRT2, Math.sin(x) * Math.SQRT2];
}

function monoOut(n: number): Stereo { const b = new Float32Array(n); return { L: b, R: b }; }

// ───────────────────────────── voices ─────────────────────────────

/** bowed strings: a detuned saw ensemble, stereo by voice, bow brightness follows velocity */
function bowed(n: Note, r: () => number, attack: number, release: number, bright: number, detune: number, voices: number, level: number): Stereo {
  const f = hz(n.midi), N = Math.ceil((n.d + release) * SR);
  const out = stereo(N);
  const ph = new Float64Array(voices), det = new Float64Array(voices);
  for (let i = 0; i < voices; i++) { ph[i] = r(); det[i] = Math.pow(2, (((i + 0.5) / voices) * 2 - 1) * detune / 1200); }
  const fl = new Svf(), fr = new Svf();
  const vr = 4.9 + r() * 0.6, vp = r() * TAU;
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const e = env(t, n.d, attack, release);
    if ((s & 31) === 0) {
      const fc = Math.min(12000, f * 2 + 800 + bright * 3600 * n.v * (0.55 + 0.45 * e));
      fl.set(fc, 0.62); fr.set(fc * 1.06, 0.62);
    }
    const vib = 1 + Math.min(1, t / 0.6) * 0.0042 * Math.sin(TAU * vr * t + vp);
    let l = 0, rr = 0;
    for (let i = 0; i < voices; i++) {
      const dt = f * det[i] * vib / SR;
      let p = ph[i] + dt; if (p >= 1) p -= 1; ph[i] = p;
      const v = 2 * p - 1 - polyblep(p, dt);
      if (i & 1) rr += v; else l += v;
    }
    out.L[s] = fl.low(l) * e; out.R[s] = fr.low(rr) * e;
  }
  const g = level * n.v / voices;
  for (let s = 0; s < N; s++) { out.L[s] *= g; out.R[s] *= g; }
  return out;
}

/** voices on a vowel: saws through three formant bands ('ah' choir, 'oo' hum) */
function choir(n: Note, r: () => number, formants: number[], level: number): Stereo {
  const f = hz(n.midi), rel = 1.1, N = Math.ceil((n.d + rel) * SR);
  const out = stereo(N);
  const sides: Svf[][] = [[new Svf(), new Svf(), new Svf()], [new Svf(), new Svf(), new Svf()]];
  const qs = [5, 7, 9], gs = [1, 0.5, 0.18];
  for (const side of sides) for (let i = 0; i < 3; i++) side[i].set(formants[i], qs[i]);
  const ph = [r(), r(), r(), r()];
  const det = [0.9965, 1.0021, 0.9982, 1.0038];
  const vr = [5.1 + r() * 0.5, 5.4 + r() * 0.5], vp = [r() * TAU, r() * TAU];
  const noise = rng((n.midi * 7919 + Math.round(n.t * 1000)) >>> 0);
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const e = env(t, n.d, 0.55, rel);
    const vd = Math.min(1, Math.max(0, (t - 0.25) / 0.7)) * 0.006;
    for (let c = 0; c < 2; c++) {
      const vib = 1 + vd * Math.sin(TAU * vr[c] * t + vp[c]);
      let x = 0;
      for (let j = 0; j < 2; j++) {
        const i = c * 2 + j;
        const dt = f * det[i] * vib / SR;
        let p = ph[i] + dt; if (p >= 1) p -= 1; ph[i] = p;
        x += 2 * p - 1 - polyblep(p, dt);
      }
      x += (noise() * 2 - 1) * 0.12;
      const fs = sides[c];
      const y = fs[0].band(x) * gs[0] + fs[1].band(x) * gs[1] + fs[2].band(x) * gs[2];
      (c === 0 ? out.L : out.R)[s] = y * e;
    }
  }
  const g = level * n.v;
  for (let s = 0; s < N; s++) { out.L[s] *= g; out.R[s] *= g; }
  return out;
}

/** a horn: two close saws through a lowpass that blooms on the attack */
function horn(n: Note, r: () => number, level: number): Stereo {
  const f = hz(n.midi), rel = 0.3, N = Math.ceil((n.d + rel) * SR);
  const out = monoOut(N);
  const flt = new Svf(), flt2 = new Svf();
  let p1 = r(), p2 = r();
  const vp = r() * TAU;
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const e = env(t, n.d, 0.09, rel);
    const bloom = t < 0.12 ? t / 0.12 : 0.72 + 0.28 * Math.exp(-(t - 0.12) / 0.25);
    if ((s & 15) === 0) { const fc = Math.min(5200, f * (1.1 + 2.4 * n.v * bloom * e)); flt.set(fc, 0.75); flt2.set(fc * 1.4, 0.6); }
    const scoop = Math.pow(2, (-14 * Math.exp(-t / 0.05)) / 1200);
    const vib = 1 + Math.min(1, Math.max(0, (t - 0.35) / 0.5)) * 0.003 * Math.sin(TAU * 4.8 * t + vp);
    const d1 = f * scoop * vib / SR, d2 = d1 * 1.0017;
    p1 += d1; if (p1 >= 1) p1 -= 1;
    p2 += d2; if (p2 >= 1) p2 -= 1;
    const x = (2 * p1 - 1 - polyblep(p1, d1)) + (2 * p2 - 1 - polyblep(p2, d2));
    out.L[s] = flt2.low(flt.low(x)) * e;
  }
  const g = level * n.v * 0.5;
  for (let s = 0; s < N; s++) out.L[s] *= g;
  return out;
}

/** flute (and the breathier, scooping bone flute): a near-sine with breath through a band at the pitch */
function flute(n: Note, r: () => number, bone: boolean, level: number): Stereo {
  const f = hz(n.midi), rel = bone ? 0.22 : 0.16, N = Math.ceil((n.d + rel) * SR);
  const out = monoOut(N);
  const bp = new Svf(); bp.set(f, bone ? 2.5 : 4);
  const ch = new Svf(); ch.set(f * 2.2, 2);
  const noise = rng((n.midi * 104729 + Math.round(n.t * 977)) >>> 0);
  let p = r();
  const vp = r() * TAU, breath = bone ? 0.55 : 0.3, h2 = bone ? 0.08 : 0.2, h3 = bone ? 0.02 : 0.06;
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const e = env(t, n.d, bone ? 0.08 : 0.05, rel) * (0.9 + 0.1 * Math.min(1, t / 0.6));
    const scoop = bone ? Math.pow(2, (-35 * Math.exp(-t / 0.07)) / 1200) : 1;
    const vib = 1 + Math.min(1, Math.max(0, (t - 0.28) / 0.4)) * (bone ? 0.004 : 0.005) * Math.sin(TAU * 5.1 * t + vp);
    p += f * scoop * vib / SR; if (p >= 1) p -= 1;
    const ph = p * TAU;
    const tone = Math.sin(ph) + h2 * Math.sin(2 * ph) + h3 * Math.sin(3 * ph);
    const w = noise() * 2 - 1;
    const air = bp.band(w) * breath * 1.6;
    const chiff = t < 0.05 ? ch.band(w) * (1 - t / 0.05) * 0.6 : 0;
    out.L[s] = (tone + air + chiff) * e;
  }
  const g = level * n.v * 0.5;
  for (let s = 0; s < N; s++) out.L[s] *= g;
  return out;
}

/** a double reed (shawm / duduk colour): a narrow pulse through a nasal formant */
function reed(n: Note, r: () => number, level: number): Stereo {
  const f = hz(n.midi), rel = 0.18, N = Math.ceil((n.d + rel) * SR);
  const out = monoOut(N);
  const f1 = new Svf(); f1.set(1150, 3);
  const lp = new Svf(); lp.set(Math.min(6000, f * 6), 0.7);
  let p = r();
  const vp = r() * TAU;
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const e = env(t, n.d, 0.05, rel);
    const vib = 1 + Math.min(1, Math.max(0, (t - 0.3) / 0.4)) * 0.004 * Math.sin(TAU * 5.6 * t + vp);
    const dt = f * vib / SR;
    p += dt; if (p >= 1) p -= 1;
    const saw1 = 2 * p - 1 - polyblep(p, dt);
    let q = p + 0.28; if (q >= 1) q -= 1;
    const saw2 = 2 * q - 1 - polyblep(q, dt);
    const x = saw1 - saw2;
    out.L[s] = (lp.low(x) * 0.6 + f1.band(x) * 0.7) * e;
  }
  const g = level * n.v * 0.4;
  for (let s = 0; s < N; s++) out.L[s] *= g;
  return out;
}

/** plucked string (Karplus–Strong with a tuned one-pole loop filter): harp warm and long, lyre bright and short */
function pluck(n: Note, r: () => number, lyre: boolean, level: number): Stereo {
  const f = hz(n.midi);
  const t60 = Math.max(0.6, Math.min(5, (lyre ? 2.2 : 3.6) * Math.sqrt(220 / f)));
  const hold = Math.min(t60, Math.max(n.d + 0.4, t60 * 0.7));
  const N = Math.ceil(hold * SR);
  const out = monoOut(N);
  const a = lyre ? 0.62 : 0.45;
  const D = SR / f - (1 - a) / a;
  const L = Math.floor(D), fr = D - L, M = L + 3;
  const buf = new Float32Array(M);
  const decay = Math.pow(10, -3 / (t60 * f));
  const noise = rng((n.midi * 15485863 + Math.round(n.t * 1009)) >>> 0);
  // the excitation: a brightness-shaped noise burst one period long
  const exc = new Float32Array(L + 1);
  const ex = new Svf(); ex.set(Math.min(9000, f * (lyre ? 9 : 5) * (0.5 + n.v)), 0.7);
  for (let i = 0; i <= L; i++) exc[i] = ex.low(noise() * 2 - 1);
  const body = new Svf(); body.set(lyre ? 420 : 260, 1.3);
  let w = 0, prev = 0;
  for (let s = 0; s < N; s++) {
    const i1 = (w - L + M) % M, i2 = (w - L - 1 + M) % M;
    const dl = buf[i1] + (buf[i2] - buf[i1]) * fr;
    prev = a * dl + (1 - a) * prev;
    const y = (s <= L ? exc[s] : 0) + decay * prev;
    buf[w] = y; w = (w + 1) % M;
    const fade = s > N - 2400 ? (N - s) / 2400 : 1;
    out.L[s] = (y + body.band(y) * 0.35) * fade;
  }
  const g = level * n.v * 0.9;
  for (let s = 0; s < N; s++) out.L[s] *= g;
  return out;
}

/** struck metal: additive partials with their own decays (celesta, glass bells, the tolling bell) */
function struck(n: Note, r: () => number, kind: 'celesta' | 'glass' | 'bell', level: number): Stereo {
  const f = hz(n.midi);
  const P = kind === 'celesta'
    ? [[1, 1, 1], [2, 0.32, 0.5], [3, 0.08, 0.3], [4.16, 0.08, 0.17], [5.43, 0.04, 0.1]]
    : kind === 'glass'
      ? [[1, 1, 1], [1.0018, 0.6, 0.9], [2.32, 0.28, 0.45], [4.25, 0.12, 0.22], [6.63, 0.05, 0.12]]
      : [[0.5, 0.35, 1.3], [1, 1, 1], [1.183, 0.45, 0.8], [1.506, 0.32, 0.6], [2, 0.5, 0.5], [2.514, 0.2, 0.35], [2.662, 0.18, 0.3], [3.011, 0.14, 0.25], [4.166, 0.08, 0.15]];
  const base = kind === 'celesta' ? 2.6 * Math.pow(440 / f, 0.3) : kind === 'glass' ? 4.2 * Math.pow(440 / f, 0.25) : 7;
  const N = Math.ceil(Math.min(base * 1.4, Math.max(n.d + 1.5, base)) * SR);
  const out = monoOut(N);
  const noise = rng((n.midi * 31337 + Math.round(n.t * 1013)) >>> 0);
  const hp = new Svf(); hp.set(4000, 0.7);
  for (const [ratio, amp, dk] of P) {
    const fr = f * ratio;
    if (fr > SR * 0.45) continue;
    const k = Math.exp(-6.9 / (base * dk * SR));
    let a = amp, ph = r() * TAU;
    const dph = TAU * fr / SR;
    for (let s = 0; s < N; s++) { out.L[s] += Math.sin(ph) * a; ph += dph; a *= k; }
  }
  for (let s = 0; s < 240 && s < N; s++) out.L[s] += hp.high(noise() * 2 - 1) * 0.25 * (1 - s / 240);
  for (let s = 0; s < 96 && s < N; s++) out.L[s] *= s / 96;
  const tail = Math.min(N, 4800);
  for (let s = N - tail; s < N; s++) out.L[s] *= (N - s) / tail;
  const g = level * n.v * 0.35;
  for (let s = 0; s < N; s++) out.L[s] *= g;
  return out;
}

/** a membrane: modes with a pitch drop and a mallet or hand noise */
function drum(n: Note, kind: 'timpani' | 'framedrum' | 'lowdrum', level: number): Stereo {
  const f = hz(n.midi);
  const modes = kind === 'timpani'
    ? [[1, 1, 1], [1.504, 0.5, 0.65], [1.742, 0.25, 0.45], [2, 0.3, 0.4], [2.245, 0.15, 0.3], [2.494, 0.1, 0.25]]
    : kind === 'framedrum' ? [[1, 1, 1], [1.59, 0.35, 0.5], [2.14, 0.2, 0.3]] : [[1, 1, 1], [1.47, 0.3, 0.45]];
  const t60 = kind === 'timpani' ? 2.4 : kind === 'framedrum' ? 0.42 : 1.1;
  const drop = kind === 'timpani' ? 0.025 : kind === 'framedrum' ? 0.5 : 0.8;
  const dropT = kind === 'timpani' ? 0.04 : kind === 'framedrum' ? 0.025 : 0.06;
  const N = Math.ceil((t60 + 0.1) * SR);
  const out = monoOut(N);
  for (const [ratio, amp, dk] of modes) {
    const k = Math.exp(-6.9 / (t60 * dk * SR));
    let a = amp, ph = 0;
    for (let s = 0; s < N; s++) {
      const t = s / SR;
      ph += TAU * f * ratio * (1 + drop * Math.exp(-t / dropT)) / SR;
      out.L[s] += Math.sin(ph) * a; a *= k;
    }
  }
  const noise = rng((n.midi * 7907 + Math.round(n.t * 1021)) >>> 0);
  const nf = new Svf(); nf.set(kind === 'framedrum' ? 1100 : kind === 'timpani' ? 900 : 350, kind === 'framedrum' ? 1.2 : 0.7);
  const nd = kind === 'framedrum' ? 0.06 * (0.5 + n.v) : 0.025;
  const nl = kind === 'framedrum' ? 0.9 * n.v : 0.5;
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    if (t > nd * 6) break;
    out.L[s] += (kind === 'framedrum' ? nf.band(noise() * 2 - 1) : nf.low(noise() * 2 - 1)) * nl * Math.exp(-t / nd);
  }
  for (let s = 0; s < 48 && s < N; s++) out.L[s] *= s / 48;
  const g = level * n.v * 0.55;
  for (let s = 0; s < N; s++) out.L[s] *= g;
  return out;
}

function shaker(n: Note, level: number): Stereo {
  const N = Math.ceil(0.16 * SR), out = monoOut(N);
  const noise = rng((Math.round(n.t * 1000) * 2654435761) >>> 0);
  const bp = new Svf(); bp.set(6500, 1.4);
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const e = t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) / 0.035);
    out.L[s] = bp.band(noise() * 2 - 1) * e;
  }
  const g = level * n.v * 0.5;
  for (let s = 0; s < N; s++) out.L[s] *= g;
  return out;
}

/** a suspended-cymbal swell: two independent noises rising to the note's end, then a short bloom */
function swell(n: Note, level: number): Stereo {
  const N = Math.ceil((n.d + 1.6) * SR), out = stereo(N);
  const nz = [rng((Math.round(n.t * 100) * 97 + 1) >>> 0), rng((Math.round(n.t * 100) * 89 + 2) >>> 0)];
  const hp = [new Svf(), new Svf()], bp = [new Svf(), new Svf()];
  for (let c = 0; c < 2; c++) { hp[c].set(2600, 0.7); bp[c].set(7000 + c * 600, 0.9); }
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const e = t < n.d ? Math.pow(t / n.d, 2.4) : Math.exp(-(t - n.d) / 0.45);
    for (let c = 0; c < 2; c++) {
      const x = nz[c]() * 2 - 1;
      (c === 0 ? out.L : out.R)[s] = (hp[c].high(x) * 0.5 + bp[c].band(x) * 0.6) * e;
    }
  }
  const g = level * n.v * 0.3;
  for (let s = 0; s < N; s++) { out.L[s] *= g; out.R[s] *= g; }
  return out;
}

/** the low drone: root, octave and a soft fifth, a slowly breathing lowpass */
function drone(n: Note, r: () => number, level: number): Stereo {
  const f = hz(n.midi), rel = 3, N = Math.ceil((n.d + rel) * SR);
  const out = stereo(N);
  const parts = [[1, 1, -0.3], [2.0023, 0.55, 0.3], [1.4983, 0.3, 0], [0.9978, 0.7, 0.4]];
  const ph = parts.map(() => r());
  const fl = new Svf(), fr = new Svf();
  const lr = 0.07 + r() * 0.05;
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const e = env(t, n.d, 2.2, rel);
    if ((s & 63) === 0) { const fc = 380 + 220 * (0.5 + 0.5 * Math.sin(TAU * lr * t)); fl.set(fc, 0.9); fr.set(fc * 1.1, 0.9); }
    let l = 0, rr = 0;
    for (let i = 0; i < parts.length; i++) {
      const dt = f * parts[i][0] / SR;
      let p = ph[i] + dt; if (p >= 1) p -= 1; ph[i] = p;
      const v = (2 * p - 1 - polyblep(p, dt)) * parts[i][1];
      const [gl, gr] = panGains(parts[i][2]);
      l += v * gl; rr += v * gr;
    }
    out.L[s] = fl.low(l) * e; out.R[s] = fr.low(rr) * e;
  }
  const g = level * n.v * 0.3;
  for (let s = 0; s < N; s++) { out.L[s] *= g; out.R[s] *= g; }
  return out;
}

/** low strings / contrabass: a dark bowed saw */
function bass(n: Note, r: () => number, level: number): Stereo {
  const f = hz(n.midi), rel = 0.5, N = Math.ceil((n.d + rel) * SR);
  const out = monoOut(N);
  const lp = new Svf(); lp.set(Math.min(1400, 260 + f * 2.2), 0.8);
  let p1 = r(), p2 = r();
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const e = env(t, n.d, 0.14, rel);
    const d1 = f / SR, d2 = f * 1.0026 / SR;
    p1 += d1; if (p1 >= 1) p1 -= 1;
    p2 += d2; if (p2 >= 1) p2 -= 1;
    out.L[s] = lp.low((2 * p1 - 1 - polyblep(p1, d1)) + (2 * p2 - 1 - polyblep(p2, d2))) * e;
  }
  const g = level * n.v * 0.4;
  for (let s = 0; s < N; s++) out.L[s] *= g;
  return out;
}

/** a warm pad (orbit, space age): detuned saws and a sine sub, slow lowpass breathing */
function pad(n: Note, r: () => number, level: number, organ: boolean): Stereo {
  const f = hz(n.midi), rel = organ ? 0.35 : 2.4, N = Math.ceil((n.d + rel) * SR);
  const out = stereo(N);
  const fl = new Svf(), fr = new Svf();
  const det = [0.9952, 1.0047, 0.9987, 1.0013];
  const ph = det.map(() => r());
  let sub = r();
  const lr = 0.09 + r() * 0.06, lp = r() * TAU;
  for (let s = 0; s < N; s++) {
    const t = s / SR;
    const e = env(t, n.d, organ ? 0.06 : 1.4, rel);
    if ((s & 63) === 0) { const fc = organ ? Math.min(4800, f * 5) : 700 + 500 * (0.5 + 0.5 * Math.sin(TAU * lr * t + lp)); fl.set(fc, organ ? 0.7 : 0.8); fr.set(fc * 1.08, organ ? 0.7 : 0.8); }
    let l = 0, rr = 0;
    if (organ) {
      // a flue organ: octave-related sines (8', 4', 2 2/3') — no beating, pure ranks
      sub += f / SR; if (sub >= 1) sub -= 1;
      const x = Math.sin(sub * TAU) + 0.5 * Math.sin(sub * 2 * TAU) + 0.25 * Math.sin(sub * 3 * TAU) + 0.18 * Math.sin(sub * 4 * TAU);
      l = x; rr = x;
    } else {
      for (let i = 0; i < 4; i++) {
        const dt = f * det[i] / SR;
        let p = ph[i] + dt; if (p >= 1) p -= 1; ph[i] = p;
        const v = 2 * p - 1 - polyblep(p, dt);
        if (i & 1) rr += v; else l += v;
      }
      sub += f * 0.5 / SR; if (sub >= 1) sub -= 1;
      const sv = Math.sin(sub * TAU) * 0.6;
      l += sv; rr += sv;
    }
    out.L[s] = fl.low(l) * e; out.R[s] = fr.low(rr) * e;
  }
  const g = level * n.v * (organ ? 0.18 : 0.16);
  for (let s = 0; s < N; s++) { out.L[s] *= g; out.R[s] *= g; }
  return out;
}

/** render one note of an instrument (stereo, starting at the note's onset) */
export function voice(inst: Inst, n: Note, r: () => number): Stereo {
  switch (inst) {
    case 'strings': return bowed(n, r, 0.45, 0.9, 0.55, 11, 6, 0.55);
    case 'violins': return bowed(n, r, 0.14, 0.5, 0.8, 8, 4, 0.6);
    case 'cellos': return bowed(n, r, 0.2, 0.6, 0.45, 7, 4, 0.7);
    case 'choir': return choir(n, r, [730, 1150, 2500], 0.55);
    case 'oohs': return choir(n, r, [320, 800, 2300], 0.7);
    case 'horn': return horn(n, r, 0.55);
    case 'flute': return flute(n, r, false, 0.6);
    case 'boneflute': return flute(n, r, true, 0.6);
    case 'reed': return reed(n, r, 0.55);
    case 'harp': return pluck(n, r, false, 0.6);
    case 'lyre': return pluck(n, r, true, 0.6);
    case 'celesta': return struck(n, r, 'celesta', 0.6);
    case 'glass': return struck(n, r, 'glass', 0.5);
    case 'bell': return struck(n, r, 'bell', 0.5);
    case 'drone': return drone(n, r, 0.5);
    case 'bass': return bass(n, r, 0.6);
    case 'pad': return pad(n, r, 0.6, false);
    case 'organ': return pad(n, r, 0.6, true);
    case 'timpani': return drum(n, 'timpani', 0.7);
    case 'framedrum': return drum(n, 'framedrum', 0.7);
    case 'lowdrum': return drum(n, 'lowdrum', 0.8);
    case 'shaker': return shaker(n, 0.5);
    case 'swell': return swell(n, 0.6);
  }
}

// ───────────────────────────── the room ─────────────────────────────

export interface RoomOpts {
  /** seconds to -60 dB */
  rt60: number;
  /** 0..1: how much faster the highs die */
  damp: number;
  /** pre-delay, seconds */
  pre: number;
  /** delay-line scale (1 = a hall, 0.6 = a room, 1.4 = a cathedral) */
  size: number;
}

/** an 8-line feedback delay network with input diffusion; adds the reverberated `inp` into `out` */
export function reverb(inp: Stereo, out: Stereo, o: RoomOpts, gain: number): void {
  const base = [1559, 1877, 2251, 2633, 3011, 3373, 3727, 4091];
  const lens = base.map((x) => Math.max(64, Math.round(x * o.size)));
  const lines = lens.map((l) => new Float32Array(l));
  const idx = new Int32Array(8);
  const g = lens.map((l) => Math.pow(10, -3 * l / (o.rt60 * SR)));
  const lp = new Float64Array(8);
  const d = Math.max(0, Math.min(0.9, o.damp));
  const apLen = [142, 107, 379, 277].map((x) => Math.round(x * 1.6));
  const ap = [apLen.map((l) => new Float32Array(l)), apLen.map((l) => new Float32Array(l + 17))];
  const apI = [new Int32Array(4), new Int32Array(4)];
  const preN = Math.max(1, Math.round(o.pre * SR));
  const pre = [new Float32Array(preN), new Float32Array(preN)];
  let pi = 0;
  const n = inp.L.length;
  const diffuse = (c: number, x: number): number => {
    const bufs = ap[c], ii = apI[c];
    for (let k = 0; k < 4; k++) {
      const b = bufs[k], i = ii[k];
      const z = b[i];
      const y = -0.62 * x + z;
      b[i] = x + 0.62 * y;
      ii[k] = (i + 1) % b.length;
      x = y;
    }
    return x;
  };
  for (let s = 0; s < n; s++) {
    const xl = pre[0][pi], xr = pre[1][pi];
    pre[0][pi] = inp.L[s]; pre[1][pi] = inp.R[s];
    pi = (pi + 1) % preN;
    const dl = diffuse(0, xl), dr = diffuse(1, xr);
    let sum = 0;
    const o8 = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 8; k++) {
      const v = lines[k][idx[k]];
      lp[k] = v * (1 - d) + lp[k] * d;
      const y = lp[k] * g[k];
      o8[k] = y; sum += y;
    }
    sum *= 0.25;
    for (let k = 0; k < 8; k++) {
      lines[k][idx[k]] = o8[k] - sum + ((k & 1) ? dr : dl) * 0.5;
      idx[k] = (idx[k] + 1) % lens[k];
    }
    out.L[s] += (o8[0] - o8[2] + o8[4] - o8[6]) * gain;
    out.R[s] += (o8[1] - o8[3] + o8[5] - o8[7]) * gain;
  }
}

// ───────────────────────────── pieces ─────────────────────────────

export interface Part {
  inst: Inst;
  notes: Note[];
  /** linear gain of the part */
  gain: number;
  /** reverb send (0..1) */
  send: number;
  /** -1..1 seat in the orchestra (a note's own pan adds to it) */
  pan: number;
}

/**
 * Render parts into exactly `loopSec` seconds. A note or reverb tail running past the end is folded back onto the
 * start, which is what the next pass of a loop hears: the rendered buffer loops without a seam.
 */
export function renderLoop(parts: Part[], loopSec: number, room: RoomOpts, wet: number, seed: number, fold = true): Stereo {
  const tail = Math.ceil(Math.max(6, room.rt60 * 1.3) * SR);
  const L = Math.round(loopSec * SR);
  const total = L + tail;
  const dry = stereo(total), send = stereo(total);
  const r = rng(seed);
  for (const part of parts) {
    for (const n of part.notes) {
      const v = voice(part.inst, n, r);
      const [gl, gr] = panGains(part.pan + (n.pan ?? 0));
      const s0 = Math.round(n.t * SR);
      const len = Math.min(v.L.length, total - s0);
      const a = part.gain, b = part.gain * part.send;
      for (let i = 0; i < len; i++) {
        const l = v.L[i] * gl, rr = v.R[i] * gr;
        const j = s0 + i;
        dry.L[j] += l * a; dry.R[j] += rr * a;
        send.L[j] += l * b; send.R[j] += rr * b;
      }
    }
  }
  reverb(send, dry, room, wet);
  const out = stereo(L);
  out.L.set(dry.L.subarray(0, L)); out.R.set(dry.R.subarray(0, L));
  if (fold) {
    for (let i = 0; i < tail; i++) { out.L[i % L] += dry.L[L + i]; out.R[i % L] += dry.R[L + i]; }
  } else {
    // a one-shot (a stinger): keep the tail
    const o2 = stereo(total);
    o2.L.set(dry.L); o2.R.set(dry.R);
    return o2;
  }
  return out;
}

export function mix(into: Stereo, add: Stereo, g = 1): void {
  const n = Math.min(into.L.length, add.L.length);
  for (let i = 0; i < n; i++) { into.L[i] += add.L[i] * g; into.R[i] += add.R[i] * g; }
}

// ───────────────────────────── mastering and analysis ─────────────────────────────

class Biquad {
  x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  b0: number; b1: number; b2: number; a1: number; a2: number;
  constructor(b: number[], a: number[]) { this.b0 = b[0]; this.b1 = b[1]; this.b2 = b[2]; this.a1 = a[1]; this.a2 = a[2]; }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** BS.1770-4 mean squares of 400 ms blocks every 100 ms (K-weighted, 48 kHz coefficients) */
function kBlocks(st: Stereo): number[] {
  const ch = [st.L, st.R];
  const n = st.L.length, B = Math.round(0.4 * SR), H = Math.round(0.1 * SR);
  const sq = [new Float64Array(n), new Float64Array(n)];
  for (let c = 0; c < 2; c++) {
    const s1 = new Biquad([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
    const s2 = new Biquad([1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
    const x = ch[c], q = sq[c];
    for (let i = 0; i < n; i++) { const y = s2.run(s1.run(x[i])); q[i] = y * y; }
  }
  const blocks: number[] = [];
  for (let s = 0; s + B <= n; s += H) {
    let z = 0;
    for (let c = 0; c < 2; c++) { let a = 0; const q = sq[c]; for (let i = s; i < s + B; i++) a += q[i]; z += a / B; }
    blocks.push(z);
  }
  return blocks;
}

const toL = (z: number): number => -0.691 + 10 * Math.log10(Math.max(z, 1e-20));

/** integrated loudness, LUFS (absolute gate -70, relative gate -10 LU) */
export function lufs(st: Stereo): number {
  const b = kBlocks(st).filter((z) => toL(z) > -70);
  if (!b.length) return -70;
  const rel = toL(b.reduce((a, z) => a + z, 0) / b.length) - 10;
  const g = b.filter((z) => toL(z) > rel);
  return toL(g.reduce((a, z) => a + z, 0) / Math.max(1, g.length));
}

/** short-term (3 s) loudness every `hop` seconds: the piece's dynamic shape */
export function loudnessProfile(st: Stereo, hop: number): number[] {
  const b = kBlocks(st);
  const per = Math.round(hop / 0.1), win = 27;
  const out: number[] = [];
  for (let i = 0; i + win <= b.length; i += per) {
    let z = 0; for (let k = i; k < i + win; k++) z += b[k];
    out.push(Math.round(toL(z / win) * 10) / 10);
  }
  return out;
}

export function peakDb(st: Stereo): number {
  let p = 0;
  for (const x of [st.L, st.R]) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
  return 20 * Math.log10(Math.max(p, 1e-12));
}

/** a 4x-oversampled (windowed-sinc) peak estimate, dBTP */
export function truePeakDb(st: Stereo): number {
  const T = 12, P = 4;
  const h: number[][] = [];
  for (let ph = 1; ph < P; ph++) {
    const row: number[] = [];
    for (let k = -T; k < T; k++) {
      const x = k + ph / P;
      const w = 0.5 + 0.5 * Math.cos(Math.PI * x / T);
      row.push((Math.sin(Math.PI * x) / (Math.PI * x)) * w);
    }
    h.push(row);
  }
  let p = 0;
  for (const x of [st.L, st.R]) {
    const n = x.length;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(x[i]); if (a > p) p = a;
      if (a < p * 0.5) continue;
      for (const row of h) {
        let y = 0;
        for (let k = -T; k < T; k++) { const j = i - k; if (j >= 0 && j < n) y += x[j] * row[k + T]; }
        if (Math.abs(y) > p) p = Math.abs(y);
      }
    }
  }
  return 20 * Math.log10(Math.max(p, 1e-12));
}

export function gainDb(st: Stereo, db: number): void {
  const g = Math.pow(10, db / 20);
  for (const x of [st.L, st.R]) for (let i = 0; i < x.length; i++) x[i] *= g;
}

/**
 * A lookahead peak limiter (stereo-linked): the gain never exceeds what the loudest sample in the next `look` seconds
 * allows, ramps down over the lookahead (no clicks) and recovers with `release`. Returns the deepest reduction (dB).
 */
export function limit(st: Stereo, ceilingDb: number, look = 0.004, release = 0.15, circular = true): number {
  const n = st.L.length, c = Math.pow(10, ceilingDb / 20), la = Math.max(1, Math.round(look * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(st.L[i]), Math.abs(st.R[i])); need[i] = a > c ? c / a : 1; }
  const at = (i: number): number => (circular ? need[(i % n + n) % n] : i < n ? need[i] : 1);
  // lookahead minimum (monotone deque), then a moving average over the same window
  const h = new Float32Array(n);
  const dq: number[] = []; let head = 0;
  for (let i = 0; i < n + la; i++) {
    const v = at(i);
    while (dq.length > head && at(dq[dq.length - 1]) >= v) dq.pop();
    dq.push(i);
    const s = i - la;
    if (s >= 0) { while (dq[head] < s) head++; h[s] = at(dq[head]); }
  }
  const out = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += h[i]; if (i >= la) acc -= h[i - la];
    out[i] = Math.min(h[i], acc / Math.min(i + 1, la));
  }
  const rc = 1 - Math.exp(-1 / (release * SR));
  let g = 1, deepest = 1;
  for (let i = 0; i < n; i++) {
    const t = out[i];
    g = t < g ? t : g + (t - g) * rc;
    if (g > t) g = t;
    if (g < deepest) deepest = g;
    st.L[i] *= g; st.R[i] *= g;
  }
  return 20 * Math.log10(deepest);
}

export interface EqBand { type: 'peak' | 'high' | 'low'; f: number; g: number; q?: number }

/** RBJ peaking / shelving filters in series, primed with the loop's end so a looped buffer has no seam */
export function eq(st: Stereo, spec: EqBand[], circular = true): void {
  for (const b of spec) {
    const A = Math.pow(10, b.g / 40), w0 = TAU * b.f / SR, cw = Math.cos(w0), sw = Math.sin(w0);
    let c: number[];
    if (b.type === 'peak') {
      const al = sw / (2 * (b.q ?? 0.7));
      c = [1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A];
    } else {
      const al = sw / 2 * Math.SQRT2, sa = 2 * Math.sqrt(A) * al;
      c = b.type === 'high'
        ? [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sa), (A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sa]
        : [A * ((A + 1) - (A - 1) * cw + sa), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sa), (A + 1) + (A - 1) * cw + sa, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sa];
    }
    const a0 = c[3];
    for (const x of [st.L, st.R]) {
      const bq = new Biquad([c[0] / a0, c[1] / a0, c[2] / a0], [1, c[4] / a0, c[5] / a0]);
      if (circular) for (let i = Math.max(0, x.length - 9600); i < x.length; i++) bq.run(x[i]);
      for (let i = 0; i < x.length; i++) x[i] = bq.run(x[i]);
    }
  }
}

/** the house master EQ: a little out of the low mids, air on top */
export const HOUSE_EQ: EqBand[] = [{ type: 'peak', f: 280, g: -2, q: 0.8 }, { type: 'high', f: 4500, g: 3.5 }];

/** octave-band balance (dB relative to the loudest band) of the mono sum */
export function bands(st: Stereo): { hz: number; db: number }[] {
  const centres = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const n = st.L.length;
  const res = centres.map((f) => {
    const b = new Svf(); b.set(f, 1.41);
    let e = 0;
    for (let i = 0; i < n; i++) { const y = b.band((st.L[i] + st.R[i]) * 0.5); e += y * y; }
    return { hz: f, e };
  });
  const top = Math.max(...res.map((x) => x.e), 1e-20);
  return res.map((x) => ({ hz: x.hz, db: Math.round(10 * Math.log10(Math.max(x.e, 1e-20) / top) * 10) / 10 }));
}

/** interleave for ffmpeg (f32le) */
export function interleave(st: Stereo): Float32Array {
  const n = st.L.length, o = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { o[2 * i] = st.L[i]; o[2 * i + 1] = st.R[i]; }
  return o;
}
