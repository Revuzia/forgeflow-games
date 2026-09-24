// city-view lane SCRATCH PREVIEW (not shipped). A REAL World (createWorld) rendered by the real
// CityView + render-core (renderer, camera rig, lighting, env) + the real TitanView when it loads.
// URL: ?biome=grideast&rank=2&seed=7&chew=6&pancake=1&allimp=0&dist=1&snap=40&titan=molo&yaw=0
//   chew=N     pre-chew the N nearest buildings (pancaked stacks, a few collapses → rubble)
//   pancake=1  break a floor on a nearby building 8 frames before the snapshot (stack mid-fall)
//   allimp=1   force EVERY block to impostors (compare silhouettes/colours with allimp=0)
//   dist=K     camera distance multiplier; ox/oz = look-target offset (m)
import * as THREE from 'three';
import { createRenderCore, defaultQuality } from '../../../src/render/renderer.ts';
import { CameraRig } from '../../../src/render/camera.ts';
import { Lighting } from '../../../src/render/lighting.ts';
import { EnvView } from '../../../src/render/env.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { RANKS, titanHeight } from '../../../src/core/config.ts';
import { damageBuilding } from '../../../src/city/citysim.ts';
import { BIOMES } from '../../../src/data/biomes.ts';
import { recomputeStats } from '../../../src/upgrades/stats.ts';
import type { BiomeId, RankIndex, SimEvent, TitanId, World } from '../../../src/core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from '../../../src/render/viewtypes.ts';
import { CityView } from '../../../src/city/cityview.ts';

const qs = new URLSearchParams(location.search);
const biome = (qs.get('biome') ?? 'grideast') as BiomeId;
const rank = Math.max(0, Math.min(4, Number(qs.get('rank') ?? 2))) as RankIndex;
const titan = (qs.get('titan') ?? 'molo') as TitanId;
const seed = Number(qs.get('seed') ?? 7);
const chew = Number(qs.get('chew') ?? 0);
const snapAt = Number(qs.get('snap') ?? 40);
const distMul = Number(qs.get('dist') ?? 1);
const lbl = document.getElementById('lbl')!;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const quality = defaultQuality();
quality.screenShake = false;
const core = createRenderCore(canvas, quality);
const { scene: scn, camera, renderer } = core;
const ctx: ViewCtx = { renderer, scene: scn, camera, quality };

const w: World = createWorld({ titan, biome, seed });
w.cheats.noSpawns = true;
{
  const T = w.titan;
  let m = 0;
  for (let r = 0; r < rank; r++) m += RANKS[r].massToNext;
  T.mass = m + 1; T.rank = rank; T.height = titanHeight(rank, 0); T.radius = T.height * 0.42;
  recomputeStats(w); T.hp = T.maxHp;
  T.x += Number(qs.get('tx') ?? 0); T.z += Number(qs.get('tz') ?? 0);
  T.px = T.x; T.pz = T.z;
}
const T = w.titan;

// pre-chew: nearest buildings lose floors (some collapse)
const events: SimEvent[] = [];
const near = w.city.buildings.filter((b) => !b.collapsed)
  .map((b) => ({ b, d: Math.hypot(b.x - T.x, b.z - T.z) })).sort((a, b) => a.d - b.d).map((n) => n.b);
for (let i = 0; i < chew && i < near.length; i++) {
  const b = near[i + 2];
  if (!b) break;
  const breaks = i % 3 === 2 ? b.floors : Math.max(1, Math.floor(b.floors * 0.4));
  for (let k = 0; k < breaks && !b.collapsed; k++) damageBuilding(w, b.id, b.floorHp + 0.01, { src: 'titan', kind: 'smash' });
}
events.push(...w.events);

const lighting = new Lighting(scn);
lighting.applyBiome(BIOMES[biome]);
const env = new EnvView(ctx);
env.mount(w);
const city = new CityView(ctx);
const tm0 = performance.now();
city.mount(w);
const mountMs = performance.now() - tm0;
const views: ViewModule[] = [];
if (qs.get('notitan') !== '1') {
  try {
    const { TitanView } = await import('../../../src/titans/titanview.ts');
    const tv = new TitanView(ctx); await tv.mount(w); views.push(tv);
  } catch (e) { console.warn('titan view unavailable', e); }
}
if (qs.get('allimp') === '1') {
  // every block → impostor (the live set is evaluated around a point far outside the city)
  (city as unknown as { evalLive(w: World, x: number, z: number, f: boolean): void }).evalLive(w, 1e7, 1e7, true);
  (city as unknown as { evalLive: () => void }).evalLive = () => { /* frozen: never re-evaluated */ };
}
const rig = new CameraRig(camera, quality);
rig.reset(w);

let frame = 0;
const f: FrameInfo = { alpha: 1, dt: 1 / 60, time: 0, events: [], camDist: rig.distance, frozen: false };
// pancake target: nearest standing building with ≥ 3 floors outside the titan's body
const pcTarget = near.find((bb) => !bb.collapsed && bb.alive >= 3 && Math.hypot(bb.x - T.x, bb.z - T.z) > T.radius * 3) ?? null;
const focus = qs.get('focus') === '1' && pcTarget;
const ox = focus ? pcTarget.x - T.x : Number(qs.get('ox') ?? 0), oz = focus ? pcTarget.z - T.z : Number(qs.get('oz') ?? 0);
function loop(): void {
  const evs: SimEvent[] = frame === 0 ? events.slice() : [];
  if (frame % 2 === 0) { stepWorld(w, NO_INPUT); evs.push(...w.events); f.alpha = 0; } else f.alpha = 0.5;
  if (qs.get('pancake') === '1' && frame === snapAt - Number(qs.get('pf') ?? 8)) {
    const b = pcTarget;
    if (b && !b.collapsed) { w.events.length = 0; damageBuilding(w, b.id, b.floorHp + 0.01, { src: 'titan', kind: 'smash' }); evs.push(...w.events); }
  }
  f.events = evs;
  f.time = frame / 60;
  rig.update(w, f);
  if (distMul !== 1 || ox || oz) {
    // scratch-only camera override: scale the distance / shift the target, keep the rig's angles
    const tgt = rig.target;
    const dir = new THREE.Vector3().subVectors(camera.position, new THREE.Vector3(tgt.x, tgt.y, tgt.z));
    const t2 = new THREE.Vector3(tgt.x + ox, tgt.y, tgt.z + oz);
    camera.position.copy(t2).addScaledVector(dir, distMul);
    camera.lookAt(t2);
    camera.far = Math.max(camera.far, dir.length() * distMul * 6 + 400);
    camera.updateProjectionMatrix();
  }
  lighting.update(w, rig);
  f.camDist = rig.distance * distMul;
  env.update(w, f);
  const t0 = performance.now();
  city.update(w, f);
  const cityMs = performance.now() - t0;
  for (const v of views) v.update(w, f);
  core.render();
  frame++;
  const st = core.stats();
  lbl.textContent = `city-view scratch  biome=${biome} rank ${RANKS[rank].name} H=${T.height.toFixed(1)} frame=${frame} mount=${mountMs.toFixed(0)}ms city.update=${cityMs.toFixed(2)}ms\n` +
    `draws=${st.draws} tris=${st.tris} programs=${st.programs} geos=${st.geometries}`;
  if (frame >= snapAt) {
    (window as unknown as { __SNAP_READY__: boolean }).__SNAP_READY__ = true;
    (window as unknown as { __STATS__: unknown }).__STATS__ = { ...st, mountMs, cityMs };
    return;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
