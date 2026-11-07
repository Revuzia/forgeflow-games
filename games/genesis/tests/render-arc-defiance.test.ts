// GENESIS — ARC §3.4 / §6.9: the hurl arcs (render/signs/defiance.ts), render-only, at most 64 in flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { DefianceArcs, HURL_MAX_IN_FLIGHT, HURL_PERIOD_S, hurlFlight, hurlThrow } from '../src/render/signs/defiance.ts';

test('a throw rises 15-25 m and falls back short (a few metres off)', () => {
  const g = 9.8;
  for (let id = 1; id < 300; id++) {
    const t = hurlThrow(id, id * 3, g);
    const apex = (t.up * t.up) / (2 * g);
    assert.ok(apex >= 15 - 1e-9 && apex <= 25 + 1e-9, String(apex));
    const T = hurlFlight(t.up, g), drift = Math.hypot(t.e, t.nn) * T;
    assert.ok(drift < 18, `drift ${drift}`);
  }
  assert.deepEqual(hurlThrow(5, 2, g), hurlThrow(5, 2, g), 'stable per person and swing');
});

test('one throw per swing per person, never more than 64 in flight', () => {
  const R = 1e6;
  const tossed: number[] = [];
  const pool = { gU: { value: 9.8 }, toss: (_p: Vector3, _v: Vector3, _s: number, t: number) => { tossed.push(t); } };
  const arcs = new DefianceArcs();
  const hurlers: number[] = [];
  for (let id = 1; id <= 200; id++) hurlers.push(id, 0, R, id * 0.5, 1.7);
  const cam = new Vector3(0, R + 30, 0);
  for (let f = 0; f <= 600; f++) {
    arcs.update(hurlers, cam, f / 60, pool);
    assert.ok(arcs.stats.inFlight <= HURL_MAX_IN_FLIGHT);
  }
  assert.ok(tossed.length > 64, `${tossed.length} thrown in 10 s`);
  // one person alone throws about once per swing
  const one = new DefianceArcs(); let n = 0;
  const p1 = { gU: { value: 9.8 }, toss: () => { n++; } };
  for (let f = 0; f <= 60 * 20; f++) one.update([7, 0, R, 0, 1.7], cam, f / 60, p1);
  assert.ok(Math.abs(n - 20 / HURL_PERIOD_S) <= 1.5, String(n));
  // far from the camera nobody throws
  const far = new DefianceArcs(); let m = 0;
  for (let f = 0; f <= 600; f++) far.update([7, 0, R, 900, 1.7], cam, f / 60, { gU: { value: 9.8 }, toss: () => { m++; } });
  assert.equal(m, 0);
});

test('render-only: no sim writes, no new program (the debris pool), no Math.random in the arcs', () => {
  const src = readFileSync(new URL('../src/render/signs/defiance.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.random|new (Instanced)?Mesh|ShaderMaterial|sim\/god/);
  const fx = readFileSync(new URL('../src/render/fx/godfx.ts', import.meta.url), 'utf8');
  assert.match(fx, /defiance\.update\(crowds\.hurlers/);
});

test('the idol is a carved post or standing stone about 3 m tall, painted by the culture style', async () => {
  const { buildingMesh } = await import('../src/render/gen/buildinggen.ts');
  const { materialAt, BUILDING_KINDS } = await import('../src/render/life/catalog.ts');
  // (buildings.json gains `idol` from the sim lane: catalog maps any id matching /idol/ to the kind)
  assert.ok((BUILDING_KINDS as readonly string[]).includes('idol'));
  assert.match(readFileSync(new URL('../src/render/life/catalog.ts', import.meta.url), 'utf8'), /\/idol\/\.test\(all\)\) return 'idol'/);
  for (const fam of ['stone', 'timber'] as const) {
    const m = buildingMesh({ kind: 'idol', mat: materialAt(0), style: 2, era: 3, mood: 0, w: 1.6, d: 1.6, lod: 0, family: fam });
    assert.ok(m.height > 2.6 && m.height < 3.6, `${fam} ${m.height}`);
    assert.ok(m.hx < 1.2 && m.emitters.length === 0);
    const a = buildingMesh({ kind: 'idol', mat: materialAt(0), style: 2, era: 3, mood: 0, w: 1.6, d: 1.6, lod: 0, family: fam });
    assert.equal(a.geo.getAttribute('position').count, m.geo.getAttribute('position').count);
  }
});
