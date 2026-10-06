// BLOCKTOOTH ONLINE VS — the 8 VS achievements (ONLINE_PLAN D3, owner-approved 2026-10-01; lane O-REPORT). THREE-free data + pure
// evaluators + the app-side event tally. Nothing here runs inside the sim: it reads a FINISHED VS world (the standings the sim
// already keeps per seat) plus a small tally of the sim events the app routes anyway.
//
// Why a second list and not goals.ts: GOALS is the 46-goal solo ledger that gates unlocks (every unlock item is referenced by exactly
// one goal, probe_meta asserts the count) and lives inside Profile.done. The VS goals unlock nothing, so they get their own tiny
// ledger (`VsLife`, localStorage `blocktooth.vslife.v1` + the cloud save's `vs` key) and are posted to the portal exactly like a
// solo goal: `forgeflow:achievement {achievementSlug: <id>}` (slug = id, name/description = name/desc, tier below).
//
// Counting rules (decided where the plan was silent; flip VS_LIFETIME_MIN_HUMANS to change the grind goals):
//   * SYNDICATED / CERTIFIED HEADLINE / CROSSOVER EPISODE / HOSTILE TAKEOVER / ZONED RESIDENTIAL count in EVERY finished VS match
//     (offline VS PRACTICE included): they are single-match feats.
//   * NETWORK EXCLUSIVE needs a lobby of 4 humans (the player won against 3 other humans).
//   * ENSEMBLE CAST + RATINGS WAR are grind goals: a win counts toward them only when >= 2 humans started the match
//     (D9: nobody farms bots). Their descriptions say so.
//   * a human who left the match (their seat is a bot now) earns nothing from it.
//
// Tiers (platform.md 9 / vs_design.md 13; the two goals platform.md did not tier get silver / gold): bronze 2 / silver 2 / gold 3 /
// diamond 1 = 190 XP. game 52 then holds 46 + 8 = 54 rows (the seed RPC stops accepting at 60).

import type { SimEvent, TitanId } from '../core/types.ts';
import { TITAN_IDS } from '../core/types.ts';

export type VsTier = 'bronze' | 'silver' | 'gold' | 'diamond';

export interface VsGoalDef {
  id: string;
  name: string;
  desc: string;
  tier: VsTier;
}

/** A win counts toward the grind goals (ENSEMBLE CAST, RATINGS WAR) only when at least this many humans started the match. */
export const VS_LIFETIME_MIN_HUMANS = 2;
/** RATINGS WAR target */
export const VS_RATINGS_WAR_WINS = 10;

export const VS_GOALS: readonly VsGoalDef[] = [
  { id: 'g_vs_syndicated', name: 'SYNDICATED', desc: 'Finish a VS match', tier: 'bronze' },
  { id: 'g_vs_certified_headline', name: 'CERTIFIED HEADLINE', desc: 'Win a VS match', tier: 'silver' },
  { id: 'g_vs_crossover_episode', name: 'CROSSOVER EPISODE', desc: 'Knock out a rival titan', tier: 'bronze' },
  { id: 'g_vs_hostile_takeover', name: 'HOSTILE TAKEOVER', desc: 'Knock out the FRONT PAGE titan (the leader)', tier: 'silver' },
  { id: 'g_vs_zoned_residential', name: 'ZONED RESIDENTIAL', desc: 'Win a VS match without being knocked out', tier: 'gold' },
  { id: 'g_vs_network_exclusive', name: 'NETWORK EXCLUSIVE', desc: 'Win a VS match against 3 other players', tier: 'gold' },
  { id: 'g_vs_ensemble_cast', name: 'ENSEMBLE CAST', desc: 'Win a VS match with each of the four titans (with another player in the match)', tier: 'diamond' },
  { id: 'g_vs_ratings_war', name: 'RATINGS WAR', desc: 'Win 10 VS matches with other players in the match', tier: 'gold' },
];

export const VS_GOAL_BY_ID: Readonly<Record<string, VsGoalDef>> = Object.fromEntries(VS_GOALS.map((g) => [g.id, g]));

export const VS_TIER_POINTS: Readonly<Record<VsTier, number>> = { bronze: 5, silver: 15, gold: 30, diamond: 60 };

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// ─────────────────────────────── the VS ledger (lifetime counters + earned goals) ───────────────────────────────

export interface VsLife {
  v: 1;
  /** matches finished (any VS match, practice included) */
  matches: number;
  /** wins that count toward the grind goals (>= VS_LIFETIME_MIN_HUMANS humans at the start) */
  wins: number;
  /** the same wins by the titan played */
  winsBy: Record<TitanId, number>;
  /** earned VS goal id -> epoch ms (the earliest stamp wins on a merge) */
  done: Record<string, number>;
}

export function emptyVsLife(): VsLife {
  const winsBy = {} as Record<TitanId, number>;
  for (const t of TITAN_IDS) winsBy[t] = 0;
  return { v: 1, matches: 0, wins: 0, winsBy, done: {} };
}

function cnt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(1_000_000, Math.floor(v)) : 0;
}

/** untrusted JSON (localStorage / the cloud blob) -> a well-formed VsLife */
export function sanitizeVsLife(raw: unknown): VsLife {
  const out = emptyVsLife();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  out.matches = cnt(r.matches);
  out.wins = cnt(r.wins);
  const wb = r.winsBy && typeof r.winsBy === 'object' ? (r.winsBy as Record<string, unknown>) : {};
  for (const t of TITAN_IDS) out.winsBy[t] = hasOwn(wb, t) ? cnt(wb[t]) : 0;
  const d = r.done && typeof r.done === 'object' && !Array.isArray(r.done) ? (r.done as Record<string, unknown>) : {};
  for (const id of Object.keys(d)) {
    const t = d[id];
    if (hasOwn(VS_GOAL_BY_ID, id) && typeof t === 'number' && Number.isFinite(t) && t > 0) out.done[id] = t;
  }
  return out;
}

/** union of two ledgers: counters = max, goals = union (earliest stamp). Used for local + cloud. */
export function mergeVsLife(a: VsLife, b: VsLife): VsLife {
  const A = sanitizeVsLife(a), B = sanitizeVsLife(b);
  const out = emptyVsLife();
  out.matches = Math.max(A.matches, B.matches);
  out.wins = Math.max(A.wins, B.wins);
  for (const t of TITAN_IDS) out.winsBy[t] = Math.max(A.winsBy[t], B.winsBy[t]);
  for (const id of Object.keys(A.done)) out.done[id] = A.done[id];
  for (const id of Object.keys(B.done)) out.done[id] = hasOwn(out.done, id) ? Math.min(out.done[id], B.done[id]) : B.done[id];
  return out;
}

/** a stable comparison key (are two ledgers the same?) */
export function vsLifeKey(l: VsLife): string {
  const s = sanitizeVsLife(l);
  return JSON.stringify([s.matches, s.wins, TITAN_IDS.map((t) => s.winsBy[t]), Object.keys(s.done).sort().map((k) => [k, s.done[k]])]);
}

const VS_LIFE_KEY = 'blocktooth.vslife.v1';

export function loadVsLife(): VsLife {
  try {
    const raw = localStorage.getItem(VS_LIFE_KEY);
    return raw ? sanitizeVsLife(JSON.parse(raw)) : emptyVsLife();
  } catch { return emptyVsLife(); }
}

export function saveVsLife(l: VsLife): void {
  try { localStorage.setItem(VS_LIFE_KEY, JSON.stringify(sanitizeVsLife(l))); } catch { /* storage blocked: a nicety */ }
}

// ─────────────────────────────── one finished match -> goals ───────────────────────────────

/** what one finished VS match says about the LOCAL human (all from the sim's per-seat standings + the app's event tally) */
export interface VsMatchFacts {
  titan: TitanId;
  /** the match was decided with this seat in it (a leaver never gets here) */
  finished: boolean;
  won: boolean;
  /** human seats at the START of the match (1 = practice or a lone human among bots) */
  humans: number;
  /** times this seat was knocked out (evicted; PlayerVs.koCount) */
  koCount: number;
  /** knock-outs this seat scored (PlayerVs.evictions; evictions + eliminations) */
  evictions: number;
  /** knock-outs this seat scored on the FRONT PAGE crown holder (VsEventTally) */
  crownKos: number;
}

/**
 * Apply one finished match to a ledger. Pure: returns the new ledger and the goal ids this match newly earned (never one already
 * in `life.done`). `nowMs` stamps the new goals.
 */
export function applyVsMatch(life: VsLife, f: VsMatchFacts, nowMs: number): { life: VsLife; newly: string[] } {
  const L = sanitizeVsLife(life);
  if (!f.finished) return { life: L, newly: [] };
  L.matches += 1;
  const grind = f.won && f.humans >= VS_LIFETIME_MIN_HUMANS;
  if (grind) { L.wins += 1; L.winsBy[f.titan] += 1; }
  const met: string[] = [];
  met.push('g_vs_syndicated');
  if (f.won) met.push('g_vs_certified_headline');
  if (f.evictions >= 1) met.push('g_vs_crossover_episode');
  if (f.crownKos >= 1) met.push('g_vs_hostile_takeover');
  if (f.won && f.koCount === 0) met.push('g_vs_zoned_residential');
  if (f.won && f.humans >= 4) met.push('g_vs_network_exclusive');
  if (TITAN_IDS.every((t) => L.winsBy[t] >= 1)) met.push('g_vs_ensemble_cast');
  if (L.wins >= VS_RATINGS_WAR_WINS) met.push('g_vs_ratings_war');
  const newly: string[] = [];
  for (const id of met) {
    if (hasOwn(L.done, id)) continue;
    L.done[id] = nowMs;
    newly.push(id);
  }
  return { life: L, newly };
}

// ─────────────────────────────── the app-side event tally ───────────────────────────────

/**
 * Feed EVERY SimEvent of a VS match, in order (the app already routes them to the KO feed). Tracks what the final standings do not
 * keep: whether a knock-out landed on the FRONT PAGE crown holder. The `crown` event always precedes the KO it affects (the sim
 * reads `vs.crown` when it processes the KO), so a running holder is exact.
 */
export class VsEventTally {
  /** the local seat (set at construction; the online layer learns its seat when the match starts, so it may be re-pointed) */
  local: number;
  crown = -1;
  crownKos = 0;
  /** distinct rival seats this seat knocked out */
  readonly rivalsKo = new Set<number>();
  kos = 0;
  deaths = 0;
  constructor(local: number) { this.local = local; }
  feed(e: SimEvent): void {
    switch (e.type) {
      case 'crown': this.crown = e.holder; break;
      case 'evicted': case 'eliminated': {
        if (e.victim === this.local) { this.deaths++; break; }
        if (e.killer === this.local) {
          this.kos++;
          this.rivalsKo.add(e.victim);
          if (e.victim === this.crown) this.crownKos++;
        }
        break;
      }
      default: break;
    }
  }
}
