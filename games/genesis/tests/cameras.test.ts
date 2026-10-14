// GENESIS — the camera modes (render/camera/**, CONTRACT.md §15.8), without a GPU, on the real sim's small sandbox world
// through the WorldView, driven the way the interface and the test surface drive them (rig.modes):
//   * walking in the god's body keeps the feet on the curved ground (and the eye above it), walks at its pace, jumps
//     and comes down, and the people near it see it: the onSeen hook fires and the sim's 'god.seen' takes it;
//   * the body's look follows how the people see the god (HandView.regard, else alignment) unless a shot pins it —
//     warm light when trusted, cold when feared;
//   * the rig publishes its mode (CAMERA_NOW): rain beads on the lens of an eye on the ground, never a god's camera;
//   * follow keeps a person framed, above the ground, looking at them;
//   * the dolly is a crane move: above the ground, high and wide at its ends, low over the middle, aimed at the place;
//   * photo mode from a stand-off aims at the thing; the lens rolls the frame;
//   * switching modes blends from the last pose (no cut unless asked);
//   * quality presets only trade cost (the same switches on every preset), Cinematic adds the fine lens, and the
//     detection never picks Cinematic and sends software rasterisers to Low.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Command, EntityRef, UnitVec } from '../src/sim/types.ts';
import { WorldView, type PlanetView } from '../src/client/worldview.ts';
import { qRotate, qRotateInv, type D3 } from '../src/client/orbits.ts';
import { CameraRig } from '../src/render/camera/rig.ts';
import { newInput, surfaceRadius, type InputState } from '../src/render/camera/common.ts';
import { AVATAR_STATE, regardColour } from '../src/render/camera/avatar.ts';
import { CAMERA_NOW } from '../src/render/camera/common.ts';
import { PHOTO } from '../src/render/camera/photo.ts';
import type { SeenEvent } from '../src/render/camera/walk.ts';
import { QUALITY, QUALITY_NAMES, detectQuality } from '../src/render/quality.ts';

const DEG = Math.PI / 180;

class World {
  readonly sim: Sim;
  readonly view = new WorldView();
  readonly rig = new CameraRig();
  readonly input: InputState = newInput();
  ms = 0;
  constructor() {
    this.sim = new Sim({ seed: 5, scenario: 'sandbox', overrides: { n: 16 } });
    this.snap(true);
  }
  snap(full = false): void {
    this.view.apply(this.sim.snapshot({ full }), this.ms);
    this.view.updateBodies(this.sim.u.tick);
    this.view.renderTick = this.sim.u.tick;
  }
  get pv(): PlanetView { return this.view.planets[0]; }
  must(c: Command): void { const r = this.sim.applyNow(c); assert.ok(r.ok, `${c.k}: ${r.msg}`); }
  /** n frames of dt seconds (the world held still: the camera's own motion) */
  frames(n: number, dt = 1 / 30): void {
    for (let i = 0; i < n; i++) {
      this.ms += dt * 1000;
      this.rig.update(dt, this.view, this.input);
      this.input.dragL = [0, 0]; this.input.dragR = [0, 0]; this.input.wheel = 0;
    }
  }
  /** the camera in the planet's body frame: eye (m) and its forward and up */
  eye(): { pos: D3; fwd: D3; up: D3 } {
    const pv = this.pv, p = this.rig.pose;
    const pos = qRotateInv(pv.quat, [p.pos[0] - pv.center[0], p.pos[1] - pv.center[1], p.pos[2] - pv.center[2]]);
    const fwd = qRotateInv(pv.quat, qRotate(p.quat, [0, 0, -1]));
    const up = qRotateInv(pv.quat, qRotate(p.quat, [0, 1, 0]));
    return { pos, fwd, up };
  }
  /** a dry place on the world (the ground well above the sea), as lat / lon degrees and its unit vector */
  dryPlace(): { lat: number; lon: number; u: UnitVec } {
    const pv = this.pv, g = pv.grid, W = pv.fields.get('water');
    let best = 0, bs = -Infinity;
    for (let c = 0; c < g.count; c++) {
      const y = g.pos[c * 3 + 1];
      const s = (W ? -W[c] * 10 : 0) - Math.abs(y) * 50 + (W && W[c] < 0.01 ? 100 : 0);
      if (s > bs) { bs = s; best = c; }
    }
    const u: UnitVec = [g.pos[best * 3], g.pos[best * 3 + 1], g.pos[best * 3 + 2]];
    return { lat: Math.asin(u[1]) / DEG, lon: Math.atan2(u[0], u[2]) / DEG, u };
  }
}

const len = (v: ArrayLike<number>): number => Math.hypot(v[0], v[1], v[2]);
const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: ArrayLike<number>): D3 => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): D3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

test('walking in the god\'s body: feet on the curved ground, the pace, a jump, and the people see it', () => {
  const w = new World();
  const at = w.dryPlace();
  w.must({ k: 'life.spawn-people', species: 'plains-folk', count: 12, pos: at.u } as Command);
  w.sim.step(2);
  w.snap(true);
  const seen: SeenEvent[] = [];
  w.rig.modes.onSeen = (e) => seen.push(e);
  w.rig.modes.applySpec({ mode: 'walk', planet: w.pv.id, lat: at.lat, lon: at.lon, yaw: 30, alignment: 0.8 }, w.view);
  w.frames(3);
  assert.equal(w.rig.mode, 'walk');
  assert.ok(AVATAR_STATE.active && AVATAR_STATE.visible, 'the body is drawn (third person)');
  const start = AVATAR_STATE.pos.clone();
  const ground = (p: { x: number; y: number; z: number }): number => { const l = Math.hypot(p.x, p.y, p.z); return w.view.groundRadius(w.pv, p.x / l, p.y / l, p.z / l); };
  assert.ok(Math.abs(start.length() - ground(start)) < 0.05, `feet on the ground: ${(start.length() - ground(start)).toFixed(3)} m`);
  // two seconds of W: about the walking pace along the ground, the feet on it all the way, the eye above it
  w.input.keys.add('KeyW');
  for (let i = 0; i < 60; i++) {
    w.frames(1);
    const p = AVATAR_STATE.pos;
    assert.ok(Math.abs(p.length() - ground(p)) < 0.05, `frame ${i}: feet ${(p.length() - ground(p)).toFixed(3)} m off the ground`);
    const e = w.eye();
    assert.ok(len(e.pos) > surfaceRadius(w.pv, unit(e.pos)) + 0.3, `frame ${i}: the eye above the ground`);
  }
  w.input.keys.delete('KeyW');
  const moved = Math.acos(Math.min(1, dot(unit([start.x, start.y, start.z]), unit([AVATAR_STATE.pos.x, AVATAR_STATE.pos.y, AVATAR_STATE.pos.z])))) * w.pv.params.radius;
  assert.ok(moved > 2.6 && moved < 4.4, `walked ${moved.toFixed(2)} m in 2 s at 1.8 m/s`);
  // the body faces the way it went
  const dirMoved = unit(sub([AVATAR_STATE.pos.x, AVATAR_STATE.pos.y, AVATAR_STATE.pos.z], [start.x, start.y, start.z]));
  assert.ok(dot([AVATAR_STATE.fwd.x, AVATAR_STATE.fwd.y, AVATAR_STATE.fwd.z], dirMoved) > 0.8, 'the body turned toward where it walked');
  // a jump: up, then down again
  w.input.keys.add('KeyR');
  w.frames(3);
  w.input.keys.delete('KeyR');
  w.frames(6);
  assert.ok(AVATAR_STATE.lift > 0.3, `in the air: ${AVATAR_STATE.lift.toFixed(2)} m`);
  w.frames(90);
  assert.ok(AVATAR_STATE.lift < 0.01, `came down: ${AVATAR_STATE.lift.toFixed(3)} m`);
  // the people near it saw it, and the sim takes the sighting
  assert.ok(seen.length >= 1, 'onSeen fired among the people');
  const e = seen[seen.length - 1];
  const r = w.sim.applyNow({ k: 'god.seen', planet: e.planet, pos: e.pos, radius: e.radius } as Command);
  assert.ok(r.ok && /sees? you walk among them/.test(r.msg ?? ''), `god.seen: ${r.msg}`);
  // the wheel all the way in: first person, the body no longer drawn, the eye at head height
  w.input.wheel = -6000;
  w.frames(2);
  assert.ok(!AVATAR_STATE.visible, 'first person hides the body');
  const head = len(w.eye().pos) - ground(AVATAR_STATE.pos);
  assert.ok(head > 1.6 && head < 2.4, `eye at head height: ${head.toFixed(2)} m`);
  // leaving puts the body away
  w.rig.modes.walk(null);
  w.frames(2);
  assert.ok(!AVATAR_STATE.active, 'the body is gone when the walk ends');
});

test('the body shows the god\'s record unless a shot pins it', () => {
  const w = new World();
  const at = w.dryPlace();
  w.rig.modes.walk({ planet: w.pv.id, at: at.u, heading: 0 });
  w.view.hand = { planet: w.pv.id, pos: at.u, alt: 8, held: null, pose: 'open', alignment: -0.9 };
  w.frames(90);
  assert.ok(AVATAR_STATE.alignment < -0.7, `a feared god's body: ${AVATAR_STATE.alignment.toFixed(2)}`);
  // the regard, when the sim sends it, wins over the old alignment field
  w.view.hand = { planet: w.pv.id, pos: at.u, alt: 8, held: null, pose: 'open', alignment: -0.9, regard: 0.8 };
  w.frames(120);
  assert.ok(AVATAR_STATE.alignment > 0.6, `the regard: ${AVATAR_STATE.alignment.toFixed(2)}`);
  w.rig.modes.applySpec({ mode: 'walk', planet: w.pv.id, lat: at.lat, lon: at.lon, alignment: 0.7 }, w.view);
  w.frames(2);
  assert.ok(Math.abs(AVATAR_STATE.alignment - 0.7) < 0.02, `pinned by the shot: ${AVATAR_STATE.alignment.toFixed(2)}`);
  w.rig.modes.walk(null);
  w.frames(1);
  // trusted: warm light (red over blue); feared: cold (blue over red)
  const warm = regardColour(1), cold = regardColour(-1);
  assert.ok(warm[0] > warm[2] && cold[2] > cold[0], `warm ${warm.map((v) => v.toFixed(2))}, cold ${cold.map((v) => v.toFixed(2))}`);
});

test('the rig publishes its mode for the effects of an eye on the ground', () => {
  const w = new World();
  const at = w.dryPlace();
  w.frames(2);
  assert.equal(CAMERA_NOW.mode, 'orbit');
  w.rig.modes.walk({ planet: w.pv.id, at: at.u, heading: 0 });
  w.frames(2);
  assert.equal(CAMERA_NOW.mode, 'walk');
  w.rig.modes.walk(null);
  w.frames(2);
  assert.notEqual(CAMERA_NOW.mode, 'walk');
});

test('follow keeps a person framed from above the ground', () => {
  const w = new World();
  const at = w.dryPlace();
  w.must({ k: 'life.spawn-people', species: 'plains-folk', count: 6, pos: at.u } as Command);
  w.sim.step(2);
  w.snap(true);
  const A = w.pv.agents!;
  assert.ok(A.count > 0, 'people to follow');
  const ref: EntityRef = { kind: 'agent', id: A.id[0], planet: w.pv.id };
  w.rig.modes.follow(ref);
  w.frames(90);
  assert.equal(w.rig.mode, 'follow');
  const s = w.rig.followCam.subject();
  assert.ok(s, 'the subject resolves');
  const e = w.eye();
  const toSubject = sub(s!.pos, e.pos);
  const d = len(toSubject);
  assert.ok(d > 3 && d < 40, `framed from ${d.toFixed(1)} m`);
  assert.ok(dot(unit(toSubject), e.fwd) > 0.9, 'looking at them');
  assert.ok(len(e.pos) > surfaceRadius(w.pv, unit(e.pos)) + 1, 'the eye above the ground');
  assert.ok(dot(e.up, unit(e.pos)) > 0.5, 'the horizon level (up is up)');
});

test('the dolly: a crane move over the place, wide at the ends and low over the middle, always aimed at it', () => {
  const w = new World();
  const at = w.dryPlace();
  const heights: number[] = [], fovs: number[] = [];
  const place = (() => { const g = w.view.groundRadius(w.pv, at.u[0], at.u[1], at.u[2]); return [at.u[0] * g, at.u[1] * g, at.u[2] * g] as D3; })();
  for (const t of [0, 0.5, 1]) {
    w.rig.modes.applySpec({ mode: 'dolly', planet: w.pv.id, lat: at.lat, lon: at.lon, yaw: 20, radius: 120, t }, w.view);
    w.frames(30);
    const e = w.eye();
    heights.push(len(e.pos) - surfaceRadius(w.pv, unit(e.pos)));
    fovs.push(w.rig.pose.fov);
    assert.ok(dot(unit(sub(place, e.pos)), e.fwd) > 0.85, `t ${t}: aimed at the place`);
    assert.ok(dot(e.up, unit(e.pos)) > 0.5, `t ${t}: level`);
  }
  assert.ok(heights.every((h) => h > 5), `above the ground: ${heights.map((h) => h.toFixed(0))}`);
  assert.ok(heights[1] < heights[0] && heights[1] < heights[2], `swoops low over the middle: ${heights.map((h) => h.toFixed(0))}`);
  assert.ok(fovs[1] < fovs[0], 'a longer lens over the middle');
  // a drag hands the camera back to the player (the orbit)
  w.rig.modes.applySpec({ mode: 'dolly', planet: w.pv.id, lat: at.lat, lon: at.lon, radius: 120 }, w.view);
  w.frames(2);
  w.input.dragL = [12, 0];
  w.frames(3);
  assert.equal(w.rig.mode, 'orbit');
});

test('photo mode from a stand-off aims at the thing, and the lens rolls the frame', () => {
  const w = new World();
  const at = w.dryPlace();
  w.must({ k: 'life.spawn-people', species: 'plains-folk', count: 4, pos: at.u } as Command);
  w.sim.step(2);
  w.snap(true);
  const A = w.pv.agents!;
  const ref: EntityRef = { kind: 'agent', id: A.id[0], planet: w.pv.id };
  w.rig.modes.applySpec({ mode: 'photo', planet: w.pv.id, lat: at.lat, lon: at.lon, target: ref, dist: 60, yaw: 45, alt: 3, roll: 0, fov: 40 }, w.view);
  w.frames(3);
  assert.equal(w.rig.mode, 'photo');
  assert.ok(PHOTO.on, 'the lens is on');
  const u = [A.pos[0], A.pos[1], A.pos[2]] as D3;
  const g = w.view.groundRadius(w.pv, ...unit(u));
  const T: D3 = unit(u).map((x) => x * (g + 1)) as D3;
  const e = w.eye();
  const toT = sub(T, e.pos);
  assert.ok(len(toT) > 45 && len(toT) < 75, `stands ${len(toT).toFixed(1)} m off`);
  assert.ok(dot(unit(toT), e.fwd) > 0.995, `aimed at it: ${dot(unit(toT), e.fwd).toFixed(4)}`);
  const level = dot(e.up, unit(e.pos));
  w.rig.modes.lens({ ...PHOTO.lens, roll: 20 });
  w.frames(2);
  const rolled = dot(w.eye().up, unit(w.eye().pos));
  assert.ok(rolled < level - 0.03, `the frame rolled: ${level.toFixed(3)} → ${rolled.toFixed(3)}`);
  w.rig.modes.photo(false);
  w.frames(2);
  assert.ok(!PHOTO.on && w.rig.mode !== 'photo', 'photo mode ends');
  // a shot's photo then a dolly: the lens's blur does not follow the camera into the dolly
  w.rig.modes.applySpec({ mode: 'photo', planet: w.pv.id, lat: at.lat, lon: at.lon, alt: 3, blur: 0.8, focus: 10 }, w.view);
  w.frames(1);
  w.rig.modes.applySpec({ mode: 'dolly', planet: w.pv.id, lat: at.lat, lon: at.lon, radius: 100, t: 0.3 }, w.view);
  w.frames(1);
  assert.ok(!PHOTO.on, 'the lens is photo mode\'s alone');
});

test('switching modes blends from the last pose; a blend of 0 cuts', () => {
  const w = new World();
  const at = w.dryPlace();
  w.rig.orbit.setFromLatLon(w.pv.id, at.lat, at.lon, 2500, 0, null);
  w.rig.use(w.rig.orbit, 0);
  w.frames(5);
  const far = len(w.eye().pos);
  w.rig.modes.walk({ planet: w.pv.id, at: at.u, heading: 0 });
  w.frames(14);
  const mid = len(w.eye().pos);
  w.frames(60);
  const near = len(w.eye().pos);
  assert.ok(far > mid && mid > near, `the eye comes down through the blend: ${far.toFixed(0)} > ${mid.toFixed(0)} > ${near.toFixed(0)}`);
  assert.ok(!w.rig.blending(), 'the blend ends');
  w.rig.modes.applySpec({ mode: 'dolly', planet: w.pv.id, lat: at.lat, lon: at.lon, radius: 100, t: 0.2, blend: 0 }, w.view);
  w.frames(1);
  assert.ok(!w.rig.blending(), 'blend 0 is a cut');
});

test('quality presets only trade cost; Cinematic adds the fine lens; detection is safe', () => {
  const keys = Object.keys(QUALITY.high).sort();
  for (const n of QUALITY_NAMES) assert.deepEqual(Object.keys(QUALITY[n]).sort(), keys, `${n}: the same switches`);
  const budget = QUALITY_NAMES.map((n) => QUALITY[n].particleBudget);
  for (let i = 1; i < budget.length; i++) assert.ok(budget[i] >= budget[i - 1], 'particles grow with the preset');
  assert.ok(QUALITY.cinematic.cloudSteps > QUALITY.ultra.cloudSteps && QUALITY.cinematic.dof && !QUALITY.high.dof, 'Cinematic: heavier clouds and the photo lens');
  assert.equal(detectQuality(null), 'low');
  const fake = (name: string) => ({
    getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 0x9246 }),
    getParameter: (p: number) => (p === 0x9246 ? name : 8192),
  }) as unknown as WebGL2RenderingContext;
  assert.equal(detectQuality(fake('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')), 'low');
});
