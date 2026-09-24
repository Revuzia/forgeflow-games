// A1 check (scratch): a bloom turret's published shot counter vs seeds actually fired, and the OLD
// view heuristic (cooldown jump > 0.15 s) that fired ~4x/s while idle. 300 ticks, with/without an enemy.
import { createWorld, stepWorld } from '../../src/core/world.ts';
import { spawnEnemy } from '../../src/ai/enemies.ts';
import type { TitanInput } from '../../src/core/types.ts';
const NO: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
for (const withEnemy of [false, true]) {
  const w = createWorld({ titan: 'briarwick', biome: 'grideast', seed: 5 });
  w.cheats.noSpawns = true; w.cheats.god = true;
  for (let i = 0; i < 40; i++) stepWorld(w, { ...NO, dash: i === 5 });   // a dash plants a bloom (BRIARWICK passive)
  let bloom = w.hazards.find((h) => h.alive && h.kind === 'bloom');
  if (!bloom) { stepWorld(w, { ...NO, ability: true }); for (let i = 0; i < 20; i++) stepWorld(w, NO); bloom = w.hazards.find((h) => h.alive && h.kind === 'bloom'); }
  if (!bloom) { console.log('no bloom planted'); continue; }
  for (const e of w.enemies) e.alive = false;
  if (withEnemy) { const s = bloom.shape as { x: number; z: number }; spawnEnemy(w, 'android', s.x + 3, s.z + 3); }
  const seen = new Set<number>(); for (const p of w.projectiles) seen.add(p.id);
  let seeds = 0, oldHeur = 0, cdPrev = bloom.data.cd ?? 0; const s0 = bloom.data.shots ?? -1;
  for (let i = 0; i < 300 && bloom.alive; i++) {
    stepWorld(w, NO);
    for (const p of w.projectiles) if (!seen.has(p.id)) { seen.add(p.id); if (p.kind === 'seed') seeds++; }
    const cd = bloom.data.cd ?? 0; if (cd > cdPrev + 0.15) oldHeur++; cdPrev = cd;
    if (withEnemy) for (const e of w.enemies) if (!e.alive) { const s = bloom.shape as { x: number; z: number }; spawnEnemy(w, 'android', s.x + 3, s.z + 3); break; }
  }
  console.log(JSON.stringify({ enemyInRange: withEnemy, seedsFired: seeds, shotsCounterDelta: (bloom.data.shots ?? -1) - s0, oldCooldownJumpHeuristic: oldHeur }));
}
