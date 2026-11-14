// BLOCKTOOTH — level-pace probe (scratch, harness code). Where does the XP economy put each level in time?
//   node _harness/scratch/level_pace.ts [--seeds 1337,7] [--minutes 8.5]
// Runs the gate bot (same draft path as probe_sim) over the 12 titan × biome configs and prints, per run,
// the level at the rank schedule times (90 / 210 / 360 / 480 s), the Size-up times and the time of every
// RANK_LEVELS threshold — the data RANK_LEVELS / the XP curve were tuned from.
import type { BiomeId, TitanId } from '../../src/core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../../src/core/types.ts';
import { RANK_LEVELS, RANK_SCHEDULE_S } from '../../src/core/config.ts';
import { createWorld, stepWorld } from '../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../bot.ts';

const argv = process.argv.slice(2);
const get = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const seeds = get('--seeds', '1337').split(',').map(Number);
const minutes = Number(get('--minutes', '8.5'));
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const lvAt: number[][] = [[], [], [], [], []];
for (const seed of seeds) for (const titan of TITAN_IDS as readonly TitanId[]) for (const biome of BIOME_IDS as readonly BiomeId[]) {
  const w = createWorld({ titan, biome, seed });
  const rankT = [0, NaN, NaN, NaN, NaN];
  const lvT: Record<number, number> = {};
  const lv: number[] = [];
  let k = 1;
  const maxTicks = Math.round(minutes * 60 * 30);
  for (let i = 0; i < maxTicks && !w.run.result; i++) {
    while (hasPendingDraft(w)) {
      const chest = w.upgrades.chestDrafts > 0;
      const offer = w.upgrades.offer && w.upgrades.offer.length > 0 ? w.upgrades.offer : rollOffer(w, chest);
      pickUpgrade(w, botPickUpgrade(w, offer));
    }
    stepWorld(w, botInput(w));
    for (const ev of w.events) {
      if (ev.type === 'rankUp' && Number.isNaN(rankT[ev.rank])) rankT[ev.rank] = w.t;
      if (ev.type === 'levelUp' && lvT[ev.level] === undefined) lvT[ev.level] = w.t;
    }
    while (k < RANK_SCHEDULE_S.length && w.t >= RANK_SCHEDULE_S[k]) { lv[k] = w.titan.level; lvAt[k].push(w.titan.level); k++; }
  }
  const thr = RANK_LEVELS.slice(1).map((L) => `LV${L}@${lvT[L] === undefined ? '—' : lvT[L].toFixed(0)}`).join(' ');
  console.log(`${(titan + '/' + biome).padEnd(22)} s${seed}  LV at ${RANK_SCHEDULE_S.slice(1).join('/')} s: ${lv.slice(1).join('/')}` +
    `  | Size ${[1, 2, 3, 4].map((r) => `${ROMAN[r]} ${Number.isNaN(rankT[r]) ? '—' : rankT[r].toFixed(0)}`).join(' ')}  | ${thr}  | ${w.run.result ?? 'on'} @${w.t.toFixed(0)}`);
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
console.log(`median LV at ${RANK_SCHEDULE_S.slice(1).join('/')} s: ${[1, 2, 3, 4].map((k) => `${med(lvAt[k])} (${Math.min(...lvAt[k])}–${Math.max(...lvAt[k])})`).join(' / ')}`);
