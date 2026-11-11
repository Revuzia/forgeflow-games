// PERF F22 — a tree bucket is left out of shadow cascade k only when none of its trees' shadows can land on a pixel
// whose view depth reaches cascade k (past the previous split). Brute force on a 3 km sphere world: crown points
// ray-cast along the sun to the ground; every shadow point of a cut tree must lie at view depth < nearSplit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearSplitCut } from '../src/render/life/vegetation.ts';

test('F22 near-split cut never drops a shadow a pixel of the cascade could read', () => {
  const R = 3000;
  let s = 12345;
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const norm = (v: number[]): number[] => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  let cuts = 0, checked = 0;
  for (let trial = 0; trial < 4000; trial++) {
    // camera above the north pole at 20..200 m, looking down-ish along a random azimuth
    const hc = 20 + rnd() * 180;
    const cam = [0, R + hc, 0];
    const az = rnd() * Math.PI * 2, pitch = -(0.05 + rnd() * 0.9);
    const vd = norm([Math.cos(az) * Math.cos(pitch), Math.sin(pitch), Math.sin(az) * Math.cos(pitch)]);
    // a tree within 300 m of the point under the camera
    const ta = rnd() * Math.PI * 2, tr = rnd() * 300 / R;
    const up = [Math.sin(tr) * Math.cos(ta), Math.cos(tr), Math.sin(tr) * Math.sin(ta)];
    const base = up.map((x) => x * R);
    const e = 3 + rnd() * 22;
    // sun: elevation at the camera's ground point 4..80 deg, any azimuth
    const el = (4 + rnd() * 76) * Math.PI / 180, saz = rnd() * Math.PI * 2;
    const sun = norm([Math.cos(saz) * Math.cos(el), Math.sin(el), Math.sin(saz) * Math.cos(el)]);
    // vegetation.ts: the lowest elevation over the drawn range, less 0.2 rad for slopes
    const elT = el - 0.2 - (300 + 300) / R;
    if (elT <= 0.035) continue;
    const cot = 1 / Math.tan(elT);
    const d = Math.hypot(base[0] - cam[0], base[1] - cam[1], base[2] - cam[2]);
    const nearSplit = 50 + rnd() * 400, margin = 2 + rnd() * 3;
    if (!nearSplitCut(d, e, cot, margin, nearSplit)) continue;
    cuts++;
    // crown points: within e of the base, above the ground; their shadows on the sphere
    for (let q = 0; q < 40; q++) {
      const h = rnd() * e, sx = (rnd() - 0.5) * e * 0.8, sz = (rnd() - 0.5) * e * 0.8;
      const p = [base[0] + up[0] * h + sx, base[1] + up[1] * h, base[2] + up[2] * h + sz];
      if (Math.hypot(p[0] - base[0], p[1] - base[1], p[2] - base[2]) > e) continue;
      // march along -sun to the sphere
      const b = p[0] * -sun[0] + p[1] * -sun[1] + p[2] * -sun[2];
      const c = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - R * R;
      const disc = b * b - c;
      if (c <= 0 || disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0) continue;
      const P = [p[0] - sun[0] * t, p[1] - sun[1] * t, p[2] - sun[2] * t];
      // (the worst view direction: straight at the shadow point, view depth = its distance; any other is less)
      const depth = Math.max((P[0] - cam[0]) * vd[0] + (P[1] - cam[1]) * vd[1] + (P[2] - cam[2]) * vd[2], Math.hypot(P[0] - cam[0], P[1] - cam[1], P[2] - cam[2]));
      checked++;
      assert.ok(depth < nearSplit - margin, `shadow at view depth ${depth.toFixed(1)} >= split ${nearSplit.toFixed(1)} (tree ${d.toFixed(1)} m, e ${e.toFixed(1)})`);
    }
  }
  assert.ok(cuts > 200 && checked > 2000, `exercised: ${cuts} cuts, ${checked} shadow points`);
});
