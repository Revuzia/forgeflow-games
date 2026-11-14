// K1b scratch: replicate probe_gatekeepers case 12's movement check for one gatekeeper rematch, with a trace.
import type { BossState, GateId, TitanInput, World } from '../../../src/core/types.ts';
import { EMPTY_RUN_META, GATE_IDS } from '../../../src/core/types.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { gainGrowth } from '../../../src/titans/titansim.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botPickUpgrade } from '../../bot.ts';
import { bossH } from '../../../src/ai/bosses/index.ts';
import { continueEndless } from '../../../src/meta/endless.ts';
const id = (process.argv[2] ?? 'switchboard5') as GateId;
function drafts(w: World) { let g = 0; while (hasPendingDraft(w) && g++ < 200) { const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); pickUpgrade(w, botPickUpgrade(w, o)); } }
const w = createWorld({ titan: (process.argv[3] ?? 'molo') as never, biome: (process.argv[4] ?? 'grideast') as never, seed: 1337, meta: { ...EMPTY_RUN_META, unlocked: [] } });
w.cheats.god = true; w.cheats.noSpawns = true; w.gates.unlocked = 4;
for (let g = 0; g < 200 && w.titan.level < 36; g++) { gainGrowth(w, 1); drafts(w); }
for (let i = 0; i < 150; i++) { drafts(w); stepWorld(w, NO_INPUT); }
for (const e of w.enemies) e.alive = false; w.enemies.length = 0;
w.gates.finaleDone = true; w.gates.mainKillT = w.t; w.run.result = 'clear';
continueEndless(w);
w.gates.rematchSeq = 2 * GATE_IDS.indexOf(id); w.endless!.nextBossT = w.t;
for (let i = 0; i < 5 && !(w.boss && w.boss.alive); i++) stepWorld(w, NO_INPUT);
const b = w.boss as BossState;
console.log('fielded', b.id, b.slot, 'H', bossH(w, b).toFixed(1));
function avoid(): TitanInput {
  const T = w.titan; T.stats.damage = 0; T.stats.smashDamage = 0;
  let dx = T.x - b.x, dz = T.z - b.z; const d = Math.hypot(dx, dz) || 1; return { mx: dx / d, mz: dz / d, ability: false, abilityHeld: false, dash: false };
}
w.cheats.noSpawns = false;
while (b.introT > 0 && b.alive) stepWorld(w, avoid());
const x0 = b.x, z0 = b.z, H = bossH(w, b);
for (let i = 0; i < 300 && b.alive; i++) {
  stepWorld(w, avoid());
  if (i % 15 === 0) { const T = w.titan; console.log(`+${(i / 30).toFixed(1)}s moved ${(Math.hypot(b.x - x0, b.z - z0) / H).toFixed(2)} H · d ${(Math.hypot(T.x - b.x, T.z - b.z) / H).toFixed(2)} H · mode ${b.data.mode ?? '-'} att ${b.attack} rig ${(b.data.speed / H).toFixed(2)} H/s titan ${(Math.hypot(T.vx, T.vz) / H).toFixed(2)} H/s ram ${b.data.ramT?.toFixed(2)} det ${b.data.detourT?.toFixed(2)}`); }
}
