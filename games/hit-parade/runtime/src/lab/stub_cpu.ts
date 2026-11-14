// HIT PARADE - DEV-ONLY stand-in for core/ai/cpu.ts (lane AI) while that module does not exist yet. Used ONLY when the
// dev server / build runs with HP_LAB_STUBS=1 (vite.config.ts labStubs(); `_harness/bootcheck.py --stubs`) and the real
// file is missing. It honours the CONTRACT §16 signature and produces the neutral word (the CPU stands still, like a
// level-0 training dummy), so the shell + sim + view + menus can be exercised end to end before AI lands.

import type { Match } from '../core/sim/match.ts';

export interface Cpu { input(m: Match, playerIndex: number): number }

export function createCpu(level: number, fighterId: string, seed: number): Cpu {
  void level; void fighterId; void seed;
  return { input: () => 0 };
}
