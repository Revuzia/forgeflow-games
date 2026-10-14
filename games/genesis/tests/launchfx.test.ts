// GENESIS — launch FX without a GPU (render/fx/launch.ts): what a climbing engine leaves in the air.
//   * smoke is laid by DISTANCE flown, not by time: however fast the climb and however few frames are drawn (one
//     frame two seconds after lift-off), the births along the path are never more than half a puff's width apart —
//     the trail is one body, not a string of beads;
//   * the newest stretch is a continuous ribbon from the nozzle back, thinning out as the air does;
//   * a lander's flame is faint and shimmers; its dust takes the ground's colour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3, type IUniform } from 'three';
import { LaunchFx, PUFF, RIBBON_AGE, type EngineFire, type LaunchPlanetCtx } from '../src/render/fx/launch.ts';

const R = 3000, AIR = 600;

function ctx(): LaunchPlanetCtx {
  const uniforms: Record<string, IUniform> = {
    uSunE: { value: new Vector3(8, 8, 8) }, uSunDirBody: { value: new Vector3(0, 1, 0) }, uMoonE: { value: new Vector3() },
  };
  return { group: new Group(), uniforms, camBody: new Vector3(0, R + 10, 400), wind: new Vector3(), airTop: AIR, radius: R, hasAir: true };
}

/** a straight climb from the pad (body frame +y), `speed` m/s at 1× (10 ticks a second), lit at tick 0 */
function climb(speed: number): (tick: number, out: Vector3) => Vector3 {
  return (tick, out) => out.set(0, R + Math.max(0, tick / 10) * speed, 0);
}

function births(fx: LaunchFx): { x: number; y: number; z: number; t: number; kind: number }[] {
  const P = (fx as unknown as { planets: Map<number, { puffs: { aA: { array: Float32Array }; aB: { array: Float32Array }; cap: number } }> }).planets.get(0)!;
  const A = P.puffs.aA.array, B = P.puffs.aB.array;
  const out: { x: number; y: number; z: number; t: number; kind: number }[] = [];
  for (let i = 0; i < P.puffs.cap; i++) {
    if (A[i * 4 + 3] > 1e8) continue;
    out.push({ x: A[i * 4], y: A[i * 4 + 1], z: A[i * 4 + 2], t: A[i * 4 + 3], kind: Math.floor(B[i * 4 + 3] + 0.5) });
  }
  return out;
}

function fire(path: (tick: number, out: Vector3) => Vector3, tick: number): EngineFire {
  const pos = path(tick, new Vector3());
  return {
    key: 'r1:0', planet: 0, pos, dir: new Vector3(0, -1, 0), radius: 0.9, count: 5, thrust: 1, vacuum: false, fuel: 'kerolox',
    alt: pos.length() - R, path, trail: true, since: 0, fromPad: true,
  };
}

test('a fast climb seen in one late frame leaves a continuous trail, not beads', () => {
  const fx = new LaunchFx();
  const c = ctx();
  const path = climb(260);
  const tick = 20; // T+2 s at 1×: 520 m up
  fx.begin(tick);
  fx.engine(fire(path, tick));
  fx.update(() => c, [0, 0, 0], 0, 2, 0.016);
  const b = births(fx).filter((p) => p.kind === PUFF.smoke || p.kind === PUFF.trail).sort((a, b2) => a.t - b2.t);
  assert.ok(b.length > 40, `${b.length} births along 520 m`);
  // successive births along the climb: the gap never exceeds half the puff's radius when the ribbon hands over
  const scale = 0.9 * Math.sqrt(5);
  const handover = 3.5 * scale + (34 - 3.5) * scale * Math.sqrt(RIBBON_AGE / 30);
  let worst = 0;
  for (let i = 1; i < b.length; i++) {
    const dy = Math.abs(b[i].y - b[i - 1].y);
    worst = Math.max(worst, dy);
  }
  assert.ok(worst <= 0.5 * handover + 4 * scale, `largest gap ${worst.toFixed(1)} m (puff radius at hand-over ${handover.toFixed(1)} m)`);
  // and the births reach from the pad up to where the engine is now (backfilled from ignition)
  const ys = b.map((p) => p.y - R);
  assert.ok(Math.min(...ys) < 40 && Math.max(...ys) > 400, `from ${Math.min(...ys).toFixed(0)} to ${Math.max(...ys).toFixed(0)} m`);
});

test('the trail is laid the same way frame by frame as in one late frame', () => {
  const run = (frames: number): number => {
    const fx = new LaunchFx();
    const c = ctx();
    const path = climb(200);
    for (let f = 1; f <= frames; f++) {
      const tick = (20 * f) / frames;
      fx.begin(tick);
      fx.engine(fire(path, tick));
      fx.update(() => c, [0, 0, 0], 0, tick / 10, 0.1);
    }
    return births(fx).filter((p) => p.kind === PUFF.smoke || p.kind === PUFF.trail).length;
  };
  const one = run(1), many = run(40);
  assert.ok(Math.abs(one - many) <= Math.max(6, one * 0.12), `one frame ${one} births, forty frames ${many}`);
});

test('the newest stretch is a ribbon from the nozzle back', () => {
  const fx = new LaunchFx();
  const c = ctx();
  const path = climb(150);
  fx.begin(15);
  fx.engine(fire(path, 15));
  fx.update(() => c, [0, 0, 0], 0, 1.5, 0.016);
  const P = (fx as unknown as { planets: Map<number, { ribbons: Map<string, { mesh: { visible: boolean } }> }> }).planets.get(0)!;
  const rb = P.ribbons.get('r1:0');
  assert.ok(rb && rb.mesh.visible, 'a ribbon is laid behind the climbing engine');
});

test("a lander's dust takes the colour of the ground it lifts off", () => {
  const fx = new LaunchFx();
  const c = ctx();
  fx.begin(100);
  fx.dust(0, c, new Vector3(0, R, 0), 1, 1, 90, [0.6, 0.32, 0.16]);
  fx.update(() => c, [0, 0, 0], 0, 10, 0.016);
  const P = (fx as unknown as { planets: Map<number, { puffs: { uniforms: Record<string, IUniform> } }> }).planets.get(0)!;
  const tint = P.puffs.uniforms.uDustTint.value as Vector3;
  assert.ok(tint.x > tint.y * 1.5 && tint.y > tint.z, `rust dust (${tint.toArray().map((v) => v.toFixed(2))})`);
  assert.ok(births(fx).some((p) => p.kind === PUFF.dust), 'dust is raised');
});
