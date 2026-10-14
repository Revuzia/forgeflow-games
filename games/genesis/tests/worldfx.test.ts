// GENESIS — world events drawn (render/fx/worlds.ts), without a GPU: the sim's own world commands on a small world,
// through the WorldView, into the world-event layer:
//   * a cracked world gets its debris ring (instanced rocks in its equatorial frame, still hot) and its fissures
//     (on the planet's own group, drawn in the overlay pass);
//   * a falling moon heaps the host's sea toward it (the ocean's uTide), breaks up inside the Roche limit in its last
//     hours (fractures, rubble streams, burning pieces); when it strikes it is a strike (flash, shock, ejecta at the
//     point of contact), not an erasure;
//   * an erased world collapses where it was; a born one
//     gathers out of its swirl;
//   * a whole new universe (a load) is neither: no bursts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Quaternion, Scene, Vector4, type IUniform } from 'three';
import { Sim } from '../src/sim/sim.ts';
import type { Command } from '../src/sim/types.ts';
import { WorldView } from '../src/client/worldview.ts';
import { makePlanetUniforms } from '../src/render/planet/terrainmat.ts';
import { WorldFx, WORLD_LAYER, type WorldPlanetRef } from '../src/render/fx/worlds.ts';
import type { CameraPose } from '../src/render/frame.ts';

function world(): { sim: Sim; view: WorldView } {
  const sim = new Sim({ seed: 2, scenario: 'sandbox', overrides: { n: 12 } });
  const view = new WorldView();
  view.apply(sim.snapshot({ full: true }), 0);
  view.updateBodies(sim.u.tick);
  return { sim, view };
}

function must(sim: Sim, c: Command): void {
  const r = sim.applyNow(c);
  assert.ok(r.ok, `${c.k}: ${r.msg}`);
}

class Harness {
  readonly fx = new WorldFx();
  readonly scene = new Scene();
  readonly refs = new Map<number, WorldPlanetRef>();
  readonly pose: CameraPose = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fov: 50, planet: 0 };
  time = 0;
  readonly sim: Sim;
  readonly view: WorldView;
  constructor(sim: Sim, view: WorldView) { this.sim = sim; this.view = view; }
  /** a snapshot to the view, then a frame of the layer (the camera 4 radii off the first world) */
  frame(full = false, dtTicks = 0): void {
    if (dtTicks) this.sim.step(dtTicks);
    this.view.apply(this.sim.snapshot({ full }), this.time * 1000);
    this.view.updateBodies(this.sim.u.tick);
    this.view.renderTick = this.sim.u.tick;
    for (const pv of this.view.planets) {
      if (!this.refs.has(pv.id)) this.refs.set(pv.id, { group: new Group(), uniforms: makePlanetUniforms() as unknown as Record<string, IUniform>, pv });
      this.refs.get(pv.id)!.pv = pv;
    }
    for (const id of [...this.refs.keys()]) if (!this.view.planet(id)) this.refs.delete(id);
    const p0 = this.view.planets[0];
    this.pose.pos = [p0.center[0] + p0.params.radius * 4, p0.center[1], p0.center[2]];
    this.time += 0.1;
    this.fx.update(this.view, this.pose, this.refs, this.scene, this.time, new Quaternion());
  }
}

test('a cracked world: a hot debris ring in its equator and glowing fissures on its ground', () => {
  const { sim, view } = world();
  const h = new Harness(sim, view);
  h.frame(true); h.frame(); h.frame();
  assert.equal(h.fx.stats().rings, 0);
  must(sim, { k: 'world.crack', world: 0 });
  h.frame(true);
  const s = h.fx.stats();
  assert.equal(s.rings, 1, 'a ring');
  assert.equal(s.cracks, 1, 'fissures');
  const ring = h.scene.getObjectByName('ring-frame-0');
  assert.ok(ring, 'the ring frame is in the scene');
  let rocks = 0, heat = 0;
  ring!.traverse((o) => { const m = o as unknown as { isInstancedMesh?: boolean; count: number; material: { uniforms: Record<string, IUniform> } }; if (m.isInstancedMesh) { rocks += m.count; heat = m.material.uniforms.uHeat.value as number; } });
  assert.ok(rocks >= 300, `${rocks} rocks`);
  assert.ok(heat > 0.5, `fresh rubble glows (${heat})`);
  const fis = h.refs.get(0)!.group.getObjectByName('fissures');
  assert.ok(fis, 'fissures on the planet group');
  assert.ok(fis!.layers.isEnabled(WORLD_LAYER), 'drawn in the overlay pass');
  // the moonlets the crack threw off are worlds of their own: they are not "born" with a swirl
  const kinds = (h.fx.detail().bursts as { kind: string }[]).map((b) => b.kind);
  assert.ok(kinds.every((k) => k === 'birth'), `only births: ${kinds}`);
});

test('a falling moon heaps the sea toward it, burns as it comes down, and strikes', () => {
  const { sim, view } = world();
  const h = new Harness(sim, view);
  h.frame(true); h.frame(); h.frame();
  must(sim, { k: 'world.moon-fall', world: 0 });
  h.frame(true, 4);
  const tide = h.refs.get(0)!.uniforms.uTide.value as Vector4;
  assert.ok(tide.w > 0.3, `a tide (${tide.w.toFixed(2)} m)`);
  // toward the moon, in the host's body frame
  const pv = view.planet(0)!, moon = view.planet(1)!;
  const d = [moon.center[0] - pv.center[0], moon.center[1] - pv.center[1], moon.center[2] - pv.center[2]];
  const q = new Quaternion(pv.quat[0], pv.quat[1], pv.quat[2], pv.quat[3]).invert();
  const v = new Vector4(d[0], d[1], d[2], 0);
  const b = { x: v.x, y: v.y, z: v.z };
  const l = Math.hypot(b.x, b.y, b.z);
  const dir = new Quaternion(b.x / l, b.y / l, b.z / l, 0);
  const bd = q.clone().multiply(dir).multiply(q.clone().invert());
  assert.ok(Math.abs(bd.x * tide.x + bd.y * tide.y + bd.z * tide.z) > 0.98, 'the bulge points at the moon');
  // late in the fall, inside the Roche limit, the moon breaks up: it stays a grey moon (no burning face) split by
  // fractures, shedding streams of rubble whose leading pieces sink into the air and burn
  const life = (sim.u.god.disasters.find((x) => x.kind === 'moon-fall')?.life ?? 4320);
  let broken = 0, burning = 0, fractured = false;
  for (let i = 0; i < 39 && burning === 0; i++) {
    h.frame(false, Math.ceil(life / 40));
    const det = h.fx.detail();
    const br = (det.breaks as { b: number; burning: number }[])[0];
    const m = (det.moons as { face: { visible: boolean } }[])[0];
    if (br) { broken = Math.max(broken, br.b); burning = Math.max(burning, br.burning); }
    if (m && m.face.visible) fractured = true;
  }
  assert.ok(broken > 0.2, `the moon breaks up in its last hours (${broken})`);
  assert.ok(fractured, 'its face shows the fractures');
  assert.ok(burning > 0, 'pieces of it burn as they sink into the air');
  // it strikes: a strike at the point of contact, never an erasure
  const gone = () => { const m = view.planet(1); return !m || m.alive === false; };
  for (let i = 0; i < 12 && !gone(); i++) h.frame(true, Math.ceil(life / 40));
  h.frame(true);
  // (no deep-equal on a PlanetView: a failing diff of its typed arrays would eat the memory)
  assert.ok(gone(), 'the moon is gone');
  const kinds = (h.fx.detail().bursts as { kind: string }[]).map((x) => x.kind);
  assert.ok(kinds.includes('strike'), `a strike (${kinds})`);
  assert.ok(!kinds.includes('erase'), 'not an erasure');
});

test('an erased world collapses where it was; a born one gathers; a new universe is neither', () => {
  const { sim, view } = world();
  const h = new Harness(sim, view);
  h.frame(true); h.frame(); h.frame();
  must(sim, { k: 'world.erase', world: 1 });
  h.frame(true); h.frame(true);
  let kinds = (h.fx.detail().bursts as { kind: string }[]).map((x) => x.kind);
  assert.deepEqual(kinds, ['erase']);
  must(sim, { k: 'world.birth', kind: 'barren' });
  h.frame(true);
  kinds = (h.fx.detail().bursts as { kind: string }[]).map((x) => x.kind);
  assert.ok(kinds.includes('birth'), `a birth (${kinds})`);
  // a load: every world gone at once (and others in their place) is a new universe, not a massacre
  const other = new Sim({ seed: 77, scenario: 'sandbox', overrides: { n: 12 } });
  const before = (h.fx.detail().bursts as unknown[]).length;
  const swapped = new WorldView();
  swapped.apply(other.snapshot({ full: true }), 0);
  swapped.updateBodies(other.u.tick);
  for (const pv of swapped.planets) pv.id += 100;
  h.fx.update(swapped, h.pose, new Map(), h.scene, h.time + 0.1, new Quaternion());
  assert.equal((h.fx.detail().bursts as unknown[]).length, before, 'no erasures for a universe swapped out');
});
