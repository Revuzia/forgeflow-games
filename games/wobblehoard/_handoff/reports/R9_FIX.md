# R9_FIX: round 9, the single FIX engineer (any file under src and _harness; ports 5364 to 5369). No git write command is run.

Brief: the orchestrator's round-9 task (the last step before the owner's deploy). Started 2026-11-18 at HEAD 57ba5b747 (round 8's tree, tsc clean, all seven places shipped).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r9_fix/` (`S/` below).

## Status (updated after every finished item)
| item | what | state |
|---|---|---|
| 1 | phone Cloudloft U2 "Boing on the puffs" 1 of 3 (R8_SHELL 6B (9)): trace, cause, fix | DONE: node trace 1/3 -> 3/3; browser (br1) phone U2 3/3, desktop U2 3/3 |
| 2 | SU-01 >= 3 things for 5 of 5 parties at all six places over >= 2 seeds; per-place min / median / max | DONE: both seeds all selfuse checks passed at the tightened 5-of-5 bar; every place min 3 (table at the end) |
| 3 | Cloudloft corral walk back after a hard left toss (6B (10)); Frostbell tall Shake Pine branch at x 383 of 390 (6B (8)) | DONE: phone left toss rests at x -1.53 (inside); pine turned round: branch at x 322 of 390, I4 ok (tap "shakepine"), I9 ok 5/5 (br2) |
| 4 | Home: every Home thing clickable with parties 1..5 (DT-18 tap point; browser row 1280x800 3 and 5 out, 390x844); DT-01 Home WIDE snoozerug n2 | DONE: option (c) the through-tap; DT-18 tap-point row ok; browser r9-home-things 4/4 (desktop 3 and 5 out, phone 3 and 5 out); DT-01 Home ok |

## Machine note (21:00)
Two orphaned round-8 browser runs were running on port 5366 when I started (the cut-off R8_SHELL's `final_jobs.sh` chain on `S8/tree_final4`: `finalB3`, then
`finalC` = trophies / lock / photo / b4b checks; parent PID 1). My kill was refused by the permission system, so they keep running; my browser checks use port
5368 (one heavy job of mine at a time). finalB3's result, for the record (R8's tree, two instances sharing one port): 44/47, FAIL desktop R9 "Slide off the mound"
1 of 2, R7 squirt (soak 0), I7 "Down the glide ramp" 1 of 2.

## 1. Phone Cloudloft U2 "Boing on the puffs": 1 of 3 (cause found by a trace, fixed)
**Trace** (`S/x/u2.ts` on `S/x/rig.ts` = probe_life_selfuse's rig: the real physics and the shell's life host, 390 x 844 so the TALL layout, the browser's
party Dollop + Wisplet + Chunkle at Cloudloft; the browser row's dropOnto: set down 0.8 m in front of the front pad (-1.58, -1.67), picked up again, carried back
over it at carry height, let go; every body's height and onProp every 3 frames): **1 of 3, as the browser**. Drop 1 (Dollop): falls from 1.32 m, five kicks
(y 0.36 -> 0.62 -> 0.38 -> ...), one USE BOUNCE. It then comes to rest ON the pad (onProp 2, at (-1.59, -1.70)) and stays there for the rest of the run.
Drop 2 (Wisplet): let go over the pad at 1.10 m, it lands on Dollop's head and rests there at 1.22 m (onProp -1) for 2 s, then slides off beside the pad: no
kick. Drop 3 (Chunkle): let go at 1.29 m, slides slowly down Dollop's side to 0.80 m and off the pad: no kick. PH-16 drops one body on an empty pad, so it
passes; the browser differs because **the pad is taken by the squishy that bounced before** (the desktop alternates two pads, so it passed there).
**Fix (src/shell/later-life.ts, the life chunk; not first-load)**: a squishy at REST on a pad in a place (not touched, carried or airborne, slower than
0.3 m/s, onProp a pad part) for `PAD_REST_S` 1.5 s (longer than any family's sticky hold before a kick, 0.6 s) hops off it (`padOffHop`: carryTo, as
perchDown, 0.9 s) to the floor pad radius + its own + 0.15 m from the pad's middle, toward the play area's middle, or the nearest direction in 0.45 rad steps
whose spot is inside the bounds and clear of every pad part and of the other squishies. It also ends round 7's "a body left on a pad's rim stays pinned there for
the visit" (R7_LIFE). Home's Bounce Pad is unchanged (the party row stands in front of it; Home's rows are pinned).
**After** (same trace): **3 of 3** (Dollop, Wisplet, Chunkle each one USE BOUNCE; Dollop hops to (-0.40, -1.86) within the 2.5 s gap).

## 3. Cloudloft's corral after a hard toss; Frostbell's Shake Pine on a phone (code done; browser rows pending)
**(a) The toss.** Traced on the real physics with the host (`S/x/toss.ts`, 390 x 844, Dollop set at rest where R8's toss landed, (-1.908, -2.726), 0.12 m past the
tall bounds' corner): it fell **asleep at once** and the bounds corral (physics setBounds) does nothing to a sleeper; woken 2.5 s later, the corral's glide took it
back at ~3 cm/s (0.12 m in 3.5 s: the glide ramps with the distance out). So R8's "6 s later 0.07 m outside" is the corral's slow glide plus sleep. **Fix
(later-life.ts, life chunk)**: a squishy at REST outside the place's bounds (not touched, carried, airborne, locked or riding; slower than 0.3 m/s; centre more than
2 cm out, the corners rounded as physics rounds them) for `OUT_REST_S` 0.6 s hops back in (`backIn`: carryTo 0.7 s to the nearest spot IN_MARGIN 0.15 m inside
the edge, a little more at a rounded corner). Same trace after: back in within 0.5 s (x -1.53); it then stood with a foot on the first Puff Pad's rim and the pad
hop (item 1) took it to (-0.65, -1.47) at 3 s. A second spot (-2.1, 1.0): back to x -1.64 (inside 1.8).
**(b) The pine.** The tall layout's Shake Pine stood at (1.55, -0.55), its branch (which points +x: render and physics both build it along +x) at x 1.92, 383 of
390 px, and the squishy the I4 row sets "under the branch" (branch + (0.2, 0.3) = (2.12, -0.25)) could only be carried to the reach's edge, in front of the trunk.
**Fixes**: (1) data (`place_frostbell.ts` tall things[6]): the pine stays at (1.55, -0.55) and is **turned round (yaw pi)**: physics builds the branch
along the thing's local +x and the render poses it from physics (place.ts movers, moverKind 1), so the branch now reaches IN over the floor (centre about x 1.18,
inside the bounds; DT-01 Frostbell tall 0 problems, 0 in the shipped camera: the footprint is the trunk's). First tried: the left edge (-1.5, -0.6) (DT-01 ok), but
the browser run (`S/br1.log`) showed its crown in front of the Icicle Bells on the phone: I9 "Ring the icicles" 0 of 5 (the crown took the taps); right-side spots
further in all broke a spawn or pad rule ((1.05, -0.3), (1.0, -0.45), (1.1, -0.5): "0.9 m from a spawn"; (0.95, -0.2): the pad's 1.2 m); (2) product (later-life.ts `crownTap`, as round 8's leafTap): the pine's drawn snowy crown (three cones,
1.25..2.65 m, radius 0.5..0.28, frostbell.ts) takes a press that reaches it before any prop and any squishy: a tree is tapped on its crown, which stands above every
squishy, so a party in front of the trunk no longer hides the whole pine; (3) harness (I4): with no part clear, the tap goes to the crown's middle (1.9 m up over
the trunk, the dev view's projection) instead of the trunk's centre; the assertion is unchanged.
node_checks after items 1 and 3: **184/184** (`S/nc1.log`, 103 s).

## 4. Home: every Home thing clickable with 1 to 5 out (option (c): the through-tap)
**Chosen: (c) a still tap on a RESTING squishy that covers a shown Home thing goes to the thing** (later-life.ts `throughTap`, life chunk): at Home, a press released
within 350 ms and 12 px whose ray meets one or more resting party squishies (not carried, not scooting, slower than 0.15 m/s, on the ground) and then a shown Home
thing's collider is the thing's tap (the box's tune, the lamp, the shelf's bell, the pad); the squishy's finger lifts with no tap (the gesture is cancelled: no
poke). A press that moves or holds stays the squishy's (a pull, a squeeze); a squishy LIFE is moving still takes the press; places keep "a squishy in front takes
the press". **Why (c)**: (a) a row that leaves gaps or shifts and (b) a squishy that steps aside both move bodies at Home, whose slots and framing the published
Home rows and LIFE's camera model pin (R8_SHELL 5 (7): a thing 1 to 2.4 m behind a 1 m squishy shows over it only from ~43 degrees of pitch; R8_LIFE's search found no
data spot for the box), and (b) needs a hover a phone does not have; (c) changes no geometry, only where a still click on that exact spot goes. The life chunk wraps
`game.input.pointerUp` while attached (dispose gives it back), so no first-load file changed for it.
**Found on the way**: (1) the Warm Lamp's drawn shade (0.2..0.6 m, homekit.ts) had no collider: a click on the shade was a miss even with nobody in front
(DT-18's tap point, the silhouette's middle at 0.3 m, is on the shade): `homeShadeProp` lets the drawn upright box take the press. (2) **Home's Bounce Pad was never
shown** (`arrived()`: `case THING_PAD: return false; // pads ship in S2`): it now arrives with the cabin's finale (C8), as its data says (`arrives: finale:hearthlog`).
**DT-18** (probe_pg_data) is two rows now: the silhouette part (at most 50% hidden) unchanged and still FAILING (the owner's layout call; the through-tap does not
change what is seen), and the **tap-point part: ok**, re-specified with its reason at the row: a tap point behind RESTING slot bodies (every slot body of the model
rests at its slot) is reachable through the through-tap, pinned on the product's code (`throughTap`, `homeShadeProp`; the row fails without them). The row lists the
tap points that rely on it: TALL keepsakeshelf (n2), WIDE musicbox (n3), WIDE warmlamp (n3), WIDE keepsakeshelf (n2), WIDE bouncepad (n4).
**DT-01 Home "WIDE snoozerug: use spot n2 not wholly in view"**: already fixed by R8_LIFE's re-lay (useSpot (-0.42, -0.91), R8_LIFE section 4); verified: DT-01 Home ok
on this tree.

## 2. Three to five different things per visit at every place (the variety floor)
**Baseline** (`S/su_a.log`: probe_life_selfuse, 5 parties x 300 s x 6 places, the shipped seed, the tree with items 1 and 3; min / median / max of different
things per visit): Hearthlog 5 / 5 / 6, **Ripple 2** / 4 / 5, Frostbell 4 / 5 / 5, Rainleaf 5 / 5 / 5, Lanternroof 4 / 4 / 5, **Cloudloft 2** / 3 / 4 (SU-01 FAIL
there, 3 of 5). Traces (`S/tr_cloud3.log`, `S/tr_rip1.log`, `S/x/arch.ts` on the real physics and host) of the parties that used two things: (1) a putty held
against the Sunbow Arch's post for 100+ s, every walk going nowhere; (2) the arch's use point (its very middle, then "toward +z") caught a post on a slanting way in,
and the walk was retried again and again; (3) dozy families curled up early (a slime goo + putty party spent ~40% of the visit asleep); (4) the over-budget rule
(D-61) stops or sleeps the squishy FARTHEST from the middle first, which is the one walking out to the place's things; (5) LIFE's pad use was off (PADS_OK, the rim
pin of R7) and a walk onto a flush pad stopped at its rim.
**Changes (LIFE + the host's chunk; the attention budget's cap, usesFull and the cooldowns are unchanged)**:
- `life/world.ts` the **variety floor**: `VARIETY_FLOOR` 3, `partyDistinct`, `varietyFloorOn` (a place of several kinds, the party's own by-itself things this visit
  under 3), `lifeSeeksNew(w, i)` (on its way to a thing nobody in the party used yet, while the floor is not met).
- `life/brain.ts`: under the floor a thing nobody used yet scores `NEW_PULL` 0.35 more and draws from anywhere in the place; such a use holds on `SEEK_KEEP` 0.3 more
  against other behaviours; a dozy squishy does not curl up early and a nap is 20..35 s (not 30..90 s); in a place of several kinds a walk that times out or is
  blocked short of its thing marks that thing tried for that squishy; the ARCH use point is in the arch's opening 0.3 m out on the squishy's side, across the
  arch's span whatever its yaw; **PADS_OK on** (the host's pad hop of item 1 ends the rim pin), and a PAD hop is made with the centre anywhere over the pad 0.1 m
  inside its edge (physics kicks a landing whose centre is over it).
- `shell/later-life.ts`: the over-budget rule spares a squishy LIFE reports as `lifeSeeksNew` (as it spares an asked one: another is stopped or slept); a LIFE
  scoot toward a spot more than 1 m away that makes no headway (3 cm in 4 s) is lifted 0.6 m toward it (`unstick`, carryTo, inside the bounds, clear of the others).
- `_harness/probe_life_selfuse.ts`: `seed=N` (LIFE's world seed through the host's new optional `deps.lifeSeed`, and the party genomes' seed) and an info line per
  place with the min / median / max of different things.
Quick checks (single place, 5 parties, the shipped seed): Ripple 4 / 5 / 5, Cloudloft 2 / 4 / 4 (the slime goo + putty party: its kinds there are the ball, the nest
and the arch). probe_life 127 ok / 1 (LF-02, known), probe_pg_lifequests 16/16, probe_chatter 42/42, probe_quests all run checks, probe_journal all, probe_app
188/188, probe_gestures 160/160, pg_node_checks 40/0, probe_trophies 31/31, probe_merge 22/22, probe_r8_features 9/9, probe_pg_data 44 ok / 1 (DT-18 silhouette).

## Browser run 1 (`S/br1.log`, tree `S/tree1`, port 5368, `--only=pg-places-phone,pg-places-s3,pg-places-s3-phone,r9-home-things --places=frostbell,cloudloft --trace`; 42/49)
`--places=` (new, dev only) runs only those places' blocks; the sections' opening rows about the OTHER places then fail by construction (2 rows: "a save of 28 stamps
opens ...", "the Places sheet lists ..."), not counted below.
- **Cloudloft desktop**: every row ok (U2 3/3 on the two front pads, U3, the ball, the Auto chip rows, the right toss, home again, 0 console errors).
- **Cloudloft phone**: **U2 "Boing on the puffs" ok, 3 of 3** (the trace: after each drop the dropped squishy hops off the pad within the next carry); **the hard
  toss toward the left: ok** (worst -0.381 m in flight; 6 s later at (-1.53, -2.73), inside the 1.8 x 3.0 bounds).
- **Frostbell phone** (with the pine at the LEFT edge, since reverted): I4 "Snow from the pine" **ok** (tap "shakepine": the branch at x 129 px), but **I9 "Ring the
  icicles" 0 of 5**: the crown stood in front of the Icicle Bells. The pine is now turned round at its round-8 spot instead (section 3); browser run 2 re-checks I4 and I9.
- **r9-home-things**: desktop 3 out: Music Box, Warm Lamp (**through a resting squishy**, covered), Keepsake Shelf (through, covered) ok, Bounce Pad "body" (4 tries);
  desktop 5 out: the pad "body"; phone 3 and 5 out: the shelf "body" (covered by 1 to 2 squishies). Cause looked for: a body the budget put to sleep mid-scoot kept its
  scoot flag, which my rule read as motion; the rule is now "asleep, or not carried, not airborne and slower than 0.3 m/s" and the dev view says why a through-tap
  was refused (`life().through`). LIFE's own pad use (PADS_OK, item 2) is kept off Home's Bounce Pad. Browser run 2 re-checks.

## Browser run 2 (`S/br2.log`, tree `S/tree2`, `--only=r9-home-things,pg-places-phone --places=frostbell`; 17/23, the 2 filter rows excluded)
- **Frostbell phone with the pine turned round**: I4 "Snow from the pine" **ok** (tap "shakepine", the branch's centre at x 321.8 px, inside the frame), I9 "Ring the
  icicles" **ok 5/5**, I7 ok, "three things on their own" ok, home again ok, 0 console errors. Item 3 is done.
- **r9-home-things**: the through-tap took every covered press (`through` in the dev view: "through bouncepad (1)", "through keepsakeshelf (2)"), but the Keepsake
  Shelf and the Bounce Pad have NO tap of their own in tapThing (it set the dev view's id and returned false; with nobody in front the old row read the id and passed),
  so the through path fell back to the squishy: desktop 3 and 5 out: the pad "body"; phone 3 and 5 out: the shelf "body"; every other thing ok (the Warm Lamp and the
  shelf through a covering squishy on the desktop). **Fix**: a thing with a voice and no tap of its own answers a tap with its voice (the shelf's bell, a pad's boing,
  the ramp's whoosh) and is noticed (lifeThingTap), no USE record; the through-tap counts a thing that takes the tap with nothing to do. Re-run pending.

### SU after the floor, the shipped seed (`S/su_b.log`, 5 parties x 300 s x 6 places, 16 min alone on the machine): **all selfuse checks passed**
min / median / max different things per visit: **Hearthlog 5 / 5 / 6, Ripple 3 / 3 / 5, Frostbell 4 / 5 / 6, Rainleaf 3 / 5 / 5, Lanternroof 4 / 4 / 5,
Cloudloft 3 / 4 / 4**: every one of the 30 visits used 3 or more (5 of 5 parties at every place). SU-02 6 of 6 places; **SU-03 ok: most 7 use episodes** (bar 8);
host USE records per squishy and visit at most 21 (none over 30). SQ-01 x2 ok. Two follow-ups this needed (node_checks, section 5): the floor waits for the visit's
60th second (`FLOOR_AFTER_S`) and the cabin keeps round 8's LIFE (`FLOOR_SKIP_PLACE`).

## Browser run 3 (`S/br3.log`, tree `S/tree3`, `--only=r9-home-things,console-and-network`): **12/12**
Every Home thing clicked or tapped on the first try in all four: **desktop 3 out** (the Music Box THROUGH a resting squishy, its tune on; the Warm Lamp; the Keepsake
Shelf; the Bounce Pad THROUGH a resting squishy), **desktop 5 out** (the pad through one), **phone 3 out** (the shelf through one, covered), **phone 5 out** (the shelf
through two, covered by both); 0 console errors, 0 failed requests in all four. Shots `S/tree3/_shots/shell/r9_home_things_*.png`.

### SU seed 1234 (`seed=1234`: LIFE's world seed and the genomes' seed), the code as above (`S/su_c.log`): 1 failed (the tightened SU-01, Cloudloft)
Hearthlog 5 / 6 / 6, Ripple 3 / 4 / 5, Frostbell 5 / 5 / 7, Rainleaf 3 / 4 / 4, Lanternroof 3 / 4 / 5, **Cloudloft 2** / 3 / 4: the slime goo + putty party (Gloopsy,
Kneadle with Dollop) used the ball and the nest only (8 uses: the arch was tried and failed, then marked tried). SU-03 most 11 host records. **SU-01's bar is now 5 of 5
parties** (it was 4 of 5; tightened, the owner's goal). One more change for slow walkers: the ARCH use is "stand at the arch": a walk that times out or is blocked
within `ARCH_NEAR` 1.0 m of its point acts there (was 0.6 m, and a time-out never acted). Quick single-place checks of that party at Cloudloft: 3 (seed 1234),
4 (the shipped seed). Both full runs are repeated on the final code below.

### The final LIFE code (+ no "tried" mark while the floor is not met: there the failed thing may be the only new one left; the slime goo + putty party had spent all
### its uses on the ball and the nest once the arch was marked, `S/su_d.log`)
**Seed 1234** (`S/su_e.log`): **all selfuse checks passed** (SU-01 at its new 5-of-5 bar at every place, SU-02, SU-03 most 6 episodes, SQ-01 x2):
Hearthlog 5 / 6 / 6, Ripple 3 / 4 / 5, Frostbell 5 / 5 / 7, Rainleaf 3 / 4 / 4, Lanternroof 3 / 3 / 5, Cloudloft 3 / 4 / 4.
**The shipped seed** (`S/su_f.log`, the final code): **all selfuse checks passed** (SU-01 5 of 5 parties at every place, SU-02 6 of 6, SU-03 most 7 episodes
(bar 8; host USE records at most 23, none over 30), SQ-01 x2).

| place | shipped seed min / median / max | seed 1234 min / median / max | before (shipped seed, `S/su_a.log`) |
|---|---|---|---|
| Hearthlog | 5 / 5 / 6 | 5 / 6 / 6 | 5 / 5 / 6 |
| Ripple Shore | 3 / 3 / 4 | 3 / 4 / 5 | **2** / 4 / 5 |
| Frostbell | 4 / 5 / 5 | 5 / 5 / 7 | 4 / 5 / 5 |
| Rainleaf | 3 / 5 / 5 | 3 / 4 / 4 | 5 / 5 / 5 |
| Lanternroof | 3 / 4 / 5 | 3 / 3 / 5 | 4 / 4 / 5 |
| Cloudloft | 3 / 4 / 4 | 3 / 4 / 4 | **2** / 3 / 4 |

No noise: the floor adds no new sound or chatter; it only changes WHICH thing a squishy that would act anyway goes to, and the attention budget (cap, usesFull,
cooldowns, SU-03's 8 episodes) is unchanged. Rainleaf's and Lanternroof's mins went from 4..5 to 3: the floor's pull ends at 3, and its shorter naps and the
over-budget sparing reshuffle which squishy acts first; both stay at or above the bar.

## Final regression (the final tree, `S/tree4` = the working tree, `diff -rq` same; logs `S/final/`)
`npx tsc --noEmit -p tsconfig.json` clean. node_checks **185/185** (one new round-9 row: a still click on the Music Box behind a resting squishy goes to the box);
probe_app 188/188; probe_gestures 160/160; probe_trophies 31/31; probe_merge 22/22; probe_playground 74/74 (quick); probe_pg_lifequests 16/16; probe_life 127 ok /
1 FAIL (LF-02, known, unchanged); probe_life_selfuse all passed (two seeds above); probe_chatter 42/42; pg_node_checks 40 ok / 0; probe_journal all ok; probe_quests
all run checks ok (3 NOT RUN, as before); probe_pg_data 44 ok / 1 FAIL (DT-18's silhouette part, known, the owner's layout call; DT-18's tap-point part ok; DT-01
ok); probe_r8_features 9/9.

**G0b** (first-play download, html + js + css except later-* chunks, gzip): the final tree **477,145 B**; HEAD (57ba5b747, `git archive` of src / index.html /
public / configs, built the same way on this machine) **477,148 B**: 3 B smaller, so not larger. No first-load file changed in content: every product change is in
the lazy life chunk (`shell/later-life.ts`), LIFE (`src/life`, the lazy later-brain chunk) or Frostbell's lazy place data; the 3 B are chunk-hash names in the
imports. G0 2517 KB.

## Files changed
src/shell/later-life.ts (pad-rest hop, back-in, unstick, crownTap, Home through-tap + shade collider, Home Bounce Pad arrives at C8, voice-only taps, over-budget
spares seekers, optional `lifeSeed`); src/life/world.ts, src/life/step.ts, src/life/brain.ts (variety floor, VISIT_T, PADS_OK on, ARCH point, ARCH_NEAR);
src/data/place_frostbell.ts (tall Shake Pine yaw pi); _harness/browser_shell.mjs (`--places=`, `--trace`, I4 crown tap, section r9-home-things);
_harness/probe_life_selfuse.ts (`seed=N`, per-place min/median/max, SU-01 bar 5 of 5); _harness/probe_pg_data.ts (DT-18 tap-point row);
_harness/shellview/node_checks.ts (one round-9 row); this report.

## Not done / known
- DT-18's silhouette part (at most 50% of a Home thing hidden behind the party row) still FAILS: the through-tap makes the things tappable, not visible; a layout
  change is the owner's call.
- LF-02 (probe_life) still fails as before; not in this round's scope.
- The through-tap: the finger-down still plays the covering squishy's touch sound (press feedback happens at finger down, before a still release is known); the
  thing's own sound follows on release.
- The variety floor waits for the visit's 60th second and skips the cabin (Hearthlog keeps round 8's LIFE; it already met 5+).
- Home's Bounce Pad is now shown after the cabin's finale (C8), as its data always said; it was never shown before (a behaviour change the owner should know of).
- No full browser re-run (rule); browser runs 1 to 4 cover only the sections these changes touch.
