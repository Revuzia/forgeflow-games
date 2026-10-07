// VALE session — post-match grants (CONTRACT §8). Server-authoritative in a live deployment; the
// local GrantService computes the same thing from the MatchResult and writes the ledger.
//
// CURRENCY (paid in the catalog's first `earnedOnly` currency, economy.ts earnedCurrency):
//   match   = min(grants.cap, (won ? grants.win : grants.loss) + grants.perMinute × whole minutes)
//   Fray    + grants.placement[placement − 1] (outside the cap; the queue lists it when it wants it)
//   first win of the day: the first WIN whose UTC day differs from profile.firstWinAt's pays
//           FIRST_WIN_MULT × grants.win extra currency and grants.xpWin extra XP (catalog has no
//           first-win record yet, so the queue's own win grant is the documented default).
// XP:  won ? grants.xpWin : grants.xpLoss (+ the first-win XP).
// Nothing is granted for practice/custom queues, for bot seats (bots never earn), or for a seat
// that LEFT the match (forfeit: it still counts as a loss for rating and history).
// Every currency delta is one LedgerEntry: reason 'match_grant' (match + placement) or 'first_win'.
//
// ACCOUNT LEVEL CURVE: reaching level L + 1 from L takes xpToNext(L) = ACCOUNT_XP_BASE +
// ACCOUNT_XP_STEP × (L − 1) XP (100, 125, 150, …); no level cap. profile.xp is the XP into the
// current level.

import type { CatalogT, QueueDefT } from '../contracts/catalog.ts';
import type { GrantSummary, Profile } from '../contracts/session.ts';
import type { MatchResult, PlayerId } from '../contracts/sim.ts';
import { utcDay } from './clock.ts';
import { addLedger, earnedCurrency, type LedgerCtx } from './economy.ts';

export const ACCOUNT_XP_BASE = 100;
export const ACCOUNT_XP_STEP = 25;
export const FIRST_WIN_MULT = 1;

export function xpToNext(level: number): number { return ACCOUNT_XP_BASE + ACCOUNT_XP_STEP * (Math.max(1, level) - 1); }

/** level/xp after gaining `gained` XP */
export function addAccountXp(level: number, xp: number, gained: number): { level: number; xp: number } {
  let l = Math.max(1, level), x = Math.max(0, xp) + Math.max(0, gained);
  while (x >= xpToNext(l)) { x -= xpToNext(l); l++; }
  return { level: l, xp: x };
}

/** queue kinds that never grant */
export function grantsDisabled(queue: QueueDefT): boolean { return queue.kind === 'practice' || queue.kind === 'custom'; }

export interface GrantInput {
  catalog: CatalogT;
  queue: QueueDefT;
  result: MatchResult;
  you: PlayerId;
  /** the seat left before the end (forfeit) */
  forfeit?: boolean;
  /** wall-clock epoch ms of the grant */
  wall: number;
}

/**
 * Compute the grants for the human seat and APPLY them to the profile (ledger, wallet, xp, level,
 * firstWinAt). Returns the GrantSummary shown on the post-game screen.
 */
export function applyGrants(p: Profile, ctx: LedgerCtx, inp: GrantInput): GrantSummary {
  const levelBefore = p.level;
  const summary: GrantSummary = { currency: {}, xp: 0, levelBefore, levelAfter: levelBefore, firstWin: false, lines: [] };
  const me = inp.result.players.find((x) => x.player === inp.you);
  const g = inp.queue.grants;
  if (!me || me.controller !== 'human') return summary;          // bots never earn
  if (grantsDisabled(inp.queue)) { summary.lines.push({ label: 'no_rewards', amount: 0 }); return summary; }
  if (inp.forfeit) { summary.lines.push({ label: 'left_match', amount: 0 }); return summary; }
  const cur = earnedCurrency(inp.catalog);
  const won = me.won;
  const minutes = Math.max(0, Math.floor(inp.result.duration / 60));
  const base = won ? g.win : g.loss;
  const perMin = Math.round(g.perMinute * minutes);
  const match = Math.max(0, Math.min(g.cap, base + perMin));
  let currency = 0;
  if (cur) {
    summary.lines.push({ label: won ? 'victory' : 'defeat', currency: cur, amount: base });
    if (perMin) summary.lines.push({ label: 'minutes_played', currency: cur, amount: perMin });
    if (match < base + perMin) summary.lines.push({ label: 'cap', currency: cur, amount: match - (base + perMin) });
    const place = g.placement && me.placement >= 1 ? g.placement[me.placement - 1] ?? 0 : 0;
    if (place) summary.lines.push({ label: 'placement', currency: cur, amount: place });
    currency = match + place;
    if (currency > 0) addLedger(p, ctx, cur, currency, 'match_grant', inp.result.matchId);
  }
  let xp = won ? g.xpWin : g.xpLoss;
  summary.lines.push({ label: 'account_xp', amount: xp });
  // first win of the day (UTC)
  const today = utcDay(inp.wall);
  if (won && (!p.firstWinAt || utcDay(Date.parse(p.firstWinAt)) !== today) && (g.win > 0 || g.xpWin > 0)) {
    summary.firstWin = true;
    p.firstWinAt = new Date(inp.wall).toISOString();
    const bonus = Math.round(FIRST_WIN_MULT * g.win);
    if (cur && bonus > 0) {
      addLedger(p, ctx, cur, bonus, 'first_win', inp.result.matchId);
      currency += bonus;
      summary.lines.push({ label: 'first_win', currency: cur, amount: bonus });
    }
    if (g.xpWin > 0) { xp += g.xpWin; summary.lines.push({ label: 'first_win_xp', amount: g.xpWin }); }
  }
  if (cur) summary.currency[cur] = currency;
  const lv = addAccountXp(p.level, p.xp, xp);
  p.level = lv.level; p.xp = lv.xp;
  summary.xp = xp;
  summary.levelAfter = p.level;
  return summary;
}
