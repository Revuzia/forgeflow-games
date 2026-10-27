// GENESIS — the god's presence, generated and drawn (render lane; LIVING §0.1.6–7, §3.4, §3.6, hooks H4–H8), without a
// GPU:
//   * the Touch's form (gen/handgen.ts): its look follows regard — warm daylight trusted, storm-dark and crackling
//     feared — monotonically; open, its mantle rides the whirl up from a wide foot on the ground; holding, it gathers
//     into a closed cradle round what it holds (every tuft near the cradle, on all sides of it, the crown left open),
//     the low tufts last; the cradle fits a person, a boulder, a tree; its geometry is well formed; a crackle's arc is a
//     connected jagged channel from one end to the other; nothing of it is a hand (no fingers, no palm, no rig)
//   * the Touch at work (render/hand.ts HandVisual, driven frame by frame as the renderer drives it): it appears where
//     the cursor is and goes when nothing calls it; it lifts a person (the cradle gathers round them, below the grip)
//     and lets go; hurled fast it leaves a trail; a rebuke is a downdraft that throws dust and a cold flash; casting, it
//     traces the miracle's sigil; feared it crackles (an arc struck at the moment nextCrackle names) under a gloom of
//     its storm on the land round it, by day and night, trusted never;
//     its shadow and its pool of light lie on the ground; a person it hurls is drawn flying by their own id (the
//     sim's 'thrown' event names the projectile, a different id sequence), never a stranger; what it hurls flies as it held it
//     (a tree as its own uprooted tree, upright as it left, end over end; a boulder at its mass's size)
//   * the creature is gone from the renderer: no creature layer or generator module ships
//   * the sigils (fx/sigils.ts): ONE glyph per sigil — the stroke the Touch traces and the miracle writes on the land
//     is the UI recogniser's own template, so the recogniser reads each drawn glyph back as its sigil; every power's
//     `sigil` has one; evenly sampled inside the unit box; none reads as one of the old gesture shapes (circle,
//     spiral, zigzag, triangle, V, square, star — a $1-style shape distance); an invented miracle draws the fallback;
//     a landed glyph (fx/sigilfx.ts) lies on the ground, or on the water over a lake or the sea, and its depth test's
//     slack grows with distance (the far terrain is drawn coarser: tested exactly, the glyph broke into dashes)
//   * the signs (render/signs): prophets and the Called are found by AgentFlag2, a sacred animal by its id or the old
//     id it replaced, the sim's events become sacred places and moments (an ordinary strike is no sign; a failed word
//     rings the town grey; a prophet the god turns from has their thread drawn up off them); the sea's
//     drawback before a tsunami (fx/drawback.ts) lies on the coast's shallows, on the ground, never inland
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Color, Group, Vector3, type BufferGeometry, type IUniform, type Mesh, type Object3D, type ShaderMaterial } from 'three';
import {
  CRADLE_ALPHA, TOUCH_N, bandGeometry, crackleArc, cradleOf, discGeometry, gathered, mantlePoint, moteGeometry, stripGeometry, touchLook,
  touchRng, tuftGeometry, vortexR, type VortexFrame,
} from '../src/render/gen/handgen.ts';
import * as handgen from '../src/render/gen/handgen.ts';
import { HandVisual, heldPropGeometry, type HandFrame } from '../src/render/hand.ts';
import { heldTrueSize } from '../src/render/fx/present.ts';
import { Flights } from '../src/render/fx/flights.ts';
import { ThrowFx } from '../src/render/fx/throwfx.ts';
import { Debris } from '../src/render/fx/meshfx.ts';
import { swapPropDepth } from '../src/render/fx/propmat.ts';
import type { FxCtx } from '../src/render/fx/disasters.ts';
import { FALLBACK_SIGIL, SIGIL_IDS, sigilOfDisaster, sigilOfMiracle, sigilStroke } from '../src/render/fx/sigils.ts';
import { SHAPES, Unistroke, type Pt } from '../src/ui/unistroke.ts';
import { BASE_PACK } from '../src/data/index.ts';
import { AgentFlag2, type EntityRef, type HandView, type ProjectileView } from '../src/sim/types.ts';
import { PLACE_LOOK, SignsLayer, animalIndex, markedPeople, type SignsFrame } from '../src/render/signs/signs.ts';
import { DRAWBACK_MAX, Drawback } from '../src/render/fx/drawback.ts';
import { SigilMarks, landTop } from '../src/render/fx/sigilfx.ts';
import { groundHeight } from '../src/sim/grid/surface.ts';
import type { Decal, DecalPass } from '../src/render/fx/decals.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';
import type { PlanetView } from '../src/client/worldview.ts';

const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test('the Touch looks as the people see the god: warm daylight trusted, storm-dark and crackling feared', () => {
  const trusted = touchLook(1), awed = touchLook(0), feared = touchLook(-1);
  // warm: red over blue when trusted; cold: blue over red when feared
  assert.ok(trusted.light[0] > trusted.light[2] + 0.4, `trusted light is warm (${trusted.light})`);
  assert.ok(feared.light[2] > feared.light[0] + 0.2, `feared light is cold (${feared.light})`);
  assert.ok(feared.dark > 0.85 && trusted.dark === 0 && awed.dark === 0, 'only the feared god is storm-dark');
  assert.ok(feared.cloud < 0.2 && trusted.cloud > 0.8, `slate storm vs sunlit cloud (${feared.cloud}, ${trusted.cloud})`);
  assert.ok(feared.crackle > 1 && feared.crackle < 3 && trusted.crackle === 0 && awed.crackle === 0, 'only a feared god crackles, now and then');
  // monotonic from feared to trusted: darkness and crackling fall, the cloud brightens, the light warms
  let prev = touchLook(-1);
  for (let r = -0.95; r <= 1.0001; r += 0.05) {
    const l = touchLook(r);
    assert.ok(l.dark <= prev.dark + 1e-9 && l.crackle <= prev.crackle + 1e-9 && l.cloud >= prev.cloud - 1e-9, `monotonic at ${r.toFixed(2)}`);
    assert.ok(l.light[0] - l.light[2] >= prev.light[0] - prev.light[2] - 1e-9, `warms at ${r.toFixed(2)}`);
    prev = l;
  }
  // out-of-range and missing regard are clamped, never NaN
  for (const r of [-7, 7, Number.NaN]) for (const v of [...touchLook(r).light, touchLook(r).dark]) assert.ok(Number.isFinite(v));
  assert.ok(lum(trusted.light) > 0.6, 'a trusted god gives real light');
});

function frame(grasp: number, held = 'rock', drawn = 2.5, L = 12): VortexFrame {
  // a vertical vortex at the north pole of a 3 km world, the grip 6 m up
  const R = 3000, hg = 6;
  const c = cradleOf(held, drawn, L);
  return {
    base: [0, R, 0], ax: [0, 1, 0], e1: [1, 0, 0], e2: [0, 0, 1], hg, L, rg: L * 0.85, rk: L * 0.36, spin: 1.3, flow: 7.7, grasp,
    c: [0, R + hg - c.drop, 0], cr: c.r, ch: c.h,
  };
}

test('open, the mantle rides a whirl up from a wide foot on the ground', () => {
  const f = frame(0);
  // the vortex is wide at the ground and narrow at the grip, flaring above it
  assert.ok(vortexR(f, 0, 0.5) > vortexR(f, f.hg, 0.5) * 1.8, 'wide foot, narrow grip');
  assert.ok(vortexR(f, f.hg + f.L, 0.5) > vortexR(f, f.hg, 0.5), 'it flares above the grip');
  const g = tuftGeometry();
  const seed = g.getAttribute('iSeed').array as ArrayLike<number>;
  const p = [0, 0, 0];
  let low = 0, wideLow = 0, maxH = 0;
  for (let i = 0; i < TOUCH_N.tufts; i++) {
    const env = mantlePoint(f, seed[i * 4], seed[i * 4 + 1], seed[i * 4 + 2], seed[i * 4 + 3], p);
    assert.ok(env >= 0 && env <= 1 && p.every(Number.isFinite), 'finite tuft');
    const h = p[1] - f.base[1], r = Math.hypot(p[0], p[2]);
    assert.ok(h >= -1e-6 && h <= f.hg + 0.9 * f.L + 1e-6, `tuft within the whirl (${h.toFixed(2)})`);
    maxH = Math.max(maxH, h);
    if (h < f.hg * 0.3) { low++; if (r > f.rk) wideLow++; }
  }
  assert.ok(low >= 8 && wideLow / low > 0.7, `the whirl reaches the ground wide (${wideLow}/${low})`);
  assert.ok(maxH > f.hg, 'and rises past the grip');
});

test('holding, the mantle gathers into a closed cradle round what it holds, the low tufts last', () => {
  for (const [kind, drawn] of [['rock', 2.6], ['agent', 1.8], ['tree', 12], ['building', 4.5]] as [string, number][]) {
    const f = frame(1, kind, drawn);
    const g = tuftGeometry();
    const seed = g.getAttribute('iSeed').array as ArrayLike<number>;
    const p = [0, 0, 0];
    const oct = new Set<number>();
    let below = 0, above = 0;
    for (let i = 0; i < TOUCH_N.tufts; i++) {
      const env = mantlePoint(f, seed[i * 4], seed[i * 4 + 1], seed[i * 4 + 2], seed[i * 4 + 3], p);
      assert.ok(Math.abs(env - CRADLE_ALPHA) < 1e-9, 'gathered tufts stay, lighter than the whirl\'s billows');
      const dx = (p[0] - f.c[0]) / f.cr, dy = (p[1] - f.c[1]) / f.ch, dz = (p[2] - f.c[2]) / f.cr;
      const d = Math.hypot(dx, dy, dz);
      assert.ok(d > 0.75 && d < 1.25, `${kind}: on the cradle's shell (${d.toFixed(2)})`);
      // the crown is left open for the light: no tuft right over the top
      assert.ok(dy < 0.88, `${kind}: crown open (${dy.toFixed(2)})`);
      oct.add((dx > 0 ? 1 : 0) + (dz > 0 ? 2 : 0) + (dy > 0 ? 4 : 0));
      if (dy < -0.3) below++; if (dy > 0.2) above++;
    }
    assert.equal(oct.size, 8, `${kind}: the cradle closes round it on every side`);
    assert.ok(below > 10 && above > 10, `${kind}: under and over it (${below}, ${above})`);
  }
  // the cradle is larger than what it holds and fits it
  for (const L of [4, 12, 40]) {
    const a = cradleOf('agent', 1.8, L), r = cradleOf('rock', 2.6, L), t = cradleOf('tree', 12, L);
    assert.ok(a.h > 0.9 && a.r > 0.5 && a.drop > 0, 'a person hangs inside it, below the grip');
    assert.ok(r.r > 1.3 && r.h > 1.3, 'a boulder inside');
    assert.ok(t.h > 6 && t.h > t.r * 0.8, 'a tree inside, the cradle tall');
  }
  // the gathering is staggered: at half grasp the high tufts are in, the low ones still out
  assert.ok(gathered(0.5, 0.95) > 0.6 && gathered(0.5, 0.05) < 0.3, 'low tufts come in last');
  assert.equal(gathered(0, 0.5), 0);
  assert.equal(gathered(1, 0), 1);
});

test('the Touch is drawn from well-formed strips, bands, discs and instanced tufts — nothing hand-shaped', () => {
  const check = (geo: BufferGeometry, what: string) => {
    const idx = geo.getIndex();
    assert.ok(idx && idx.count % 3 === 0, `${what}: triangles`);
    const n = geo.getAttribute('position')?.count ?? geo.getAttribute('corner').count;
    for (let i = 0; i < idx!.count; i++) assert.ok(idx!.getX(i) < n, `${what}: index in range`);
  };
  const strip = stripGeometry(TOUCH_N.arc, TOUCH_N.arcs);
  check(strip, 'arc strips');
  assert.equal(strip.getAttribute('aStrip').count, TOUCH_N.arc * 2 * TOUCH_N.arcs);
  check(bandGeometry(), 'wind bands');
  assert.equal(bandGeometry().getAttribute('aRib').count, TOUCH_N.ribs * TOUCH_N.rib * 2);
  check(discGeometry(14, 48), 'whorl disc');
  const mg = moteGeometry(), tg = tuftGeometry();
  check(mg, 'motes'); check(tg, 'tufts');
  assert.equal(mg.instanceCount, TOUCH_N.motes);
  assert.equal(tg.instanceCount, TOUCH_N.tufts);
  // the same Touch every time it appears (fixed seeds)
  assert.deepEqual(Array.from(tuftGeometry().getAttribute('iSeed').array), Array.from(tg.getAttribute('iSeed').array));
  // the old hand's skinned body is gone from the generator: no mesh, no rig, no fingers
  for (const k of ['handMesh', 'handRig', 'HAND_FINGERS']) assert.ok(!(k in handgen), `no ${k}`);
});

test('a feared god crackles: each arc is one jagged channel from its start to its end', () => {
  const rnd = touchRng(42);
  const a = [0, 3006, 0], b = [9, 3000, 4];
  const pts = crackleArc(a, b, 3, 5, rnd);
  assert.equal(pts.length / 3, TOUCH_N.arc, 'the arc has the strip\'s sample count');
  assert.deepEqual([pts[0], pts[1], pts[2]], a);
  assert.deepEqual([pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]], b);
  let len = 0, maxStep = 0;
  for (let i = 3; i < pts.length; i += 3) {
    const s = Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1]);
    len += s; maxStep = Math.max(maxStep, s);
  }
  const direct = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  assert.ok(len > direct * 1.08, `jagged, not straight (${len.toFixed(1)} vs ${direct.toFixed(1)})`);
  assert.ok(maxStep < direct * 0.4, 'connected: no long jumps');
});

// ───────────────────────────── the Touch at work (render/hand.ts) ─────────────────────────────

/** the Touch's stage: the slope world, a point on its land, a camera 80 m off to the side looking at it */
function touchStage(sunUp = true) {
  const pv = { ...slopeWorld(), id: 0 } as PlanetView;
  const R = pv.params.radius;
  const u = new Vector3(0.15, 0.05, 1).normalize();
  const e = new Vector3(0, 1, 0).cross(u).normalize();
  const cam = u.clone().multiplyScalar(R + 70).addScaledVector(e, 80);
  const fwd = u.clone().multiplyScalar(R).sub(cam).normalize();
  const decals: Decal[] = [];
  const pass = { add: (d: Decal) => { decals.push(d); } } as unknown as DecalPass;
  const shared: Record<string, IUniform> = {
    uSunDirBody: { value: (sunUp ? u.clone().addScaledVector(e, 0.8) : u.clone().negate()).normalize() },
    uSunE: { value: new Vector3(8, 8, 8) },
  };
  const bursts: string[] = [];
  let t = 0;
  /** run n frames of dt seconds; `over` changes the frame (the sim's hand, the cursor, the pose) */
  const run = (h: HandVisual, n: number, over: (i: number) => Partial<HandFrame> = () => ({}), dt = 0.05): Decal[] => {
    for (let i = 0; i < n; i++) {
      t += dt;
      decals.length = 0;
      h.update({
        pv, hand: null, camBody: cam, camFwd: fwd, camUp: u, dt, fxTime: t, fxDt: dt, cursor: null, uiPose: 'none', aiming: false,
        decals: pass, shared, cloudBase: R + 900, air: true, fov: 55, viewH: 720, burst: (k) => { bursts.push(k); }, ...over(i),
      });
    }
    return decals;
  };
  const hand = (o: Partial<HandView> = {}): HandView => ({ planet: 0, pos: [u.x, u.y, u.z], alt: 0, held: null, pose: 'open', alignment: 0, regard: 0, ...o });
  return { pv, R, u, e, cam, run, hand, bursts, now: () => t };
}

/** a private part of the Touch (its uniforms, its meshes) */
const inner = (h: HandVisual) => h as unknown as { u: Record<string, { value: number }>; glyph: Object3D; trailMesh: Object3D; sigil: { stroke: Float32Array } | null };

test('the Touch appears where it is called and goes when nothing calls it', () => {
  const S = touchStage();
  const h = new HandVisual();
  S.run(h, 20);
  assert.ok(!h.visible && h.presence === 0, 'nobody calls it: it is not there');
  const cursor = { planet: 0, dir: [S.u.x, S.u.y, S.u.z] };
  S.run(h, 30, () => ({ cursor }));
  assert.ok(h.visible && h.presence > 0.9, `under the cursor it gathers (${h.presence.toFixed(2)})`);
  const up = h.pos.clone().normalize();
  assert.ok(up.angleTo(S.u) < 1e-3, 'over the ground the cursor points at');
  const above = h.pos.length() - (S.R + S.pv.grid.sample(S.pv.fields.get('surface')!, up.x, up.y, up.z));
  assert.ok(above > 0.3 * h.scale && above < 0.7 * h.scale, `hovering low over it (${above.toFixed(1)} m, size ${h.scale.toFixed(1)})`);
  assert.equal(h.behaviour, 'open');
  // it follows the cursor on a spring that holds at any frame rate (8 fps here, and a 2-s stall): no overshoot past
  // where it goes, no flying apart
  for (const dt of [0.1, 2]) {
    const q = S.u.clone().addScaledVector(S.e, (dt < 1 ? 9 : -9) / S.R).normalize();
    const to = { planet: 0, dir: [q.x, q.y, q.z] };
    const target = () => h.pos.clone().normalize().angleTo(q) * S.R;
    const start = target();
    let worst = 0;
    for (let i = 0; i < 30; i++) { S.run(h, 1, () => ({ cursor: to }), dt); worst = Math.max(worst, target()); }
    assert.ok(start > 5 && worst <= start + 1e-6 && target() < 0.05, `dt ${dt}: it closes on the cursor steadily (${start.toFixed(2)} → worst ${worst.toFixed(2)} → ${target().toFixed(3)} m)`);
  }
  S.run(h, 20, () => ({ cursor, uiPose: 'open' }));
  assert.equal(h.behaviour, 'reach', 'reaching for something, the whirl quickens and lowers');
  // the cursor leaves: it lingers a moment, then goes
  S.run(h, 100);
  assert.ok(!h.visible, 'gone when the cursor left');
  // from four radii out it is never drawn (from the system view it would be a weather system)
  const far = { camBody: S.u.clone().multiplyScalar(S.R * 6) };
  S.run(h, 40, () => ({ cursor, ...far }));
  assert.ok(!h.visible, 'not from space');
});

test('the Touch lifts a person into its cradle and lets them go', () => {
  const S = touchStage();
  const h = new HandVisual();
  const held: EntityRef = { kind: 'agent', id: 7, planet: 0 };
  S.run(h, 60, () => ({ hand: S.hand({ held, pose: 'grab', alt: 6, regard: 0.8 }) }));
  assert.equal(h.behaviour, 'lift');
  assert.ok(h.grasp > 0.95, `gathered round them (${h.grasp.toFixed(2)})`);
  assert.deepEqual([h.heldKind, h.heldId], ['agent', 7]);
  const up = h.grip.clone().normalize();
  // the person hangs through the grip: the people layer draws them at the pinch, the cradle round their middle
  assert.ok(Math.abs(h.pinch.clone().sub(h.grip).dot(up) - 0.95) < 1e-6, 'held by the top of them, at the grip');
  assert.ok(h.cradle.clone().sub(h.pinch).dot(up) < -0.5, 'the cradle round their body, below the grip');
  assert.ok(h.pos.length() - S.R > 2, 'lifted clear of the ground');
  // set down: the cradle opens back into the whirl
  S.run(h, 80, () => ({ hand: S.hand({ pose: 'open', regard: 0.8 }) }));
  assert.ok(h.grasp < 0.05 && h.heldKind === '' && (h.behaviour as string) === 'open', `released (${h.grasp.toFixed(2)}, ${h.behaviour})`);
});

test('feared, the Touch is storm-dark and crackles; trusted, it is warm light and never does', () => {
  const S = touchStage();
  const h = new HandVisual();
  S.run(h, 80, () => ({ hand: S.hand({ pose: 'point', regard: -1 }) }));
  assert.ok(h.regard < -0.9, `its look eases to the people's regard (${h.regard.toFixed(2)})`);
  assert.ok(inner(h).u.uDark.value > 0.85, 'storm-dark');
  const at = h.nextCrackle(100, -1);
  assert.ok(at !== null && at >= 100, 'a feared god crackles now and then');
  h.hold = at;
  const d = S.run(h, 1, () => ({ hand: S.hand({ pose: 'point', regard: -1 }) }));
  assert.ok(h.crackling >= 1, 'an arc struck at the moment nextCrackle named');
  assert.ok(d.some((x) => x.type === 10 && x.cb > x.cr && x.p1 > 0), 'its cold light on the ground under the arc');
  // its storm's gloom: a broad soft shade on the land round it (not thrown by the sun: under it, by night as well)
  const under = (x: Decal) => new Vector3(x.x, x.y, x.z).normalize().angleTo(h.pos.clone().normalize()) * S.R;
  const gloom = (ds: Decal[]) => ds.find((x) => x.type === 0 && x.p0 >= h.scale * 4 && x.p1 >= h.scale * 4 && under(x) < 1);
  const gl = gloom(d);
  assert.ok(gl && gl.ca > 0.2, `a gloom round it (${gl ? `${gl.p0.toFixed(0)} m, ${gl.ca.toFixed(2)}` : 'none'})`);
  const N = touchStage(false);
  const hn = new HandVisual();
  const dn = N.run(hn, 80, () => ({ hand: N.hand({ pose: 'point', regard: -1 }) }));
  assert.ok(dn.some((x) => x.type === 0 && x.p0 >= hn.scale * 4), 'the gloom by night too');
  hn.dispose();
  h.hold = null;
  const g = new HandVisual();
  assert.equal(g.nextCrackle(100, 1), null);
  let arcs = 0;
  S.run(g, 200, () => ({ hand: S.hand({ pose: 'point', regard: 1 }) }));
  for (let i = 0; i < 40; i++) { S.run(g, 1, () => ({ hand: S.hand({ pose: 'point', regard: 1 }) })); arcs += g.crackling; }
  assert.equal(arcs, 0, 'a trusted god never crackles');
  assert.ok(inner(g).u.uDark.value === 0 && g.light.r > g.light.b + 0.3, 'warm light, no storm');
  const dg = S.run(g, 1, () => ({ hand: S.hand({ pose: 'point', regard: 1 }) }));
  assert.ok(!dg.some((x) => x.type === 0 && x.p0 >= g.scale * 4), 'no gloom round a trusted god');
});

test('trusted, the Touch is warm light more than weather; holding, its cradle still shows what it holds', () => {
  const S = touchStage();
  const look = (regard: number, held: EntityRef | null) => {
    const h = new HandVisual();
    h.force = true;
    S.run(h, 80, () => ({ hand: S.hand({ regard, held, pose: held ? 'grab' : 'open' }) }));
    const u = inner(h).u;
    return { tuft: u.uTuftK.value, heart: u.uHeartK.value, dust: u.uDustK.value, motes: u.uMoteK.value, moteS: u.uMoteS.value, beam: u.uBeamK.value, grasp: h.grasp };
  };
  const awed = look(0, null), trusted = look(1, null), feared = look(-1, null);
  // open: a trusted god's cloud thins, the light at its heart swells, its motes of light thicken and grow, its shaft
  // brightens, and it raises almost no dust (a sunlit whirl of cloud and dust read as a white dust devil)
  assert.ok(trusted.tuft < awed.tuft * 0.5, `less cloud (${trusted.tuft.toFixed(2)} vs ${awed.tuft.toFixed(2)})`);
  assert.ok(trusted.heart > awed.heart * 2.5, `more light at its heart (${trusted.heart.toFixed(2)} vs ${awed.heart.toFixed(2)})`);
  assert.ok(trusted.motes > awed.motes * 2 && trusted.moteS > awed.moteS * 1.5, 'more and larger motes of light');
  assert.ok(trusted.beam > awed.beam * 2, `a brighter shaft (${trusted.beam.toFixed(2)} vs ${awed.beam.toFixed(2)})`);
  assert.ok(trusted.dust < awed.dust * 0.25, `almost no dust (${trusted.dust.toFixed(3)} vs ${awed.dust.toFixed(3)})`);
  // a feared god is the storm: its cloud is thickest
  assert.ok(feared.tuft > awed.tuft && feared.heart < trusted.heart, 'feared: thick dark cloud, little light');
  // holding, the trusted god keeps more of its cradle and less glow than open (the weave must show; what it holds
  // stands dark against the light instead of drowning in it)
  const holding = look(1, { kind: 'rock', id: 2600 });
  assert.ok(holding.grasp > 0.95, 'it gathered');
  assert.ok(holding.tuft > trusted.tuft, `the cradle is woven of cloud (${holding.tuft.toFixed(2)} vs open ${trusted.tuft.toFixed(2)})`);
  assert.ok(holding.heart / trusted.heart < 1.2, 'its heart no brighter than open (what it holds is not drowned)');
});

test('the Touch at work: a throw leaves a trail, a rebuke is a downdraft and a flash, a cast traces its sigil', () => {
  const S = touchStage();
  const h = new HandVisual();
  const cursor = { planet: 0, dir: [S.u.x, S.u.y, S.u.z] };
  S.run(h, 30, () => ({ cursor }));
  // swept fast across the land (a throw): a ribbon of its light behind it
  const sweep = (i: number) => { const q = S.u.clone().addScaledVector(S.e, 0.004 * Math.sin(i * 0.5)).normalize(); return { cursor: { planet: 0, dir: [q.x, q.y, q.z] } }; };
  S.run(h, 12, sweep);
  assert.ok(inner(h).u.uTrailK.value > 0.2 && inner(h).trailMesh.visible, `a trail (${inner(h).u.uTrailK.value.toFixed(2)})`);
  // a rebuke: the sim's hand slaps — a downdraft gust thrown out along the ground, a cold flash
  S.run(h, 40, () => ({ cursor, hand: S.hand({ pose: 'open' }) }));
  S.bursts.length = 0;
  let d: Decal[] = [];
  for (let i = 0; i < 4; i++) d = S.run(h, 1, () => ({ cursor, hand: S.hand({ pose: 'slap' }) }));
  assert.equal(h.behaviour, 'rebuke');
  assert.ok(S.bursts.includes('gust') && S.bursts.includes('flash'), `dust and a flash (${S.bursts})`);
  assert.ok(d.some((x) => x.type === 8 && x.ca > 0.1), 'the gust rolls out along the ground');
  // a cast: the miracle's sigil traced in light over it — the glyph the player draws for the mending
  S.run(h, 60, () => ({ cursor, hand: S.hand({ pose: 'open' }) }));
  h.pulse('cast', S.now(), 'heal');
  S.run(h, 12, () => ({ cursor, hand: S.hand({ pose: 'open' }) }));
  assert.equal(h.behaviour, 'sigil');
  assert.ok(inner(h).glyph.visible, 'the glyph is being traced');
  assert.deepEqual(inner(h).sigil?.stroke, sigilStroke('knot', TOUCH_N.glyph));
  S.run(h, 80, () => ({ cursor, hand: S.hand({ pose: 'open' }) }));
  assert.ok(!inner(h).glyph.visible, 'and fades');
});

test('a person the Touch hurls is drawn flying by their own id, never the projectile\'s', () => {
  const pv = { ...slopeWorld(), id: 0 } as PlanetView;
  const u = new Vector3(0.15, 0.05, 1).normalize();
  const vfx = { emit: () => 1, set: () => { /* */ }, stop: () => { /* */ }, alive: () => true };
  const ctx = { pv, now: 0, dt: 0.05, vfx } as unknown as FxCtx;
  const thrown = (id: number, data: Record<string, unknown> = {}) => ({ t: 'thrown', tick: 1, planet: 0, pos: [u.x, u.y, u.z] as [number, number, number], a: 14, b: 4, data: { id, payload: 'agent', vel: [8 * u.x + 3, 8 * u.y, 8 * u.z], ...data } });
  const fly = (setup: (f: Flights) => void, projectiles: ProjectileView[] = []) => {
    const f = new Flights({});
    ctx.now = 0;
    setup(f);
    ctx.now = 0.3;
    f.update(ctx, projectiles);
    return [...f.agentPins.keys()];
  };
  // projectile 3 carried agent 42, whom the Touch held: agent 42 flies (agent 3 — a stranger — stays where they are)
  assert.deepEqual(fly((f) => f.onEvent(thrown(3), ctx, 42)), [42]);
  // the event names them itself
  assert.deepEqual(fly((f) => f.onEvent(thrown(4, { agent: 9 }), ctx)), [9]);
  // nobody says who: the snapshot's projectile does (what = the agent's id)
  const pr: ProjectileView = { id: 5, planet: 0, kind: 'agent', what: 77, content: '', pos: [u.x, u.y, u.z], alt: 4, vel: [0, 0, 0] };
  assert.deepEqual(fly((f) => f.onEvent(thrown(5), ctx), [pr]), [77]);
  // and nobody at all: nobody is drawn flying (a wrong person in the air is worse than none)
  assert.deepEqual(fly((f) => f.onEvent(thrown(6), ctx)), []);
  // the streak of the god's light behind a hurled thing is its own path traced back — the same at any frame rate: one
  // frame 0.3 s into the flight draws the whole 0.3 s of it, head where it is, tail where it was
  const R = pv.params.radius;
  const v0 = new Vector3(0, 0, 0).crossVectors(u, new Vector3(0, 1, 0)).normalize().multiplyScalar(14);
  const t = 0.3, p1 = u.clone().multiplyScalar(R + 20);
  const fx = new ThrowFx({});
  const src = { sizeOf: null, forEach: (f: (id: number, kind: string, p: Vector3, v: Vector3, age: number) => void) => f(1, 'agent', p1, v0, t) };
  const cam = u.clone().multiplyScalar(R + 30).addScaledVector(new Vector3(0, 1, 0), 40);
  fx.update(src, pv, 5, cam, 55, 720, { add: () => { /* */ } } as unknown as DecalPass, new Color(1, 0.8, 0.5));
  const at = fx.group.geometry.getAttribute('position');
  const mid = (i: number) => new Vector3((at.getX(i * 2) + at.getX(i * 2 + 1)) / 2, (at.getY(i * 2) + at.getY(i * 2 + 1)) / 2, (at.getZ(i * 2) + at.getZ(i * 2 + 1)) / 2);
  const n = at.count / 2 / 8; // samples per flight slot (8 slots)
  let head = -1;
  for (let k = 0; k < 8; k++) if (mid(k * n).distanceTo(p1) < 1e-3) head = k * n;
  assert.ok(head >= 0 && fx.group.visible, 'the streak starts where it is');
  // (under gravity: moving level now, 0.3 s ago it was ½ g t² lower than a straight line back — it was still rising)
  const g = pv.params.gravity || 9.8, was = p1.clone().addScaledVector(v0, -t).addScaledVector(u, -0.5 * g * t * t);
  assert.ok(mid(head + n - 1).distanceTo(was) < 0.05, `and reaches back to where it was 0.3 s ago (${mid(head + n - 1).distanceTo(was).toFixed(3)} m)`);
  fx.dispose();
});

test('what the Touch hurls flies as it was held: a tree as the tree, upright as it left, a boulder at its mass\'s size', () => {
  const pv = { ...slopeWorld(), id: 0 } as PlanetView;
  const u = new Vector3(0.15, 0.05, 1).normalize();
  const vfx = { emit: () => 1, set: () => { /* */ }, stop: () => { /* */ }, alive: () => true };
  const ctx = { pv, now: 0, dt: 0.05, vfx } as unknown as FxCtx;
  const side = new Vector3().crossVectors(u, new Vector3(0, 1, 0)).normalize();
  const thrown = (id: number, payload: string) => ({ t: 'thrown', tick: 1, planet: 0, pos: [u.x, u.y, u.z] as [number, number, number], a: 14, b: 4, data: { id, payload, vel: [side.x * 10 + u.x * 9, side.y * 10 + u.y * 9, side.z * 10 + u.z * 9] } });
  const f = new Flights({});
  f.onEvent(thrown(1, 'tree'), ctx);
  f.onEvent(thrown(2, 'rock'), ctx, 2600 * 4, 'rock');
  f.onEvent(thrown(3, 'rock'), ctx);
  ctx.now = 0.02;
  f.update(ctx, []);
  const meshes = f.group.children as Mesh[];
  assert.equal(meshes.length, 3);
  // the tree is the Touch's own uprooted tree (the same geometry), not a boulder; leafed and casting a shadow
  const [tree, heavy, plain] = meshes;
  assert.equal(tree.geometry, heldPropGeometry('tree'), 'the tree the Touch held');
  assert.ok(tree.layers.isEnabled(1) && (tree.material as { userData: { propDepth?: unknown } }).userData.propDepth, 'a lit prop with its depth twin');
  // upright as it left the Touch: its trunk along the ground's up, a dozen metres tall, its middle on the flight
  const e = tree.matrix.elements;
  const yAxis = new Vector3(e[4], e[5], e[6]);
  const up = new Vector3(); f.forEach((id, _k, p) => { if (id === 1) up.copy(p).normalize(); }, ctx.now);
  assert.ok(yAxis.clone().normalize().dot(up) > 0.99, `upright at release (${yAxis.clone().normalize().dot(up).toFixed(3)})`);
  assert.ok(Math.abs(yAxis.length() - heldTrueSize('tree').size) < 0.5, `as tall as it was held (${yAxis.length().toFixed(1)} m)`);
  // a 10 t boulder the Touch held flies bigger than a boulder nobody weighed (the default 50 kg)
  const sz = (m: Mesh) => new Vector3(m.matrix.elements[0], m.matrix.elements[1], m.matrix.elements[2]).length();
  assert.ok(sz(heavy) > sz(plain) * 1.5, `a boulder at its mass's size (${sz(heavy).toFixed(2)} vs ${sz(plain).toFixed(2)})`);
  assert.ok(Math.abs(sz(heavy) * 2 - heldTrueSize('rock', 2600 * 4).size) < 0.05, 'the size the Touch drew it at');
  f.dispose();
});

test('the Touch\'s weather lies on the ground: a pool of its light, its cloud\'s shadow in the sun', () => {
  for (const sunUp of [true, false]) {
    const S = touchStage(sunUp);
    const h = new HandVisual();
    const cursor = { planet: 0, dir: [S.u.x, S.u.y, S.u.z] };
    const d = S.run(h, 30, () => ({ cursor }));
    const ground = (x: Decal) => new Vector3(x.x, x.y, x.z).normalize().angleTo(S.u) * S.R;
    const pool = d.find((x) => x.type === 10);
    assert.ok(pool && pool.p1 > 0 && ground(pool) < 1, 'a pool of its light under it');
    const shadow = d.find((x) => x.type === 0);
    if (sunUp) assert.ok(shadow && shadow.ca > 0 && ground(shadow) < h.scale * 6, 'its shadow near it in the sun');
    else assert.ok(!shadow, 'no shadow at night');
  }
  // nothing of the Touch is a hand: no skinned body, no bones, no fingers
  const S = touchStage();
  const h = new HandVisual();
  S.run(h, 10, () => ({ cursor: { planet: 0, dir: [S.u.x, S.u.y, S.u.z] }, hand: S.hand({ held: { kind: 'rock', id: 900, planet: 0 }, pose: 'grab' }) }));
  h.group.traverse((o) => {
    assert.ok(!(o as { isSkinnedMesh?: boolean }).isSkinnedMesh && !(o as { isBone?: boolean }).isBone, `${o.name || o.type}: no skinned body`);
    assert.ok(!/hand|finger|palm|thumb/i.test(o.name) || o.name === 'touch', `${o.name}: nothing named for a hand`);
  });
  h.dispose();
});

test('the god layer\'s shadow casters draw the atlas with depth twins that sample no texture (no GL feedback loop)', () => {
  // debris (InstancedMesh), a boulder the Touch holds, a thing in flight: every mesh on the shadow layer (1) has a
  // depth twin, swapPropDepth puts it on for the shadow pass and takes it off after, and the twin reads no texture —
  // drawing into the shadow atlas with the lit material (which samples that atlas) is the feedback loop
  const root = new Group();
  const debris = new Debris({}, { uFxTime: { value: 0 } }, 8);
  debris.burst(new Vector3(0, 3000, 0), 4, 5, 1, 0);
  root.add(debris.mesh);
  const S = touchStage();
  const h = new HandVisual();
  S.run(h, 10, () => ({ cursor: { planet: 0, dir: [S.u.x, S.u.y, S.u.z] }, hand: S.hand({ held: { kind: 'rock', id: 900, planet: 0 }, pose: 'grab' }) }));
  root.add(h.group);
  const casters: Mesh[] = [];
  root.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.layers.isEnabled(1)) casters.push(m); });
  assert.ok(casters.length >= 2, `casters found (${casters.length})`);
  const lit = casters.map((m) => m.material);
  swapPropDepth(root, true);
  casters.forEach((m, i) => {
    const twin = m.material as ShaderMaterial;
    assert.notEqual(twin, lit[i], `${m.name || m.type}: swapped for the shadow pass`);
    assert.ok(twin.isShaderMaterial && twin.colorWrite === false, 'a depth-only twin');
    for (const [k, u] of Object.entries(twin.uniforms)) assert.ok(!(u.value && (u.value as { isTexture?: boolean }).isTexture), `${k}: the twin samples no texture`);
  });
  swapPropDepth(root, false);
  casters.forEach((m, i) => assert.equal(m.material, lit[i], 'the lit material is back after the shadow pass'));
  debris.dispose(); h.dispose();
});

test('the creature is gone from the renderer', () => {
  for (const f of ['src/render/life/creature.ts', 'src/render/gen/creaturegen.ts']) {
    assert.ok(!existsSync(fileURLToPath(new URL(`../${f}`, import.meta.url))), `${f} does not ship`);
  }
});

type P2 = [number, number];
/** a polyline resampled to n points at equal arc length */
function resample(pts: P2[], n: number): P2[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const out: P2[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}
/** centred on its mean, scaled so its larger side is 1 */
function normalise(p: P2[]): P2[] {
  let cx = 0, cy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { cx += q[0]; cy += q[1]; x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  cx /= p.length; cy /= p.length;
  const s = Math.max(x1 - x0, y1 - y0) || 1;
  return p.map((q) => [(q[0] - cx) / s, (q[1] - cy) / s]);
}
/** a $1-recogniser style distance: the mean point distance, at the best of ±45° of turn, drawn either way */
function shapeDistance(a: P2[], b: P2[]): number {
  let best = Infinity;
  for (const bb of [b, [...b].reverse()]) for (let k = -12; k <= 12; k++) {
    const ang = (k / 12) * (Math.PI / 4), c = Math.cos(ang), s = Math.sin(ang);
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.hypot(a[i][0] * c - a[i][1] * s - bb[i][0], a[i][0] * s + a[i][1] * c - bb[i][1]);
    best = Math.min(best, d / a.length);
  }
  return best;
}
/** the old design's drawn-gesture shapes (CONTRACT §16.5, Black & White's family): no sigil may read as one of them */
function primitives(): Record<string, P2[]> {
  const circle: P2[] = [], spiral: P2[] = [], star: P2[] = [];
  for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; circle.push([Math.cos(a), Math.sin(a)]); }
  for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * Math.PI * 4.5; spiral.push([Math.cos(a) * (1 - 0.85 * t), Math.sin(a) * (1 - 0.85 * t)]); }
  for (let i = 0; i <= 5; i++) { const a = Math.PI / 2 + i * ((4 * Math.PI) / 5); star.push([Math.cos(a), Math.sin(a)]); }
  return {
    circle, spiral, star,
    zigzag: [[-1, 1], [-0.5, -1], [0, 1], [0.5, -1], [1, 1]],
    triangle: [[0, 1], [-1, -0.8], [1, -0.8], [0, 1]],
    v: [[-1, 1], [0, -1], [1, 1]],
    square: [[-1, 1], [-1, -1], [1, -1], [1, 1], [-1, 1]],
  };
}

test('one glyph per sigil: what the Touch traces and the land shows is the stroke the player draws', () => {
  const powers = ((BASE_PACK as unknown as { powers: { id: string; command: string; params?: { kind?: string }; sigil?: string | null }[] }).powers);
  const used = powers.filter((p) => p.sigil);
  assert.ok(used.length >= 14, `the powers carry sigils (${used.length})`);
  for (const p of used) {
    assert.ok(SHAPES[p.sigil!] && SIGIL_IDS.includes(p.sigil!), `${p.id}: sigil '${p.sigil}' has the recogniser's template`);
    // the miracle the power casts draws that sigil
    const kind = p.command.startsWith('miracle.') ? p.command.slice(8) : p.params?.kind;
    if (kind && p.command !== 'miracle.cast') assert.equal(sigilOfMiracle(kind), p.sigil, `${kind} draws ${p.sigil}`);
  }
  // the recogniser reads every drawn glyph back as its own sigil, confidently (screen y runs down: flip the glyph's up)
  const rec = new Unistroke();
  for (const id of Object.keys(SHAPES)) {
    const s = sigilStroke(id, 96);
    const pts: Pt[] = [];
    for (let i = 0; i < 96; i++) pts.push([s[i * 2] * 100, -s[i * 2 + 1] * 100]);
    const r = rec.recognize(pts);
    assert.ok(r && r.name === id && r.score > 0.85, `${id}: the drawn glyph reads as ${id} (${r?.name} ${r?.score.toFixed(3)})`);
  }
  const prims = primitives();
  // (the measure itself: a wobbly circle is a circle)
  const wob = resample(prims.circle, 64).map((q, i) => [q[0] + 0.08 * Math.sin(i * 1.7), q[1] + 0.08 * Math.cos(i * 2.3)] as P2);
  assert.ok(shapeDistance(normalise(wob), normalise(resample(prims.circle, 64))) < 0.07, 'the measure finds a circle');
  for (const id of SIGIL_IDS) {
    const s = sigilStroke(id, 64);
    assert.equal(s.length, 128);
    let total = 0, hi = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 64; i++) {
      const x = s[i * 2], y = s[i * 2 + 1];
      assert.ok(Math.abs(x) <= 1.0001 && Math.abs(y) <= 1.0001, `${id}: inside the unit box`);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (i) { const d = Math.hypot(x - s[i * 2 - 2], y - s[i * 2 - 1]); total += d; hi = Math.max(hi, d); }
    }
    // fitted: its longer side spans the box
    assert.ok(Math.max(x1 - x0, y1 - y0) > 1.9, `${id}: fills the box`);
    // equal arc length per sample (a chord across a sharp turn is shorter than the arc: the bound is on the longest)
    assert.ok(hi < (total / 63) * 1.05, `${id}: evenly sampled (longest ${hi.toFixed(4)}, mean ${(total / 63).toFixed(4)})`);
    // never a bare primitive: far from every old gesture shape (a wobbly copy of one of them scores ~0.04-0.05)
    const pts: P2[] = [];
    for (let i = 0; i < 64; i++) pts.push([s[i * 2], s[i * 2 + 1]]);
    const me = normalise(pts);
    for (const [name, shape] of Object.entries(prims)) {
      const d = shapeDistance(me, normalise(resample(shape, 64)));
      assert.ok(d > 0.09, `${id} does not read as a ${name} (${d.toFixed(3)})`);
    }
  }
  assert.ok(!SIGIL_IDS.includes('spiral'), 'no spiral glyph');
  // the glyph's up is up: the drop falls from its top, the fall runs down to the right, the sprout grows up its stem
  const drop = sigilStroke('drop', 32), fall = sigilStroke('fall', 32), sprout = sigilStroke('sprout', 32);
  assert.ok(drop[1] > drop[31 * 2 + 1], 'the drop starts high');
  assert.ok(fall[0] < fall[31 * 2] && fall[1] > fall[31 * 2 + 1], 'the fall runs down-right');
  assert.ok(sprout[1] < -0.9, 'the sprout starts at the foot of its stem');
  // a disaster sent with a sigil (the meteor's power) writes it; one no sigil sends (a volcano, a comet) writes none
  for (const p of used) if (p.command === 'disaster.spawn' && p.params?.kind) assert.equal(sigilOfDisaster(p.params.kind), p.sigil, `${p.params.kind} is sent with ${p.sigil}`);
  assert.equal(sigilOfDisaster('meteor'), 'fall');
  assert.equal(sigilOfDisaster('volcano'), null);
  assert.equal(sigilOfDisaster('comet'), null);
  // an invented miracle draws the original fallback, which has a stroke of its own
  assert.equal(sigilOfMiracle('no-such-miracle'), FALLBACK_SIGIL);
  assert.deepEqual(sigilStroke('no-such-sigil', 32), sigilStroke(FALLBACK_SIGIL, 32));
  assert.ok(!(FALLBACK_SIGIL in SHAPES), 'the fallback is not a castable sigil');
});

test('a sigil lands where the miracle falls: on the ground, on the water over a lake or the sea, never broken by the far terrain', () => {
  const pv = slopeWorld();
  const R = 3000;
  const marks = new SigilMarks({});
  const light = { r: 1, g: 0.7, b: 0.3 };
  const radii = (m: { mesh: Mesh }): number[] => {
    const pos = m.mesh.geometry.getAttribute('position');
    const out: number[] = [];
    for (let i = 0; i < pos.count; i++) out.push(Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
    return out;
  };
  const pool = () => (marks as unknown as { pool: { mesh: Mesh; mat: ShaderMaterial; live: boolean }[] }).pool;
  // over the sea (west of the slope's shore the ground is under water, its surface at the datum)
  const sea = new Vector3(-0.6, 0.05, 0.8).normalize();
  const camNear = sea.clone().multiplyScalar(R + 120).add(new Vector3(0, 60, 0));
  marks.land(pv, 'water', sea.clone().multiplyScalar(R - 36), 40, light, camNear, sea.clone().negate(), 0);
  const onSea = radii(pool()[0]);
  assert.ok(onSea.every((r) => r >= R - 0.5 && r < R + 4), `on the water's surface, not the bed 30 m under it (${Math.min(...onSea).toFixed(1)}…${Math.max(...onSea).toFixed(1)})`);
  assert.ok(Math.abs(landTop(pv, sea) - R) < 0.5, 'the top of the sea is its surface');
  // over the land: on the ground (the slope stands ~36 m over the datum there)
  const land = new Vector3(0.6, 0.05, 0.8).normalize();
  const camFar = land.clone().multiplyScalar(R + 500).add(new Vector3(0, 300, 0));
  marks.land(pv, 'heal', land.clone().multiplyScalar(R + 36), 40, light, camFar, land.clone().negate(), 0);
  const onLand = radii(pool()[1]);
  for (const [i, r] of onLand.entries()) {
    const pos = pool()[1].mesh.geometry.getAttribute('position');
    const u = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const g = groundHeight(pv.ground, u.x, u.y, u.z);
    assert.ok(r > g && r < g + 3, `a hand's breadth over the ground (${(r - g).toFixed(2)} m)`);
  }
  // the depth test's slack grows with the distance (the drawn terrain is coarser far away): a far glyph is not cut
  // into dashes by it, a near one is still hidden by a house in front of it
  const bNear = pool()[0].mat.uniforms.uBias.value as number, bFar = pool()[1].mat.uniforms.uBias.value as number;
  assert.ok(bNear >= 0.5 && bNear < 3 && bFar > bNear * 2, `slack near ${bNear.toFixed(2)} m, far ${bFar.toFixed(2)} m`);
  // written in the light it was given, traced and then fading
  marks.update(0.5, { add: () => {} } as unknown as DecalPass);
  assert.equal(marks.live, 2);
  assert.deepEqual((pool()[1].mat.uniforms.uCol.value as Vector3).toArray(), [1, 0.7, 0.3]);
  marks.update(60, { add: () => {} } as unknown as DecalPass);
  assert.equal(marks.live, 0, 'gone after its life');
  marks.dispose();
});

// ───────────────────────────── signs (render/signs, render/fx/drawback) ─────────────────────────────

test('signs: prophets and the Called are found by their flags, sacred animals by id or old id, every place kind has a look', () => {
  const f2 = new Uint8Array([0, AgentFlag2.prophet, AgentFlag2.called, AgentFlag2.hunter, AgentFlag2.prophet | AgentFlag2.festive, AgentFlag2.called | AgentFlag2.camp]);
  assert.deepEqual(markedPeople(f2, f2.length).map((m) => m[0]), [1, 2, 4, 5]);
  assert.deepEqual(markedPeople(undefined, 4), [], 'an older sim without flags2: nobody marked');
  const animals = (BASE_PACK as unknown as { animals: { id: string; aliases?: string[] }[] }).animals;
  assert.equal(animalIndex('cattle'), animals.findIndex((a) => a.id === 'cattle'));
  const aliased = animals.findIndex((a) => (a.aliases ?? []).length > 0);
  if (aliased >= 0) assert.equal(animalIndex(animals[aliased].aliases![0]), aliased, 'an old id finds the real animal that replaced it');
  assert.equal(animalIndex('dragon'), -1);
  assert.equal(animalIndex(undefined), -1);
  for (const k of ['spring', 'grove', 'mountain', 'site']) {
    const l = PLACE_LOOK[k];
    assert.ok(l && l.ring > 0 && l.col.every((c) => c > 0 && c <= 1), `${k} has a look`);
  }
});

test('signs: the sim\'s events become places and moments', () => {
  const s = new SignsLayer({});
  s.onEvent({ t: 'sacred.place', tick: 5, planet: 0, pos: [0, 1, 0], data: { id: 7, kind: 'spring', settlement: 2, by: 'prophet' } }, 3000, 1);
  assert.equal(s.places.get(7)?.kind, 'spring');
  assert.equal(s.places.get(7)?.settlement, 2);
  const before = (s as unknown as { moments: unknown[] }).moments.length;
  s.onEvent({ t: 'omen', tick: 6, planet: 0, pos: [0, 1, 0], data: { kind: 'rainbow', reading: 'feared' } }, 3000, 2);
  s.onEvent({ t: 'lightning', tick: 6, planet: 0, pos: [1, 0, 0], data: {} }, 3000, 2);
  s.onEvent({ t: 'lightning', tick: 6, planet: 0, pos: [1, 0, 0], data: { omen: 1 } }, 3000, 2);
  s.onEvent({ t: 'prophet.called', tick: 7, planet: 0, pos: [0, 0, 1], data: { agent: 3 } }, 3000, 3);
  s.onEvent({ t: 'sacred.animal', tick: 8, planet: 0, pos: [0, 0, 1], data: { settlement: 2, animal: 'cattle' } }, 3000, 3);
  s.onEvent({ t: 'prophet.died', tick: 9, planet: 0, pos: [0, 0, 1], data: { agent: 3, settlement: 2 } }, 3000, 3);
  s.onEvent({ t: 'prophet.foretold', tick: 9, planet: 0, pos: [0, 0, 1], data: { agent: 3 } }, 3000, 3);
  s.onEvent({ t: 'prophet.failed', tick: 10, planet: 0, pos: [0, 0, 1], data: { agent: 4, settlement: 2, kind: 'rain', credibility: 0.2 } }, 3000, 3);
  s.onEvent({ t: 'prophet.abandoned', tick: 11, planet: 0, data: { agent: 4, settlement: 2 } }, 3000, 3);
  const m = (s as unknown as { moments: { kind: string; col: number[] }[] }).moments;
  assert.deepEqual(m.slice(before).map((x) => x.kind), ['omen', 'strike', 'called', 'fulfilled', 'passing', 'failed', 'withdrawn'], 'an ordinary strike is no sign; a prophecy spoken shows nothing yet');
  assert.ok(m[before].col[2] > m[before].col[0], 'anger reads cold');
  const failed = m[m.length - 2], warm = m[before + 3];
  assert.ok(lum(failed.col as [number, number, number]) < lum(warm.col as [number, number, number]) && failed.col[2] >= failed.col[0], 'a failed word reads grey beside a fulfilled one');
  s.dispose();
  // drawn: the failed word a ring on the town; the one the god turned from, their thread drawn up off them where the
  // crowds draw them — and nothing where nobody draws them (the event has no place)
  const pv = { ...slopeWorld(), id: 0, settlements: [], agents: undefined, animals: undefined } as unknown as PlanetView;
  const R = 3000, u = new Vector3(0.6, 0.05, 0.8).normalize();
  const draw = (who: number | null) => {
    const q = new SignsLayer({});
    q.onEvent({ t: 'prophet.failed', tick: 10, planet: 0, pos: [u.x, u.y, u.z], data: { agent: 4 } }, R, 0);
    q.onEvent({ t: 'prophet.abandoned', tick: 11, planet: 0, data: { agent: 4 } }, R, 0);
    const decals: Decal[] = [];
    const feet = u.clone().multiplyScalar(R + 60);
    q.update({
      pv, camBody: u.clone().multiplyScalar(R + 160), now: 1, real: 1, decals: { add: (d: Decal) => { decals.push(d); } } as unknown as DecalPass,
      vfx: { emit: () => 1, alive: () => true, set: () => {}, stop: () => {} } as unknown as SignsFrame['vfx'],
      ticksSinceSnap: 0, personAt: (id) => (id === who ? [feet.x, feet.y, feet.z, 1.7] : null),
    });
    const r = { rings: decals.filter((d) => d.type === 15).length, beams: q.marks.beams.count };
    q.dispose();
    return r;
  };
  const seen = draw(4), unseen = draw(null);
  assert.ok(seen.rings >= 1 && unseen.rings >= 1, 'the failed word rings the town');
  assert.equal(seen.beams, 1, 'the thread drawn up off them');
  assert.equal(unseen.beams, 0, 'nobody drawn: no thread');
});

test('signs: the lightning sigil read as a sign leaves its struck place glowing; unread, or read as another sign, nothing', () => {
  const R = 3000;
  const kinds = (s: SignsLayer) => (s as unknown as { moments: { kind: string; p: Vector3 }[] }).moments;
  // the strike (miracle.lightning: data.god) a little way from the town, then the town reads it (omensOfCommand)
  const strike: [number, number, number] = [Math.sin(0.1), Math.cos(0.1), 0];
  const s = new SignsLayer({});
  s.onEvent({ t: 'lightning', tick: 6, planet: 0, pos: strike, a: 1.5, data: { cell: 4, god: 0 } }, R, 10);
  assert.equal(kinds(s).length, 0, 'a strike alone is no sign');
  s.onEvent({ t: 'omen', tick: 6, planet: 0, pos: [0, 1, 0], text: 'lightning', data: { kind: 'lightning', settlement: 1, reading: 'trusted' } }, R, 10.1);
  const m = kinds(s);
  assert.deepEqual(m.map((x) => x.kind), ['omen', 'strike'], 'the town reads it, and the struck place glows');
  assert.ok(m[1].p.distanceTo(new Vector3(...strike).multiplyScalar(R)) < 1e-6, 'at the strike, not at the town');
  // read once: a second reading of the same strike marks nothing more
  s.onEvent({ t: 'omen', tick: 7, planet: 0, pos: [0, 1, 0], data: { kind: 'lightning', reading: 'feared' } }, R, 10.2);
  assert.equal(kinds(s).filter((x) => x.kind === 'strike').length, 1);
  // a strike followed by another omen's reading, or read long after, or by a town far away: no glowing place
  for (const [kind, dt, pos] of [['rainbow', 0.1, [0, 1, 0]], ['lightning', 9, [0, 1, 0]], ['lightning', 0.1, [0, -1, 0]]] as [string, number, [number, number, number]][]) {
    const q = new SignsLayer({});
    q.onEvent({ t: 'lightning', tick: 6, planet: 0, pos: strike, data: { god: 0 } }, R, 20);
    q.onEvent({ t: 'omen', tick: 6, planet: 0, pos, data: { kind, reading: 'trusted' } }, R, 20 + dt);
    assert.equal(kinds(q).filter((x) => x.kind === 'strike').length, 0, `${kind} after ${dt} s at ${pos}`);
    q.dispose();
  }
  s.dispose();
});

test('signs: a holy place is a thread of light from the god\'s height and a point of its light from orbit', () => {
  const pv = { ...slopeWorld(), id: 0, settlements: [], agents: undefined, animals: undefined } as unknown as PlanetView;
  const R = 3000;
  const s = new SignsLayer({});
  const u = new Vector3(0.6, 0.05, 0.8).normalize();
  s.onEvent({ t: 'sacred.place', tick: 1, planet: 0, pos: [u.x, u.y, u.z], data: { id: 3, kind: 'mountain', settlement: -1 } }, R, 0);
  const frame = (camAlt: number) => {
    const cam = u.clone().multiplyScalar(R + camAlt).add(new Vector3(0, camAlt * 0.3, 0));
    s.update({
      pv, camBody: cam, now: 1, real: 1, decals: { add: () => {} } as unknown as DecalPass,
      vfx: { emit: () => 1, alive: () => true, set: () => {}, stop: () => {} } as unknown as SignsFrame['vfx'],
      ticksSinceSnap: 0, personAt: () => null,
    });
    return { beams: s.marks.beams.count, glints: s.marks.glints.count };
  };
  const god = frame(600), orbit = frame(5000);
  assert.ok(god.beams >= 1, 'from the god\'s height its thread stands over it');
  assert.equal(orbit.beams, 0, 'from orbit no thread stands off the world into space');
  assert.ok(orbit.glints > god.glints - 1 && orbit.glints >= 1, 'from orbit a point of its light marks it');
  assert.equal(s.stats.places, 1);
  s.dispose();
});

/** a small world whose ground slopes from sea up to land along x: the coast runs north–south through x = 0 */
function slopeWorld(): PlanetView {
  const grid = getGrid(24), R = 3000;
  const surface = new Float32Array(grid.count), water = new Float32Array(grid.count), z = new Float32Array(grid.count);
  for (let c = 0; c < grid.count; c++) {
    surface[c] = grid.pos[c * 3] * 60;
    water[c] = Math.max(0, -surface[c]);
  }
  const ground = { grid, radius: R, noise: new Noise3(1), surface, soil: z, sand: z, snow: z, grad: null };
  return { grid, ground, params: { radius: R }, fields: new Map([['water', water], ['surface', surface]]) } as unknown as PlanetView;
}

test('the sea drawing back: the coast\'s shallow band is laid on the ground, never the open sea or the dry land', () => {
  const pv = slopeWorld();
  const R = 3000;
  const coast = new Vector3(0, 0, 1).multiplyScalar(R);
  const db = new Drawback({}, {}, pv, coast, 1500);
  assert.ok(db.tris > 4, `coast triangles found (${db.tris})`);
  const pos = db.mesh.geometry.getAttribute('position'), dep = db.mesh.geometry.getAttribute('aDepth');
  let wet = 0, sum = 0;
  for (let i = 0; i < pos.count; i++) {
    // (a triangle is taken when a corner lies in the shallows: its other corners may reach a little deeper)
    const d = dep.getX(i);
    assert.ok(d >= 0 && d < DRAWBACK_MAX * 2.5, `a shallow depth (${d})`);
    sum += d;
    if (d > 0.02) wet++;
    // on the ground (the ground's own height, a hand's breadth over it)
    const l = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    assert.ok(Math.abs(l - R) < 40, `on the ground (${(l - R).toFixed(1)})`);
    // within the reach of the wave
    assert.ok(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).distanceTo(coast) < 1500 + 400, 'near the wave');
  }
  assert.ok(wet > pos.count * 0.3, 'most of it is seabed');
  assert.ok(sum / pos.count < DRAWBACK_MAX, `the shallows, not the open sea (mean ${(sum / pos.count).toFixed(2)} m)`);
  db.update(2, 1, coast);
  assert.ok(db.mesh.visible);
  db.update(2, 0, coast);
  assert.ok(!db.mesh.visible, 'faded: gone');
  // far inland (no sea in reach): nothing
  const inland = new Drawback({}, {}, pv, new Vector3(0.9, 0, Math.sqrt(1 - 0.81)).multiplyScalar(R), 400);
  assert.equal(inland.tris, 0);
  db.dispose(); inland.dispose();
});
