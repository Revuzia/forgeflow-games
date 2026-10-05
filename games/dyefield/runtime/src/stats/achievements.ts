// DYEFIELD — the 29 achievements (_spec/CONTRACT_STATS.md §S6). Pure: THREE-free, DOM-free.
// achievements.json is the single source of truth (the seeder reads the same file); this module attaches one detector per
// slug. Detectors run at finalize on ELIGIBLE records only: `r` = the record, `C` = the display career AFTER applying r.

import json from './achievements.json' with { type: 'json' };
import type { AchievementDef, CareerCounters, MatchRecord } from './types.ts';

export const ACHIEVEMENTS: readonly AchievementDef[] = (json as unknown as { achievements: AchievementDef[] }).achievements;
export const ACH_BY_SLUG: ReadonlyMap<string, AchievementDef> = new Map(ACHIEVEMENTS.map((a) => [a.slug, a]));
export const ACH_TOTAL_XP = ACHIEVEMENTS.reduce((s, a) => s + a.points, 0);

export type Detector = (r: MatchRecord, C: CareerCounters) => boolean;

const KITS4 = ['mist-rasp', 'sheet-drum', 'needle-glint', 'pop-well'];
const MAPS3 = ['pier18', 'lockwell', 'cinder'];
const win = (r: MatchRecord): boolean => r.result === 'win';
const winsOn = (rec: Record<string, { w: number }> | undefined, k: string): boolean => (rec?.[k]?.w ?? 0) >= 1;

export const DETECTORS: Readonly<Record<string, Detector>> = {
  first_match: (_r, C) => C.matches >= 1,
  first_win: (r) => win(r),
  teams_turf_win: (r) => r.mode === 'teams' && r.rule === 'turf' && win(r),
  teams_washout_win: (r) => r.mode === 'teams' && r.rule === 'washout' && win(r),
  ffa_turf_win: (r) => r.mode === 'ffa' && r.rule === 'turf' && win(r),
  ffa_washout_win: (r) => r.mode === 'ffa' && r.rule === 'washout' && win(r),
  ffa_podium: (r) => r.mode === 'ffa' && r.place <= 3,
  washout_limit: (r) => r.rule === 'washout' && win(r) && r.endedBy === 'limit',
  kit_mist_rasp: (r) => win(r) && r.kit === 'mist-rasp',
  kit_sheet_drum: (r) => win(r) && r.kit === 'sheet-drum',
  kit_needle_glint: (r) => win(r) && r.kit === 'needle-glint',
  kit_pop_well: (r) => win(r) && r.kit === 'pop-well',
  all_kits: (_r, C) => KITS4.every((k) => winsOn(C.byKit, k)),
  map_pier18: (r) => win(r) && r.map === 'pier18',
  map_lockwell: (r) => win(r) && r.map === 'lockwell',
  map_cinder: (r) => win(r) && r.map === 'cinder',
  all_maps: (_r, C) => MAPS3.every((m) => winsOn(C.byMap, m)),
  turf_50: (r) => r.mode === 'teams' && r.rule === 'turf' && r.turfPct >= 50,
  paint_1500: (r) => r.paintedM2 >= 1500,
  washes_10: (r) => r.washes >= 10,
  streak_5: (r) => r.bestStreak >= 5,
  splashdown: (r) => r.splashdowns >= 1,
  flawless: (r) => win(r) && r.washed === 0 && r.paintedM2 >= 600,
  storm_win: (r) => !r.online && r.skill === 'storm' && win(r),
  matches_25: (_r, C) => C.matches >= 25,
  matches_100: (_r, C) => C.matches >= 100,
  online_first: (r) => r.online,
  online_win: (r) => r.online && win(r),
  online_wins_10: (_r, C) => C.online.w >= 10,
};

/** every slug whose detector fires for (r, C), in table order; [] for an ineligible record */
export function detect(r: MatchRecord, C: CareerCounters): string[] {
  if (!r.eligible) return [];
  const out: string[] = [];
  for (const a of ACHIEVEMENTS) {
    const d = DETECTORS[a.slug];
    try { if (d && d(r, C)) out.push(a.slug); } catch { /* a detector never throws on a valid record; never let one stop the rest */ }
  }
  return out;
}

/** sanity: every JSON row has a detector and vice versa (the probe asserts this) */
export function detectorCoverage(): { missingDetector: string[]; orphanDetector: string[] } {
  const slugs = new Set(ACHIEVEMENTS.map((a) => a.slug));
  return {
    missingDetector: [...slugs].filter((s) => !DETECTORS[s]),
    orphanDetector: Object.keys(DETECTORS).filter((s) => !slugs.has(s)),
  };
}
