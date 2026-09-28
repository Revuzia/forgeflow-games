// K1b scratch: replicate probe_gatekeepers case 15 for one gate/biome/titan/seed, with a trace.
import type { BossState, GateId, World, TitanId, BiomeId } from '../../../src/core/types.ts';
import { EMPTY_RUN_META, GATE_IDS } from '../../../src/core/types.ts';
import { GATES, RANK_LEVELS } from '../../../src/core/config.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { gainGrowth } from '../../../src/titans/titansim.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botPickUpgrade } from '../../bot.ts';
import { bossH, gateCrushTier, laneClearLen } from '../../../src/ai/bosses/index.ts';
import { resolveCircleVsCity } from '../../../src/city/citysim.ts';
const gate = (process.argv[2] ?? 'cordon2') as GateId, biome = (process.argv[3] ?? 'grideast') as BiomeId, titan = (process.argv[4] ?? 'molo') as TitanId, seed = Number(process.argv[5] ?? 1337);
const s = GATE_IDS.indexOf(gate) + 1;
function drafts(w: World) { let g = 0; while (hasPendingDraft(w) && g++ < 200) { const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0); if (!o || !o.length) break; pickUpgrade(w, botPickUpgrade(w, o)); } }
const w = createWorld({ titan, biome, seed, meta: { ...EMPTY_RUN_META, unlocked: [] } });
w.cheats.god = true; w.cheats.noSpawns = true; w.gates.unlocked = (s - 1) as 0;
for (let g = 0; g < 200 && w.titan.level < RANK_LEVELS[s] - 1; g++) { gainGrowth(w, 1); drafts(w); }
for (let i = 0; i < 150; i++) { drafts(w); stepWorld(w, NO_INPUT); }
for (const e of w.enemies) e.alive = false; w.enemies.length = 0;
const T = w.titan, tier = GATES.crushTier[gate], cell = 72, Bd = w.city.bounds;
const cnt = new Map<string, number>();
const bs = w.city.buildings.filter((q) => !q.collapsed && q.tier > tier);
for (const q of bs) { const k = `${Math.floor((q.x - Bd.minX) / cell)},${Math.floor((q.z - Bd.minZ) / cell)}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
let best = -1, bi = 0, bj = 0;
for (const k of cnt.keys()) { const [i, j] = k.split(',').map(Number); let c = 0; for (let a = -1; a <= 1; a++) for (let d = -1; d <= 1; d++) c += cnt.get(`${i + a},${j + d}`) ?? 0; if (c > best) { best = c; bi = i; bj = j; } }
const cx = Bd.minX + (bi + 0.5) * cell, cz = Bd.minZ + (bj + 0.5) * cell;
let bld = bs[0]; let bdd = Infinity;
for (const q of bs) { const d = Math.hypot(q.x - cx, q.z - cz); if (d < bdd) { bdd = d; bld = q; } }
const PIN = { x: 0, z: 0, bumpTier: -1 };
for (let a = 0; a < 8; a++) {
  const ang = (a * Math.PI) / 4, off = Math.max(bld.w, bld.d) / 2 + T.radius + 1;
  const x = bld.x - Math.sin(ang) * off, z = bld.z - Math.cos(ang) * off;
  if (x < Bd.minX + 5 || x > Bd.maxX - 5 || z < Bd.minZ + 5 || z > Bd.maxZ - 5) continue;
  if (resolveCircleVsCity(w.city, x, z, T.radius, T.rank as 0, PIN)) continue;
  T.x = x; T.z = z; T.px = x; T.pz = z; T.heading = ang; T.vx = 0; T.vz = 0; break;
}
gainGrowth(w, 1); drafts(w);
w.cheats.noSpawns = false;
for (let i = 0; i < 300 && !(w.boss && w.boss.alive); i++) { stepWorld(w, NO_INPUT); for (const e of w.enemies) e.alive = false; }
w.cheats.noSpawns = true;
const b = w.boss as BossState;
const H = bossH(w, b);
console.log(`${gate} fielded at d ${(Math.hypot(T.x - b.x, T.z - b.z) / H).toFixed(2)} H, building tier ${bld.tier} w ${bld.w.toFixed(0)} d ${bld.d.toFixed(0)}`);
for (let i = 0; i < 25 * 30; i++) {
  stepWorld(w, NO_INPUT);
  const ev = w.events.filter((e) => e.type === 'gateRam' || e.type === 'bossAttack' || e.type === 'gateReposition').map((e) => e.type + (e.type === 'bossAttack' ? ':' + e.attack : ''));
  if (i % 30 === 0 || ev.length) console.log(`t+${(i / 30).toFixed(1)} d ${(Math.hypot(T.x - b.x, T.z - b.z) / H).toFixed(2)} H intro ${b.introT.toFixed(1)} att ${b.attack} speed ${(b.data.speed / H).toFixed(2)} stuckN ${b.data.stuckN} det ${(b.data.detourT ?? 0).toFixed(2)} ram ${(b.data.ramT ?? 0).toFixed(2)} tier ${gateCrushTier(b)} lurch ${(b.data.lurchT ?? 0).toFixed(2)} cd ${b.cd.toFixed(2)} huntTick ${b.data.huntTick === w.tick ? 'Y' : 'n'} ${ev.join(',')}`);
}
