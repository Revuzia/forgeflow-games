// fx lane SCRATCH PREVIEW (not shipped). A REAL World (createWorld) + a stand-in faceted city
// diorama (CityView belongs to another lane) + the real TitanView/EnemyView when they load, and a
// scripted SYNTHETIC event stream that fires every fx effect at a controlled frame so snapshots
// are repeatable. URL: ?scene=mix|rankup|vent|vacuum|wire|briar|debris|walk&rank=0..4&titan=&biome=&snap=N
import * as THREE from 'three';
import { createRenderCore, defaultQuality } from '../../../src/render/renderer.ts';
import { CameraRig } from '../../../src/render/camera.ts';
import { Lighting } from '../../../src/render/lighting.ts';
import { EnvView } from '../../../src/render/env.ts';
import { addOutline, bakeOutlineNormals, facet, makeToon, OUTLINE_PX } from '../../../src/render/materials.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { RANKS, titanHeight, cameraDistance } from '../../../src/core/config.ts';
import type { BiomeId, RankIndex, SimEvent, TitanId, TitanInput, World, Building } from '../../../src/core/types.ts';
import type { FrameInfo, ViewModule } from '../../../src/render/viewtypes.ts';
import { FxView } from '../../../src/render/fx.ts';
import { DebrisView } from '../../../src/render/debris.ts';
import { CivilianView } from '../../../src/render/civilians.ts';
import { PickupView } from '../../../src/render/pickupview.ts';
import { spawnPickup } from '../../../src/combat/pickups.ts';
import { spawnEnemy } from '../../../src/ai/enemies.ts';
import { recomputeStats } from '../../../src/upgrades/stats.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';

const qs = new URLSearchParams(location.search);
const scene = qs.get('scene') ?? 'mix';
const rank = Math.max(0, Math.min(4, Number(qs.get('rank') ?? 0))) as RankIndex;
const defTitan: Record<string, TitanId> = { vent: 'hearthback', vacuum: 'molo', wire: 'voltkite', briar: 'briarwick' };
const titan = (qs.get('titan') ?? defTitan[scene] ?? 'molo') as TitanId;
const biome = (qs.get('biome') ?? 'grideast') as BiomeId;
const seed = Number(qs.get('seed') ?? 7);
const snapDefault: Record<string, number> = { boss: 20, mix: 22, rankup: 14, vent: 18, vacuum: 50, wire: 3, briar: 9, debris: 75, walk: 120 };
const snapAt = Number(qs.get('snap') ?? snapDefault[scene] ?? 24);
const lbl = document.getElementById('lbl')!;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const quality = defaultQuality();
quality.screenShake = false;
if (qs.get('q')) quality.level = Number(qs.get('q')) as 0 | 1 | 2;
if (qs.get('rf') === '1') quality.reduceFlashing = true;
const core = createRenderCore(canvas, quality);
const { scene: scn, camera, renderer } = core;

// ─────────────────────────────── world ───────────────────────────────
const w: World = createWorld({ titan, biome, seed });
w.cheats.noSpawns = true;
{
  const T = w.titan;
  let m = 0;
  for (let r = 0; r < rank; r++) m += RANKS[r].massToNext;
  T.mass = m + 1;
  T.rank = rank;
  T.height = titanHeight(rank, 0);
  T.radius = T.height * 0.42;
  recomputeStats(w);
  T.hp = T.maxHp;
  // at big ranks, stand in the middle of a block row (more buildings around)
}
const T = w.titan;
const T0 = { x: T.x, z: T.z };
const H = T.height;
const dirX = Math.sin(T.heading), dirZ = Math.cos(T.heading);

// buildings near the titan, nearest first
const near = w.city.buildings
  .filter((b) => !b.collapsed)
  .map((b) => ({ b, d: Math.hypot(b.x - T.x, b.z - T.z) }))
  .sort((a, b) => a.d - b.d);
const pick = (maxTier: number, skip: Set<number>): Building | null => {
  for (const n of near) if (n.b.tier <= maxTier && !skip.has(n.b.id) && n.d > T.radius * 2) return n.b;
  return near.length ? near[0].b : null;
};
const excluded = new Set<number>();
// scratch cutaway: drop stand-in buildings that sit between the camera and the titan (or enclose the camera)
{
  const pitch = (RANKS[rank].pitchDeg * Math.PI) / 180, D = cameraDistance(H, rank);
  const cx = Math.cos(pitch) * Math.sin(Math.PI / 4) * D, cz = Math.cos(pitch) * Math.cos(Math.PI / 4) * D;
  for (const b of w.city.buildings) {
    const top = b.floors * b.floorH;
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const x = T0.x + cx * t, z = T0.z + cz * t, y = H * 0.45 + Math.sin(pitch) * D * t;
      if (Math.abs(x - b.x) < b.w / 2 + 3 && Math.abs(z - b.z) < b.d / 2 + 3 && top > y - 2) { excluded.add(b.id); break; }
    }
  }
}
const B1 = pick(Math.max(1, RANKS[rank].canFlatten + 1), excluded); if (B1) excluded.add(B1.id);
const B2 = pick(Math.max(1, RANKS[rank].canFlatten + 1), excluded);
if (B2 && excluded.has(B2.id)) excluded.delete(B2.id);
const nearProps = w.city.props.filter((p) => p.alive).map((p) => ({ p, d: Math.hypot(p.x - T.x, p.z - T.z) })).sort((a, b) => a.d - b.d).slice(0, 4).map((n) => n.p);

// ─────────────────────────────── stand-in diorama ───────────────────────────────
const bdef = (await import('../../../src/data/biomes.ts')).BIOMES[biome];
const pal = bdef.palette;
function pushBox(pos: number[], cols: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cTop: THREE.Color, cSide: THREE.Color): void {
  const q = (a: number[], b: number[], c: number[], d: number[], cc: THREE.Color) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) cols.push(cc.r, cc.g, cc.b); };
  q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], cTop);
  q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], cSide);
  q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], cSide);
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], cSide);
  q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], cSide);
}
function meshFrom(pos: number[], cols: number[], outlinePx: number | null, cast = true): THREE.Mesh {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g = facet(g); bakeOutlineNormals(g); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, makeToon({ vertexColors: true }));
  m.castShadow = cast; m.receiveShadow = true;
  if (outlinePx) addOutline(m, outlinePx);
  scn.add(m);
  return m;
}
{
  const city = w.city, P = city.pitch, RH = city.roadW / 2, Wd = city.blocksX * P, Dd = city.blocksZ * P;
  const pos: number[] = [], cols: number[] = [];
  const road = new THREE.Color(pal.road);
  pushBox(pos, cols, city.originX - RH, -0.2, city.originZ - RH, city.originX + Wd + RH, 0, city.originZ + Dd + RH, road, road);
  meshFrom(pos, cols, null, false);
  const p2: number[] = [], c2: number[] = [];
  const side = new THREE.Color(pal.sidewalk), curb = new THREE.Color(pal.curb), lot = new THREE.Color(pal.ground).lerp(side, 0.35);
  for (let bz = 0; bz < city.blocksZ; bz++) for (let bx = 0; bx < city.blocksX; bx++) {
    const cx = city.originX + (bx + 0.5) * P, cz = city.originZ + (bz + 0.5) * P;
    pushBox(p2, c2, cx - 29, 0, cz - 29, cx + 29, 0.16, cz + 29, side, curb);
    pushBox(p2, c2, cx - 26, 0.16, cz - 26, cx + 26, 0.18, cz + 26, lot, curb);
  }
  meshFrom(p2, c2, null, false);
  const p3: number[] = [], c3: number[] = [];
  const cw = new THREE.Color(pal.crosswalk);
  for (const c of city.crosswalks) {
    for (let i = 0; i < 7; i++) {
      const t = -c.len / 2 + (i + 0.5) * (c.len / 7), hw = c.width / 2, sw = c.len / 7 * 0.28;
      if (c.axis === 'z') pushBox(p3, c3, c.x - hw, 0, c.z + t - sw, c.x + hw, 0.02, c.z + t + sw, cw, cw);
      else pushBox(p3, c3, c.x + t - sw, 0, c.z - hw, c.x + t + sw, 0.02, c.z + hw, cw, cw);
    }
  }
  const zm = meshFrom(p3, c3, null, false);
  (zm.material as THREE.Material).polygonOffset = true; (zm.material as THREE.Material).polygonOffsetFactor = -1;
  const p4: number[] = [], c4: number[] = [];
  const archById = new Map(bdef.archetypes.map((a) => [a.id, a]));
  const glass = new THREE.Color(pal.glass);
  for (const b of city.buildings) {
    if (excluded.has(b.id)) continue;
    const a = archById.get(b.arch);
    const body = new THREE.Color(pal[a?.body ?? 'bodyA']).multiplyScalar(0.94 + b.variant * 0.12);
    const roof = new THREE.Color(pal[a?.roof ?? 'roofA']);
    const trim = new THREE.Color(pal[a?.trim ?? 'trimA']);
    const h = b.floors * b.floorH, x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    pushBox(p4, c4, x0, 0, z0, x1, h, z1, roof, body);
    pushBox(p4, c4, x0 - 0.15, h, z0 - 0.15, x1 + 0.15, h + 0.45, z1 + 0.15, roof, trim);
    for (let f = 0; f < b.floors; f++) {
      const y0 = f * b.floorH + b.floorH * 0.35, y1 = f * b.floorH + b.floorH * 0.75;
      pushBox(p4, c4, x1, y0, z0 + 0.8, x1 + 0.06, y1, z1 - 0.8, glass, glass);
      pushBox(p4, c4, x0 + 0.8, y0, z1, x1 - 0.8, y1, z1 + 0.06, glass, glass);
    }
  }
  meshFrom(p4, c4, OUTLINE_PX.building);
  // parked props (stand-in blocks) except the ones the script destroys
  const p5: number[] = [], c5: number[] = [];
  const hidden = new Set(nearProps.map((p) => p.id));
  const pc = [pal.sign, pal.signB, pal.bodyC, '#e8e4dc'].map((h2) => new THREE.Color(h2));
  for (const p of city.props) {
    if (hidden.has(p.id) || Math.hypot(p.x - T.x, p.z - T.z) > 400) continue;
    const car = p.kind === 'car' || p.kind === 'taxi' || p.kind === 'van';
    if (!car && p.kind !== 'kiosk' && p.kind !== 'tree') continue;
    const s = car ? 0.9 : 0.8, hh = p.kind === 'tree' ? 3 : 1.4;
    const c = p.kind === 'tree' ? new THREE.Color(pal.foliage) : pc[p.id % pc.length];
    pushBox(p5, c5, p.x - s, 0.1, p.z - s, p.x + s, hh, p.z + s, c, c);
  }
  if (p5.length) meshFrom(p5, c5, OUTLINE_PX.prop);
}

// ─────────────────────────────── views ───────────────────────────────
const ctx = { renderer, scene: scn, camera, quality };
const lighting = new Lighting(scn);
lighting.applyBiome(bdef);
const env = new EnvView(ctx);
env.mount(w);
const rig = new CameraRig(camera, quality);
rig.reset(w);
const fx = new FxView(ctx), debris = new DebrisView(ctx), civ = new CivilianView(ctx), pickups = new PickupView(ctx);
const views: ViewModule[] = [];
const notes: string[] = [];
try {
  const { TitanView } = await import('../../../src/titans/titanview.ts');
  const tv = new TitanView(ctx); await tv.mount(w); views.push(tv);
} catch (e) { notes.push('titanview: ' + String(e).slice(0, 80)); }
if (scene === 'boss') {
  spawnBoss(w, 'caisson4');
  if (w.boss) { w.boss.x = w.boss.px = T.x + dirX * 110; w.boss.z = w.boss.pz = T.z + dirZ * 110; w.boss.introT = 0; }
  try {
    const { BossView } = await import('../../../src/ai/bossview.ts');
    const bv = new BossView(ctx); await bv.mount(w); views.push(bv);
  } catch (e) { notes.push('bossview: ' + String(e).slice(0, 80)); }
}
try {
  const { EnemyView } = await import('../../../src/ai/enemyview.ts');
  const ev = new EnemyView(ctx); await ev.mount(w); views.push(ev);
} catch (e) { notes.push('enemyview: ' + String(e).slice(0, 80)); }
fx.mount(w); await debris.mount(w); civ.mount(w); pickups.mount(w);
if (qs.get('remount') === '1') {
  // lifecycle test: a full unmount → mount cycle (a Retry) must leave nothing behind
  const before = scn.children.length;
  fx.unmount(); debris.unmount(); civ.unmount(); pickups.unmount();
  const afterUnmount = scn.children.length;
  fx.mount(w); await debris.mount(w); civ.mount(w); pickups.mount(w);
  notes.push(`remount: children ${before} → ${afterUnmount} → ${scn.children.length}`);
}
views.push(fx, debris, civ, pickups);

// ─────────────────────────────── synthetic event script ───────────────────────────────
const fwdX = (d: number) => T.x + dirX * d, fwdZ = (d: number) => T.z + dirZ * d;
const rightX = Math.cos(T.heading), rightZ = -Math.sin(T.heading);
function ev(frame: number): SimEvent[] {
  const out: SimEvent[] = [];
  const at = (n: number) => frame === n;
  const collapse = (b: Building | null) => { if (b) out.push({ type: 'buildingCollapse', id: b.id, x: b.x, z: b.z, tier: b.tier, w: b.w, d: b.d, h: b.floors * b.floorH }); };
  const floor = (b: Building | null, rem: number) => { if (b) out.push({ type: 'floorBreak', id: b.id, remaining: rem, x: b.x, z: b.z, tier: b.tier }); };
  if (scene === 'mix') {
    if (at(0)) {
      collapse(B1);
      floor(B2, 3);
      for (const p of nearProps.slice(0, 3)) out.push({ type: 'propDestroyed', id: p.id, kind: p.kind, x: p.x, z: p.z, crushed: true });
      out.push({ type: 'smash', x: fwdX(H * 0.8), z: fwdZ(H * 0.8), tier: 0 });
      out.push({ type: 'enemyKilled', id: 999999, kind: 'android', x: T.x + rightX * H * 1.6, z: T.z + rightZ * H * 1.6, crushed: true });
      out.push({ type: 'explosion', x: T.x - rightX * H * 2.6, z: T.z - rightZ * H * 2.6, r: H * 0.6 + 1, kind: 'rocket' });
      out.push({ type: 'arc', pts: [T.x, T.z, fwdX(H * 2), fwdZ(H * 2), fwdX(H * 2) + rightX * H * 1.5, fwdZ(H * 2) + rightZ * H * 1.5, fwdX(H * 3.2), fwdZ(H * 3.2)], kind: 'fork' });
      out.push({ type: 'levelUp', level: 5 });
      out.push({ type: 'titanHeal', amount: T.maxHp * 0.08 });
      out.push({ type: 'footstep', x: T.x, z: T.z, heavy: rank / 4 });
      out.push({ type: 'pulse', x: T.x, z: T.z, r: H * 1.4 });
    }
    if (at(8)) floor(B2, 2);
    if (at(12)) out.push({ type: 'titanAttack', attack: 'curbBite', x: T.x, z: T.z, dir: T.heading, r: H * 0.9, hits: 2 });
    for (const e of w.enemies) if (e.alive && frame % 9 === (e.id % 9)) out.push({ type: 'enemyFire', id: e.id, kind: e.kind, x: e.x, z: e.z, tx: T.x, tz: T.z });
    if (frame % 3 === 0 && w.enemies.length) { const e = w.enemies[(frame / 3) % w.enemies.length | 0]; out.push({ type: 'enemyHit', id: e.id, x: e.x, z: e.z, dmg: 5, crit: frame % 6 === 0 }); }
  } else if (scene === 'boss') {
    const b = w.boss;
    if (b && at(0)) {
      out.push({ type: 'bossStagger' });
      out.push({ type: 'telegraphFire', id: -1, owner: 'boss', hit: false, x: T.x + rightX * 30, z: T.z + rightZ * 30 });
      out.push({ type: 'bossDefeated', x: b.x, z: b.z });
    }
    if (b && frame % 4 === 0) { const p = b.parts[(frame / 4) % b.parts.length | 0]; if (p) out.push({ type: 'bossHit', part: p.name, dmg: 500, x: p.x, z: p.z }); }
  } else if (scene === 'rankup') {
    if (at(0)) { out.push({ type: 'rankUp', rank }); out.push({ type: 'footstep', x: T.x, z: T.z, heavy: 1 }); }
  } else if (scene === 'vent') {
    if (at(0)) out.push({ type: 'vent', x: T.x, z: T.z, r: H * 3.2, power: 0.9 });
    if (at(4)) out.push({ type: 'explosion', x: fwdX(H * 1.6), z: fwdZ(H * 1.6), r: H * 1.1, kind: 'stomp' });
  } else if (scene === 'vacuum') {
    T.kit.vacuumT = 1.0;
    if (at(0)) out.push({ type: 'ability', titan: 'molo', x: T.x, z: T.z, power: 1 });
  } else if (scene === 'wire') {
    if (at(0)) {
      out.push({ type: 'wireDetonate', pts: [T.x - rightX * H * 2, T.z - rightZ * H * 2, fwdX(H * 2.5) - rightX * H * 2, fwdZ(H * 2.5) - rightZ * H * 2,
        T.x + rightX * H * 1.5, T.z + rightZ * H * 1.5, fwdX(H * 3) + rightX * H * 2.5, fwdZ(H * 3) + rightZ * H * 2.5] });
      out.push({ type: 'arc', pts: [T.x, T.z, fwdX(H * 1.8), fwdZ(H * 1.8), fwdX(H * 2.6) - rightX * H, fwdZ(H * 2.6) - rightZ * H], kind: 'fork' });
    }
  } else if (scene === 'briar') {
    if (at(0)) {
      out.push({ type: 'vine', x0: T.x, z0: T.z, x1: fwdX(H * 2.6) + rightX * H * 0.6, z1: fwdZ(H * 2.6) + rightZ * H * 0.6 });
      out.push({ type: 'spore', x: T.x - dirX * H * 1.2, z: T.z - dirZ * H * 1.2, r: H * 1.6 });
      out.push({ type: 'bloomSpawn', id: 1, x: T.x + rightX * H * 2.2, z: T.z + rightZ * H * 2.2 });
    }
  } else if (scene === 'debris') {
    if (at(0)) { collapse(B1); floor(B2, 4); }
    if (at(12)) floor(B2, 3);
    if (at(24)) floor(B2, 2);
    if (at(0)) for (const p of nearProps) out.push({ type: 'propDestroyed', id: p.id, kind: p.kind, x: p.x, z: p.z, crushed: true });
  }
  return out;
}

// scene setup: pickups / enemies
if (scene === 'mix' || scene === 'vacuum' || scene === 'walk') {
  const n = scene === 'vacuum' ? 60 : 36;
  for (let i = 0; i < n; i++) {
    // outside the magnet radius (pickupRadius·H + 2) unless the scene magnetises on purpose
    const a = (i / n) * Math.PI * 2, r = T.stats.pickupRadius * H + 2.5 + H * (0.3 + (i % 5) * 0.5);
    // xp/mass 0 so vacuuming them can't rank the titan up mid-snapshot (visual size uses mass → fake via id)
    spawnPickup(w, i % 3 === 0 ? 'scrap' : 'rubble', T.x + Math.cos(a) * r, T.z + Math.sin(a) * r, 1, scene === 'vacuum' ? 0.4 : 1 + (i % 7) * 3);
  }
  const far = T.stats.pickupRadius * H + 3;
  spawnPickup(w, 'heal', T.x + rightX * (far + H), T.z + rightZ * (far + H), 0, 0);
  spawnPickup(w, 'chest', fwdX(far + H * 1.5) - rightX * H * 1.2, fwdZ(far + H * 1.5) - rightZ * H * 1.2, 0, 0);
}
if (scene === 'mix') {
  const kinds = rank >= 3 ? (['tank', 'walker', 'apc'] as const) : (['android', 'squad', 'android'] as const);
  for (let i = 0; i < 5; i++) {
    const a = 0.9 + i * 0.5, r = H * (3 + i * 0.4) + 6;
    spawnEnemy(w, kinds[i % kinds.length], T.x + Math.cos(a) * r, T.z + Math.sin(a) * r);
  }
}

// ─────────────────────────────── loop (fixed 60 fps timeline) ───────────────────────────────
let frame = 0;
let msAcc = 0, msMax = 0, msN = 0;
const per = [0, 0, 0, 0], perMax = [0, 0, 0, 0];
(window as unknown as Record<string, unknown>).__DBG__ = { w, camera, scn, rig, fx, debris, civ, pickups };
const walkIn: TitanInput = { mx: -0.7071, mz: -0.7071, ability: false, abilityHeld: false, dash: false };
const f: FrameInfo = { alpha: 1, dt: 1 / 60, time: 0, events: [], camDist: rig.distance, frozen: false };
let evs: SimEvent[] = [];
if (scene === 'walk') for (let i = 0; i < 30; i++) stepWorld(w, walkIn);
function loop(): void {
  evs = [];
  // the sim runs at 30 Hz under a 60 Hz render: step every other frame (pickups, enemies, titan)
  if (frame % 2 === 0) {
    stepWorld(w, scene === 'walk' ? walkIn : NO_INPUT);
    evs.push(...w.events);
    f.alpha = 0;
  } else f.alpha = 0.5;
  if (scene === 'vacuum') T.kit.vacuumT = 1.0;
  evs.push(...ev(frame));
  f.events = evs;
  f.frozen = qs.get('freezeAt') !== null && frame >= Number(qs.get('freezeAt'));
  if (f.frozen) evs.length = 0;
  f.time = 5 + frame / 60;
  rig.update(w, f);
  lighting.update(w, rig);
  f.camDist = rig.distance;
  env.update(w, f);
  let laneMs = 0;
  const lane = [fx, debris, civ, pickups];
  for (let k = 0; k < 4; k++) {
    const t0 = performance.now();
    lane[k].update(w, f);
    const dtm = performance.now() - t0;
    laneMs += dtm;
    if (frame >= 10) { per[k] += dtm; perMax[k] = Math.max(perMax[k], dtm); }
  }
  if (frame >= 10) { msAcc += laneMs; msMax = Math.max(msMax, laneMs); msN++; }
  for (const v of views) if (v !== fx && v !== debris && v !== civ && v !== pickups) v.update(w, f);
  core.render();
  frame++;
  const st = core.stats();
  const fs = fx.stats();
  lbl.textContent = `fx scratch  scene=${scene} titan=${titan} rank ${RANKS[rank].name} H=${H.toFixed(1)} frame=${frame}\n` +
    `draws=${st.draws} tris=${st.tris} programs=${st.programs}  debris=${debris.active} civ=${civ.count} pickups=${w.pickups.filter((p) => p.alive).length}\n` +
    `fx ${JSON.stringify(fs)}${notes.length ? '\n' + notes.join('\n') : ''}`;
  if (frame >= snapAt) {
    (window as unknown as { __SNAP_READY__: boolean }).__SNAP_READY__ = true;
    (window as unknown as { __STATS__: unknown }).__STATS__ = { ...st, fx: fs, debris: debris.active, civ: civ.count, laneMsAvg: +(msAcc / Math.max(1, msN)).toFixed(3), laneMsMax: +msMax.toFixed(3), perAvg: per.map((v) => +(v / Math.max(1, msN)).toFixed(3)), perMax: perMax.map((v) => +v.toFixed(2)), notes };
    return;                        // freeze on the snapshot frame
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
