// conservative log depth (src/render/shaders/zcons.ts): the rasterised depth must never lie above the written log
// depth, for every fragment of every triangle — including triangles that reach behind the eye (clipped, depth-clamped)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeClipZ, tangentClipZ } from '../src/render/shaders/zcons.ts';

const FAR = 2e7;
const K = 1 / Math.log2(FAR + 1); // logDepthBufFC / 2
const L = (w: number) => K * Math.log2(1 + w);
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** worst (rasterised − written) over random points of a triangle with vertex depths w[] and clip z[] */
function worst(w: number[], z: number[]): number {
  let bad = -Infinity;
  for (let k = 0; k < 400; k++) {
    let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
    const m = [a, b, 1 - a - b];
    const wp = m[0] * w[0] + m[1] * w[1] + m[2] * w[2];
    if (wp < 0.05) continue; // clipped (behind the eye / nearer than the near plane)
    const zp = m[0] * z[0] + m[1] * z[1] + m[2] * z[2];
    const ras = clamp01((zp / wp + 1) / 2); // depth clamp
    bad = Math.max(bad, ras - clamp01(L(wp)));
  }
  return bad;
}

/** a triangle in view space with every edge <= e around a centre at view depth wc (some vertices may be behind) */
function tri(wc: number, e: number): number[] {
  for (;;) {
    const p = [0, 1, 2].map(() => [(rnd() - 0.5) * e, (rnd() - 0.5) * e, wc + (rnd() - 0.5) * e]);
    const d = (i: number, j: number) => Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1], p[i][2] - p[j][2]);
    if (d(0, 1) <= e && d(1, 2) <= e && d(0, 2) <= e) return p.map((q) => q[2]);
  }
}

test('edge bound: rasterised depth <= log depth for triangles near, far and behind the eye', () => {
  for (const e of [1.2, 6.5, 40, 300, 4000]) {
    for (const wc of [-e, -0.3 * e, 0, 0.2 * e, e, 3 * e, 10 * e, 100 * e, 1e4 * e]) {
      for (let t = 0; t < 40; t++) {
        const w = tri(wc, e);
        assert.ok(worst(w, w.map((x) => edgeClipZ(x, e, K))) <= 1e-12, `e ${e} wc ${wc} w ${w}`);
      }
    }
  }
});

test('edge bound is tight away from the camera (ground rejected under things that stand on it)', () => {
  // slack in metres at view depth w: (L(w) − rasterised) / L'(w)
  for (const [e, w] of [[6.5, 30], [6.5, 100], [40, 400]]) {
    const ras = (edgeClipZ(w, e, K) / w + 1) / 2;
    const slack = (L(w) - ras) / (K / (Math.LN2 * (1 + w)));
    // ≈ 0.19·e²/w: centimetres to decimetres at the LOD a patch has at that distance
    assert.ok(slack > 0 && slack < (e * e) / (4 * (w - e)) + 0.05, `e ${e} w ${w} slack ${slack}`);
  }
});

test('the first version (z = -5w when w <= 2e) broke the bound behind the eye', () => {
  const old = (w: number, e: number) => {
    if (w > 2 * e) { const r = e / (w - e); return (2 * (L(w) - K * r * r * 0.2705 - 4e-6) - 1) * w; }
    return -5 * w;
  };
  assert.ok(worst([-3, 20, 18], [-3, 20, 18].map((x) => old(x, 8))) > 0.1);
});

test('tangent bound: any per-triangle reference depth is a lower bound', () => {
  for (const w0 of [0.2, 1, 5, 50, 800, 3e4, 5e6, 3e7]) {
    for (const wc of [-50, 0, 2, 20, 200, 5000, 1e6]) {
      for (let t = 0; t < 20; t++) {
        const e = 1 + rnd() * 500;
        const w = tri(wc, e);
        assert.ok(worst(w, w.map((x) => tangentClipZ(x, w0, K))) <= 1e-12, `w0 ${w0} w ${w}`);
      }
    }
  }
});
