// BLOCKTOOTH VS — the bot seats' per-tick driver. Lane B-VS.
// vsBeginTick (src/vs/step.ts) calls stepBots once per tick, unbound, in slot order: every seat whose PlayerState.bot is
// set gets its command from the brain, written into PlayerState.input (whatever the caller passed for a bot seat was
// latched and is overwritten here). A human seat is never touched. The COUNTDOWN freeze (stepSeats) already zeroed every
// input, so bots stand still until OPEN HOUSE starts.

import type { World } from '../../core/types.ts';
import { withPlayer } from '../../core/players.ts';
import { botThink } from './brain.ts';

export function stepBots(w: World): void {
  const vs = w.vs;
  if (!vs || vs.phase === 'countdown' || vs.phase === 'over') return;
  for (let i = 0; i < w.players.length; i++) {
    const P = w.players[i];
    if (P.bot === null || P.vs.eliminated) continue;
    P.input = withPlayer(w, i, () => botThink(w));
  }
}

export { botThink, hash01, VS_BOT_TUNE } from './brain.ts';
