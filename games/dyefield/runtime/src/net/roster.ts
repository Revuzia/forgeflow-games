// DYEFIELD — ONLINE roster (CONTRACT_ONLINE §O4.5 step 2, §O7.1). THREE-free, DOM-free.
//
// Runner ids equal roster indexes. TEAMS: humans split so the human counts differ by ≤ 1 (each human's crew preference
// honoured while balance allows, lowest slots first), SUNCREW ids 0..3, GULF CREW ids 4..7, bots fill each side to 4.
// FFA: one runner per crew; each human keeps its FFA colour first-come by slot (a taken colour → the lowest free one);
// humans take ids 0.., bots the remaining crews in ascending crew order. Bot names come from the same original pool and
// seeded draw as defaultRoster (minus every human name), bot kits from the mixed lineup. EVERY entry is built bot: true
// (the BotDirector then has a brain for every runner, ready for a takeover); the host marks the human-driven ones with
// BotDirector.setHuman.

import { hash32, mulberry32 } from '../core/rng.ts';
import { FFA_CREWS_MAX, TEAM_GULF, TEAM_SUN, type TeamId } from '../core/types.ts';
import { NAME_POOL, TEAM_SIZE, type BotSkill, type RosterEntry } from '../core/match/roster.ts';
import { WEAPONS } from '../core/data.ts';
import { sanitizeName, type WireMember, type WireSeat } from './proto.ts';

/** the mixed bot lineup of view/players.ts mixedBotKits (copied: the net core is THREE-free) */
export function mixedKits(humanKit: string): string[] {
  const all = WEAPONS.kits.map((k) => k.id);
  const mates = all.filter((k) => k !== humanKit);
  while (mates.length < 3) mates.push(all[mates.length % all.length] ?? humanKit);
  const rivals = [...all];
  while (rivals.length < 4) rivals.push(all[rivals.length % all.length] ?? humanKit);
  return [...mates.slice(0, 3), ...rivals.slice(0, 4)];
}

export interface OnlineRoster { roster: RosterEntry[]; seats: WireSeat[] }

const validKit = (k: string): string => (WEAPONS.kits.some((x) => x.id === k) ? k : 'mist-rasp');

function botNames(humans: readonly string[], seed: number): string[] {
  const lower = new Set(humans.map((h) => h.toLowerCase()));
  const pool = NAME_POOL.filter((n) => !lower.has(n.toLowerCase()));
  const rnd = mulberry32(hash32(seed | 0, 0x6e616d65));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  return pool;
}

/** the roster + seats for `members` (connected humans, any order) */
export function buildOnlineRoster(members: readonly WireMember[], mode: 'teams' | 'ffa', seed: number, skill: BotSkill): OnlineRoster {
  const hs = [...members].sort((a, b) => a.slot - b.slot).slice(0, 8);
  const names = hs.map((m) => sanitizeName(m.name, hash32(seed, m.slot)));
  const pool = botNames(names, seed);
  const kits = mixedKits(validKit(hs[0]?.kit ?? 'mist-rasp'));
  let botIx = 0;
  const nextBot = (): { name: string; kit: string } => {
    const k = botIx++;
    return { name: pool[k % pool.length], kit: kits[k % kits.length] };
  };
  const roster: RosterEntry[] = [];
  const seats: WireSeat[] = [];
  if (mode === 'ffa') {
    const taken = new Set<number>();
    const crewOf: number[] = [];
    for (const m of hs) {
      let c = Number.isInteger(m.color) && m.color >= 1 && m.color <= FFA_CREWS_MAX ? m.color : 1;
      if (taken.has(c)) { c = 1; while (taken.has(c) && c <= FFA_CREWS_MAX) c++; }
      taken.add(c);
      crewOf.push(c);
    }
    hs.forEach((m, i) => {
      roster.push({ id: i, name: names[i], team: crewOf[i] as TeamId, kit: validKit(m.kit), bot: true, skill });
      seats.push({ slot: m.slot, runner: i });
    });
    for (let c = 1; c <= FFA_CREWS_MAX && roster.length < FFA_CREWS_MAX; c++) {
      if (taken.has(c)) continue;
      const b = nextBot();
      roster.push({ id: roster.length, name: b.name, team: c as TeamId, kit: b.kit, bot: true, skill });
    }
    return { roster, seats };
  }
  // TEAMS: preference while balance allows, then the side with fewer humans (tie → SUNCREW)
  const n = hs.length;
  const cap = Math.ceil(n / 2);
  const side: number[] = new Array(n).fill(0);
  const cnt = [0, 0, 0];
  const deferred: number[] = [];
  hs.forEach((m, i) => {
    const pref = m.crew === 1 || m.crew === 2 ? m.crew : 0;
    if (pref && cnt[pref] < cap) { side[i] = pref; cnt[pref]++; } else deferred.push(i);
  });
  for (const i of deferred) { const s = cnt[1] <= cnt[2] ? 1 : 2; side[i] = s; cnt[s]++; }
  for (const team of [TEAM_SUN, TEAM_GULF]) {
    const mine = hs.map((m, i) => ({ m, i })).filter((x) => side[x.i] === team);
    for (const { m, i } of mine) {
      seats.push({ slot: m.slot, runner: roster.length });
      roster.push({ id: roster.length, name: names[i], team, kit: validKit(m.kit), bot: true, skill });
    }
    while (roster.length < (team === TEAM_SUN ? TEAM_SIZE : TEAM_SIZE * 2)) {
      const b = nextBot();
      roster.push({ id: roster.length, name: b.name, team, kit: b.kit, bot: true, skill });
    }
  }
  return { roster, seats };
}

/** CONTRACT_ONLINE §O7.1: the bot runner a late joiner takes — TEAMS on the side with fewer humans (tie → SUNCREW), FFA
 *  the first bot; −1 when every runner is human-held */
export function lateJoinRunner(roster: readonly RosterEntry[], humanRunners: ReadonlySet<number>, mode: 'teams' | 'ffa'): number {
  if (mode === 'ffa') { for (const e of roster) if (!humanRunners.has(e.id)) return e.id; return -1; }
  const cnt = [0, 0, 0];
  for (const id of humanRunners) { const t = roster[id]?.team; if (t === 1 || t === 2) cnt[t]++; }
  const order = cnt[1] <= cnt[2] ? [TEAM_SUN, TEAM_GULF] : [TEAM_GULF, TEAM_SUN];
  for (const t of order) for (const e of roster) if (e.team === t && !humanRunners.has(e.id)) return e.id;
  return -1;
}
