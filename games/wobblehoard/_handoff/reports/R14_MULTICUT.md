# R14_MULTICUT: round 14, the MULTICUT engineer (owner decision D-103: cut several squishies at the same time). No git write command is run.

Owner (2026-11-23, after playing the live build 6c495e9c1): "allow ability to cut multiple squishies at the same time - now i can only cut 1 squishy at a time before being
told to recombine to be able to cut another."
Started 2026-11-23 at HEAD fed9853ab (src identical to the live commit 6c495e9c1). Other engineers edit the same tree (R14_ROOMS and others). Ports 5367 to 5369.
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r14_multicut/` (`S/` below; it can be wiped).

## Status (updated after every finished item; if this file is all you have, its edits are in the tree, unverified unless a row says measured)
| item | what | state |
|---|---|---|
| 0 | read the code, the design below | DONE |
| 1 | baseline of the single-squishy cut (fracs bit for bit) | DONE: `_harness/dump_cut_single.ts`; live baselines in `_handoff/reports/R14_MULTICUT_baseline/` |
| 2 | game.ts seam + later-cut.ts (the party cutter) | DONE, measured: probe_partycut 24/24; single-squishy dump identical to live (host and no host) |
| 3 | LIFE host: a piece group per cut squishy | DONE, measured (probe_partycut M2, M7, M8) |
| 4 | Cut bar: chips (Reconnect one), the budget line shown | DONE, measured by real input on both frames (item 8) |
| 5 | trophies per cut squishy | DONE in node (probe_partycut M15: the evaluator); the binding's feed not yet run in a browser |
| 6 | probe_partycut rewritten for D-103 | DONE: `node _harness/probe_partycut.ts` **27/27** in the shared tree at the end (M16 Minis, M17 tool changes, M18 five out added); 25/25 on the isolated tree (before M17, M18) |
| 7 | measured cost per piece, the budget number | DONE in node (`_harness/measure_partycut.ts`): PARTY_PIECES = 12, see Budget; Chromium numbers come with item 8 |
| 8 | browser check 1280x800 and 390x844, 3 out | DONE: `WH_FROZEN=1 node _harness/browser_cutparty.mjs --port=5367` 16/16 (desk 9, phone 7), 0 console errors; shots looked at |
| 9 | regression list, build size, the published cut browser sections | DONE (sections 7 to 10) |

## The design (D-103), in ten lines
1. **One cutter per cut squishy.** `shell/cut.ts`'s cutter stays what it is: ONE set of pieces of ONE squishy (one cut tree, one neck / join animation, one parting, one
   touch-to-join contact). The play squishy's cutter is the published one, built in `game.ts` on the real body manager: with one squishy out not one line of its path changes.
2. **`shell/later-cut.ts` (new, lazy: it rides in the life chunk) is the PARTY cutter**: it wraps the play squishy's cutter and makes one more cutter (the same `createCutter`)
   for every other squishy out that a stroke crosses, each over a *member view* of the body manager (`body` = that squishy's anchor piece, `identity` = its own genome, tier and
   item id; `promote` / `swapTo` re-point that squishy's own extra record; everything else passes through). `game.cut` IS the party cutter once the life chunk landed.
3. **Who owns a piece:** the anchor piece of a cut party member is the extra that carries its item id (so the mat, the Friends strip and the quick switcher still see it out);
   its other pieces are extras with `piece: true`. A cutter only ever looks at its own piece list, so pieces of different squishies can never merge (touch-to-join, Reconnect
   all and the join groups are per cutter); all pieces are bodies in the same world space, so they push, squish, carry and toss like any body.
4. **The play squishy stays who it was.** Cutting no longer changes who you play with (D-99's `exchange` at the stroke is gone: it existed only because there was one tree).
   The name tag, the history and the HUD stay with the play squishy; the Cut bar speaks for everything that is cut.
5. **A stroke** is offered to every squishy out; each cutter cuts the piece of ITS squishy the stroke passes over most (the published rule), so one stroke across two or
   three squishies cuts every one it crosses, and a squishy can be cut while others are in pieces (each set has its own animation; `busy` only blocks its own squishy).
   Split in two (the keyboard's cut) halves the biggest piece out (a whole counts as 1; ties: the play squishy first), so the keyboard reaches every squishy too.
6. **Reconnect all** runs every cutter's Reconnect all; each squishy goes back together at ITS OWN spot (where it stood when it was first cut; one squishy out: the middle of
   the table, as published). **Reconnect one:** while a party is out the Cut bar shows a chip per cut squishy (its face, its piece count): tap = that one goes back together.
7. **The budget** is the party's: at most PARTY_PIECES live pieces across all cut squishies while two or more are out (the number and its derivation from the measured cost
   per piece at the low tier: section "Budget" below), never more than LIFE's 16 character slots allow (16 - squishies out). One squishy out keeps the published ceiling of 64.
   A stroke that would pass it cuts what fits (the play squishy first, then mat order) and SHOWS why (a toast, also said); never a silent no-op.
8. **LIFE** (`later-life.ts`): a piece group per cut squishy (a map item id -> the slot it had as a whole) in place of the one `cutGroup`; each cut whole gets its CUT touch
   frame (the Journal's CUT records per cut); Float, the crawl, sleep and the awake budget act on every piece as they do today.
9. **Counting per cut:** trophies read each cut squishy as its own stream (`Cutter.sets`), sounds and lines come from each cutter (one cut sound, one "Cut into N pieces.",
   one rejoin per squishy); with several cut the "Whole again." line names the squishy.
10. **Leaving and saves:** `reconnectAll(false)` (a switch, a card, a ceremony, travel, hidden over 60 s) reconnects EVERY set at once; hidden 30 s keeps them all; pieces
    are never stored (a reload is whole). A party member that leaves the mat while cut takes its pieces with it.

## Log

### 1. Baseline (2026-11-23)
- `_harness/dump_cut_single.ts` (new): one squishy, five species (dollop, crimpo, capnap, wisplet, twangle), a fixed script through `game.input` and the Cutter (a mouse stroke, Split in two
  x3, a level swipe, Reconnect all animated, Minis stroke + split + instant reconnect, a cut then hidden 61 s): 61 JSON lines with every share as float64 hex. `--host` attaches the life host.
- The live tree: `git archive 6c495e9c1 games/wobblehoard/src ... | tar -x -C S/live` (read-only git), node_modules linked. Its two outputs are kept in
  `_handoff/reports/R14_MULTICUT_baseline/single_{nohost,host}_live.txt`. The working tree before any edit gave the same two files byte for byte, and the script is deterministic (two runs equal).
- After items 2, 3, 5 (the seam, later-cut.ts, the host's groups): `cmp` of both outputs against the live files: IDENTICAL (no host, and with the host = the party cutter installed).

### 2. What was written (files)
- `src/shell/cut.ts` (additive): deps `name?`, `keepCache?` (and `homeSpot` now also steers the home glide: D-99 sent the anchor to its spot but measured arrival, and steered what travels
  with it, from the middle of the table; with no homeSpot the published expressions run unchanged); Cutter `piecesAfter`, `cutting(b)`, optional `sets`, `reconnect`, `ownerOf`, `budget`; type `CutSetRow`.
- `src/shell/cutText.ts`: `oneAtATime` REMOVED; `partyFull`, `barPartyFull`, `isShown`, `countParty`, `chipLabel`, `chipsGroup`, `wholeOf`, `cutDone(n, style, name?)`.
- `src/shell/bodies.ts`: `ExtraBody.of` (the party member a piece belongs to), `addExtra` takes `of`; `exchange` REMOVED (D-99's device; nothing else used it).
- `src/shell/game.ts` (shared, small): `cutDeps` kept, `let cut`, `wrapCut(make)`; D-99's stroke block, `strokeWhole`, `cutHome` removed (first-play shrinks).
- `src/shell/later-cut.ts` (NEW, lazy): the party cutter (`createPartyCutter`, `PARTY_PIECES`, member views).
- `src/shell/later-life.ts` (shared): import + wrap at attach; `cutGroups` map + `cutSlots` mask in place of `cutGroup`; syncParty per cut squishy (all cut wholes get their CUT touch frame in
  one frame); `beforeCut` skips a whole whose own cut is under way; `addCharAt` removed (its one caller inlined).
- `src/shell/cutBinding.ts`, `src/ui/cutBar.ts`: the count text for several cut squishies, the party's hint line, the budget line shown as a toast (`T.isShown`).
- `src/core/achievements.ts` + `src/shell/achievementsBinding.ts`: `pieces(n, busy, key?)`: a stream per cut squishy.

### 3. probe_partycut re-specified for D-103 (2026-11-23): 24/24
`node _harness/probe_partycut.ts` (the REAL SoftBody, props, LIFE, the life host; the Cut tool by `game.input` like a mouse). The reason for every changed row is written at the top of the file.
D-99's C1 (the crossed squishy becomes the play squishy), C3 ("One squishy at a time" refusal) and C4 are REPLACED (they asserted what the owner asked to remove); C5 and round 12's C6 to C9 kept.
| row | what | measured |
|---|---|---|
| M1 | one stroke across TWO of three | both in 2 pieces (4 in all), the third whole, play squishy unchanged, 2 cut sounds, "Cut Dollop into 2 pieces." + "Cut Crimpo into 2 pieces." |
| M2 | LIFE groups | each cut squishy 1 face piece + 1 chunk under its own group key (the slot it had); the whole one a whole character |
| M3 | cut B while A is in pieces | 6 pieces, three squishies cut, nothing refused |
| M4 | a piece of a non-play squishy pressed, carried, let go | finger on it, lifted 1.41 m, every squishy keeps its pieces |
| M5 | never cross-merge | a piece of Capnap carried into a piece of Dollop (0.94 m -> 0.56 m centres) and held 1.5 s: no join; control: the same drag into its own twin joins |
| M6 | Reconnect ONE | Crimpo whole 0.009 m from its spot, Dollop still 2 pieces, "Crimpo is whole again." |
| M7 | Reconnect all, own spots | three wholes 0.07 / 0.09 / 0.25 m from their spots (one piece had been moved 1 m away first), 1.07 m apart, 3 rejoin sounds, 3 whole LIFE characters |
| M8 | one stroke across all THREE | 2 + 2 + 2, three cut sounds, three LIFE groups |
| M9 | Split in two reaches everyone | three presses cut three squishies |
| M11 | cuts what fits | at 11 pieces one stroke across everything cut ONE more piece (12), refused the rest, said the party's line once |
| M10 | at the budget | Split in two answers 'limit' + the line; a stroke says it once; canSplit false, maxPieces 12 |
| M12 | allocation per frame, 3 cut squishies (12 pieces) | 0 B per 1000 steps of Cutter.update (see below: two real allocations were found and removed) |
| M13 | Float | every one of the 12 pieces rises 0.26 to 0.66 m; Table brings them down |
| M14 | leaving | hidden 30 s keeps 12 pieces; hidden 61 s: three wholes at their spots (0.004 to 0.015 m), nothing stored; a cut member sent to the shelf takes all its pieces |
| M15 | trophies | play + member cut = 2 cuts, 2 joins, a third cut later |
| C5 | one squishy out | the published cut; and the per-step path with the party cutter installed allocates 0 B |
| C6..C9 | round 12's crossings | pass (C6's words lose "no one at a time refusal": there is none any more) |

**Allocation found by M12 and fixed** (new-space growth, LF-02's method):
1. `later-cut.ts` asked `mat.count` every step (the mat filters an array): replaced by an index loop over the extras.
2. `cut.ts list()` returned a NEW one-element array for a whole squishy on every call (`pieces` is read each step by the Cut bar and the trophies in the live build too): now one kept array. 168 B a step -> 0.
3. `cut.ts update()` walked its pieces with `for...of`: with several cutters sharing that code the engine fell back to the generic iterator (an iterator and a result per piece): 544 B a step with 12
   pieces in three sets. Now an index loop: 0 B.
After these three the single-squishy dump is still byte-identical to the live build (no host and host).
Node cost printed by M12: the whole sim step with 3 squishies in 12 pieces (physics + LIFE + the cutters): 2.8 to 3.5 ms on this machine.

### 4. Budget (2026-11-23): PARTY_PIECES = 12, and where the number comes from
`node _harness/measure_partycut.ts` (the real SoftBody, props, LIFE, the host; three out at Home; Split in two to 6, 9, 12 pieces; ms per 60 Hz frame on this machine, median of 5 x 120 frames;
"all awake" = every body nudged every 20 frames, the worst case). The physics is the same at every quality tier (D-101), so this IS the low tier's physics; only the render differs.
| state | bodies | particles | at rest: sim / physics | every body awake: sim / physics |
|---|---|---|---|---|
| 3 wholes | 3 | 1926 | 0.03 / 0.00 ms (all three asleep) | 2.69 / 2.61 ms |
| 3 squishies in 6 pieces (each in two) | 6 | 3852 | 4.80 / 6.61 ms (measured 5 s after the cuts: not asleep yet) | 6.27 / 5.90 ms |
| 3 squishies in 9 pieces (4 + 3 + 2) | 9 | 2898 | 3.08 / 3.16 ms | 5.00 / 4.01 ms |
| 3 squishies in 12 pieces (4 + 4 + 4) | 12 | 1944 | 3.18 / 0.75 ms (11 of 12 asleep) | 2.85 / 3.11 ms |
What it says:
- **The cost of a piece depends on its share, not on the count.** The physics gives a piece of 35 % or more of its squishy the whole's mesh (642 particles; `piece.ts` pieceDetail), a piece of 8 to 35 %
  162 particles, smaller ones 42 or 12. Measured per awake body: a whole 0.87 ms (2.61 / 3); a HALF 0.98 ms (5.90 / 6); a QUARTER 0.26 ms (3.11 / 12), which is exactly LIFE's own weight for a
  piece (attention.ts UNIT.piece 0.26 of a whole, PF-00).
- **The budget:** D-101 already holds a party of three WHOLE squishies awake at every tier (AWAKE_FLOOR 3.81 units; 2.61 ms here). 12 small pieces are 12 x 0.26 = 3.12 units: three squishies each
  in four pieces cost what three whole squishies cost (measured 3.11 against 2.61 ms physics, 2.85 against 2.69 ms the whole sim step). 14 would still be under 3.81, but LIFE has 16 character slots and
  every squishy out holds one (a cut one keeps it as its pieces' group key): pieces <= 16 - squishies out = 13 with three out, 12 with four, 11 with five. So **PARTY_PIECES = 12** (three squishies each
  in four), applied as min(12, 16 - squishies out), at every tier. One squishy out: the published ceiling of 64, unchanged.
- **The cost peak is big pieces, and the count does not bound it (a risk, stated plainly):** three squishies each just cut in two are six bodies with a whole's mesh: 5.90 ms awake in node, 2.3 times the
  three wholes D-101 budgets (2.61 ms), until they rest and fall asleep (they do: 11 of 12 asleep at 12 pieces; the six halves were not asleep 5 s after their cuts). With one squishy cut (the published
  toy, D-99) the same thing costs 2 halves = 1.96 ms; D-103 makes that times the number of squishies cut. With five out on a high-tier device: up to ten such bodies. On the lowest phones (the phone
  factor F of PLAYGROUND_BUILD 14.2, about 3.5 to 4) six awake halves are about 20 to 24 ms of physics for those seconds. Not fixed here. Two ways to bound it, neither built: (a) with a party out, build
  pieces of 35 % and more at the 162-particle detail (a physics change in piece.ts, it changes how halves look and feel); (b) let the LIFE host count a piece with a whole's mesh as a whole in its awake
  budget, so its over-budget rule puts untouched ones to sleep (a LIFE-lane change). A frame-time guard like the mat's (refuse another cut while the frame average is over 30 ms) was considered and NOT
  built: it would bring back the refusal the owner asked to remove, and every software-GL verifier would hit it.

### 5. Later changes (2026-11-23, after the first probe and browser runs)
- **A stroke cuts what the player SEES under it** (`later-cut.ts strokeOwners`): a squishy is crossed when, on some sample of the stroke, one of its bodies is the NEAREST body under the line.
  The first version offered the stroke to every squishy; a squishy wholly hidden behind another was then cut too.
- probe_partycut M7 now starts clean (everyone whole, each cut by its own stroke, its spot noted right before): pieces of one squishy carried onto another's spot (M4, M5) pushed the returning
  whole 0.33 to 0.53 m off them (physics; LIFE also walks the most curious whole over to a fresh cut, LIFE 9). EDGE, not handled: a squishy whose own spot is covered by ANOTHER squishy's pieces when
  it goes back together appears on its spot and is pushed off those pieces by contact.
- M16 added: Minis with two squishies cut (each its own minis, the style locked while cut, Reconnect all at own spots).
- **The Cut bar (looked at on 1280x800, `_harness/_renders/cutparty/multicut_two_desk.png`, `multicut_budget_toast_desk.png`):** the chips row reads well ("Reconnect one" + a chip per cut
  squishy: join mark, face, name, count), between the hint line and the buttons. Two things changed after looking: the count "2 squishies, 4 pieces" made the hint wrap to two lines, so the count is
  the plain "4 pieces" again (the chips say whose); the budget hint is shorter ("12 pieces is the most at once. Reconnect one to cut more."). The budget TOAST was not in the first shot (taken 3 s
  later than the toast lives): the harness now takes it 0.35 s after the stroke.
- First Chromium numbers (1280x800, quality low, this container): three squishies in 4 + 4 + 4 pieces: physics step 2.46 ms at rest (3 asleep, 1134 of 1620 particles awake), **4.53 ms with every
  piece awake** (Float on). (The yardstick, three whole squishies awake in the same Chromium, is measured in the second run.) The whole frame in software WebGL is 432 ms here and says nothing about a device.

### 6. Browser, real input, both frames (2026-11-23): 16/16
`WH_FROZEN=1 node _harness/browser_cutparty.mjs --port=5367` (the dev page frozen: other lanes edit the tree). The file's D-99 rows are RE-SPECIFIED for D-103 (the reason is written at the rows:
they asserted "the crossed squishy becomes the play squishy" and the "One squishy at a time" refusal); the two D-98 rows are unchanged and pass.
Three out at the LOW tier (the Friends strip's Bring friends, real taps), then on 1280x800 (mouse) and 390x844 (touch by CDP):
| row | desk | phone |
|---|---|---|
| a stroke across a squishy that is not the play one cuts THAT one; the play squishy (the name tag) stays who it was and whole | ok | ok |
| a stroke across the play squishy cuts it TOO (2 + 2); nothing refused; the bar counts "4 pieces" and shows a chip per cut squishy, on screen, 32 px high | ok | ok |
| a real tap on a chip reconnects ONLY that squishy, where it stood (0.002 m); the chips row goes when one squishy is cut | ok | ok |
| after Reconnect all, ONE straight stroke across the three cuts all three (they line up on both frames) | ok | ok |
| Split in two by real presses up to 12 pieces (4 + 4 + 4); the Split button is off with the reason in the bar; one more stroke cuts nothing and SHOWS the toast | ok | ok |
| Reconnect all: three wholes, all out, the play squishy who it was | ok | ok |
| 0 console errors / warnings / failed requests | ok | ok |
**The frame cost at the low tier with 3 squishies each in 4 pieces** (Chromium on this container, quality low, `matStepCost`: the physics of every body per 60 Hz frame; other jobs ran beside it, so +-1 ms):
4.4 to 5.7 ms with EVERY piece awake (Float on; 1620 to 2100 particles awake over three runs: 4.53, 4.43, 5.74 ms), 2.5 to 5.0 ms at rest (2 to 4 of the 12 asleep when measured 4 s after the last
cut). In node (item 4's table): 3.11 ms physics / 2.85 ms the whole sim step all awake; 0.75 ms physics at rest with 11 of 12 asleep. Three WHOLE squishies awake: 2.61 ms node. With the phone factor of
PLAYGROUND_BUILD 14.2 (F about 4) that is roughly 12 to 18 ms of physics on a low-end phone while all twelve pieces are awake, against D-101's 10 to 12 ms estimate for three wholes: an ESTIMATE, not
measured on a device. The render cost cannot be judged here (software WebGL: 430 to 620 ms a frame at any content).
**Screenshots, judged as a product designer** (`_harness/_renders/cutparty/multicut_{before,two,one_stroke,budget_pieces,budget_line,budget_toast,whole}_{desk,phone}.png`):
- 1280x800, two cut (`multicut_two_desk`): the bar reads top to bottom: the hint and "4 pieces", then "Reconnect one" with a chip per cut squishy (join mark, face, name, count in amber), then the
  buttons. Clear at a glance; nothing overlaps the squishies. Fixed after looking: the first count text "2 squishies, 4 pieces" pushed the hint onto two lines; it is "4 pieces" again.
- 1280x800 at the budget (`multicut_budget_toast_desk`): the toast at the top centre says why; the bar's one-line hint says it again beside "12 pieces"; Split in two is visibly off (dashed), three
  chips. Good.
- 390x844 (`multicut_two_phone`, `multicut_budget_toast_phone`): the chips row sits above the icon buttons: join mark, face, count (no names: they would not fit five chips; the name is the chip's
  accessible name and tooltip). Three chips fit on one line with room. The toast sits under the top buttons. Weaknesses I see: on the phone a chip's meaning rests on the join mark alone (the same mark
  as Reconnect all, no word); freshly cut halves rest flush, so right after a stroke the seams are faint on some species (published look); the three squishies stand close and overlap at Home, so a
  stroke "across one" often crosses a neighbour too (it cuts what it visibly crosses, by design).

### 7. The regression list (2026-11-23), on an ISOLATED tree: the live commit + D-103 only
Other round-14 lanes are mid-work in the shared tree (rooms, carry: places data, softbody, gestures, driver, stage ...; `tsc` there shows their `src/ui/later-room.ts(88)` error, and
shellview/node_checks there is 174/186 with 11 reds in place framing, thing taps, carry and gusts, none of them the cutter's). To see what D-103 ALONE does, the list ran on
`S/iso`: `git archive 6c495e9c1` (src, public, _harness, configs) + this lane's files copied in (cut.ts, cutText.ts, cutBinding.ts, bodies.ts, achievementsBinding.ts, lifeLink.ts, debugHook.ts,
core/achievements.ts, later-cut.ts, ui/later-cutchips.ts, ui/cutchips.css, the probes) + this lane's hunks applied to the live game.ts, later-life.ts and later-play.ts. `tsc` clean there.
| probe | result on live + D-103 | note |
|---|---|---|
| dump_cut_single (no host / host) | byte-identical to the live outputs | (g): one squishy out, counts and shares bit for bit |
| probe_partycut | 25/25 | re-specified for D-103 |
| shellview/node_checks | 186/186 | one row re-specified (the party piece limit: SH-03's 6 -> the party's budget 12, reason at the row); the flaky Shake Pine row passed this time |
| probe_app | 188/188 | |
| probe_gestures | 160/160 | |
| probe_cut | 17/17 (146 s) | |
| probe_float | 16/16 | |
| probe_party | 10/10 | |
| probe_crawl | 14/14 | |
| probe_playground (quick) | 74/74 | |
| probe_life | 127 ok, 1 failed: LF-02 | the known red |
| probe_quests | all run checks passed | |
| probe_journal | all passed | |
| probe_pg_data | DT-18 red | the known red |
| probe_r8_features | 9/9 | |
| shellview/cut_mock_checks, cut_checks | 48/48, 16/16 | the cutter's own unit rows |
| shellview/cutter_checks | 117/119: X12 (a piece's mesh volume within 3 % of its share: worst 14.93 %), U04 (24 pieces cost 1.54 x two wholes, bar 1.5) | not on the round's list. The LIVE tree (6c495e9c1 alone, same machine) gives the same 117/119 with the same two reds (X12 worst 14.93 %, U04 2.11 x): they predate this round |
| probe_life_selfuse --su4-only | all passed: SU-04 24 of 24, SU-05 none | 805 s |
In the SHARED tree (all lanes): probe_partycut 25/25, probe_party 10/10, probe_float 16/16, probe_crawl 14/14, cut_mock_checks 48/48, cut_checks 16/16, dump_cut_single identical to live (both).

### 8. Build and size (2026-11-23)
- **D-103 alone** (the isolated tree, `vite build` exit 0), against the live build's `dist` (6c495e9c1, T1 2111.1 KB, first-play 475,095 B gzip):
  first-play gzip **+95 B** (475,190 B; `index.js` is 56 B SMALLER raw: D-99's stroke block, `strokeWhole` and `bodies.exchange` left the first-play code, the `wrapCut` seam and `ExtraBody.of` came in);
  the whole build **+11.2 KB** (T1 2122.3 KB of 2250): `later-life` +8.1 KB raw / +3.0 KB gzip (the party cutter rides in the life chunk), `later-play` +2.0 KB js and +1.1 KB css (the chips).
- **The shared tree with every round-14 lane** (`vite build --outDir S/dist_shared`, the game's own `dist` left untouched): exit 0, first-play 464 KB gzip, T1 2134.5 KB of 2250.
- `npx tsc --noEmit -p tsconfig.json`: clean on the isolated tree and, at the end, on the shared tree (earlier in the round another lane's `src/ui/later-room.ts` had an error there for a while).

### 9. The published cut browser sections, on the isolated tree (live + D-103 only), 2026-11-23
`WH_FROZEN=1 node _harness/browser_shell.mjs --port=5368 --only=cut-real,cut-touch,cut-x,fix1-join,fix1-split,fix1-leave,fix2-blade,cut-swell,cut-low` (the live commit's own harness file, unchanged):
**41/43**. cut-touch, cut-x, fix1-join, fix1-split, fix1-leave, fix2-blade, cut-swell, cut-low: all pass. cut-real: 2 FAIL:
- "leaving: a quick switch reconnects at once": the `]` key did not switch (the identity stayed, the 2 pieces stayed);
- "leaving: hidden 30 s keeps the pieces; hidden over 60 s comes back whole": a consequence of the first (the squishy was still cut, so the next cut made 3 pieces: 3 / 3 / 1 where the row wants 2 / 2 / 1).
The LIVE build fails the same two rows the same way: section 10.

### 10. The two cut-real reds are the live build's own (2026-11-23)
The same section on the untouched live tree (`S/live`: `git archive 6c495e9c1`, `--only=cut-real`, the same machine): **10/12, the same two rows red with the same values** (the `]` key did not
switch: id unchanged, pieces 2, extras 1; then 3 / 3 / 1). So with D-103 every published cut browser row gives what the live build gives: 41/43, the 2 reds are older than this round (not looked
into here: a quick switch by `]` right after a cut, in this section's state).
Also at the very end, in the SHARED tree (all lanes): `tsc` clean; probe_partycut 27/27; `dump_cut_single` without the host byte-identical to live; WITH the host it now differs from live in 9 of 60
rows (the same piece counts everywhere; shares and centres differ from the sixth step of a script on, after three Split in two presses) while the isolated tree (live + D-103) is byte-identical:
the difference comes from the other round-14 lanes' changes to how pieces move with LIFE at Home (softbody.ts, life/brain.ts, the Home room rule), not from the cutter. The final verifier's
comparison against 6c495e9c1 will see that unless it compares D-103 alone.

## What is not done, or risky (read this before shipping)
1. **The cost peak of big pieces is not bounded** (section 4): a piece of 35 % or more of its squishy has a whole's mesh and costs a whole. Three squishies each just cut in two: 5.90 ms physics all
   awake in node against 2.61 ms for three wholes; with five out, up to ten such bodies. They fall asleep at rest. The count budget (12) bounds small pieces only. Two fixes are named in section 4;
   neither is built. Nothing was measured on a real phone; the render cost cannot be judged in software WebGL.
2. **Split in two with a party out** now halves the biggest piece OUT (so the keyboard can cut every squishy): pressing it again and again cuts each friend in turn before it quarters anyone.
   With one squishy out it is the published button.
3. **A squishy's own spot covered by another squishy's pieces**: it comes back on its spot and contact pushes it off them (seen 0.33 to 0.53 m in a deliberately messy probe state).
4. **Not run:** a capsule or merge ceremony, travel, a quick switch and a Hoard card with SEVERAL squishies cut (they all go through `leaving()` -> `reconnectAll(false)`, which M14 runs by the hidden-tab
   path; cut-real runs the ceremony and the Hoard with one cut); Shift lock on a piece of a non-play cut squishy; the trophies' feed in a browser (M15 runs the evaluator alone); four or five out in a
   browser (M18 runs five out in node); the whole browser_shell (only the cut sections); places other than Home with several cut (C8 runs the cabin with a party, not several cut there).
5. `bodies.exchange` (D-99's device) is REMOVED, and D-99's rule 1 with it: cutting no longer makes the crossed squishy the play squishy. Anything outside this lane that relied on that would break
   (nothing in src or _harness did).
6. `list()` in cut.ts now returns ONE kept array for a whole squishy and `update()` walks its pieces by index: both are in the published cutter's own code (the single-squishy dumps and probe_cut,
   cutter_checks, cut_checks, cut_mock_checks say nothing changed, but it is published code that was touched).
7. Two reds that predate this round and stay: cut-real's quick switch row (and the hidden-tab row after it), cutter_checks X12 and U04 (the same on the live tree).
8. The life chunk grows by 8.1 KB raw (3.0 KB gzip) for the party cutter; it could be its own chunk fetched when a second squishy comes out.

## Files (this lane)
New: `src/shell/later-cut.ts`, `src/ui/later-cutchips.ts`, `src/ui/cutchips.css`, `_harness/dump_cut_single.ts`, `_harness/measure_partycut.ts`, `_handoff/reports/R14_MULTICUT_baseline/`.
Changed: `src/shell/cut.ts`, `cutText.ts`, `cutBinding.ts`, `bodies.ts`, `achievementsBinding.ts`, `lifeLink.ts` (a comment), `debugHook.ts` (`cutSets`, `cutReconnect`), `src/core/achievements.ts`;
shared, small hunks: `src/shell/game.ts` (the `wrapCut` seam; D-99's stroke block out), `src/shell/later-life.ts` (the import, the wrap at attach, `cutGroups`, syncParty, `beforeCut`, `pieceCap`),
`src/ui/later-play.ts` (attach the chips); probes: `_harness/probe_partycut.ts` (re-specified), `_harness/browser_cutparty.mjs` (re-specified), `_harness/shellview/node_checks.ts` (one row
re-specified); spec: D-103 appended at the end of `_spec/PLAYGROUND_BUILD.md`.
Nothing of this lane is left running (ports 5367 to 5369 free).
