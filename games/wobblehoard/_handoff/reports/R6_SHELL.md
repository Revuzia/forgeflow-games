# R6_SHELL: round 6, the SHELL lane (src/shell, src/ui, src/input, vite.config.ts, the shell harness; port 5366). No git write command is run.

Brief: the orchestrator's round-6 task (SESSION3.md machine rules; owner decisions D-95 revised and D-96 at the end of `_spec/PLAYGROUND_BUILD.md`).
No earlier R6_SHELL report existed: this is the first round-6 shell engineer. Started 2026-11-18 04:30 UTC at HEAD 861665740 (live = 23c684a60).
Read first: R6_DATA.md (D-96 tombstones, the SQUIRT seam, tall layouts), R6_PHYS.md (ice / wet grip / soaked-density `world.mods(body)`, surf, gusts,
the guard), PG_SHELL.md R4b.5 (why the three were not opened), FIX5_SHELL.md, VERDICT_PG2 (B5, B8 phone leftovers).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r6_shell/` (`S/` below).
Method: every probe and browser run on a SNAPSHOT tree (`S/mk_tree.sh`: `git archive HEAD` + the other lanes' working files frozen at a moment they
typecheck (`S/freeze_others.sh`, list in `S/others.txt`) + my lane's working files), so another lane's half-made edit never reaches my runs.
At the start the frozen others were the DATA lane's 11 finished files (R6_DATA "Final numbers"); RENDER round 6 works in parallel on src/render.

## Status (updated after every finished item)
| item | what | state |
|---|---|---|
| 0 | baseline on `S/tree_base` (HEAD + the DATA lane's finished working files), one probe at a time | DONE 04:52 (table below) |
| 1 | D-96 in the shell: no chunk, button, list row or text for the three dropped places; vite.config.ts stops emitting their chunks | DONE 05:10 (node + build; the browser half, an old save naming them and every sheet's text, runs in item 2's place sections) |
| 2 | open Ripple Shore, Frostbell Ridge, Rainleaf Garden for real (+ scripted browser playthrough of each, 1280x800 and 390x844) | IN PROGRESS: wiring written (section 2), exploring in the browser on a scratch tree with the data flip (`S/flip.sh`) |
| 3 | phone leftovers: the Felt Ball over the squishy at Home; the cabin rocker under the hint pill (the hint pill counted in the HUD insets) | DONE 06:13 for the rocker (clear of the hint pill by 28 px); the Felt Ball NOT fixable in the shell (still over Dollop's lower right by about 25 px): needs RENDER's framing or DATA's one-out spot (section 3) |
| 4 | one browser run: the published sections + pg-playthrough + pg-phone + the new place sections, against the last run (497/509) | RUNNING since 06:14 (`S/run_final.sh final1` on `S/tree_final` = HEAD + the other lanes' 24 working files frozen at 06:14, the live tree typechecking, RENDER's included + mine + the three flipped) |

## 0. Baseline (`S/tree_base` = HEAD 861665740 + the DATA lane's 11 working files; `S/probes.sh`, logs `S/base/`, one probe at a time, 04:36 to 04:52)
| check | tree_base |
|---|---|
| tsc | 0 errors (2.2 s) |
| probe_app | 187/187 |
| shellview/node_checks | 171/171 (106 s) |
| probe_gestures / probe_merge / probe_trophies | 160/160 / 22/22 / 31/31 |
| probe_playground (quick) | 73/73 (42 s; PG_PHYS round 6's rows included) |
| probe_pg_lifequests | 16/16 |
| probe_life | 121 ok, 1 FAIL (LF-02, the DATA / LIFE lane's known row) |
| probe_chatter | 42/42 |
| renderview/pg_node_checks | 40 ok, 0 FAIL |
| probe_journal / probe_quests | 29 ok (all) / 46 ok, 3 NOT RUN |
| probe_pg_data | 40 ok, 3 FAIL: DT-01 Home B5 (the Felt Ball on a phone: "needs RENDER"), DT-01 the cabin tall rocker under the hint pill (618 px), DT-01 Cloudloft tall spawn (DATA's, owner's call) |
| probe_screens / probe_overlays / probe_uikit | 43/43 / 21/21 / 62/62 |

## 1. D-96 in the shell (DONE 05:10)
- **What the shell still shipped of them**: nothing by name (grep of src/shell, src/ui, src/input and the shell harness: 0 hits; the Travel sheet, the Journal and the
  play UI all read PLACE_INFO / QUESTS, where the DATA lane left 7 rows and tombstones). Two shell lines still COMPUTED with a dropped place's index:
  (a) `ui/later-journal.ts` the gift card took "the next place" as `chapter.place + 1`, so Rainleaf's finale gift (chapter 4) named idx 5, the dropped Fizzwell Tub
  (shown as "Three new friends for you." only because it is unshipped): it now reads `CHAPTERS[c].giftPlace` (R6_DATA request 2; Rainleaf's gift loves Lanternroof, 7);
  (b) the Keepsakes pane filled each "From ..." line with `placeName(bit + 1)` (the NEXT place); R6_DATA's lines name their own place now, so the line is shown as
  written (R6_DATA request 3).
- **vite.config.ts**: the dropped places' modules are gone (R6_DATA), so no `later-place-fizzwell|cogwhistle|echohollow*` chunk is emitted any more (the build of
  `S/tree_base`: 45 chunks, none of theirs; their ids appear only as the lower-case tombstones of PLACE_IDS / THING_KINDS in `later-shared`). NEW guard so it stays
  that way: `droppedPlaceLeaks(bundle)` in sizeBudget's generateBundle FAILS the build when a chunk is named for a dropped place, holds one of its modules
  (`src/data/place_<id>.ts`, `src/audio/places/<id>.ts`, `src/render/places/<id>.ts`) or carries its player-visible name ("Fizzwell", "Cogwhistle", "Echo Hollow") in
  a chunk or the page. **A/B**: the build of 4225da645 (before R6_DATA's deletions) with this vite.config.ts **fails** ("[D-96] the build would ship a dropped
  place: later-journal-text names "Fizzwell"; later-place-cogwhistle-data: a chunk named for a dropped place; holds src/data/place_cogwhistle.ts; ..."); the build of
  my tree passes (G0 2410 KB of 3072, G0b 462 KB gzip of 600: unchanged).
- probe_app **188/188** (+1: "D-96 (round 6) the build guard": a clean bundle with the tombstone ids passes; a dropped chunk name, module or visible name fails).
- **The brief's rule "a save that already holds a stamp, wish or fact of a dropped place must still load"**, in the shell (06:22, node_checks, new row): probe_journal
  CO-13's blob (the three in its places, visits, keepsakes, song places, a wish for Fizzwell, a gift row, the current place Echo Hollow, done T1 / W3 / E10) under
  the journal key of a fresh app: the LIFE host attaches with no error and no console.error; its open places 0b111 and the journal view's places 0b111,
  keepsakes 0b11, 3 stamps; no line names a dropped place; `travel('fizzwell')` and `travel('echohollow')` are refused even on the dev path; the party at Home.
  The Places sheet and the Journal read PLACE_INFO / KEEPSAKE_TEXT, where the three are not (the browser rows check the sheet's text).

## 2. Opening Ripple Shore, Frostbell Ridge, Rainleaf Garden (IN PROGRESS; notes kept as I go)
- **The flip is the DATA lane's line, not mine**: `shipped: true` for the three in `src/data/places.ts` PLACE_INFO and in each `place_<id>.ts`. Everything is
  tested on scratch trees where `S/flip.sh` makes exactly that edit (the patch is in section 5 for the orchestrator). With it, nothing else in src/data is needed.
- Wiring written in `src/shell/later-life.ts` (life chunk): the SQUIRT (LIFE_EV.SQUIRT: a quiet splash at the squirter + the render's `squirtFx`, R6_RENDER's seam);
  the soaking foam's density (`world.mods(body)[4]`, 10 Hz, slow rise and marshmallow only, never at Home); the weather (each gust zone driven by LIFE's
  `lifeGustOn` through `world.setGust`; the bed hears a gust, a wave and the rain's on / off through `setAmbience({ weather })`); the Shake Pine (its branch's
  strike, a body's bump or the player's tap = a poke on the branch, drops the snow puff: snow +0.5 with the pine as source on anyone within 0.7 m, its puff);
  the Snowball's +0.3 snow on whoever it rolls into; the place open line also SHOWN (a moment), at runtime and for the places a load opens quietly (the save's
  `pl` before the attach vs after); dev view: `selfUsed`, every part's screen point, a squishy's density, looks and screen point, each thing's set spot.
- `src/ui/later-play.ts`: the tracker pill points the way: at Home (or where the place's own chapter has nothing to do now) an open, never-visited place's VISIT
  quest comes first ("Next: Sand and sea"), and its tap opens the Places sheet (`openTravel`, boot.ts); moments can be shown without being said twice.
- `src/ui/later-journal.ts`: the postcards' "N of yours love it" (owned species whose favourite place, F1, the player has found).
- **Postcards** (R6_RENDER request): the Places sheet's sky band is a `<canvas class="jn-sky">` drawn by `render/postcard.ts` `drawPostcard` (lazy, its own
  `later-postcard` chunk: vite.config.ts names it and lists it lazy-only); the CSS gradient stays behind it as the fallback.
- **The hint pill in the HUD insets** (item 3, written early because the S2 front bands need it too): `hudBinding.ts reportInsets` counts the pill wherever it
  hangs at the bottom (its LAYOUT box: `offsetTop`, so its 8 px show / hide slide never moves the framing; a ResizeObserver follows its one / two lines).
- Exploration (scratch scripts `S/explore*.mjs`, the dev hook, desktop): the open lines show at load ("Ripple Shore is open. Find it in Places." x3, said once,
  shown in the moments slot), the pill "Next: Sand and sea" opens the Places sheet, the postcards "N of yours love it" ("1 of yours love it" on Frostbell after
  I10), R3 done by three shell taps, R1 / I1 / G1 by the trips, I2 / I10 by LIFE, a glide on the Ice Pond (I3 1/2) by LIFE. Found: a carry let go over a floor
  spot lands IN FRONT of it (the carry plane is not the floor), so the harness steers the carried body over the target by feedback (`carryOnto`).
- **NEW browser sections** `pg-places` (1280x800) and `pg-places-phone` (390x844) in `_harness/browser_shell.mjs` (they run only on a build that ships
  the three; else "not run" with the reason): a save of 28 stamps (load 2), the open lines, the pill, the sheet (five postcards, drawn, no dropped name),
  three out (rseed 59: Wisplet the marshmallow), then per place: the trip by the sheet, 90 s on their own (>= 3 different things used), two quests by the
  player's own input (Ripple R3 + R9, R7 the squirt; Frostbell I9 + I7, I4 the pine; Rainleaf G7 + G4, the Leaf Teeter's AUTO chip), home by the sheet.
- node_checks: 4 new rows (the dev path, REAL physics): Ripple's waves heard by the bed; Frostbell's gusts driven from LIFE's clock and heard;
  the Shake Pine tap's snow puff; Rainleaf's rain envelope heard on / off. **First run (05:50, tree_mine): 172/175**: the waves and gusts ok; two of my rows
  wrong in the ROW, not the host: (a) the host hands the bed ONE reused params object (zero allocation), so the recorded references all read the last
  weather ([0, 0]): the rows now read the weather at each call; (b) the pine row measured slot 0 while it had moved the play body, and the body's own bump puffed
  first (one puff a second): it now sets the play body 0.45 m in front of the branch, waits 1.5 s, measures that body. And ONE PUBLISHED ROW REGRESSED:
  "Go play with... (VERDICT_PG2 N1)" (ok at baseline): in the cabin the Snug Basket's squishy never started its walk. Cause: my block (three trips, ~100 s of
  sim) ran BEFORE it and changed the state it starts from; my block now runs after every published row. **Re-run (05:56): 175/175** (171 published + 4 new;
  the pine: snow 0.20 -> 0.71 on the body under the branch, its puff drawn, USE SHAKE + SNOWCAP recorded; the rain: weather [1, 0]; the N1 row ok again).
- **Run 1 of `pg-places` (desktop, tree_flip, stopped by me after 7 rows at 05:46 to fix what it showed)**: ok: the Places sheet (five postcards drawn, no
  dropped name, "Go to" on the three, "0 of 10 stamps"), Ripple's arrival (party of three, wide layout, R1), R3 by three shell taps. FAIL: (1) the open
  moments: the pill showed in the 200 ms gap between two queued moments (fixed in later-play.ts: not while a moment is queued); (2) on their own in 90 s
  only the Pebble Ball was used (then all three napped in a pile); (3) R9: the harness's straight-up lift never carried (`carried: false` twice): the
  carry now lifts up and 60 px sideways like the published carry. Checked (`S/dbg.mjs` at Ripple after 240 s): the press holds the body (fingers 1) and a
  straight lift does carry it after about 225 px; what failed afterwards was the steering: lifted to the top of the frame the pointer had no room left to
  take the body BACK (the Sand Mound is at the back: 1.03 m short). `carryOnto` now lifts only until physics carries the body (at most 453 px), then steers. Screens judged: Home with the pill, the sheet (desktop: the sheet ran
  to the bottom with an empty half: `height: auto` on wide layouts, in journal.css, was not yet in that tree), Ripple on arrival and after the stay
  (a good scene; the three asleep in a pile in the middle of the beach after 90 s).
- **Why so few things are used on their own (measured, `S/dbg.mjs`)**: LIFE's B04 starts a use by itself only on a BALL or, for a family whose ice grip is
  under 0.5, an ICE patch (`brain.ts useCandidate`: "pads, chimes, pools, turntables: S2 / S3, not built"), at most `USES_FULL` = 2 a visit; a wander
  never targets a thing's footprint (`freeTarget` / `clearOfThings`), so a pool is waded only when a path crosses it; the rest come from social moments
  (a peek round the Driftwood Log, a ball pass, a teeter), bumps (a chime, a pad, the pine) and zones. Counted now: USE, a REACT naming the thing, and a
  social moment played around it (`selfSocial`, new in the dev view); the stay is up to a 5-minute visit (LF-09's visit), stepped 10 s at a time.
- **Measured on the host with the real physics and LIFE, no input, 300 s at each place** (node, no rendering: `tree_flip/_harness/shellview/scratch_selfuse.ts`,
  node_checks section 13's rig; party Dollop + Wisplet + Chunkle, the browser sections' party):
  | place | different things used on their own in 300 s | first seen (s) | asleep |
  |---|---|---|---|
  | Ripple Shore | **1**: the Pebble Ball | its USE 20, a PASS 50 | 29 % |
  | Frostbell Ridge | **3 by 50 s**: the Snowball, the Snowdrift Nest, the Steam Pool | USE + snow 30; a nap in the nest (USE NAP) 50; a wade / warm REACT 50 | 29 % |
  | Rainleaf Garden | **2**: the Splash Spots, the Seed Pod | a wade 10; USE 40; a PASS 80 | 23 % |
  More parties (same rig, 300 s each; `S/selfuse_b.log`):
  | party (with Dollop) | Ripple Shore | Rainleaf Garden |
  |---|---|---|
  | Puddlo + Boingle | 1 (Pebble Ball) | 2 (Seed Pod; a SHOWER under the Drip Leaf in the rain at 290 s) |
  | Gloopsy + Kneadle (two Ripple fans) | 2 (+ a wade in the Rock Pool at 180 s) | 1 (Seed Pod) |
  | Fossilo + Puddlo | 2 (+ a wade at 10 s) | 1 (Seed Pod) |
  | Capnap + Burrbin | 2 (+ a wade at 210 s) | 1 (Seed Pod) |

  Frostbell Ridge with the same four parties: 3 things by 100 / 90 / 80 / 60 s (4 to 5 by 300 s: the Snowball, the Steam Pool, the Snowdrift Nest, a glide on
  the Ice Pond, the Icicle Bells bumped), so 5 of 5 parties pass there.
  The browser (desktop, `S/dbg.mjs`, 240 s at Ripple, the sections' party): the same, the Pebble Ball only (its USE at 30 s, a PASS at 50 s).
- **So, by the brief's rule, Ripple Shore and Rainleaf Garden do not hold up on "the squishies use at least three different things on their own" and stay
  closed; Frostbell Ridge does (3 by 50 s).** The exact reason is LIFE's, not the place's data or the shell's: B04 (`src/life/brain.ts useCandidate`)
  starts a use by itself only on a ball, or an ice patch for a family whose ice grip is under 0.5, at most `USES_FULL` = 2 a visit ("pads, chimes, pools,
  turntables: S2 / S3, not built"); B03's wander never targets a thing's footprint (`freeTarget` -> `clearOfThings`, 0.4 m keep-out). At Ripple that leaves
  the Pebble Ball (and a wade when a path happens to cross the Rock Pool); the Shell Chimes, the Driftwood Log, the Sand Mound and the Bob Ring are the
  player's. At Rainleaf the Seed Pod and the Splash Spots; the Moss Bouncer, the Leaf Teeter and the Stepping Stones are the player's, the Drip Leaf's
  shower too unless one stands under it in the rain. src/life is the DATA lane's this round (R6_DATA's scope line): request in section 5.
  Patches: `_handoff/reports/R6_SHELL_open_frostbell.patch` (the one place that holds up) and `R6_SHELL_open_s2.patch` (all three, if the owner takes
  Ripple and Rainleaf as they are); both `git apply --check` clean against the working tree.

## Node probes after my changes (06:20; one at a time)
| probe | tree_base (baseline) | **tree_mine** (my lane, no flip) | tree_flip (+ the three shipped) |
|---|---|---|---|
| tsc | 0 | **0** | 0 |
| probe_app | 187/187 | **188/188** (+1: the D-96 build guard) | 188/188 |
| shellview/node_checks | 171/171 | **176/176** (+5: waves, gusts, the Shake Pine, the rain; 06:22: a save naming the three dropped places loads in the host) | 175/175 (before the D-96 row) |
| probe_gestures / probe_merge / probe_trophies | 160 / 22 / 31 | **160/160 / 22/22 / 31/31** | the same |
| probe_screens / probe_overlays / probe_uikit | 43 / 21 / 62 | **43/43 / 21/21 / 62/62** | the same |
| probe_playground (quick) | 73/73 | **73/73** | 73/73 |
| probe_pg_lifequests | 16/16 | **16/16** | **12/16**: QU-13, QU-08, QU-13 low, QU-03 ("every shown S1 quest completes from LIFE's scripted Home + cabin session": with the flip the R / I / G quests are shown and that session never travels) |
| probe_life | 121 / 1 FAIL (LF-02) | **121 / 1** (LF-02, the same) | 121 / 1 |
| probe_chatter | 42/42 | **42/42** | 42/42 |
| renderview/pg_node_checks | 40 / 0 | **40 / 0** | 40 / 0 |
| probe_journal | 29 | **29 / 0** | 29 / 0 |
| probe_quests | 46, 3 NOT RUN | **46, 3 NOT RUN** | **3 FAIL**: QU-06 ("this S1 build: 20 stamps open nothing beyond Home and Hearthlog"), QU-14 x2 ("this S1 build shows exactly Home's 10, Hearthlog's 10 and X1..."): rows that say the S2 places have not shipped |
| probe_pg_data | 40 / 3 FAIL | **40 / 3 FAIL** (the same three: Home B5, the cabin's tall rocker in the model, Cloudloft's tall spawns) | 40 / 3 (the same) |
So my lane moves no probe; the flip itself (the DATA lane's line) needs QU-06, QU-14 x2 and the four S1-session rows of probe_pg_lifequests re-specified by
their owner when it is applied (they say "S1 build" in their names: they are right for the build they describe).

## 3. Phone leftovers (DONE where the shell can; 06:13)
- **The hint pill in the HUD insets** (`hudBinding.ts reportInsets`): its layout box counts as a bottom row wherever it hangs at the bottom (not where it hangs
  under the top row at 380 px and under, nor in tiny); offsetTop, not the transformed box, so its 8 px show / hide slide never moves the framing; a ResizeObserver
  follows its one or two lines. Measured on 390x844 (`S/ball.mjs`, tree_flip, shots `S/ball2/`): the insets reported are top 56, bottom 174 (the hint's top at 670;
  the info row 714, the dock 778).
- **The cabin's tall Rocker Board**: its centre at y 584, its front edge about 642, the hint pill's top 670: **clear by about 28 px** (the round-5 model had it
  at 669 against the pill's 618: under it). Shot `S/ball2/cabin_390x844.png`. Seen there too (not in the brief, not fixed): the tracker pill ("Next: A gentle
  squeeze") covers the top half of the tall cabin's kettle (y 141, the pill's bottom 107) and the right column of buttons covers the hearth's right third;
  the place band's top is the top row (56), and the play UI's slot under it is not counted (counting it would move Home's phone framing too: left for a round
  where the published framing rows can be re-run with it).
- **The Felt Ball at Home on a phone, one squishy out: NOT fixed.** Dollop's centre (195, 373), r 128 px; the ball (297, 512), r about 70 px: centres 173 px
  apart, so the discs overlap by about 25 px (the ball in front of Dollop's lower right; shot `S/ball2/home1_390x844.png`). The ball stands at (0.331, 1.087):
  its TALL spot (0.76, 1.06) pushed into the visible table (`stage.visibleTable` -> `world.setBallBounds`), which a portrait frame with one squishy keeps
  narrow (the camera is width-bound: the hint inset changed the band's height, not the width). The shell cannot move it honestly: the spot is DATA's and the
  framing RENDER's (FIX5_DATA B5: "framingFor's rest framing counts the ball's TALL spot like a standing capsule"); request in section 5.

## 4. THE browser run (`S/run_final.sh final1`, started 06:14:52 on `S/tree_final`)
Tree: HEAD + the other lanes' 24 working files frozen at 06:14 (the live tree typechecked then; DATA's 11 and RENDER's 13: the S2 looks, the squirt arc,
the postcards) + my lane's files + the flip of the three (`S/flip.sh`), so the run shows all three; the decision above stands apart from it. Sections:
the 32 published ones of FIX5 R2.6 + `pg-places` + `pg-places-phone` + console-and-network, then trophies_check (game), lock_browser, photo_check (dev,
phone, standalone) and b4b_checks. The machine was shared all the way (the RENDER lane's own browser jobs on 5364: load average 8 to 9 on 4 cores).
(Results below as they come.)

## 5. Requests to other lanes and the orchestrator (kept current)
- **Orchestrator / DATA (the one line that opens the three)**: apply `_handoff/reports/R6_SHELL_open_s2.patch` (`git apply` from the repo root; checked with
  `git apply --check` against the working tree): `shipped: true` for Ripple Shore, Frostbell Ridge and Rainleaf Garden in `src/data/places.ts` PLACE_INFO and in
  `place_ripple.ts`, `place_frostbell.ts`, `place_rainleaf.ts`. The shell needs nothing more for it (Travel, the journal's rules, LIFE's thing kinds all follow
  PLACE_INFO), and every shell row passes with or without it (node rows go through the dev path; the browser sections `pg-places*` say "not run" without it).
- **DATA (src/life this round) / PG_LIFE: B04 by-itself uses of the S2 things** (the reason Ripple Shore and Rainleaf Garden stay closed, section 2): today a squishy
  starts a use by itself only on a ball or an ice patch (`brain.ts useCandidate`, "pads, chimes, pools, turntables: S2 / S3, not built") and its wanders keep
  0.4 m off every thing (`freeTarget` / `clearOfThings`), so in a 5-minute visit Ripple's squishies use 1 or 2 things (the Pebble Ball; a wade only when a path
  crosses the Rock Pool) and Rainleaf's 1 or 2 (the Seed Pod, the Splash Spots), measured over 4 and 3 parties (section 2). Asked: B04 candidates for a pool
  (walk in and wade: LIFE's own WADE / FLOAT REACT then names it), a chime row and a pad (walk or hop into it: the host already records a body's strike as
  USE RING / USE BOUNCE by SELF), a mound (climb on and slide: the host would record it as USE SLIDE by SELF once LIFE starts it), within USES_FULL; and the
  peek moment (S13, the Driftwood Log) did not start once in 5 x 300 s. Nothing in the shell needs changing for it: `pg-places*` count USE, REACT and the social
  moment around a thing.
- **RENDER (or DATA) for the Felt Ball on a phone with one squishy out** (section 3): RENDER: framingFor's rest framing (and so `visibleTable`) counts the
  arrived ball at its TALL spot like a standing capsule (`withCap`), so the camera pulls back enough for (0.76, 1.06) to be in view beside Dollop; or DATA: a
  one-out tall spot the narrow table already holds (about z 1.3 to 1.4, in front of Dollop's feet and above the hint pill at 670 px). With either, the shell
  needs nothing (the ball is placed by physics from the spot and the bounds the shell already passes).
- **DATA (DT-01's camera model)**: the hint pill is now a bottom row of the HUD insets (section 3: 670 on 390x844); the model's bottom rows can take it.
- **PG_RENDER**: postcards wired as asked (section 2). The squirt calls `stage.squirtFx(fromView, toView | 255, drops, dirX, dirZ)` as R6_RENDER's contract
  comment says (the direction toward the camera when nobody is in reach).
