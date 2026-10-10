// GENESIS — audio DSP in plain JS (CONTRACT §17: synthesized, no sample files). Every texture the engine plays that is
// cheaper to render once than to build from live nodes (a chorus of crickets, a crowd's murmur, rain on leaves, a
// church bell's partials, a plucked lyre string, a room's reverb) is computed here as sample arrays, deterministically
// from a seed, and handed to WebAudio as looping AudioBuffers by `bank.ts`.
//
// Nothing here touches WebAudio or the DOM, so it runs (and is tested) in Node. Loops are seamless by construction:
// event textures (pops, chirps, drops) write their events modulo the loop length, and stateful filtered textures
// render a tail past the loop point and fold it back with an equal-power crossfade.

export type Channels = Float32Array[];

// ───────────────────────────── hashing / random ─────────────────────────────

function fmix(h: number): number {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** stateless 32-bit hash of up to four integers (the music composer's dice) */
export function hash32(a: number, b = 0, c = 0, d = 0): number {
  let h = fmix((a | 0) ^ 0x9e3779b9);
  h = fmix(h ^ Math.imul(b | 0, 0x85ebca6b) ^ 0x27d4eb2f);
  h = fmix(h ^ Math.imul(c | 0, 0xc2b2ae35) ^ 0x165667b1);
  h = fmix(h ^ Math.imul(d | 0, 0x27d4eb2f) ^ 0x9e3779b9);
  return h;
}

/** hash32 → [0, 1) */
export function hashUnit(a: number, b = 0, c = 0, d = 0): number {
  return hash32(a, b, c, d) / 4294967296;
}

/** mulberry32: a small, fast, seedable PRNG (sequences for one render) */
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

// ───────────────────────────── filters ─────────────────────────────

export type BiquadKind = 'lowpass' | 'highpass' | 'bandpass' | 'peak' | 'notch';

/** RBJ cookbook biquad (direct form I); `bandpass` has 0 dB peak gain */
export class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
  x1 = 0; x2 = 0; y1 = 0; y2 = 0;

  set(kind: BiquadKind, freq: number, q: number, sr: number, gainDb = 0): this {
    const f = Math.min(freq, sr * 0.49);
    const w = (2 * Math.PI * f) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(1e-4, q));
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (kind) {
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      default: {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }

  reset(): void { this.x1 = this.x2 = this.y1 = this.y2 = 0; }
}

/** one-pole lowpass coefficient for a cutoff (Hz) */
export function onePole(freq: number, sr: number): number {
  return 1 - Math.exp((-2 * Math.PI * freq) / sr);
}

// ───────────────────────────── buffers ─────────────────────────────

/**
 * Seamless loop from a render that ran `f` samples past the loop length `n`: the overrun is crossfaded (equal power,
 * right for uncorrelated noise) into the head, so the sample after the last is the sample the render produced next.
 */
export function foldLoop(src: Float32Array, n: number): Float32Array {
  const f = src.length - n;
  const out = src.slice(0, n);
  for (let i = 0; i < f; i++) {
    const t = (i + 0.5) / f;
    out[i] = src[i] * Math.sqrt(t) + src[n + i] * Math.sqrt(1 - t);
  }
  return out;
}

export function peakOf(chs: Channels): number {
  let p = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; }
  return p;
}

export function rmsOf(chs: Channels): number {
  let s = 0, n = 0;
  for (const c of chs) { for (let i = 0; i < c.length; i++) s += c[i] * c[i]; n += c.length; }
  return n ? Math.sqrt(s / n) : 0;
}

/** scale all channels so the loudest sample is `peak` (silence stays silence) */
export function normalizePeak(chs: Channels, peak = 0.9): Channels {
  const p = peakOf(chs);
  if (p > 1e-9) { const k = peak / p; for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k; }
  return chs;
}

/** scale to an RMS level, then cap the peak (keeps loops of different character at known loudness) */
export function normalizeRms(chs: Channels, rms: number, maxPeak = 0.98): Channels {
  const r = rmsOf(chs);
  if (r > 1e-9) { const k = rms / r; for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k; }
  if (peakOf(chs) > maxPeak) normalizePeak(chs, maxPeak);
  return chs;
}

function removeDc(c: Float32Array): void {
  let m = 0;
  for (let i = 0; i < c.length; i++) m += c[i];
  m /= c.length || 1;
  for (let i = 0; i < c.length; i++) c[i] -= m;
}

/** add `v` at sample index `i` modulo the loop (event textures wrap around the loop point) */
function addWrap(c: Float32Array, i: number, v: number): void {
  const n = c.length;
  c[((i % n) + n) % n] += v;
}

// ───────────────────────────── noise ─────────────────────────────

export type NoiseColor = 'white' | 'pink' | 'brown';

/** a seamless mono noise loop at RMS ≈ 0.25 */
export function renderNoise(color: NoiseColor, sr: number, seconds: number, seed: number): Float32Array {
  const n = Math.max(64, Math.floor(sr * seconds));
  const f = Math.floor(sr * 0.05);
  const raw = new Float32Array(n + f);
  const r = rng(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n + f; i++) {
    const w = r() * 2 - 1;
    if (color === 'white') raw[i] = w;
    else if (color === 'pink') {
      // Paul Kellet's refined pink filter: -3 dB/octave within 0.05 dB above 9 Hz
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      // leaky integrator: -6 dB/octave with the DC pulled out
      last = (last + 0.02 * w) / 1.02;
      raw[i] = last * 3.5;
    }
  }
  const out = foldLoop(raw, n);
  removeDc(out);
  normalizeRms([out], 0.25);
  return out;
}

// ───────────────────────────── plucked string (Karplus–Strong) ─────────────────────────────

export interface PluckOptions {
  /** 0..1: brightness of the excitation (a soft thumb vs a plectrum) */
  bright?: number;
  /** seconds to fall 60 dB */
  decay?: number;
  /** pluck position as a fraction of the string (comb notch in the spectrum) */
  pick?: number;
  /** body resonance (Hz, 0 = none): the sound box of a lyre */
  body?: number;
}

/**
 * Karplus–Strong string with an allpass fine-tuning stage (so the pitch is exact, not quantised to whole-sample
 * delays) and a per-period loss set from the wanted T60. Rendered once per pitch region and resampled by playbackRate.
 */
export function renderPluck(freq: number, sr: number, seconds: number, seed: number, o: PluckOptions = {}): Float32Array {
  const n = Math.max(1, Math.floor(seconds * sr));
  const out = new Float32Array(n);
  const period = sr / freq;
  // loop delay = D (the line) + 0.5 (the two-point average) + frac (the allpass, ≈ (1 − C) / (1 + C) at low
  // frequencies); D leaves frac in [0.1, 1.1) so C stays well inside the unit circle
  const D = Math.max(2, Math.floor(period - 0.6));
  const frac = period - D - 0.5;
  const C = (1 - frac) / (1 + frac);
  const line = new Float32Array(D);
  const r = rng(seed);
  const a = 0.12 + 0.85 * (o.bright ?? 0.6);
  let lp = 0;
  for (let i = 0; i < D; i++) { lp += a * (r() * 2 - 1 - lp); line[i] = lp; }
  const pick = Math.floor(D * (o.pick ?? 0.13));
  if (pick > 0) {
    const tmp = line.slice();
    for (let i = 0; i < D; i++) line[i] = tmp[i] - tmp[(i - pick + D) % D];
  }
  removeDc(line);
  const t60 = o.decay ?? 2.5;
  const rho = Math.pow(10, -3 / (freq * t60));
  let idx = 0, prev = 0, apX = 0, apY = 0;
  for (let i = 0; i < n; i++) {
    const x = line[idx];
    const avg = 0.5 * (x + prev);
    prev = x;
    const y = C * avg + apX - C * apY;
    apX = avg; apY = y;
    line[idx] = y * rho;
    out[i] = x;
    idx = idx + 1 === D ? 0 : idx + 1;
  }
  if (o.body) {
    const bq = new Biquad().set('peak', o.body, 1.4, sr, 6);
    for (let i = 0; i < n; i++) out[i] = bq.run(out[i]);
  }
  // release the last 30 ms so a resampled voice never ends on a step
  const rel = Math.min(n, Math.floor(sr * 0.03));
  for (let i = 0; i < rel; i++) out[n - 1 - i] *= i / rel;
  normalizePeak([out], 0.9);
  return out;
}

// ───────────────────────────── struck bars and bells (additive) ─────────────────────────────

/** [frequency ratio, amplitude, T60 seconds] */
export type Partial = [number, number, number];

/** a large bronze bell: hum, prime, tierce (minor third), quint, nominal and the upper partials */
export const BELL_CHURCH: Partial[] = [
  [0.5, 0.55, 7], [1, 1, 5], [1.183, 0.5, 4], [1.506, 0.35, 3], [2, 0.45, 2.6], [2.514, 0.25, 2],
  [2.662, 0.2, 1.8], [3.011, 0.18, 1.5], [4.166, 0.12, 1], [5.433, 0.08, 0.7],
];
/** a small tubular chime (free bar modes) */
export const CHIME: Partial[] = [[1, 1, 2.4], [2.756, 0.5, 1.5], [5.404, 0.28, 0.8], [8.933, 0.12, 0.45]];
/** a soft glassy bell for the orbital score */
export const GLASS: Partial[] = [[1, 1, 3.2], [2.0, 0.22, 2.1], [3.0, 0.12, 1.3], [4.07, 0.08, 0.8], [5.43, 0.04, 0.5]];
/** an anvil struck by a hammer */
export const ANVIL: Partial[] = [[1, 1, 0.9], [2.41, 0.6, 0.6], [3.87, 0.45, 0.45], [5.13, 0.3, 0.3], [6.92, 0.2, 0.2]];
/** a wooden slit drum / log */
export const WOOD: Partial[] = [[1, 1, 0.22], [2.57, 0.35, 0.12], [4.1, 0.15, 0.07]];

/**
 * Additive struck body: each partial is a decaying sine (computed by complex rotation, not Math.sin per sample), the
 * lowest two with a slightly detuned twin so they beat like a real bell; a short band-limited noise strike on top.
 */
export function renderBell(f0: number, sr: number, seconds: number, partials: Partial[], seed: number, strike = 0.3): Float32Array {
  const n = Math.max(1, Math.floor(seconds * sr));
  const out = new Float32Array(n);
  const r = rng(seed);
  const addPartial = (freq: number, amp: number, t60: number): void => {
    if (freq >= sr * 0.45) return;
    const w = (2 * Math.PI * freq) / sr;
    const c = Math.cos(w), s = Math.sin(w);
    const dec = Math.exp(-6.907755 / (t60 * sr));
    let x = 0, y = amp, g = 1;
    const ph = r() * Math.PI * 2;
    x = Math.cos(ph) * amp; y = Math.sin(ph) * amp;
    for (let i = 0; i < n; i++) {
      out[i] += y * g;
      const nx = x * c - y * s;
      y = x * s + y * c;
      x = nx;
      g *= dec;
      if (g < 1e-5) break;
    }
  };
  partials.forEach(([ratio, amp, t60], k) => {
    addPartial(f0 * ratio, amp, t60);
    if (k < 2) addPartial(f0 * ratio * (1 + 0.0016 + r() * 0.0012), amp * 0.45, t60 * 0.9);
  });
  if (strike > 0) {
    const bq = new Biquad().set('bandpass', Math.min(sr * 0.4, f0 * 4), 1.2, sr);
    const len = Math.min(n, Math.floor(sr * 0.012));
    for (let i = 0; i < len; i++) out[i] += bq.run((r() * 2 - 1) * Math.exp(-i / (sr * 0.002))) * strike;
  }
  // soft attack (2 ms) so the sum of in-phase partials does not click
  const att = Math.min(n, Math.floor(sr * 0.002));
  for (let i = 0; i < att; i++) out[i] *= i / att;
  normalizePeak([out], 0.9);
  return out;
}

// ───────────────────────────── night and day choruses ─────────────────────────────

/**
 * Field crickets: each one chirps a few 4–5 kHz pulses every half second or so, its own pitch, rate and place in the
 * stereo field; a few faint far ones fill in behind. Events wrap around the loop.
 */
export function renderCrickets(sr: number, seconds: number, seed: number, count = 10): Channels {
  const n = Math.floor(sr * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(seed);
  for (let k = 0; k < count + 8; k++) {
    const far = k >= count;
    const f = 3900 + r() * 1100;
    const period = 0.32 + r() * 0.55;
    const pulses = 2 + Math.floor(r() * 3);
    const plen = 0.011 + r() * 0.009;
    const gap = plen * (0.7 + r() * 0.7);
    const amp = (far ? 0.12 : 0.3 + 0.7 * r() * r());
    const pan = r();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    // some sing all the time, some stop for a while
    const duty = 0.55 + r() * 0.45;
    for (let t = r() * period; t < seconds; t += period * (0.96 + 0.08 * r())) {
      if (r() > duty) continue;
      for (let p = 0; p < pulses; p++) {
        const on = Math.floor((t + p * (plen + gap)) * sr);
        const len = Math.floor(plen * sr);
        const ph = r() * 6.28;
        for (let i = 0; i < len; i++) {
          const x = i / len;
          const env = Math.sin(Math.PI * x) ** 2;
          const v = Math.sin(ph + (2 * Math.PI * f * (1 - 0.015 * x) * i) / sr) * env * amp;
          addWrap(L, on + i, v * gl);
          addWrap(R, on + i, v * gr);
        }
      }
    }
  }
  return normalizePeak([L, R], 0.8);
}

/**
 * Cicadas: a buzz of 90–140 resonant clicks per second (tymbal pulses ringing at 4–7 kHz) that swells, holds and
 * dies away over several seconds — the sound of heat.
 */
export function renderCicadas(sr: number, seconds: number, seed: number, count = 4): Channels {
  const n = Math.floor(sr * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(seed);
  for (let k = 0; k < count; k++) {
    const fc = 4200 + r() * 2600;
    const rate = 90 + r() * 50;
    const songLen = 2.5 + r() * 3.5;
    const start = r() * seconds;
    const pan = r();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const amp = 0.4 + 0.6 * r();
    const w = (2 * Math.PI * fc) / sr;
    const dec = Math.exp(-1 / (0.0012 * sr));
    const plen = Math.floor(0.007 * sr);
    for (let t = 0; t < songLen; t += 1 / rate) {
      const x = t / songLen;
      // swell up, hold, fade (with a little flutter)
      const env = Math.min(1, x / 0.3) * Math.min(1, (1 - x) / 0.2) * (0.85 + 0.15 * Math.sin(t * 11));
      const on = Math.floor((start + t) * sr);
      let g = amp * env;
      const ph = r() * 6.28;
      for (let i = 0; i < plen; i++) {
        const v = Math.sin(ph + w * i) * g;
        g *= dec;
        addWrap(L, on + i, v * gl);
        addWrap(R, on + i, v * gr);
      }
    }
  }
  return normalizePeak([L, R], 0.8);
}

/** Frogs: pulsed croaks (glottal clicks through a throat resonance) and a few high whistling peepers. */
export function renderFrogs(sr: number, seconds: number, seed: number, count = 7): Channels {
  const n = Math.floor(sr * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(seed);
  for (let k = 0; k < count; k++) {
    const peeper = r() < 0.35;
    const pan = r();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const amp = 0.35 + 0.65 * r();
    const every = 0.7 + r() * 1.6;
    if (peeper) {
      const f0 = 2300 + r() * 900;
      for (let t = r() * every; t < seconds; t += every * (0.85 + 0.3 * r())) {
        const on = Math.floor(t * sr), len = Math.floor((0.06 + r() * 0.05) * sr);
        let ph = 0;
        for (let i = 0; i < len; i++) {
          const x = i / len;
          ph += (2 * Math.PI * f0 * (1 + 0.18 * x)) / sr;
          const v = Math.sin(ph) * Math.sin(Math.PI * x) * amp * 0.5;
          addWrap(L, on + i, v * gl); addWrap(R, on + i, v * gr);
        }
      }
    } else {
      const res = 280 + r() * 600;
      const pulseRate = 22 + r() * 40;
      const w = (2 * Math.PI * res) / sr;
      const dec = Math.exp(-1 / (0.009 * sr));
      const plen = Math.floor(0.04 * sr);
      for (let t = r() * every; t < seconds; t += every * (0.8 + 0.4 * r())) {
        const pulses = 4 + Math.floor(r() * 8);
        for (let p = 0; p < pulses; p++) {
          const on = Math.floor((t + p / pulseRate) * sr);
          const env = Math.sin(Math.PI * (p + 0.5) / pulses);
          let g = amp * env;
          for (let i = 0; i < plen; i++) {
            const v = (Math.sin(w * i) + 0.35 * Math.sin(2 * w * i)) * g;
            g *= dec;
            addWrap(L, on + i, v * gl); addWrap(R, on + i, v * gr);
          }
        }
      }
    }
  }
  return normalizePeak([L, R], 0.8);
}

// ───────────────────────────── fire, water, earth ─────────────────────────────

/** Fire: resin pops and wood cracks (noise bursts ringing through random resonances) over a flickering hiss. */
export function renderCrackle(sr: number, seconds: number, seed: number): Channels {
  const n = Math.floor(sr * seconds);
  const f = Math.floor(sr * 0.05);
  const r = rng(seed);
  const L = new Float32Array(n), R = new Float32Array(n);
  // hiss bed with a flickering envelope (rendered past the loop and folded)
  const hissL = new Float32Array(n + f), hissR = new Float32Array(n + f);
  const hp1 = new Biquad().set('highpass', 2200, 0.7, sr), hp2 = new Biquad().set('highpass', 2200, 0.7, sr);
  let flick = 0.5, target = 0.5;
  for (let i = 0; i < n + f; i++) {
    if (i % 512 === 0) target = 0.25 + r() * 0.75;
    flick += (target - flick) * 0.002;
    hissL[i] = hp1.run(r() * 2 - 1) * 0.05 * flick;
    hissR[i] = hp2.run(r() * 2 - 1) * 0.05 * flick;
  }
  L.set(foldLoop(hissL, n)); R.set(foldLoop(hissR, n));
  const bq = new Biquad();
  const pop = (big: boolean): void => {
    const on = Math.floor(r() * n);
    const len = Math.floor((big ? 0.012 + r() * 0.02 : 0.001 + r() * 0.005) * sr);
    const fc = big ? 400 + r() * 1400 : 900 + r() * 4500;
    bq.set('bandpass', fc, big ? 1.5 + r() * 3 : 2 + r() * 7, sr);
    bq.reset();
    const amp = (big ? 0.7 + r() * 0.6 : 0.15 + r() * r() * 0.8);
    const pan = r();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const ring = len + Math.floor(sr * 0.01);
    for (let i = 0; i < ring; i++) {
      const ex = i < len ? (r() * 2 - 1) * Math.exp(-i / (len * 0.35 + 1)) : 0;
      const v = bq.run(ex) * amp * 3;
      addWrap(L, on + i, v * gl);
      addWrap(R, on + i, v * gr);
    }
  };
  const pops = Math.floor(seconds * 22), bigs = Math.floor(seconds * 1.6);
  for (let i = 0; i < pops; i++) pop(false);
  for (let i = 0; i < bigs; i++) pop(true);
  return normalizePeak([L, R], 0.85);
}

/**
 * Raindrops on leaves and ground: hundreds of tiny damped resonances per second (soft ones common, loud ones rare).
 * `hail` makes fewer, louder, lower knocks that bounce once.
 */
export function renderPatter(sr: number, seconds: number, seed: number, hail = false): Channels {
  const n = Math.floor(sr * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(seed);
  const rate = hail ? 110 : 520;
  const drops = Math.floor(seconds * rate);
  for (let d = 0; d < drops; d++) {
    const on = Math.floor(r() * n);
    const fc = hail ? 700 + r() * 2600 : 1400 + r() * 5500;
    const t = hail ? 0.003 + r() * 0.006 : 0.0008 + r() * 0.0035;
    const amp = hail ? 0.4 + r() * 0.6 : 0.05 + Math.pow(r(), 3) * 0.95;
    const pan = r();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const hits = hail && r() < 0.6 ? 2 : 1;
    for (let h = 0; h < hits; h++) {
      const o = on + (h ? Math.floor((0.03 + r() * 0.06) * sr) : 0);
      const a = h ? amp * 0.35 : amp;
      const w = (2 * Math.PI * fc * (h ? 1.1 : 1)) / sr;
      const dec = Math.exp(-1 / (t * sr));
      const len = Math.floor(t * sr * 6);
      let g = a;
      for (let i = 0; i < len; i++) {
        const v = (Math.sin(w * i) + (i < 3 ? 0.6 : 0)) * g;
        g *= dec;
        addWrap(L, o + i, v * gl);
        addWrap(R, o + i, v * gr);
      }
    }
  }
  return normalizePeak([L, R], 0.85);
}

/** A stream over stones: rising Minnaert bubbles (a bubble's pitch climbs as it shrinks) over soft pink water noise. */
export function renderBabble(sr: number, seconds: number, seed: number): Channels {
  const n = Math.floor(sr * seconds);
  const f = Math.floor(sr * 0.05);
  const r = rng(seed);
  const bedL = new Float32Array(n + f), bedR = new Float32Array(n + f);
  const lp1 = new Biquad().set('bandpass', 700, 0.6, sr), lp2 = new Biquad().set('bandpass', 760, 0.6, sr);
  for (let i = 0; i < n + f; i++) { bedL[i] = lp1.run(r() * 2 - 1) * 0.08; bedR[i] = lp2.run(r() * 2 - 1) * 0.08; }
  const L = foldLoop(bedL, n), R = foldLoop(bedR, n);
  const count = Math.floor(seconds * 85);
  for (let b = 0; b < count; b++) {
    const on = Math.floor(r() * n);
    const f0 = 280 + Math.pow(r(), 1.6) * 1500;
    const tau = 0.004 + r() * 0.02;
    const rise = 0.6 + r() * 2.4;
    const amp = 0.08 + Math.pow(r(), 2) * 0.6;
    const pan = r();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const len = Math.floor(tau * sr * 5);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * f0 * (1 + rise * t / (tau * 5))) / sr;
      const v = Math.sin(ph) * Math.exp(-t / tau) * amp;
      addWrap(L, on + i, v * gl);
      addWrap(R, on + i, v * gr);
    }
  }
  return normalizePeak([L, R], 0.8);
}

/** Lava: slow thick blorps (low sine bubbles sinking in pitch) and pebble ticks over a deep churn. */
export function renderLava(sr: number, seconds: number, seed: number): Channels {
  const n = Math.floor(sr * seconds);
  const f = Math.floor(sr * 0.1);
  const r = rng(seed);
  const raw = new Float32Array(n + f);
  let last = 0;
  const lp = new Biquad().set('lowpass', 140, 0.8, sr);
  for (let i = 0; i < n + f; i++) { last = (last + 0.02 * (r() * 2 - 1)) / 1.02; raw[i] = lp.run(last * 3.5) * 0.6; }
  const L = foldLoop(raw, n), R = L.slice();
  const blorps = Math.floor(seconds * 1.4);
  for (let b = 0; b < blorps; b++) {
    const on = Math.floor(r() * n);
    const f0 = 55 + r() * 95;
    const dur = 0.18 + r() * 0.3;
    const amp = 0.4 + r() * 0.6;
    const pan = 0.2 + r() * 0.6;
    const len = Math.floor(dur * sr);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      ph += (2 * Math.PI * f0 * (1 - 0.35 * x)) / sr;
      const env = Math.min(1, x * 12) * Math.pow(1 - x, 1.5);
      const v = Math.sin(ph) * env * amp;
      addWrap(L, on + i, v * (1 - pan));
      addWrap(R, on + i, v * pan);
    }
    // a pebble of crust thrown up by the burst
    if (r() < 0.5) {
      const o = on + len, fc = 1500 + r() * 2500, w = (2 * Math.PI * fc) / sr;
      for (let i = 0; i < sr * 0.01; i++) { const v = Math.sin(w * i) * Math.exp(-i / (sr * 0.0015)) * 0.25; addWrap(L, o + i, v); addWrap(R, o + i, v); }
    }
  }
  return normalizePeak([L, R], 0.85);
}

// ───────────────────────────── people ─────────────────────────────

const VOWELS: [number, number][] = [[800, 1200], [500, 1900], [320, 2300], [520, 900], [340, 800], [650, 1650]];

/**
 * A crowd's murmur: voices speaking phrases of syllables (a glottal sawtooth through two moving formant resonances,
 * with fricative bursts), pitch falling along each phrase, pauses between. Unintelligible by design — a town heard
 * across a square, not words.
 */
export function renderMurmur(sr: number, seconds: number, seed: number, voices = 9): Channels {
  const n = Math.floor(sr * seconds);
  const f = Math.floor(sr * 0.08);
  const total = n + f;
  const L = new Float32Array(total), R = new Float32Array(total);
  const r = rng(seed);
  const f1 = new Biquad(), f2 = new Biquad(), fr = new Biquad();
  for (let v = 0; v < voices; v++) {
    const pan = r();
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const base = r() < 0.5 ? 95 + r() * 50 : 170 + r() * 70;
    const amp = 0.35 + r() * 0.65;
    f1.reset(); f2.reset();
    let t = r() * 1.2;
    let phase = 0;
    let F1 = 600, F2 = 1500;
    while (t < total / sr) {
      const syll = 3 + Math.floor(r() * 9);
      const rate = 3.6 + r() * 2.6;
      for (let s = 0; s < syll; s++) {
        const [tf1, tf2] = VOWELS[Math.floor(r() * VOWELS.length)];
        const sLen = (1 / rate) * (0.7 + r() * 0.6);
        const on = Math.floor(t * sr), len = Math.floor(sLen * sr);
        const decl = 1 - 0.15 * (s / syll);
        // fricative / plosive onset on some syllables
        if (r() < 0.45) {
          fr.set('highpass', 2500 + r() * 2500, 0.8, sr);
          fr.reset();
          const fl = Math.floor((0.02 + r() * 0.04) * sr);
          for (let i = 0; i < fl && on + i < total; i++) {
            const e = Math.sin(Math.PI * i / fl);
            const x = fr.run(r() * 2 - 1) * e * amp * 0.12;
            L[on + i] += x * gl; R[on + i] += x * gr;
          }
        }
        for (let i = 0; i < len && on + i < total; i++) {
          if (i % 32 === 0) {
            F1 += (tf1 - F1) * 0.35; F2 += (tf2 - F2) * 0.35;
            f1.set('bandpass', F1, 5, sr); f2.set('bandpass', F2, 8, sr);
          }
          const x = i / len;
          const env = Math.min(1, x * 10) * Math.min(1, (1 - x) * 6);
          const f0 = base * decl * (1 + 0.03 * Math.sin(t * 7 + i / sr * 30));
          phase += f0 / sr;
          if (phase >= 1) phase -= 1;
          const src = (phase * 2 - 1) * env;
          const y = (f1.run(src) * 1.0 + f2.run(src) * 0.55) * amp;
          L[on + i] += y * gl; R[on + i] += y * gr;
        }
        t += sLen;
      }
      t += 0.25 + r() * 1.4;
    }
  }
  const out = [foldLoop(L, n), foldLoop(R, n)];
  removeDc(out[0]); removeDc(out[1]);
  return normalizePeak(out, 0.85);
}

export type WorkKind = 'stone' | 'metal' | 'machine';

/**
 * What a working town sounds like under its talk: knapping and chopping (stone ages), hammer on anvil (metal ages),
 * rhythmic clatter, hiss and hum (machine ages).
 */
export function renderWork(kind: WorkKind, sr: number, seconds: number, seed: number): Channels {
  const n = Math.floor(sr * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(seed);
  const strike = (at: number, src: Float32Array, gain: number, pan: number): void => {
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    const on = Math.floor(at * sr);
    for (let i = 0; i < src.length; i++) { addWrap(L, on + i, src[i] * gain * gl); addWrap(R, on + i, src[i] * gain * gr); }
  };
  if (kind === 'stone') {
    const knap = [renderBell(2600, sr, 0.08, WOOD, seed + 1, 1.2), renderBell(3300, sr, 0.08, WOOD, seed + 2, 1.2)];
    const chop = renderBell(190, sr, 0.35, WOOD, seed + 3, 1.5);
    for (let k = 0; k < 3; k++) {
      const pan = r();
      for (let t = r() * 2; t < seconds; t += 1.4 + r() * 2.2) {
        const hits = 2 + Math.floor(r() * 4);
        for (let h = 0; h < hits; h++) strike(t + h * (0.22 + r() * 0.08), knap[Math.floor(r() * 2)], 0.25 + r() * 0.2, pan);
      }
    }
    const pan = r();
    for (let t = r(); t < seconds; t += 0.9 + r() * 0.5) strike(t, chop, 0.6 + r() * 0.3, pan);
  } else if (kind === 'metal') {
    const anvils = [renderBell(1150, sr, 0.7, ANVIL, seed + 4, 0.8), renderBell(1420, sr, 0.7, ANVIL, seed + 5, 0.8)];
    for (let smith = 0; smith < 2; smith++) {
      const pan = 0.2 + r() * 0.6;
      const a = anvils[smith];
      // a smith's rhythm: hit-hit-(bounce)-rest
      for (let t = r() * 1.5; t < seconds; t += 0.55 + r() * 0.15) {
        strike(t, a, 0.5, pan);
        if (r() < 0.6) strike(t + 0.11, a, 0.18, pan);
      }
    }
    const chop = renderBell(210, sr, 0.3, WOOD, seed + 6, 1.5);
    for (let t = r() * 3; t < seconds; t += 1.8 + r() * 2) strike(t, chop, 0.35, r());
  } else {
    // clatter at a fixed mechanical rate with an accent, a hiss now and then, a mains hum under it
    const click = renderBell(1800, sr, 0.05, WOOD, seed + 7, 2);
    const clank = renderBell(620, sr, 0.18, ANVIL, seed + 8, 1);
    const rate = 5.5 + r() * 2;
    for (let t = 0, k = 0; t < seconds; t += 1 / rate, k++) strike(t, k % 4 === 0 ? clank : click, k % 4 === 0 ? 0.35 : 0.15, 0.35);
    const hp = new Biquad().set('highpass', 3500, 0.7, sr);
    for (let t = r() * 2; t < seconds; t += 2 + r() * 2.5) {
      const on = Math.floor(t * sr), len = Math.floor((0.4 + r() * 0.6) * sr);
      for (let i = 0; i < len; i++) { const e = Math.sin(Math.PI * i / len); const v = hp.run(r() * 2 - 1) * e * 0.12; addWrap(L, on + i, v); addWrap(R, on + i, v * 0.8); }
    }
    for (let i = 0; i < n; i++) {
      // whole cycles of 50 Hz (and 100/150) in any loop length that is a multiple of 20 ms: no seam
      const t = i / sr;
      const v = 0.05 * Math.sin(2 * Math.PI * 50 * t) + 0.03 * Math.sin(2 * Math.PI * 100 * t) + 0.015 * Math.sin(2 * Math.PI * 150 * t);
      L[i] += v; R[i] += v;
    }
  }
  return normalizePeak([L, R], 0.85);
}

// ───────────────────────────── body, sky, rooms ─────────────────────────────

/** One heartbeat (lub-dub): two low thumps falling in pitch. Scheduled by the engine at a resting rate. */
export function renderHeartbeat(sr: number): Float32Array {
  const n = Math.floor(sr * 0.75);
  const out = new Float32Array(n);
  const thump = (at: number, f0: number, f1: number, dur: number, amp: number): void => {
    const on = Math.floor(at * sr), len = Math.floor(dur * sr);
    let ph = 0;
    for (let i = 0; i < len && on + i < n; i++) {
      const x = i / len;
      ph += (2 * Math.PI * (f0 + (f1 - f0) * x)) / sr;
      const env = Math.min(1, x * 14) * Math.pow(1 - x, 2.2);
      out[on + i] += Math.sin(ph) * env * amp;
    }
  };
  thump(0, 58, 36, 0.13, 1);
  thump(0.29, 66, 44, 0.1, 0.7);
  return normalizePeak([out], 0.9)[0];
}

/**
 * Thunder: a crack (several bright bursts in the first 150 ms, for a near strike) and the long rolling rumble of the
 * channel's far segments arriving one after another, darkening as it goes. Distance is applied live (delay + lowpass).
 */
export function renderThunder(sr: number, seconds: number, seed: number): Float32Array {
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  const r = rng(seed);
  // crack
  for (let c = 0; c < 4; c++) {
    const on = Math.floor((c === 0 ? 0 : r() * 0.15) * sr);
    const tau = 0.004 + r() * 0.008;
    const amp = c === 0 ? 1 : 0.4 + r() * 0.5;
    for (let i = 0; i < tau * sr * 7 && on + i < n; i++) out[on + i] += (r() * 2 - 1) * Math.exp(-i / (tau * sr)) * amp;
  }
  // rolls: a sum of delayed decaying envelopes over brown noise
  const rolls: [number, number, number][] = [];
  const k = 4 + Math.floor(r() * 4);
  for (let i = 0; i < k; i++) rolls.push([0.05 + r() * seconds * 0.45, 0.4 + r() * 1.6, (1 - i / k) * (0.5 + r() * 0.5)]);
  let brown = 0, mod = 0.5, modT = 0.5;
  const lp = new Biquad();
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (i % 256 === 0) {
      modT = 0.35 + r() * 0.65;
      lp.set('lowpass', 250 + 2800 * Math.exp(-t / 0.9), 0.7, sr);
    }
    mod += (modT - mod) * 0.004;
    brown = (brown + 0.02 * (r() * 2 - 1)) / 1.02;
    let env = 0;
    for (const [t0, tau, a] of rolls) {
      if (t < t0) continue;
      const d = t - t0;
      env += a * (1 - Math.exp(-d / 0.06)) * Math.exp(-d / tau);
    }
    out[i] += lp.run(brown * 3.5 * env * mod) * 2.2;
  }
  const fade = Math.floor(sr * 0.3);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  removeDc(out);
  return normalizePeak([out], 0.9)[0];
}

export interface ReverbOptions {
  /** seconds to −60 dB */
  decay: number;
  /** seconds of pre-delay before the diffuse tail */
  predelay?: number;
  /** 0..1: how long the highs survive (0 = dark hall, 1 = bright plate) */
  bright?: number;
  /** number of discrete early reflections */
  early?: number;
}

/**
 * A stereo impulse response: discrete early reflections, then decorrelated noise decaying at the wanted T60 through
 * a lowpass that closes over time (air and walls eat the highs first). Normalised to unit energy.
 */
export function renderImpulse(sr: number, seed: number, o: ReverbOptions): Channels {
  const n = Math.max(16, Math.floor(sr * (o.decay + (o.predelay ?? 0.01))));
  const pre = Math.floor(sr * (o.predelay ?? 0.01));
  const r = rng(seed);
  const chs: Channels = [new Float32Array(n), new Float32Array(n)];
  const bright = o.bright ?? 0.5;
  for (const c of chs) {
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.907755 * t) / o.decay);
      const cutoff = 600 + (bright * 12000 + 2000) * Math.exp(-t / (o.decay * (0.25 + bright * 0.5)));
      const a = onePole(cutoff, sr);
      lp += a * (r() * 2 - 1 - lp);
      // fade the tail's first milliseconds in so the direct sound leads
      const fin = Math.min(1, (i - pre) / (sr * 0.008));
      c[i] = lp * env * fin;
    }
    const early = o.early ?? 7;
    for (let e = 0; e < early; e++) {
      const at = pre + Math.floor((0.004 + r() * 0.07) * sr);
      if (at < n) c[at] += (r() < 0.5 ? -1 : 1) * (0.3 + r() * 0.5) * (1 - e / early);
    }
  }
  let energy = 0;
  for (const c of chs) for (let i = 0; i < n; i++) energy += c[i] * c[i];
  const k = 1 / Math.sqrt(Math.max(1e-12, energy / 2));
  for (const c of chs) for (let i = 0; i < n; i++) c[i] *= k;
  return chs;
}

/**
 * Transfer curve of the final soft clipper: exactly linear up to `knee`, then a tanh shoulder whose asymptote is
 * `ceiling`. A WaveShaper clamps its input to [-1, 1], so the master output can never exceed curve(1) < ceiling.
 */
export function softClipCurve(size = 4096, knee = 0.6, ceiling = 0.97): Float32Array<ArrayBuffer> {
  const c = new Float32Array(size);
  const span = ceiling - knee;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
    c[i] = Math.sign(x) * y;
  }
  return c;
}
