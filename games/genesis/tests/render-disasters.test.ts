// GENESIS — every disaster the sim can spawn has a picture (render/fx/disasters.ts).
//
// The renderer draws a disaster by its kind (DisasterView.kind = the disasters.json id). When the fantasy 'leviathan'
// became the real 'rogue-wave', the render switch kept only a dead 'leviathan' case (a sea serpent) and the new id fell
// through to `default: break` — the Rogue wave power drew nothing. This guards both: no id goes dark, and no creature
// is drawn for a disaster (real animals only; no creature — LIVING §0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/render/fx/disasters.ts', import.meta.url), 'utf8');
const DATA = JSON.parse(readFileSync(new URL('../src/data/disasters.json', import.meta.url), 'utf8')) as unknown;
const defs = (Array.isArray(DATA) ? DATA : (DATA as { disasters?: unknown[] }).disasters ?? []) as { id: string; aliases?: string[] }[];

test('every disasters.json id (and alias) reaches its own case in DisasterFx', () => {
  assert.ok(defs.length > 20, `disasters read (${defs.length})`);
  const cases = new Set([...SRC.matchAll(/case '([a-z0-9-]+)'/g)].map((m) => m[1]));
  const missing = defs.filter((d) => !cases.has(d.id)).map((d) => d.id);
  assert.deepEqual(missing, [], `disaster kinds with no picture: ${missing.join(', ')}`);
  assert.ok(cases.has('rogue-wave'), 'the rogue wave is drawn');
});

test('no creature is drawn for a disaster (the old leviathan serpent is gone)', () => {
  assert.ok(!/serpent|humps|archGeo/.test(SRC), 'no sea-serpent code left in the disaster renderer');
  // the old alias draws the same wave as the real kind
  assert.match(SRC, /case 'rogue-wave':\s*case 'leviathan':/);
});

// ── punch P03: the volcano's opening blast is not a meteor's strike ──
// The sim's volcano carries an 'impact' effector at its start (shock and fire, no crater; disasters.json), emitted as an
// 'impact' event with data.kind 'volcano'. DisasterFx.impact drew it as a meteor: a 676 m sphere of cream light (R 260
// × 2.6, p1 300), the view's whiteout, a white-hot fireball and a mushroom column — at night from 1.3 km an erupting
// volcano was a white disc filling the frame (rp3-vol-no26: hiding the flash alone took > 235 from 10.7 % to 0.6 %).
import { Vector3 as V3 } from 'three';
import { DisasterFx as DFx, type FxCtx as Ctx } from '../src/render/fx/disasters.ts';
import { SYS as S, type EmitterDef as ED } from '../src/render/fx/vfx.ts';

const blast = (kind: string, R: number, air = false, camFwd?: V3): { emits: ED[]; white: number; light: number; types: Set<number>; fx: { transients: { t0: number; dur: number }[] } } => {
  const emits: ED[] = [];
  let lights = 0;
  const types = new Set<number>();
  const flash = new V3();
  const p = new V3(0, 6.4e6, 0);
  const ctx = {
    now: 0, dt: 1 / 60, camBody: new V3(0, 6.4e6 + 600, 1200), q: 1,
    vfx: { emit: (d: ED) => { emits.push(d); return emits.length; }, set: () => { /* */ }, alive: () => true, stop: () => { /* */ } },
    decals: { add: (d: { kind?: number; type?: number; p1: number }) => { types.add(d.type ?? -1); if (d.type === 10) lights = Math.max(lights, d.p1 ?? 0); } },
    debris: { burst: () => { /* */ } },
    screen: { flash },
    camFwd,
  } as unknown as Ctx;
  const fx = new DFx({}, {}) as unknown as { impact(p: V3, R: number, I: number, c: Ctx, k: string, air?: boolean): void; transients: { t0: number; dur: number; step(a: number, k: number, c: Ctx): void }[] };
  fx.impact(p, R, 1, ctx, kind, air);
  let white = 0;
  for (const age of [0, 0.03, 0.1, 0.3]) {
    flash.set(0, 0, 0);
    for (const t of fx.transients) t.step(age, age / Math.max(t.dur, 1e-3), ctx);
    white = Math.max(white, flash.x);
  }
  for (const t of fx.transients) t.step(5, 5 / Math.max(t.dur, 1e-3), ctx);
  return { emits, white, light: lights, types, fx };
};

test("a volcano's opening blast draws an eruption at its vent, not a meteor's sphere of white light (punch P03)", () => {
  const R = 260;
  const v = blast('volcano', R);
  const fl = v.emits.filter((d) => d.sys === S.flash);
  for (const d of fl) {
    assert.ok(d.size <= R * 0.5, `the vent's flash is ${d.size.toFixed(0)} m across (the meteor's was ${(R * 2.6).toFixed(0)} m)`);
    assert.ok((d.p1 ?? 0) <= 40, `the vent's flash is a gout of fire, not a white sun (p1 ${d.p1})`);
    assert.ok((d.b ?? 1) < 0.4 && (d.g ?? 1) < 0.7, `the vent's flash is orange (${d.r}/${d.g}/${d.b})`);
  }
  assert.equal(v.white, 0, 'no whiteout of the view for an eruption');
  assert.ok(!v.emits.some((d) => d.sys === S.plume || d.sys === S.fireball), "no meteor's mushroom column or white-hot fireball (the volcano draws its own ash column)");
  assert.ok(v.emits.some((d) => d.sys === S.arcGlow) && v.emits.some((d) => d.sys === S.shockRing), 'bombs on arcs and a surge of ash down the slopes');
  // the meteor keeps its strike (its own flash and wash, bounded since punch P07)
  const m = blast('meteor', 120);
  assert.ok(m.emits.some((d) => d.sys === S.flash && d.size >= 120 * 1.5), "the meteor's strike still flashes");
  assert.ok(m.white > 0.15, "the meteor's strike still washes the view for an instant");
});

// ── punch P07: a meteor at the regional view was a milky sheet; the default meteor is an airburst ──
// At the default wrath (< AIRBURST_W) the sim's meteor bursts in the air (an 'impact' event with data.airburst, no
// crater dug) but DisasterFx drew a ground strike: white-hot puffs on the town, a mushroom column, ejecta and a glowing
// crater; every strike washed the view .55 white wherever the camera looked and lit the land at full flash for 14 s; a
// ground strike left no crater read once its scorch faded.
test('a meteor that bursts in the air draws an airburst, a strike is bounded and leaves a crater (punch P07)', () => {
  const R = 48;
  const a = blast('meteor', R, true);
  assert.ok(!a.emits.some((d) => d.sys === S.plume || d.sys === S.ejecta || d.sys === S.arcGlow), 'no column, ejecta or thrown rock from the ground');
  const fb = a.emits.filter((d) => d.sys === S.fireball);
  assert.ok(fb.length > 0 && fb.every((d) => new V3(d.x, d.y, d.z).length() - 6.4e6 >= 80), 'its fireball is high in the air, not on the town');
  assert.ok(a.emits.some((d) => d.sys === S.shockRing), 'the blast reaches the ground as a ring of dust');
  assert.ok(!a.types.has(16) && !a.types.has(3), 'no crater and no crater glow (the sim digs none)');
  assert.ok(a.types.has(5), 'the ground under it is scorched');
  assert.ok(a.white > 0 && a.white <= 0.12, `an airburst's wash is slight (${a.white.toFixed(2)})`);
  // the ground strike (wrath >= .5): bounded, and the crater stays
  const g = blast('meteor', R);
  assert.ok(g.white <= 0.25, `a strike's wash is at most a quarter (${g.white.toFixed(2)}; it was .55)`);
  for (const d of g.emits.filter((e) => e.sys === S.flash)) assert.ok((d.p1 ?? 0) <= 150 && d.size <= R * 2, `the strike's flash p1 ${d.p1} size ${d.size}`);
  assert.ok(g.types.has(16), "a ground strike lays a crater decal");
  assert.ok(g.fx.transients.some((t) => t.dur >= 600), 'the crater outlasts the scorch (minutes, not seconds)');
  // the wash is for a strike in view: one behind the camera does not whiten the screen
  const behind = blast('meteor', R, false, new V3(0, 0, 1));
  assert.equal(behind.white, 0, 'a strike behind the camera does not wash the view');
});

// ── punch P23: lava bombs drawn as glowing arcs, not upright bars ──
// Each bomb (SYS.arcGlow) was one straight streak along its flight, stretched 2.5x: a volcano's spray of them read as
// upright bars. The head now trails a tail of the same rock a moment earlier along its parabola.
test('lava bombs trail a glowing tail along their arcs (punch P23)', async () => {
  const VFX = readFileSync(new URL('../src/render/fx/vfx.ts', import.meta.url), 'utf8');
  const { ARC_TAIL } = await import('../src/render/fx/vfx.ts');
  assert.ok(ARC_TAIL >= 6, `a bomb is drawn with ${ARC_TAIL} pieces`);
  const br = VFX.slice(VFX.indexOf('} else if (S == 44 || S == 29) {'), VFX.indexOf('} else if (S == 46) {'));
  assert.match(br, /floor\(idx \/ \$\{ARC_TAIL\}\.0\)/, 'one arc per ARC_TAIL instances');
  assert.match(br, /float tt = tAll - kk \* dtT;/, 'the tail is the same rock earlier along its flight');
  const dt = Number((/float dtT = min\(([\d.]+),/.exec(br) ?? [])[1]);
  assert.ok(dt * (ARC_TAIL - 1) >= 0.8, `the tail spans ${(dt * (ARC_TAIL - 1)).toFixed(2)} s of flight (a curve, not a dash)`);
  // every emitter of bombs passes whole arcs
  const counts = [...SRC.matchAll(/sys: SYS\.arcGlow[^}]*count: ([^,]+),/g)].map((m) => m[1].trim());
  assert.ok(counts.length >= 3, 'the bomb emitters found');
  for (const c of counts) assert.match(c, /\* ARC_TAIL$/, `bomb count ${c} is in whole arcs`);
  const v = blast('volcano', 260);
  const bombs = v.emits.filter((d) => d.sys === S.arcGlow);
  assert.ok(bombs.length > 0 && bombs.every((d) => d.count % ARC_TAIL === 0 && d.count / ARC_TAIL >= 10), 'the eruption throws its bombs in whole arcs');
});

// ── punch P23: a partial eclipse draws its crescent ──
// The star is ~0.27° across: 2 px of a 540-px view. The occluder was a black disc of that size, so a partial eclipse
// drew no figure at all (only the dimming). Model the overlay at 0.82 coverage (the year-long eclipse's) on a 540-px
// view and count the crescent's pixels.
test('a partial eclipse draws a readable crescent (punch P23)', () => {
  const SFX = readFileSync(new URL('../src/render/fx/screenfx.ts', import.meta.url), 'utf8');
  const blk = SFX.slice(SFX.indexOf('// ── the eclipse:'), SFX.indexOf('// ── totality:'));
  const minPx = Number((/float R = max\(uSunR, ([\d.]+) \/ max\(uResolution\.y, 1\.0\)\);/.exec(blk) ?? [])[1]);
  assert.ok(minPx >= 5, `the eclipse figure is at least ${minPx} px in radius`);
  assert.match(blk, /float cres = sunD \* \(1\.0 - disc\) \* part;/, 'the uncovered crescent is drawn at partial phases');
  assert.match(blk, /vec3\([\d., ]+\) \* cres \* (\d+)\.0/, 'the crescent is lit like the star');
  // the shape: a 540-px view, true radius 2 px, coverage 0.82
  const H = 540, R = Math.max(2 / H, minPx / H), ecl = 0.82, off = [R * 2 * (1 - ecl), R * 2 * (1 - ecl) * 0.35];
  let lit = 0, bite = 0;
  for (let y = -20; y <= 20; y++) for (let x = -20; x <= 20; x++) {
    const dv = [x / H, y / H];
    const inSun = Math.hypot(dv[0], dv[1]) < R, inMoon = Math.hypot(dv[0] - off[0], dv[1] - off[1]) < R;
    if (inSun && !inMoon) lit++;
    if (inSun && inMoon) bite++;
  }
  assert.ok(lit >= 15 && bite >= lit, `a crescent of ${lit} lit px beside a bite of ${bite} px`);
});
