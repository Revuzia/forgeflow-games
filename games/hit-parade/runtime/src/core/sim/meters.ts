// HIT PARADE — per-frame meter upkeep (CONTRACT §4.3 items 6-7): grey HP regeneration, NERVE
// regen / cooldowns / STAGE FRIGHT recovery, training HP refill. Gains and costs happen at the
// event sites (hits.ts, throws.ts, fighter.ts) through the helpers in state.ts.

import { F, FL, ST } from './layout.ts';
import { fb, gainNerve } from './state.ts';
import type { Match } from './state.ts';

/** One non-frozen frame of meter upkeep for fighter `i` (FIGHT phase only). */
export function metersTick(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const sys = m.sys.raw;
  // grey (recoverable) HP
  if (s[b + F.grey] > 0) {
    s[b + F.greyDelay]++;
    if (s[b + F.greyDelay] > sys.grey.delay) {
      const r = Math.min(sys.grey.regenPerFrame, s[b + F.grey]);
      s[b + F.hp] += r;
      s[b + F.grey] -= r;
    }
  }
  // training refill
  if (m.training && s[b + F.neutralF] >= sys.training.refillDelay) {
    const other = fb(1 - i);
    if (s[b + F.hp] < m.cf[i].hpMax && s[other + F.cCount] === 0) {
      s[b + F.hp] = m.cf[i].hpMax;
      s[b + F.grey] = 0;
    }
  }
  // NERVE
  const st = s[b + F.st];
  if (st === ST.PARRY || st === ST.RUSH) return;
  if (s[b + F.nerveCd] > 0) {
    s[b + F.nerveCd]--;
    return;
  }
  if (s[b + F.nerveBlk] > 0) {
    s[b + F.nerveBlk]--;
    return;
  }
  let rate: number;
  if (s[b + F.fright] !== 0) rate = sys.stageFright.regen;
  else {
    const slow = st === ST.HITSTUN || st === ST.JUGGLE || st === ST.KNOCKDOWN || (s[b + F.flags] & FL.AIRBORNE) !== 0;
    rate = slow ? sys.nerve.regenStunAir : sys.nerve.regen;
    if (st === ST.WALK_F) rate += sys.nerve.walkFwdBonus;
  }
  gainNerve(m, i, rate);
}
