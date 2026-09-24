// probe_ai's passive-god CAISSON-4 fight, traced (scratch).
import { createWorld, stepWorld, NO_INPUT } from '../../src/core/world.ts';
import { RANKS } from '../../src/core/config.ts';
import { gainMass } from '../../src/titans/titansim.ts';
const w = createWorld({ titan: 'molo', biome: 'grideast', seed: 11 }); w.cheats.god = true;
const RANK_AT = [0, 90, 210, 360, 480];
while (w.t < 540 - 1e-9 && !w.run.result) { for (let r = 1; r <= 4; r++) if (w.t >= RANK_AT[r] && w.titan.rank < r) for (let g = 0; g < 200 && w.titan.rank < r; g++) gainMass(w, RANKS[w.titan.rank].massToNext * 1.2 + 10); stepWorld(w, NO_INPUT); }
const b = w.boss!; const t0 = w.t; let f2 = false, f3 = false;
while (w.t - t0 < 135 && !w.run.result && b.alive) {
  const el = w.t - t0;
  if (!f2 && el >= 45) { f2 = true; if (b.phase < 2) b.hp = b.maxHp * 0.6; }
  if (!f3 && el >= 90) { f3 = true; if (b.phase < 3) b.hp = b.maxHp * 0.3; }
  stepWorld(w, NO_INPUT);
  for (const e of w.events) if (e.type === 'bossAttack' || e.type === 'bossPhase' || e.type === 'bossStagger' || e.type === 'leash') console.log(`+${(w.t - t0).toFixed(1)} ${e.type} ${JSON.stringify(e)}`);
  if (el >= 80 && w.tick % 30 === 0) console.log(`+${el.toFixed(0)} p${b.phase} hp ${(100 * b.hp / b.maxHp).toFixed(0)}% atk ${b.attack} t ${b.attackT.toFixed(1)} cd ${b.cd.toFixed(1)} stag ${b.staggerT.toFixed(1)} d ${Math.hypot(b.x - w.titan.x, b.z - w.titan.z).toFixed(0)} leash ${w.titan.leash ? 1 : 0} fat ${(b.data.fatigue ?? 0).toFixed(4)}`);
}
