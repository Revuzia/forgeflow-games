// GENESIS — the god's presence, generated (render lane; LIVING §0.1.6–7, §3.6, hooks H6–H8), without a GPU:
//   * the Touch (gen/handgen.ts): its look follows regard — warm daylight trusted, storm-dark and crackling feared —
//     monotonically; open, its mantle rides the whirl up from a wide foot on the ground; holding, it gathers into a
//     closed cradle round what it holds (every tuft near the cradle, on all sides of it, the crown left open), the
//     low tufts last; the cradle fits a person, a boulder, a tree; its geometry is well formed; a crackle's arc is a
//     connected jagged channel from one end to the other; nothing of it is a hand (no fingers, no palm)
//   * the creature is gone from the renderer: no creature layer or generator module ships
//   * the sigils (fx/sigils.ts): every power's `sigil` in powers.json has an authored, evenly sampled stroke inside
//     the unit box; each miracle draws its power's sigil; none of them reads as one of the old gesture shapes (circle,
//     spiral, zigzag, triangle, V, square, star — a $1-style shape distance); an invented miracle draws the original
//     fallback glyph
//   * the signs (render/signs): prophets and the Called are found by AgentFlag2, a sacred animal by its id or the old
//     id it replaced, the sim's events become sacred places and moments (an ordinary strike is no sign); the sea's
//     drawback before a tsunami (fx/drawback.ts) lies on the coast's shallows, on the ground, never inland
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BufferGeometry } from 'three';
import {
  CRADLE_ALPHA, TOUCH_N, bandGeometry, crackleArc, cradleOf, discGeometry, gathered, mantlePoint, moteGeometry, stripGeometry, touchLook,
  touchRng, tuftGeometry, vortexR, type VortexFrame,
} from '../src/render/gen/handgen.ts';
import * as handgen from '../src/render/gen/handgen.ts';
import { FALLBACK_SIGIL, SIGIL_IDS, sigilOfMiracle, sigilStroke } from '../src/render/fx/sigils.ts';
import { BASE_PACK } from '../src/data/index.ts';

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

test('every sigil of the content is an original authored stroke, and each miracle draws its power\'s sigil', () => {
  const powers = ((BASE_PACK as unknown as { powers: { id: string; command: string; params?: { kind?: string }; sigil?: string | null }[] }).powers);
  const used = powers.filter((p) => p.sigil);
  assert.ok(used.length >= 14, `the powers carry sigils (${used.length})`);
  for (const p of used) {
    assert.ok(SIGIL_IDS.includes(p.sigil!), `${p.id}: sigil '${p.sigil}' is authored`);
    // the miracle the power casts draws that sigil
    const kind = p.command.startsWith('miracle.') ? p.command.slice(8) : p.params?.kind;
    if (kind && p.command !== 'miracle.cast') assert.equal(sigilOfMiracle(kind), p.sigil, `${kind} draws ${p.sigil}`);
  }
  const prims = primitives();
  // (the measure itself: a wobbly circle is a circle)
  const wob = resample(prims.circle, 64).map((q, i) => [q[0] + 0.08 * Math.sin(i * 1.7), q[1] + 0.08 * Math.cos(i * 2.3)] as P2);
  assert.ok(shapeDistance(normalise(wob), normalise(resample(prims.circle, 64))) < 0.07, 'the measure finds a circle');
  for (const id of SIGIL_IDS) {
    const s = sigilStroke(id, 64);
    assert.equal(s.length, 128);
    let total = 0, hi = 0;
    for (let i = 0; i < 64; i++) {
      assert.ok(Math.abs(s[i * 2]) <= 1.05 && Math.abs(s[i * 2 + 1]) <= 1.05, `${id}: inside the unit box`);
      if (i) { const d = Math.hypot(s[i * 2] - s[i * 2 - 2], s[i * 2 + 1] - s[i * 2 - 1]); total += d; hi = Math.max(hi, d); }
    }
    // equal arc length per sample (a chord across a sharp turn is shorter than the arc: the bound is on the longest)
    assert.ok(hi < (total / 63) * 1.6, `${id}: evenly sampled (longest ${hi.toFixed(4)}, mean ${(total / 63).toFixed(4)})`);
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
  // an invented miracle draws the original fallback, which is authored
  assert.equal(sigilOfMiracle('no-such-miracle'), FALLBACK_SIGIL);
  assert.deepEqual(sigilStroke('no-such-sigil', 32), sigilStroke(FALLBACK_SIGIL, 32));
});

// ───────────────────────────── signs (render/signs, render/fx/drawback) ─────────────────────────────

import { AgentFlag2 } from '../src/sim/types.ts';
import { PLACE_LOOK, SignsLayer, animalIndex, markedPeople } from '../src/render/signs/signs.ts';
import { DRAWBACK_MAX, Drawback } from '../src/render/fx/drawback.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';
import { Vector3 } from 'three';
import type { PlanetView } from '../src/client/worldview.ts';

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
  const m = (s as unknown as { moments: { kind: string; col: number[] }[] }).moments;
  assert.deepEqual(m.slice(before).map((x) => x.kind), ['omen', 'strike', 'called'], 'an ordinary strike is no sign');
  assert.ok(m[before].col[2] > m[before].col[0], 'anger reads cold');
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
