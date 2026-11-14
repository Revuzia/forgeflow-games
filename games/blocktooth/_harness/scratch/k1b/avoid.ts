// K1b scratch: replicate probe_gatekeepers case 7 (avoider) for one gate/titan/biome with a per-2 s trace.
import type { BossState, TitanInput, World, TitanId, BiomeId } from '../../../src/core/types.ts';
import { EMPTY_RUN_META } from '../../../src/core/types.ts';
import { RANK_LEVELS, GATES } from '../../../src/core/config.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { gainGrowth } from '../../../src/titans/titansim.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botPickUpgrade } from '../../bot.ts';
import { bossH, gateRing, gateAddIds } from '../../../src/ai/bosses/index.ts';
const [gate, titan, biome] = [process.argv[2] ?? 'switchboard5', (process.argv[3] ?? 'molo') as TitanId, (process.argv[4] ?? 'grideast') as BiomeId];
const s = gate === 'stencil1' ? 1 : gate === 'cordon2' ? 2 : 3;
function drafts(w: World) { let g = 0; while (hasPendingDraft(w) && g++ < 200) { const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); pickUpgrade(w, botPickUpgrade(w, o)); } }
const w = createWorld({ titan, biome, seed: 1337, meta: { ...EMPTY_RUN_META, unlocked: [] } });
w.cheats.god = true; w.cheats.noSpawns = true; w.gates.unlocked = (s - 1) as 0;
for (let g = 0; g < 200 && w.titan.level < RANK_LEVELS[s] - 1; g++) { gainGrowth(w, 1); drafts(w); }
for (let i = 0; i < 150; i++) { drafts(w); stepWorld(w, NO_INPUT); }
for (const e of w.enemies) e.alive = false; w.enemies.length = 0;
gainGrowth(w, 1); drafts(w);
w.cheats.noSpawns = false;
for (let i = 0; i < 300 && !(w.boss && w.boss.alive); i++) { stepWorld(w, NO_INPUT); for (const e of w.enemies) e.alive = false; }
w.cheats.noSpawns = false;
const b = w.boss as BossState;
function avoid(): TitanInput {
  const T = w.titan, Bd = w.city.bounds;
  T.stats.damage = 0; T.stats.smashDamage = 0;
  let dx = T.x - b.x, dz = T.z - b.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  const edge = Math.max(3, 2 * T.radius);
  if ((T.x < Bd.minX + edge && dx < 0) || (T.x > Bd.maxX - edge && dx > 0)) dx = 0;
  if ((T.z < Bd.minZ + edge && dz < 0) || (T.z > Bd.maxZ - edge && dz > 0)) dz = 0;
  if (Math.hypot(dx, dz) < 0.2) { const cx = (Bd.minX + Bd.maxX) / 2, cz = (Bd.minZ + Bd.maxZ) / 2; dx = Math.sign(cx - T.x) || 1; dz = Math.sign(cz - T.z) || 1; if (Math.abs(b.x - T.x) > Math.abs(b.z - T.z)) dx = 0; else dz = 0; }
  const m = Math.hypot(dx, dz) || 1; return { mx: dx / m, mz: dz / m, ability: false, abilityHeld: false, dash: false };
}
let lastE = 0;
for (let i = 0; i < 160 * 30 && b.alive; i++) {
  stepWorld(w, avoid());
  const G = w.gates, H = bossH(w, b), T = w.titan;
  if (i % 60 === 0 || (G.engagedS > lastE + 1e-9 && i % 15 === 0)) {
    const d = Math.hypot(T.x - b.x, T.z - b.z) / H;
    console.log(`t ${(w.t).toFixed(1)} live ${G.liveFightS.toFixed(1)} d ${d.toFixed(2)} H (band+0.5 ${(b.data.bandMaxH + 0.5).toFixed(1)}; 2.2 ring ${(2.2 * gateRing(w) / H).toFixed(1)}) eng ${G.engagedS.toFixed(1)} p ${G.pressure} lastHit ${(w.t - (b.data.lastHitT ?? -1e9)).toFixed(1)} lastAdd ${(w.t - G.lastAddHitT).toFixed(1)} adds ${gateAddIds(w).length} mode ${b.data.mode ?? '-'} att ${b.attack} speed ${(b.data.speed / H).toFixed(2)} H/s titanV ${(Math.hypot(T.vx, T.vz) / H).toFixed(2)} T(${T.x.toFixed(0)},${T.z.toFixed(0)})`);
  }
  lastE = G.engagedS;
}
