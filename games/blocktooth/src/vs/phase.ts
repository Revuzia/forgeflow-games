// BLOCKTOOTH VS — the phase machine + per-seat timers (vs_design.md §3, §6.3). Lane B-VS.
// THREE-free, deterministic. Called from vsBeginTick (src/vs/step.ts), unbound, in slot order.

import { VS } from '../core/config.ts';
import type { TitanInput, World } from '../core/types.ts';
import { emitAs } from '../core/players.ts';
import { matchClock, phaseForClock } from './clock.ts';
import { rootTitan } from '../titans/titanfx.ts';
import { respawnSeat } from './ko.ts';
import { tickCcState } from './pvp.ts';

/** Phase transitions on the match clock: one `vsPhase` event per change (and one for the initial COUNTDOWN). */
export function stepPhase(w: World): void {
  const vs = w.vs as NonNullable<World['vs']>;
  if (vs.phase === 'over') return;
  if (vs.data.phaseInit !== 1) { vs.data.phaseInit = 1; emitAs(w, -1, { type: 'vsPhase', phase: vs.phase }); }
  const want = phaseForClock(matchClock(w));
  if (want !== vs.phase) {
    vs.phase = want;
    vs.phaseT = w.t;
    emitAs(w, -1, { type: 'vsPhase', phase: want });
  }
}

/** A fresh neutral command. */
export function idleInput(): TitanInput { return { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false }; }

/** COUNTDOWN: pin every seat to where it stood when the tick began (called from vsAfterTitans, after the titan steps). */
export function pinCountdown(w: World): void {
  for (let i = 0; i < w.players.length; i++) {
    const T = w.players[i].titan;
    T.x = T.px; T.z = T.pz; T.heading = T.pheading;
    T.vx = 0; T.vz = 0; T.speed = 0; T.moving = false;
    T.kit.sim_vx = 0; T.kit.sim_vz = 0;
  }
}

/**
 * Per-seat upkeep, slot order: CC chain / CLEARED / spawn-protection timers, the EVICTED respawn, the COUNTDOWN freeze
 * (neutral input + immunity), Size-reached bookkeeping (peak rank + the time each Size was reached).
 */
export function stepSeats(w: World): void {
  const vs = w.vs as NonNullable<World['vs']>;
  const countdown = vs.phase === 'countdown';
  const dt = w.dt;
  for (let i = 0; i < w.players.length; i++) {
    const P = w.players[i];
    const V = P.vs;
    if (V.eliminated) continue;
    tickCcState(w, i);
    if (V.spawnProtT > 0) { V.spawnProtT -= dt; if (V.spawnProtT <= 1e-9) V.spawnProtT = 0; }
    if (!P.titan.alive && V.respawnT >= 0 && w.t >= V.respawnT - 1e-9) respawnSeat(w, i);
    const T = P.titan;
    if (countdown && T.alive) {
      // COUNTDOWN freeze WITHOUT touching the caller's input object (the lockstep "keep the previous input" rule is about that
      // object): no walking / no new dash (rootTitan), hook and auto held on cooldown; vsAfterTitans pins position + heading
      rootTitan(w, i, 2 * dt);
      if (T.abilityCd < 2 * dt) T.abilityCd = 2 * dt;
      if (T.autoCd < 2 * dt) T.autoCd = 2 * dt;
    }
    if (T.alive && (countdown || V.spawnProtT > 0) && P.ult.invulnT < 2 * dt) P.ult.invulnT = 2 * dt;   // hurtTitan refuses while > 0
    if (T.rank > V.peakRank) V.peakRank = T.rank;
    for (let r = 1; r <= T.rank && r <= V.rankT.length; r++) if (V.rankT[r - 1] < 0) V.rankT[r - 1] = w.t;
  }
}

/** Seconds the world has been in the current phase. */
export function phaseElapsed(w: World): number { return w.vs ? w.t - w.vs.phaseT : 0; }

/** The 5-second COUNTDOWN length (re-exported so the UI reads one place). */
export const COUNTDOWN_S = VS.countdownS;
