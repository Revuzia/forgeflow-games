// Merge probe, client side (plain node, exits 1 on failure): the PRACTICE merge of _spec/MERGE.md on ghost items (collection/ghost.ts),
// i.e. the checks of MERGE.md section 10 that apply without a server:
//   R2  a refused selection consumes zero draws; a merge draws exactly 3 numbers for the roll (+ the ghost id's 12)
//   R3  odds digest: a stale digest answers 'odds_changed' with the fresh preview and consumes nothing; the matching digest proceeds
//   R8  locked, hearted, mixed, Mythic, not-yours, wrong count: refused with the commit function's codes, nothing consumed
//   R9  10 merges a UTC day, the 11th 'daily_cap'; Tidy-up stops at the cap and keeps what ran
//   R11 every result is a legal tier move (same tier or one up, never the input species); items are conserved (cost in, one out)
//   R13 the preview the pad shows is the odds the roll uses (same digest)
//   R14 a merge-made item is locked 24 h (cannot merge again until then)
//   plus pity (4 duds, then a guaranteed tier-up), the finished row, the last-copy warning, Mythic, the ceremony data, Tidy-up planning.
// The server-side tests (R1 replay from the ledger, R4-R7, R10, R12 distribution, R15 UI, R16 CI flip) are not client checks: probe_economy.ts
// covers the core's distribution and the cost-3 rehearsal; the rest waits for the server and the pad UI.
import { DAY_MS } from '../src/core/meter.ts';
import { MERGE_COST, MERGE_DAILY_CAP, MERGE_OUTPUT_LOCK_HOURS, rollMerge } from '../src/core/merge.ts';
import type { MergeState } from '../src/core/merge.ts';
import { decodeGenome } from '../src/core/genome.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { TOP_TIER_INDEX } from '../src/core/rarity.ts';
import { memoryStorage } from '../src/core/settings.ts';
import { CATALOG, SPECIES_BY_TIER, speciesBaseGenome, tierIndexOf } from '../src/data/catalog.ts';
import type { SpeciesId } from '../src/data/catalog.ts';
import { HOARD_KEY, HOUR_MS, TIDY_MAX } from '../src/collection/constants.ts';
import { ghostMerge, ghostPreviewMerge, ghostTidy } from '../src/collection/ghost.ts';
import { createCollection } from '../src/collection/index.ts';
import type { HoardSave, MergeResult, MirrorRow } from '../src/collection/index.ts';
import { oddsDigest } from '../src/collection/oddsDigest.ts';
import { buildStacks, defaultMergeInputs, tidyCandidates } from '../src/collection/stacks.ts';
import { FLAG_FAV, FLAG_SEEN, emptyHoard, makeRow, rowToItem, serializeHoard } from '../src/collection/store.ts';

let bad = 0;
let total = 0;
const check = (id: string, name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${name}${extra ? '  ' + extra : ''}`); };

const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
let seq = 0;
const row = (species: SpeciesId, o: { fav?: boolean; lockedUntil?: number; bornAt?: number } = {}): MirrorRow => {
  seq++;
  return makeRow(`g-m${seq.toString(36).padStart(11, '0')}`, speciesBaseGenome(species, seq * 7919), o.bornAt ?? T0 - DAY_MS + seq, FLAG_SEEN | (o.fav ? FLAG_FAV : 0), 'drop', o.lockedUntil ?? 0);
};
const save = (rows: MirrorRow[]): HoardSave => { const s = emptyHoard('mergedevice0001'); s.ghosts = rows; return s; };
const counting = (seed: number): { fn: () => number; n: () => number } => { const r = mulberry32(seed); let k = 0; return { fn: () => { k++; return r(); }, n: () => k }; };
const ids = (rows: MirrorRow[]): string[] => rows.map((r) => r[0]);
const COMMON = SPECIES_BY_TIER[0].map((d) => d.id), UNCOMMON = SPECIES_BY_TIER[1].map((d) => d.id), RARE = SPECIES_BY_TIER[2].map((d) => d.id), MYTHIC = SPECIES_BY_TIER[TOP_TIER_INDEX].map((d) => d.id);
const pairOf = (species: SpeciesId, o: { fav?: boolean; lockedUntil?: number } = {}): MirrorRow[] => Array.from({ length: MERGE_COST }, () => row(species, o));

/* ───────────────── R2 / R8: refusals draw nothing and change nothing ───────────────── */
{
  const p = pairOf('plumpet');
  const extra = row('plumpet');
  const locked = row('plumpet', { lockedUntil: T0 + HOUR_MS });
  const hearted = row('plumpet', { fav: true });
  const other = row('twangle');
  const myth = pairOf(MYTHIC[0]);
  const s = save([...p, extra, locked, hearted, other, ...myth]);
  const ref = serializeHoard(s);
  const cases: Array<[string, string[], string]> = [
    ['one id', [p[0][0]], 'wrong_count'],
    ['too many ids', [...ids(p), extra[0]], 'wrong_count'],
    ['the same id twice', Array.from({ length: MERGE_COST }, () => p[0][0]), 'wrong_count'],
    ['an id that is not on the shelf', [...ids(p).slice(1), 'g-nope00000000'], 'not_yours'],
    ['a locked copy', [...ids(p).slice(1), locked[0]], 'locked'],
    ['a hearted copy', [...ids(p).slice(1), hearted[0]], 'favourite'],
    ['two species', [...ids(p).slice(1), other[0]], 'mixed_species'],
    ['a Mythic pair', ids(myth), 'mythic_cannot_merge'],
  ];
  const rng = counting(1);
  const got = cases.map(([, sel]) => { const r = ghostMerge(s, sel, null, { rand: rng.fn, now: T0 }); return r.ok ? 'ok' : r.error; });
  check('R8', `refusals carry the commit function's codes (${cases.map((c) => c[0]).join('; ')})`, got.every((g, i) => g === cases[i][2]), got.join(' '));
  check('R2', 'a refused selection consumes zero draws and changes nothing in the save', rng.n() === 0 && serializeHoard(s) === ref);
  const pre = cases.map(([, sel]) => { const r = ghostPreviewMerge(s, sel, T0); return r.ok ? 'ok' : r.error; });
  check('R8', 'the pad preview refuses the same selections with the same codes (no randomness at all)', pre.every((g, i) => g === cases[i][2]) && rng.n() === 0, pre.join(' '));
  const n0 = s.ghosts.length;
  const ok = ghostMerge(s, ids(p), null, { rand: rng.fn, now: T0 });
  check('R2', `a merge draws exactly 3 numbers for the roll plus 12 for the new ghost's id; ${MERGE_COST} copies are consumed and one is minted`,
    ok.ok && rng.n() === 15 && s.ghosts.length === n0 - MERGE_COST + 1 && ids(p).every((id) => !s.ghosts.some((r) => r[0] === id)), `${rng.n()} draws`);
}

/* ───────────────── R3 / R13: the odds digest ───────────────── */
{
  const p = pairOf('plumpet');
  const s = save([...p, row('dollop')]);
  const shown = ghostPreviewMerge(s, ids(p), T0);
  const state: MergeState = { owned: { plumpet: MERGE_COST, dollop: 1 }, pity: s.ghostPity };
  const coreRoll = rollMerge(ids(p).map((id) => { const it = rowToItem(s.ghosts.find((r) => r[0] === id)!, 'practice')!; return { species: it.species, genome: it.genome }; }), mulberry32(3), state);
  check('R13', 'the preview the pad shows has the digest of the odds the roll uses (same state, same digest)', shown.ok && coreRoll.ok && shown.digest === oddsDigest(coreRoll.odds), shown.ok ? shown.digest : '');
  // ownership changes under the player (another tab, a capsule): a NEW species of the tier changes the weights
  s.ghosts.push(row('twangle'));
  const before = serializeHoard(s);
  const rng = counting(4);
  const stale = shown.ok ? ghostMerge(s, ids(p), shown.digest, { rand: rng.fn, now: T0 }) : null;
  check('R3', 'a stale digest answers "odds_changed" with the fresh preview and its digest; nothing is consumed and nothing is drawn',
    !!stale && !stale.ok && stale.error === 'odds_changed' && !!stale.preview && !!stale.digest && stale.digest !== (shown.ok ? shown.digest : '') && serializeHoard(s) === before && rng.n() === 0
    && stale.preview.outcomes.find((o) => o.species === 'twangle')?.isNew === false);
  const fresh = stale && !stale.ok && stale.digest ? ghostMerge(s, ids(p), stale.digest, { rand: rng.fn, now: T0 }) : null;
  check('R3', 'the fresh digest proceeds', !!fresh && fresh.ok);
  const gs = save(pairOf('plumpet'));
  const gref = serializeHoard(gs);
  const garbage = ghostMerge(gs, ids(gs.ghosts), 'od1.0000000000000000', { rand: rng.fn, now: T0 });
  check('R3', 'a digest that matches nothing is refused the same way, nothing consumed', !garbage.ok && garbage.error === 'odds_changed' && serializeHoard(gs) === gref);
}

/* ───────────────── R9: the daily cap and Tidy-up ───────────────── */
{
  const rows: MirrorRow[] = [];
  for (let k = 0; k < 14; k++) rows.push(...pairOf(COMMON[k % COMMON.length]));
  const s = save(rows);
  const rng = mulberry32(5);
  const results: MergeResult[] = [];
  const pairs: string[][] = [];
  for (let k = 0; k < 14; k++) pairs.push(ids(rows.slice(k * MERGE_COST, (k + 1) * MERGE_COST)));
  for (let k = 0; k < MERGE_DAILY_CAP + 1; k++) results.push(ghostMerge(s, pairs[k], null, { rand: rng, now: T0 + k }));
  const last = results[results.length - 1];
  check('R9', `${MERGE_DAILY_CAP} practice merges a UTC day, the next one is "daily_cap" with its inputs untouched`,
    results.slice(0, MERGE_DAILY_CAP).every((r) => r.ok) && !last.ok && last.error === 'daily_cap' && pairs[MERGE_DAILY_CAP].every((id) => s.ghosts.some((r) => r[0] === id)));
  const nextDay = ghostMerge(s, pairs[MERGE_DAILY_CAP], null, { rand: rng, now: T0 + DAY_MS });
  check('R9', 'the cap resets at the next UTC day', nextDay.ok && nextDay.merges_today === 1);
  // Tidy-up shares the cap: 6 done, a plan of 10 -> 4 run, then 'daily_cap', and what ran stays done
  const r2: MirrorRow[] = [];
  for (let k = 0; k < 16; k++) r2.push(...pairOf(COMMON[k % COMMON.length]));
  const s2 = save(r2);
  const rng2 = mulberry32(6);
  const p2: string[][] = [];
  for (let k = 0; k < 16; k++) p2.push(ids(r2.slice(k * MERGE_COST, (k + 1) * MERGE_COST)));
  for (let k = 0; k < 6; k++) ghostMerge(s2, p2[k], null, { rand: rng2, now: T0 });
  const n0 = s2.ghosts.length;
  const tidy = ghostTidy(s2, p2.slice(6, 16), { rand: rng2, now: T0 });
  const lastT = tidy.results[tidy.results.length - 1];
  check('R9', 'Tidy-up stops at the first refusal (the daily cap after 4 more) and keeps what ran',
    tidy.ok && tidy.done === MERGE_DAILY_CAP - 6 && tidy.results.length === MERGE_DAILY_CAP - 6 + 1 && !lastT.ok && lastT.error === 'daily_cap' && s2.ghosts.length === n0 - tidy.done * (MERGE_COST - 1), `${tidy.done} done`);
  const big = ghostTidy(s2, Array.from({ length: TIDY_MAX + 1 }, () => [] as string[]), { rand: rng2, now: T0 + DAY_MS });
  check('R9', `a Tidy-up plan longer than ${TIDY_MAX} is refused as a whole ("bad_payload")`, !big.ok && big.error === 'bad_payload' && big.results.length === 0);
}

/* ───────────────── R11: legal tier moves, conservation; pity; finished row ───────────────── */
{
  const r = mulberry32(7);
  let legal = true, conserved = true, decoded = true, finishedUp = true, runs = 0, ups = 0;
  for (let i = 0; i < 2500; i++) {
    const t = Math.floor(r() * TOP_TIER_INDEX); // Common..Legendary
    const tierList = SPECIES_BY_TIER[t];
    const sp = tierList[Math.floor(r() * tierList.length)].id;
    const own: MirrorRow[] = [...pairOf(sp)];
    const finished = r() < 0.2;
    for (const d of tierList) if (d.id !== sp && (finished || r() < 0.4)) own.push(row(d.id));
    for (const d of SPECIES_BY_TIER[Math.min(TOP_TIER_INDEX, t + 1)]) if (r() < 0.3) own.push(row(d.id));
    const s = save(own);
    s.ghostPity = Array.from({ length: 6 }, () => Math.floor(r() * 4));
    const n0 = s.ghosts.length;
    const m = ghostMerge(s, ids(own.slice(0, MERGE_COST)), null, { rand: r, now: T0 });
    if (!m.ok) { legal = false; continue; }
    runs++;
    if (m.tier_up) ups++;
    const outTier = tierIndexOf(CATALOG[m.species_idx].id);
    if (!(outTier === t || outTier === t + 1) || CATALOG[m.species_idx].id === sp || m.tier_up !== (outTier === t + 1) || m.tier_idx !== outTier) legal = false;
    if (s.ghosts.length !== n0 - MERGE_COST + 1) conserved = false;
    const g = decodeGenome(m.genome_code);
    if (!g || g.species !== CATALOG[m.species_idx].id || m.item.origin !== 'blend' || JSON.stringify(m.item.parents) !== JSON.stringify(m.consumed)) decoded = false;
    if (finished && !m.tier_up) finishedUp = false;
  }
  check('R11', `${runs} random practice merges (Common..Legendary, random ownership and pity): every result is the input tier or one up, never the input species, never lower`, legal && runs === 2500, `${ups} tier-ups`);
  check('R11', 'every merge consumes exactly MERGE_COST copies and mints one; the output decodes, is origin "blend" and lists its parents', conserved && decoded);
  check('R11', 'a finished row (every species of the input tier owned) always moves up', finishedUp);
  // pity: a source that always says "dud" (0.999...) still gets a tier-up on the 5th merge in a row, and the counter resets
  const dud = (): number => 0.9999999;
  const s = save([row('dollop')]);
  const seen: Array<{ up: boolean; reason: string }> = [];
  for (let k = 0; k < 6; k++) {
    const p = pairOf('plumpet');
    s.ghosts.push(...p);
    const m = ghostMerge(s, ids(p), null, { rand: dud, now: T0 + k * DAY_MS }); // a day apart: stay under the daily cap
    if (m.ok) seen.push({ up: m.tier_up, reason: m.reason });
  }
  check('R11', 'pity: four duds in a row from one tier, then the fifth merge is a guaranteed tier-up ("pity"), then the counter starts again',
    seen.length === 6 && seen.slice(0, 4).every((x) => !x.up) && seen[4].up && seen[4].reason === 'pity' && !seen[5].up && s.ghostPity[0] === 1, seen.map((x) => (x.up ? 'UP' : 'dud')).join(' '));
}

/* ───────────────── R14: the 24 h output lock ───────────────── */
{
  const s = save(pairOf('plumpet'));
  const rng = mulberry32(8);
  const m = ghostMerge(s, ids(s.ghosts), null, { rand: rng, now: T0 });
  const outId = m.ok ? m.item_id : '';
  const outRow = s.ghosts.find((r) => r[0] === outId)!;
  const twins = Array.from({ length: MERGE_COST - 1 }, (_, i) => makeRow(`g-twin${String(i).padStart(8, '0')}`, decodeGenome(outRow[2])!, T0, FLAG_SEEN, 'drop'));
  s.ghosts.push(...twins);
  const sel = [outId, ...ids(twins)];
  const early = ghostMerge(s, sel, null, { rand: rng, now: T0 + (MERGE_OUTPUT_LOCK_HOURS - 1) * HOUR_MS });
  const st = buildStacks(s.ghosts.map((r) => rowToItem(r, 'practice')!), 'practice', T0 + HOUR_MS).find((x) => x.idx === outRow[1])!;
  const late = ghostMerge(s, sel, null, { rand: rng, now: T0 + MERGE_OUTPUT_LOCK_HOURS * HOUR_MS + 1 });
  check('R14', `a merge-made ghost is locked for ${MERGE_OUTPUT_LOCK_HOURS} h: refused as "locked" before, accepted after; while locked it is never a mergeable spare`,
    m.ok && outRow[6] === T0 + MERGE_OUTPUT_LOCK_HOURS * HOUR_MS && !early.ok && early.error === 'locked' && late.ok && !st.mergeableIds.includes(outId), early.ok ? 'early merge went through' : '');
}

/* ───────────────── the pad: last copy, Mythic, defaults, Tidy-up planning, the collection API ───────────────── */
{
  const s = save(pairOf('plumpet'));
  const last = ghostPreviewMerge(s, ids(s.ghosts), T0);
  s.ghosts.push(row('plumpet'));
  const notLast = ghostPreviewMerge(s, ids(s.ghosts.slice(0, MERGE_COST)), T0);
  check('PAD', `the last-copy warning is set when the merge uses every copy (${MERGE_COST} of ${MERGE_COST}) and not when one is left`,
    last.ok && last.preview.usesLastCopy && notLast.ok && !notLast.preview.usesLastCopy);
  const rows: MirrorRow[] = [row('dollop', { bornAt: T0 - 9 * DAY_MS }), row('dollop', { fav: true }), row('dollop'), row('dollop'), row('dollop', { lockedUntil: T0 + HOUR_MS })];
  rows.push(...pairOf(MYTHIC[0]), ...pairOf(MYTHIC[0]));
  rows.push(row(RARE[0]), row(RARE[0]), row(RARE[0]));
  rows.push(row(UNCOMMON[0]), row(UNCOMMON[0]), row(UNCOMMON[0]));
  const items = rows.map((r) => rowToItem(r, 'practice')!);
  const stacks = buildStacks(items, 'practice', T0);
  const dollop = stacks.find((x) => x.species === 'dollop')!;
  const def = defaultMergeInputs(stacks, 'dollop');
  const plan = tidyCandidates(stacks, { includeRare: false, maxPairs: 10 });
  const planR = tidyCandidates(stacks, { includeRare: true, maxPairs: 10 });
  const flat = plan.flat(), flatR = planR.flat();
  const byId = (id: string) => items.find((i) => i.id === id)!;
  check('PAD', 'the pad picks the newest mergeable spares, never the keeper (the hearted copy), a hearted or a locked copy',
    !!def && def.length === MERGE_COST && !def.includes(dollop.keeper!) && def.every((id) => !byId(id).fav && byId(id).lockedUntil === null) && dollop.keeperHearted);
  check('PAD', 'Tidy-up by default takes Common and Uncommon only; "Include Rare and above" adds Rare; Mythic never; groups never hold a keeper, a heart or a locked copy',
    flat.every((id) => byId(id).tierIdx <= 1) && flatR.some((id) => byId(id).tierIdx === 2) && flatR.every((id) => byId(id).tierIdx < TOP_TIER_INDEX)
    && [...flat, ...flatR].every((id) => !byId(id).fav && byId(id).lockedUntil === null && !stacks.some((st) => st.keeper === id))
    && defaultMergeInputs(stacks, MYTHIC[0]) === null, `${plan.length} / ${planR.length} groups`);
  // through the collection API
  const base = emptyHoard('padapidevice001');
  base.ghosts = [...pairOf('plumpet'), ...pairOf('plumpet'), ...pairOf('chunkle'), row(UNCOMMON[2]), row(UNCOMMON[2]), row(UNCOMMON[2])];
  const mem = memoryStorage({ [HOARD_KEY]: serializeHoard(base) });
  const c = createCollection({ storage: mem, now: () => T0, random: mulberry32(9), setTimer: () => null, clearTimer: () => {} });
  const sel = c.mergeInputs('plumpet')!;
  const pv = c.previewMerge(sel);
  const bogus = await c.merge(sel, 'od1.ffffffffffffffff');
  const done = pv.ok ? await c.merge(sel, pv.digest) : null;
  const tp = c.tidyPlan({ includeRare: false });
  const td = await c.tidy(tp);
  check('PAD', 'through the collection: preview -> merge(digest) works; a wrong digest is "odds_changed" with nothing consumed; the result carries the ceremony data (parents with genomes, the new item unseen and locked)',
    pv.ok && !bogus.ok && bogus.error === 'odds_changed' && !!done && done.ok && done.parents.length === MERGE_COST && done.parents.every((x) => !!x.genome) && !done.item.seen
    && done.item.lockedUntil === T0 + MERGE_OUTPUT_LOCK_HOURS * HOUR_MS && done.item.ghost && c.practice().mergesToday === 1 + td.done && pv.mergesLeft === MERGE_DAILY_CAP);
  const best = td.best !== null ? td.results[td.best] : null;
  check('PAD', 'Tidy-up through the collection runs the plan, and "best" points at the highest tier result (the one full ceremony, MERGE M-5)',
    td.ok && td.done === tp.length && tp.length >= 1 && !!best && best.ok && td.results.every((x) => !x.ok || !best.ok || x.tier_idx <= best.tier_idx), `${td.done} merged`);
  c.dispose();
}

console.log(`\n${total - bad}/${total} checks passed`);
process.exit(bad ? 1 : 0);
