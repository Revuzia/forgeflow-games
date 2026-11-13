// F1 scratch: GATE-2-identical run loop (probe_sim runOne draft path) that records evolutions.
// node _harness/scratch/f1/evo_matrix.ts [fresh|full] [seed]
import type { World } from '../../../src/core/types.ts';
const { BIOME_IDS, EMPTY_RUN_META, TITAN_IDS } = await import('../../../src/core/types.ts');
const { SIM_HZ } = await import('../../../src/core/config.ts');
const { createWorld, stepWorld } = await import('../../../src/core/world.ts');
const DR = await import('../../../src/upgrades/draft.ts');
const { botInput, botPickUpgrade } = await import('../../bot.ts');
const { UPGRADES, UPGRADE_BY_ID } = await import('../../../src/data/upgrades.ts');
const meta = process.argv[2] === 'full' ? 'full' : 'fresh';
const seed = Number(process.argv[3] ?? 1337);
const NOEVO = process.argv[4] === 'noevo';   // bot never takes an evolution (A/B)
const ONLY = process.argv[5] ?? '';           // titan/biome filter, e.g. hearthback/lockwater
const locked = UPGRADES.filter((u) => u.locked).map((u) => u.id).sort();
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const rows: string[] = [];
let runsWith = 0, totalEvos = 0, clears = 0, deaths = 0;
const firstRanks: number[] = [];
const countDist: number[] = [0, 0, 0, 0, 0, 0];
for (const titan of TITAN_IDS) for (const biome of BIOME_IDS) {
  if (ONLY && `${titan}/${biome}` !== ONLY && titan !== ONLY) continue;
  const w: World = createWorld({ titan, biome, seed, meta: { ...EMPTY_RUN_META, unlocked: meta === 'full' ? locked.slice() : [] } });
  const maxTicks = 13 * 60 * SIM_HZ;
  const evos: string[] = [];
  let firstReady = -1, offered = 0, readyDrafts = 0;
  const RANKT: number[] = [];
  for (let i = 0; i < maxTicks && !w.run.result; i++) {
    let guard = 0;
    while (DR.hasPendingDraft(w)) {
      if (++guard > 200) break;
      const chest = w.upgrades.chestDrafts > 0;
      const offer = w.upgrades.offer && w.upgrades.offer.length > 0 ? w.upgrades.offer : DR.rollOffer(w, chest);
      if (!offer || offer.length === 0) break;
      if (DR.evolutionsReady(w).length > 0) { readyDrafts++; if (firstReady < 0) firstReady = w.t; }
      if (offer.some((id) => !!UPGRADE_BY_ID[id].evo)) offered++;
      const nonEvo = offer.filter((id) => !UPGRADE_BY_ID[id].evo);
      const pick = NOEVO && nonEvo.length ? botPickUpgrade(w, nonEvo) : botPickUpgrade(w, offer);
      if (process.env.BT_F1_TRACE) console.log(`  t${w.t.toFixed(0)} ${ROMAN[w.titan.rank]}${chest ? 'C' : ' '} [${offer.join(', ')}] -> ${pick}`);
      if (UPGRADE_BY_ID[pick].evo) evos.push(`${pick.replace('evo_', '')}@${w.t.toFixed(0)}s/${ROMAN[w.titan.rank]}${chest ? '(C)' : ''}`);
      if (UPGRADE_BY_ID[pick].evo && evos.length === 1) firstRanks.push(w.titan.rank);
      DR.pickUpgrade(w, pick);
    }
    stepWorld(w, botInput(w));
    while (RANKT.length < w.titan.rank) RANKT.push(Math.round(w.t));
  }
  const prog = DR.evolutionProgress(w).map((p) => `${p.evo.replace('evo_', '').slice(0, 12)}[${p.baseHave}/${p.baseNeed}${p.withHave ? '+W' : ''}]`).join(' ');
  const res = w.run.result ?? 'timeout';
  if (res === 'clear') clears++; if (res === 'dead') deaths++;
  if (evos.length) runsWith++;
  totalEvos += evos.length; countDist[Math.min(5, evos.length)]++;
  rows.push(`${titan.padEnd(10)} ${biome.padEnd(11)} ${res.padEnd(7)} @${(w.run.result ? w.run.endT : w.t).toFixed(0).padStart(4)}s Size ${ROMAN[w.titan.rank]} rankT ${JSON.stringify(RANKT)} · firstReady ${firstReady < 0 ? '-' : firstReady.toFixed(0) + 's'} · readyDrafts ${readyDrafts} · offered ${offered} · evos ${evos.length}: ${evos.join(' ')} · open: ${prog}`);
  console.log(rows[rows.length - 1]);
}
console.log(`\n--meta ${meta} seed ${seed}: runs with >=1 evolution ${runsWith}/12 · total ${totalEvos} · per-run count dist [0..5+] ${countDist.join('/')} · first evo at Size ${firstRanks.map((r) => ROMAN[r]).join(',')} · clears ${clears} deaths ${deaths}`);
