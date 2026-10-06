// WOBBLEHOARD practice economy (_spec/COLLECTION.md 6, C-6; _spec/MERGE.md 4.4): the local meter, capsules, restock, tasks and merge
// for GHOST items. THIS IS THE ONLY CLIENT FILE ALLOWED TO CALL rollCapsule OR rollMerge (COLLECTION 3.2; probe_collection_imports.ts
// enforces it over the whole src tree). Everything here acts on the Practice shelf of a HoardSave, in place:
//   * a ghost is never sent anywhere, never tradeable, never mergeable with a real item, never promoted (a hand-edited save can make
//     any ghost it likes: it is practice, so that buys nothing);
//   * the rules are the real ones, so practice teaches the game: the same meter (core/meter.ts), the table cap of WH_QUEUE_MAX play
//     capsules (accrual pauses, task capsules bypass it), the public capsule odds, restock = pick 1 of 3 per UTC day, two tasks a day
//     and five a week, MERGE_COST copies of one species per merge with the core's tier-up, pity and finished-row rules, the 24 h output
//     lock, ten merges a UTC day, hearts protect;
//   * randomness and time are injected (`rand`, `now`); restock and task offers are seeded from the device id and the UTC day.
// Draw order (deterministic for a given source): capsule = 3 roll draws then 12 id draws; merge = 3 roll draws then 12 id draws;
// restock = 1 genome-seed draw then 12 id draws. A refused call draws nothing.
import type { Interaction, InteractionDetail, TouchKind } from '../core/meter.ts';
import { addInteraction, DAY_MS } from '../core/meter.ts';
import type { TaskDef } from '../core/drops.ts';
import {
  TASKS_MAX_PER_WEEK, capsuleGenome, claimTask, dailyTasks, daySeed, draw, isValidRestockPick, restockDisplayOrder, restockOffer, rollCapsule, weekKeyOf,
} from '../core/drops.ts';
import type { MergeError, MergeInput, MergePreviewOk, MergeState } from '../core/merge.ts';
import { MERGE_COST, MERGE_DAILY_CAP, MERGE_OUTPUT_LOCK_HOURS, previewMerge, rollMerge } from '../core/merge.ts';
import { SPECIES, getSpecies, speciesBaseGenome, tierIndexOf } from '../data/catalog.ts';
import type { SpeciesId } from '../data/catalog.ts';
import {
  GENTLE_POKE_FRESHNESS, GHOST_CAP, HOUR_MS, SNAP_TASK_INTENSITY, SOFT_POP_STREAK_S, SQUEEZE_TASK_DEFAULT_S, STRETCH_FULL_INTENSITY,
  TASK_CAPSULE_CAP, TIDY_MAX, WH_QUEUE_MAX,
} from './constants.ts';
import { oddsDigest } from './oddsDigest.ts';
import { FLAG_FAV, makeRow, newGhostId, rowToItem } from './store.ts';
import type {
  ClaimResult, HoardItem, HoardSave, MergeErrorCode, MergePreviewResult, MergeResult, MirrorRow, OpenResult, RestockView, TaskResult, TaskRow,
  TidyResult,
} from './types.ts';

export interface PracticeCtx {
  /** [0, 1) random source (injected; the default lives in index.ts). */
  rand: () => number;
  /** Epoch ms of this call. */
  now: number;
}

export const dayOf = (nowMs: number): number => Math.floor(nowMs / DAY_MS);
const L = 'practice' as const;
const fail = <E extends string>(error: E): { ok: false; ledger: typeof L; error: E } => ({ ok: false, ledger: L, error });

const findRow = (save: HoardSave, id: string): MirrorRow | undefined => { for (const r of save.ghosts) if (r[0] === id) return r; return undefined; };
const hasId = (save: HoardSave, id: string): boolean => findRow(save, id) !== undefined;
const countSpecies = (save: HoardSave, speciesIdx: number): number => { let n = 0; for (const r of save.ghosts) if (r[1] === speciesIdx) n++; return n; };
const ghostItem = (row: MirrorRow): HoardItem => rowToItem(row, L) as HoardItem; // rows are made here or validated on load

/* ───────────────────────────────────────────────── tasks (COLLECTION 7.10) ───────────────────────────────────────────────── */

let cacheDevice = '';
let cacheDay = NaN;
let cacheTasks: TaskDef[] = [];
/** Today's two practice tasks for this device (cached per device and day: the frame loop calls this). */
export function practiceTasksFor(deviceId: string, day: number): TaskDef[] {
  if (deviceId !== cacheDevice || day !== cacheDay) { cacheTasks = dailyTasks(daySeed(deviceId, day, 'tasks')); cacheDevice = deviceId; cacheDay = day; }
  return cacheTasks;
}

const STREAK_KEY: Record<string, string> = {};
const streakKey = (id: string): string => STREAK_KEY[id] ?? (STREAK_KEY[id] = `${id}#streak`);

/** Count one accepted touch into the task counters, exactly as the host counts them (COLLECTION 7.5 `bump`, 7.10). Allocation-free after warm-up. */
export function bumpTasks(progress: Record<string, number>, tasks: readonly TaskDef[], kind: TouchKind, amount: number, d: InteractionDetail, gapSincePokeS: number | null): void {
  const paid = d.paidAs ?? kind;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    let n = progress[t.id] ?? 0;
    if (t.metric === 'pokes' && paid === 'poke' && !d.doubleTap) { if (t.param ? (gapSincePokeS === null || gapSincePokeS >= t.param) : d.freshness >= GENTLE_POKE_FRESHNESS) n++; }
    if (t.metric === 'squeezes' && paid === 'squeeze' && amount >= (t.param ?? SQUEEZE_TASK_DEFAULT_S)) n++;
    if (t.metric === 'snaps' && paid === 'pull' && amount >= SNAP_TASK_INTENSITY) n++;
    if (t.metric === 'stretch' && paid === 'pull' && amount >= STRETCH_FULL_INTENSITY) n++;
    if (t.metric === 'medleys' && d.medley > 0) n++;
    if (t.metric === 'softPops' && paid === 'squeeze') {
      const sk = streakKey(t.id);
      if (amount >= SOFT_POP_STREAK_S) { const s = (progress[sk] ?? 0) + 1; progress[sk] = s; if (s > n) n = s; } else progress[sk] = 0;
    }
    progress[t.id] = n;
  }
}

/* ───────────────────────────────────────────────── the practice meter ───────────────────────────────────────────────── */

/** What one fed touch did (a reusable record: the frame loop passes the same one every time). */
export interface FeedOutcome { accepted: boolean; earned: number; full: boolean; refused: boolean }
export const createFeedOutcome = (): FeedOutcome => ({ accepted: false, earned: 0, full: false, refused: false });

/**
 * Feed one touch (epoch time `it.tMs`) to the practice meter. At WH_QUEUE_MAX play capsules the meter does not move at all (C-5: the
 * touch is simply not paid). Accepted touches also count toward today's practice tasks. Allocates only what addInteraction allocates.
 */
export function ghostFeed(save: HoardSave, it: Interaction, out: FeedOutcome): FeedOutcome {
  out.accepted = false; out.earned = 0; out.full = false; out.refused = false;
  if (save.ghostCapsules >= WH_QUEUE_MAX) { out.full = true; return out; }
  const prev = save.ghostMeter;
  const r = addInteraction(prev, it);
  if (r.detail.refused) { out.refused = true; return out; }
  const day = dayOf(it.tMs);
  const pt = save.ghostTasks;
  if (pt.day !== day) { pt.day = day; pt.progress = {}; }
  const lastPoke = prev.lastMs[0];
  bumpTasks(pt.progress, practiceTasksFor(save.deviceId, day), it.kind, it.amount, r.detail, it.kind === 'poke' && lastPoke !== null ? (it.tMs - lastPoke) / 1000 : null);
  save.ghostMeter = r.state;
  out.accepted = true;
  if (r.capsulesEarned > 0) {
    const add = Math.min(WH_QUEUE_MAX - save.ghostCapsules, r.capsulesEarned);
    save.ghostCapsules += add;
    out.earned = add;
  }
  return out;
}

/* ───────────────────────────────────────────────── capsules ───────────────────────────────────────────────── */

/** Open the next practice capsule: play capsules first (that frees the table), then task capsules. Result first; the caller animates. */
export function ghostOpen(save: HoardSave, ctx: PracticeCtx): OpenResult {
  const total = save.ghostCapsules + save.ghostTaskCapsules;
  if (total <= 0) return fail('no_capsule');
  if (save.ghosts.length >= GHOST_CAP) return fail('shelf_full');
  const source: 'play' | 'task' = save.ghostCapsules > 0 ? 'play' : 'task';
  const roll = rollCapsule(ctx.rand);
  const genome = capsuleGenome(roll);
  const def = getSpecies(roll.species)!;
  const before = countSpecies(save, def.idx);
  const id = newGhostId(ctx.rand, (x) => hasId(save, x));
  const row = makeRow(id, genome, ctx.now, 0, source === 'play' ? 'drop' : 'task');
  save.ghosts.push(row);
  if (source === 'play') save.ghostCapsules--; else save.ghostTaskCapsules--;
  save.ghostOpened++;
  return {
    ok: true, ledger: L, item_id: id, species_idx: def.idx, tier_idx: roll.tierIndex, genome_code: row[2], is_new: before === 0, copies: before + 1,
    source, credits_left: total - 1, item: ghostItem(row), quick: before > 0 && roll.tierIndex <= 1,
  };
}

/* ───────────────────────────────────────────────── restock ───────────────────────────────────────────────── */

const restockSeed = (save: HoardSave, day: number): number => daySeed(save.deviceId, day, 'restock');

export function ghostRestockView(save: HoardSave, nowMs: number): RestockView {
  const day = dayOf(nowMs);
  const copies = (id: SpeciesId): number => { const d = getSpecies(id); return d ? countSpecies(save, d.idx) : 0; };
  const offer = restockDisplayOrder(restockOffer(restockSeed(save, day)), copies);
  return {
    ledger: L, day, offer, claimed: save.ghostRestockDay === day,
    display: offer.map((species) => { const d = getSpecies(species)!; const n = copies(species); return { species, name: d.name, tier: d.tier, copies: n, isNew: n === 0 }; }),
  };
}

/** Take today's practice gift: one of the three offered species, once per UTC day, origin 'restock'. */
export function ghostClaimRestock(save: HoardSave, pick: SpeciesId, ctx: PracticeCtx): ClaimResult {
  const day = dayOf(ctx.now);
  if (!isValidRestockPick(restockSeed(save, day), pick)) return fail('not_offered');
  if (save.ghostRestockDay === day) return fail('already_claimed');
  if (save.ghosts.length >= GHOST_CAP) return fail('shelf_full');
  const def = getSpecies(pick)!;
  const seed = Math.floor(draw(ctx.rand) * 4294967296) >>> 0;
  const before = countSpecies(save, def.idx);
  const id = newGhostId(ctx.rand, (x) => hasId(save, x));
  const row = makeRow(id, speciesBaseGenome(def.id, seed), ctx.now, 0, 'restock');
  save.ghosts.push(row);
  save.ghostRestockDay = day;
  const tier = tierIndexOf(def.id);
  return { ok: true, ledger: L, item_id: id, species_idx: def.idx, tier_idx: tier, genome_code: row[2], is_new: before === 0, copies: before + 1, item: ghostItem(row), quick: before > 0 && tier <= 1 };
}

/* ───────────────────────────────────────────────── tasks ───────────────────────────────────────────────── */

export function ghostTaskRows(save: HoardSave, nowMs: number): TaskRow[] {
  const day = dayOf(nowMs);
  const st = save.ghostTasks.state;
  const claimedThisWeek = st.week === weekKeyOf(day) ? st.claimedThisWeek : 0;
  const claimedToday = st.day === day ? st.claimedToday : [];
  const progress = save.ghostTasks.day === day ? save.ghostTasks.progress : {};
  return practiceTasksFor(save.deviceId, day).map((def) => {
    const p = progress[def.id] ?? 0;
    return { def, progress: Math.min(p, def.target), target: def.target, done: p >= def.target, claimed: claimedToday.includes(def.id), weeklyLimitReached: claimedThisWeek >= TASKS_MAX_PER_WEEK };
  });
}

/** Collect a done practice task: one task capsule (it bypasses the table cap). Refusals in the server's order (COLLECTION 7.4). */
export function ghostCompleteTask(save: HoardSave, taskId: string, nowMs: number): TaskResult {
  if (typeof taskId !== 'string') return fail('bad_payload');
  const day = dayOf(nowMs);
  const offered = practiceTasksFor(save.deviceId, day);
  const def = offered.find((t) => t.id === taskId);
  if (!def) return fail('not_offered');
  const progress = save.ghostTasks.day === day ? save.ghostTasks.progress[def.id] ?? 0 : 0;
  if (progress < def.target) return { ok: false, ledger: L, error: 'not_done', progress, target: def.target };
  const c = claimTask(save.ghostTasks.state, offered, taskId, day);
  if (!c.ok) return fail(c.reason === 'already-claimed' ? 'already_claimed' : c.reason === 'weekly-limit' ? 'weekly_limit' : c.reason === 'not-offered' ? 'not_offered' : 'bad_payload');
  if (save.ghostTaskCapsules >= TASK_CAPSULE_CAP) return fail('queue_full');
  save.ghostTasks.state = c.state;
  save.ghostTaskCapsules++;
  return { ok: true, ledger: L, credits: save.ghostCapsules + save.ghostTaskCapsules };
}

/* ───────────────────────────────────────────────── merge (MERGE.md 3, 4.2 on ghosts) ───────────────────────────────────────────────── */

const CORE_ERR: Record<MergeError, MergeErrorCode> = {
  'wrong-count': 'wrong_count', 'mixed-species': 'mixed_species', 'unknown-species': 'unknown_species', 'invalid-genome': 'invalid_genome',
  'mythic-cannot-merge': 'mythic_cannot_merge', 'not-enough-copies': 'not_enough_copies',
};

export const mergesToday = (save: HoardSave, nowMs: number): number => (save.ghostMerges.day === dayOf(nowMs) ? save.ghostMerges.count : 0);

type Selection =
  | { ok: true; rows: MirrorRow[]; items: HoardItem[]; inputs: MergeInput[]; state: MergeState; preview: MergePreviewOk }
  | { ok: false; error: MergeErrorCode; itemId?: string };

const wellFormed = (ids: unknown): ids is string[] =>
  Array.isArray(ids) && ids.length === MERGE_COST && ids.every((x) => typeof x === 'string') && new Set(ids).size === MERGE_COST;

/** Check a selection of ghost ids the way the commit function checks real ones, then preview it (no randomness). */
function select(save: HoardSave, ids: unknown, nowMs: number): Selection {
  if (!wellFormed(ids)) return { ok: false, error: 'wrong_count' };
  const rows: MirrorRow[] = [];
  for (const id of ids) { const r = findRow(save, id); if (!r) return { ok: false, error: 'not_yours', itemId: id }; rows.push(r); }
  for (const r of rows) if (r[6] > nowMs) return { ok: false, error: 'locked', itemId: r[0] };
  for (const r of rows) if ((r[4] & FLAG_FAV) !== 0) return { ok: false, error: 'favourite', itemId: r[0] };
  const items = rows.map(ghostItem);
  // ownership counts every live ghost, locked ones included (MERGE M-2)
  const owned: Record<string, number> = {};
  for (const r of save.ghosts) { const sp = SPECIES[r[1]]; if (sp) owned[sp] = (owned[sp] ?? 0) + 1; }
  const state: MergeState = { owned, pity: save.ghostPity };
  const inputs: MergeInput[] = items.map((it) => ({ species: it.species, genome: it.genome }));
  const preview = previewMerge(inputs, state);
  if (!preview.ok) return { ok: false, error: CORE_ERR[preview.error] };
  return { ok: true, rows, items, inputs, state, preview };
}

/** The pad's preview of a practice merge: exact odds and the digest to send back with merge(). */
export function ghostPreviewMerge(save: HoardSave, ids: readonly string[], nowMs: number): MergePreviewResult {
  const s = select(save, ids, nowMs);
  if (!s.ok) return s.itemId !== undefined ? { ok: false, ledger: L, error: s.error, itemId: s.itemId } : { ok: false, ledger: L, error: s.error };
  const today = mergesToday(save, nowMs);
  return { ok: true, ledger: L, preview: s.preview, digest: oddsDigest(s.preview), inputs: s.items, mergesToday: today, mergesLeft: Math.max(0, MERGE_DAILY_CAP - today), lockHours: MERGE_OUTPUT_LOCK_HOURS };
}

/**
 * Merge practice copies. `digest` = the odds digest the player was shown (null only for Tidy-up, whose sheet says "Odds are recalculated
 * after each merge"). A stale digest answers 'odds_changed' with the fresh preview and consumes nothing (MERGE M-1). Refusals follow the
 * commit function's order: wrong_count, daily_cap, not_yours, locked, favourite, then the core's mixed_species / mythic_cannot_merge.
 */
export function ghostMerge(save: HoardSave, ids: readonly string[], digest: string | null, ctx: PracticeCtx): MergeResult {
  if (!wellFormed(ids)) return fail('wrong_count');
  const today = mergesToday(save, ctx.now);
  if (today >= MERGE_DAILY_CAP) return fail('daily_cap');
  const s = select(save, ids, ctx.now);
  if (!s.ok) return s.itemId !== undefined ? { ok: false, ledger: L, error: s.error, itemId: s.itemId } : fail(s.error);
  const fresh = oddsDigest(s.preview);
  if (digest !== null && digest !== fresh) return { ok: false, ledger: L, error: 'odds_changed', preview: s.preview, digest: fresh };
  const roll = rollMerge(s.inputs, ctx.rand, s.state);
  if (!roll.ok) return fail(CORE_ERR[roll.error]);
  const consumed = ids.slice();
  save.ghosts = save.ghosts.filter((r) => !consumed.includes(r[0]));
  const id = newGhostId(ctx.rand, (x) => hasId(save, x) || consumed.includes(x));
  const row = makeRow(id, roll.outcome.genome, ctx.now, 0, 'blend', ctx.now + MERGE_OUTPUT_LOCK_HOURS * HOUR_MS, consumed);
  save.ghosts.push(row);
  save.ghostPity = roll.pityAfter.slice();
  save.ghostMerges = { day: dayOf(ctx.now), count: today + 1 };
  const def = getSpecies(roll.outcome.species)!;
  return {
    ok: true, ledger: L, item_id: id, species_idx: def.idx, tier_idx: tierIndexOf(def.id), tier_up: roll.outcome.tierUp, genome_code: row[2],
    is_new: roll.outcome.isNew, copies: countSpecies(save, def.idx), consumed, pity: save.ghostPity.slice(), merges_today: today + 1, reason: roll.reason, item: ghostItem(row), parents: s.items,
  };
}

/** Tidy-up on ghosts (MERGE 3.3): the same merge, repeated, each on fresh state, stopping at the first refusal; what ran stays done. */
export function ghostTidy(save: HoardSave, plan: readonly (readonly string[])[], ctx: PracticeCtx): TidyResult {
  if (!Array.isArray(plan) || plan.length > TIDY_MAX || !plan.every((p) => Array.isArray(p))) return { ok: false, ledger: L, results: [], done: 0, best: null, error: 'bad_payload' };
  const results: MergeResult[] = [];
  for (const pair of plan) {
    const r = ghostMerge(save, pair, null, ctx);
    results.push(r);
    if (!r.ok) break;
  }
  let best: number | null = null;
  results.forEach((r, i) => {
    if (!r.ok) return;
    const b = best === null ? null : results[best];
    if (!b || !b.ok || r.tier_idx > b.tier_idx || (r.tier_idx === b.tier_idx && r.is_new && !b.is_new)) best = i;
  });
  return { ok: true, ledger: L, results, done: results.filter((r) => r.ok).length, best };
}

/* ───────────────────────────────────────────────── the outbound guard (C09) ───────────────────────────────────────────────── */

/**
 * Every ghost id found anywhere inside `payload` (strings, arrays, object keys and values, nested up to 16 levels). The (planned) bridge
 * must refuse to send any message for which this returns a non-empty list: a ghost id never leaves the device.
 */
export function findGhostIds(payload: unknown, ghostIds: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  const walk = (x: unknown, depth: number): void => {
    if (depth > 16 || x === null || x === undefined) return;
    if (typeof x === 'string') { if (ghostIds.has(x)) found.add(x); for (const id of ghostIds) if (x.includes(id)) found.add(id); return; }
    if (Array.isArray(x)) { for (const v of x) walk(v, depth + 1); return; }
    if (typeof x === 'object') for (const [k, v] of Object.entries(x as Record<string, unknown>)) { walk(k, depth + 1); walk(v, depth + 1); }
  };
  walk(payload, 0);
  return Array.from(found);
}
