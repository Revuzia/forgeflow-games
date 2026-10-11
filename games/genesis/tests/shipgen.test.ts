// GENESIS — the ship generator and the space-age buildings (render lane, phase 4b), without a GPU:
//   * every ship kind builds in every form and era: finite geometry, the kit attribute layout, within WebGL2's
//     attribute budget; each era's rocket is its own (gunpowder tube, riveted electric two-stager, white multi-stage);
//   * a space-age launcher stacks stages (engines on the first stage, separation planes rising), has umbilicals for the
//     pad rig and an escape tower; its lander has legs that swing on hinges; the orbiter's fairing comes off in halves;
//     the generation ship's ring turns about the spine; airship props spin; sails are cloth;
//   * the star gate's horizon (ship) sits exactly in the gate building's ring;
//   * the airship mast, the habitat dome and the star gate build as buildings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERA, GATE_CENTRE_Y, GATE_RADIUS, SPART, shipModel, shapeFor, vesselSails, type ShipModel } from '../src/render/gen/shipgen.ts';
import { buildingMesh, type BuildingSpec } from '../src/render/gen/buildinggen.ts';
import { materials, BUILDING_KINDS } from '../src/render/life/catalog.ts';
import { PART } from '../src/render/gen/meshkit.ts';

const KINDS = ['raft', 'boat', 'sailship', 'airship', 'rocket', 'orbiter', 'generation-ship', 'gate'];
const FORMS = ['launch', 'space', 'lander'] as const;
const ERAS = ['iron', 'gunpowder', 'steam', 'electric', 'space', 'future'];

function finite(m: ShipModel, what: string): void {
  assert.ok(m.parts.length > 0, `${what}: has parts`);
  for (const p of m.parts) {
    const pos = p.geo.getAttribute('position');
    assert.ok(pos && pos.count > 0, `${what}/${p.name}: geometry`);
    for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]), `${what}/${p.name}: finite`);
    assert.ok(p.geo.getAttribute('normal'), `${what}/${p.name}: normals (no flat-shaded fallback)`);
    assert.ok(p.geo.getAttribute('aKit'), `${what}/${p.name}: the kit attribute`);
    assert.ok(Object.keys(p.geo.attributes).length <= 12, `${what}/${p.name}: attribute budget`);
  }
  assert.ok(m.height > 0 && Number.isFinite(m.height) && m.radius > 0, `${what}: size`);
}

test('every ship kind builds in every form and era', () => {
  for (const kind of KINDS) for (const form of FORMS) for (const era of ERAS) finite(shipModel(kind, era, form, 2), `${kind}/${form}/${era}`);
});

test('rockets differ by era: a gunpowder tube, a riveted electric two-stager, a white space-age stack', () => {
  const gp = shipModel('rocket', 'gunpowder'), el = shipModel('rocket', 'electric'), sp = shipModel('rocket', 'space');
  assert.ok(gp.height < el.height && el.height < sp.height, `heights grow: ${gp.height} < ${el.height} < ${sp.height}`);
  assert.ok(el.stageTops.length >= 1 && sp.stageTops.length >= 2, 'the electric rocket stages once, the space-age one twice or more');
  // the space-age first stage: a cluster of engines at the base, a vacuum engine above the interstage
  const first = sp.engines.filter((e) => e.stage === 0), upper = sp.engines.filter((e) => e.stage > 0);
  assert.ok(first.length >= 3, `${first.length} first-stage engines`);
  assert.ok(upper.some((e) => e.vacuum), 'a vacuum engine up the stack');
  for (const e of first) assert.ok(e.pos[1] < 1, 'first-stage engines at the base');
  for (let i = 1; i < sp.stageTops.length; i++) assert.ok(sp.stageTops[i] > sp.stageTops[i - 1], 'separation planes rise');
  assert.ok(sp.umbilicals.length >= 2, 'umbilicals for the gantry arms');
  assert.ok(sp.parts.some((p) => p.role === 'tower'), 'an escape tower');
  assert.ok(sp.parts.some((p) => p.role === 'stage' && p.stage === 0), 'a jettisonable first stage');
  assert.ok(sp.parts.some((p) => p.role === 'static' || p.stage === -1), 'the ship proper');
});

test('the lander has hinged legs; the orbiter fairing comes off in halves; the ark ring turns; props spin; sails are cloth', () => {
  const lander = shipModel('rocket', 'space', 'lander');
  const legs = lander.parts.filter((p) => p.role === 'leg');
  assert.ok(legs.length >= 3, `${legs.length} legs`);
  for (const l of legs) assert.ok(Math.hypot(l.axis[0], l.axis[1], l.axis[2]) > 0.9, `${l.name}: a hinge axis`);
  const orb = shipModel('orbiter', 'space', 'launch');
  const fair = orb.parts.filter((p) => p.role === 'fairing');
  assert.equal(fair.length, 2, 'two fairing halves');
  assert.ok(orb.fairingBase > 0, 'a fairing base');
  const ark = shipModel('generation-ship', 'space', 'space');
  const ring = ark.parts.find((p) => p.role === 'ring');
  assert.ok(ring, 'the ark has a ring');
  assert.ok(Math.abs(ring!.axis[1]) > 0.9, 'the ring turns about the spine');
  const air = shipModel('airship', 'steam');
  assert.ok(air.parts.filter((p) => p.role === 'prop').length >= 2, 'airship props');
  for (const era of ['iron', 'gunpowder', 'steam']) {
    const ship = shipModel('sailship', era);
    const sails = ship.parts.filter((p) => p.cloth);
    assert.ok(sails.length > 0, `${era}: cloth sails`);
    for (const p of sails) {
      const uv = p.geo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        assert.ok(uv.getX(i) >= -1.001 && uv.getX(i) <= 1.001 && uv.getY(i) >= -0.001 && uv.getY(i) <= 1.001, `${era}: sail uv in the cloth's range`);
      }
      const kit = p.geo.getAttribute('aKit');
      let anyDepth = false;
      for (let i = 0; i < kit.count; i++) if (kit.getW(i) > 0) anyDepth = true;
      assert.ok(anyDepth, `${era}: the sail has a belly depth`);
    }
  }
  assert.ok(vesselSails('sail'), 'a sail boat\'s cloth for the boats people ride');
  assert.equal(shapeFor('rocket', ERA.space, 'lander'), 'lander');
  assert.equal(shapeFor('orbiter', ERA.space, 'space'), 'satellite');
  assert.equal(shapeFor('generation-ship', ERA.space, 'lander'), 'ark-lander');
});

test('the gate\'s horizon sits in the star gate building\'s ring, and the space-age buildings build', () => {
  const gate = shipModel('gate', 'future');
  const portal = gate.parts.find((p) => p.role === 'portal');
  assert.ok(portal, 'a portal part');
  portal!.geo.computeBoundingBox();
  const bb = portal!.geo.boundingBox!;
  const cy = (bb.min.y + bb.max.y) / 2, ry = (bb.max.y - bb.min.y) / 2;
  assert.ok(Math.abs(cy - GATE_CENTRE_Y) < 0.6, `horizon centre ${cy.toFixed(2)} vs ${GATE_CENTRE_Y}`);
  assert.ok(ry <= GATE_RADIUS + 0.2 && ry > GATE_RADIUS * 0.8, `horizon radius ${ry.toFixed(2)} vs ${GATE_RADIUS}`);
  const mat = materials().find((m) => m.id === 'stone')!;
  for (const kind of ['airship-mast', 'habitat-dome', 'star-gate'] as const) {
    assert.ok((BUILDING_KINDS as readonly string[]).includes(kind), `${kind} is a building kind`);
    const spec = { kind, mat, style: 1, era: 10, mood: 0, w: 14, d: 14, lod: 0 } as BuildingSpec;
    const b = buildingMesh(spec);
    const pos = b.geo.getAttribute('position');
    assert.ok(pos.count > 100, `${kind}: geometry`);
    for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]), `${kind}: finite`);
    assert.ok(b.height > 5, `${kind}: height ${b.height}`);
  }
  // the gate's ring encloses the horizon: the building's chevrons glow (beacons)
  const sg = buildingMesh({ kind: 'star-gate', mat, style: 1, era: 10, mood: 0, w: 14, d: 14, lod: 0 } as BuildingSpec);
  const kit = sg.geo.getAttribute('aKit');
  let beacons = 0;
  for (let i = 0; i < kit.count; i++) if (kit.getY(i) === PART.beacon) beacons++;
  assert.ok(beacons > 0, 'chevrons');
  assert.ok(sg.height > GATE_CENTRE_Y + GATE_RADIUS * 0.9, `the ring stands ${sg.height.toFixed(1)} m`);
  void SPART;
});
