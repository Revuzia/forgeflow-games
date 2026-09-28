// DYEFIELD — match roster (CONTRACT §10.2). THREE-free, DOM-free, deterministic.
//
// id 0 = the human on SUNCREW; ids 1-3 = SUNCREW bots; ids 4-7 = GULF CREW bots. Bot names are drawn
// deterministically (mulberry32 of the seed) from an ORIGINAL pool of coastal words. The pool never
// contains names from the source clip or any Nintendo property.
//
// CHANGED(CORE) (CONTRACT_FFA §F1/§F6): FREE-FOR-ALL — ffaRoster(): id 0 = the human on its chosen crew (default 1 =
// amber), ids 1..7 = bots on the other seven crews in ascending crew id; the same seeded names and kits as teams mode.

import type { MatchMode, TeamId } from '../types.ts';
import { FFA_CREWS_MAX, TEAM_GULF, TEAM_SUN } from '../types.ts';
import { hash32, mulberry32 } from '../rng.ts';

/** Bot skill tiers, by their ORIGINAL names (CONTRACT §10.2 CHANGED(BOTFIX)): BREEZE (easy) · SWELL (normal) · STORM (hard). */
export type BotSkill = 'breeze' | 'swell' | 'storm';
export const BOT_SKILL_IDS: readonly BotSkill[] = ['breeze', 'swell', 'storm'];
export const DEFAULT_BOT_SKILL: BotSkill = 'swell';
/** Old ids kept as silent aliases for old links / scripts (`?bots=chill|fresh|fierce`). */
const SKILL_ALIASES: Readonly<Record<string, BotSkill>> = { chill: 'breeze', fresh: 'swell', fierce: 'storm' };

/** A skill id from a query param / CLI flag / saved setting (case-insensitive; old ids map to the new tiers);
 *  anything else → `fallback`. */
export function parseBotSkill(raw: string | null | undefined, fallback: BotSkill = DEFAULT_BOT_SKILL): BotSkill {
  const k = (raw ?? '').trim().toLowerCase();
  if ((BOT_SKILL_IDS as readonly string[]).includes(k)) return k as BotSkill;
  return SKILL_ALIASES[k] ?? fallback;
}

export interface RosterEntry { id: number; name: string; team: TeamId; kit: string; bot: boolean; skill: BotSkill }

/** Original name pool: coastal / harbor words. Short, readable on a name tag, distinct first letters where possible. */
export const NAME_POOL: readonly string[] = [
  'Brine', 'Pip', 'Marlo', 'Tully', 'Sable', 'Wren', 'Dune', 'Quill', 'Skerry', 'Fathom',
  'Lark', 'Moss', 'Bex', 'Rook', 'Tamsin', 'Gully', 'Nettle', 'Ossie', 'Cove', 'Halyard',
];

export const TEAM_SIZE = 4;
export const DEFAULT_KIT = 'mist-rasp';

export interface RosterOptions {
  humanKit: string; humanName?: string; seed: number; skill: BotSkill; botKits?: string[];
  /** CHANGED(CORE): 'ffa' → ffaRoster (default 'teams') */
  mode?: MatchMode;
  /** CHANGED(CORE): FFA only — the human's crew 1..8 (default 1 = amber) */
  humanCrew?: TeamId;
}

export function defaultRoster(o: RosterOptions): RosterEntry[] {
  if (o.mode === 'ffa') return ffaRoster(o);
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

/** the seeded bot-name draw shared by both modes: the ORIGINAL pool minus the human's name, Fisher–Yates on mulberry32 */
function namePool(human: string, seed: number): string[] {
  const pool = NAME_POOL.filter((n) => n.toLowerCase() !== human.toLowerCase());
  const rnd = mulberry32(hash32(seed | 0, 0x6e616d65));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  return pool;
}

/** CHANGED(CORE): a valid FFA crew id (1..8) or 1 */
export function ffaCrew(raw: number | string | null | undefined): TeamId {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  return (Number.isInteger(n) && n >= 1 && n <= FFA_CREWS_MAX ? n : 1) as TeamId;
}

/** CHANGED(CORE) (CONTRACT_FFA §F1): 8 runners, each its own crew. id 0 = the human on `humanCrew` (default 1 = amber);
 *  ids 1..7 = bots on the remaining crews in ascending crew id (deterministic); names and kits exactly as teams mode. */
export function ffaRoster(o: RosterOptions): RosterEntry[] {
  const human = (o.humanName ?? '').trim() || 'YOU';
  const pool = namePool(human, o.seed);
  const kits = o.botKits && o.botKits.length ? o.botKits : [DEFAULT_KIT];
  const mine = ffaCrew(o.humanCrew ?? 1);
  const others: TeamId[] = [];
  for (let c = 1; c <= FFA_CREWS_MAX; c++) if (c !== mine) others.push(c as TeamId);
  const out: RosterEntry[] = [{ id: 0, name: human, team: mine, kit: o.humanKit || DEFAULT_KIT, bot: false, skill: o.skill }];
  for (let id = 1; id < FFA_CREWS_MAX; id++) {
    out.push({ id, name: pool[(id - 1) % pool.length], team: others[id - 1], kit: kits[(id - 1) % kits.length], bot: true, skill: o.skill });
  }
  return out;
}
