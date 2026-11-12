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
  assert.ok(a >= 100 && a <= 300 && b >= 400 && b <= 1000, `faded in over ${a}-${b} m`);
  const body = m![3];
  assert.match(body, /fbm3\(P \* 0\.00\d+/, 'a ~100-300 m drift term');
  assert.match(body, /concave/, 'crests and hollows from the ground curvature');
  assert.match(body, /slope/, 'earth through the turf on steep pitches');
  // the term sits in the grass branch after the sward's tint, before the near texture (sward detail) multiplies in
  const at = TM.indexOf('float midK'), tint = TM.indexOf('gcol = meadowTint('), swd = TM.indexOf('vec4 swd = swardDetail(');
  assert.ok(tint > 0 && tint < at && at < swd);
});

test('P18: a far wooded hill breaks up too (the canopy, not only the sward)', async () => {
  const { readFileSync } = await import('node:fs');
  const TM = readFileSync(new URL('../src/render/planet/terrainmat.ts', import.meta.url), 'utf8');
  // the cover's back hills are wooded: past the instanced trees the canopy colour (tc) is what shows, and a grass-only
  // breakup left them one flat dark green
  const m = /float cMid = smoothstep\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), camDist\);([\s\S]*?)tc = mix\(tc, tc2, cMid/.exec(TM);
  assert.ok(m, 'terrainmat fades a mid-distance breakup into the far canopy colour');
  assert.ok(+m![1] >= 100 && +m![1] <= 300 && +m![2] >= 400 && +m![2] <= 1000, `fade ${m![1]}..${m![2]} m`);
  assert.match(m![3], /fbm3\(P \* 0\.0\d+/, 'grove-scale drifts');
  assert.match(m![3], /concave/, 'crests and hollows');
  const at = TM.indexOf('float cMid'), crown = TM.indexOf('tc *= 0.62 + 0.55 * crown'), inst = TM.indexOf('float inst = uCanopyFade');
  assert.ok(crown > 0 && crown < at && at < inst, 'after the crown shading, before the instanced-tree hand-over');
});

test('the mid-distance drifts also act on the assembled ground colour (punch P18, final pass)', async () => {
  const { readFileSync } = await import('node:fs');
  const TM = readFileSync(new URL('../src/render/planet/terrainmat.ts', import.meta.url), 'utf8');
  // the grass branch's drifts were diluted by the shrub tint, far canopy and soil mixed over them (~4 % of the lit tone at
  // the cover framing): the same drifts once more on the final colour of vegetated ground
  const m = /float mkF = smoothstep\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), camDist\)([\s\S]*?)s\.albedo = col;/.exec(TM);
  assert.ok(m, 'a final mid-distance pass on col before s.albedo');
  assert.ok(+m![1] >= 100 && +m![1] <= 300 && +m![2] >= 400 && +m![2] <= 1000, `fade ${m![1]}..${m![2]} m`);
  assert.match(m![3], /vegTotal/, 'only on vegetated ground');
  assert.match(m![3], /fbm3\(P \* 0\.0\d+/, 'broad drifts');
  assert.match(m![3], /col \*= mix\(vec3\(1\.0\), vec3\(1\.\d+/, 'a dry-gold swing');
  assert.match(m![3], /col \*= mix\(vec3\(1\.0\), vec3\(0\.\d+/, 'a dark-green swing');
});
