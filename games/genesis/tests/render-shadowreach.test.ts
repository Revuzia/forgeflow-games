// PERF F11 — the shadow-reach bound used to cull terrain / building shadow casters per cascade (shadowreach.ts):
// (1) exact 2-D geometry on a circle: the shadow ray from a caster top e above the receiver floor, with the sun at
//     the worst elevation the bound allows, meets the floor within the reach (and the bound is not absurdly loose);
// (2) a sun too low answers Infinity (mountains keep their evening shadows);
// (3) capGap never exceeds the true ground distance from a cap to points of the sphere (random sampling).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capGap, shadowReach, REACH_MIN_EL } from '../src/render/planet/shadowreach.ts';

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

/** arc length (at the floor radius) the shadow ray of a caster top runs before it drops below the floor (Infinity: never) */
function trueRun(e: number, elCaster: number, R: number, floor: number): number {
  // caster top at (0, R + floor + e); the ray heads away from the sun (+x), descending at elCaster to the local
  // horizontal there
  const px = 0, py = R + floor + e;
  const dx = Math.cos(elCaster), dy = -Math.sin(elCaster);
  // |p + t d| = R + floor: t² + 2t(p·d) + |p|² − rf² = 0
  const rf = R + floor;
  const b = px * dx + py * dy, c = px * px + py * py - rf * rf;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return Infinity;
  const hx = px + t * dx, hy = py + t * dy;
  return Math.atan2(hx, hy) * rf;
}

test('the shadow reach bounds the true shadow over a curved planet', () => {
  let n = 0, worst = 0;
  for (let i = 0; i < 20000; i++) {
    const R = [1500, 3000, 6000, 30000][i % 4];
    const e = rnd() < 0.3 ? rnd() * 20 : rnd() * 900;
    const el0 = 0.02 + rnd() * 1.5;
    const d0 = rnd() * 2500;
    const floor = (rnd() - 0.5) * 400;
    const reach = shadowReach(e, el0, d0, R, 0);
    // the sun at the caster may be as low as el0 − d0/R (the camera's elevation less the curvature to the caster)
    const elC = el0 - d0 / R;
    if (!Number.isFinite(reach)) continue;
    assert.ok(elC > REACH_MIN_EL, `finite reach with the sun at ${elC} at the caster`);
    const run = trueRun(e, elC, R, floor);
    assert.ok(run <= reach + 1e-6, `e ${e} el0 ${el0} d0 ${d0} R ${R}: shadow runs ${run}, bound ${reach}`);
    n++;
    worst = Math.max(worst, reach / Math.max(run, 1));
  }
  assert.ok(n > 5000, `cases with a finite bound ${n}`);
  // (loose only by the 2 % + 0.5 m the iteration adds and the curvature allowance)
  if (process.env.REACH_LOG) console.log('cases', n, 'worst ratio', worst);
});

test('a low sun draws every caster; flat ground and a high sun give the flat-ground shadow', () => {
  assert.equal(shadowReach(300, 0.03, 0, 3000, 4), Infinity);
  assert.equal(shadowReach(300, 0.3, 3000 * 0.28, 3000, 4), Infinity);
  // 45° sun on a huge world: reach ≈ e + margin (within the iteration's 2 % + 0.5 m)
  const r = shadowReach(30, Math.PI / 4, 100, 1e7, 4);
  assert.ok(r >= 34 && r < 36, `45° reach ${r}`);
  assert.equal(shadowReach(0, 0.5, 0, 3000, 4), 4);
});

test('capGap never exceeds the true ground distance', () => {
  const R = 3000;
  const v = (): [number, number, number] => { const z = rnd() * 2 - 1, a = rnd() * 6.283, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), s * Math.sin(a), z]; };
  for (let i = 0; i < 3000; i++) {
    const d = v();
    const aR = rnd() * 0.05;
    // a cascade sphere near the surface somewhere within ~0.6 rad
    const cd = v();
    const mix = rnd() * 0.3;
    const c0 = [d[0] + (cd[0] - d[0]) * mix, d[1] + (cd[1] - d[1]) * mix, d[2] + (cd[2] - d[2]) * mix];
    const cl = Math.hypot(c0[0], c0[1], c0[2]);
    const cr = R + (rnd() - 0.3) * 200;
    const c = c0.map((x) => (x / cl) * cr);
    const r = 20 + rnd() * 600;
    const g = capGap(d[0], d[1], d[2], aR, c[0], c[1], c[2], r, R);
    // sample: points of the sphere and of the cap; the true least angle between them, times R
    let best = Infinity;
    for (let s = 0; s < 200; s++) {
      const u = v(), rr = r * Math.cbrt(rnd());
      const q = [c[0] + u[0] * rr, c[1] + u[1] * rr, c[2] + u[2] * rr];
      const ql = Math.hypot(q[0], q[1], q[2]);
      const ang = Math.acos(Math.max(-1, Math.min(1, (q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) / ql)));
      best = Math.min(best, Math.max(0, ang - aR) * R);
    }
    assert.ok(g <= best + 1e-6, `gap ${g} > sampled ${best}`);
  }
});
