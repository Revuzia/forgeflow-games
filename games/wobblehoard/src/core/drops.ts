// WOBBLEHOARD drops: what comes out of a capsule, the Daily Restock (pick 1 of 3) and the small daily / weekly tasks (_spec/DESIGN.md 5.1, 5.2, 5.4).
//
// Pure and deterministic. Randomness is INJECTED as an `RngSource`: a function returning floats in [0, 1) (src/core/rng.ts mulberry32),
// or a uint32 / string seed that is turned into one. Same source => same result, on every machine.
//
// WHAT THE SERVER MUST ALSO RECOMPUTE: rollCapsule is how the server mints a capsule item. The client may run the same call with the same
// seed to PREVIEW or animate, but only the server's seed counts, and the server stores (species, genomeSeed) and re-derives the genome
// with speciesBaseGenome. restockOffer is deterministic from the day seed, so the server recomputes the three offered species and
// refuses a pick that is not one of them. Task completion is judged by the server from the touch log (the client's claim is only a hint).
//
// Draw order of rollCapsule (fixed, never reorder): 1) tier, 2) species inside the tier, 3) genome seed. Exactly three draws per capsule.
import type { Genome } from './genome.ts';
import { mulberry32, hashString } from './rng.ts';
import { TIER_ODDS, TIERS, TIER_COUNT, tierIndex } from './rarity.ts';
import type { TierId } from './rarity.ts';
import { CATALOG, SPECIES_BY_TIER, getSpecies, speciesBaseGenome } from '../data/catalog.ts';
import type { SpeciesDef, SpeciesId } from '../data/catalog.ts';

/* ───────────────────────────────────────────────── random sources ───────────────────────────────────────────────── */

/** A random source: a function giving floats in [0, 1), a uint32 seed (any number is coerced with >>> 0), or a string seed (FNV-1a hashed). */
export type RngSource = (() => number) | number | string;

/** Turn an RngSource into a function. A function is used as is (and keeps its state, so the caller can chain several rolls from one stream). */
export function makeRng(src: RngSource): () => number {
  if (typeof src === 'function') return src;
  if (typeof src === 'string') return mulberry32(hashString(src));
  return mulberry32((Number.isFinite(src) ? Math.floor(src) : 0) >>> 0);
}

/** Safe uniform float: a hostile or broken rng function can never produce NaN or a value outside [0, 1). */
export function draw(rng: () => number): number {
  const x = rng();
  return typeof x === 'number' && x >= 0 && x < 1 ? x : Number.isFinite(x) ? Math.min(0.9999999999, Math.max(0, x)) : 0;
}

/** Pick the index of the bucket `x` (in [0,1)) falls in, given weights (need not sum to 1). Walks left to right like the reference sim. */
export function pickWeighted(weights: ArrayLike<number>, total: number, x: number): number {
  let v = x * total;
  for (let i = 0; i < weights.length; i++) { v -= weights[i]; if (v < 0) return i; }
  return weights.length - 1;
}

/* ───────────────────────────────────────────────── capsules ───────────────────────────────────────────────── */

export interface CapsuleRoll {
  tier: TierId;
  tierIndex: number;
  species: SpeciesId;
  /** uint32 that becomes genome.seed and drives the cosmetic roll: speciesBaseGenome(species, genomeSeed). */
  genomeSeed: number;
}

/**
 * Roll one capsule: the tier by the PUBLIC odds (76.3 / 13 / 6 / 2.8 / 1.4 / 0.5 percent, src/core/rarity.ts), then a species uniformly inside the
 * tier (repeats allowed: there is no duplicate protection and no hidden pity, DESIGN 5.5), then a genome seed.
 */
export function rollCapsule(src: RngSource): CapsuleRoll {
  const rng = makeRng(src);
  let x = draw(rng);
  let t = 0;
  for (; t < TIER_COUNT - 1; t++) { x -= TIER_ODDS[t]; if (x < 0) break; }
  const list = SPECIES_BY_TIER[t];
  const species = list[Math.min(list.length - 1, Math.floor(draw(rng) * list.length))].id;
  const genomeSeed = Math.floor(draw(rng) * 4294967296) >>> 0;
  return { tier: TIERS[t], tierIndex: t, species, genomeSeed };
}

/** The genome of a rolled capsule (what the reveal shows and the Hoard stores). */
export const capsuleGenome = (r: Pick<CapsuleRoll, 'species' | 'genomeSeed'>): Genome => speciesBaseGenome(r.species, r.genomeSeed);

/* ───────────────────────────────────────────────── seeds per day ───────────────────────────────────────────────── */

/** A uint32 seed for one (player, day, purpose). `playerKey` is whatever stable string the server uses (an account id); `dayKey` is the day number. */
export const daySeed = (playerKey: string, dayKey: number, purpose: string): number => hashString(`${purpose}:${playerKey}:${Math.floor(dayKey)}`);

/* ───────────────────────────────────────────────── Daily Restock ───────────────────────────────────────────────── */

/** Restock offers this many species... */
export const RESTOCK_OFFER_COUNT = 3;
/** ...from Common and Uncommon only (tier index 0 and 1): a gift, not a gate. */
export const RESTOCK_MAX_TIER_INDEX = 1;

/** The 25 species a restock can offer (Common then Uncommon, in idx order). */
export const RESTOCK_POOL: readonly SpeciesDef[] = CATALOG.filter((d) => tierIndex(d.tier) <= RESTOCK_MAX_TIER_INDEX);

/**
 * Today's three offered species for a day seed: distinct, drawn without replacement from the pool by successive uniform picks
 * (3 draws: pick, pick, pick). Deterministic, so client and server agree; misses never accumulate or punish.
 */
export function restockOffer(src: RngSource): SpeciesId[] {
  const rng = makeRng(src);
  const pool = RESTOCK_POOL.slice();
  const out: SpeciesId[] = [];
  for (let k = 0; k < RESTOCK_OFFER_COUNT && pool.length; k++) out.push(pool.splice(Math.min(pool.length - 1, Math.floor(draw(rng) * pool.length)), 1)[0].id);
  return out;
}

/**
 * Presentation order of an offer: species the player does not own first (higher tier first among them), then the rest in offered order
 * ("new ones shown first"). Does not change WHICH three are offered.
 */
export function restockDisplayOrder(offer: readonly SpeciesId[], copies: (id: SpeciesId) => number): SpeciesId[] {
  const tierOf = (id: SpeciesId): number => { const d = getSpecies(id); return d ? tierIndex(d.tier) : 0; };
  const fresh = offer.filter((id) => copies(id) === 0).sort((a, b) => tierOf(b) - tierOf(a));
  return fresh.concat(offer.filter((id) => copies(id) !== 0));
}

/** True iff `pick` is one of the species offered for this day seed (what the server checks before granting a pick). */
export const isValidRestockPick = (src: RngSource, pick: unknown): boolean => typeof pick === 'string' && (restockOffer(src) as string[]).includes(pick);

/* ───────────────────────────────────────────────── daily and weekly tasks ───────────────────────────────────────────────── */

/** Two tasks are offered a day... */
export const TASKS_OFFERED_PER_DAY = 2;
/** ...each completed task pays one capsule, at most five tasks a week (DESIGN 5.4). Tasks are style-neutral: any hand can do any of them. */
export const TASKS_MAX_PER_WEEK = 5;

export interface TaskDef {
  id: string;
  /** Short plain English for the card. */
  text: string;
  /** What the server counts in the touch log, and how many (the shell shows a progress bar toward `target`). */
  metric: 'stretch' | 'softPops' | 'pokes' | 'squeezes' | 'medleys' | 'snaps';
  target: number;
  /** Optional qualifier of the metric, e.g. seconds held for 'squeezes'. */
  param?: number;
}

/** The pool tasks are drawn from. Kind-neutral wording, no timers, nothing to lose. */
export const TASK_DEFS: readonly TaskDef[] = [
  { id: 'stretch-double', text: 'Stretch one as far as it will go', metric: 'stretch', target: 1 }, // id kept: offers are seeded by id
  { id: 'soft-pops-5', text: 'Five soft pops in a row', metric: 'softPops', target: 5 },
  { id: 'gentle-pokes-20', text: 'Twenty gentle pokes', metric: 'pokes', target: 20 },
  { id: 'slow-squeezes-5', text: 'Five slow squeezes, a second each', metric: 'squeezes', target: 5, param: 1 },
  { id: 'medley-1', text: 'Poke, squeeze and pull within twelve seconds', metric: 'medleys', target: 1 },
  { id: 'snaps-3', text: 'Let three stretches snap back', metric: 'snaps', target: 3 },
  { id: 'pokes-sleepy-10', text: 'Ten pokes with a calm pause between', metric: 'pokes', target: 10, param: 1 },
  { id: 'squeeze-long-3', text: 'Three long squeezes, two seconds each', metric: 'squeezes', target: 3, param: 2 },
];

/** Today's two tasks for a day seed (distinct, deterministic: 2 draws). */
export function dailyTasks(src: RngSource): TaskDef[] {
  const rng = makeRng(src);
  const pool = TASK_DEFS.slice();
  const out: TaskDef[] = [];
  for (let k = 0; k < TASKS_OFFERED_PER_DAY && pool.length; k++) out.push(pool.splice(Math.min(pool.length - 1, Math.floor(draw(rng) * pool.length)), 1)[0]);
  return out;
}

/** Week number of a day key (day 0 = Thursday 1 Jan 1970; weeks start on Monday). */
export const weekKeyOf = (dayKey: number): number => Math.floor((Math.floor(dayKey) + 3) / 7);

/** Serializable task bookkeeping (JSON-safe). */
export interface TaskState {
  /** Week the counters belong to; the counters reset when it changes. */
  week: number | null;
  /** Tasks paid out this week. */
  claimedThisWeek: number;
  /** Day key and task ids already paid that day (a task id pays once a day). */
  day: number | null;
  claimedToday: string[];
}

export const createTaskState = (): TaskState => ({ week: null, claimedThisWeek: 0, day: null, claimedToday: [] });

export type TaskClaim = { ok: true; state: TaskState } | { ok: false; reason: 'not-offered' | 'already-claimed' | 'weekly-limit' | 'bad-day' };

/**
 * Pay out one task: the task must be one of today's two offered (derive `offered` with dailyTasks(daySeed)), not already paid today, and the
 * weekly limit (5) must not be reached. Returns the new state; the caller then rolls ONE capsule (rollCapsule with a fresh seed) with origin 'task'.
 * That capsule does not count against the 12-a-day play cap (DESIGN 5.4).
 */
export function claimTask(state: TaskState, offered: readonly TaskDef[], taskId: string, dayKey: number): TaskClaim {
  if (typeof dayKey !== 'number' || !Number.isFinite(dayKey)) return { ok: false, reason: 'bad-day' };
  const day = Math.floor(dayKey), week = weekKeyOf(day);
  const claimedThisWeek = state.week === week ? state.claimedThisWeek : 0;
  const claimedToday = state.day === day ? state.claimedToday : [];
  if (!offered.some((t) => t.id === taskId)) return { ok: false, reason: 'not-offered' };
  if (claimedToday.includes(taskId)) return { ok: false, reason: 'already-claimed' };
  if (claimedThisWeek >= TASKS_MAX_PER_WEEK) return { ok: false, reason: 'weekly-limit' };
  return { ok: true, state: { week, claimedThisWeek: claimedThisWeek + 1, day, claimedToday: [...claimedToday, taskId] } };
}
