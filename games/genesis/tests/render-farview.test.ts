// punch P10: the title's backdrop (and any whole-disc orbit view) at Low keeps a clean limb and fine clouds
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../src/render/quality.ts';

test('a whole-disc view lifts Low to a fine terrain error and 3-px cloud blocks (punch P10)', () => {
  const f = (Q as Record<string, unknown>).farViewQuality as ((q: Q.Quality, altOverR: number) => { pixelError: number; cloudScale: number }) | undefined;
  assert.ok(typeof f === 'function', 'quality.ts exports farViewQuality');
  const low = Q.QUALITY.low;
  // the title's framing: the camera at 3.2 radii (altitude 2.2 R)
  const t = f!(low, 2.2);
  assert.ok(t.pixelError <= 6, `title pixel error ${t.pixelError}`);
  assert.ok(t.cloudScale >= 0.35, `title cloud scale ${t.cloudScale}`);
  // near the ground nothing changes: Low stays Low where it costs
  const g = f!(low, 0.001);
  assert.equal(g.pixelError, low.terrainPixelError);
  assert.equal(g.cloudScale, low.cloudScale);
  // a finer preset is never coarsened
  const hi = Q.QUALITY.ultra;
  const u = f!(hi, 2.2);
  assert.equal(u.pixelError, hi.terrainPixelError);
  assert.equal(u.cloudScale, hi.cloudScale);
});

test('a grassed hill breaks up at mid distance: crests, hollows, drifts and bare pitches (punch P18)', async () => {
  const { readFileSync } = await import('node:fs');
  const TM = readFileSync(new URL('../src/render/planet/terrainmat.ts', import.meta.url), 'utf8');
  const m = /float midK = smoothstep\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), camDist\);([\s\S]*?)gcol = mix\(gcol, g2, midK\);/.exec(TM);
  assert.ok(m, 'terrainmat fades a mid-distance breakup into the grass colour');
  const [a, b] = [Number(m![1]), Number(m![2])];
  assert.ok(a >= 150 && a <= 400 && b >= 600 && b <= 1600, `faded in over ${a}-${b} m`);
  const body = m![3];
  assert.match(body, /fbm3\(P \* 0\.00\d+/, 'a ~100-300 m drift term');
  assert.match(body, /concave/, 'crests and hollows from the ground curvature');
  assert.match(body, /slope/, 'earth through the turf on steep pitches');
  // the term sits in the grass branch after the sward's tint, before the near texture (sward detail) multiplies in
  const at = TM.indexOf('float midK'), tint = TM.indexOf('gcol = meadowTint('), swd = TM.indexOf('vec4 swd = swardDetail(');
  assert.ok(tint > 0 && tint < at && at < swd);
});
