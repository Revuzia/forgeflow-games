# PG_QUESTS lane brief: the Journal's pure reducer, its save, the gift grant and the economy proof

Read first, in this order: `_handoff/STATUS.md`, `_handoff/briefs/COMMON.md`, `_handoff/briefs/SESSION3.md` (it wins where they differ), then this
brief. Paths are relative to `games/wobblehoard`.

**Revision 3 (2026-11-15, after the adversarial review; PLAYGROUND_BUILD.md 2 D-60 to D-84 and 23).** What changed for you: the gift's step 2 is
a **verified write** (`flush()`, then `report().save === 'ok'` and the id in the stored text) before step 3 (D-71); the journal format holds the
`acct` tag once and item ids once in an `ids` table, warmth by index, with a defined pruning order over the cap; ids are classified by their
Hoard item's ledger, never by prefix; the Hoard shows "Gift" for a `jg-` id; a signed-in ledger gets "Your gift will wait here for now."; **only
completable quests are shown** (D-78) and the tracker follows SH-20; a by-SELF clause accepts a by-PLAYER record that carries flag bit 3 (made
while autonomy was off, D-79); PIECES carry n, a USE RING carries its part in `v`, every REACT carries a thing; X10 needs the player; the first
wish has a wisher with no Dollop (D-70) and H8 completes on the first arrival with any party; gifts only after the Home finale (H8); new rows
QU-13 to QU-16, CO-10, CO-11; your code ships in the **life chunk** (D-69), with 2 KB of first-load collection code.

## You own
- `src/core/quests.ts` (new: the pure reducer)
- `src/collection/journal.ts` and `src/collection/journal_store.ts` (new), and the PLAYGROUND additions in `src/collection/constants.ts` (the
  journal keys and limits), `ghost.ts` (`ghostGrantGift`), `types.ts` (the Collection additions below), `index.ts` (the wiring) and **`copy.ts`**
  (the Hoard's origin line "Gift" for a `jg-` id; the stored origin stays `'restock'`)
- `_harness/probe_quests.ts`, `_harness/probe_journal.ts`, `_harness/probe_pg_economy.ts` (new)
- Running report: **`_handoff/reports/PG_QUESTS.md`**. Port: none (node only). Scratch:
  `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_quests/`

## You must not touch
`src/data/**` (PG_DATA writes `quests.ts`, `life.ts` and the text), `src/core/rng.ts`, `meter.ts`, `drops.ts`, `merge.ts`, `save.ts` (read them, never
edit), the existing behaviour of `src/collection/store.ts` and its hoard format (you clone `createHoardStore` and call its `flush()` and `report()`,
you do not change it), `_harness/probe_collection.ts`, `_harness/probe_collection_imports.ts`, `_harness/probe_economy.ts` and
`_harness/sim_economy.ts` (CORE: task T7), `src/shell`, `src/ui`, `src/life`. No server work (task T8, `wh_claim_journal_gift`, is later). No git
write command.

## When you may start
Now (step 0). EC-02, EC-03 and QU-13 run the real shell rig or the real `lifeStep`, so they wait for PG_SHELL's LIFE host and quest host and
PG_LIFE's `lifeStep` (build order step 3): until then your probe prints them as NOT RUN, never as PASS.

## Read (completely)
**`_spec/QUESTS.md` (all of it: your spec)**, both revisions (revision 3: Q3, Q4, Q7, Q8, sections 3 to 6, 8, 9, 11 to 13, 15);
`_spec/PLAYGROUND_BUILD.md` 2 (D-29 to D-36, **D-70, D-71, D-73, D-78, D-79, D-84**), 6 (the `Clause` and `QuestDef` shapes), 7, **12 (your spec:
the reducer, the store, the format, over the cap, ids by ledger, two tabs, backfill, the gift grant, accounts, import rules)**, 14.3 (the life
chunk and your 2 KB first-load cap), 14.5, 18 (the QUESTS, COLLECTION and ECONOMY rows), 22 and 23 (why a load never reverts a granted gift);
`_spec/LIFE.md` 4.1 (FIRST_WISH and its wisher), 6.1 (the points of each social moment), 6.2 (friendship), 6.3 (warmth); `_spec/DESIGN.md` 5.4, 5.6,
5.12 and 8.4; `_spec/COLLECTION.md` 4 (account switch) and C-6; code: `src/collection/store.ts` 45-111 (origins, `sanitizeRow`, `makeRow`; 96 drops
an unknown origin; 100-110 the blend parents), 225-266 (`sanitizeHoard` and `serializeHoard` drop unknown hoard fields), 486-600
(`createHoardStore`, your template; the throttled write and its quota skip at 550-570, `flush()` at 592, `report()`), `index.ts` 121 (grants
call only `markDirty()`), `constants.ts` 20-50 (`ID_PATTERN`, `DEVICE_ID_PATTERN`, `GHOST_CAP`, `PARK_MAX_CHARS`, `SAVE_THROTTLE_MS` 29), `ghost.ts`
46 (`hasId`), 117-170 (the restock grant with `speciesBaseGenome`, no roll), 221 (only a hearted or locked item refuses a merge), `types.ts` 24
(the slice-1 starter's id), `copy.ts` 202-203 (`originCopy('restock')` = "Restock"), `src/core/save.ts` 82-97 (`migrateVersioned`),
`_harness/probe_collection_imports.ts` (I01 to I07: I03 scans every file in `src`, strings and comments included, for the two roll function
names: they may appear only in `ghost.ts`, `drops.ts` and `merge.ts`, so never write them in a new file).

## Build: S0 (now)
1. **`applyPlayEvent(st, ring, i, defs, out): number`** in `src/core/quests.ts`: pure, allocation-free after warm-up, no clock (the UTC day is
   injected), no rng; imports only `./rng.ts`, `../data/quests.ts`, `../data/life.ts`, `../data/catalog.ts` and types (it must load first in a fresh
   node process: probe_genome). Clause matching by the grammar of QUESTS 5 (sub any-of, place or `'away'`, thing, mech, family, `minN`, `by`,
   count, `distinct` bitsets: species 64 bits, families 16, things 64, **parts 8 read from the record's `v`**, places 16, pairs a hash set of at
   most 32; `sameSpecies` as the AND of the clauses' species bitsets); **a PIECES record's n** is the group's count at a new high (a `minN` clause
   reads it); **a by-SELF clause also accepts a by-PLAYER record with flag bit 3** (autonomy off); persistent counters, never reset, no within-visit
   clause (QU-10).
2. **Shown quests** (D-78, QU-14): a quest whose clause needs an unshipped place or a thing kind no shipped place has is hidden and skipped by the
   tracker; a finale is shown once its chapter can reach 5 shown main quests (S1: Friends Everywhere shows X1, X2, X3, X6 and X10). Finales open at
   5 of 7 main quests; Home's finale opens when the scripted first wish shows (QU-05) and **H8 completes on the first arrival at Hearthlog with any
   party** (QU-15). Places open by stamps only, in order, an unshipped place skipped with its stamps kept (QU-06). Friends Everywhere opens at 2
   chapter finales. A quest blocked by autonomy off reports "Needs: Squishies move on their own" (QU-16).
3. **Friendship** from SOCIAL events with LIFE 6.1's points (x1.5 for an authored best-friend pair before the cap), at most 20 a pair a UTC day, Met
   at 1, Friends at 12, Close friends at 40; a derived FRIEND event at each level; at most 128 rows; eviction never drops a pair at Friends or
   closer or a best-friend pair (LF-15 checks LIFE's side, QU-04 and CO-03 yours). A friend wish's grant greets once more with **no points**.
4. **Facts** F0 to F11 from QUESTS 9's "Found when" column (F0 from BRING, CAPSULE or GIFT; F1 from REACT LOVE; **F2 from a USE or a REACT whose
   thing is the favourite, or a switch favourite switched by the player with the fan watching**; F3 from the authored pair's first greet; ...);
   **keepsakes** (20 bits, QUESTS 10); **warmth** per item (LIFE 6.3: +1 loved touch at most 3 a day, +3 a granted wish, +2 a visit to its
   favourite place once a day, +1 a nap there once a day; never falls; a merge keeps the larger, CO-06); **wishes** kept (at most 3 resting, the
   newest 3 of a two-tab union, QU-12); **gift readiness** (5 for life, Common or Uncommon, at most 1 per UTC day, **only after the Home finale
   (H8)**).
5. **`journal.ts`**: sanitize (hostile JSON never throws), serialize **the revision 3 format** of PLAYGROUND_BUILD 12 (`acct` once per blob; `ids`
   the item ids once each, at most 100, and `real` the indexes of real-ledger ones; `wm` warmth as [index, points]; `cur.party` as indexes; worst
   case about 12.8 KB with 64-character ids, under 16 000), the two-tab merge (every field only grows or is a max: union or max, `cur` last
   writer), park, backfill (`bf` once: F0 for every owned species; H1, H3 and H4 done when the shelf shows them; CO-04). **Over the cap** (CO-11):
   drop `fd` rows, then Met-only `fr` rows with the fewest points, then `ids` no field names; never `qd`, `fx`, `ks`, `pl`, `gift` or a `wm` row;
   if still over, refuse the write, report `failing`, keep memory and the stored blob, and retry on the next change. **Warmth across merges**
   (CO-06): before `wm` is pruned to the shelf at load, move (max) a pruned parent's warmth to the blend row that names it. **`journal_store.ts`**:
   cloned from `createHoardStore`, key `wobblehoard:v2:journal`, backup key `wobblehoard:v2:journal.unreadable`, `JOURNAL_VERSION = 1`,
   `JOURNAL_MAX_CHARS = 16_000` (it parks whole under `PARK_MAX_CHARS` 20 000), `JOURNAL_MIGRATIONS = []` through `migrateVersioned`; a newer `v`
   read-only in memory; an unreadable blob parked and replaced; saves batched at most once per 2 s; the gift steps unthrottled. The Friendship
   Frame's thumbnail lives under its own key `wobblehoard:v2:journal.frame` (at most 12 KB, written once by the shell at X8), never in the blob.
6. **Accounts** (M25, CO-10): an id is a real-ledger id when its Hoard item's `ledger` is not `'practice'`, **whatever its prefix** (the slice-1
   starter keeps its old id, `types.ts` 24; gifts are `jg-` and practice); entries naming real-ledger items sit under the blob's one `acct` and
   are dropped on sign-out or an account switch; practice ids stay.
7. The **Collection interface additions** in `types.ts`: `journal?()`, `feedPlay?(ring, nowMs)`, `claimGift?(chapter, pick)`, `warmthOf?(itemId)`, and
   the events `quest`, `fact`, `keepsake`, `friend`, `unlock`, `gift`. The collection still imports only `./`, `../core/`, `../data/` and
   `../contracts.ts` types: LIFE events reach it through the shell's ring (I01 to I07 unchanged).

## Build: S1 (the gift path ships with the Hearthlog finale)
8. **`ghostGrantGift(save, chapter, pick, ctx)`** in `ghost.ts` and the **three-step grant** of QUESTS 11: (1) the journal writes `gift[chapter] =
   pending` with the pick, unthrottled; (2) the ghost row: origin `'restock'` (an existing code: a new code would make older builds drop the row,
   store.ts 96), genome `speciesBaseGenome(pick, hashString(deviceId + ':gift:' + chapter))`, the deterministic id `'jg-' + deviceId + '-' +
   chapter` (at most 46 characters of `[a-z0-9-]`, inside `ID_PATTERN`), `hasId` first (present = success, nothing added), the `GHOST_CAP` refusal
   ("Your shelf is full. Your gift will wait here."); **then the verified write (D-71): call the hoard store's `flush()` (store.ts 592) and go on
   only when `report().save === 'ok'` and the row's id is in the stored text; otherwise the gift stays `pending` ("Your gift will wait here.") and
   the claim retries on the next load or claim** (today's grants only `markDirty()`, index.ts 121, which waits up to 2000 ms and never writes on a
   quota failure, store.ts 557); (3) the journal writes `granted`, unthrottled. On load: a pending gift whose id is on the shelf, or named as a
   parent of a blend row, is marked granted; otherwise steps 2 and 3 run again. **A load never turns a granted gift back to pending** (a blend row
   keeps only its own parents' ids, so a revert could grant it twice: PLAYGROUND_BUILD 23). The claim refuses a second gift on the same UTC day
   ("One gift a day. This one will wait for you.") and any species not on the chapter's list; **Practice ledger only** (CO-09, M3: a signed-in
   ledger's plate and card read "Your gift will wait here for now." with no Yes button).
9. **The Hoard's origin line**: `copy.ts` shows "Gift" for an item whose id starts with `jg-` (it would say "Restock", 202-203); the stored origin
   stays `'restock'`.
10. **Accepted residual risk** (PLAYGROUND_BUILD 22): a blend row keeps only its own parents' ids, so a gift row merged twice by an older build after
    a crash between steps 2 and 3 would be granted again. Write the CO-05 rows that show every other interruption gives exactly one gift, the
    failing-storage case included.

## Build: S2 and S3
The reducer is generic: each new chapter is data. As each place ships, re-run QU-02 (every quest from its minimal event script), QU-06 (opening in
order), QU-09 (keyboard parity: K derived from the producer table), QU-13 (the real `lifeStep`), QU-14 (shown quests against the shipped set),
QU-16 (autonomy off) and QU-11 (the scripted regular-player stream with the gift pair Puddlo and Boingle, reported against QUESTS 7, +-50%).

## Acceptance ids you must make pass
**QU-01 to QU-16** (`probe_quests.ts`), **CO-01 to CO-11** (`probe_journal.ts`), EC-01 to EC-03 (`probe_pg_economy.ts`: EC-01 = `probe_economy`
passing unchanged, 3.0 to 3.8 active minutes a capsule; EC-02 = the real shell rig with LIFE on, 4 moving mock bodies and the real collection,
**60 sim minutes** with no input, travelling to every place: 0 SP, 0 task progress, 0 capsules, 0 gifts claimable, 0 haptics while more than 0
quest moments played, 0 camera moves, plus one 2-minute run on real SoftBodies; EC-03 = a spy sees every `auto` or `prop` event dropped before
`collection.feed`). EC-04 (sim_economy with 5 gifts) is the orchestrator's task T7, not yours. CS-01, CS-02, CS-03 and CS-13 are made of your rows.
`probe_collection` stays 73/74 (C08 is the known open row) and `probe_collection_imports` unchanged (CO-07). The proof that the pace holds is
QUESTS 11: nothing new feeds the meter.

## Budgets
0 B allocated over 10 000 reducer events (QU-01); the quest host's share of LIFE's 0.4 ms frame budget; the worst-case journal at most 16 000
characters (CO-02). **Size:** the reducer, the journal and its store load in the life chunk (about 22 KB of its 110 by PLAYGROUND_BUILD 14.3);
**at most 2 KB of yours in the first load** (`ghostGrantGift` and the hooks); after every step report the minified bytes of each new or grown
module (14.3's one-file rolldown build).

## Never
A squish point, a capsule or a meter call from the Journal (the reducer imports no meter function: QU-01); a write to the hoard key except through
`ghostGrantGift` (CO-08); a number that goes down (QU-10); a timer, a streak or a calendar gate on content; a gift on a signed-in account before T8;
"granted" written before the row is verified in storage; an id classified by its prefix.
