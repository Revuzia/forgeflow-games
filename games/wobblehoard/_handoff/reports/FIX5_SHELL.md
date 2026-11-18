# FIX5_SHELL running report (round 5, SHELL fix engineer: the verdict's B1, B2, B3, B4, B8, B7, B6, C1)

Brief: the orchestrator's round-5 task (B1 BLOCKER first, then B2, B3, B4, B8, B7, B6, C1, then ONE browser run). Verdict: `_handoff/reports/VERDICT_PG.md`.
Files owned: `src/shell`, `src/ui`, `src/input`, `src/render`, `vite.config.ts`, the shell and render harness files. Port 5366 only.
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/fix5_shell/` (`S/` below). No git write command is ever run.
There was no earlier FIX5_SHELL report: this is the first round-5 shell engineer.

## 0. State at the start (HEAD f271a93b1, tree clean)
- HEAD = cae532c34 (round 4) + the verdict commit f271a93b1 (reports only). Other round-5 lanes work in parallel (FIX5_DATA seen running probe_playground).
- Method (as round 4): every probe and browser run on a SNAPSHOT tree in scratch (`S/mk_tree.sh`: `git archive HEAD` + only my lane's working files,
  `node_modules` linked), so another lane's half-made edit never reaches my runs. `S/tree_head` = HEAD alone, for A/B of any failing row.

## 1. Baseline (HEAD f271a93b1, `S/probes.sh S/tree_head S/base_head`, one probe at a time, logs `S/base_head/`)
| check | HEAD |
|---|---|
| tsc (the snapshot) | exit 0 (2.9 s) |
| probe_app | 187/187 |
| shellview/node_checks | 165/165 (52 s) |
| probe_gestures | 160/160 |
| probe_merge | 22/22 |
| probe_trophies | 31/31 |
| probe_playground (quick) | 54/54 |
| probe_pg_lifequests | 13/13 this run (its FM allocation row is flaky: the verdict saw 12/13) |
| probe_life | 117 ok, 1 fail (LF-02 allocation, PG_LIFE's) |
| probe_chatter | 42/42 |
| renderview/pg_node_checks | 40 ok, 0 FAIL |
| probe_journal | all passed |
| probe_quests | all run passed, 3 NOT RUN (other lanes' code) |

## 2. Node probes on the final tree (`S/tree_mine` = HEAD + my lane's files only; `S/probes_mine1/`, then probe_screens re-run after the J row)
| check | HEAD | now |
|---|---|---|
| tsc (working tree and snapshot) | 0 | **0** |
| probe_app | 187/187 | **187/187** |
| shellview/node_checks | 165/165 | **168/168** (+3 new: B2 party kept, B2 piece cap, B7 awake budget) |
| probe_gestures | 160/160 | **160/160** |
| probe_merge | 22/22 | **22/22** |
| probe_trophies | 31/31 | **31/31** |
| probe_playground (quick) | 54/54 | **54/54** |
| probe_pg_lifequests | 13/13 (12/13 flaky FM) | **13/13** |
| probe_life | 117 ok, 1 fail (LF-02) | **117 ok, 1 fail** (LF-02, PG_LIFE's, the same numbers) |
| probe_chatter | 42/42 | **42/42** |
| renderview/pg_node_checks | 40 ok | **40 ok, 0 FAIL** |
| probe_journal, probe_quests | all (3 NOT RUN) | **all (3 NOT RUN)** |
| probe_screens | 43/43 | **43/43** (first 42/43: "every letter key keyboard.ts handles has a row in the key table" caught the new J: `screenCopy.ts` GUIDE_KEYS gains "J Journal") |
| probe_overlays, probe_uikit, probe_cut | 21/21, 62/62, 17/17 | **21/21, 62/62, 17/17** |

## Steps (updated after every finished item)
| item | what | state |
|---|---|---|
| 0 | read SESSION3, VERDICT_PG (all), PG_SHELL.md (rounds 3 to 4b), the brief, PLAYGROUND_BUILD 2 / 11 / 18, QUESTS 8 / 15; the verifier's scratch `pg_verify_r2` still exists (its `scripts/ghost.mjs` is reused for B1) | DONE |
| B1 | BLOCKER: a sleeper drawn in two places after a trip. Root cause found and fixed in the RENDER view (below); the host's asleep mirror follows a re-added view | DONE: render row fails at HEAD, passes now; the verifier's repro 10 trips x 2 layouts: HEAD 3.656 m apart, now 0.009 m |
| B2 | cut with a party keeps the party (11.4, D-16, SH-03) | DONE (node); the browser rows run in the final run |
| B4 | Places: no unshipped place; "N of M stamps" on open postcards | DONE (code + the re-specified browser row; the final run checks it) |
| B3 | the play-time UI: wish card, tracker pill, J key, the party popover ("Your squishies", the name tag's popover) with "Go play with..." | DONE (code; 6 browser rows in pg-playthrough; the final run checks them) |
| B8 | stamp moments out of the toast stack (a free slot, one at a time); the ring's state line above "Put back"; the toast stack clear of the Journal column on a phone; AUTO chips stand still and stay by their thing; the quick-switch row in a party | DONE (code + rows); NOT done: Home 5-out depth rows, the phone party framing (below) |
| B7 | the awake budget: over the cap untouched wholes are put to sleep (the restless ones hushed first) | DONE: node row fails at HEAD, passes now |
| B6 | the first labelled bubble: word labels under the first three bubbles of a session; a browser row measures FN-01's 10 s | DONE (labels); the timing is measured by the final run |
| C1 | the life chunk under 150 KB | DONE: 205.6 KB -> **144.2 KB** raw (51.2 KB gz): the quest reducer + journal store (`later-quests`, 35.6 KB) and the prop world builder (`later-props`, 25.6 KB) are lazy chunks of their own, requested in parallel |

### B3 notes: the play-time UI (`src/ui/later-play.ts` + `src/ui/play.css`, a `later-play` chunk of its own: 8.3 KB js + 3.4 KB css)
- Loaded by boot.ts right after the LIFE host attaches (never first-play, never in the life chunk). It holds:
  - **the tracker pill** ("Next: Chase the yarn", "· 1 of 2" for counts): the journal's own `tracker(place, lastInputKey, autonomy)` (SH-20: this place's chapter, then
    Home's, then Friends Everywhere's; never a hidden quest, one blocked by autonomy off, or one with no keyboard route after a key) and QUEST_TEXT's title; one line
    with an ellipsis; 44 px to hit; at the top left under the top row, LEFT of the Journal column; a tap opens the Journal AT that quest (its row scrolled into view and
    marked: `later-journal.ts` `at`); its x ("Hide the next stamp") hides it until the next stamp; hidden while a tool other than the Hand, a sheet, a modal, the Menu,
    Settings, the Hoard, a ceremony, a trip or a toast is up, and while a moment or the wish card uses its slot; never in the tiny layout.
  - **the wish card**: a tapped wish bubble (`wishes.ts` `onWish`) opens a small card in the same slot: the wish's line (`later-journal.ts` wishLine, QUESTS 8) and, for
    a place that is shipped, open and not here, "Let's go" (the Travel sheet's own `host.travel` path, "Packing up..." after 300 ms) and "Not now"; Esc or "Not now"
    closes it (focus back to the opener), a press elsewhere or 12 s closes it; it says the line in the live region once. Until the play UI lands a tap still reads the
    line (round 4's path).
  - **the party popover** ("Your squishies"): a tap on the name tag (`.nametag[data-party]`) or the new "Your squishies" button in the Journal column opens it over
    the name tag: one `k-chip` per squishy out (aria-pressed = the one addressed; the play squishy first selected), "Go play with..." and a button per thing shown in
    the place (`host.thingsNow()`, THING_TEXT names); a thing button calls `host.playWith(itemId, k)` for the ADDRESSED squishy ("Crimpo goes to play with the Felt
    Ball."). This is how a keyboard player addresses each squishy of the party: Tab to "Your squishies", Enter, Tab / Enter on a chip, Enter on a thing. Esc closes,
    focus back.
  - **the stamp moments** (B8, below).
- **J opens the Journal** (`keyboard.ts` onJournal, same rules as H: not in a control, shortcuts on; nothing before the life chunk lands); the Journal button's tooltip
  "Journal (J)" and `aria-keyshortcuts="J"`.
- Host additions (life chunk): `thingsNow()`, `partyNow()` (UI only, allocate). The kit page `_harness/uikit/pages/pg.ts` gains section `pg-play` (pill short/long,
  a moment, the wish card with and without "Let's go", the popover) on the backdrops (UI-04; the kit sheet was not shot this round).
- **Rows** (browser_shell pg-playthrough, new): "B3 the wish card ...", "B3 the tracker pill ...", "B3 a tap on the pill opens the Journal at that quest; the J key
  ...", "B3 the pill's x hides it", "B3 the party popover ...", "B3 by keyboard in the popover ... '<name> goes to play with the Felt Ball.'". None of these elements
  exists at HEAD, so every one of these rows fails there by construction.
- **Re-specified (written reasons in the code)**: keyboard-only "Tab order in play": round 4 allowed only the Journal and Places before Full screen; the pill, its x
  and "Your squishies" are new stops of the same group (D-77: Tab reaches every DOM control), still before Full screen, every published stop in its place and order.
  pg-playthrough "PG H1 ... first stamp": the toast log now also records the moments slot (the moments left the toast stack, B8); the row's words are unchanged.

### B8 notes
- **Stamp moments** ("New stamp: ...", "A gift is waiting in the Journal."): boot.ts hands them to the play UI once it has landed (a toast before): one at a time for
  2.4 s in the slot under the top row LEFT of the Journal column (so never over the Journal and Places buttons), waiting while a sheet (its title), a modal, the Menu,
  Settings, the Hoard or a ceremony is up; at most 3 waiting, more become "N new stamps"; the stamp springs in (Calm / reduced motion: the fade); one live line each.
- **The ring's state line over "Put back n"** (desktop, B_b3_desk_home5.png): hud.css lifts `.meter-state` above the chip while the chip shows (not in the strip
  layout, where the chip is not stacked).
- **The published toast stack vs the Journal column on a phone**: under 640 px wide, while a Journal-column button shows, the stack's right padding clears the column
  (play.css; only once the life UI has landed).
- **AUTO chips**: `.toast` left their HUD list (a passing toast made every chip jump to the top edge, y 90 -> 15); the play UI's slot joined it; when the anchor's spot is
  covered the chip tries the nearest free spots AROUND its anchor (down toward the ride, up, the sides; at most two chip heights away) instead of climbing past every
  box. Row: pg-playthrough "B8 the AUTO chips stand still while a toast shows" (a toast through the dev UI hook: the chips' positions before and during, at most 2 px).
- **The quick-switch row in a party**: with the LIFE host attached, the squishies OUT come first in the row, each marked with a small lagoon dot (`data-out`; its name
  is unchanged, so the published label rule holds), the row refreshes on every mat change, and a tap on one of them SWAPS the two within the party (game.ts switchNow:
  the squishy that was in play stays out in the freed spot; without the host the published swap is unchanged).
- **NOT done**: Home with 5 out on desktop in depth rows (the hiding in the verifier's shot comes from LIFE moving bodies along their segments, not from the mat's
  row, which keeps 1.3 m apart; a two-row slot list would put the back row mostly behind the front one at the camera's 0.27 rad pitch, the very reason the PC chose a
  row: VERIFY_RENDER_B B-M1); the phone's party-of-3 framing (render framing, not changed this round: it moves the published mat framing on every phone).

### B7 notes: the awake budget (later-life.ts overBudget)
- Cause: physics' `sleep()` refuses a body that is not at rest, LIFE kept every whole moving, and the rule asked only the single farthest body each frame, so over the
  cap nobody ever slept (the verifier: 3.06 to 4.28 units against 2.494 for 20 s).
- Fix: over the cap the rule takes as many wholes as the excess needs (ceil((units - cap) / (whole - sleeper))), farthest first; each that sleeps counts, each that
  physics refuses is HUSHED for 4 s (its scoot ends, its squash eases out, LIFE's new SCOOT / HOP / GLIDE / SQUASH intents for it are dropped), so it comes to rest and
  sleeps a moment later. The touched, carried, tossed and riding bodies are never forced; a static prop (the rug) no longer excludes a sleeper.
- Row (node_checks section 13, REAL SoftBody, 5 out on high, no touch, 30 one-second samples): "... after 6 s at or under unitCap (+ allowance) in at least 22 of 24
  samples and never over it 3 s in a row". HEAD's host (`S/tree_b2pre`, first version of the row): FAIL, 4 of 24 over and a 4 s run (3.03 to 3.28 against 2.494); now
  ok (2 of 24, longest run 2 s; 3 asleep most of the time). The row was then tightened to put 5 out at HEAD too (HEAD's cut empties the mat): re-run below.

### B6 notes
- `wishes.ts`: the first three bubbles of a session carry their word under them (BUBBLE_MEANINGS: "Hello!", "What's that?"), aria-hidden (the hit area's name says the
  same), placed with the hit areas every 250 ms, inside the window. Row (pg-playthrough, new): "B6 the first labelled bubble shows within 10 s of the first 6 s
  release (desktop)": sampled each second of sim after the first squeeze. Whether LIFE shows a bubble in that window is LIFE's (FIRST_PLAY's forced use); the row
  reports what the run sees.

### C1 notes (sizes: one build each of `S/tree_mine`, `vite build --outDir scratch`)
| chunk | HEAD (verdict) | now |
|---|---|---|
| later-life | 203.45 KB | **144.16 KB** (51.22 KB gz) |
| later-quests (new: core/quests, collection/journal, journal_store) | - | 35.64 KB |
| later-props (new: physics/props) | - | 25.57 KB |
| later-play (new: the B3 UI) | - | 8.29 KB js + 3.38 KB css |
| G0 / G0b | 2399 KB / 461 KB gz | 2414 KB of 3072 / 462 KB gz of 600 |
- How: `src/shell/later-quests.ts` and `src/shell/later-props.ts` re-export `attachJournal` and `buildPropWorld`; later-life.ts keeps only their TYPES and takes the
  functions from `LifeHostDeps.parts`; boot.ts requests the three chunks with one `Promise.all` (no extra wait); node_checks hands the same parts in. The build's
  honesty check passes (no first-play chunk statically imports a later-* chunk). Row (prod-build, new): "SZ-02 (round 5, C1): the life chunk (later-life) is at most
  150 KB raw" (HEAD: 203 KB, fails).
- One-file bytes (14.3's method, `S/sizes_{head,mine}.txt`): first load game.ts 16 761 -> 17 092 (+331), boot.ts 8 433 -> 8 757 (+324), hudBinding.ts 16 880 -> 17 080
  (+200), keyboard.ts +82, cut.ts +120, quickSwitch.ts +52 (the shell's first-load share about 5.1 KB of its 12 KB cap); render/bodyview.ts +207; life chunk
  later-life.ts 42 755 -> 43 956 (+1 201), wishes.ts +893, thingAuto.ts +97.

### B1 notes: the root cause and the fix
- **Cause** (not the verifier's guess): physics' `placeAt` WAKES a body (softbody.ts 2497), and the trip's arrival rule (later-life.ts `enterPlace`) then puts
  every member past moverCap to `sleep()` at once, in the same moment. The host's asleep mirror (`asleepShown`) saw "asleep" before and after, so the stage's
  view was never told the body had woken; and the view skips its fine mesh (the jelly) while flagged asleep (RD-05, bodyview.ts). The eyes and the ember follow
  the body's centre every frame, so they moved to the spawn spot while the jelly stayed at the old one. The same held for a member that was AWAKE before the trip
  and was put to sleep on arrival (placed, then flagged asleep before the stage's next update): that is why 2 of 3 trips showed it, not only sleepers.
- **Fix at the root, for every path** (`src/render/bodyview.ts`): the view remembers the drawn centre at its last fine-mesh evaluation; a view flagged asleep whose
  drawn centre moved more than 0.5 mm since then is evaluated again (once per move). A frozen sleeper does not move at all, so RD-05 ("a sleeper does 0 fine
  updates") still holds. This covers travel, coming home, a squishy joining in a place (`settleInPlace`), a ceremony's slide, the mat's re-layout (render offsets)
  and any physics move the shell does not know of. Plus (`later-life.ts afterPartyChange`): a body whose view was re-added under a new id (the mat's re-layout, a
  swap) resets the host's mirror, so the new view is told the truth at the next snapshot (it was left awake, doing fine updates for a sleeper: cost only).
- **Check row (fails before, passes after)**: `_harness/renderview/pg.ts sleepMove()` + `browser_render.mjs` section `pose`, row "B1 (round 5)": three real bodies
  asleep, one moved 1.34 m by `placeAt` and put back to sleep at once (the trip's sequence): HEAD's bodyview (`S/tree_b1pre`) **FAIL** "jelly vs centre +1 frame
  1.342 m, +5 frames 1.342 m"; now **ok** "0.000 m, 0.000 m; still sleepers' fine updates 0". The pose section otherwise unchanged (RD-05 0 fine updates x0.020,
  RD-11 0.000 px, RD-06, MERGE_PC doubt 1 ok). Logs `S/b1render_{b1pre,mine}.log`.
- **The verifier's repro** (`S/scripts/b1ghost.mjs`: ghost.mjs extended; dev hook, three out, every body asleep before each trip, 5 trips home -> cabin -> home ->
  cabin -> home -> cabin, at 1280x800 (wide layout) and 390x844 touch (tall layout); for every body view the distance between its jelly's footprint centre and the
  centre its eyes follow, 1 s and 5 s after arrival): **HEAD** (`S/tree_head`): 10 trips, every one with a sleeper at arrival, jelly vs centre up to **3.656 m**
  (wide cabin arrivals 3.656 / 3.582 / 3.599 m; tall 1.946 / 1.888 / 1.888 m and a HOME arrival 1.412 m); **now** (`S/tree_mine`): 10 trips, 8 with a sleeper at
  arrival, **worst 0.009 m at +1 s and +5 s**; 0 page errors on both. Shots `S/b1ghost_{head,mine}/{wide,tall}_trip{1,2}_{1s,5s}.png` (looked at: HEAD's cabin
  shows the jellies piled at the basket and the eyes and glow floating at the right; now each squishy is whole at its spawn spot).

### B2 notes: the party stays when the play squishy is cut
- `game.ts` (the cutter's `clearMat` dep): with the LIFE host attached, the first cut no longer empties the mat: it calls the host's new `beforeCut()` (every
  untouched whole but the play squishy is asked to `sleep()`: physics refuses one that is not at rest, which the over-budget rule then handles) and returns 0, so the
  cutter says no "went back on the shelf" line. Without the host (the life chunk not landed) the published path runs unchanged.
- The piece cap (SH-03): the cutter's ceiling is `min(PIECE_CEILING, the host's pieceCap())`; `pieceCap()` = min(the tier's pieces cap, the characters cap - (wholes
  - 1)) from LIFE's `CHAR_CAP` while 2 or more wholes are out (the cut squishy counts as its whole), else null: one squishy out keeps the published 64. The refusal
  is the published kind line ("That's a lot of pieces! Reconnect some to keep cutting.").
- The pieces join as one group and Reconnect all gives one whole among the others: the host's syncParty already did this for a party of one; it holds with the party
  (rows below).
- **Rows (node_checks section 13, REAL SoftBody)**: "a cut with a party keeps the party out ..." and "the piece limit with a party ... = 6 on high with 2 out". On
  HEAD's src with these rows (`S/tree_b2pre`): **165/167, both FAIL** (`mat [2,1,1]`, notes "The other squishy went back on the shelf.", maxPieces 64); now **167/167**
  (`mat [2,2,2]`, same item ids, the other squishy a LIFE character throughout, notes only "Cut into 2 pieces.", the same wholes after Reconnect all, maxPieces 6).
  The round-3 row "a cut with LIFE ..." is unchanged and still ok. No published row encoded "the cut empties the mat" with the host attached: node_checks' cutter
  row (its own `clearMat` stub returns 1 and asks for the line) tests the cutter's published contract, which is unchanged, so nothing was re-specified for B2.

### B4 notes
- `src/ui/later-journal.ts` openTravel: a place with `shipped: false` is skipped (no "coming later" section, no line names it); an open postcard carries its chapter's
  "N of M stamps" (done of shown quests of the place's own chapter, `UI_TEXT.stampsOf`). journal.css: the unused `.jn-later*` rules replaced by `.jn-card-stamps`.
- **Re-specified (written reason in the code)**: browser_shell.mjs pg-playthrough "PG Travel sheet ..." asked for "the other eight shown as coming later"; QUESTS 15
  ("a place with shipped: false is not shown at all (no 'coming soon' card)") and QUESTS 7 / PG_VERIFY 7.6 forbid exactly that. It now asks for no unshipped row or
  name and for each open postcard's "N of M stamps" line.

## 3. THE browser run (`S/run_final.sh final1`, tree `S/tree_final` = HEAD f271a93b1 + my lane's files only, port 5366; prod-build and photo's CSP origin 5367)
Started 18:04 UTC. browser_shell's 31 sections (the published ones + pg-playthrough + pg-phone, round 4's list), then trophies_check (game), lock_browser,
photo_check (dev, phone, standalone), b4b_checks. Results below when it ends.

**THE run above did not finish**: the container restarted at about 18:24 (`final1/browser_shell.log`: 130/153 in its first 8 sections, then every later section
"Target page, context or browser has been closed"). Its one real FAIL before the cut: toolbar "Enter on Cut ... the live region says how it works ... the 1.4 s caption
chip" (`live ""`, caption shown false): the same row round 4 classified as load timing (run 3: same values); re-measured in the second engineer's run below.

# Round 5, second engineer (2026-11-17 from 19:35 UTC; HEAD 16f6ba6fc = engineer 1's work committed by the orchestrator; the container had just restarted)
Picked up from the report above (engineer 1 was cut off during THE run). Scratch `S/r2/` (`S` = `.../scratchpad/fix5_shell`). Same method: every probe and browser
run on a snapshot tree (`git archive HEAD` + only my lane's working files). No git write command.

**Result (22:30).** node_checks 167/168 at HEAD -> **170/170** ("Go play with... a ride": the cause was the shell's own aim at a moving seat, fixed with a steadying
hand; the round-4 pass was a false pass; + the budget's wake gate that keeps B7 under its cap). B1 re-proved in the browser (10 trips, 0.039 m). B8 measured: 5 out on
a desktop hide nobody once the budget holds (new browser row); depth rows and the phone's party framing NOT changed (reasons R2.3). **THE run: browser_shell 497/509**
(round 4: 494/497) + trophies 15/15, lock 17/17, photo 23/23, b4b 78/78; its 12 FAILs: 3 known (the caption timing row, the PC's two cut-real rows) and 9 PLAYGROUND
round-5 rows (a bubble's hit area under the new tracker pill x6: fixed in wishes.ts; two Tab walks too short for the new stops x3: re-specified, assertions unchanged).
**Re-run** on the newest HEAD (a8fa3de13, with the DATA lane's latest) + those fixes: 185/186 (the caption timing sibling, measured as load timing in R2.11).
Files of mine this round: `src/shell/later-life.ts`, `_harness/shellview/node_checks.ts` (both committed in a8fa3de13), `_harness/browser_shell.mjs` (pg-home5
committed; the two walks not yet), `src/ui/wishes.ts` (not yet committed), this report.

## R2.0 Baseline at HEAD 16f6ba6fc (`S/r2/tree_head`, `S/probes.sh`, logs `S/r2/base_head/`, one probe at a time, 19:36 to 19:46)
| check | HEAD 16f6ba6fc |
|---|---|
| tsc (snapshot and working tree) | 0 |
| shellview/node_checks | **167/168**: FAIL "Go play with... a ride" (`on the seat after 110 frames, onProp now -1`: lifted onto the swing, off it 2 s later) |
| probe_app | 187/187 |
| probe_gestures | 160/160 |
| probe_merge / probe_trophies | 22/22 / 31/31 |
| probe_playground (quick) | 55/55 (FIX5_DATA's new D-95 row) |
| probe_pg_lifequests | 14/14 (FIX5_DATA's new FM row) |
| probe_life | 117 ok, 1 FAIL (LF-02, PG_LIFE's / FIX5_DATA's) |
| probe_chatter | 42/42 |
| renderview/pg_node_checks | 40 ok, 0 FAIL |
| probe_journal / probe_quests | all passed (28 ok) / all run passed (45 ok, NOT RUN rows: other lanes' code) |
| probe_screens / probe_overlays / probe_uikit / probe_cut | 43/43 / 21/21 / 62/62 / 17/17 |

## R2 steps (updated after every finished item)
| item | what | state |
|---|---|---|
| R2.0 | baseline at HEAD 16f6ba6fc | DONE 19:46 |
| R2.1 | node_checks "Go play with... a ride" (167/168 at HEAD): the real cause is the SHELL's (useRide aimed at a moving seat); fixed in later-life.ts with a steadying hand; the row tightened (ON the seat, not touching it) + 1 new row | DONE 20:00: node_checks 170/170 on my tree; the 3 rows FAIL on HEAD's src (167/170) |
| R2.2 | B7 made robust: the budget's wake gate (later-life.ts applyIntent) + 1 new row (my R2.1 rows changed the history before the B7 window and engineer 1's B7 row then failed, 4 of 24 over the cap: it had passed at HEAD with 2 of 24, its own limit) | DONE 20:05 (same run: B7 1 of 24; the gate row 4.2 % of 144 samples, HEAD 9.0 % and 0 held) |
| R2.3 | B8 Home with 5 out on a desktop (measured: no hiding once the budget holds; a browser row `pg-home5`) and the phone's party of 3 (measured; NOT changed: reasons below) | DONE 20:15 (row ok alone) |
| R2.4 | every node probe on the final tree (`S/r2/tree_final` = HEAD + my 3 files: later-life.ts, node_checks.ts, browser_shell.mjs; logs `S/r2/probes_final/`) | DONE 20:28 (table R2.4) |
| R2.5 | B1 re-proved in the browser on the final tree (the verifier's repro, `S/scripts/b1ghost.mjs`: 5 trips x 2 layouts, every body asleep before each trip) | DONE 20:32: 10/10 arrived, a sleeper at every arrival, jelly vs centre at most **0.039 m** at +1 s and +5 s (HEAD before round 5: 3.656 m), 0 errors |
| R2.6 | THE browser run (`S/r2/run_final.sh final1`, 20:33 to 21:47 for browser_shell; then trophies, lock, photo, b4b) | browser_shell **497/509** (round 4: 494/497); the extras below |
| R2.7 | THE run's PLAYGROUND FAILs fixed: K11 (a bubble's hit area under the tracker pill) in wishes.ts; K04 and keyboard-only "Tab order" walks too short for B3's new stops (re-specified: longer walks, assertions unchanged) | code DONE 21:30; re-run below |
| R2.8 | THE run's extras (same tree) | DONE 22:01: trophies_check (game) **15/15**, lock_browser **17/17**, photo_check (dev, phone, standalone) **23/23**, b4b_checks **78/78** (round 4: 15, 17, 23, 78) |
| R2.9 | the orchestrator committed a8fa3de13 at 20:55 (my R2.1 to R2.3 files + the DATA lane's newest: the ball spot on phones, the cabin re-laid, ballPin): node probes on `S/r2/tree_rerun` = a8fa3de13 + my 2 later files (wishes.ts, browser_shell.mjs) | DONE 22:03: node_checks **170/170**, probe_app 187/187, gestures 160/160, merge 22/22, trophies 31/31, playground 56/56 (the DATA lane's new row), pg_lifequests 14/14, probe_life 117 ok / 1 FAIL (LF-02), chatter 42/42, pg_node_checks 40 ok, journal and quests all, screens 43/43, overlays 21/21, uikit 62/62; tsc 0 |
| R2.10 | the browser re-run on `S/r2/tree_rerun`: toolbar, toolbar-grid, toolbar-sweep, toolbar-k04, keyboard-only (my R2.7 fixes and the timing row), pg-playthrough, pg-phone, pg-home5 (with the DATA lane's newest), console-and-network | DONE 22:26: **185/186** (`S/r2/rerun1/`): every R2.7 row ok (K11 x6 `small []`, K04 x2, "Tab order in play" the whole cycle `... > Hoard > Hand > Squishy > BODY > Next stamp`), toolbar-grid 48/48, pg-playthrough 27/27, pg-phone 9/9, pg-home5 1/1 (worst 2.9 %), console 0 errors; the 1 FAIL is the toolbar caption timing row's sibling ("... the 1.4 s caption chip names it": shown false when read) |
| R2.11 | the caption timing rows measured (`S/r2/scripts/caption.mjs`, three fresh loads of `S/r2/tree_rerun`, Enter on Cut 4 s after Wake, `data-show` watched by a MutationObserver, the page's frame gaps by requestAnimationFrame) | DONE 22:29: the chip shows 110 to 127 ms after Enter and hides at **1437, 3203 and 2693 ms**; the longest frame gap in each load was 1583, 3184 and 2384 ms (SwiftShader, the life chunk and Home's things still compiling). The 1.4 s `setTimeout` (toolbar.ts, unchanged since 2026-10-09) fires on time when the page is free: **load timing**, as round 4 classified it; the toolbar section alone gave 12/13 (the "goes after 1.4 s" row) |

### R2.6 THE run: browser_shell (`S/r2/final1/browser_shell.log`, tree `S/r2/tree_final` = HEAD 16f6ba6fc + later-life.ts, node_checks.ts, browser_shell.mjs)
Per section (ok / FAIL): desktop-boot 18/0, mouse-gestures 19/0, shift-pull 9/0, shift-hint-reflow 3/0, shift-touch 2/0, settings-panel-desktop 15/0, hoard-loop 34/0,
toolbar 12/1, snap-mat 9/0, cut-real 10/2, toolbar-phone 6/0, toolbar-gravity 41/0, toolbar-grid 48/0, toolbar-sweep 26/6, toolbar-k04 4/2, cut-touch 4/0, cut-x 15/0,
fix2-dock 6/0, cut-swell 3/0, cut-low 2/0, hoard-phone 8/0, menu-pause 20/0, fullscreen-gate 3/0, toasts 8/0, modal-layers 4/0, ui-sounds 7/0, keyboard-only 11/1,
prod-build 9/0, **pg-playthrough 27/0, pg-phone 9/0, pg-home5 1/0**, console-and-network 104/0. **497/509** (round 4: 494/497; 12 rows more: the round-5 B rows).
The 12 FAILs, each classified:
- (1) toolbar "the caption chip goes after about 1.4 s": **load timing**, exactly round 4's final-run FAIL (a 1.4 s page timer read after 1.7 s of real time while
  SwiftShader frames take up to 0.5 s); its sibling "Enter on Cut ... caption chip names it" passed this time. Re-run below.
- (2, 3) cut-real "leaving: a quick switch reconnects at once" (`tsw {p:2, x:1}`) and "leaving: hidden 30 s ... over 60 s comes back whole" (`short 3, long 1`):
  **the PC's own on this machine**, identical numbers to round 4 and to the PC's published tree 9211d66ba (round 4's A/B). The same 2 in my cut-real-alone run at 20:10.
- (4 to 9) toolbar-sweep K11 at 390x640, 390x568, 390x460, each with and without the 34 px inset, Hand: `small: ["Ooh, wow! 0x0"]`: **PLAYGROUND's (round 5)**.
  The shot `sweep_fail_390x640_hand.png` shows the bubble over Dollop's head at the top left, its 44 px hit area under the new tracker pill, which took the
  press (the hit-test found the pill: 0x0). wishes.ts's list of HUD boxes a hit area keeps clear of (`CHROME`, R4.12 b) had no play UI. **Fixed**: the play
  UI's slot children and the party popover joined it.
- (10, 11) toolbar-k04 "K04 1280x800 / 390x844: the Tab-only walk at rest is Full screen, Mute, Menu, Hoard, Hand, the squishy": **the walk was too short** (8 Tabs)
  for B3's new stops (pill, its x, "Your squishies" before Full screen: `BODY > Next stamp > Hide the next stamp > Journal > Your squishies > Full screen > Mute
  sound > Menu`). **Re-specified with its written reason**: 12 Tabs; the assertion (from Full screen, exactly the published stops in order, each ring >= 3 px) unchanged.
- (12) keyboard-only "Tab order in play": engineer 1 re-specified its wanted list for B3 but kept 9 Tabs, which end at the Hoard. **Re-specified**: 13 Tabs, the
  assertion (the whole cycle, exactly these stops in order, no other stop) unchanged.
Rows of note: **B6** the first labelled bubble "What's that?" 5 s into the sampling (inside FN-01's window); **B3** wish card, tracker pill (one line, 44 px, clear of the
Journal column), a tap on the pill opens the Journal at H3, the J key, the pill's x, the party popover (one chip per squishy out), the keyboard addressing ("Dollop goes to
play with the Felt Ball."): all ok; **B4** the Travel sheet: Home and the cabin only, each with its "N of M stamps", nothing unshipped listed or named; **B8** the AUTO
chips stand still while a toast shows (jump 0 px); Home with 5 out on desktop (worst 22.7 %, 0/40 over half); **C1** prod-build "SZ-02 (round 5, C1): later-life at
most 150 KB raw: **142.0 KB**" (later-quests 35.3, later-props 25.6), G0b 462 KB gzip of 600; pg-playthrough, pg-phone, pg-home5: 0 console errors, 0 failed requests.

### R2.4 Node probes on the final tree (20:26 to 20:28)
| check | HEAD 16f6ba6fc | final tree |
|---|---|---|
| tsc (snapshot and working tree) | 0 | **0** |
| shellview/node_checks | 167/168 | **170/170** (+2 new rows: the steadying hand lets go, the wake gate; the swing row tightened) |
| probe_app | 187/187 | **187/187** |
| probe_gestures | 160/160 | **160/160** |
| probe_merge / probe_trophies | 22/22 / 31/31 | **22/22 / 31/31** |
| probe_playground (quick) | 55/55 | **55/55** |
| probe_pg_lifequests | 14/14 | **14/14** |
| probe_life | 117 ok, 1 FAIL (LF-02) | **117 ok, 1 FAIL** (LF-02: the data lane's) |
| probe_chatter | 42/42 | **42/42** |
| renderview/pg_node_checks | 40 ok | **40 ok, 0 FAIL** |
| probe_journal / probe_quests | all / all run | **all (28 ok) / all run (45 ok)** |
| probe_screens / probe_overlays / probe_uikit | 43 / 21 / 62 | **43/43 / 21/21 / 62/62** |
The B1 shot `S/b1ghost_r2final/wide_trip1_5s.png` (the cabin 5 s after arrival, three asleep before the trip) was looked at: each squishy whole at its spot, no
jelly left behind, no floating eyes.

B6 in node first (`S/r2/scripts/fn01_probe.ts`: node_checks' FN-01 squeeze on the 1280x800 rig, the stage's `emote` calls timed): LIFE's first bubble (FIRST_PLAY's
question, the first use's notice) comes **6.05 s after the release**, inside FN-01's 16 s; the browser row (engineer 1's, pg-playthrough) decides whether its word
shows on screen.

### R2.1 notes: "Go play with... a ride" (the cause is the shell's; nothing for the DATA lane to change)
- Repro (`S/r2/scripts/ride_probe.ts`: node_checks section 13 up to the row, then the lift logged every 10 frames; logs `S/r2/ride_*.log`). HEAD: the seat still swings
  from the hand row above (x 0.118 m when asked, about 0.29 m amplitude); `useRide` aimed `carryTo` at the seat's pose AT THE MOMENT LIFE's USE intent came; the lift
  takes 1.7 s; the squishy was set down at x 0.157 while the seat had swung to -0.206 (0.36 m away; the seat is a 9 cm capsule): it sat on the seat's edge and
  slid off 1.2 s later (onProp -1).
- **The round-4 pass was a false pass**: the same repro with round 4's swing (`props.ts`, place_hearthlog and places.ts from f271a93b1, `S/r2/tree_ride_old`)
  lands it 0.53 m beside the seat; the squishy stood on the FLOOR leaning on the seat (centre y 0.46, seat stuck at x -0.23), so `onProp` still named the seat.
  The data lane's damping (0.25 -> 0.6) and rider hold changed where the miss ends, not whether it misses. **Message to the DATA lane: nothing to change on your
  side for this row.**
- Fix (`src/shell/later-life.ts` useRide + steadyStep): for a swing the lift aims at the seat's REST spot (thingSpot, pivotY - rope: the spot physics builds the
  seat at) and a steadying hand (physics' own `grabProp` / `dragProp`, the hand that always wins over riders and AUTO, D-95) eases the seat there (a smoothstep of
  the hand's point over 0.3 to 0.8 s, never a snap) and holds it until the squishy has sat on it for 0.3 s after the lift's planned end; it lets go then, on any
  touch of the squishy, 2 s after the lift's end at the latest, on a world rebuild (trip, frame change) or `dropAll`; if the player's hand takes the seat meanwhile
  the steadying hand is theirs (never let go for them). Not used when the player's own hand holds the seat (then round 4's aim, the seat where it is).
- Rows (node_checks section 13): the existing row TIGHTENED with its written reason (riding = ON the seat: centre within 0.15 m of the seat's across the floor and
  above it; the round-4 false pass would fail it) and a NEW row "after a Go play with lift the steadying hand has let go: AUTO turned on swings the seat its arc WITH
  the squishy riding it (on the seat in every sample, within 0.2 m of its centre)". HEAD's src with the new node_checks (`S/r2/tree_pre`): **both FAIL** (centre 0.719 m
  from the seat, onProp -1; on the seat 17/24, 0.739 m off); mine: **ok** (centre 0.000 m, 0.576 m above it; seat range with the rider 0.484 m, 24/24, 0.084 m off).
- Also checked in scratch (not a row: it needs a touch to end the shell's 20 s RIDE flag after a scripted carry off the seat): **AUTO on, the empty seat swinging
  0.43 m, "Go play with" the swing**: the lift starts at once, the seat eases to rest, the squishy lands centred (100 frames), the hand lets go and AUTO's arc comes
  back with the rider on 12/12, at most 0.071 m off centre (`S/r2/ride_mine6.log`).

### R2.2 notes: the budget's wake gate (B7, SH-22)
- Seen with scratch logging (`S/r2/tree_dbg`, `S/r2/nc_dbg*.log`, the B7 window): LIFE's `gateStart` checks the unit cap only when a character STARTS to move; one
  that already holds a mover token keeps it while the over-budget rule puts its body to sleep, and its next SCOOT or HOP woke it straight back (13 intents to
  sleeping bodies in 30 s; over the cap in 270 of 1800 frames). Fix (`applyIntent`): a motion intent (scoot, hop, glide, squash) for a SLEEPING body is held while
  waking it would put the awake units over unitCap + the ride allowance (this frame's earlier wakes count, `wakeClaim`); never for 15 s after the player asked
  that squishy to play (`playWith`). After: 92 of 1800 frames over (the rest are physics' contact wakes, which the over-budget rule then sleeps).
- New row (the same window, the same stepping read 6 times a second): "the budget's wake gate ... held ... over the cap in at most 10 % of samples": HEAD's src
  **FAIL** (0 held, 9.0 %), mine **ok** (2 held, 4.2 %). Engineer 1's B7 row: 1 of 24 over (it allows 2).
- For the DATA lane (information, no change asked): `act.ts gateStart` returns true for a character that already moves (`w.mo[i]`) without the unit check; the
  host now covers that case on its side.

### R2.3 B8: Home with 5 out on a desktop, and the phone's party of 3 (measured; depth rows NOT built, with the evidence)
- **Measured first** (`S/r2/scripts/occl_probe.ts` in node, then `S/r2/scripts/home5.mjs` in the browser on my tree, dev hook, LIFE stepped 40 s, the bodies'
  screen discs from `shell.matInfo` each second): **desktop 1280x800, quality high, 5 out: worst pair overlap 0.8 % of the smaller disc, 0 of 40 seconds over half**
  (`S/r2/home5_mine/desk5_t*.png`: five in the row, every face clear, the lamp and the ball seen between them). The verifier's 80 % came from a run BEFORE the
  awake budget: every body awake and walking its LIFE segments (from its slot to the things, all of which stand behind the row, PLACES 4.1 / D-88), so the outer
  ones crossed behind the others. With B7's budget (engineer 1) and the R2.2 gate, 3 of 5 sleep at their slots and the movers stay near theirs.
- **Why no depth rows**: a back row would stand exactly where Home's things are laid (the pad -0.75,-1.25; the ball 0.85,-0.75; the shelf 0.9,-1.6; the Music Box
  2.25,-1.05, slot units: D-88's spots, the DATA lane's, proved by DT-01 / RD-16 against the row) and would put bodies BEHIND bodies, the thing VERIFY_RENDER_B
  B-M1 removed from the published mat (a 2 x 2 grid hid one squishy behind another; the PC chose the row). Changing the published slot list also moves the
  published mat for everyone.
- **New browser row** (browser_shell section `pg-home5`, desktop, 5 out by the real Hoard sheet, 40 s of LIFE): "B8 Home with 5 out on a desktop: over 40 s of LIFE
  no squishy covers more than half of another on screen (each second), every one in frame". Run alone on my tree: **ok** (worst 22.6 %, 0/40 seconds over half,
  shot `pg_home5_desktop.png` looked at: five faces clear, the lamp and the ball between them, the Music Box behind the right-most squishy). It is in THE run.
- **The phone's party of 3: NOT changed.** Measured (`S/r2/home5_mine/phone3_t*.png`, 390x844): the group box spans x 69..343 (70 % of the width) and y 323..469,
  centred in the band between the top column and the hint pill; the back-right squishy is 47 % behind the play squishy (its face hidden). Making it bigger means a
  tighter framing or a different TALL chevron: both move the PUBLISHED phone mat (B-M1's chevron, its framing rows) and Home's tall thing spots (DATA, DT-01). Proposal
  for the render + data owners together: the TALL chevron's back pair at (+-1.1, -1.8) with the tall things re-laid, then the framing's reach for a tall frame from the
  silhouettes (`t`) instead of the generous `r` (+25 %); not done here.
- **For the DATA lane**: with 5 out on a desktop the Music Box (2.25, -1.05) stands behind the right-most squishy (slot 2.6): Home's spots for 4 and 5 out.

## 4. NOT done / known issues (honest list, updated at the end of round 5 by the second engineer)
- **B8, the phone's party of 3: NOT changed** (R2.3: measured 70 % of the width, centred in the band, the back-right squishy 47 % behind the play squishy). Bigger
  bodies or clear faces need a new TALL chevron and Home's tall thing spots re-laid together (render + DATA; it moves the published phone mat, B-M1); a proposal is in R2.3.
- **B8, depth rows on a desktop: NOT built, on purpose** (R2.3): measured, with the awake budget nobody hides behind anyone (a browser row now checks it, ok);
  a back row would stand on Home's thing spots (D-88) and put bodies behind bodies (B-M1). With 5 out the Music Box stands behind the right-most squishy
  (DATA: Home's spots for 4 and 5 out).
- **B2**: no browser row with a party at the cut (the node rows on the REAL SoftBody prove it, fail before / pass after; the published cut sections start with one
  squishy out, and cut-real alone on my tree gave round 4's exact rows); the kind "It's busy here..." refusal (11.4) is not built (at F = 4 it never triggers once the
  others sleep).
- **B3 parts not built**: "Tap it yourself" (D-93), the party toolbar of focus proxies (11.8: the popover's chips address each squishy instead), Enter on the focused
  squishy opening its card, "Who's coming?" on the Places sheet, the Snap shutter / preview, the Friendship Frame.
- **"Go play with..." latency seen once in scratch**: after a scripted (physics-only) carry off the seat the squishy kept the shell's 20 s RIDE flag (it ends on a
  touch, LIFE_FLAG.RIDE's contract), so LIFE stayed in RIDE and the next PLAY_WITH waited about 10 s; a player's carry is a touch, so this is a harness path, but a
  squishy that FALLS off a ride also keeps RIDE for up to 20 s (contract unchanged; a note for whoever owns D-74).
- **Known flakes / the PC's own** (unchanged from round 4): toolbar "the caption chip goes after about 1.4 s" (load timing), cut-real's two "leaving" rows (identical
  on the PC's published tree), keyboard-only "holding Space squishes" (1 in 5 in round 4; ok this run).
- probe_life LF-02 (lifeStep allocation) stays the DATA / LIFE lane's one failing node row.
- No git write command was run.
