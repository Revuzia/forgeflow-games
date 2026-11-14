// BLOCKTOOTH VS — the bot's UPROAR policy (vs_design.md §10 difficulty table). Lane B-VS. Deterministic, reads state only.
//   ROOKIE   fires when the meter is full
//   REGULAR  fires in fights (a rival in the blast, or a crowd) or when hurt
//   VETERAN  fires to FINISH a rival (a hurt rival inside the blast), to escape a KO (low HP with company), or into a big crowd
// Never into a tender rig that is still walking in (introT > 0: it takes nothing from an UPROAR then).

import type { TitanState, World } from '../../core/types.ts';
import { hypot } from '../../core/detmath.ts';
import { VS } from '../../core/config.ts';
import { ultRadius } from '../../meta/ultimate.ts';
import type { BotLevel } from '../types.ts';
import { VSX } from '../tune.ts';

export function botUltimateVs(w: World, level: BotLevel, rival: TitanState | null): boolean {
  const u = w.ult;
  if (!u || !u.ready || u.phase !== 'idle') return false;
  const T = w.titan;
  if (!T.alive || w.run.result) return false;
  const b = w.boss;
  if (b && b.alive && b.introT > 0) return false;
  if (level === 'rookie') return true;
  const hp = T.maxHp > 0 ? T.hp / T.maxHp : 1;
  const R = ultRadius(w);
  let crowd = 0;
  for (let i = 0; i < w.enemies.length; i++) {
    const e = w.enemies[i];
    if (!e.alive || (e.tslot !== undefined && e.tslot !== w.cur)) continue;
    if (hypot(e.x - T.x, e.z - T.z) <= R) crowd++;
  }
  // every rival inside the blast (not just the one being chased)
  let rivalIn = 0, finish = false;
  for (let i = 0; i < w.players.length; i++) {
    if (i === w.cur) continue;
    const P = w.players[i];
    if (P.vs.eliminated || !P.titan.alive || P.vs.spawnProtT > 0) continue;
    const d = hypot(P.titan.x - T.x, P.titan.z - T.z) - P.titan.radius;
    if (d > R) continue;
    rivalIn++;
    const rh = P.titan.maxHp > 0 ? P.titan.hp / P.titan.maxHp : 1;
    if (rh <= VSX.botFinishFrac + 0.1) finish = true;
  }
  void rival;
  if (level === 'regular') return rivalIn > 0 || crowd >= 6 || (hp < 0.4 && crowd >= 3);
  // veteran
  if (finish) return true;
  if (hp < VS.bots.veteran.fleeHp + 0.1 && (rivalIn > 0 || crowd >= 3)) return true;
  return crowd >= 8 || (rivalIn >= 2);
}
