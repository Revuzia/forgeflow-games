// foes-view headless probe:  node --expose-gc _harness/scratch/foes-view/probe_views.ts
// Drives EnemyView + BossView from a REAL World (createWorld / stepWorld / spawnEnemy / spawnBoss)
// without WebGL (three's scene graph + geometry run in node). Checks:
//   * no throw; every drawn instance matrix finite; per-part instance counts == alive × pivots
//   * the view record sweep follows deaths / compaction (no leaks)
//   * steady-state update() allocates nothing: zero GC events across N frames
//   * bosses: every posed matrix finite through intro, all attacks, stagger, defeat collapse
import * as THREE from 'three';
import { PerformanceObserver } from 'node:perf_hooks';
import { EnemyView } from '../../../src/ai/enemyview.ts';
import { BossView } from '../../../src/ai/bossview.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { spawnEnemy } from '../../../src/ai/enemies.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import { SIM_DT } from '../../../src/core/config.ts';
import { ENEMY_KINDS } from '../../../src/core/types.ts';
import type { BiomeId, BossId, World } from '../../../src/core/types.ts';
import type { FrameInfo, ViewCtx } from '../../../src/render/viewtypes.ts';

let fails = 0;
const fail = (m: string) => { fails++; console.log('FAIL', m); };
const ctx = (): ViewCtx => ({
  renderer: {} as unknown as THREE.WebGLRenderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
  quality: { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true },
});
const fr = (w: World, dt = SIM_DT): FrameInfo => ({ alpha: 0.5, dt, time: w.t, events: w.events, camDist: 100, frozen: false });
const finiteMat = (m: THREE.Matrix4) => m.elements.every(Number.isFinite);

// ─────────────────────────────── enemies ───────────────────────────────
{
  const w = createWorld({ titan: 'molo', biome: 'grideast', seed: 21 });
  w.cheats.god = true;
  const c = ctx();
  const view = new EnemyView(c);
  view.mount(w);
  const T = w.titan;
  let seen = 0, maxAlive = 0, kills = 0;
  const kindsSeen = new Set<string>();
  for (let i = 0; i < 30 * 120; i++) {
    if (i % 20 === 0) {
      const k = ENEMY_KINDS[(i / 20) % ENEMY_KINDS.length];
      const a = i * 0.37;
      spawnEnemy(w, k, T.x + Math.sin(a) * 40, T.z + Math.cos(a) * 40, { elite: i % 140 === 0 });
    }
    // a slow circle so the titan's auto-attack + crush kill things (exercises death + compaction)
    const a = i * 0.01;
    stepWorld(w, { mx: Math.cos(a), mz: -Math.sin(a), ability: false, abilityHeld: false, dash: i % 90 === 0 });
    for (const e of w.events) if (e.type === 'enemyKilled') kills++;
    view.update(w, fr(w));
    // verify instance counts + finiteness
    const alive = new Map<string, number>();
    for (const e of w.enemies) if (e.alive) { alive.set(e.kind, (alive.get(e.kind) ?? 0) + 1); kindsSeen.add(e.kind); }
    const nAlive = [...alive.values()].reduce((s, v) => s + v, 0);
    maxAlive = Math.max(maxAlive, nAlive);
    const root = c.scene.getObjectByName('enemies')!;
    const m = new THREE.Matrix4();
    for (const o of root.children) {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh) continue;
      const kind = im.name.split(':')[1];
      const pivots = (im.geometry.getAttribute('instFlash') as THREE.BufferAttribute).count / 320;
      const want = (alive.get(kind) ?? 0) * pivots;
      if (im.count !== want) { fail(`tick ${i} ${im.name} count ${im.count} != ${want}`); break; }
      if (i % 30 === 0) for (let k = 0; k < im.count; k++) { im.getMatrixAt(k, m); if (!finiteMat(m)) { fail(`${im.name} #${k} non-finite`); break; } }
      if (im.count > 0 && im.visible !== true) fail(`${im.name} has instances but is hidden`);
    }
    seen++;
    if (fails > 5) break;
  }
  const records = (view as unknown as { visList: unknown[] }).visList.length;
  const aliveNow = w.enemies.filter((e) => e.alive).length;
  console.log(`enemies: ${seen} frames, kinds ${[...kindsSeen].join(',')}, max alive ${maxAlive}, kills ${kills}, view records ${records} (alive ${aliveNow})`);
  if (records !== aliveNow) fail(`view records ${records} != alive ${aliveNow}`);
  if (kindsSeen.size !== 8) fail('not every kind was drawn');
  if (kills === 0) fail('no deaths exercised');

  // steady-state allocation: freeze the sim, run many frames, count GC events
  let gcs = 0;
  const obs = new PerformanceObserver((l) => { gcs += l.getEntries().length; });
  obs.observe({ entryTypes: ['gc'] });
  (globalThis as unknown as { gc?: () => void }).gc?.();
  await new Promise((r) => setTimeout(r, 50));
  gcs = 0;
  const f: FrameInfo = { alpha: 0.5, dt: 1 / 60, time: 0, events: [], camDist: 100, frozen: false };
  for (let i = 0; i < 3000; i++) view.update(w, f);     // JIT warm-up
  (globalThis as unknown as { gc?: () => void }).gc?.();
  await new Promise((r) => setTimeout(r, 50));
  gcs = 0;
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) view.update(w, f);
  const h1 = process.memoryUsage().heapUsed;
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  console.log(`enemy steady state: 20000 frames with ${aliveNow} enemies → GC events ${gcs}, heap Δ ${((h1 - h0) / 1024).toFixed(1)} KB`);
  if (gcs > 0) fail(`EnemyView allocates per frame (${gcs} GCs)`);
  view.unmount();
  if (c.scene.getObjectByName('enemies')) fail('unmount left the root in the scene');
}

// ─────────────────────────────── bosses ───────────────────────────────
for (const [id, biome] of [['caisson4', 'lockwater'], ['irongully', 'whitestacks']] as [BossId, BiomeId][]) {
  const w = createWorld({ titan: 'hearthback', biome, seed: 9 });
  w.cheats.god = true; w.cheats.noSpawns = true;
  w.titan.rank = 4; w.titan.height = 60; w.titan.radius = 25.2;
  const c = ctx();
  const view = new BossView(c);
  view.mount(w);
  spawnBoss(w, id);
  const b = w.boss!;
  const attacks = new Set<string>();
  let bad = 0, leash = 0;
  const check = (tag: string) => {
    c.scene.updateMatrixWorld(true);
    c.scene.traverse((o) => { if (o.visible && !finiteMat(o.matrixWorld)) { if (bad++ < 3) fail(`${id} ${tag}: ${o.name} non-finite`); } });
  };
  for (let i = 0; i < 30 * 200; i++) {
    stepWorld(w, i % 400 < 200 ? { mx: 0.6, mz: 0.2, ability: false, abilityHeld: false, dash: false } : NO_INPUT);
    if (b.introT <= 0) b.phase = w.t > 60 ? 3 : w.t > 30 ? 2 : 1;
    if (b.attack) attacks.add(b.attack);
    if (w.titan.leash) leash++;
    if (i === 30 * 150) { b.staggerT = 5; b.attack = null; }
    view.update(w, fr(w));
    if (i % 15 === 0) check(`t=${w.t.toFixed(1)} ${b.attack ?? '-'}`);
  }
  // defeat → collapse runs on view time after the sim stops
  b.alive = false; b.hp = 0;
  for (let k = 0; k < 240; k++) view.update(w, { alpha: 1, dt: 1 / 60, time: k / 60, events: [], camDist: 500, frozen: true });
  check('dead');
  const rig = c.scene.getObjectByName(`boss:${id}`)!;
  const body = rig.getObjectByName(id === 'caisson4' ? 'c4:body' : 'gu:body')!;
  console.log(`${id}: attacks seen ${[...attacks].join(',')} · leash ticks ${leash} · rig visible ${rig.visible} · collapsed body y ${body.position.y.toFixed(1)} · bad ${bad}`);
  if (!rig.visible) fail(`${id} rig hidden while the boss exists`);
  if (body.position.y > (id === 'caisson4' ? 25 : 20)) fail(`${id} did not collapse (body y ${body.position.y})`);
  if (attacks.size < 4) fail(`${id} only ${attacks.size} attacks exercised`);

  // steady-state allocation for the boss view
  let gcs = 0;
  b.alive = true;
  const obs = new PerformanceObserver((l) => { gcs += l.getEntries().length; });
  obs.observe({ entryTypes: ['gc'] });
  (globalThis as unknown as { gc?: () => void }).gc?.();
  await new Promise((r) => setTimeout(r, 50));
  gcs = 0;
  const f: FrameInfo = { alpha: 0.5, dt: 1 / 60, time: 0, events: [], camDist: 500, frozen: false };
  for (let k = 0; k < 3000; k++) view.update(w, f);     // JIT warm-up after the dead→alive flip (lower tiers box doubles)
  (globalThis as unknown as { gc?: () => void }).gc?.();
  await new Promise((r) => setTimeout(r, 50));
  gcs = 0;
  for (let k = 0; k < 20000; k++) view.update(w, f);
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  console.log(`${id} steady state: 20000 frames → GC events ${gcs}`);
  if (gcs > 0) fail(`BossView allocates per frame (${gcs} GCs)`);
  view.unmount();
}

console.log(fails ? `PROBE FAILED (${fails})` : 'PROBE OK');
process.exit(fails ? 1 : 0);
