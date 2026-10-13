// VALE render — VFX lifetime curves and colour gradients (CONTRACT §9.5 "curves").
//
// Every curve-valued key accepts, in increasing order of control:
//   7                         a constant
//   [1, 0]                    start → end (the legacy [start, end] pair), linear
//   [0, 1, 1, 0.2, 0]         ≥ 3 numbers: evenly spaced keys over the particle's life
//   [[0, 0], [0.1, 1], [1, 0]] explicit [t, value] keys (t in 0..1, ascending), linear between keys
// Gradients take the same forms with colours ("#rrggbb" | "team" | "element"): one colour, a pair,
// evenly spaced colours, or [[t, colour], …] keys. Curves are baked once at load into 32-sample
// tables; gradients keep their colour REFS (team/element resolve per spawn) and are baked into a
// pooled table when a layer fires (no per-frame allocation).

import { Color } from 'three';

export const CURVE_N = 32;

/** a number curve baked into CURVE_N samples over t ∈ [0, 1] */
export type Curve = Float32Array;

export type ColorRef = { k: 0; c: Color } | { k: 1 } | { k: 2 };
export interface Gradient { t: number[]; c: ColorRef[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** parse + bake a number curve; `def` is used when the value is missing or malformed */
export function curve(v: unknown, def: number | number[]): Curve {
  const keys = curveKeys(v) ?? curveKeys(def) ?? { t: [0], v: [0] };
  const out = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) out[i] = sampleKeys(keys.t, keys.v, i / (CURVE_N - 1));
  return out;
}

/** a constant curve */
export function constCurve(v: number): Curve { return new Float32Array(CURVE_N).fill(v); }

function curveKeys(v: unknown): { t: number[]; v: number[] } | null {
  if (isNum(v)) return { t: [0], v: [v] };
  if (!Array.isArray(v) || v.length === 0) return null;
  if (v.every((k) => Array.isArray(k) && k.length === 2 && isNum(k[0]) && isNum(k[1]))) {
    const ks = (v as [number, number][]).slice().sort((a, b) => a[0] - b[0]);
    return { t: ks.map((k) => Math.max(0, Math.min(1, k[0]))), v: ks.map((k) => k[1]) };
  }
  if (v.every(isNum)) {
    const n = v.length;
    return { t: v.map((_, i) => (n === 1 ? 0 : i / (n - 1))), v: v as number[] };
  }
  return null;
}

function sampleKeys(t: number[], v: number[], x: number): number {
  if (t.length === 1 || x <= t[0]) return v[0];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i]) {
      const span = t[i] - t[i - 1];
      const f = span > 1e-6 ? (x - t[i - 1]) / span : 1;
      return v[i - 1] + (v[i] - v[i - 1]) * f;
    }
  }
  return v[v.length - 1];
}

/** sample a baked curve (t clamped) */
export function evalCurve(c: Curve, t: number): number {
  const x = (t <= 0 ? 0 : t >= 1 ? 1 : t) * (CURVE_N - 1);
  const i = x | 0;
  const f = x - i;
  return i >= CURVE_N - 1 ? c[CURVE_N - 1] : c[i] + (c[i + 1] - c[i]) * f;
}

/** first / last / max of a baked curve */
export const curveMax = (c: Curve): number => { let m = -Infinity; for (let i = 0; i < CURVE_N; i++) if (c[i] > m) m = c[i]; return m; };

export function colorRef(v: unknown): ColorRef | null {
  if (v === 'team') return { k: 1 };
  if (v === 'element') return { k: 2 };
  if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return { k: 0, c: new Color().setStyle(v) };
  return null;
}

/** parse a gradient; `def` when missing or malformed */
export function gradient(v: unknown, def: unknown = 'team'): Gradient {
  return gradientKeys(v) ?? gradientKeys(def) ?? { t: [0], c: [{ k: 1 }] };
}

function gradientKeys(v: unknown): Gradient | null {
  const one = colorRef(v);
  if (one) return { t: [0], c: [one] };
  if (!Array.isArray(v) || v.length === 0) return null;
  if (v.every((k) => Array.isArray(k) && k.length === 2 && isNum(k[0]) && colorRef(k[1]))) {
    const ks = (v as [number, string][]).slice().sort((a, b) => a[0] - b[0]);
    return { t: ks.map((k) => Math.max(0, Math.min(1, k[0]))), c: ks.map((k) => colorRef(k[1])!) };
  }
  const refs = v.map(colorRef);
  if (refs.every((r) => r)) {
    const n = refs.length;
    return { t: refs.map((_, i) => (n === 1 ? 0 : i / (n - 1))), c: refs as ColorRef[] };
  }
  return null;
}

/** does a gradient reference the team colour (relationship-coded)? */
export const gradientUsesTeam = (g: Gradient): boolean => g.c.some((r) => r.k === 1);

/**
 * Pooled baked gradients: a ring of slots, CURVE_N × rgb each. A layer bakes its resolved gradient
 * into the next slot when it fires; particles keep the slot index. 1024 slots outlive any particle.
 */
export class GradientPool {
  static readonly SLOTS = 1024;
  readonly data = new Float32Array(GradientPool.SLOTS * CURVE_N * 3);
  private next = 0;
  private readonly tmp: Color[] = [];

  /** bake `g` with `resolve` mapping each ColorRef → linear rgb; returns the slot */
  bake(g: Gradient, resolve: (r: ColorRef, out: Color) => Color, scale = 1): number {
    const slot = this.next;
    this.next = (this.next + 1) % GradientPool.SLOTS;
    while (this.tmp.length < g.c.length) this.tmp.push(new Color());
    for (let i = 0; i < g.c.length; i++) resolve(g.c[i], this.tmp[i]);
    const base = slot * CURVE_N * 3;
    const d = this.data;
    for (let s = 0; s < CURVE_N; s++) {
      const x = s / (CURVE_N - 1);
      let r = this.tmp[0].r, gg = this.tmp[0].g, b = this.tmp[0].b;
      if (g.t.length > 1 && x > g.t[0]) {
        let done = false;
        for (let i = 1; i < g.t.length; i++) {
          if (x <= g.t[i]) {
            const span = g.t[i] - g.t[i - 1];
            const f = span > 1e-6 ? (x - g.t[i - 1]) / span : 1;
            const a = this.tmp[i - 1], c = this.tmp[i];
            r = a.r + (c.r - a.r) * f; gg = a.g + (c.g - a.g) * f; b = a.b + (c.b - a.b) * f;
            done = true;
            break;
          }
        }
        if (!done) { const c = this.tmp[g.t.length - 1]; r = c.r; gg = c.g; b = c.b; }
      }
      d[base + s * 3] = r * scale; d[base + s * 3 + 1] = gg * scale; d[base + s * 3 + 2] = b * scale;
    }
    return slot;
  }

  /** sample slot at t into out (rgb) */
  sample(slot: number, t: number, out: Float32Array, o: number): void {
    const x = (t <= 0 ? 0 : t >= 1 ? 1 : t) * (CURVE_N - 1);
    const i = x | 0;
    const f = x - i;
    const base = slot * CURVE_N * 3 + i * 3;
    const d = this.data;
    if (i >= CURVE_N - 1) { out[o] = d[base]; out[o + 1] = d[base + 1]; out[o + 2] = d[base + 2]; return; }
    out[o] = d[base] + (d[base + 3] - d[base]) * f;
    out[o + 1] = d[base + 1] + (d[base + 4] - d[base + 1]) * f;
    out[o + 2] = d[base + 2] + (d[base + 5] - d[base + 2]) * f;
  }
}
