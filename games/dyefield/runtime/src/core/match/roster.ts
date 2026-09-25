// DYEFIELD — match roster (CONTRACT §10.2). THREE-free, DOM-free, deterministic.
//
// id 0 = the human on SUNCREW; ids 1-3 = SUNCREW bots; ids 4-7 = GULF CREW bots. Bot names are drawn
// deterministically (mulberry32 of the seed) from an ORIGINAL pool of coastal words. The pool never
// contains names from the source clip or any Nintendo property.

import type { TeamId } from '../types.ts';
import { TEAM_GULF, TEAM_SUN } from '../types.ts';
import { hash32, mulberry32 } from '../rng.ts';

export type BotSkill = 'chill' | 'fresh' | 'fierce';

export interface RosterEntry { id: number; name: string; team: TeamId; kit: string; bot: boolean; skill: BotSkill }

/** Original name pool: coastal / harbor words. Short, readable on a name tag, distinct first letters where possible. */
export const NAME_POOL: readonly string[] = [
  'Brine', 'Pip', 'Marlo', 'Tully', 'Sable', 'Wren', 'Dune', 'Quill', 'Skerry', 'Fathom',
  'Lark', 'Moss', 'Bex', 'Rook', 'Tamsin', 'Gully', 'Nettle', 'Ossie', 'Cove', 'Halyard',
];

export const TEAM_SIZE = 4;
export const DEFAULT_KIT = 'mist-rasp';

export function defaultRoster(o: { humanKit: string; humanName?: string; seed: number; skill: BotSkill; botKits?: string[] }): RosterEntry[] {
  const human = (o.humanName ?? '').trim() || 'YOU';
  // deterministic Fisher–Yates over the pool, minus the human's own name
  const pool = NAME_POOL.filter((n) => n.toLowerCase() !== human.toLowerCase());
  const rnd = mulberry32(hash32(o.seed | 0, 0x6e616d65));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const kits = o.botKits && o.botKits.length ? o.botKits : [DEFAULT_KIT];
  const out: RosterEntry[] = [];
  out.push({ id: 0, name: human, team: TEAM_SUN, kit: o.humanKit || DEFAULT_KIT, bot: false, skill: o.skill });
  for (let id = 1; id < TEAM_SIZE * 2; id++) {
    out.push({
      id,
      name: pool[(id - 1) % pool.length],
      team: id < TEAM_SIZE ? TEAM_SUN : TEAM_GULF,
      kit: kits[(id - 1) % kits.length],
      bot: true,
      skill: o.skill,
    });
  }
  return out;
}
