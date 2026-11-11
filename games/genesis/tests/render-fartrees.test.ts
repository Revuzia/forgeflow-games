// PERF P2 (session 6) — the far-tree layer (src/render/life/vegetation.ts farUpdate, farcrown.ts): every forest cell
// past the near range is drawn from the SAME plant records and instance data as the near trees, placed into the far
// buckets' slots incrementally. Checks, over a flight (descent, pan, climb) and field changes:
//   * every placed cell's slots hold exactly its block (matrix, tint, extra + role), no two slots overlap, every other
//     instance below a bucket's high-water mark is a zero (degenerate) matrix, live counts add up;
//   * placement = what the cell needs at the camera (farNeed), once the queue is empty;
//   * a block equals a fresh make of the cell after tree / snow fields change (only the cells around a change re-made);
//   * the hulls carry the vegetation material's attributes and stay inside the tree's unit box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';
import { GroundGradients } from '../src/client/groundgrad.ts';
import { Vegetation } from '../src/render/life/vegetation.ts';
import { farCrownGeometry } from '../src/render/life/farcrown.ts';
import { SHRUB_KINDS, TREE_KINDS } from '../src/render/gen/treegen.ts';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const SHARED = { uTime: { value: 0 }, uWindDir: { value: null }, uCamBody: { value: null }, uBodyToView: { value: null }, uSunDirBody: { value: null } } as never;

type FB = { mesh: { instanceMatrix: { array: Float32Array }; instanceColor: { array: Float32Array } }; extra: { array: Float32Array }; hull: { array: Float32Array }; hi: number; live: number; band: number; lod: number; free: number[] };
type Blk = { n: number; keys: number[]; starts: number[]; m: Float32Array; c: Float32Array; e: Float32Array; stale: boolean };
type V = {
  update(pv: unknown, cam: Vector3, frame: number): void; far: (FB | undefined)[]; blocks: Map<number, Blk>;
  placed: Map<number, { f: number; s0: number[]; s1: number[]; band: number }>; farNeed(b: Blk, cam: Vector3, inner: number, slack: number): number;
  farCam: Vector3; farWant: number[]; farWantAt: number; makeBlock(pv: unknown, c: number, env: unknown, keep: boolean): Blk; cache: Map<number, Float32Array>;
  cellPlants(pv: unknown, c: number): Float32Array; pxPerRad: number; range: number; farStats: { instances: number; queue: number };
};

function world() {
  const grid = getGrid(32), n = grid.count, R = 3000, r = rng(11);
  const nz = new Noise3(4);
  const f = (gen: (c: number) => number) => Float32Array.from({ length: n }, (_, c) => gen(c));
  const P = grid.pos;
  const fields = new Map<string, Float32Array>();
  fields.set('tree', f((c) => Math.max(0, Math.min(1, 0.4 + nz.noise(P[c * 3] * 3, P[c * 3 + 1] * 3, P[c * 3 + 2] * 3) * 1.4))));
  fields.set('shrub', f(() => r() * 0.5)); fields.set('burnt', f(() => 0));
  fields.set('water', f(() => 0)); fields.set('temperature', f(() => 14)); fields.set('moisture', f(() => 0.6));
  fields.set('snow', f(() => 0)); fields.set('crop', f(() => 0)); fields.set('road', f(() => 0));
  fields.set('sand', f(() => 0)); fields.set('soil', f(() => 0.5)); fields.set('treeSpecies', f(() => -1)); fields.set('shrubSpecies', f(() => -1));
  fields.set('fire', f(() => 0));
  const surface = f((c) => 40 + 25 * Math.sin(P[c * 3] * 9) * Math.cos(P[c * 3 + 2] * 7));
  fields.set('surface', surface);
  const gg = new GroundGradients(grid);
  gg.update(surface, R);
  const noise = new Noise3(5);
  const pv = {
    grid, noise, params: { radius: R }, fields, fieldVersion: new Map([['surface', 1]]), groundRev: gg, maxSurface: 70,
    ground: { grid, radius: R, noise, surface, soil: fields.get('soil')!, sand: fields.get('sand')!, snow: fields.get('snow')!, grad: gg.grad },
  };
  return { pv, grid, n, R, fields };
}

function checkSlots(v: V): number {
  let live = 0;
  const cover = new Map<number, Uint8Array>();
  for (const [c, st] of v.placed) {
    const blk = v.blocks.get(c)!;
    assert.ok(blk, `placed cell ${c} has a block`);
    for (const [lod, sl] of [[0, st.s0], [1, st.s1]] as const) {
      assert.equal(sl.length > 0, (st.f & (1 << lod)) !== 0 && blk.n > 0, `cell ${c} lod ${lod} slots vs flags`);
      for (let k = 0; k < sl.length; k += 3) {
        const b = v.far[sl[k]]!;
        assert.equal(b.lod, lod);
        assert.equal(b.band, st.band, 'the cell sits in its band\'s bucket');
        assert.equal(sl.length, 3, 'one slot range per lod: every kind of the cell together');
        const at = sl[k + 1], n = sl[k + 2];
        const j0 = 0;
        assert.equal(n, blk.n);
        // each tree's hull: its kind / variant's row of the table for this lod
        for (let g = 0; g < blk.keys.length; g++) for (let q = blk.starts[g]; q < blk.starts[g + 1]; q++) assert.equal(b.hull.array[at + q], blk.keys[g] * 2 + lod, 'hull id');
        let cv = cover.get(sl[k]); if (!cv) { cv = new Uint8Array(b.mesh.instanceMatrix.array.length / 16); cover.set(sl[k], cv); }
        for (let q = 0; q < n; q++) {
          assert.ok(at + q < b.hi, 'slot below the high-water mark');
          assert.equal(cv[at + q], 0, `slot overlap in bucket ${sl[k]} at ${at + q}`);
          cv[at + q] = 1;
          for (let e = 0; e < 16; e++) if (b.mesh.instanceMatrix.array[(at + q) * 16 + e] !== blk.m[(j0 + q) * 16 + e]) assert.fail(`matrix of cell ${c} differs`);
          for (let e = 0; e < 3; e++) assert.equal(b.mesh.instanceColor.array[(at + q) * 3 + e], blk.c[(j0 + q) * 3 + e]);
          for (let e = 0; e < 3; e++) assert.equal(b.extra.array[(at + q) * 4 + e], blk.e[(j0 + q) * 4 + e]);
          assert.ok(Math.abs(b.extra.array[(at + q) * 4 + 3] - (blk.e[(j0 + q) * 4 + 3] + 6 + lod)) < 1e-5, 'role');
        }
        live += n;
      }
    }
  }
  let liveB = 0;
  for (let id = 0; id < v.far.length; id++) {
    const b = v.far[id]; if (!b) continue;
    liveB += b.live;
    const cv = cover.get(id);
    for (let i = 0; i < b.hi; i++) if (!cv || !cv[i]) for (let e = 0; e < 16; e++) if (b.mesh.instanceMatrix.array[i * 16 + e] !== 0) assert.fail(`unowned instance ${i} of bucket ${id} is not zero`);
  }
  assert.equal(liveB, live, 'live counts');
  return live;
}

function settle(v: V, pv: unknown, cam: Vector3, frame: { n: number }): void {
  for (let i = 0; i < 4000; i++) { v.update(pv, cam, frame.n++); if (v.farStats.queue === 0 && i > 2) break; }
  assert.equal(v.farStats.queue, 0, 'queue drained');
}

test('far trees: slots hold their blocks, placement follows the camera, through a flight', () => {
  const { pv, R } = world();
  const v = new Vegetation(SHARED) as unknown as V;
  v.pxPerRad = 536;
  const frame = { n: 0 };
  const dir = new Vector3(0.3, 0.8, 0.52).normalize();
  const side = new Vector3(0, 0, 1).cross(dir).normalize();
  let lastLive = -1;
  for (const [alt, pan] of [[2000, 0], [1200, 0.02], [600, 0.05], [300, 0.08], [150, 0.1], [60, 0.12], [400, 0.3], [1500, 0.3]] as const) {
    const cam = dir.clone().addScaledVector(side, pan).normalize().multiplyScalar(R + 60 + alt);
    settle(v, pv, cam, frame);
    const live = checkSlots(v);
    for (const [c, st] of v.placed) {
      const blk = v.blocks.get(c)!;
      if (!blk.stale) assert.equal(st.f, v.farNeed(blk, v.farCam, v.range * 0.72, 1.15), `cell ${c} at alt ${alt}`);
    }
    assert.ok(live > 0, `far trees at alt ${alt}`);
    lastLive = live;
  }
  assert.ok(lastLive > 0);
});

test('far trees: a changed tree / snow field re-makes only the blocks around it, each equal to a fresh make', () => {
  const { pv, R, n, fields } = world();
  const v = new Vegetation(SHARED) as unknown as V;
  v.pxPerRad = 536;
  const frame = { n: 0 };
  const cam = new Vector3(0.3, 0.8, 0.52).normalize().multiplyScalar(R + 60 + 500);
  settle(v, pv, cam, frame);
  checkSlots(v);
  const before = new Map(v.blocks);
  const r = rng(5);
  const tree = Float32Array.from(fields.get('tree')!);
  const changed = new Set<number>();
  for (let k = 0; k < 6; k++) { const c = [...before.keys()][Math.floor(r() * before.size)]; tree[c] = 1 - tree[c]; changed.add(c); }
  fields.set('tree', tree);
  const snow = Float32Array.from(fields.get('snow')!);
  for (let k = 0; k < 6; k++) { const c = [...before.keys()][Math.floor(r() * before.size)]; snow[c] = 0.5; }
  fields.set('snow', snow);
  settle(v, pv, cam, frame);
  let remade = 0, kept = 0;
  for (const [c, blk] of v.blocks) {
    if (before.get(c) === blk) kept++; else remade++;
    const env = (v as unknown as { farEnv: string }).farEnv; void env;
  }
  assert.ok(remade > 0 && kept > remade * 3, `remade ${remade} kept ${kept} (only the cells around a change)`);
  // every block equals a fresh make of its cell from the current fields
  const fresh = new Vegetation(SHARED) as unknown as V & { farEnv: string; seasonStep: number };
  (fresh as unknown as { seasonStep: number }).seasonStep = (v as unknown as { seasonStep: number }).seasonStep;
  const env = { autumn: 0, winterK: 0, yfH: 0, snowF: fields.get('snow'), burntF: fields.get('burnt'), fireF: fields.get('fire'), treeF: fields.get('tree') };
  const yf = (v as unknown as { yearFrac: number }).yearFrac;
  assert.equal(yf, 0);
  // (yearFrac 0: the env of plantEnv(pv, dy >= 0, 0) — autumn 0, winterK 1 - smooth(0.06, 0.14, 0) = 1)
  env.winterK = 1;
  let checked = 0;
  for (const [c, blk] of v.blocks) {
    const f = fresh.makeBlock(pv, c, env, false);
    assert.equal(f.n, blk.n, `cell ${c} tree count`);
    for (let i = 0; i < f.m.length; i++) if (f.m[i] !== blk.m[i]) assert.fail(`cell ${c} matrix stale`);
    for (let i = 0; i < f.e.length; i++) if (f.e[i] !== blk.e[i]) assert.fail(`cell ${c} extra stale (snow / char)`);
    checked++;
  }
  assert.ok(checked > 50);
  checkSlots(v);
  void n;
});

test('far hulls: vegetation attributes, unit box, few triangles', () => {
  for (const kind of TREE_KINDS) {
    if (SHRUB_KINDS.includes(kind) || kind === 'kelp') continue; // (the far layer draws trees only)
    for (const lod of [0, 1] as const) {
      const g = farCrownGeometry(kind, 0, lod, null);
      for (const a of ['position', 'normal', 'color', 'aWind', 'aLeafUv', 'aCard', 'aCrown']) assert.ok(g.getAttribute(a), `${kind} ${a}`);
      const p = g.getAttribute('position').array as Float32Array;
      const tris = g.index!.count / 3;
      assert.ok(p.length / 3 <= (lod === 0 ? 24 : 10), `${kind} lod ${lod}: ${p.length / 3} vertices`);
      assert.ok(tris <= (lod === 0 ? 36 : 16), `${kind} lod ${lod}: ${tris} triangles`);
      for (let i = 0; i < p.length; i++) assert.ok(Number.isFinite(p[i]) && Math.abs(p[i]) <= 1.6, `${kind} position in the unit box`);
      const c = g.getAttribute('color').array as Float32Array;
      for (let i = 0; i < c.length; i++) assert.ok(Number.isFinite(c[i]) && c[i] >= 0 && c[i] < 2, `${kind} colour`);
    }
  }
});

test('far bands: a band left out of a shadow cascade holds no tree whose shadow could reach it (PERF item 3)', async () => {
  const { treeShadowReach } = await import('../src/render/life/vegetation.ts');
  const { pv, R } = world();
  const v = new Vegetation(SHARED) as unknown as V & { farShadow(k: number, cx: number, cy: number, cz: number, r: number, sinEl: number, radius: number, cam?: Vector3, nearSplit?: number, margin?: number): void; farEMax: number };
  v.pxPerRad = 536;
  const frame = { n: 0 };
  const dir = new Vector3(0.3, 0.8, 0.52).normalize();
  const rnd = rng(77);
  let hidden = 0, shown = 0, bands = new Set<number>(), minSlack = Infinity;
  for (const alt of [120, 400, 1200]) {
    const cam = dir.clone().normalize().multiplyScalar(R + 60 + alt);
    settle(v, pv, cam, frame);
    for (const st of v.placed.values()) bands.add(st.band);
    for (let trial = 0; trial < 300; trial++) {
      // the camera moved a little since the bounds' anchor; a cascade sphere ahead of it; a sun from 8 to 80 degrees
      const camNow = cam.clone().add(new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(30));
      const look = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      let C = camNow.clone().addScaledVector(look, 100 + rnd() * 1500);
      const r = 80 + rnd() * 700, el = (rnd() < 0.7 ? 7 + rnd() * 15 : 22 + rnd() * 60) * Math.PI / 180, nearSplit = rnd() < 0.5 ? 0 : 100 + rnd() * 900, margin = 3;
      if (trial & 1) {
        // adversarial: the sphere just past a placed tree, along the line from the camera (inward or outward), within
        // a few of its shadow reaches — the cases a bound without the reach (or a short one) gets wrong
        const cells = [...v.placed.keys()];
        const blk = v.blocks.get(cells[Math.floor(rnd() * cells.length)])!;
        const j = Math.floor(rnd() * blk.n);
        const p = new Vector3(blk.m[j * 16 + 12], blk.m[j * 16 + 13], blk.m[j * 16 + 14]);
        const u = p.clone().sub(camNow).normalize().multiplyScalar(rnd() < 0.5 ? 1 : -1);
        C = p.clone().addScaledVector(u, r + rnd() * 400);
      }
      v.farShadow(1, C.x, C.y, C.z, r, Math.sin(el), R, camNow, trial & 1 ? 0 : nearSplit, margin);
      for (const [c, st] of v.placed) {
        const blk = v.blocks.get(c)!;
        for (const lod of [0, 1]) {
          if (!(st.f & (1 << lod))) continue;
          const b = v.far[st.band * 2 + lod] as unknown as { mesh: { visible: boolean } };
          if (b.mesh.visible) { shown++; continue; }
          hidden++;
          for (let j = 0; j < blk.n; j++) {
            const p = new Vector3(blk.m[j * 16 + 12], blk.m[j * 16 + 13], blk.m[j * 16 + 14]);
            const h = Math.hypot(blk.m[j * 16 + 4], blk.m[j * 16 + 5], blk.m[j * 16 + 6]);
            const dCam = p.distanceTo(camNow);
            // this tree's own shadow bound (its height as its extent, the sun's elevation at it less 0.2 rad of slope)
            const reach = treeShadowReach(h * 1.2, el - 0.2, dCam, R);
            if (!Number.isFinite(reach)) assert.fail('a band was left out at a sun too low to bound its shadows');
            const far = p.distanceTo(C) > r + reach + margin;
            if ((trial & 1) || nearSplit === 0) minSlack = Math.min(minSlack, (p.distanceTo(C) - r - margin) / reach);
            const near = !(trial & 1) && nearSplit > 0 && dCam + reach + margin < nearSplit;
            assert.ok(far || near, `cell ${c}: a tree ${p.distanceTo(C).toFixed(0)} m from the cascade (r ${r.toFixed(0)}, reach ${reach.toFixed(0)}) was left out`);
          }
        }
      }
    }
    v.farShadow(-1, 0, 0, 0, 0, 1, 1);
  }
  assert.ok(hidden > 0 && shown > 0, `both outcomes seen (hidden ${hidden}, shown ${shown})`);
  assert.ok(bands.size >= 2, `more than one band in use (${[...bands]})`);
});
