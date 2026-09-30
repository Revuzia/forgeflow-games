// HIT PARADE — core constants shared by sim, AI, net and the app loop (CONTRACT §2, §4).
// THREE-free, DOM-free. Gameplay numbers live in data/system.json, not here.

import { STATE_INTS, STATE_INTS_BRAWL, STATE_VERSION } from './sim/layout.ts';

/** Sim rate: exactly 60 steps per second (CONTRACT §2 "Frame = 1/60 s"). */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/** State sizes (ints) and identity (NET HELLO). */
export { STATE_INTS, STATE_INTS_BRAWL, STATE_VERSION };

/** Sim budgets (CONTRACT §4.1), checked by _harness/probe_perf.ts. */
export const BUDGET = { stepMs: 0.25, saveChecksumUs: 10, stateIntsCap: 1024 } as const;

/** Input word bits (CONTRACT §4.4). */
export const INPUT = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  L: 1 << 4,
  M: 1 << 5,
  H: 1 << 6,
  S: 1 << 7,
  ASSIST: 1 << 8,
  THROW: 1 << 9,
  PARRY: 1 << 10,
  IMPACT: 1 << 11,
  TAUNT: 1 << 12,
} as const;
