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

const blast = (kind: string, R: number): { emits: ED[]; white: number; light: number } => {
  const emits: ED[] = [];
  let lights = 0;
  const flash = new V3();
  const p = new V3(0, 6.4e6, 0);
  const ctx = {
    now: 0, dt: 1 / 60, camBody: new V3(0, 6.4e6 + 600, 1200), q: 1,
    vfx: { emit: (d: ED) => { emits.push(d); return emits.length; }, set: () => { /* */ }, alive: () => true, stop: () => { /* */ } },
    decals: { add: (d: { kind?: number; type?: number; p1: number }) => { lights = Math.max(lights, d.p1 ?? 0); } },
    debris: { burst: () => { /* */ } },
    screen: { flash },
  } as unknown as Ctx;
  const fx = new DFx({}, {}) as unknown as { impact(p: V3, R: number, I: number, c: Ctx, k: string): void; transients: { t0: number; step(a: number, k: number, c: Ctx): void }[] };
  fx.impact(p, R, 1, ctx, kind);
  let white = 0;
  for (const age of [0, 0.03, 0.1, 0.3]) {
    flash.set(0, 0, 0);
    for (const t of fx.transients) t.step(age, age / 3, ctx);
    white = Math.max(white, flash.x);
  }
  return { emits, white, light: lights };
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
  // the meteor keeps its strike
  const m = blast('meteor', 120);
  assert.ok(m.emits.some((d) => d.sys === S.flash && d.size >= 120 * 2.5), "the meteor's flash is unchanged");
  assert.ok(m.white > 0.3, "the meteor's whiteout is unchanged");
});
