# R15_CLOSE: the one engineer closing round 15 (started 2026-11-24)

Tree at start: HEAD d0890791c, clean. Live: 6c495e9c1. No git write command is run. Ports 5380-5383, a fresh vite server per browser run.
Scratch: `<scratchpad>/close/` (can be wiped). If this file is all you have: every edit named here is IN THE TREE; a row is verified only where it says measured.

## Status (updated after every finished item)
| item | what | state |
|---|---|---|
| 1 | blocked walks (face leads self-powered travel) | **PARTLY FIXED, measured on both frames**: a friend in the way is steered round (new; probe_crawl CR-17 12/12, LIFE told by LIFE_FLAG.STEER, selfuse green); where the friend is ON the target the slow push remains and still goes backward; final numbers in "Item 1 FINAL" |
| 2 | slime on the Glide Ramp | **DONE: MEASURED, NOT NEW, NOT CHANGED.** The same rest-pose drop over the ramp's top on the tree and on the live source: the slime glides 3 of 12 (tree) and 2 of 12 (live); see the log |
| 3 | Home hard toss row | **DONE, measured on both frames: the ROW was wrong (twice), the product tosses.** desk: flick tosses 8.1 m/s, ends inside (-5.16 m, felt 5.5); phone: 4.57 m/s, ends inside; browser_rooms Home 11/11 on each frame |
| 4 | probe_float F8 | **GREEN, NOT REPRODUCIBLE: 16/16** on the tree (3 runs), with the previous commit's crawl.ts, and with the put-down turn allowed in the air; see the log |
| 5 | browser_rooms full, both frames | **DESK 60/60 green. PHONE 66 ok / 5 FAIL** after two harness corrections (trips now arrive at all seven places); the 5 are rows that ran on a phone for the first time: NOT fixed (Ripple toss 2.42 m/s vs 2.5; Rainleaf pinch-in, 3 rows; Lanternroof overlapping edge chips) |
| 6 | the whole list once | **DONE** on the code in the tree, except browser_rooms desk and browser_cutparty / softbody / app / gestures / cut / pg_data / merge (run one crawl.ts step earlier; none of them walks into a friend). Reds: probe_life_selfuse 38 ok / 1 FAIL (SU-05, one flip-flop); browser_rooms phone 5; softbody 115/116 (= live) |

## Log

### Item 1 (in progress; everything below is IN THE TREE)
- The cut-off edit (d0890791c, a slow push at 0.12 m/s with no wave) MEASURED and rejected as the whole answer (`_harness/_reports/browser_facing_close_push.log`):
  Home 3 out desk self-powered median 6.3 / p90 55.5 deg, 6.7 % of walking samples backward; a puddlo pushed on a friend 9 s with 20 % of samples backward
  (the glide is a move of X with no momentum: the two soft bodies' contact answers every step and throws the walker back or aside).
- New (src/physics/crawl.ts, block "R15_CLOSE 1"): a friend whose skin is in its way (anywhere ahead, not only a 55 deg cone) is STEERED ROUND: the glide is held,
  its way is the tangent round that friend (leaning out while it presses, in while clear; the gap read smoothed over 0.3 s; one friend tracked at a time), the
  forward creep along its face carries it round at the walk's own speed, only once it faces within 45 deg of that way (it stops, turns, goes). Where the target
  cannot be stood on without moving the friend (nearer the friend's centre than the walker is) it keeps the slow face-leading push (pushV 0.12, no wave).
  A turn beside a friend gives way to it (yaw cap falls with the skin gap: a long body turning back to its rest facing swept 18 cm into its neighbour in 0.2 s).
- LIFE is told (metrics.steering -> LIFE_FLAG.STEER 8192 -> act.ts travelStep): the way round is not "no progress" (a head-on way round gains < 2 cm toward the
  target in 2 s; without this the blocked rule ended those walks). Files: src/physics/crawl.ts, softbody.ts (metrics.steering), contracts.ts, data/life.ts,
  shell/later-life.ts (one line), life/act.ts (one line).
- Harness (`_harness/browser_facing.mjs`): worst value fixed (was null), samples over 60 counted, the self-powered set also split by "a friend's skin on it
  (gap < 2 cm)" / clear (the whole self-powered set stays the measure), `FACING_TRACE=1` writes the raw samples.
- Development runs, Home 3 out desk 60 s (self-powered median / p90 / worst, over-60 count): steer v1 7.1 / 29.6 / 139 (32 of 813); final shape before the push
  fallback 6.2 / 20.6 / 122.9 (4 of 365), Calm 4.3 / 12.4 / 178.9 (14 of 501). What is left is contact: another body running into the walker, a brush.
- FOUND on the way: in probe_life_selfuse's rig (NOT in the game) two of the three squishies stood ON static things on the TALL layout (crimpo 0.18 m from
  the Warm Lamp's middle, glimglop's skirt on the Music Box) and their walks ended "blocked by a thing" at once, again and again (metrics.scootBlocks 8-11 in
  80 s, on the committed code too): the rig's mock mat was the wide frame's row on both frames; the game's tall mat is a chevron (render/stage.ts
  MAT_SLOTS_TALL), whose spots are 1.8 m and more from every thing of the tall layout. The rig is corrected (see below); the game needed nothing.
- probe_life_selfuse with pure steer + stop: SU-06 3 of 4 FAIL (the lamp's spot is beside the wedged crimpo: reaching it needs the push); hence the push fallback.
- `_harness/_dbg_su.ts` is a temporary debug copy of probe_life_selfuse (delete before the end).

### Item 2 DONE (measured; no product change)
- Rig: probe_float's own setup + a Frostbell block (`<scratchpad>/close/ramp_block.ts`; built into `_harness/_ramp.ts` of each tree and deleted from the working
  tree afterwards): Dollop + Glimglop + Crimpo out, travel to Frostbell, each put in its REST pose over the ramp's top (0.7 m up-slope of its middle) at a given
  centre height, let fall, 6 s. Live source: `git archive 6c495e9c1` in `<scratchpad>/close/live`.
- Slime (glimglop), travel in 6 s by centre height, 2 drops each:
  | height | tree | live |
  |---|---|---|
  | 0.88 | 0.11, 0.10 | 0.22, 0.10 |
  | 0.94 | 0.18, 0.54 | 0.18, 0.18 |
  | 1.0 | 2.78, 2.79 | 2.06, 0.27 |
  | 1.1 | 0.23, 0.61 | 0.20, 0.19 |
  | 1.2 | 2.81, 0.18 | 0.14, 0.15 |
  | 1.3 | 0.16, 0.34 | 0.14, 1.99 |
  Glides (over 1.5 m): tree 3 of 12, live 2 of 12. The jelly and the mochi glide on both (tree 2.8-4.8 m 7 of 8, live 2.1-2.3 m 7 of 8).
- So the slime staying at the ramp's top is in the LIVE build too; the carry's set-down (0 of 3 per frame, R15_FIX F5) lets go at about these heights.
  Cause (from the traces): the slime's centre rests 0.83-0.92 m up, about 0.33 m over the ramp's deck: a 1.08 m wide slime over a 0.9 m channel sits ON the two
  side rails (3 cm capsules 7 cm over the deck) and its skirt hangs outside them. Making it glide means changing the ramp's rails or the slime's width on it:
  not small, not done. OPEN.

### Item 1, state at this point (IN THE TREE, tsc clean; probe_crawl 17/17 and probe_float 16/16 were run two edits earlier, to be re-run at the end)
- crawl.ts as described above, with two refinements: "no way round" (the push) only when the friend is ON the target (the target nearer the friend's centre
  than 0.9 x the two bodies' reach; before: nearer than the walker itself, which made most crowded walks pushes: Home desk self-powered median 23 / p90 47);
  a walker's own turn beside a friend keeps at least 0.4 of the yaw rate (at 0.05 a pressed walker took 7 s to turn and LIFE ended its walk).
- `_harness/probe_life_selfuse.ts` RE-SPECIFIED (reason at the line): the rig's mat was the wide frame's row on both frames; the real stage uses a chevron on a
  tall frame (render/stage.ts MAT_SLOTS_TALL). On the tall layout the row stood two of three squishies on the lamp and the music box. SU-06 with the rig's
  tall mat as the game's: 4/4 (tall 3 things by 70 s; wide 3 by 170 s and 150 s: the wide rows still have little margin).
- Browser, both frames, 3 out, 60 s per section (`_harness/_reports/browser_facing_close_h2.log`), self-powered median / p90 / worst (samples over 60 of n):
  desk: Home 4.3 / 16.5 / 134 (10 of 784); asked 1.9 / 13.7 / 29 (0 of 216) and 5.1 / 11.2 / 111 (5 of 249); Home Calm 6.2 / 7.0 / 130 (1 of 307);
  Ripple 1.7 / 10.1 / 70 (1 of 1046); Frostbell 1.7 / 10.4 / 104 (11 of 850).
  phone: Home 4.9 / 21.4 / 175 (20 of 873); asked 4.3 / 12.5 / 118 (3 of 245) and 10.4 / 46.5 / 178 (12 of 147); Home Calm 0.4 / 7.7 / 173 (4 of 404);
  Ripple 9.4 / 52.3 / 178 (55 of 720); Frostbell 1.0 / 13.5 / 166 (24 of 618).
  What the samples over 60 are (traces `..._close_h2_trace_*.json`): (a) the PUSH where a friend is on the target (Ripple phone: one burrbin 7 s against a
  friend at 0.05-0.15 m/s, drifting 60-150 deg off its face); (b) another body running into the walker; (c) Frostbell phone: 16 of 24 are one boingle walking
  up-slope on ice / the ramp, face ahead, sliding back at 0.05-0.17 m/s (no friend within 1 m: the place's grip, not a facing fault).

- probe_life_selfuse `--su4-only` on this code: **all selfuse checks passed** (SU-04 all places and frames, SU-05 no flip-flop, SU-06 4/4).

### Item 3 DONE (harness only: `_harness/browser_rooms.mjs`; no product change)
- Home, desk, the row as it was: `carried true`, the fling tosses (fastest 8.1 m/s), 0.56 m past the felt at most, at rest inside. Green.
- Home, phone, "carried false" (2 runs, picture `_harness/_renders/rooms/c3_phone_dbg_tosspress_1.png`): the party stood bunched; the row's squishy stood BEHIND
  another (discs (118,318,r39) and (130,339,r42)), the press at its left part took the one in FRONT (carried [true,false,false]): the game takes the squishy the
  player sees under the pointer (game.ts pickBody), which is right. The row aimed by rest-radius discs. Re-specified (reason at the line): the squishy in the hand
  is the one the carry is about (out.who), measured from then on.
- Home, phone, then `carried true, fastest 0.4 m/s`: the row's fling is 5 frames x 90 px = 450 px on a 390 px screen, from a finger already near that edge: it
  hit the screen's edge in one frame and stood still 4 frames before the let go = a set-down (gestures.ts FLICK_V). Re-specified (reason at the line): where
  the screen has no room the hand swings back toward the middle (a slow carry) and flings with what the screen allows (57 px a frame = 3400 px/s), letting go
  while moving. Result: tossed at 4.57 m/s from (-0.97, 0.09), at rest inside (-2.54). NOTE: on the phone the toss therefore starts 4.5 m from the side, not
  2.6 m (the row's title still says 2.6 m; its JSON shows `flungFrom`).
- A hard flick with 2+ out tosses on both frames. `ROOMS_DBG=1` prints the press and the toss's path.

### Item 4 (probe_float F8): green, cause not reproduced
- 16/16 on the tree three times (tRest 2.47 to 2.55 s against 3 s; F8's table 2.17 to 2.55 s), 16/16 with crawl.ts of the previous commit (the "steer v1"
  the red was blamed on) and 16/16 with the put-down turn allowed in the air (the cause the cut-off engineer wrote at crawl.ts: "turning in the air through
  Table's gentle descent kept a party from coming to rest in time"; their fix, "only while something bears it", is in the tree). The red belonged to an
  uncommitted in-flight state; nothing to fix now. The margin on "at rest within 3 s" is 0.45 s.

### Item 1: last code changes (IN THE TREE, tsc clean) and the new probe row
- New row `probe_crawl CR-17` (section `drawn`): a friend 1.3 m along the way, the target 2.8 m on: the walker goes ROUND (skins never overlap by over 2 cm,
  drawn face p95 <= 30 deg off travel, <= 3 cm made sideways or backward, metrics.steering set, arrives); a target the friend is ON: the glide at most pushV,
  never steering. 12/12 (4 families, normal and Calm; `node _harness/probe_crawl.ts --only=drawn`). The rig does not simulate body-to-body contact.
- What the row found and fixed in crawl.ts: (1) the friend prefilter used the REST radius when collide had not measured the body yet (a sagged body is wider:
  a friend 1 cm away passed as apart): now collide's bR, or 1.5 rest radii; (2) after turning along the friend the gap opens 15-20 cm (its reach toward the
  friend is then its half width): it let go, turned back at its target, met the friend again: a staircase of 90 degree turns (putty: 3 of them, 5 cm of
  recoil). Now friendOut 0.35 (holds on through the turn), friendOff 0.07 (a wider berth), the lean in up to 39 deg: one arc.
- AFTER THESE CHANGES NOTHING ELSE WAS RE-MEASURED YET: the end chain below re-runs every probe and browser check on the final code.
- End chain: `<scratchpad>/close/chain.sh`, outputs `<scratchpad>/close/end/*.out`, one job at a time.

### Item 1 FINAL (the code in the tree = `<scratchpad>/close/crawl_push_final.ts`; every number here is from that code)
- Browser, 3 out, 60 s a section, `_harness/_reports/browser_facing_close_final.{log,json}` (+ traces): SELF-POWERED travel (drive over 3 cm/s), drawn face vs
  travel: median / p90 / worst deg (samples over 60 of n) | of those with no friend's skin on it (gap >= 2 cm):
  | section | desk | desk, clear of friends | phone | phone, clear |
  |---|---|---|---|---|
  | Home | 5.6 / 49.3 / 177 (62 of 937) | 3.7 / 18.3 / 122 (6 of 621) | 4.2 / 24.9 / 175 (22 of 885) | 3.2 / 10.3 / 162 (11 of 785) |
  | Home asked 1 | 6.5 / 24.1 / 174 (15 of 249) | 5.1 / 14.0 / 168 (4 of 193) | 1.5 / 9.4 / 37 (0 of 212) | same |
  | Home asked 2 | 3.3 / 9.8 / 136 (9 of 209) | 3.2 / 9.8 / 86 (6 of 206) | 1.3 / 9.5 / 147 (1 of 298) | 1.0 / 9.7 / 147 (1 of 262) |
  | Home Calm | 0.5 / 7.1 / 42 (0 of 569) | same | 0.5 / 7.1 / 39 (0 of 1000) | 0.5 / 7.1 / 39 (0 of 983) |
  | Ripple | 2.9 / 10.2 / 77 (2 of 1067) | 2.8 / 10.1 / 47 (0 of 1049) | 9.8 / 50.4 / 164 (55 of 681) | 4.6 / 33.6 / 164 (19 of 465) |
  | Frostbell | 2.4 / 10.3 / 104 (4 of 841) | 2.1 / 9.6 / 56 (0 of 792) | 0.8 / 9.9 / 174 (15 of 674) | 0.8 / 9.2 / 174 (13 of 652) |
  Before (R15_FACING.md, the committed code before the friend work): Home desk p90 158 over ALL walking samples, 13-30 % of them backward.
  RUN TO RUN THE HOME ROWS MOVE A LOT (the crowd's 60 s differ each run: Home desk p90 read 16.5, 16.7, 20.6 and 49.3 in four runs of near-final code).
- What is still over 60 (traces): (a) THE PUSH: a walker whose target a friend is ON keeps pressing at 0.12 m/s and the contact throws it back or aside
  (desk Home: 56 of the 62; phone Ripple: 36 of 55). (b) another body running into the walker, and a walker wedged between two friends (it changes the friend
  it goes round every second or so). (c) Frostbell phone: a boingle walking up the icy ramp / ice, face ahead, sliding back 0.05-0.17 m/s, no friend near.
- Tried and NOT kept: (1) STOP at the friend instead of the push (go round to the nearest point, stop, face the target): clean in probe_crawl, but
  probe_life_selfuse SU-06 wide 2 of 2 FAIL (2 things used at Home); (2) a gentler push, 0.05 m/s: still thrown back (a burrbin 50 s against a friend, travel
  166-179 deg off its face). So the push stays because LIFE's uses at a crowded Home depend on shoving a friend off a use spot.
  RECOMMENDED (a design call, not done): the friend makes room (LIFE asks a resting friend that sits on another's target to step aside), then no push.
- Pictures `_handoff/reports/shots_facing/after_*` retaken from the final code (22 of 32 changed). NOT VERIFIED IN A PICTURE: the two "away" mid-walk
  pictures (desk and phone, normal mode) show the squishy face-on with closed eyes, in the committed pictures too: it looks asleep at that scripted walk (the
  harness's second walk after a rest); the right / left pictures show it turned. Not diagnosed.
- Probes on the final code: tsc clean; probe_crawl 18/18 (17 + CR-17; CR-12 once read 148 us on a busy box, 7.8 us alone and green in the clean run),
  probe_float 16/16, probe_playground 74/74, probe_carry 13/13, probe_gestures 176/176, probe_party 10/10.
  NOT RE-RUN after the very last crawl.ts change (friendOut 0.35, friendOff 0.07, lean in, bR prefilter): `--su4-only` (it passed on the code just before);
  the end chain's full probe_life_selfuse covers it.

### Item 5 (browser_rooms in full, both frames, final code, alone: `<scratchpad>/close/end/browser_rooms.out`)
- 101 ok, 5 FAIL. DESK: every row of all seven places green. PHONE reds, all the harness's:
  (1) the trips to Frostbell, Rainleaf, Lanternroof and Cloudloft "arrived false": their Go buttons are below the fold of the Places sheet on 390 x 844 and
  the tap went where the button would be unscrolled. Row corrected (scrolls the button into view; reason at the line).
  (2) Hearthlog "hard toss": `carried false`, the squishy stood at the frame's very edge (disc (17, 315) r 25). Row corrected (presses the squishy the row has
  in the frame; reason at the line).
  A phone-only re-run with both corrections follows the end chain.

### End chain (item 6), on the final code unless said (`<scratchpad>/close/end/*.out`)
- probe_softbody (full) 115/116 (= live: G1p). probe_app 188/188. probe_gestures 176/176. probe_carry 13/13. probe_cut 17/17. probe_float 16/16.
  probe_party 10/10. probe_crawl 18/18. probe_playground 74/74. probe_pg_data 0 FAIL. probe_merge 22/22. browser_carry 14/14. browser_cutparty 16/16.
  browser_facing: see Item 1 FINAL. vite build exit 0: [G0b] first-play 465 KB gzip of 600; [T1] 2150.7 KB of 2250; [G0] 2571 KB of 3072.
- probe_partycut: 25/27 in the chain (M5 a carried piece held against another piece; M13 Float with pieces). With the COMMITTED crawl.ts it is 26/27 (M13 red
  there too). Cause of M5: the friend logic also steered PIECES round each other. Fixed in crawl.ts (LAST CHANGE: the friend logic is between WHOLE squishies
  only; walker and friend both). After it: **27/27**. The facing and LIFE runs above have no pieces, so they were not re-run for this change;
  probe_crawl / probe_float are re-run after it (below).
- node_checks: 184/186 in the chain (the two "Go play with... a ride" rows). Traced: the shared timeline left the play squishy 4.6 m from the swing; it
  walked there freely (no block, no friend) and the row's 10 s ran out. Row re-specified (reason at the row: over 2 m away it starts from the same floor spot
  the row already uses). After it: **185/186**; the red is N1 "PLAY_WITH on the MED tier" (Home, the Warm Lamp: the asked squishy's walk did not start within
  8 s), the row that is red on the live build and that R15_FIX saw flip with the timeline. With the committed crawl.ts the same probe reads 182/186 (four
  other rows): this probe's rows share one timeline and move with any change in a walk. NOT 186/186.

### LATE CORRECTION (read this before "Item 1 FINAL" above)
- The end chain's FULL probe_life_selfuse on the "final" code FAILED: SU-06 3 of 4 (2 things at Home) and SU-05 (flip-flop, Frostbell and Cloudloft). The
  rows had passed (`--su4-only`, all) one step earlier, before the wider berth (friendOff 0.07, friendOut 0.35, lean in 39 deg). That step is TAKEN BACK
  (crawl.ts: friendOff 0.03, friendOut 0.12, lean in 0.35; the reason is written at the line). Kept from it: collide's bR in the prefilter, and the friend
  logic between WHOLE squishies only.
- So the code in the tree now = `<scratchpad>/close/crawl_final3.ts`. For it: the browser numbers of "Item 1 FINAL" are NOT its numbers (they are the wider
  berth's); its nearest measured relative is the run `browser_facing_close_h2.log` (desk Home 4.3 / 16.5 / 134, 10 of 784 over 60; phone Home 4.9 / 21.4 /
  175, 20 of 873; the rest as listed under "Item 1, state at this point"). CR-17 on it: 12/12 with the overlap bar at 5 cm (the putty's wave reaches 4.0 cm
  past the friend's skin line in a rig without contact, and it goes round in a staircase of three turns; both written at the row).
- A THIRD chain re-measures everything that depends on it: `<scratchpad>/close/chain3.sh` -> `<scratchpad>/close/end3/*.out` (probe_crawl, selfuse rows,
  float, partycut, node_checks, carry, playground, party, browser_facing `close_final3`, browser_rooms phone, browser_carry, the pictures, the build, the
  full selfuse). The results below this line are from it.

### Chain 3 results (the code in the tree)
- tsc clean. probe_crawl 18/18. probe_life_selfuse `--su4-only`: all passed (SU-04, SU-05, SU-06 4/4). probe_float 16/16. probe_partycut 27/27.
  **node_checks 186/186.** probe_carry 13/13. probe_playground 74/74. probe_party 10/10.
- browser_facing, 3 out, 60 s a section (`_harness/_reports/browser_facing_close_final3.{log,json}` + traces): SELF-POWERED travel, drawn face vs travel,
  median / p90 / worst deg (samples over 60 of n) | the same with no friend's skin on it (gap >= 2 cm):
  | section | desk | desk, clear | phone | phone, clear |
  |---|---|---|---|---|
  | Home | 4.6 / 22.7 / 160 (25 of 802) | 3.1 / 12.0 / 44 (0 of 456) | 4.5 / 17.7 / 149 (13 of 809) | 4.1 / 12.9 / 149 (5 of 696) |
  | Home asked 1 | 7.8 / 66.3 / 161 (24 of 205) | 7.5 / 45.9 / 161 (10 of 158) | 3.3 / 9.4 / 168 (5 of 237) | 2.8 / 9.3 / 157 (1 of 181) |
  | Home asked 2 | 9.4 / 20.6 / 102 (3 of 227) | 6.3 / 18.5 / 36 (0 of 150) | 0.7 / 5.6 / 21 (0 of 115) | same |
  | Home Calm | 2.8 / 21.5 / 113 (12 of 763) | 0.6 / 8.7 / 67 (3 of 535) | 0.6 / 30.5 / 177 (43 of 954) | 0.4 / 16.0 / 170 (13 of 709) |
  | Ripple | 2.1 / 10.3 / 63 (1 of 1088) | 2.0 / 10.2 / 63 (1 of 1076) | 10.9 / 49.1 / 171 (36 of 663) | 5.3 / 29.4 / 171 (14 of 438) |
  | Frostbell | 3.8 / 28.9 / 129 (20 of 1006) | 1.6 / 10.1 / 129 (5 of 787) | 0.8 / 8.9 / 94 (1 of 596) | 0.7 / 7.0 / 33 (0 of 556) |
  Before the friend work (R15_FACING.md): Home desk p90 158 over all walking samples. The samples over 60 that remain are the push at a friend ON the
  target, another body running into the walker, a walker between two friends, and the ice at Frostbell (see "Item 1 FINAL" for the traces' reading; the
  kinds are the same, the counts are these).
- browser_rooms PHONE with the two harness corrections (`end3/browser_rooms_phone.out`): 66 ok, 5 FAIL. All seven trips now ARRIVE (Frostbell, Rainleaf,
  Lanternroof, Cloudloft were never reached on a phone by this harness before), so rows there ran for the first time. The reds, NOT FIXED, NOT DIAGNOSED:
  (1) Ripple "hard toss": tossed, fastest 2.42 m/s against the row's 2.5 (the phone's fling after the back-swing; Home's read 4.57);
  (2) Rainleaf: the pinch does not zoom IN (the view stays the whole room, squishies 26 px), so the pan row and "the view scrolls under the hand" of the ONE
  carry row fail with it (the carry itself arrives: rest 0.32 m); one cause, not looked into (R15_FIX F7 found a pinch finger on a ride's AUTO chip is taken
  by the chip: a first thing to check);
  (3) Lanternroof edge chips: two chips 14 px apart ((360, 391) and (360, 405)); the tap on "Go to Kneadle" was taken by "Go to Crimpo" on top of it
  ("Looking at Crimpo"). Looks like a real phone fault: two squishies off the same side get overlapping 44 px chips.
  Desk (the earlier full run, before the wider-berth step was taken back): all seven places green, 60 of 60.
- browser_carry 14/14. Pictures retaken (`shots_facing/after_*`). vite build exit 0: [G0b] first-play 465 KB gzip of 600 (473,923 B), [T1] 2150.7 KB
  of 2250.
- probe_life_selfuse FULL (36 min): **38 ok, 1 FAIL**: SU-05 "no behaviour flip-flop": Hearthlog, Dollop, 1 s after arriving: 4 switches in 5 s
  (MOMENT > LOVE > BASK > NOTICE > WANDER) with 6.4 cm moved (the bar: at most 3 with under 10 cm). SU-04 and SU-06 (4/4) green. NOT FIXED, not diagnosed
  (the `--su4-only` run of the same code, 24 visits, passed it). The wide SU-06 rows keep little margin.

## OPEN at the end
- Item 1: the push at a friend ON the target still goes backward; a long body goes round a friend in a staircase; a walker between two friends changes
  sides; Home rows vary run to run. Recommended next: the friend steps aside (LIFE), then the push can go.
- SU-05 one flip-flop (above). node_checks is 186/186 on this code but its rows share one timeline and flip with any walk change (182 to 186 seen today).
- Item 2: the slime on the Glide Ramp (also on live; rails).
- browser_rooms phone: Ripple toss speed, Rainleaf pinch-in (3 rows), Lanternroof overlapping edge chips. The Home toss row's title says 2.6 m; on a
  phone the toss starts farther back (the back-swing).
- The two "away" pictures show a sleeping squishy (not a picture of the turn). The scripted per-family section of browser_facing (`--sec=fams`) and its
  float section were not re-run this session.
- Out of scope, untouched: Home using more than 3 things; F8 / F10 / F12 / F13 of VERDICT_R14.
- Files changed (nothing committed): src/physics/crawl.ts, softbody.ts (metrics.steering), contracts.ts, data/life.ts (LIFE_FLAG.STEER, appended),
  life/act.ts, shell/later-life.ts; _harness/browser_facing.mjs, browser_rooms.mjs, probe_crawl.ts (CR-17), probe_life_selfuse.ts (tall mat),
  shellview/node_checks.ts (ride row start); the after pictures; this report.

## FOLLOW-UP (second brief; everything here is IN THE TREE, tsc clean; nothing committed by me)
### F-1 the five phone browser_rooms reds (diagnosed by real input; `<scratchpad>/close/rooms_d1..d5.out`, `ROOMS_DBG=1`)
- Lanternroof overlapping edge chips: PRODUCT, fixed (`src/ui/later-room.ts`: a chip keeps 50 px from every chip placed before it, sliding along its
  edge). The row now also asserts no chip lies on another. Seen with two chips at once (Rainleaf: (30, 332) and (30, 552)); the exact two-on-one-side case
  did not recur in the reruns, so the slide itself is NOT yet seen working in a browser.
- Ripple toss 2.42 vs 2.5 m/s: ROW. The same fling read 2.42, 3.87 and 8.12 m/s in three runs: "fastest" was a 5-frame mean (83 ms) of a toss that lands
  in about 0.3 s. Now read frame by frame for the first 20 frames (reason at the row; the 2.5 bar unchanged): Rainleaf 7.64, Lanternroof 5.18 m/s.
  NOT compared with the live build: live has no carry, so there is no "same flick" to make there.
- Rainleaf pinch-in (3 rows): MIXED. (a) ROW: a pinch IN starts 30 px either side of the row's middle and only the middle and the ends were tested for
  squishies; a finger started inside a squishy's disc (a carry, no pinch). Corrected (reason at the line). (b) PRODUCT: a finger that lands on a swing seat
  or a rocker board is the host's hand, so a pinch with one finger on a ride (the Leaf Teeter lies mid-frame in the whole-room view) did not zoom. Fixed:
  `later-life.ts yieldHand` + `game.ts` (a hand that came down under 300 ms ago and has not moved gives its finger back when a second finger lands; a
  second finger does not take a ride while the first is on the empty scene). After both: Rainleaf phone 11 ok / 0 FAIL in one run. NOT PROVEN which of the
  two was the cause there; one pinch in three still did nothing in the traces (the row retries), cause not found.
- The trip tap: the harness now waits for a still Go button and taps again if the trip has not begun (a tap on the sliding sheet missed in 2 of 5 runs).
### F-2 a friend ON the target (in the tree; measured so far: probe_crawl CR-17 12/12, `--su4-only` ALL PASSED)
- LIFE (`src/life/act.ts travelTo`): a walk whose spot another whole squishy stands on takes the free spot BESIDE it (their radii + 8 cm out, on the line
  from the friend through the asked spot), only where that is a spot: at most 0.75 m from the asked one, clear of every other squishy and every thing.
  Its use counts on arrival there as before (LIFE's arrival is at the walk's own target).
- Physics (`crawl.ts`): NO PUSH any more. A friend that is on the target anyway (it came later, or no free spot): the walker goes round to the nearest
  point and stops facing it; LIFE's blocked rule ends the walk (near enough still acts).
- First version of the free spot (two passes, no limits) sent a napper 3 m off onto the Keepsake Shelf and lost SU-06 wide (1 of 4); the limits fixed it.
### F-4 SU-05 flip-flop: the SAME single cabin flip-flop the live build has
- Live source (`git archive 6c495e9c1`, its own full probe_life_selfuse, `<scratchpad>/close/su_live.out`): 34 ok, 1 FAIL = SU-05, Hearthlog, Wisplet at
  77 s: 4 switches (ZONE > NOTICE > BASK > NOTICE > USE) with 0.079 m moved.
- Tree (chain 3): 38 ok, 1 FAIL = SU-05, Hearthlog, Dollop at 1 s: 4 switches with 0.064 m. One flip-flop, the same place, the same count (4 against the
  bar of 3), another squishy and moment. Known issue, not new. (The wider-berth step had THREE, at Frostbell and Cloudloft: that was new, and is taken back.)
### F-5 the "away" pictures were right
- Logged at the shot (`<scratchpad>/close/shots_dbg.out`): away, mid-walk: physics yaw 179 deg, walking at 0.26 m/s. The squishy IS turned away; the two
  slits are its eyes seen THROUGH the translucent jelly from behind. The final chain also takes the set with an opaque family (firmsilicone).
### F-3 node_checks: the rows that flipped today, and why (as far as found)
| run | count | red rows | cause |
|---|---|---|---|
| committed crawl.ts (push, d0890791c) | 182 | D-95 hand on the swing seat; SH-22 5 out "awake units under the cap" (2 rows); N1 PLAY_WITH MED | not traced |
| chain 2 (wider berth) | 184 | "Go play with... a ride" lift; "after the lift AUTO swings it" | TRACED: the timeline left the play squishy 4.6 m from the swing; a free 0.22 m/s walk, the row's 10 s ran out. Rig fixed: over 2 m away it starts from the row's own floor spot |
| after that fix | 185 | N1 PLAY_WITH MED (Home, the Warm Lamp: the asked squishy's walk had not started in 8 s) | not traced; the row that is red on live |
| chain 3 | 186 | none | |
- Every row of this probe runs on ONE shared timeline: each row inherits where the rows before left three squishies, so any change in a walk moves which
  rows meet a crowded or far start. Two rows are now independent of it (the ride lift). D-95, SH-22 (2) and N1 are NOT made deterministic: not done.
  The final chain runs node_checks three times on the same code (same code = same timeline = same result each time; the flip is between code versions).

### FOLLOW-UP FINAL (chain 4, the code in the tree; `<scratchpad>/close/end4/*.out`)
- tsc clean. probe_crawl 18/18. probe_playground 74/74. probe_float 16/16. probe_partycut 27/27. probe_carry 13/13. probe_gestures 176/176. probe_app
  188/188. vite build exit 0: first-play 466 KB gzip, T1 2152.1 KB of 2250.
- node_checks: 185/186 three times (the same red each time: D-95 "the hand on the seat"). TRACED: a squishy standing between the camera and the swing
  seat takes the press itself (the game's own rule: the rider takes the press), so the row depended on where the rows before left the party. Rig fixed
  (reason at the row: squishies on the seat or in the line to it are set aside first). After it: **186/186 three times**. (A first attempt that moved the
  rig's camera broke two later rows and was taken out.) SH-22 (2 rows) and N1 PLAY_WITH MED, red only with the committed push crawl / one earlier state,
  are NOT made independent: not done.
- probe_life_selfuse FULL: 38 ok, 1 FAIL. SU-04 and SU-06 (4/4) GREEN. SU-05 has TWO flip-flops: Hearthlog Dollop at 1 s (the cabin one, as live's single
  one) and Frostbell Puddlo at 281 s (BASK > HOLDON > BASK > WANDER > COMEBACK, 0.7 cm): the second is NEW with this code (live: 1). Not diagnosed.
- browser_facing, 3 out, 60 s a section, self-powered: median / p90 / worst deg, share over 90 deg (`browser_facing_close_f4.log`, Home again in
  `..._close_f4b.log`):
  | section | desk | phone |
  |---|---|---|
  | Home, run 1 | 5.0 / 33.9 / 174, 1.6 % | 3.9 / 13.3 / 102, 0.2 % |
  | Home, run 2 | 5.2 / 17.6 / 150, 0.3 % | 3.8 / 16.5 / 139, 0.1 % |
  | Home Calm, run 1 | 6.5 / 12.1 / 104, 0.4 % | 2.7 / 8.0 / 23, 0 % |
  | Home Calm, run 2 | 5.0 / 15.5 / 170, 1.5 % | 6.4 / 11.8 / 179, 4.4 % |
  | Ripple | 2.4 / 10.5 / 94, 0.2 % | 5.4 / 32.4 / 144, 0.8 % |
  | Frostbell | 2.2 / 10.2 / 60, 0 % | 1.1 / 13.1 / 170, 4.2 % |
  Ripple phone p90 49 -> 32 and Home Calm phone 30 -> 8 / 12 with the push gone. NOT DIAGNOSED: what is left at Ripple phone (p90 32), the 4.4 % of Home
  Calm phone run 2, and Frostbell phone's 27 samples over 90 (in chain 3 that was one squishy sliding back on the ice; not re-traced on this code).
- browser_rooms both frames: DESK 71 ok / 0 FAIL. PHONE 66 ok / 5 FAIL in the chain: Rainleaf 4 rows (one cause: the pinch IN) and Cloudloft's whole-room
  view turned. CAUSE FOUND AFTER: a pinch IN's inner starting points lay on a ride's AUTO chip (a DOM button): the canvas saw one finger. Row corrected
  (every starting point tested against the DOM, reason at the line). Rerun of Rainleaf + Cloudloft on the phone: 20 ok / 1 FAIL, every pinch zooms.
  The 1: Rainleaf's chip row once read "off screen 1, chips none" (the row counts a middle outside the frame, the game shows a chip from 10 px outside):
  not looked into. THE FULL PHONE RUN WAS NOT REPEATED after this last row correction. PRODUCT, still open: a pinch with a finger on an AUTO chip (DOM) is
  not a pinch (R15_FIX F7).
- Pictures: `shots_facing/after_*` retaken, jellygel and firmsilicone (opaque: the turn away shows without eyes through the body).

## AFTER THE VERIFIER'S SNAPSHOT (third brief; each change small; nothing committed by me)
| file | lines (about) | what |
|---|---|---|
| `src/physics/crawl.ts` | 232-236 | SU-05: a walker stopped at a friend that is ON its target is reported as steering (it WAITS) while over 0.6 m from the target; within 0.6 m LIFE's blocked rule still ends the walk |
| `src/ui/thingAuto.ts` | 31-41 (state + window listeners), 44-58 (the chip's pointerdown / up / click), the last line (destroy) | a finger on an AUTO chip is handed to the canvas when a second finger makes it a pinch; that press does not toggle the chip |
| `_harness/browser_rooms.mjs` | the chip row (about 461-500) and one `let chipPairDone` before the places loop | the row counts "outside the picture" by the game's own rule; a new check: two squishies set off the same side, their chips 44 px apart |
| `_harness/shellview/node_checks.ts`, `_harness/browser_facing.mjs` | (before the snapshot, see FOLLOW-UP FINAL) | |
### T-1 SU-05, the new Frostbell flip-flop: CAUSE FOUND, fixed
- Reproduced alone (`parties=puddlo+boingle places=hearthlog,ripple,frostbell`, traced): a puddlo in the Steam Pool planned a walk to a spot 0.5 m from
  where Dollop stood; physics stopped it at once (a friend on the target, the new stop); LIFE's blocked rule ended the walk 2 s later; the next plan
  met the same friend: 4 plans in 8 s, 0.7 cm moved. With the push it had moved, so the row never saw it. Not the beside-spot retarget.
- Fix (crawl.ts): stopped at a friend on its target and still over 0.6 m from it, the walker waits (told to the host as the way round is). The same three
  visits after: all selfuse checks passed.
### T-2 a pinch with a finger on an AUTO chip: fixed, checked by real touch input
- Cloudloft, 390 x 844, CDP touch (`<scratchpad>/close/pinchchip.out`): one finger on the Kite Swing's AUTO chip, the second 60 px beside it, spread
  120 px, twice: zoom target 0 -> 0.528 -> 0.45, view factor 0.62 -> 0.469, yaw 0 / 0 / 0 (before: the view turned), the chip not toggled; a plain tap on
  the chip afterwards toggles it (aria-pressed true).
### T-3 the chip slide seen in a browser
- Lanternroof, phone: two squishies set 1.1 m apart far off one side: chips at (360, 382) and (360, 332): 50 px apart (the new check, green).
