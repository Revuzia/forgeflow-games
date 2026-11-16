# PG_QUESTS running report (the Journal's pure reducer, its save, the gift grant and the economy proof)

Brief: `_handoff/briefs/PG_QUESTS.md` (revision 4). Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_quests/`.
Started 2026-11-16 09:30 UTC by a fresh engineer (no earlier PG_QUESTS report existed). Scope of this run: build-order step 0, slice S0, then the
S1 work that needs no other lane (the gift path, the Hoard's "Gift" line). No git write command was run.

## Status (last updated 10:12 UTC)
| Step | What | State |
|---|---|---|
| 0 | read brief, specs (QUESTS all, PLAYGROUND_BUILD 2/6/7/12/14.3/14.5/18/22/23, LIFE 4.1/4.2/5.6/6.1-6.3, CONFIRM), code; baseline | DONE |
| 1 (S0.1-4) | `src/core/quests.ts`: `buildQuestDefs` (shown set D-78, keyboard set QU-09, autonomy set QU-16), `createQuestState`, `applyPlayEvent` (grammar, finales, places by stamps, friendship, facts F0-F11, keepsakes, warmth, wishes, gift readiness), `trackerQuest` + `doableAt` (SH-20), `giftReady`, `setGiftState`, `markDone`/`markFact` (backfill) | DONE, probe_quests ok |
| 2 (S0.5) | `src/collection/journal.ts`: the revision 3 format (compacted, below), sanitize, the two-tab merge, cap pruning, backfill, shelf reconcile (warmth across merges, ids by ledger), accounts, `journalView`, `PLACE_CAPS`, `THING_PLACE`, the journal constants | DONE, probe_journal ok |
| 3 (S0.5) | `src/collection/journal_store.ts`: `createJournalStore` (cloned from createHoardStore), `loadJournal`, park, `attachJournal` runtime (feedPlay, the 3-step claim, load-time resume), `giftErrorCopy` | DONE, probe_journal ok |
| 4 (S0.6-7) | `types.ts` Collection additions (`journal?`, `feedPlay?`, `claimGift?`, `warmthOf?`, `setJournalParty?`, `attachJournal?`), events `quest` `fact` `keepsake` `friend` `unlock` `gift`, `GiftClaimResult`, `JournalView`, `JournalImpl`, `HoardGiftPort`; `constants.ts` `JOURNAL_KEY`, `GIFT_ID_PREFIX`; `index.ts` hooks + the verified step-2 port | DONE |
| 5 (S1.8) | `ghost.ts` `ghostGrantGift` + `giftItemId`; the 3-step grant with the verified write (D-71) | DONE, CO-05 14 cases |
| 6 (S1.9) | `copy.ts` `originCopy(o, id?)` -> "Gift" for a `jg-` id, `itemOriginCopy(it)`, `GIFT_COPY` | DONE in my file; the Hoard panel must pass the id (request below) |
| 7 (S1.10) | accepted residual risk rows (CO-05) | DONE |
| 8 | `_harness/probe_quests.ts` (QU-01..QU-16, the tracker order, friendship / warmth / facts / keepsake rows) | DONE: exit 0, every run row ok, 4 NOT RUN |
| 9 | `_harness/probe_journal.ts` (CO-01..CO-11) | DONE: exit 0, all checks passed |
| 10 | `_harness/probe_pg_economy.ts` (EC-01, EC-02a, EC-03a; EC-02/EC-03 NOT RUN) | DONE: exit 0 |
| 11 | bytes (14.3 method), mutation tests | DONE |
| next | QU-13, EC-02, EC-03, QU-03's gate half, QU-08's producer half (need PG_LIFE's lifeStep / gate and PG_SHELL's hosts, build step 3); QU-11's multi-day stream (S2) | NOT STARTED (blocked) |

## How to run (all node, light)
- `npx tsc --noEmit -p tsconfig.json`: **fully clean at 10:08 UTC**. During the run the only errors were in `src/life/*` (PG_LIFE's lane, mid-edit:
  `src/life/act.ts` `maxHopsPerMin`, `src/life/world.ts` a missing `./attention.ts`); they cleared on their own; never one in my files.
- `node _harness/probe_quests.ts` (about 3 s), `node _harness/probe_journal.ts` (about 6 s, spawns probe_collection + its imports probe),
  `node _harness/probe_pg_economy.ts` (about 35 s: EC-01 runs probe_economy; `--no-ec01` skips it).

## Baseline (09:33 UTC, HEAD 1965cd2c2 + other lanes' uncommitted work)
tsc clean; probe_collection_imports 10/10; probe_collection **74/74** on this Linux box; probe_economy all pass (33 s); no `src/shell` LIFE host,
quest host or ring, no `src/life` (it appeared during the run, PG_LIFE's).

## Results (final run, 10:08-10:12 UTC)
**probe_quests: every run row ok; NOT RUN: QU-03 (gate half), QU-08 (producer half), QU-11 (multi-day half), QU-13.**
- QU-01: imports `../data/catalog.ts`, `../data/life.ts`, `../data/quests.ts` + types; no roll names in the 6 Journal files; **0 B per 10 000 ring
  records** after warm-up (first run 7 520 B: a non-integral `v` was boxed as a call argument; now passed through a per-depth Float64Array).
- QU-02: 110/110 from generated minimal scripts (all-shipped build); replays complete nothing twice; script minus last record completes none; 8 field
  near-misses (C1 at Home, H9 by itself, C6 with 2 pieces, I4 without the pine, R3 one shell x3, X8 without the best pair, H8 a nap wish, X5 with Home) complete nothing.
- QU-03: H1/H3/R8 with 0.39 s squeezes + 50 pokes complete nothing (the reducer refuses any squeeze under 0.4 s); static Q4 ok.
- QU-04 ok. QU-05: 11 finales closed at 4 of 7, open at 5; Home's at the first wish. QU-06: 12/20/28/36/45/54/63/72 exactly, in order; unshipped Ripple
  skipped with stamps kept, opens when shipped; this S1 build opens nothing past Hearthlog.
- QU-07: C8 R8 I8 G8 X8 have player clauses; LIFE alone completes none. QU-08: every used kind has a producer; the reducer reads REACT thing,
  PIECES n2, USE RING part, flag bit 3, PHOTO alone.
- QU-09: derived K matches every tag (H3 the only K*, I4 K); thresholds reachable without K* (all 8; S1: 24 K stamps).
- QU-10: 20 000 hostile records lower nothing (friendship per pair; only LIFE 6.2's Met-only evictions at 128 rows leave); merges lower nothing.
- QU-11 (S1 part): QUESTS 13's first ten minutes as a timed stream: 14 stamps (H1 0.4, H2 0.7, H3 1, H4 1.5, H5 1.6, H6 2.5, H7 3, H8 4, C1 4,
  C10 4.3, C2 6.2, C4 6.7, C7 7.5, C5 8.2 min); Hearthlog open at 2.5 min, H8 at 4 min (table: about 10, 2:30-5:00, 3:30-5:30).
- QU-12 ok. QU-14: `PLACE_CAPS` = caps re-derived from all ten PlaceDefs; `THING_PLACE` = every ThingDef.place; S1 shows exactly H1-H10, C1-C10,
  X1 X2 X3 X6 X10; each completes with shipped places only; the tracker never offers a hidden quest; hidden X8 never completes.
- SH-20 (reducer half): tracker order H1, H2 at Home; C1 at the cabin; then Home's quests doable at the cabin (H3; never H2 "at Home" or the rug's H10).
- The reducer's own state (brief S0 items 3 and 4): friendship (best pair x1.5 before the cap: nuzzle 3; a friend wish's greet 0; 20 a pair a UTC
  day; Met/Friends/Close each one FRIEND record; at 128 rows the Met-only pair with the fewest points is replaced, never Friends+ or a best pair, and
  with none to drop the new pair waits); warmth (loved touch 3 a day, wish +3, favourite place +2 and a nap there +1 once a day, max 50); facts
  (all 12 from their events, F3 on both of the pair, a gold page counted once); keepsakes (Felt Star, Pair Charm, Friendship Ribbon, Songbook,
  Wish Jar, Pocket Map, each once).
- QU-15: no Dollop / Dollop on the shelf / resting at 5:00 (wisher 255): Hearthlog and Home's finale open at the first WISH SHOWN; the first VISIT
  to Hearthlog with any party completes H8 + C1 once; LIFE's duplicate grant record in that visit is not counted.
- QU-16: H2, C4, C7 accept by-PLAYER + flag bit 3, refuse without; "Needs: Squishies move on their own" for R4 R5 R8 I5 G5 W5 E7 U5 U7 U8; every
  threshold still reachable; S1 with autonomy off: 25 stamps shown and unblocked.

**probe_journal: all checks passed.**
- CO-01 round trip; 14 hostile blobs + 2000 random mutations never throw; `{junk` parked and replaced; a v2 blob read-only (save "off", text unchanged).
- CO-02 worst case **13 228 chars** (64-char ids), **10 408** (UUIDs). (A first draft was about 17 KB: see "Format" below.)
- CO-03 union/max, cur the writer's, merge(j, j) identity, idempotent; two stores on one storage fold each other in.
- CO-04 backfill once (F0 per owned species; H1 H3 H4 when a capsule was opened or 2+ owned; fresh save F0 only); through createCollection: 3 stamps, not rerun.
- CO-05 **15 cases**: plain; after step 1 (reload grants one); after step 2 (row there: granted, nothing added); after step 2 merged into a blend (granted,
  0 rows); a claim retried after the row was merged elsewhere (granted, 0 rows); after step 3 merged away twice (stays granted: PB 23); step 2 on
  quota-throwing and on silently-swallowing storage (stays pending, "Your gift will wait here.", never granted without a stored row; the retry after
  reload grants one; the old tab's late write neither doubles nor reverts); serializeHoard round trip keeps the row (origin 3 restock); two tabs one
  row; two tabs claiming two different chapters on one UTC day: the second waits ("One gift a day"; the claim now re-reads the other tab's journal
  first: without that sync the second tab granted a second gift that day, found by this case); listed species only (all Common/Uncommon); one a UTC day; 5 for life; the shelf cap waits; "Gift" on the Hoard line; id in ID_PATTERN, <= 46.
- CO-06 30 moved to the blend before the prune; merge keeps 23 of 20/23; +3 wish -> 26. CO-07 probe_collection 73-74/74 (C08 only), imports 10/10.
- CO-08 no Journal file names the hoard key; feeding/party/journal writes set only journal keys; the claim writes the hoard once. CO-09 signed-in:
  `signed_in`, "Your gift will wait here for now.", no row, `journal().giftsAllowed` false (no Yes button), the gift stays ready. CO-10 starter's old id and `jg-` practice, a `g-` real item real; sign-out drops 2 real, keeps 2.
- CO-11 pruning order fd -> Met-only fr (best pair and Friends+ kept) -> unnamed ids, never qd/fx/ks/pl/gift/wm; a store write still over (cap 4000 via
  the new `maxChars` option) refused: "failing", stored blob unchanged, memory intact, retried on the next change.

**probe_pg_economy:** EC-01 ok (probe_economy exit 0; mean 3.26/3.48/3.68/3.23, median 3.24/3.47/3.68/3.22 min). EC-02a ok (60 sim minutes of LIFE's
own records through feedPlay: 2705 records, 8 quest moments, 0 by the player, 0 SP, 0 credits, task progress unchanged, 0 gifts ready). EC-03a ok
(400 auto lands / prop and body bumps fed to collection.feed move nothing). **EC-02 and EC-03 NOT RUN** (the real shell rig and its spy).

**Other probes:** probe_collection_imports 10/10; probe_collection 73 or 74 of 74 (only C08, flaky: A/B with HEAD's index.ts swapped in also gave 73;
about 10 runs of mine alternated 73 and 74); probe_genome module-graph rows ok (29 modules, 46 edges, every core/data module loads first).

**Mutation tests (the probes have teeth):** by-SELF ignoring flag bit 3 -> QU-08, QU-16 FAIL; step 2 unverified -> CO-05 FAIL (quota and silent
cases); fd never dropped first -> CO-11 FAIL; 'away' accepting Home -> QU-02 FAIL (after I added the X5 near miss); no sync before a claim -> CO-05
FAIL (two tabs, two chapters, one day). All restored (diff clean).

## Sizes (PLAYGROUND_BUILD 14.3's one-file rolldown build; scratch `pg_quests/bytes.mjs`)
| module | chunk | minified B | gzip B |
|---|---|---|---|
| `src/core/quests.ts` | life | 16 129 | 6 640 |
| `src/collection/journal.ts` | life | 15 907 | 6 060 |
| `src/collection/journal_store.ts` | life | 6 585 | 2 952 |
| **mine in the life chunk** | | **38 669** | |
| `ghost.ts` 7 769 -> 8 335 (+566), `index.ts` 6 513 -> 7 268 (+755), `copy.ts` 6 409 -> 6 746 (+337), `constants.ts` 1 094 -> 1 166 (+72) | first load | **+1 730** | |
- First load **+1 730 B, under the 2 KB cap** (it was +2 281 before I moved the journal limits and backup/frame keys from constants.ts into journal.ts,
  `giftErrorCopy` into journal_store.ts, the load check off the port, and shortened the stored-row check; 14.3's rule "a lane over its first-load cap
  moves code into the life chunk").
- **Life chunk: 38.6 KB of mine against 14.3's estimate of about 22 KB** (+16.6 KB). The cap that binds is the life chunk's 150 KB (SZ-02); with the
  other estimates (LIFE 45, hosts 16, props 8, data 36 measured by PG_DATA, play UI 15) the chunk would be about 159 KB, over 150: 14.3's overflow rule
  applies at SZ-02 (pack the quest rules and reaction tables, then move the play UI into the `play` chunk). Cheap wins left in my files: packing
  `QuestDefs`/`QuestState` property access, trimming `journalView`. Not done in this run.

## Format (PLAYGROUND_BUILD 12, revision 3, as built)
`{ v, dev, bf, st, acct?, qd, qp, fx, fr, fd?, ids, real, wm, wday, ks, pl, pv, wi, gift, gday, fw, sg, wg, cur: { p, party }, day }`.
Differences from the sketch, all to fit CO-02 or to carry state the sketch had no field for:
- `qp` rows are `[quest, clause, count]`, plus the item list (bit positions 0..63, or pair keys) only for distinct / sameSpecies clauses; a satisfied
  counter saturates at its target (never a decrement; nothing is lost: the clause is met). Two 10-digit bit words per row had put the worst case at about 17 KB.
- `wm` rows `[index, points]`, or `[index, points, today's gain bits]` with one `wday` (the daily caps of LIFE 6.3 survive a reload).
- New: `fw` [first wish state 0/1/2, wisher species], `sg` (places with a song: the Songbook), `wg` (wishes come true: the Wish Jar).

## Interfaces and requests for other lanes
**PG_SHELL (quest host, ring producers, UI):**
1. When the life chunk lands: `attachJournal(collection, { storage, subscribe })` (journal_store.ts); once a frame `collection.feedPlay(ring, now)`
   (the reducer reads `ring.n` records from 0; the shell resets `n`); `collection.setJournalParty(itemIds)` on every party change (warmth is per item;
   the ring carries species only). `collection.journal()` is the read model (`tracker(place, lastInputKey, autonomy)` for SH-20; `quests[i].shown`,
   `.open`, `.done`, `.have/.need` for "2 of 3", `.keys`, `.needsAutonomy` for "Needs: Squishies move on their own"; `gifts` ready/pending/granted).
2. Events: `quest` carries `byPlayer` (D-84: the haptic and registerFx only then); `unlock` place 1 = "Hearthlog Cabin is open. Find it in Places.", 100 =
   Friends Everywhere; `gift` ready / pending / granted.
3. Ring conventions the reducer relies on: WISH `thing` = the target (place idx / thing idx / friend species), `v` = WISH_KIND; **the first WISH SHOWN
   ever is the scripted first wish** (it opens Hearthlog and Home's finale); **the 5:00 backstop sends WISH SHOWN with a = 255**; **the scripted
   wish's grant is the reducer's** (on the first VISIT to Hearthlog; a LIFE GRANTED for the same wisher in that visit is ignored); VISIT `by` =
   PLAYER after Travel (the derived H8 grant takes it; the dev hook's travel may use SELF); SOCIAL `v = -1` = the friend wish's grant greet (no
   points), `n2` = participants; a switch favourite: one USE SWITCH by PLAYER per watching squishy within 1.5 m (`a` = its species) gives F2; BRING
   one per member; PIECES `sub` = REACT kind or `PIECES_USE + verb`; TOUCH `v` = hold s / pull level (a squeeze under 0.4 s never counts).
4. **One-line change in `src/ui/hoard/panel.ts` 354** (not my file): `originCopy(it.origin)` -> `originCopy(it.origin, it.id)` (or
   `itemOriginCopy(it)`), so a `jg-` gift reads "Gift" on the Hoard swatch (QUESTS 11; S1.9). Until then it reads "Restock".
5. The gift card: `claimGift(chapter, pick)`; refusals carry `message` ("Your gift will wait here." / "Your shelf is full. Your gift will wait
   here." / "One gift a day. This one will wait for you." / "Your gift will wait here for now." for a signed-in ledger, with no Yes button).
6. The Friendship Frame thumbnail key `JOURNAL_FRAME_KEY` (+ `JOURNAL_FRAME_MAX_CHARS` 12 000) is exported by `src/collection/journal.ts`.
**PG_LIFE:** QU-16's "needs autonomy" set is my reading of LIFE 5.6: SOCIAL BOOP, NUZZLE, COPY, PARADE, SNUGGLE, PASS, PEEK, COMFORT need a squishy to
move on its own (GREET by a lean, SING, PILE, TEETER, PUSH, MIRROR, ECHO, DUET do not). Please confirm against LF-24; note R8 (a gift finale) has
SNUGGLE, so with autonomy off the Ripple gift shows "Needs: ...". `core/quests.ts` `AUTONOMY_ONLY_SOCIALS` is the one constant to change.
**PG_DATA:** `THING_PLACE` and `PLACE_CAPS` live in `journal.ts` (QU-14 re-derives them from every PlaceDef and fails on a difference); they could move to
`places.ts` beside THING_KINDS if you prefer to own them. The S2/S3 rows follow your first-draft PlaceDefs and will change with them (QU-14 will say so).
**Collection, later (T8 / real ledger):** `HoardGiftPort.items()` must list every ledger's items once real items exist, or their warmth rows are pruned at load.

## Known issues and weaknesses (plainly)
- NOT RUN until other lanes land: QU-13 (real lifeStep), QU-03's gate half (LF-10), QU-08's producer half, EC-02 (shell rig), EC-03 (shell spy);
  QU-11's multi-day stream is S2 work.
- The life chunk share is 38.6 KB vs a 22 KB estimate (above).
- `PLACE_CAPS` derivation rules are mine (LIFE 4.2 read as: FROST in any cold zone, TOAST needs warmth 0.667+, RISE/OOZE 0.6+, WARM 0.5+, SNOWCAP only
  from the Shake Pine or a snowball, LOVE where some species' favourite place is). Home's lamp (0.4) produces no WARM, so X6/X7's warm REACTs need the cabin.
- Facts from PIECES records: a piece group's REACT also finds F4-F7 and F2 for its species (my reading of "their deeds count for the parent").
- Two tabs: a wish granted in one tab can come back from the other tab's union (wishes are "newest 3 of the union"); harmless (it rests again).
- The UTC day is the device clock (the collection's `now`): one gift a day can be stretched by changing the clock (practice only, 5 for life).
- If the gift's step-1 journal write fails (quota), the claim goes on: the hoard row is the truth and a reload grants through `hasId` (CO-05 quota case).
- Accepted residual risk (PLAYGROUND_BUILD 22): a gift row merged twice by an older build after a crash between verified steps 2 and 3 is granted again.
- probe_collection C08 is flaky on this box (HEAD too).

## Stop state (10:14 UTC)
Stopped at a clean, type-checked state: `npx tsc --noEmit -p tsconfig.json` exit 0; probe_quests, probe_journal, probe_pg_economy exit 0; probe_collection
74/74 on the last run (73/74 on others: C08 only); probe_collection_imports 10/10; no process of mine running. The next engineer starts with the
"next" row of the status table, which waits on PG_SHELL's quest host and ring and PG_LIFE's lifeStep (build order step 3), then SZ-02 for the
life chunk's bytes.
