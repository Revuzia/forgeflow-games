// DYEFIELD — the weekly leaderboard score (_spec/CONTRACT_STATS.md §S4). Pure: THREE-free, DOM-free.
//
//   t      = max(liveS, 30) / 60                              live minutes
//   E      = BASELINE[map][mode][rule][kit]                   per-minute medians (baselines.ts, generated)
//   cap    = CAP[skill]                                       breeze 1.5 · swell 2.5 · storm 3.0
//   pPerf  = min(cap, (paintedM2 / t) / max(E.paint, 100))
//   wPerf  = min(cap, (washes / t)    / max(E.wash, 1.0))
//   (wp, ww) = turf ? (0.7, 0.3) : (0.3, 0.7)
//   base   = 1000 × (wp × pPerf + ww × wPerf)
//   bonus  = TEAMS: win 250 · draw 100 · loss 0;  FFA: round(250 × (crews − place) / (crews − 1))
//   factor = TIER[skill]                                      (online too: the room's bot tier; quick match = SWELL = 1)
//   score  = eligible ? max(0, round((base + bonus) × factor)) : 0
//
// TIER is calibrated on UNCAPPED bases (baseScore(..., false)); the generator lives in _harness/probe_stats.ts.

import type { BotSkill, MatchRecord } from './types.ts';
import { BASELINE, TIER, type BaselineCell } from './baselines.ts';

export const SCORE_V = 1 as const;
export const CAP: Readonly<Record<BotSkill, number>> = { breeze: 1.5, swell: 2.5, storm: 3.0 };
export const BONUS_WIN = 250;
export const BONUS_DRAW = 100;
/** the absolute ceiling: (1000 × 3 + 250) × the TIER clamp's top (1.6) */
export const SCORE_CEILING = 5200;
export const TIER_MIN = 0.6;
export const TIER_MAX = 1.6;
const FALLBACK_CELL: BaselineCell = { paint: 100, wash: 1 };

const median = (a: number[]): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** the baseline cell of (map, mode, rule, kit); a cell the table lacks falls back to the median of the same mode/rule/kit
 *  over the other maps, then of the same mode/rule over every kit, then { paint 100, wash 1 } (the formula's floors) */
export function cellFor(map: string, mode: string, rule: string, kit: string): BaselineCell {
  const exact = BASELINE[map]?.[mode]?.[rule]?.[kit];
  if (exact) return exact;
  const sameKit: BaselineCell[] = [], sameRule: BaselineCell[] = [];
  for (const m of Object.keys(BASELINE)) {
    const byKit = BASELINE[m]?.[mode]?.[rule];
    if (!byKit) continue;
    for (const k of Object.keys(byKit)) {
      sameRule.push(byKit[k]);
      if (k === kit) sameKit.push(byKit[k]);
    }
  }
  const pick = sameKit.length ? sameKit : sameRule;
  if (!pick.length) return FALLBACK_CELL;
  return { paint: median(pick.map((c) => c.paint)), wash: median(pick.map((c) => c.wash)) };
}

export interface ScoreInput {
  map: string; mode: 'teams' | 'ffa'; rule: 'turf' | 'washout'; kit: string; skill: BotSkill;
  liveS: number; paintedM2: number; washes: number;
}

/** paint / wash performance vs. the baseline cell; capped at CAP[skill] unless `capped` is false (TIER calibration) */
export function perfs(i: ScoreInput, capped = true): { pPerf: number; wPerf: number; t: number; cell: BaselineCell } {
  const t = Math.max(i.liveS, 30) / 60;
  const cell = cellFor(i.map, i.mode, i.rule, i.kit);
  const cap = capped ? (CAP[i.skill] ?? CAP.swell) : Infinity;
  const pPerf = Math.min(cap, (Math.max(0, i.paintedM2) / t) / Math.max(cell.paint, 100));
  const wPerf = Math.min(cap, (Math.max(0, i.washes) / t) / Math.max(cell.wash, 1.0));
  return { pPerf, wPerf, t, cell };
}

/** 1000 × (wp × pPerf + ww × wPerf) */
export function baseScore(i: ScoreInput, capped = true): number {
  const { pPerf, wPerf } = perfs(i, capped);
  const [wp, ww] = i.rule === 'turf' ? [0.7, 0.3] : [0.3, 0.7];
  return 1000 * (wp * pPerf + ww * wPerf);
}

/** the result bonus: TEAMS win 250 / draw 100 / loss 0; FFA 250 for 1st … 0 for last (tied crews share their rank's) */
export function resultBonus(mode: 'teams' | 'ffa', result: 'win' | 'loss' | 'draw', place: number, crews: number): number {
  if (mode === 'teams') return result === 'win' ? BONUS_WIN : result === 'draw' ? BONUS_DRAW : 0;
  if (!(crews > 1)) return 0;
  const p = Math.min(Math.max(1, Math.round(place)), crews);
  return Math.round(BONUS_WIN * (crews - p) / (crews - 1));
}

export function tierFactor(skill: BotSkill): number {
  const f = TIER[skill];
  return typeof f === 'number' && Number.isFinite(f) ? f : 1;
}

/** the §S4 score of a record (0 when not eligible). Pure; the record's own `eligible` decides. */
export function scoreRecord(r: Pick<MatchRecord, 'map' | 'mode' | 'rule' | 'kit' | 'skill' | 'liveS' | 'paintedM2' | 'washes' |
  'result' | 'place' | 'crews' | 'eligible'>): number {
  if (!r.eligible) return 0;
  const base = baseScore(r, true);
  const bonus = resultBonus(r.mode, r.result, r.place, r.crews);
  const s = Math.round((base + bonus) * tierFactor(r.skill));
  return Math.max(0, Math.min(SCORE_CEILING, s));
}

/** the highest score a tier allows: (1000 × CAP + 250) × TIER — must rise breeze < swell < storm (§S4) */
export function tierCeiling(skill: BotSkill): number {
  return (1000 * CAP[skill] + BONUS_WIN) * tierFactor(skill);
}
