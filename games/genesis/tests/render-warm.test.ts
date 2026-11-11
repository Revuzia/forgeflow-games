// GENESIS — shader warm-up holders (macfix/smooth.md F11-F13): what Renderer.warmUp's compile sees at load must have
// the same program key as what is drawn later, or the real program links in the frame an effect first shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchedMesh, Group, InstancedMesh, type Object3D } from 'three';
import { BldBatch } from '../src/render/life/bldbatch.ts';
import { BodyBuckets } from '../src/render/life/bodies.ts';
import { whiteColors } from '../src/render/life/vegetation.ts';
import { PASS_MATERIALS, passMaterial } from '../src/render/post/fsquad.ts';
import { PLAN } from '../src/render/gen/bodygen.ts';

const hidden = (o: Object3D) => { let p: Object3D | null = o; while (p) { if (!p.visible) return true; p = p.parent; } return false; };

test('a building batch carries a never-drawn twin with geometry and per-instance colours (the drawn batch key)', () => {
  const b = new BldBatch('t', {}, false, true);
  assert.equal(b.warm.children.length, 2);
  for (const w of b.warm.children as BatchedMesh[]) {
    assert.ok(w instanceof BatchedMesh);
    assert.ok(hidden(w));
    assert.ok((w as unknown as { _colorsTexture: unknown })._colorsTexture, 'batchingColor');
    for (const a of ['position', 'normal', 'color', 'uv', 'aKit']) assert.ok(w.geometry.getAttribute(a), a);
  }
  assert.deepEqual(b.warm.children.map((w) => (w as BatchedMesh).material), [b.pages[0].material, b.pages[0].depth]);
  b.dispose();
});

test('body buckets hold one hidden mesh per plan for the colour and the shadow pass', () => {
  const bb = new BodyBuckets({}, 'bodies');
  const warm = bb.group.children.find((c) => c.name === 'bodies-warm') as Group;
  assert.ok(warm && !warm.visible);
  assert.equal(warm.children.length, Object.keys(PLAN).length * 2);
  for (const m of warm.children as InstancedMesh[]) assert.equal(m.count, 0);
});

test('instance colours made up front are white (three\'s own default, a no-op tint)', () => {
  const m = new InstancedMesh(undefined, undefined, 5);
  whiteColors(m, 5);
  assert.equal(m.instanceColor!.count, 5);
  assert.ok([...(m.instanceColor!.array as Float32Array)].every((v) => v === 1));
});

test('pass materials are registered for the warm-up and leave the registry on dispose', () => {
  const m = passMaterial('void main(){ gl_FragColor = vec4(1.0); }', {});
  assert.ok(PASS_MATERIALS.has(m));
  m.dispose();
  assert.ok(!PASS_MATERIALS.has(m));
});

test('road ribbons hold the built geometry\'s attribute set before the first road (the warm-up links the drawn key)', async () => {
  const { Roads, emptyRibbon } = await import('../src/render/life/roads.ts');
  const e = emptyRibbon();
  for (const a of ['position', 'normal', 'aRoad', 'aLamp', 'aEnd', 'aLift']) assert.ok(e.attributes[a], a);
  assert.equal(e.index, null);
  const roads = new Roads({});
  const ribbons: Object3D[] = [];
  roads.group.traverse((o) => { const m = o as { material?: { customProgramCacheKey?: () => string } }; if (m.material?.customProgramCacheKey?.().startsWith('genesis-road')) ribbons.push(o); });
  assert.equal(ribbons.length, 2);
  for (const r of ribbons) {
    const g = (r as unknown as { geometry: { attributes: Record<string, unknown> } }).geometry;
    assert.ok(g.attributes.normal, 'a hidden ribbon has normals (three keys vertexNormals on the geometry)');
    assert.equal(r.visible, false);
  }
  roads.dispose();
});

test('the god\'s avatar is made hidden with the ship layer, in its space group (linked at load, not on the first walk)', async () => {
  const { ShipLayer } = await import('../src/render/life/ships.ts');
  const ships = new ShipLayer();
  const av = ships.spaceGroup.getObjectByName('god-avatar');
  assert.ok(av, 'avatar in the space group');
  assert.equal(av.visible, false);
  let mats = 0;
  av.traverse((o) => { if ((o as { material?: unknown }).material) mats++; });
  assert.ok(mats >= 3, `avatar meshes and motes: ${mats}`);
  // the launch FX's per-world and per-engine kinds (puffs, light and shade quads, a trail ribbon, a free plume slot)
  const warm = ships.spaceGroup.getObjectByName('launch-warm');
  assert.ok(warm, 'launch FX twins in the space group');
  assert.equal(warm.visible, false);
  const shaders = new Set<string>();
  warm.traverse((o) => { const m = (o as { material?: { fragmentShader?: string } }).material; if (m?.fragmentShader) shaders.add(m.fragmentShader); });
  assert.ok(shaders.size >= 6, `distinct launch FX programs: ${shaders.size}`);
  ships.dispose();
});
