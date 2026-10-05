// BLOCKTOOTH VS — the match clock and the phase machine's pure part (vs_design.md §3).
// THREE-free, deterministic, no World mutation here (the hook in step.ts drives transitions).
//
//   world.t      0 ........ 5 .............. 245 ........... 425 ........... 605 ......... 650
//   match clock  -5 ....... 0 ............. 240 ............ 420 ............ 600 ........ 645
//   phase        countdown | OPEN HOUSE    | HOSTILE TAKEOVER | FINAL NOTICE  | LAST CALL | (hard end)
//
// `VS.phase` in core/config.ts holds the boundaries on the MATCH clock (clock = world.t - World.vs.startT).

import { VS } from '../core/config.ts';
import type { World } from '../core/types.ts';
import type { VsPhase } from './types.ts';

/** Tabloid banner per phase (vs_design.md §3). 'over' has none (the end card owns the screen). */
export const VS_BANNERS: Readonly<Record<VsPhase, string>> = {
  countdown: 'ZONING DISPUTE — FOUR APPLICANTS, ONE CITY',
  open: 'OPEN HOUSE — EAT FIRST, ASK LATER',
  takeover: 'HOSTILE TAKEOVER — THE CLAWS ARE OUT',
  final: 'FINAL NOTICE — THE CITY IS CONDEMNED',
  last: 'LAST CALL',
  over: '',
};

/** Match clock (s) for a world time: negative during the COUNTDOWN. */
export function clockAt(t: number, startT: number): number { return t - startT; }

/** The phase a match clock reads (never 'over': a decided match is recorded in VsWorld.phase, not derived). */
export function phaseForClock(clock: number): Exclude<VsPhase, 'over'> {
  const P = VS.phase;
  if (clock < 0) return 'countdown';
  if (clock < P.openEndS) return 'open';
  if (clock < P.takeoverEndS) return 'takeover';
  if (clock < P.finalEndS) return 'final';
  return 'last';
}

/** Match clock of a VS world (seconds since OPEN HOUSE began; negative in the COUNTDOWN). 0 for a solo world. */
export function matchClock(w: World): number {
  return w.vs ? w.t - w.vs.startT : 0;
}

/** Does rival damage apply in this phase (HOSTILE TAKEOVER onward; OPEN HOUSE rival hits only shove)? */
export function pvpOnIn(phase: VsPhase): boolean {
  return phase === 'takeover' || phase === 'final' || phase === 'last';
}

/** phaseMul of the PvP formula (vs_design.md §6.1): 0 in OPEN HOUSE (knockback only), 1 after 4:00. FINAL NOTICE reads VS.pvp.finalMul
 *  (its START value) without a clock, and ramps linearly to VS.pvp.finalMulEnd across the phase when a match `clock` is given. */
export function phaseMul(phase: VsPhase, clock?: number): number {
  if (phase === 'final') {
    if (clock === undefined) return VS.pvp.finalMul;
    const P = VS.phase;
    const u = Math.min(1, Math.max(0, (clock - P.takeoverEndS) / Math.max(1e-6, P.finalEndS - P.takeoverEndS)));
    return VS.pvp.finalMul + (VS.pvp.finalMulEnd - VS.pvp.finalMul) * u;
  }
  return pvpOnIn(phase) ? 1 : VS.pvp.openHouseMul;
}

/** Does a KO eliminate (no respawn)? FINAL NOTICE and LAST CALL. */
export function koEliminatesIn(phase: VsPhase): boolean {
  return phase === 'final' || phase === 'last';
}

/** Seconds remaining until the next phase boundary (0 once 'last' has run out its hard end). Clock-based. */
export function secondsToNextPhase(clock: number): number {
  const P = VS.phase;
  if (clock < 0) return -clock;
  if (clock < P.openEndS) return P.openEndS - clock;
  if (clock < P.takeoverEndS) return P.takeoverEndS - clock;
  if (clock < P.finalEndS) return P.finalEndS - clock;
  return Math.max(0, P.hardEndS - clock);
}

/** Is the match still being played (a VS world whose phase is not 'over' and has no result)? */
export function vsLive(w: World): boolean {
  return w.mode === 'vs' && w.vs !== null && w.vs.phase !== 'over' && !w.run.result;
}
