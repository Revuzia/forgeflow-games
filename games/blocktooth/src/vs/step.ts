// BLOCKTOOTH VS — the four hook points core/world.ts stepWorldN calls in VS mode (lane B-CORE wrote the stubs; lane B-VS
// OWNS this file and fills the bodies). Solo never calls any of them.
//
// Where each runs inside one tick (full order in _spec/online/CORE_CONTRACT.md §4):
//
//   stepWorldN:  input latch → snapshotPrev → tick++ → vsBeginTick → stepCity → rebuildEnemyGrid
//                → [per player: stepUltimate stepTitan stepDirector] → vsAfterTitans → vsStepWorld
//                → [world: stepEnemies stepBoss … stepPickups] → [per player: stepUpgrades]
//                → [per player: processTriggers] → … → [per player: chargeUltimate stepTally] → vsEndTick
//
// Binding state when each hook is called: all four run UNBOUND (w.cur = -1; use withPlayer / bindPlayer to act as a
// seat). They may read and write any PlayerState through w.players[i] directly.
// Determinism: iterate seats in slot order, use w.rng streams only, no Map/Set iteration order, no clocks.
//
// What each does (B-VS):
//   vsBeginTick   phase clock + banners · ring centre / schedule · seat timers (spawn protection, CLEARED, CC chain),
//                 EVICTED respawns, the COUNTDOWN freeze · tender schedule · the VS bot brain writing every bot seat's input
//   vsAfterTitans titan-titan bodies + STOMPED (B-TITAN) · PvP hits the damage system queued (B-WORLD) · ring mortar paint
//   vsStepWorld   the FRONT PAGE crown · PUBLIC TENDER settle
//   vsEndTick     KO -> EVICTED / eliminated · assists · placement · VS SCORE · the winner · the match end

import type { World } from '../core/types.ts';
import { resolveTitanBodies } from '../titans/bodies.ts';
import { drainQueuedPvp } from './pvp.ts';
import { initRing, stepMortar, stepRing } from './ring.ts';
import { stepCrown } from './comeback.ts';
import { pinCountdown, stepPhase, stepSeats } from './phase.ts';
import { processKos } from './ko.ts';
import { refreshScores } from './score.ts';
import { stepTenders } from './tender.ts';
import { stepBots } from './bot/index.ts';

/**
 * START of the tick, after the tick counter advanced and every seat's input is latched, BEFORE any system runs.
 */
export function vsBeginTick(w: World): void {
  const vs = w.vs;
  if (!vs || vs.phase === 'over') return;
  initRing(w);
  stepPhase(w);
  stepSeats(w);
  stepRing(w);
  stepTenders(w);
  stepBots(w);
}

/**
 * After every seat's ultimate / titan / director step, BEFORE the world-scoped systems.
 */
export function vsAfterTitans(w: World): void {
  const vs = w.vs;
  if (!vs || vs.phase === 'over') return;
  if (vs.phase === 'countdown') pinCountdown(w);
  resolveTitanBodies(w);
  drainQueuedPvp(w);
  stepMortar(w);
}

/**
 * Where the solo tick runs stepGates + stepEndless (neither runs in VS): the FRONT PAGE crown, the tender settle.
 */
export function vsStepWorld(w: World): void {
  const vs = w.vs;
  if (!vs || vs.phase === 'over') return;
  stepCrown(w);
}

/**
 * END of the tick, where the solo tick runs checkRunEnd: KO -> EVICTED / eliminated, the winner, the match end.
 */
export function vsEndTick(w: World): void {
  const vs = w.vs;
  if (!vs || vs.phase === 'over') return;
  processKos(w);
  if (w.tick % 30 === 0 && !w.run.result) refreshScores(w);
}
