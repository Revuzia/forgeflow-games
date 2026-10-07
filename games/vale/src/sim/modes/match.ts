// VALE sim — match lifecycle shared by every mode (CONTRACT §5.5): pre-game countdown, the end of
// the match (MatchResult, 'end' event, digest), the gold graph, surrender votes, sudden death.
//
// Pre-game: the World starts at time −pregame (phase 'pregame'). Until time 0 seats may buy,
// sell, undo, swap items, level abilities and ping; move/attack/stop/cast/recall/surrender are
// dropped. At time ≥ 0 the phase turns 'live' (announce 'match_start') and the gold graph takes
// its first sample.
//
// End: a ModeRules check returns an Outcome; endMatch builds the MatchResult (players in seat
// order; gold = goldEarned; won = on the winning team, or placement 1 in FFA; a draw has no
// winner and every seat placed 1), records PlayerView.placement, sets phase 'ended', emits
// 'end'. After that the facade stops stepping: the final state stays on view.
// Digest: FNV-1a over the core state digest (every entity's position/hp/statuses/buffs rounded to
// 1e-4, K/D/A, rng streams) + every seat's level, xp, items, charges, gold, goldEarned, cs, stats,
// lives, score, placement + the outcome. Skins never enter it.
// Gold graph: one sample at 0:00 and one per live minute, plus one at the end. Team modes:
// Σ goldEarned of team 0 − team 1. FFA: the leader's goldEarned − the runner-up's.
//
// Surrender (rules.surrender, 'core' mode): a seat starts a vote with { yes: true } once
// time ≥ earliest; the vote stays open SURRENDER_VOTE_TIME s. Only human seats vote when the team
// has any (bots can neither block nor force a human team's surrender); an all-bot team votes
// with every seat. Needed = votesNeeded when > 1 (capped at the voters), else
// ceil(votesNeeded × voters). Passing ends the match (reason 'surrender'); failing or expiring
// blocks new votes for SURRENDER_COOLDOWN s. Announce keys: 'surrender_vote' (params yes, no,
// needed), 'surrender_failed', 'surrender_passed'.
// Sudden death (rules.suddenDeathAt): WorldView.suddenDeath, 'suddenDeath' event + announce
// 'sudden_death'; from then on respawn timers ×1.5 (units/fighters.ts) and no structure is
// protected (units/structures.ts).

import { TICK_DT, type Command, type MatchResult, type PlayerId, type PlayerResult, type TeamId } from '../../contracts/sim.ts';
import type { Player } from '../entity.ts';
import { stateDigest } from '../core.ts';
import { hashString } from '../rng.ts';
import { updateProtection } from '../units/structures.ts';
import type { World } from '../world.ts';

export const DEFAULT_PREGAME = 5;
export const SURRENDER_VOTE_TIME = 30;
export const SURRENDER_COOLDOWN = 60;

export interface Outcome {
  reason: MatchResult['reason'];
  /** −1: none (FFA, draw) */
  winningTeam: TeamId | -1;
  /** placement of every seat (1 = best) */
  placement: (p: Player) => number;
  draw?: boolean;
}

interface Vote { active: boolean; yes: Set<PlayerId>; no: Set<PlayerId>; endsAt: number; cooldownUntil: number }
export interface MatchState {
  ended: boolean;
  goldGraph: number[];
  nextSample: number;
  votes: Vote[];
  suddenDeathDone: boolean;
  /** practice resetMatch: the facade rebuilds the world after this tick */
  resetRequested: boolean;
  ffa: boolean;
}
const KEY = 'match';
export function matchOf(w: World): MatchState { return w.ext[KEY] as MatchState; }

export function initMatch(w: World, pregame: number, ffa: boolean): MatchState {
  const m: MatchState = {
    ended: false, goldGraph: [], nextSample: 0, suddenDeathDone: false, resetRequested: false, ffa,
    votes: w.teams.map(() => ({ active: false, yes: new Set(), no: new Set(), endsAt: 0, cooldownUntil: -Infinity })),
  };
  w.ext[KEY] = m;
  // a NaN here would make every clock comparison false for the whole match
  w.timeOffset = -(Number.isFinite(pregame) ? Math.max(0, pregame) : DEFAULT_PREGAME);
  w.time = w.tick * TICK_DT + w.timeOffset;
  w.phase = w.time < 0 ? 'pregame' : 'live';
  return m;
}

// ── pre-game gate ('commands' phase, before core commands) ──────────────────────────────────────
const PREGAME_BLOCKED: ReadonlySet<Command['type']> = new Set(['move', 'attack', 'stop', 'cast', 'recall', 'surrenderVote']);

/** drop commands the phase does not allow; flips 'pregame' → 'live' at time 0 */
export function phaseGateSystem(w: World): void {
  if (w.phase === 'pregame' && w.time >= -1e-9) {
    w.phase = 'live';
    w.emit({ e: 'announce', t: w.time, key: 'match_start' });
  }
  if (w.phase === 'live') return;
  const q = w.takeCommands();
  if (w.phase === 'ended') return;
  for (const { player, cmd } of q) if (!PREGAME_BLOCKED.has(cmd.type)) w.command(player, cmd);
}

// ── gold graph ──────────────────────────────────────────────────────────────────────────────────
export function goldLead(w: World, ffa: boolean): number {
  if (ffa) {
    const g = w.players.filter((p) => !!p).map((p) => p.goldEarned).sort((a, b) => b - a);
    return Math.round((g[0] ?? 0) - (g[1] ?? 0));
  }
  let a = 0, b = 0;
  for (const p of w.players) { if (!p) continue; if (p.team === 0) a += p.goldEarned; else if (p.team === 1) b += p.goldEarned; }
  return Math.round(a - b);
}
export function goldGraphSystem(w: World): void {
  const m = matchOf(w);
  if (w.phase !== 'live') return;
  while (w.time + 1e-9 >= m.nextSample) { m.goldGraph.push(goldLead(w, m.ffa)); m.nextSample += 60; }
}

// ── team views ──────────────────────────────────────────────────────────────────────────────────
export function teamViewSystem(w: World): void {
  for (const t of w.teams) t.gold = 0;
  for (const p of w.players) if (p && p.team >= 0 && p.team < w.teams.length) w.teams[p.team].gold += p.goldEarned;
}

// ── sudden death ────────────────────────────────────────────────────────────────────────────────
export function suddenDeathSystem(w: World): void {
  const m = matchOf(w);
  const at = w.rules.suddenDeathAt;
  if (m.suddenDeathDone || at === undefined || w.phase !== 'live' || w.time + 1e-9 < at) return;
  m.suddenDeathDone = true;
  w.suddenDeath = true;
  w.emit({ e: 'suddenDeath', t: w.time });
  w.emit({ e: 'announce', t: w.time, key: 'sudden_death' });
  updateProtection(w);
}

// ── surrender ───────────────────────────────────────────────────────────────────────────────────
function voters(w: World, team: TeamId): Player[] {
  const all = w.players.filter((p) => p && p.team === team);
  const humans = all.filter((p) => p.controller === 'human');
  return humans.length > 0 ? humans : all;
}
export function votesNeeded(w: World, team: TeamId): number {
  const s = w.rules.surrender;
  const n = voters(w, team).length;
  if (!s || n === 0) return Infinity;
  return s.votesNeeded > 1 ? Math.min(n, Math.round(s.votesNeeded)) : Math.max(1, Math.ceil(s.votesNeeded * n - 1e-9));
}

export function surrenderCommand(w: World, p: Player, yes: boolean): void {
  const s = w.rules.surrender;
  if (!s || w.rules.end.kind !== 'core' || w.phase !== 'live' || w.time + 1e-9 < s.earliest) return;
  if (!voters(w, p.team).includes(p)) return;
  const v = matchOf(w).votes[p.team];
  if (!v) return;
  if (!v.active) {
    if (!yes || w.time < v.cooldownUntil) return;
    v.active = true; v.yes.clear(); v.no.clear(); v.endsAt = w.time + SURRENDER_VOTE_TIME;
  }
  if (v.yes.has(p.player) || v.no.has(p.player)) return;
  (yes ? v.yes : v.no).add(p.player);
  w.emit({ e: 'announce', t: w.time, key: 'surrender_vote', team: p.team, player: p.player,
    params: { yes: v.yes.size, no: v.no.size, needed: votesNeeded(w, p.team) } });
}

/** 'modes' phase: resolve open votes; returns the surrendering team or −1 */
export function surrenderSystem(w: World): TeamId | -1 {
  const m = matchOf(w);
  for (let team = 0; team < m.votes.length; team++) {
    const v = m.votes[team];
    if (!v.active) continue;
    const need = votesNeeded(w, team);
    const n = voters(w, team).length;
    if (v.yes.size >= need) {
      v.active = false;
      w.emit({ e: 'announce', t: w.time, key: 'surrender_passed', team });
      return team;
    }
    if (v.no.size > n - need || w.time + 1e-9 >= v.endsAt) {
      v.active = false;
      v.cooldownUntil = w.time + SURRENDER_COOLDOWN;
      w.emit({ e: 'announce', t: w.time, key: 'surrender_failed', team });
    }
  }
  return -1;
}

// ── ranking helpers for mode rules ──────────────────────────────────────────────────────────────
/** placements of items sorted by `keys` (descending, earlier keys first); equal keys share a place */
export function rankBy<T>(items: readonly T[], keys: ((x: T) => number)[], tie: (x: T) => number): Map<T, number> {
  const sorted = items.slice().sort((a, b) => {
    for (const k of keys) { const d = k(b) - k(a); if (d !== 0) return d; }
    return tie(a) - tie(b);
  });
  const out = new Map<T, number>();
  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const same = i > 0 && keys.every((k) => k(prev) === k(sorted[i]));
    out.set(sorted[i], same ? out.get(prev)! : i + 1);
  }
  return out;
}

export function teamDamage(w: World, team: TeamId): number {
  let d = 0;
  for (const p of w.players) if (p && p.team === team) d += p.damageToFighters;
  return d;
}

/** a team-mode outcome from a team ranking (ties at the top ⇒ draw) */
export function teamOutcome(w: World, reason: MatchResult['reason'], placeOf: Map<number, number>): Outcome {
  const firsts = [...placeOf.entries()].filter(([, v]) => v === 1).map(([t]) => t);
  const draw = firsts.length !== 1;
  return {
    reason, winningTeam: draw ? -1 : firsts[0], draw,
    placement: (p) => draw ? 1 : placeOf.get(p.team) ?? w.teams.length,
  };
}

// ── the end ─────────────────────────────────────────────────────────────────────────────────────
export function endMatch(w: World, o: Outcome): MatchResult | null {
  const m = matchOf(w);
  if (m.ended) return null;
  m.ended = true;
  m.goldGraph.push(goldLead(w, m.ffa));
  const s = w.setup;
  const players: PlayerResult[] = [];
  for (const seat of [...s.seats].sort((a, b) => a.player - b.player)) {
    const p = w.players[seat.player];
    const placement = o.placement(p);
    p.placement = placement;
    const won = o.draw ? false : o.winningTeam >= 0 ? p.team === o.winningTeam : placement === 1;
    const r: PlayerResult = {
      player: p.player, team: p.team, name: p.name, fighter: p.fighter, skin: p.skin, controller: p.controller,
      kills: p.kills, deaths: p.deaths, assists: p.assists, cs: p.cs, gold: Math.round(p.goldEarned), level: p.ent ? p.ent.level : 1,
      damageToFighters: p.damageToFighters, damageTaken: p.damageTaken, healing: p.healing, structureDamage: p.structureDamage,
      items: p.items.slice(), placement, won,
    };
    if (p.role !== undefined) r.role = p.role;
    if (p.score !== undefined) r.score = p.score;
    players.push(r);
  }
  const result: MatchResult = {
    matchId: s.matchId, queue: s.queue, mode: s.mode, map: s.map, seed: s.seed, catalogVersion: s.catalogVersion,
    duration: Math.max(0, w.time), winningTeam: o.winningTeam, reason: o.reason, players, goldGraph: m.goldGraph.slice(), digest: '',
  };
  result.digest = matchDigest(w, result);
  w.result = result;
  w.phase = 'ended';
  w.emit({ e: 'end', t: w.time, result });
  return result;
}

function q(v: number): string { return Number.isFinite(v) ? (Math.round(v * 1e4) / 1e4).toString() : String(v); }
/** deterministic digest of the world (+ result when ended); skins never enter it */
export function matchDigest(w: World, result: MatchResult | null = w.result): string {
  let h = hashString(stateDigest(w));
  const add = (s: string): void => { h = hashString(s, h); };
  for (const p of w.players) {
    if (!p) continue;
    const e = p.ent;
    add(`${p.player}|${e ? e.level : 0}|${q(p.xp)}|${p.items.join(',')}|${p.itemCharges.join(',')}|${q(p.gold)}|${q(p.goldEarned)}|` +
      `${p.cs}|${q(p.damageTaken)}|${q(p.healing)}|${q(p.structureDamage)}|${p.lives ?? ''}|${p.score ?? ''}|${p.placement ?? ''}|${p.streak}`);
  }
  for (const t of w.teams) add(`${t.team}|${t.kills}|${t.structuresDestroyed}|${t.objectives.join(',')}`);
  if (result) add(`${result.winningTeam}|${result.reason}|${q(result.duration)}|${result.goldGraph.join(',')}`);
  return h.toString(16).padStart(8, '0');
}
