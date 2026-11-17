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

## 4. NOT done / known issues (honest list, updated at the end)
- B8: Home with 5 out on desktop in depth rows (NOT done: see the B8 notes; the hiding comes from LIFE moving bodies along their segments; a two-row slot list puts
  the back row behind the front one at the camera's 0.27 rad pitch, VERIFY_RENDER_B B-M1, which is why the PC chose a row) and the phone's party-of-3 framing (render
  framing of the published mat on every phone; not changed).
- B2: no browser row was added (the node rows on the REAL SoftBody prove it, fail before / pass after); the kind "It's busy here..." refusal (11.4) is not built: at
  F = 4 it never triggers once the others sleep (11.4's own arithmetic), and `beforeCut` asks physics to sleep them (physics refuses a moving one; the over-budget
  rule then takes it).
- B3: not built this round: "Tap it yourself" (D-93), the party toolbar of focus proxies with [ ] inside it (11.8: the popover's chips address each squishy
  instead), Enter on the focused squishy opening its card, "Who's coming?" on the Places sheet, the Snap shutter / preview, the Friendship Frame.
- B6: the word labels are built; whether a bubble shows within 10 s of the first release on desktop is LIFE's (FIRST_PLAY's forced use emits no bubble of its
  own): the final run's B6 row reports it.
