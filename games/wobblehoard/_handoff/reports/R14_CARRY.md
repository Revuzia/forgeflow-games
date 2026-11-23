# R14_CARRY: round 14, the CARRY engineer (owner: "make it easier to pick up and move squishies around")

Engineer: CARRY (src/input, the carry parts of src/physics/softbody.ts, src/shell later-life.ts / game.ts / driver.ts, carry hints in src/ui, their probes). Ports 5364 to 5369.
No git write command is run. Other engineers' work in the tree (R14_ROOMS, R14_MULTICUT) is kept: small targeted edits only.
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r14_carry/` (can be wiped).
If this file is all you have: its edits are in the tree, unverified unless a row says measured.

## Status (updated after EVERY finished item)
| item | what | state |
|---|---|---|
| 0 | read in (gestures, softbody carry, later-life carryPoint, game.ts routing, verifier notes) | DONE |
| 1 | reproduce in a real browser, 1280x800 + 390x844: tries for a new player front left -> back right | DONE (section 1) |
| 2 | design + decision (D-105; D-104 is ROOMS's number) | DONE (section 2); recorded at the end of PLAYGROUND_BUILD.md |
| 3 | build: gestures CARRY, driver lift, physics lift / level carry / set-down / float carry, later-carry.ts, later-life wiring, game.ts pickBody seam, hint lines | WRITTEN, tsc clean |
| 4 | probes (probe_gestures re-spec, node rows) | probe_gestures 174/174 (sections 13 + 14 new; 3 D-104 rows re-specified); NEW probe_carry 11/11 (section 4) |
| 5 | browser checks both frames, Home + every place, screenshots | DONE (sections 5, 6): new-player carry FIRST TRY at all 7 places on both frames |
| 6 | measure before / after, regression list, build size | DONE (sections 5 to 8) |
| 7 | the STILL let go (browser_rooms desk Home: a let go while the room view was still scrolling the hand counted as a throw) | DONE (section 10): set down, probe_gestures 176/176 |

## 0. How pick up and move works today (6c495e9c1 + ROOMS + MULTICUT), and why it is hard
- `gestures.ts`: a press on the body that moves > 14 px commits to PULL only when the drag leaves OUTWARD from the body's screen centre (cos > 0.2, and the press
  at least 0.1 r off the centre); any other drag is a RUB. So a press on the middle of a squishy, or on its lower half dragged up the screen (toward the back),
  is a rub: nothing moves.
- A pull is a STRETCH: the body is lifted only once the hand asks for more than LIFT_OVER 1.15 x the family's maxPull (1.13 R to 2.85 R): 0.5 to 1.3 m of drag
  on the camera-facing plane through the press point (`softbody.ts updateGrabs` -> `startCarry`). Until then the squishy stretches (and the meter pays a pull).
- The pull's plane faces the camera, so the drag up the frame mostly LIFTS. In a place (and Home with 2+ out, ROOMS) `later-life.ts carryPoint` puts the hand on a
  LEVEL plane at the height the hand had at the pick-up, which after the stretch is high (the squishy hangs up to 1.4 m in the air).
- carryPoint clamps the hand to 0.9 R ahead of the body; the target is asked again only when the pointer moves (or the room camera scrolls), so a hand that stops
  leaves the body short of the finger (carries "end short").
- Floating: `softbody.ts` has no carry while floating (`setFloat` clears it; `updateGrabs` lifts only with gravity on), and the hover spring pulls a let-go floater
  back to its hover spot: a floater cannot be moved at all (VERDICT_R12 (a): end displacement 0.00 m in 7 of 7).
- One gesture machine acts on ONE body (game.ts `active`, `pickBody` only between touches): a second finger cannot carry a second squishy.
- Grab target = the exact silhouette ray hit: a small piece is a small target.

## 1. The reproduction (real input, the tree BEFORE this work: ROOMS + MULTICUT in), `_harness/browser_carry.mjs --tag=before`
"A new player": presses the squishy in its MIDDLE and drags toward the spot, steering by the squishy once it is in the hand, holds a moment, lets go; a failed try
is tried again from where it lies with the press below, above, then above toward the spot. Success = at rest within 0.8 m of the spot.
| frame | place | front left -> back right | tries | what went wrong |
|---|---|---|---|---|
| desk | Home (3 out) | 5.03 m | 4 | tries 1-3 (press middle, lower, upper) = RUB: nothing moved (a drag that is not outward from the centre is a rub); try 4 (above, toward the spot) = a STRETCH that lifted past the line, then carried: 0.12 m |
| desk | Ripple Shore | 6.66 m | 3 | tries 1-2 RUB; try 3 stretch + lift, hung 0.88 m up |
| desk | Frostbell Ridge | 5.99 m | 3 | tries 1-2 RUB; try 3 stretch + lift, hung 0.87 m up |
| phone | Home (3 out) | 4.48 m | not in 4 | tries 1-2 RUB; try 3 stretch + lift, ended 1.65 m short (hung 0.86 m up); try 4 RUB |
| phone | Ripple Shore | 4.47 m | 3 | tries 1-2 RUB; try 3 (above) lifted at once by the outward stretch, hung 1.47 m up, 0.19 m |
| phone | Frostbell Ridge | 4.22 m | 3 | tries 1-2 RUB; try 3 lifted, hung 1.38 m up, 0.09 m |
Phone (390x844) baseline: the first runs had 2 out (the Friends strip hides while the "New stamp" moment covers a phone's play view; the harness now waits for it, then Bring friends). Re-run on a scratch copy of the tree with my
first-play edits stripped (`S/unpatch.py`, the life chunk's forgiving hit test off): `S/pre`, port 5365.
All three to three spots (desk): Home 2 of 3 done in 7 presses (41 s sim), Ripple 2 of 3 in 12 presses (54.5 s), Frostbell 3 of 3 in 7 presses (41 s).
Phone: Home 1 of 3 in 10 presses (86.5 s), Ripple 3 of 3 in 6 presses (25.0 s), Frostbell 2 of 3 in 7 presses (28.2 s). 0 console errors everywhere.

## 2. The design (owner decision D-105, recorded at the end of PLAYGROUND_BUILD.md)
Where squishies are moved around (every place; Home with two or more out = D-104's room) "how the gesture starts" decides:
- **press + drag (moving within 400 ms) = CARRY** in any direction from any part of the body: it is picked up at once (no stretch, no pick-up line), lifted a little
  (0.08 m + 0.3 R), hangs from the finger and sways (the hand's change of velocity kicks the far side back), follows on the LEVEL plane (a drag up the frame takes it
  back), rises over the things on the way (pads, mounds, nests, seats; things over 1.6 m are gone round), and is let go: slow = SET DOWN where it hangs (fall capped
  at 0.9 m/s, no snap, a pad still kicks it), fast = the published toss. Floating: carried the same, stays where it is put.
- **hold still first (a squish), then drag = the published stretch** (outward) or rub; **Shift + drag** and **a second finger on the same body** = the published pulls.
- **a second finger on ANOTHER squishy carries that one too** (touch).
- **forgiving grab**: a press within 12 px of a squishy's silhouette (and at least 22 px from its middle: a 44 px target for the smallest piece) takes it.
- Home with ONE squishy out keeps the published toy, gesture for gesture (carryOn false there).
- Hints: the gesture pill reads "Drag to carry · tap to poke · hold to squish, then drag out to stretch" in a room (Home alone: the published line); "Drag to carry"
  once ever (a moment toast, stored `wobblehoard:v2:carryTip`).

## 3. What was written (files)
- `src/input/gestures.ts` (first-play): `GestureHost.carryOn?()`, `GestureKind 'carry'`, `grab.lift`, `carryMs: 400`, the CARRY branch in `moveBody` (lone, no Shift,
  started within carryMs), `lone()`. Without carryOn (every published host) the machine is unchanged action for action (probe_gestures C6).
- `src/shell/driver.ts` (first-play): `grab` with `lift` calls `body.lift?.(slot)` (1 line).
- `src/physics/softbody.ts` (first-play, carry parts only): `lift(slot)`, `levelCarry`, LVL_* constants, the hand's rise (`lvlUp`) in updateGrabs, a horizontal-only
  lead clamp for the level carry, the sway kick (LVL_LAG) in the carry translation, the set-down in grabRelease (slow: no throw, no snap, descent capped; floating:
  the hover spot moves there), no hover spring while a floater is carried; `carryLvl` cleared wherever `carried` is.
- `src/contracts.ts`: `SoftBodyLike.lift?`, `levelCarry?` (optional, additive).
- `src/shell/game.ts` (first-play, 1 line): `pickBody` asks `life.nearBody` on a miss.
- `src/shell/lifeLink.ts`: `LifeHostLike.nearBody?` (types only).
- `src/shell/later-carry.ts` (NEW, life chunk): `overTop` (things under a footprint), `nearBody` / `hitNear` (the forgiving grab), `createHands` (a second finger's
  carry), `carryTipDue` ("Drag to carry" once, `wobblehoard:v2:carryTip`).
- `src/shell/later-life.ts` (life chunk): `carryPoint` takes a plane record (carry0 + the hands' own); the level carry: no CARRY_LEAD clamp, the hand's height kept
  over the floor and raised over things; `game.host.carryOn` / `hitTest` wrapped while attached (restored on dispose); grabAt / dragAt / dropAt / holds / dropAll route
  the second hands first; `nearBody`; `carryFrame()` in act (hands re-aim, the pill's room line, the tip); a floater let go: `floatSpot` there.
- `src/ui/hint.ts` (first-play): `HINT_ROOM` lines + `setHintRoom`; `src/ui/screens/screenCopy.ts`: the How to play Stretch card names the carry.
- `_harness/probe_gestures.ts`: sections 13 (C1-C8) and 14 (P1-P6, real physics); 3 rows re-specified for ROOMS's D-104 pan (the reason at each row; the differential
  pin holds bit for bit once D-104's pan actions are taken out). `_harness/probe_carry.ts` (NEW). `_harness/browser_carry.mjs` (NEW).

## 4. Node checks (2026-11-23)
- `node _harness/probe_gestures.ts`: **174/174** (was 160 + my 14; before my edits 3 rows were red from D-104's pan: re-specified).
  P1-P6 on 6 species: picked up on the 2nd move after the press, lowest point +0.22 .. +0.25 m, drag up 260 px = 2.0 .. 2.5 m BACK, hangs within 0.04 .. 0.11 m of
  the hand, slow let go: 0 snaps, drift 0.00 .. 0.01 m, fall 0.90 .. 0.93 m/s; flick: snap 1.00, flies 2.2 .. 2.4 m; floating: carried 1.65 .. 1.76 m, drift 0.00.
- `node _harness/probe_carry.ts`: **11/11** (K9: a napping (asleep) squishy is carried by the same drag) (real app + life host): K1 Home 3 out lift@2, low 0.24 m, back 2.19 m, drift 0.003, 0 snaps; K2 Home one out unchanged;
  K3 10 px outside taken, 45 px not; K4 two fingers carry two at once (22 frames both, moved 3.5 / 1.9 m); K5 Ripple ONE carry 5.95 m, rest 0.04 m from the spot;
  K6 over the Moss Bouncer (lowest 0.196 > top 0.12) and the pad kicks (rise 0.48 m); K7 Float drift 0.00; K8 tip once; E1 edge scroll -2.26 m vs 0.
- Cost (node, dollop, 600 frames, `S/bench.ts`): a level carry 1.071 ms/frame against the published pull-carry's 1.045 (+2.5 %: the sway kick's loop over the
  particles while in hand); a resting body 0.766. Nothing runs when nothing is carried.
- Short regression probes run so far: probe_party 10/10, probe_journal all, probe_quests all (3 NOT RUN, as before), probe_screens 43/43, probe_overlays 21/21,
  probe_optbar 42/42, shellview/lock_checks 96/96.

## 5. Browser, AFTER (real input; `WH_FROZEN=1 node _harness/browser_carry.mjs --port=5364 --places=home,ripple,frostbell --three --extras --tag=after`): 26 ok, 1 FAIL
| frame | place | front left -> back right | tries | rest from the spot | three squishies to three spots: done / presses / sim s (BEFORE) |
|---|---|---|---|---|---|
| desk | Home (3 out) | 5.38 m | **1** | 0.16 m | 3 / 3 / 18.3 s (2 / 7 / 41.0 s) |
| desk | Ripple Shore | 6.66 m | **1** | 0.10 m | 3 / 5 / 49.9 s (2 / 12 / 54.5 s) |
| desk | Frostbell Ridge | 5.99 m | **1** | 0.03 m | 3 / 3 / 16.0 s (3 / 7 / 41.0 s) |
| phone | Home (3 out) | 4.48 m | **1** | 0.07 m | 3 / 3 / 23.0 s (1 / 10 / 86.5 s) |
| phone | Ripple Shore | 4.49 m | **1** | 0.06 m | 2 / 6 / 68.9 s (3 / 6 / 25.0 s) FAIL |
| phone | Frostbell Ridge | 4.22 m | **1** | 0.08 m | 3 / 3 / 13.2 s (2 / 7 / 28.2 s) |
Every new-player carry was ONE try (before: 3, 3, 4 on the desk; 4+, 3, 3 on the phone), and the view scrolled under the hand (16 to 68 frames).
The one red: Ripple's "three spots", one spot on both frames needed more than one try (desk 2 extra presses; phone not in 4): the spots lie by the Rock Pool's rocks
and the drift log; being re-run with per-carry logs (run B).
Extras at Home, both frames: "Drag to carry" said once; the forgiving grab (10 px outside a 55 px / 28 px squishy) carries; TWO FINGERS carry two squishies at
once on the phone (15 frames both in hand, moved 3.6 m and 8.2 m); Float: carried 1.34 m (desk) / 0.95 m (phone) and stays (drift 0.21 / 0.17 m), still in the air.
0 console errors at every place on both frames. Pictures: `_harness/_renders/carry/after_*` (the mid-carry `*_carrying.png`, `*_twofingers.png`, `*_float.png`).
Judged (desk Ripple, Home mid-carry): the carried squishy is up off the sand by about a third of its height, tilted toward the hand's travel (the sway), a soft
dark shadow on the floor right under it; it reads as "in the hand". Note: at the first run max height of the centre reached 1.85 m on the phone at Ripple (the hand
was raised over a thing by the full thing height on top of the lift): the raise now counts the lift (0.08 m + 0.3 R) already under the squishy (probe_carry K6
still 0.20 m clear over the Moss Bouncer).

## 6. Browser, AFTER at the other places (`--places=ripple,hearthlog,rainleaf,lanternroof,cloudloft --three --tag=after2`): 29 ok, 1 FAIL
New-player carry front left -> back right, FIRST TRY at every place on both frames (rest from the spot): desk Ripple 0.14, Hearthlog 0.04, Rainleaf 0.08,
Lanternroof 0.07, Cloudloft 0.07 m; phone Hearthlog 0.20, Rainleaf 0.24, Lanternroof 0.09, Cloudloft 0.17 m (phone Ripple: run A, 0.06 m; in run B the harness's trip
from Home to Ripple did not open on the phone: the one red, a harness row, not a carry). With run A: **all 7 places on both frames, first try**.
Three to three spots: desk Ripple 3 / 4 / 30.5 s, Hearthlog 3 / 3 / 15.9 s, Rainleaf 3 / 3 / 15.6 s, Lanternroof 3 / 3 / 16.1 s, Cloudloft 3 / 3 / 15.7 s; phone Hearthlog
3 / 3 / 21.9 s, Rainleaf 3 / 5 / 30.5 s, Lanternroof 3 / 3 / 13.2 s, Cloudloft 3 / 3 / 13.9 s. The retries (per-carry logs in `_harness/_reports/browser_carry_after2.json`):
desk Ripple back left (-4.5, -2.9) first ended 2.8 m short by the drift log, second try 0.05 m; phone Rainleaf (0.9, -3.5) by a splash puddle: 1.44 m short, then
1.0 m long, then 0.06 m. Not traced further (time): a scripted steer that stops when the squishy's shadow is within 8 px of the spot on screen, far back where a
pixel is several cm, and things nearby.
0 console errors at every place on both frames.

## 7. Size (vite build, exit 0; `S/g0b.mjs`: html/js/css not later-*, gzip 9)
- First-play: **476,282 B** gzip against 475,648 B for the same tree with my first-play edits stripped (`S/pre`): **+634 B** (all in index.js: the physics lift /
  level carry / set-down / sway, the gesture CARRY rule, the driver and pickBody lines). The room hint lines ride in the life chunk (setHintRoom takes them).
- G0b 465 KB of 600; T1 2143.8 KB of 2250 (+2.6 KB: later-carry.ts in the life chunk); life chunk 118.7 KB raw / 44.5 KB gzip.

## 8. Regression list (the final tree; logs in `S/reg/`)
| probe | result | note |
|---|---|---|
| shellview/node_checks | 176/186 | 10 reds, the SAME 10 on `S/pre` (my first-play edits stripped, no carry gesture): ROOMS's re-laid places and camera (cabin framing to the Rocker Board, Music Box / Star Scope taps landing on the Felt Ball / old tap, AUTO chips, Go play with MED, Lanternroof gusts, the chimney and Sunbow Arch perch rows, the Puff Pad bounce); the known Shake Pine red passed this time. ONE row re-specified by me (Home keeps the published carry -> Home with the party out is a room: the drag carries it back; reason at the row) |
| probe_app | 188/188 | |
| probe_gestures | 176/176 | 16 new rows (C1-C9, P1-P7); 3 rows re-specified for D-104's pan |
| probe_carry (new) | 11/11 | |
| probe_cut | 17/17 | |
| probe_partycut | 27/27 | |
| probe_float | 16/16 | |
| probe_party | 10/10 | |
| probe_crawl | 14/14 | |
| probe_playground | 74/74 | quick set |
| probe_life | 113 ok, 15 FAIL | LF-02 known; the other 14 (LF-08/09/19/20/21/22, S05, S06) read places' zones and things at hard-coded spots: ROOMS's re-laid data. probe_life imports no file of mine (data, life and its own kinematic host only) |
| probe_life_selfuse --su4-only | SU-04 24/24 | SU-05 the known cabin flip-flop (glimglop 131.5 s) |
| probe_quests | all run pass | 3 NOT RUN as before |
| probe_journal | all pass | |
| probe_pg_data | 95 ok, 0 FAIL | |
| probe_r8_features | 9/9 | |
`npx tsc --noEmit -p tsconfig.json` clean. Not run: browser_rooms / browser_cutparty / browser_shell (their drags in a room now carry at once; their own steering
should still reach; not checked). Note for those harnesses: on a 390x844 phone an Escape with nothing open opens the Menu, and the following tap can land on its rows
(browser_carry closes it again; browser_rooms has the same Escape after boot).

## 9. Not done / risks
- Riding squishies (on a swing seat) were not carried in a check (napping: K9; resting: every carry). Pieces: carried by the same code (pickBody takes pieces), not in
  a browser row.
- A new-player carry to a spot right beside a thing (Ripple's drift log, Rainleaf's splash puddle) needed a second try 2 times in 18 "three spots" runs.
- The carry height over things uses each prop's world box (a long slanted thing is passed over a little early); things over 1.6 m are pushed round, not passed over.
- The sway tilts the carried squishy toward its travel (a visible lean, by design); judged fine in the pictures, never shown to the owner.
- First-play +767 B gzip in all (physics + gesture rule + the still let go), a little over "a few hundred"; nothing more could move to the lazy chunk without
  moving the gesture machine or the physics class.
- D-104's camera, rooms and their 24 reds above are ROOMS's; I re-specified only rows my decision changed and the 3 gesture rows D-104 changed.

## 10. The STILL let go (after the regression list; 2026-11-23)
- Found by `WH_FROZEN=1 node _harness/browser_rooms.mjs --port=5364 --places=home --only=desk` (ROOMS's harness, run on my port): its ONE carry row passed on the
  first run (rest 0.36 m) and failed on the second (rest 3.52 m): the harness rests the finger at the top edge of the frame, the room camera's edge scroll keeps
  moving the view and so the hand (2 to 3.8 m/s), and the let go read the hand's speed as a throw.
- Fix: a carry's finger that has not moved more than 3 px for 120 ms lets go of a STILL hand (`gestures.ts` STILL_MS / STILL_PX, `grabRelease.still`; the second
  finger's carry the same in `later-carry.ts`), and physics sets a level carry down on a still let go whatever the hand's speed (`softbody.ts grabRelease(id, still)`,
  `contracts.ts` optional arg, `driver.ts` passes it). A flick (moving up to the let go) is the published toss as before.
- Rows: probe_gestures C9 (rested -> still; moving to the up, a rest then a move, a cancel, a published stretch -> not) and P7 (real physics: hand still moving
  2.5 m/s, still let go: 0 snaps, stops within 0.02 m; without still: the toss, 1 snap). probe_gestures **176/176**, probe_carry 11/11.
- Re-run of browser_rooms desk Home after the fix: 10 ok, 1 FAIL (the ONE carry row). Traced (a scratch copy with logging, deleted): no throw any more (the squishy
  is set down exactly where it hung, then stays); the row's rest is now decided by the harness's own hold: after it arrives it holds the finger still IN the
  top scroll band for up to 1 s "until the squishy hangs still", while the edge scroll goes on carrying hand and squishy 2.5 m further back (the squishy cannot hang
  still while the view scrolls under a still finger). That is ROOMS's harness + edge scroll (edge scroll under a still finger is the point of edge scroll), not
  changed by me. Suggestion for ROOMS: let go on arrival, or step the finger out of the band before the hold. Its hard-toss row passed this run (it was red once,
  "carried": false, on the run before: the press did not lift; not reproduced).
- Regression list re-run after the fix (all but probe_life_selfuse): node_checks 176/186 (the same 10 ROOMS reds), probe_app 188/188, probe_cut 17/17,
  probe_partycut 27/27, probe_float 16/16, probe_party 10/10, probe_crawl 14/14, probe_playground 74/74, probe_life 113 ok / 15 (same), probe_pg_data 0 FAIL,
  probe_r8_features 9/9, probe_journal and probe_quests pass. tsc clean; vite build exit 0; first-play 476,415 B gzip (+767 B against `S/pre`, +133 B for this item);
  G0b 465 / 600 KB; T1 2144.3 / 2250 KB.
