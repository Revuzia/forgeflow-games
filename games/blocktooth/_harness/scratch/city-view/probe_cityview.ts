// city-view lane PROBE (scratch, not shipped): mounts the real CityView on a real World under node
// (THREE scene graph only — no WebGL) and checks live set, pancake timing, collapse, impostor
// integrity (winding, NaN, outline normals), prop slot stability and a draw-call estimate.
//   node _harness/scratch/city-view/probe_cityview.ts
import * as THREE from 'three';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { RANKS, titanHeight, cameraDistance, CITY } from '../../../src/core/config.ts';
import { damageBuilding } from '../../../src/city/citysim.ts';
import type { BiomeId, RankIndex, SimEvent, World } from '../../../src/core/types.ts';
import type { FrameInfo, ViewCtx } from '../../../src/render/viewtypes.ts';
import { CityView } from '../../../src/city/cityview.ts';

let fails = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fails++; console.log('  FAIL ' + msg); } else console.log('  ok   ' + msg); };

function frame(events: SimEvent[], dt = 1 / 60, camDist = 20): FrameInfo {
  return { alpha: 1, dt, time: 0, events, camDist, frozen: false };
}
function setRank(w: World, r: RankIndex): void {
  const T = w.titan; T.rank = r; T.height = titanHeight(r, 0); T.radius = T.height * 0.42;
}
/** every visible mesh (incl. hulls) → main draws; castShadow → shadow draws */
function drawEstimate(scene: THREE.Scene): { main: number; shadow: number; tris: number } {
  let main = 0, shadow = 0, tris = 0;
  scene.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh && im.count === 0) return;
    main++;
    if (m.castShadow) shadow++;
    const g = m.geometry; const n = g.index ? g.index.count : g.getAttribute('position').count;
    tris += (n / 3) * (im.isInstancedMesh ? im.count : 1);
  });
  return { main, shadow, tris };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (v: CityView): any => v as unknown;

for (const biome of ['grideast', 'whitestacks', 'lockwater'] as BiomeId[]) {
  console.log(`\n== ${biome} ==`);
  const w = createWorld({ titan: 'molo', biome, seed: 1337 });
  w.cheats.noSpawns = true;
  const scene = new THREE.Scene();
  const ctx = { scene, renderer: null, camera: new THREE.PerspectiveCamera(), quality: { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: false } } as unknown as ViewCtx;
  const view = new CityView(ctx);
  const t0 = performance.now();
  view.mount(w);
  const mountMs = performance.now() - t0;
  console.log(`  mount ${mountMs.toFixed(0)} ms, buildings ${w.city.buildings.length}, props ${w.city.props.length}, blocks ${w.city.blocksX}x${w.city.blocksZ}`);
  const V = priv(view);
  const R0 = CITY.liveRadiusByRank[0];
  ok(V.liveCount > 0 && V.liveCount <= (2 * R0 + 2) * (2 * R0 + 2), `live blocks at rank I = ${V.liveCount} (radius ${R0} + hysteresis)`);

  // impostor integrity: winding agrees with declared normals, no NaN, unit outline normals
  const W = V.impostors.W;
  let bad = 0, nan = 0, badOn = 0, triCount = 0, degenerate = 0;
  for (let bi = 0; bi < V.nBlocks; bi++) {
    const s = V.impostors.start[bi], u = V.impostors.used[bi];
    for (let v = s; v < s + u; v += 3) {
      const p = W.pos, n = W.nrm;
      const ax = p[v * 3], ay = p[v * 3 + 1], az = p[v * 3 + 2];
      const ux = p[v * 3 + 3] - ax, uy = p[v * 3 + 4] - ay, uz = p[v * 3 + 5] - az;
      const vx = p[v * 3 + 6] - ax, vy = p[v * 3 + 7] - ay, vz = p[v * 3 + 8] - az;
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const cl = Math.hypot(cx, cy, cz);
      triCount++;
      if (cl < 1e-9) { degenerate++; continue; }
      if (cx * n[v * 3] + cy * n[v * 3 + 1] + cz * n[v * 3 + 2] <= 0) bad++;
      for (let k = 0; k < 9; k++) if (!Number.isFinite(p[v * 3 + k]) || !Number.isFinite(n[v * 3 + k]) || !Number.isFinite(W.onr[v * 3 + k])) nan++;
      for (let q = 0; q < 3; q++) { const o = (v + q) * 3; const L = Math.hypot(W.onr[o], W.onr[o + 1], W.onr[o + 2]); if (Math.abs(L - 1) > 1e-3) badOn++; }
    }
  }
  ok(bad === 0 && nan === 0 && badOn === 0, `impostor tris ${triCount} (degenerate ${degenerate}): winding errors ${bad}, NaN ${nan}, non-unit outline normals ${badOn}`);
  let liveSlotsEmpty = true;
  for (let bi = 0; bi < V.nBlocks; bi++) if (V.live[bi] && V.impostors.used[bi] !== 0) liveSlotsEmpty = false;
  ok(liveSlotsEmpty, 'live blocks have empty impostor slots');
  let nonLiveFilled = true;
  for (let bi = 0; bi < V.nBlocks; bi++) if (!V.live[bi] && w.city.blockBuildings[bi].length && V.impostors.used[bi] === 0) nonLiveFilled = false;
  ok(nonLiveFilled, 'every non-live block with buildings has an impostor');

  // ── pancake timing on a live building ──
  const T = w.titan;
  const cand = w.city.buildings.filter((b) => V.live[b.block] && !b.collapsed && b.floors >= 4).sort((a, b) => Math.hypot(a.x - T.x, a.z - T.z) - Math.hypot(b.x - T.x, b.z - T.z));
  if (cand.length) {
    const b = cand[0];
    const aliveBefore = b.alive;
    w.events.length = 0;
    damageBuilding(w, b.id, b.floorHp + 0.001, { src: 'titan', kind: 'smash' });
    const evs = w.events.slice();
    ok(evs.some((e) => e.type === 'floorBreak'), `floorBreak emitted (building ${b.id} ${b.arch} ${aliveBefore}→${b.alive})`);
    view.update(w, frame(evs, 0));
    ok(V.vAlive[b.id] === b.alive && Math.abs(V.drop[b.id] - b.floorH) < 1e-6, `drop starts at one floorH (${V.drop[b.id].toFixed(2)} m)`);
    let t = 0; const dt = 1 / 240;
    while (V.drop[b.id] > 0 && t < 2) { view.update(w, frame([], dt)); t += dt; }
    ok(Math.abs(t - 0.28) < 0.02, `one-floor drop lands in ${t.toFixed(3)} s (spec 0.28 easeInCubic)`);
    ok(V.sqT[b.id] >= 0, 'landing starts the squash bounce');
    // rapid chew: a break every 50 ms must not make the stack hover
    let maxDrop = 0;
    for (let i = 0; i < 6 && b.alive > 1; i++) {
      w.events.length = 0;
      damageBuilding(w, b.id, b.floorHp + 0.001, { src: 'titan', kind: 'smash' });
      view.update(w, frame(w.events.slice(), 0));
      for (let k = 0; k < 12; k++) { view.update(w, frame([], 1 / 240)); maxDrop = Math.max(maxDrop, V.drop[b.id]); }
    }
    ok(maxDrop < b.floorH * 2.2, `rapid chew keeps the stack low (max offset ${maxDrop.toFixed(2)} m, floorH ${b.floorH})`);
    // pieces shown = alive
    const ab = V.arches[V.archOf[b.id]];
    for (let k = 0; k < 120; k++) view.update(w, frame([], 1 / 60));
    // collapse
    // a huge hit breaks ≤ 4 floors per call: several calls, ALL events fed in ONE frame (overflow)
    const evc: SimEvent[] = [];
    for (let g = 0; g < 20 && !b.collapsed; g++) { w.events.length = 0; damageBuilding(w, b.id, 1e9, { src: 'titan', kind: 'smash' }); evc.push(...w.events); }
    ok(evc.some((e) => e.type === 'buildingCollapse'), 'buildingCollapse emitted');
    const rubBefore = V.rubble.mesh.count;
    view.update(w, frame(evc, 0));
    ok(V.sinkT[b.id] >= 0 && V.sinkN[b.id] > 0, `collapse sinks the remaining ${V.sinkN[b.id]} storeys`);
    for (let k = 0; k < 60; k++) view.update(w, frame([], 1 / 60));
    ok(V.sinkT[b.id] < 0 && V.rubble.mesh.count === rubBefore + 1, `stack gone, rubble heap stays (rubble instances ${rubBefore}→${V.rubble.mesh.count})`);
    let pieces = 0;
    for (const id of ab.ids) { const bb = w.city.buildings[id]; pieces += V.vAlive[id]; void bb; }
    const inst = ab.base.mesh.count + ab.floor.mesh.count + ab.roof.mesh.count;
    const ghostInst = ab.gBase.mesh.count + ab.gFloor.mesh.count + ab.gRoof.mesh.count;
    ok(inst + ghostInst === pieces, `arch ${ab.prof.a.id}: instances ${inst} + see-through ${ghostInst} = standing storeys ${pieces}`);
  }

  // ── break outside the live set → impostor rewritten ──
  const far = w.city.buildings.find((b) => !V.live[b.block] && !b.collapsed && b.floors >= 3);
  if (far) {
    const usedBefore = V.impostors.used[far.block];
    const evf: SimEvent[] = [];
    for (let g = 0; g < 20 && !far.collapsed; g++) { w.events.length = 0; damageBuilding(w, far.id, 1e9, { src: 'titan', kind: 'smash' }); evf.push(...w.events); }
    view.update(w, frame(evf, 1 / 60));
    for (let k = 0; k < 40; k++) view.update(w, frame([], 1 / 60));
    ok(V.impAlive[far.id] === 0 && V.impostors.used[far.block] > 0, `non-live collapse → impostor mound written (slot verts ${usedBefore}→${V.impostors.used[far.block]})`);
  }

  // ── traffic slot stability while the sim runs ──
  const slotsBefore = new Map<number, number>();
  for (const id of V.traffic) if (V.propSlot[id] >= 0) slotsBefore.set(id, V.propSlot[id]);
  for (let k = 0; k < 90; k++) { stepWorld(w, NO_INPUT); view.update(w, frame(w.events.slice(), 1 / 30, 20)); }
  let moved = 0, kept = 0;
  for (const [id, s] of slotsBefore) { if (V.propSlot[id] === s) kept++; else if (V.propSlot[id] >= 0) moved++; }
  ok(moved === 0, `traffic kept stable instance slots (${kept} kept, ${moved} re-slotted while visible)`);

  // ── rank V: live radius 3, draw estimate + update cost ──
  setRank(w, 4);
  const D = cameraDistance(w.titan.height, 4);
  view.update(w, frame([], 1 / 60, D));
  ok(V.liveCount >= 49 || V.liveCount === V.nBlocks, `rank V live blocks = ${V.liveCount}`);
  const est = drawEstimate(scene);
  console.log(`  rank V draw estimate: main ${est.main} + shadow ${est.shadow} = ${est.main + est.shadow} (tris ≈ ${(est.tris / 1e6).toFixed(2)} M main)`);
  ok(est.main + est.shadow <= 180, 'city draws ≤ ~180 at Size V (incl. shadow pass)');
  // walk the titan across the city: blocks enter/leave; measure update cost
  let worst = 0, sum = 0; const N = 240;
  const x0 = w.titan.x, z0 = w.titan.z;
  for (let k = 0; k < N; k++) {
    w.titan.px = w.titan.x; w.titan.pz = w.titan.z;
    w.titan.x = x0 + Math.sin(k / 40) * 300; w.titan.z = z0 + (k / N) * 200 - 100;
    const a = performance.now();
    view.update(w, frame([], 1 / 60, D));
    const ms = performance.now() - a; worst = Math.max(worst, ms); sum += ms;
  }
  console.log(`  walk: update avg ${(sum / N).toFixed(2)} ms, worst ${worst.toFixed(2)} ms`);
  let emptyLive = true, holes = 0;
  for (let bi = 0; bi < V.nBlocks; bi++) {
    if (V.live[bi] && V.impostors.used[bi] !== 0) emptyLive = false;
    if (!V.live[bi] && !V.impDirty[bi] && w.city.blockBuildings[bi].length && V.impostors.used[bi] === 0) holes++;
  }
  ok(emptyLive && holes === 0, `after the walk: live slots empty, impostor holes ${holes}`);
  // prop slot bookkeeping: every alive static prop in a live block has a slot, none outside
  let missing = 0, stray = 0;
  for (const p of w.city.props) {
    if (p.lane >= 0) continue;
    const bi = w.city.blockProps.findIndex((l) => l.includes(p.id));
    if (bi < 0) continue;
    const want = V.live[bi] && p.alive;
    if (want && V.propSlot[p.id] < 0) missing++;
    if (!want && V.propSlot[p.id] >= 0) stray++;
  }
  ok(missing === 0 && stray === 0, `static prop slots: missing ${missing}, stray ${stray}`);
  view.unmount();
  ok(scene.children.length === 0, 'unmount removes everything from the scene');
  void RANKS;
}
console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
