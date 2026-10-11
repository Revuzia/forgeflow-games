// GENESIS — the god layer's generated bodies (render lane, CONTRACT.md §15.6–15.8), without a GPU:
//   * the hand: one closed skinned surface — finite positions and normals, every vertex weighted (weights summing to
//     1, bone indices in range), marks for the nails and the fingers, five fingertips and the palm in the bind pose;
//     the rig in the rest pose reproduces the bind pose, and curling the fingers moves the tips toward the palm;
//   * every creature body (ape, ox, great cat, tortoise, wolf, bear) builds the same way, has four feet near the
//     ground, two eyes in its head, its legs and head named; a cruel (spiky) build grows spines (region 5) and is
//     leaner than a good (fat) one; builds are cached by quantised morph;
//   * the rig's skinning matrices stay finite under any pose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handMesh, handRig } from '../src/render/gen/handgen.ts';
import { CREATURE_BODIES, creatureMesh, creatureRig } from '../src/render/gen/creaturegen.ts';
import type { BufferGeometry } from 'three';
import type { Rig } from '../src/render/gen/rig.ts';

function checkSkinned(geo: BufferGeometry, bones: number, what: string): void {
  const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal');
  const bi = geo.getAttribute('aBoneIdx'), bw = geo.getAttribute('aBoneW');
  assert.ok(pos && pos.count > 2000, `${what}: a real surface (${pos?.count} vertices)`);
  assert.ok(nrm && nrm.count === pos.count, `${what}: normals`);
  assert.ok(bi && bw && bi.count === pos.count && bw.count === pos.count, `${what}: skin attributes`);
  assert.ok(geo.getAttribute('aMark') && geo.getAttribute('aRest'), `${what}: marks and rest positions`);
  const index = geo.getIndex();
  assert.ok(index && index.count % 3 === 0 && index.count >= pos.count, `${what}: triangles`);
  for (let i = 0; i < index.count; i++) assert.ok(index.getX(i) < pos.count, `${what}: index in range`);
  for (let v = 0; v < pos.count; v++) {
    assert.ok(Number.isFinite(pos.getX(v)) && Number.isFinite(pos.getY(v)) && Number.isFinite(pos.getZ(v)), `${what}: finite position`);
    const l = Math.hypot(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
    assert.ok(Math.abs(l - 1) < 0.02, `${what}: unit normal at ${v} (${l})`);
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const w = (bw.array as ArrayLike<number>)[v * 4 + k];
      const b = (bi.array as ArrayLike<number>)[v * 4 + k];
      assert.ok(w >= 0 && Number.isFinite(w), `${what}: weight`);
      assert.ok(b >= 0 && b < bones, `${what}: bone index in range`);
      s += w;
    }
    assert.ok(Math.abs(s - 1) < 1e-3, `${what}: weights sum to 1 at ${v} (${s})`);
  }
}

function finiteSkin(rig: Rig, what: string): void {
  for (let i = 0; i < rig.skin.length; i++) assert.ok(Number.isFinite(rig.skin[i]), `${what}: finite skinning matrix`);
}

/** apply a rig's skinning to one bind-pose point (weighted by the vertex's own bones) */
function skinPoint(rig: Rig, geo: BufferGeometry, v: number): [number, number, number] {
  const pos = geo.getAttribute('position');
  const bi = geo.getAttribute('aBoneIdx').array as ArrayLike<number>, bw = geo.getAttribute('aBoneW').array as ArrayLike<number>;
  const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const w = bw[v * 4 + k];
    if (!w) continue;
    const m = rig.skin.subarray(bi[v * 4 + k] * 16, bi[v * 4 + k] * 16 + 16);
    out[0] += w * (m[0] * x + m[4] * y + m[8] * z + m[12]);
    out[1] += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
    out[2] += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
  }
  return out;
}

test('the god hand: a skinned surface with nails, five fingers and a rig that curls them', () => {
  const h = handMesh();
  checkSkinned(h.geo, h.bones.length, 'hand');
  assert.equal(h.tips.length, 5);
  assert.equal(h.idx.meta.length, 5);
  assert.equal(h.idx.phal.length, 5);
  assert.equal(h.idx.phal[0].length, 2, 'the thumb has two phalanges');
  for (let f = 1; f < 5; f++) assert.equal(h.idx.phal[f].length, 3);
  // nails exist (aMark.x) on some vertices, not most
  const mark = h.geo.getAttribute('aMark').array as ArrayLike<number>;
  let nails = 0;
  for (let v = 0; v < h.geo.getAttribute('position').count; v++) if (mark[v * 4] > 0.5) nails++;
  assert.ok(nails > 30 && nails < h.geo.getAttribute('position').count * 0.15, `nails (${nails})`);
  // the rest pose reproduces the bind pose
  const rig = handRig(h);
  rig.reset();
  rig.update();
  finiteSkin(rig, 'hand rest');
  const pos = h.geo.getAttribute('position');
  for (let v = 0; v < pos.count; v += 97) {
    const p = skinPoint(rig, h.geo, v);
    assert.ok(Math.hypot(p[0] - pos.getX(v), p[1] - pos.getY(v), p[2] - pos.getZ(v)) < 1e-4, 'rest pose = bind pose');
  }
  // a fist: every fingertip comes closer to the palm
  const before = h.tips.map((t, f) => { const ph = h.idx.phal[f]; return rig.carry(ph[ph.length - 1], t, [0, 0, 0]).slice(); });
  for (let f = 1; f < 5; f++) for (const b of h.idx.phal[f]) rig.set(b, 1.3);
  rig.update();
  finiteSkin(rig, 'hand fist');
  for (let f = 1; f < 5; f++) {
    const ph = h.idx.phal[f];
    const after = rig.carry(ph[ph.length - 1], h.tips[f], [0, 0, 0]);
    const d0 = Math.hypot(before[f][0] - h.palm[0], before[f][1] - h.palm[1], before[f][2] - h.palm[2]);
    const d1 = Math.hypot(after[0] - h.palm[0], after[1] - h.palm[1], after[2] - h.palm[2]);
    assert.ok(d1 < d0 * 0.8, `finger ${f} curls toward the palm (${d0.toFixed(3)} → ${d1.toFixed(3)})`);
  }
});

test('creatures: every template body builds, stands on four feet, looks out of two eyes, morphs good and cruel', () => {
  for (const body of CREATURE_BODIES) {
    const c = creatureMesh(body, { fat: 0.5, strong: 0.5, spiky: 0 });
    checkSkinned(c.geo, c.bones.length, body);
    assert.equal(c.body, body);
    assert.equal(c.feet.length, 4, `${body}: four feet`);
    assert.equal(c.b.legs.length, 4, `${body}: four legs`);
    for (const l of c.b.legs) assert.equal(l.length, 3, `${body}: upper, lower, foot`);
    for (const f of c.feet) assert.ok(f[1] < 0.12, `${body}: feet on the ground (${f[1].toFixed(3)})`);
    assert.equal(c.eyes.length, 2, `${body}: two eyes`);
    // the eyes are in the head, above the feet, facing forward (+z) of the body's middle
    for (const e of c.eyes) assert.ok(e[1] > 0.3 && e[2] > 0, `${body}: eye placed (${e.map((x) => x.toFixed(2))})`);
    assert.ok(c.length > 0.4 && c.stride > 0, `${body}: length and stride`);
    const rig = creatureRig(c);
    rig.update();
    finiteSkin(rig, `${body} rest`);
    // a wild pose stays finite
    for (let i = 0; i < rig.count; i++) rig.set(i, Math.sin(i * 1.7) * 0.9, Math.cos(i * 0.7) * 0.4, Math.sin(i) * 0.3);
    rig.rootR[0] = 0.3; rig.rootT[1] = 0.1;
    rig.update();
    finiteSkin(rig, `${body} posed`);
  }
  // good (fat) vs cruel (spiky): spines appear, the body leans out
  const extent = (geo: BufferGeometry) => {
    const p = geo.getAttribute('position');
    let s = 0;
    for (let v = 0; v < p.count; v++) s += Math.abs(p.getX(v));
    return s / p.count;
  };
  for (const body of ['wolf', 'ape'] as const) {
    const good = creatureMesh(body, { fat: 1, strong: 0.5, spiky: 0 });
    const cruel = creatureMesh(body, { fat: 0, strong: 0.5, spiky: 1 });
    const regions = (geo: BufferGeometry) => { const m = geo.getAttribute('aMark').array as ArrayLike<number>; let n = 0; for (let v = 0; v < geo.getAttribute('position').count; v++) if (Math.round(m[v * 4 + 1]) === 5) n++; return n; };
    assert.equal(regions(good.geo), 0, `${body}: no spines when good`);
    assert.ok(regions(cruel.geo) > 20, `${body}: spines when cruel (${regions(cruel.geo)})`);
    assert.ok(extent(cruel.geo) < extent(good.geo), `${body}: the cruel build is leaner`);
    // cached by quantised morph
    assert.equal(creatureMesh(body, { fat: 0.99, strong: 0.52, spiky: 0.01 }), good);
  }
});
