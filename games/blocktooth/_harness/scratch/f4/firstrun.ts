// F4 scratch: goals met in a FIRST run (empty profile) per titan × biome with the gate bot; also checks
// the titan's hp never exceeds maxHp (HP readout finding).  node _harness/scratch/f4/firstrun.ts [--seed N] [--only molo/grideast]
import type { BiomeId, TitanId, World } from '../../../src/core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../../../src/core/types.ts';
import { SIM_HZ } from '../../../src/core/config.ts';
import * as W from '../../../src/core/world.ts';
import * as D from '../../../src/upgrades/draft.ts';
import * as B from '../../bot.ts';
import * as G from '../../../src/meta/goals.ts';
import * as P from '../../../src/meta/profile.ts';
import { GOALS } from '../../../src/data/goals.ts';
import { writeFileSync } from 'node:fs';
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SEED = Number(arg('--seed') ?? 1337);
const only = arg('--only');
const rows: string[] = [];
const dump: unknown[] = [];
const ratio: Record<string, number[]> = {};
let hpOver = 0, hpOverMax = 0;
for (const t of TITAN_IDS) for (const b of BIOME_IDS) {
  if (only && only !== `${t}/${b}`) continue;
  const w: World = W.createWorld({ titan: t as TitanId, biome: b as BiomeId, seed: SEED, meta: { unlocked: [], perk: null, palette: 0, reviveUsed: false } });
  const prof = P.emptyProfile();
  const ctx = { titan: t, biome: b, result: null as 'clear' | 'dead' | null, endT: -1 };
  const live = new Set<string>();
  const t0 = performance.now();
  for (let i = 0; i < 13 * 60 * SIM_HZ && !w.run.result; i++) {
    let g = 0;
    while (D.hasPendingDraft(w) && ++g < 200) {
      const chest = w.upgrades.chestDrafts > 0;
      const offer = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : D.rollOffer(w, chest);
      if (!offer || !offer.length) break;
      D.pickUpgrade(w, B.botPickUpgrade(w, offer));
    }
    W.stepWorld(w, B.botInput(w));
    const T = w.titan;
    if (T.hp > T.maxHp + 1e-9) { hpOver++; hpOverMax = Math.max(hpOverMax, T.hp - T.maxHp); }
    if (w.tick % SIM_HZ === 0 || w.run.result) {
      ctx.result = w.run.result; ctx.endT = w.run.endT;
      for (const id of G.evalGoals(prof, w.tally, ctx)) { live.add(id); prof.done[id] = 1; }
    }
  }
  const res = (w.run.result ?? 'dead') as 'clear' | 'dead';
  const { newly } = G.applyRunToProfile(prof, w, res);
  const all = new Set([...live, ...newly]);
  const vals: Record<string, number> = {};
  for (const g of GOALS) {
    if (g.scope !== 'run' || g.lowerIsBetter) continue;
    if ((g.titan && g.titan !== t) || (g.biome && g.biome !== b)) continue;
    const v = G.goalProgress(g, P.emptyProfile(), w.tally, { titan: t, biome: b, result: w.run.result, endT: w.run.endT });
    (ratio[g.id] ??= []).push(v / g.target);
    vals[g.id] = v;
  }
  dump.push({ titan: t, biome: b, result: w.run.result, endT: w.t, newly, live: [...live], vals });
  rows.push(`${t.padEnd(10)} ${b.padEnd(11)} ${String(w.run.result ?? 'timeout').padEnd(7)} @${w.t.toFixed(0).padStart(4)}s met ${String(all.size).padStart(2)} : ${[...all].join(' ')}  (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
  console.log(rows[rows.length - 1]);
}
console.log('\nper run-goal value/target across runs (min med max):');
for (const [id, a] of Object.entries(ratio)) { a.sort((x, y) => x - y); console.log(`  ${id.padEnd(26)} ${a[0].toFixed(2)} ${a[a.length >> 1].toFixed(2)} ${a[a.length - 1].toFixed(2)}  n=${a.length}`); }
writeFileSync(`_harness/scratch/f4/firstrun_${SEED}.json`, JSON.stringify(dump, null, 1));
console.log(`\nhp > maxHp ticks: ${hpOver} (max excess ${hpOverMax.toExponential(2)})`);
