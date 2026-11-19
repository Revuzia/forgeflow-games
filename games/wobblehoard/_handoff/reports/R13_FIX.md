# R13_FIX: round 13, the single FIX engineer (any file under src and _harness; ports 5364 to 5369). No git write command is run.

Started 2026-11-19 (UTC) at HEAD 26b7cb6ed, working tree clean. Inputs read: SESSION3.md, VERDICT_R12.md (full), R12_INTEGRATE.md.
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r13/` (`S/` below), logs `S/logs/`.
Note: at start a verifier's browser job (pg_verify_r12 `home.mjs` on :5370) and its static servers 5371 to 5373 were running; not mine, left alone.

## Status
| item | what | state |
|---|---|---|
| 1 | node_checks N1 "Go play with... on MED" + B7 x2 | DONE: the 3 rows green in every run since; node_checks 186/186 after item 1, 185/186 on the final tree (a different, chaotic row: see "Final") |
| 2 | "One squishy at a time" shown visibly | DONE: a visible toast, desk + phone (browser) |
| 3 | phone Cut tool: two-finger orbit + pinch | DONE: yaw -0.008 -> -1.171, distance 13.27 -> 11.29, 0 cuts (browser) |
| 4 | crawl retune (forward slug, <= 1.1 Hz, <= 12 % vertical) | DONE: <= 1.0 Hz every family, height swing 6.5..11.1 %, probe_crawl --full 14/14 |
| 5 | naps at places (one at a time, <= 20 s, never HELD) | DONE (code); SU-04 24/24 on it; no place-visit browser run |
| 6 | Float: fling carries, face camera, gap | DONE: probe_float 16/16 (F7 re-specified), browser 6/6 |
| 7 | Cloudloft tall uses, stuck, toss inside | PARTLY: SU-04 Cloudloft tall 3 / 5 / 3 on three seeds; toss clamp in code, not run in a browser |
| 8 | tooltip hide 2 s; tick attack | DONE (code; no browser asked) |

## 1. node_checks N1 + the two B7 rows (DONE; product fixes, no row re-specified)
Baseline on this tree (`node _harness/shellview/node_checks.ts`, 117 s): 183/186, the same 3 reds as VERDICT_R12 (B7 "5 of 24, longest 2 s"; wake gate 23 of 144 = 16.0 %;
N1 Home keepsakeshelf `sleptOnWalk 3`). Traced in a scratch copy (`S/w/`, overBudget and the asked walks logged; `S/logs/ob1.jsonl`, `S/logs/nc_w2..6.log`).
- **B7 cause**: at every over-cap moment the rule asked only its first candidate (the farthest) to sleep, physics refused it (not at rest) for 1 to 2 s, while
  the other awake squishies stood still (centre speed 0.00 to 0.01 m/s) and could have slept. Fix (`src/shell/later-life.ts` overBudget): the candidates are
  tried in the same order, but one physics can put to sleep NOW is taken first; only if none can, the first refused one is hushed (and at Home the farthest
  LIFE scoot stopped), as before. A first version slept a still squishy a walker was pushing past and the walker woke it every frame (13.2 % over): the round-10
  rule "the body a LIFE walker touches is not slept" now applies at Home too. The rule allocates nothing (its counts are host-scope).
- **N1 causes** (three, one after another as the trajectory changed): (a) Home, the asked walk to the Keepsake Shelf stopped head-on against the resting Felt
  Ball, the body fell asleep and the walk ran out (no unstick at Home); (b) the cabin's yarn ball asked of a squishy RIDING the rocker waited 7.3 s (RIDE holds
  every other choice for 20 s); (c) the cabin's asked Snug Basket (a ring) was walked at straight through its wall.
  Fixes: physics counts a glide a static prop stopped head-on (`metrics.scootBlocks`, additive in `src/contracts.ts`; `src/physics/softbody.ts`) and a fresh
  scootTo is no longer killed by the last glide's stale block flag; the host (`later-life.ts` detour) answers a block on an ASKED walk with a small side hop
  (carryTo 0.5 s, 0.45 m to the side the thing leaves free, leaning away from it; as the places' unstick) and the glide goes on to LIFE's target (at most 6
  steps a walk; inside the bounds, clear of the others; a plain scoot leg was held at once by the wall's friction in the trace, so the leg is a hop);
  playWith ends a ride the asked squishy is on (hopping down off a raised seat) so the walk starts at once; LIFE (`src/life/brain.ts` runUse) walks an asked
  NEST (ring) by its mouth's waypoint first when it stands anywhere but the mouth's side.
- After (`S/logs/nc_1g.log`): **node_checks 186/186**. B7: over the cap in **1 of 24**, longest 1 s; wake gate **2 of 144 (1.4 %)**; N1: every asked walk starts
  at 40 to 50 frames (0.7 to 0.8 s), never asleep, Keepsake Shelf used at 6.3 s, Snug Basket walked 1.72 m, the yarn ball at 0.7 s (was 7.3 s).

## 2. D-99's "One squishy at a time" shown (DONE)
`src/shell/cutText.ts` `oneAtATime` (the line, unchanged words); `game.ts` emits it as before (notice: the live region, probe_partycut C3's hook); `cutBinding.ts`
also SHOWS it: on that notice a toast (`hudBinding.ts` passes `show` = an info toast, 3.2 s, `say: false` so the live region does not get it twice).
Browser by real input (`S/scripts/b_cut.mjs`, vite :5364, three out by + Friends / Bring friends, Cut tool by the dock, a stroke cuts a friend, a stroke across
another): **desk** toast "One squishy at a time: Reconnect all, then cut another." at 420..860 x 64..108, opacity 1, live region has it (`S/shots/r13_one_at_a_time_desk.png`);
**phone 390x844** toast 16..323 x 65..118 (`S/shots/r13_one_at_a_time_phone.png`); nothing cut, Reconnect all whole, 0 console errors on both.

## 3. Phone, Cut tool: two fingers turn the view and pinch-zoom (DONE)
`src/shell/game.ts` (pointerMove, Cut tool, 2 view pointers): the midpoint's travel orbits (half of the moving finger's delta) and the spread's change zooms in the
Hand's units (`DEFAULT_GESTURE_CONFIG.pinchPxPerNotch` px a notch); Snap's two-finger pinch is unchanged; a second finger still drops the stroke (nothing is cut).
Browser, phone 390x844, CDP touch: two fingers moved 150 px right together: camera yaw **-0.008 -> -1.171 rad**, pieces 1; a pinch 90 -> 210 px: camera distance
**13.27 -> 11.29**, pieces 1; a one-finger stroke afterwards still cuts (2 pieces) (`S/logs/b_cut.log`, `S/shots/r13_twofinger_orbit_phone.png`).

## 4. The crawl reads as a forward slug (DONE; `src/physics/crawl.ts`)
Measured first with a new meter (`_harness/crawl_measure.ts [families] [size] [firmness]`: a 2 m walk on the flat at the family's glide; in the steady part the
crawl's own cycle (Hz), the body's height and length extents as % of rest): before, EVERY family's height swung 28 to 54 % (firm 30 %, putty 54 %) and the firm
ones cycled 1.3 to 1.5 Hz at the template size (faster on a small body: the verifier's Chunkle 2.1 Hz). Changes:
- the cycle is capped per family (`CRAWL_FMAX`: firm 0.9 Hz, pop / gummy / beads / dough / putty 0.8, marshmallow / slowrise / sticky 0.9, jelly / water /
  slime 1.0): one cycle per stride OR per 1/fMax s of glide, whichever is longer; a longer stride takes the grip share down by sqrt(stride0 / stride) so the
  strain grows only by the other sqrt (a first try at 0.75 Hz for firm without it blew the firm body up: 29 safety resets; at 0.85 / 0.9 none at any size);
- every family but the slime, the jelly and the water-filled (kept exactly as they were, the look the verifier liked) puts the wave's volume into WIDTH:
  bunch height share 0.08..0.12 (was 0.3..0.4), hump 0.25..0.35 (was 1.6..1.9), the head lift negative (-0.03..-0.05: the front reaches forward and LOW);
  their stride share lengthened (firm 0.42 -> 0.72, pop / gummy 0.66, slowrise 0.6, marshmallow 0.56, sticky 0.58, dough 0.68, beads 0.66) so the stretch
  along the travel stays visible (CR-01) and the base still grips (CR-06).
After (template size; `S/logs`, crawl_measure): cycle 0.31..1.00 Hz (firm 0.86..0.90, never over 1.0 at sizes 0.05 / 0.5 / 0.95); **height swing 6.5 to 11.1 %**
(retuned families, all sizes, firmness 0.1 / 0.9), length swing 21 to 34 %; slime / jelly / water unchanged (27.7 / 31.3 / 32.0 % height, as before); 0 safety
resets at any size. **probe_crawl --full 14/14** (`S/logs/crawl_full2.log`): CR-01 osc 12.2..18.3 % (bar 12, not changed), CR-06 slip 0.21..0.27 (bar 0.4),
CR-09 small / big / pieces ok, CR-12 cost ok; no number re-set.
Filmed (`S/scripts/film_crawl.mjs`, real Wake tap, a firm Boingle revealed by the dev reveal, 2 friends, the sim stepped until it walks on its own, 8 frames over
one 1.11 s cycle): `_shots/crawl_r13/firm_desk_f0..7.png` (1280x800), `firm_phone_f0..7.png` (390x844), `film.json`. My judgement as a demanding designer: on
the desk the body stays low and long the whole cycle; the front stretches forward and dips (f0, f5: a long low bean led by its face), the rear draws in and
bunches a little (f2), the top line moves a few pixels only: it reads as a slug's crawl, slow and weighty, not a pump. On the phone it walks toward the camera:
round-to-oval forward lean, no tall pillar in any frame. Not filmed: the 0.75-Hz-or-slower "heavy" variant (unstable, above).

## 5. Naps at places (code DONE; numbers below once SU-04 has run)
`src/life/brain.ts`: `napTurn` (a place, not Home: no new nap while another of the party naps, unless more than three wholes are out), on both nap choices;
`startNap`: at a place every nap is 12..20 s (the walk to its spot included; Home keeps 30..90 s). `src/life/world.ts` `lifeShowsAwake` (in a moment or RIDE):
`later-life.ts` never DRAWS such a squishy asleep (`stage.setBodyAsleep` only when its body sleeps AND it is neither riding (host RIDE flag or LIFE's RIDE) nor
in a social moment); its body may still sleep for the awake budget (still, eyes open), so node_checks' B7 rows are untouched. The host's dev view now has
`drawnAsleep` beside `asleep` (and `r`, `face`).

## 6. Float: a fling carries, floaters face the camera and keep a gap (code DONE; checks below)
- `src/physics/softbody.ts` (FLING_V 0.6 m/s, FLING_STOP 0.08, FLING_DRAG 1.8 /s, FLING_HOME_R 0.9 m): let go moving faster than FLING_V AWAY from its hover spot (a
  stretch let go springs back toward it: no fling), the spot follows the body while only FLING_DRAG slows it; then the spring holds it there. Inside the place's
  bounds less 0.8 r + 0.1 m; at Home within 0.9 m of where the first fling found it, and Table puts Home's spot back. Node trace (`S/scripts/fling.ts`, a
  jelly, 0.6 m in 0.1 s by a grab): before, back to 0.00 m in 1.5 s; after, it drifts 0.63 m and rests there.
- `src/physics/crawl.ts` `floatFace`: a floating body (once its crawl has faded) yaws slowly to face +Z, the camera's side (tau 0.9 s, at most 1.2 rad/s).
- `later-life.ts` `floatGap`: 10 times a second two floaters at rest closer than r1 + r2 + 0.1 m get their hover spots moved apart by a third of the shortfall,
  inside the place's area (`floatSpot`, also used by floatHome).
- `_harness/probe_float.ts` F7 RE-SPECIFIED (reason: this owner request): "does not turn while floating" became "turns only toward the camera (never away by
  over 2 degrees), under 90 degrees a second, within 10 degrees of +Z after 4 s"; the crawl part unchanged.

## 8. Small (DONE)
- Tool caption chip ("Table  Rests on the table" over the Friends button on the phone): `hudBinding.ts` also hides it once 2 s of game time OR wall time have
  passed since it showed (its own 1.4 s timer stays the usual way; VERDICT_R12's stepped phone run saw it stay until the next touch).
- `src/audio/things.ts` tick: a 1.5 ms raised-cosine attack then the exponential fall, 6 ms in 24 points (it jumped from 0 to 0.78 of its level in 0.25 ms).

### 5, numbers: `node _harness/probe_life_selfuse.ts --su4-only` (`S/logs/su4_a.log`, 11 min, the tree with items 1 to 5): **SU-04 24 of 24 ok, SU-05 none**; tall:
Hearthlog 5, Ripple 3, Frostbell 3, Rainleaf 5, Lanternroof 5, Cloudloft 3; wide: 4, 4, 6, 5, 3, 3 (low = high). Not measured: a browser place visit with the
verifier's ASLEEP / NAP / HELD meters (no time); the rule is in the code and the dev view's `drawnAsleep` is there for the next verifier.

### 6, the checks
- **probe_float 16/16** (`S/logs/float3.log`). Two first versions failed and were changed: F4 "Table at Ripple" (a 6 m/s SHOVE in the air carried the body over the
  Rock Pool, which then floated in it after Table): a fling now needs the HAND (within FLING_ARM_S 1 s of a grab's or a finger's release); F2 (Capnap, a tall
  slowrise, rose 0.22 m against a 0.25 m bar once the crawl stopped pumping its centre down at the row's rest snapshot): the hover is now over the higher of
  the rest radius and the rest CENTRE (every squishy rises at least 0.35 m over where it rested). A pull on a floater now yields to the hand (spring x 1.5
  under a grab, was x 6.5; a press or poke keeps the stiff hold).
- **Browser, real mouse, desk 1280x800, Home, three out** (`S/scripts/b_float.mjs`, `S/logs/b_float8.log`, shots `S/shots/r13_float_*.png`): Float by a click on
  the dock; 6 s later every floater faces the camera (0, 0, 0 degrees) and the closest pair keeps 0.177 m between their discs; a pull-fling (press 0.35 r right of
  the centre, 320 px outward in 0.1 s, let go) carries it **0.28 m** in the throw's direction and it **stays** there (drift 0.00 m over the next 3 s; before
  this round: back to 0.00 m); Table by a click brings all down; 0 console errors. (A 320 px INWARD stroke is a rub, not a pull: it moves a floater 0.16 m.)

## 7. Cloudloft in the tall layout (PARTLY)
- Variety: in a place every LIFE walk (not only an asked one) now steers round a thing it meets head-on (item 1's detour hop), except within 0.5 m of a
  by-itself walk's end (a bump, a lean on the log mean to touch). `node _harness/probe_life_selfuse.ts --su4-only places=cloudloft [seed=2|3]`
  (`S/logs/su4_cloud.log`): **tall low / high: 3 / 3 (default seed), 5 / 5 (seed 2, with the Puff Pads, the Updraft and the Kite Swing), 3 / 3 (seed 3)**;
  wide 4, 6, 5; SU-05 none. Bar (at least 3 on three seeds) met in the node rig; the verifier's browser phone run (2 at high) is NOT repeated here.
- The toss: `later-life.ts` `tossInside`: a toss let go in a place keeps at most 0.4 + 2.0 x (its room before the nearest edge) m/s of speed toward that edge,
  the rest is nudged back, so it lands inside (VERDICT_R12: 0.6 m out, physics' bounds rim). NOT run (no browser time left); `counts.tossIn` counts it.
- The 10.5 s stuck squishy: not traced; the detour hop acts on head-on blocks by things (the arch posts, the pads' rims); a squishy held by another body is not
  covered.

## Late changes after the first sweep attempt (16:00 UTC)
A first final sweep (node_checks first) gave node_checks **184/186** with two NEW reds that are not this round's rows (Home's Music Box through-click: the
squishy set before the box had walked 0.4 m away; the cabin's swing rider AUTO row). node_checks is chaotic: every row after Home runs on one shared trajectory,
so any change to how squishies move moves which fragile row lands red. Traced in scratch copies (`S/w/`, one change reverted at a time, `S/logs/nc_bis*.log`):
with the HEAD crawl the reds were the Shake Pine and the Sunbow Arch perch rows; with the place-wide detour off, the D-95 seat-press row. Changes kept:
- `crawl.ts` CRAWL_KEEP: the slime, jelly and water-filled families, when their cycle is capped, keep their strain exactly (grip share x stride0 / stride):
  their look as before, only slower (Dollop's capped walk had grown its wave by sqrt(k)).
- `later-life.ts`: a by-itself walk on TOP of a raised thing (its prop 0.25 m up or more: a perch, the arch's bar) is never detour-hopped off it (the Sunbow Arch
  row's squishy set on the top bar); a flush pad is walked over as the floor (a first version that spared every walk on any prop cost Cloudloft tall its Kite
  Swing: SU-04 2 / 2 in the full run, back to 3 / 3 with this).
- The one red left (`S/logs/nc_2b.log`, `S/logs/nc_final.log`): "D-95 the hand on the seat: a mouse press on the Pillow Swing's seat is the host's": traced
  (`D95DBG`): at the press (640, 373) the play squishy Dollop stands in FRONT of the seat (its screen centre 713.7, 417, z -0.61 against the seat's -1.7), so the
  press is Dollop's (a press on a squishy is the squishy's, as published); the row assumes nothing covers the seat. Not fixed, not re-specified.

## Final (16:45 UTC; the tree as left; `S/logs/final/`, `S/logs/nc_final2.log`, `S/logs/su4_final.log`)
- `npx tsc --noEmit -p tsconfig.json`: exit 0 after every step and at the end.
- `vite build --outDir S/dist`: **exit 0**; [G0] 2532 KB of 3072; [G0b] first play 464 KB gzip of 600; **[T1] 2111.1 KB of the 2250 KB cap** (R12: 2104.2).
- shellview/node_checks **185/186** (baseline 183/186): N1 and both B7 rows ok (B7 over the cap 1 of 24, 1.4 % of fine samples); the one red is the Shake Pine
  row ("tap: body": the squishy set 0.45 m before the branch stands over the trunk's tap point at the click; a click at a PLACE has no through-tap; chaotic: in
  other configurations of this round it was the D-95 seat row or the Music Box row instead, each a squishy standing over the point a row clicks).
- probe_app 188/188; probe_gestures 160/160; probe_cut 17/17; probe_partycut 10/10; probe_float 16/16 (F7 re-specified); probe_party 10/10; probe_crawl 14/14
  (quick; --full 14/14 earlier); probe_playground 74/74 (quick); probe_life 127/128 (LF-02, known); probe_quests all run pass (3 NOT RUN, as before);
  probe_journal all pass; probe_pg_data 44 ok / 1 FAIL (DT-18 silhouette, known); probe_r8_features 9/9.
- probe_life_selfuse FULL (1938 s, the tree before the last perch refinement): SU-01 6 of 6 places ok, SU-03 ok, SQ-01 ok; SU-04 22/24 (Cloudloft tall 2 / 2,
  fixed by the refinement) and **SU-05 one flip-flop** (Hearthlog, an SU-01 party: Puddlo 4 switches ZONE > NOTICE > MOMENT > BASK > WANDER in 5 s, 0.004 m;
  the cabin keeps no hysteresis by R11's rule). Then on the final tree `--su4-only`: **SU-04 24/24, SU-05 none**. The full run was not repeated on the final tree.
- Processes: none of mine left (vite on 5364 stopped by each script; the verifier's 5370..5373 untouched).

## Not done / open
1. node_checks: the Shake Pine row (above) is red on the final tree: a row-setup sensitivity, not traced to a product fault; not re-specified.
2. SU-05 Hearthlog flip-flop in the full SU-01 sweep (one party, once); not traced.
3. Item 7: the tall Cloudloft toss clamp and the 10.5 s stuck squishy are not verified in a browser; SU-04 tall 3 on three seeds is from the node rig.
4. Item 5: no place-visit browser run with the verifier's NAP / HELD / all-asleep meters.
5. Item 4: the "heavy" firm cycle is 0.9 Hz (0.75 Hz blew the firm body up); the crawl was filmed on Home only (not a place).
