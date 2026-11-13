// DYEFIELD — STATS score baselines (_spec/CONTRACT_STATS.md §S4). GENERATED — never hand-tune.
//
//   command : node _harness/probe_stats.ts --baselines --write
//   date    : 2026-10-02T04:00:55.720Z
//   E cells : bot-only SWELL matches, the shipping mixed lineup (human slot = a SWELL bot with mist-rasp), 3:00, the real
//             WASHOUT limits; pier18 / lockwell / cinder × TEAMS / FFA × TURF / WASHOUT, seeds 1,2,3,4,5 (60 matches);
//             each cell = the median over every runner of that kit of painted / t and washes / t, t = max(liveS, 30) / 60
//   TIER    : slot 0 SWELL (mist-rasp) vs every other runner at the tier, 12 combos × seeds 1,2,3; TIER[t] =
//             clamp(median UNCAPPED base of slot 0 vs SWELL / vs t, 0.6, 1.6); TIER.swell = 1
//   wall    : 636 s (3 worker processes)
//   sim hashes at generation (MatchWorld.hash() at the horn of each seed-1 SWELL match — a balance change moves these;
//   a cell moving > 15 % means: regenerate):
//     pier18/teams/turf/seed1 6448dd3b-b3068a65
//     pier18/teams/washout/seed1 dab49956-2b579dda
//     pier18/ffa/turf/seed1 410d0a5a-ef7442f8
//     pier18/ffa/washout/seed1 6233c542-3a878aa8
//     lockwell/teams/turf/seed1 c40cea84-e2eb7f5c
//     lockwell/teams/washout/seed1 4055ab7c-4f89a280
//     lockwell/ffa/turf/seed1 48d70cfc-0afeefed
//     lockwell/ffa/washout/seed1 25269e19-9574829b
//     cinder/teams/turf/seed1 8a66fa36-0c8ca30f
//     cinder/teams/washout/seed1 30cba41a-e92b581a
//     cinder/ffa/turf/seed1 585f410e-2cdb8d5c
//     cinder/ffa/washout/seed1 2658666c-00670495

export interface BaselineCell { paint: number; wash: number }

export const BASELINE_META = {
  generated: true,
  command: 'node _harness/probe_stats.ts --baselines --write',
  seeds: [1, 2, 3, 4, 5] as number[],
  date: '2026-10-02T04:00:55.720Z',
  probeHashes: [
    'pier18/teams/turf/seed1 6448dd3b-b3068a65',
    'pier18/teams/washout/seed1 dab49956-2b579dda',
    'pier18/ffa/turf/seed1 410d0a5a-ef7442f8',
    'pier18/ffa/washout/seed1 6233c542-3a878aa8',
    'lockwell/teams/turf/seed1 c40cea84-e2eb7f5c',
    'lockwell/teams/washout/seed1 4055ab7c-4f89a280',
    'lockwell/ffa/turf/seed1 48d70cfc-0afeefed',
    'lockwell/ffa/washout/seed1 25269e19-9574829b',
    'cinder/teams/turf/seed1 8a66fa36-0c8ca30f',
    'cinder/teams/washout/seed1 30cba41a-e92b581a',
    'cinder/ffa/turf/seed1 585f410e-2cdb8d5c',
    'cinder/ffa/washout/seed1 2658666c-00670495',
  ] as string[],
};

/** per-minute medians: BASELINE[map][mode][rule][kit] = { paint: weighted m² / min, wash: credited washes / min } */
export const BASELINE: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, BaselineCell>>>>>>>> = {
  pier18: {
    teams: {
      turf: { 'mist-rasp': { paint: 346.9, wash: 1.667 }, 'sheet-drum': { paint: 233.1, wash: 1.333 }, 'needle-glint': { paint: 354.8, wash: 4.5 }, 'pop-well': { paint: 166.5, wash: 2 } },
      washout: { 'mist-rasp': { paint: 255.4, wash: 4.335 }, 'sheet-drum': { paint: 155.4, wash: 2.389 }, 'needle-glint': { paint: 298.8, wash: 5.659 }, 'pop-well': { paint: 115.2, wash: 3.71 } },
    },
    ffa: {
      turf: { 'mist-rasp': { paint: 513.5, wash: 1.833 }, 'sheet-drum': { paint: 464.1, wash: 0.333 }, 'needle-glint': { paint: 472.7, wash: 3.667 }, 'pop-well': { paint: 282.5, wash: 0 } },
      washout: { 'mist-rasp': { paint: 373.6, wash: 3.966 }, 'sheet-drum': { paint: 291.4, wash: 1.787 }, 'needle-glint': { paint: 414.6, wash: 7.333 }, 'pop-well': { paint: 204.2, wash: 3.753 } },
    },
  },
  lockwell: {
    teams: {
      turf: { 'mist-rasp': { paint: 293, wash: 2 }, 'sheet-drum': { paint: 202.4, wash: 1.667 }, 'needle-glint': { paint: 282.8, wash: 4.167 }, 'pop-well': { paint: 138.4, wash: 1.667 } },
      washout: { 'mist-rasp': { paint: 206.3, wash: 4.504 }, 'sheet-drum': { paint: 161.9, wash: 4.094 }, 'needle-glint': { paint: 222.4, wash: 5.505 }, 'pop-well': { paint: 116.9, wash: 5.258 } },
    },
    ffa: {
      turf: { 'mist-rasp': { paint: 423.5, wash: 2.167 }, 'sheet-drum': { paint: 376.4, wash: 0.833 }, 'needle-glint': { paint: 362.3, wash: 2.833 }, 'pop-well': { paint: 225.2, wash: 0.333 } },
      washout: { 'mist-rasp': { paint: 326.8, wash: 4.167 }, 'sheet-drum': { paint: 210.5, wash: 2.14 }, 'needle-glint': { paint: 270.3, wash: 5.036 }, 'pop-well': { paint: 131.9, wash: 2.833 } },
    },
  },
  cinder: {
    teams: {
      turf: { 'mist-rasp': { paint: 313.4, wash: 2 }, 'sheet-drum': { paint: 247.8, wash: 1 }, 'needle-glint': { paint: 292.2, wash: 3 }, 'pop-well': { paint: 161.3, wash: 1 } },
      washout: { 'mist-rasp': { paint: 217.7, wash: 3.825 }, 'sheet-drum': { paint: 139.6, wash: 2.131 }, 'needle-glint': { paint: 216.2, wash: 4.936 }, 'pop-well': { paint: 96.7, wash: 2.967 } },
    },
    ffa: {
      turf: { 'mist-rasp': { paint: 413.7, wash: 2 }, 'sheet-drum': { paint: 423.3, wash: 0.333 }, 'needle-glint': { paint: 310.8, wash: 1.833 }, 'pop-well': { paint: 236.8, wash: 0.333 } },
      washout: { 'mist-rasp': { paint: 330.9, wash: 3.556 }, 'sheet-drum': { paint: 290.9, wash: 1.452 }, 'needle-glint': { paint: 317, wash: 4.289 }, 'pop-well': { paint: 162.7, wash: 3.2 } },
    },
  },
};

/** bot-tier score factor (SWELL = 1) */
export const TIER: Readonly<Record<'breeze' | 'swell' | 'storm', number>> = { breeze: 0.825, swell: 1, storm: 1.113 };
