# R15_FIX: round 15, the single engineer fixing VERDICT_R14's findings (2026-11-23)

Tree at start: HEAD e385a3490 (round 14 in the tree, clean `git status`). Live: 6c495e9c1. No git write command is run. Ports 5380 to 5383.
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r15/` (can be wiped).
If this file is all you have: every edit named below is IN THE TREE; a row is verified only where it says measured.

## Status (updated after EVERY finished item)
| item | what | state |
|---|---|---|
| F1 | probe_softbody hostile fuzz (slime inverts with HOVER_ABOVE 0.6) | **DONE, measured**: `--families-hostile` 2/2 three times; full probe 115/116 = the live count; HOVER_ABOVE stays 0.6 |
| F3 | Home back-rim let go jumps 4 m | IN PROGRESS: cause being traced on an instrumented copy; one fix written (the finger decides toss / set-down), unverified in a browser |
| F2 | Home 2+ out: 3+ things used, things in the camera's view | WRITTEN (data re-laid, LIFE room reach + rug naps, row tightened, SU-06 added); node and browser measurement pending |
| F5 | set-down in the Updraft / on the Glide Ramp top | todo |
| F4 | node_checks 185/186 | todo |
| F9 | one out at Home: toss cap and hover as live | todo |
| F11 | teach pan and zoom | WRITTEN (hint.ts view line, later-carry.ts HINT_ROOM.view, How to play card + 2 key rows), tsc clean; probes pending |
| F6 | overshoot after a set-down near a frame edge | todo |
| F7 | Cloudloft phone pinch-out straight | todo |
| BR | browser_rooms "ONE carry" desk Home: let go on arrival | todo |
| REG | the regression list once at the end | todo |

## Log

### F1 (in progress): what actually inverts the slime (measured, 2026-11-23)
- Repro of the gate's failing run alone: `S/repro.ts` (the probe's own `hostileRun`, one job; `FI=7 GI=0`): slimegoo/wrigglo "inverted mesh @frame 169" in 1.4 s.
- Traced per solver stage (a scratch copy of `src` with a hook between the stages, `S/dbg`): gravity is OFF (the fuzz toggled Float), a grab holds a patch at the
  BOTTOM of the floating body (anchor normal (-0.17, -0.97, -0.19)), the hand's reference `t0` is 2 m above the anchor (the fuzz grabs with a far target), and
  grabMove pulls down: the patch's target is `p0 + (e - t0)` = 0.35 m (later 0.8 m) UNDER the table. `reach()` floors the hand at GRAB_FLOOR_Y only with gravity on,
  so in float mode nothing stops it. Every substep the grab stage drags the patch 0.3 to 0.45 m under the table, the table stage puts it back (and sticks it:
  friction under a 0.35 m penetration), and the fold limit and the edge pass answer the sheared patch with corrections of 0.3 -> 1.3 -> 2.7 m: one particle is
  thrown 3 m out of the body (vmax at the 14 m/s clamp), the signed volume goes negative.
- The float HEIGHT is not the cause. A sweep of the same fuzz over 60 other seeds (`SWEEP=3000,60`, slimegoo/wrigglo): the tree (hover 0.6) 4 bad of 60 (1 inverted,
  3 with flipped triangles after settling); the verifier's `fb` copy (hover 0.35 = live) ALSO 4 bad of 60 (2 inverted, 2 flipped; seeds 3012 and 3042 fail in both).
  The live build passes the gate's 24 fixed runs by the luck of their trajectories; the mechanism (a pulled patch dragged under the table) is in the live build too,
  and one more instance is with gravity ON while CARRIED (seed 3042: `t0` 2.6 m above the anchor, the carried patch's target 0.8 m under the table).
- So the fix is at the mechanism, with the hover kept at 0.6 (the owner's "volume bigger").

### F1 DONE: the patch's floor (`src/physics/softbody.ts pullPatch`, `PATCH_UNDER = 0.35`)
- The change (one loop): a pulled (or locked) patch's particles are never asked for a point more than 0.35 x the rest radius under the table with gravity on, and
  not under it at all in float mode. An honest pull does not reach that floor (the hand is at the patch and stops GRAB_FLOOR_Y over the table: its lowest patch
  particle is asked at most the patch's radius, 0.36 R, less that under it), so the published pulls are untouched; the hostile ones (a hand whose start is far
  above its patch; a carried patch; any pull down in float mode) no longer shear the patch against the table. No new field, no allocation.
- Measured:
  - the gate's failing run alone (`S/repro.ts FI=7 GI=0`): passes (settles 3.03 s, volume 1.0000, shape 0.68 % R);
  - the 60-seed sweep (slimegoo/wrigglo, `SWEEP=3000,60`): **1 bad of 60** (seed 3054: 2 triangles still flipped after settling, a slow fold of the slime, no
    inversion, no NaN) against 4 of 60 before at hover 0.6 AND at the live hover 0.35 (so the build is now more robust than the live one, at the higher hover);
  - `node _harness/probe_softbody.ts --families-hostile`: **2/2 three times** (68.1 / 68.8 / 72.0 s; "0 failures, slowest settle 3.15 s, worst elastic shape 0.27 % R");
  - the full `node _harness/probe_softbody.ts`: **115/116** in 353.8 s. The one red is G1p "warmUp() covers a lone finger" (2976 B / 2976 B against 0 B): the
    SAME numbers on the live tree (`git archive 6c495e9c1`, `--late-press-child`: `{"late":[2976,2976]}`) and it was red in VERDICT_R14's run of round 14 too
    (its 114/116 = this row + the hostile row): an allocation row of this machine's node, not of this work. **115/116 = the live count.**
  - `node _harness/probe_float.ts`: 16/16.
- Not done: seed 3054's leftover fold (2 flipped triangles of a settled slime after 1500 hostile frames) was not chased; it is outside the gate's 24 runs and
  the live build shows the same class (3012 / 3022 at hover 0.35).

### State of the tree after F1 (written while the F3 trace runs; everything here is IN THE TREE, tsc clean)
- F2 data (`src/data/place_home.ts`): WIDE Music Box (3.9, 0.6) -> (2.1, 1); Warm Lamp and its glow (-4, -0.4) -> (-2.35, -1.1), use spot (-1.55, -1.6); Keepsake
  Shelf (3.7, -1.05) -> (2.65, -2.5); Bounce Pad (-3.2, 1.4) -> (-2.2, 1.35), use (-2.1, 1.25). TALL box (2.5, 0.9) -> (1.75, 0.9); lamp (-2.4, 0.3) -> (-2, 0.1),
  use (-1.71, 0.85), glow with it; shelf (-3.3, -1.4) -> (-0.4, -3.6); pad (-1.7, 3.3) -> (-1.55, 3.3), use (-1.45, 3.2).
  `node _harness/probe_pg_data.ts`: 0 FAIL with the Home row TIGHTENED (new rule, reason at the row: with two or three out the room camera by itself shows every
  thing from its fromN, footprint middle at the floor and at its top inside the frame between the HUD bands, 10 scales x 3 shapes, both frames); on round 14's
  layout that rule fails for the box, lamp, shelf and pad on both frames. DT-18 worst 50 % (the shelf, n3 / n4), at its limit.
  Dev tools added to probe_pg_data (not rows): `HOMEVIEW=1` (where the camera by itself looks, every thing's screen spot), `DT18DEF=<N>` for DT18SEARCH (only
  spots in that view), and the search now moves a thing's use spot with it.
- F2 LIFE (`src/life/brain.ts`): Home with two or more out (`w.home && w.nO >= 2`) uses the room's reach (4.8 m, as a place) and wander (4 m, 32 s); a napper whose
  own spot is not on the Snooze Rug walks to the rug's use spot (unless one is on its way there), and a nap AT the rug's use spot counts as a use of the rug at Home
  (on a phone that spot lies 0.3 m outside the patch). Home's lone squishy: unchanged (every new branch needs nO >= 2 or the rug, which shows from two out).
- F2 probe: `_harness/probe_life_selfuse.ts --home-only` = new SU-06 (Home as a room, 3 out, 180 s, low tier, both frames, a save with 4 things and one with all 6).
- F3 (first part, written): `src/input/gestures.ts` + `src/shell/later-carry.ts`: a carry's let go is a set-down when the FINGER is slower than 350 px/s on the
  screen at the let go (FLICK_V, smoothed over 50 ms), not only after a 120 ms rest. `node _harness/probe_gestures.ts`: 176/176.
  NOTE found while tracing: the gesture clock is VIRTUAL while the game is paused (clock.ts eventTime): a stepped harness's 0.25 s hold IS 250 ms to the gesture
  machine, so VERDICT_R14's jump was not a throw from a missed rest. The displacement of its failing case, (-0.87, +3.8) m, is exactly back along the finger's ray
  toward the camera: the hand's plane rose (or was taken afresh) while the squishy hung at the back. Being traced (S/f3tree, port 5381).
- F11: see the status row.
