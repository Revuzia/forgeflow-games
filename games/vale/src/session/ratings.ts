// VALE session — ranked ratings (CONTRACT §8): Glicko-2 per Glickman, "Example of the Glicko-2
// system" (glicko.net/glicko/glicko2.pdf), steps 1–8, with system constant τ = 0.5 and new players
// at r 1500, RD 350, σ 0.06. The volatility update uses the paper's Illinois iteration (ε 1e-6).
//
// RATING PERIOD = ONE MATCH. Glickman recommends 10–15 games per period; a per-match period makes
// RD shrink faster and volatility noisier than the paper intends, which we accept for an immediate,
// readable ladder (research r08 §3.4 discusses the trade-off).
//
// TEAM GAMES: each player is rated against ONE composite opponent built from the other team: its
// rating is the mean of the opponents' ratings and its RD the root-mean-square of their RDs
// (a mean of independent estimates keeps their typical uncertainty). Score 1 win, 0 loss, ½ draw.
// FFA (Fray): the composite is every other seat and the score is (N − placement) / (N − 1), so 1st
// = 1, last = 0. Teammates never enter the update.
//
// BOTS are the only opponents locally. A bot seat is rated at its difficulty band's centre (novice
// 1200, adept 1500, veteran 1800) with RD BOT_RD; a 'by_rating' bot — ranked matchmaking — is
// rated at the player's own rating (the matchmaker matched you with your level), still RD BOT_RD.
//
// LADDER: provisional until `ranked.placementGames` games are played (no tier is shown); then the
// tier is the catalog rank with the highest minRating ≤ rating. DIFFICULTY BANDS for
// `bots.difficulty: 'by_rating'`: rating < 1350 → novice, < 1650 → adept, else veteran.

import type { RankTierT } from '../contracts/catalog.ts';
import type { RatingRecord } from '../contracts/session.ts';

export const GLICKO = { tau: 0.5, rating: 1500, rd: 350, vol: 0.06, scale: 173.7178, epsilon: 1e-6 } as const;
export const MIN_RD = 30;
export const BOT_RD = 80;
export type Difficulty = 'novice' | 'adept' | 'veteran';
export const DIFFICULTY_RATING: Readonly<Record<Difficulty, number>> = { novice: 1200, adept: 1500, veteran: 1800 };
export const DIFFICULTY_BANDS = { adeptFrom: 1350, veteranFrom: 1650 } as const;

export interface Glicko { rating: number; rd: number; vol: number }
export interface Opponent { rating: number; rd: number }
export interface GameResult extends Opponent { score: number }

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number): number => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** one Glicko-2 rating period (steps 1–8). No games: only RD grows (step 6). */
export function glicko2(player: Glicko, games: readonly GameResult[], tau: number = GLICKO.tau): Glicko {
  const S = GLICKO.scale;
  const mu = (player.rating - GLICKO.rating) / S;
  const phi = player.rd / S;
  const sigma = player.vol;
  if (games.length === 0) {
    return { rating: player.rating, rd: Math.min(GLICKO.rd, Math.sqrt(phi * phi + sigma * sigma) * S), vol: sigma };
  }
  // step 3: estimated variance v; step 4: improvement Δ
  let vInv = 0, dSum = 0;
  for (const o of games) {
    const muJ = (o.rating - GLICKO.rating) / S, phiJ = o.rd / S;
    const gj = g(phiJ), E = expected(mu, muJ, phiJ);
    vInv += gj * gj * E * (1 - E);
    dSum += gj * (o.score - E);
  }
  const v = 1 / vInv;
  const delta = v * dSum;
  // step 5: new volatility (Illinois algorithm)
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const d2 = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d2 * d2) - (x - a) / (tau * tau);
  };
  let A = a, B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A), fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > GLICKO.epsilon; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);
  // steps 6–8
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * dSum;
  return { rating: muNew * S + GLICKO.rating, rd: phiNew * S, vol: sigmaNew };
}

/** one composite opponent: mean rating, root-mean-square RD */
export function compositeOpponent(opps: readonly Opponent[]): Opponent {
  if (opps.length === 0) return { rating: GLICKO.rating, rd: GLICKO.rd };
  let r = 0, rd2 = 0;
  for (const o of opps) { r += o.rating; rd2 += o.rd * o.rd; }
  return { rating: r / opps.length, rd: Math.sqrt(rd2 / opps.length) };
}

export function newRatingRecord(ratingId: string, nowIso: string): RatingRecord {
  return { ratingId, rating: GLICKO.rating, rd: GLICKO.rd, vol: GLICKO.vol, games: 0, wins: 0, peak: GLICKO.rating, provisional: true, updatedAt: nowIso };
}

/** the record after one match (score 1/½/0 or an FFA fraction) against a composite opponent */
export function rateMatch(rec: RatingRecord, opponent: Opponent, score: number, placementGames: number, nowIso: string): RatingRecord {
  const s = Math.min(1, Math.max(0, score));
  const next = glicko2({ rating: rec.rating, rd: rec.rd, vol: rec.vol }, [{ ...opponent, score: s }]);
  const games = rec.games + 1;
  const rating = Math.round(next.rating * 100) / 100;
  return {
    ratingId: rec.ratingId, rating, rd: Math.max(MIN_RD, Math.round(next.rd * 100) / 100), vol: next.vol,
    games, wins: rec.wins + (s >= 1 ? 1 : 0),
    peak: games >= placementGames ? Math.max(rec.provisional ? rating : rec.peak, rating) : rec.peak,
    provisional: games < placementGames, updatedAt: nowIso,
  };
}

/** the catalog tier for a rating (highest minRating ≤ rating); null when the catalog has none */
export function tierFor(ranks: readonly RankTierT[], rating: number): RankTierT | null {
  let best: RankTierT | null = null;
  for (const t of ranks) if (t.minRating <= rating && (!best || t.minRating > best.minRating)) best = t;
  if (!best && ranks.length) best = [...ranks].sort((a, b) => a.minRating - b.minRating)[0];
  return best;
}

/** the tier id shown for a record (undefined while provisional) */
export function shownTier(ranks: readonly RankTierT[], rec: RatingRecord | undefined): string | undefined {
  if (!rec || rec.provisional) return undefined;
  return tierFor(ranks, rec.rating)?.id;
}

/** 'by_rating' bot difficulty */
export function difficultyForRating(rating: number): Difficulty {
  return rating < DIFFICULTY_BANDS.adeptFrom ? 'novice' : rating < DIFFICULTY_BANDS.veteranFrom ? 'adept' : 'veteran';
}

/** the rating a bot seat counts as (see header) */
export function botOpponent(difficulty: Difficulty, byRating: boolean, playerRating: number): Opponent {
  return { rating: byRating ? playerRating : DIFFICULTY_RATING[difficulty], rd: BOT_RD };
}
