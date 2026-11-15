// fx lane scratch probe (A1): does the REAL HazardView fire the bloom pod animation only when a seed
// is actually fired? Real createWorld + a bloom hazard with spawnTurret's data, the real view updated
// every tick with that tick's events. Counts view fireAt changes vs seeds spawned.
//   node _harness/scratch/fx/bloom_probe.ts
import * as THREE from 'three';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { spawnHazard } from '../../../src/combat/hazards.ts';
import { spawnEnemy } from '../../../src/ai/enemies.ts';
import { HazardView } from '../../../src/render/hazardview.ts';
import { SIM_DT } from '../../../src/core/config.ts';
import type { SimEvent } from '../../../src/core/types.ts';

function run(withEnemy: boolean, oldDetector: boolean): { seeds: number; viewFires: number; oldFires: number } {
  const w = createWorld({ titan: 'briarwick', biome: 'grideast', seed: 7 });
  w.cheats.god = true; w.cheats.noSpawns = true;
  for (const e of w.enemies) e.alive = false;
  const T = w.titan;
  const hx = T.x + 2, hz = T.z + 2;
  spawnHazard(w, { owner: 'titan', kind: 'bloom', shape: { k: 'circle', x: hx, z: hz, r: 0.3 * T.height }, life: 20, dps: 0,
    data: { cd: 0.4, spore: 4, h: T.height } });
  const ctx = {
    renderer: { domElement: { clientHeight: 720 } } as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 1000),
    quality: { dpr: 1, shadows: false, level: 2 as const, reduceFlashing: false, screenShake: false },
  };
  const v = new HazardView(ctx);
  v.mount(w);
  const events: SimEvent[] = [];
  const f = { alpha: 1, dt: SIM_DT, time: 0, events, camDist: 17, frozen: false };
  let seeds = 0, lastSeed = -1, viewFires = 0, lastFire = -99, oldFires = 0, lastCd = 0.4;
  const idle = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
  for (let tick = 0; tick < 300; tick++) {
    if (withEnemy && tick % 30 === 0 && !w.enemies.some((e) => e.alive)) spawnEnemy(w, 'android', hx + 3, hz + 1);
    stepWorld(w, idle);
    for (const p of w.projectiles) if (p.kind === 'seed' && p.id > lastSeed) { seeds++; lastSeed = p.id; }
    events.length = 0; for (const e of w.events) events.push(e);
    f.time += SIM_DT;
    v.update(w, f);
    // the OLD view detector (cooldown jump > 0.15), for comparison
    for (const h of w.hazards) if (h.kind === 'bloom' && h.alive) { const cd = h.data.cd; if (cd > lastCd + 0.15) oldFires++; lastCd = cd; }
    const recs = (v as unknown as { recs: Map<number, { kind: string; fireAt: number }> }).recs;
    for (const r of recs.values()) if (r.kind === 'bloom' && r.fireAt !== lastFire) { if (r.fireAt > 0) viewFires++; lastFire = r.fireAt; }
  }
  void oldDetector;
  return { seeds, viewFires, oldFires };
}

const a = run(false, false);
const b = run(true, false);
console.log(`no enemy in range : seedsFired=${a.seeds} viewPodFires=${a.viewFires} (old detector would fire ${a.oldFires}) over 10 s`);
console.log(`enemy in range    : seedsFired=${b.seeds} viewPodFires=${b.viewFires} (old detector would fire ${b.oldFires}) over 10 s`);
const ok = a.viewFires === 0 && b.viewFires === b.seeds && b.seeds > 0;
console.log(ok ? 'BLOOM PROBE PASS' : 'BLOOM PROBE FAIL');
process.exit(ok ? 0 : 1);
