// BLOCKTOOTH v2 — gate-bot UPROAR policy (FEATURES_V2 §3.5; lane L1).
//
// Called once per tick from bot.ts botInput; true = press UPROAR this tick. Deterministic, reads state only.
// Policy = FIRE ON READY (the policy probe_ult's cadence acceptance is written against, §3.2), with one
// exception a real player makes too: never waste it on a boss that is still walking in (introT > 0: the
// boss takes nothing from an UPROAR during its entrance, §3.4).

import type { World } from '../src/core/types.ts';

export function botUltimate(w: World): boolean {
  const u = w.ult;
  if (!u || !u.ready || u.phase !== 'idle') return false;
  if (!w.titan.alive || w.run.result) return false;
  const b = w.boss;
  if (b && b.alive && b.introT > 0) return false;
  return true;
}
