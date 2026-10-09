// GENESIS — body meshes face outward (phase-2 review, people: "legs visible through dresses", "a pale skin band at
// the waist", "belt hoops floating free"). The body material culls back faces, so a surface wound inside out is drawn
// only from within: every skirt, coat tail, hide wrap and dress was built waist-down and showed the legs and the bare
// seat through its near side. Each triangle's winding must agree with its own vertex normals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bipedMesh, birdMesh, fishMesh, quadMesh, BPART, STYLE, type BodyMesh } from '../src/render/gen/bodygen.ts';

const PART_NAME = Object.fromEntries(Object.entries(BPART).map(([k, v]) => [v, k]));

/** triangles per body part whose winding (a → b → c, counter-clockwise front) points against the mean vertex normal */
function inverted(m: BodyMesh): Map<string, [number, number]> {
  const pos = m.geo.getAttribute('position'), nrm = m.geo.getAttribute('normal'), rig = m.geo.getAttribute('aRig');
  const idx = m.geo.getIndex()!;
  const out = new Map<string, [number, number]>();
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a);
    const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a);
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (Math.hypot(gx, gy, gz) < 1e-12) continue;
    let nx = 0, ny = 0, nz = 0;
    for (const i of [a, b, c]) { nx += nrm.getX(i); ny += nrm.getY(i); nz += nrm.getZ(i); }
    const part = PART_NAME[rig.getW(a)] ?? String(rig.getW(a));
    const e = out.get(part) ?? [0, 0];
    e[1]++;
    if (gx * nx + gy * ny + gz * nz < 0) e[0]++;
    out.set(part, e);
  }
  return out;
}

test('people: clothing shells, skirts and dresses wind outward at every LOD', () => {
  for (const lod of [0, 1, 2]) for (const o of [{ furred: false, webbed: false }, { furred: true, webbed: true }]) {
    const bad = [...inverted(bipedMesh(lod, o))].filter(([, [n]]) => n > 0);
    assert.deepEqual(bad, [], `biped LOD ${lod} ${JSON.stringify(o)}: inside-out triangles ${JSON.stringify(bad)}`);
  }
});

test('people: skirts cover the seat — a skirt starts under the belt, outside the tunic, and its hem band moves with it', () => {
  const m = bipedMesh(0, { furred: false, webbed: false });
  const pos = m.geo.getAttribute('position'), rig = m.geo.getAttribute('aRig'), sel = m.geo.getAttribute('aSel');
  // tier-2 (dyed) clothing: skirt (cloth), hem band (cloth2) and belt (leather)
  const tier2 = (i: number) => (sel.getX(i) & STYLE.tier2) !== 0 && (sel.getY(i) & STYLE.tier2) === 0;
  let skirtTop = -1, beltLo = 9, beltHi = -1, hemMovesWithThigh = 0, hemN = 0;
  for (let i = 0; i < pos.count; i++) {
    if (!tier2(i)) continue;
    const part = rig.getW(i), y = pos.getY(i);
    if (part === BPART.cloth && (sel.getX(i) & (STYLE.tier1 | STYLE.tier3)) === 0) skirtTop = Math.max(skirtTop, y);
    if (part === BPART.leather && y > 0.85) { beltLo = Math.min(beltLo, y); beltHi = Math.max(beltHi, y); }
    if (part === BPART.cloth2 && y < 0.72 && (sel.getX(i) & STYLE.tier3) === 0) { hemN++; if (rig.getZ(i) < 0.999) hemMovesWithThigh++; }
  }
  assert.ok(skirtTop > beltLo + 0.005 && skirtTop < beltHi, `skirt top ${skirtTop.toFixed(3)} tucked under the belt ${beltLo.toFixed(3)}–${beltHi.toFixed(3)}`);
  assert.ok(hemN > 0 && hemMovesWithThigh > hemN * 0.5, `the hem band is weighted to the thighs like the skirt (${hemMovesWithThigh}/${hemN})`);
});

test('animals: bodies wind outward', () => {
  for (const f of ['deer', 'cattle', 'sheep', 'wolf'] as const) {
    const bad = [...inverted(quadMesh(f as never, 0))].filter(([, [n]]) => n > 0);
    assert.deepEqual(bad, [], `${f}: ${JSON.stringify(bad)}`);
  }
  for (const [name, m] of [['bird', birdMesh(0, false)], ['gull', birdMesh(0, true)], ['fish', fishMesh(0, false)]] as [string, BodyMesh][]) {
    const bad = [...inverted(m)].filter(([, [n]]) => n > 0);
    assert.deepEqual(bad, [], `${name}: ${JSON.stringify(bad)}`);
  }
});
