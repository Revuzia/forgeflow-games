# PG_PHYS: running report (PHYS lane for PLAYGROUND). No git write command was run.

Brief: `_handoff/briefs/PG_PHYS.md` (revision 4). Port 5368. Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_phys/`.

# Round 3 (2026-11-16, on HEAD 5ac76e503: the merge of the PC's published line and the PLAYGROUND lanes)

Scope of this run: PF-00; sleep and wake for wholes; the hop; setSquash; the prop world (S0 / S1 props); the prop pass; the touch gate. LOCK,
multi-pull and cut behaviour unchanged (existing physics probes before and after). Files: `src/physics/softbody.ts` (additions), `src/physics/props.ts`
(new), `_harness/probe_playground.ts` (new), the PF-00 harness (new, mine). Nothing outside src/physics and my own probes.

## 0. What changed in src/physics since the brief was written (the PC line; the PLAYGROUND line never touched src/physics)

The brief quotes HEAD 4fe77736 (= the merge base 1e5a1159 for src/physics). The PC line grew `softbody.ts` from 2 841 to 4 004 lines and added
`piece.ts`, `region.ts`, `parts.ts`, `broad.ts` (5 895 lines added under src/physics). What matters for this lane:
- **LOCK and multi-pull** (`LOCK_PHYS.md`): 5 finger / grab slots (`NSLOT` 5; slots 2..4 allocated on first use), up to 6 locks (`maxLocks`), `lockGrab` /
  `releaseLock` / `lockAt`, `metrics.locked` FILLED (the brief planned to fill it: done by the PC line). The `twoHanded` latch counts locks. Every
  finger / grab loop is per slot. The ground fix: every hand target floored at `GRAB_FLOOR_Y` 0.02, `limitDepth`, the carry floor, `grabZone` /
  `gripTail` (the skin around a pulled or locked patch in the contact fold limit), a 10x stiffer volume with 2+ lobes held.
  -> The touch gate's HELD (fingers > 0 || grabbed || carried || locked > 0) reads all 5 slots and `lockN` (`isHeld()`).
- **CUT2 / CUT3** (true pieces): pieces built from a region (`capFlat`, `piece`), their own pair contact `contactPiece`, a landing absorption window
  (`PIECE_LAND`), detail by share. **SLEEP already exists, for PIECES only** (`SLEEP`, `restCheck`, `wake()`, `mustWake()`, `sleeping`,
  `awakeParticles`; a piece is `canSleep`, a whole never sleeps: "bit-identical solver"). A sleeping body takes no step; `collide` skips it and treats
  it as a fixed support (`ow` 0) unless a restless body (calm under `SLEEP.hit` x `after`) reaches it. CUT3's rest test is "no visible motion over
  0.5 s" (no particle moved more than 0.004 R from the pose the countdown started at), on the table or on other pieces, nothing driving it.
  -> E10 is built ON this: `sleepEnabled` lets a WHOLE use the same `restCheck`, plus PLAYGROUND_BUILD 8.6's own bounds (kinetic, centre speed, a
  static support, no LIFE driver, memory converged), and a sleeping whole wakes on a contact only by PG's rule (0.05 m/s or a 0.2 mean-edge push).
  `wake()` was already public (it also resets the rest timers).
- **The broad phase** (`broad.ts` `ContactPlanner`, used by `src/shell/bodies.ts`): bounding spheres once per frame (a sleeper's measured once),
  sort-and-sweep, asleep pairs skipped, `collide` called only for awake bodies. -> Brief step 8's "bound radii cached once per frame, asleep pairs
  skipped" is DONE by the PC line for the planner's path (`collide` itself still re-measures its own radius each call). The bump memory is still
  `MAX_OTHERS` 16 keyed `bodyId & 15` (step 8's 32 contact slots: not done in this run).
- `moveTo`, `matCorral` (about `homeX/homeZ`, now set by `piece.at` / `placeAt`), the float hover, the slosh, the table pass, `emit` (3 objects per
  event) are as the brief describes, at new line numbers (substep 3150-ish, table pass in substep, frameUpdate, emit near the end).

## 1. Baseline (HEAD 5ac76e503, before any edit)
probe_softbody --quick ran in the working tree before my first edit; every other probe ran on a `git archive HEAD` copy in the scratch folder
(`probes_before_clean/`, runner `run_phys_probes2.sh`), one after another. NOTE: the first (discarded) run was still running beside it for ~15 min and
PG_RENDER ran a browser job, so the timing rows (lock perf, species) ran on a loaded machine.
| probe | HEAD result | failures at HEAD (pre-existing) |
|---|---|---|
| probe_softbody --quick | 114/116 | per-family hostile `stickystretch/dollop f0b1s0z0` settled shape error 3.73 % R; G1p "warmUp() covers a lone finger" 2 976 B / frame (both known: LOCK_PHYS 6) |
| probe_lock --quick | 45/48, 2 known open, 1 FAIL | LOCK perf (6 locks 1.48 ms vs 2 wholes 0.95 ms; STATUS "perf 6 locks 1.7-2.0x": known open) |
| probe_cut | 17/17 | |
| probe_flush | 11/11 | |
| probe_neck | 8/8 | |
| probe_parts | 11/11 | |
| probe_tips | 34 cuts, 33 made, 1 refused, 33 within the bars (rc 0) | |
| probe_materials | all passed | |
| probe_families | 22/22 | |
| probe_many --quick | 43/43 | |
| probe_truecut --quick | 104/113 | G2, G3 (x2), G4 (x4), G7, L2 builder rows (known: LOCK_PHYS 6 "103/113, builder / CUT3 rows") |
| probe_species | 25/31 (766 s, loaded machine) | press matrix gloopsy; FULL PULL putty; RUBS waterfill, putty, slimegoo, beadsqueeze |
| probe_app | 183/183 | |
| probe_gestures | 160/160 | |

## 2. What is built (step by step; every step typechecks clean: `npx tsc --noEmit -p tsconfig.json` exit 0)
All new behaviour is INERT until used: a body with no PropWorld, `sleepEnabled` false and no LIFE driver call steps bit for bit as at HEAD (the
empty-world row of probe_playground checks the state hash every frame; the existing hash rows of probe_softbody / lock / cut / many are the other check).
`softbody.ts` (first load): `PG` tunables, the packed `PropSolve` layout (`PS` 36, `PA` 12) props.ts fills, and:
- **Touch gate** (E9): `isHeld()` = a finger down (slots 0..4), a grab, a carry or a lock (`lockN`); read once a frame (`heldF`). Under it `scootTo`
  eases out and lets go within 0.12 s (it decelerates at speed / (0.9 x 0.12 s)), a squash pose is released and eases out (tau <= 0.04 s), `hop`,
  `scootTo` and a new `setSquash` are refused. `moveTo` and the ceremony drivers are untouched; `scootTo` yields to `moveTo` (and is refused while a
  ceremony driver owns the body).
- **setSquash(s, tau)** (E7): y x s, x and z x 1/sqrt(s) on the goal GB in the rest frame (volume-preserving), eased in `frameUpdate`; s 0.75..1.12,
  tau >= 0.08; a call identical to the one in force is a no-op (never wakes); refused for putty / mochi dough / bead squeeze while `memoryBusy`. A
  converged pose (within 0.1 % of its target) is a fixed goal and may sleep (`poseOnly`).
- **scootTo(x, z, speed)** (D-63): a rigid horizontal glide of X (like moveTo), speed 0.04..0.5, ramps in and out over 0.12 s and slows to a stop at
  the target; the corral is off while it acts; NaN x releases it. A STATIC prop that pushes back the particles it touches by a third of the glide step
  or more (head-on) blocks it: it eases out and lets go (a walk into a block crept 5 cm into it before this).
- **hop(vx, vy, vz)**: vy clamped to `PG.hopVyCap` 0.84 (S1), horizontal to 1.0 m/s; the glue and the peel damping AND the support's fade of gravity
  are suspended for 10 substeps and until the body is back on a support (10 substeps alone left the foot inside the jelly's 2.5 cm tack layer: the
  jelly gel, water fill, firm silicone and pop dome hopped 1.2 cm instead of 3.2). Refused when held, airborne, inside 0.8 s, a ceremony driver,
  memory busy. On a moving prop the impulse adds to the surface velocity the body already has.
- **Sleep for wholes** (E10, on CUT3's restCheck): `sleepEnabled` (getter / setter; allocates the rest reference once at opt-in), `sleep()`,
  `metrics.asleep`. The rest test is CUT3's (no visible motion for 0.5 s, nothing driving it) plus PLAYGROUND_BUILD 8.6's bounds for a body that opted
  in (metrics.kinetic < 0.02, centre < 0.01 m/s, memory not busy) and never on a moving prop; a static prop face is a support. A body that opted in is
  woken by a contact only by PG's rule (`wakesWhole`: the centres' approach speed plus a scoot's glide over 0.05 m/s, or a particle driven 0.2 mean
  edges past the contact skin), otherwise the sleeper is a fixed support (a 0.04 m/s nuzzle never wakes it; a toss does). A moving prop whose bounding
  sphere reaches a sleeper wakes it (`propTouch`). A sleeping piece without sleepEnabled keeps CUT3's rule exactly. NOTE: bodies built
  `piece: { frac: 1, chunk: false, at }` (the shell's mat wholes) are `canSleep` pieces at HEAD already (CUT3), with or without sleepEnabled.
  Simplification: a memory family sleeps only once max |MEM - Q| < 0.02 R (memoryBusy false) and its memory has stopped flowing; memoryStep does NOT
  run at 1 Hz while asleep (the memory is frozen within 0.02 R; no 0.3 s goal ease is needed on wake).
- **The prop pass** (E4; `propPass`, between the fingertip pass and the table): per substep, each shown prop's pose at the frame start advanced by its
  velocity (ball) or its angular velocity about the pivot (hinge) over (k + 1) H; a bounding-sphere test against the body's sphere of the frame; sphere,
  capsule and oriented-box contacts (projection to the surface, Coulomb friction against the surface's own velocity: prop mu, load = penetration +
  supported weight + a fingertip's push on an up-facing face); the opposite impulse to the prop in body-mass units (x bodyMass / Mtot) and its moment
  about the pivot; contacts join the contact fold limit while worked (a moving prop, a particle faster than 0.3 m/s relative to the surface, a
  penetration over 0.15 mean edge) and for TABLE_FOLD_AFTER (1.5 s) after (without the hold a slime draped on a bar creased 145 deg).
- **Support on prop faces** (D-11): a particle within NEAR of a face within 35 deg of up counts in `near` / `nearMass` (supported gravity, the friction
  load, grounded, the land event); the goal's float is measured from the lowest support; on a support tilted more than 2 deg gravity keeps its
  tangential part. On prop support the peel damping acts in full, relative to a moving prop's surface (`peelRef`): without it a body bobbed 3 cm for
  seconds on a box top (no tack there, D-54) and a rider bobbed on the rocker. `metrics.onProp`, `metrics.airborne`, `metrics.memoryBusy`.
- **Weight transfer** (D-12; `propWeight`): a body resting on a HINGE prop adds bodyMass x g x its faded weight share at its contact centroid every
  substep, and its inertia about the hinge (so a loaded seat swings at the rider's pace and a poke of a loaded seat turns it less).
- `contactSlot` (public field; strikes carry it). `warmUp()` now also runs a squash pose, a scoot, the gate and a hop on its twin.
`props.ts` (new, life chunk): `PropWorld` + `buildPropWorld(place, layout, bodyScale)`; its header documents the prop order, the parts per mechanism
(block, block + kettle sphere, bar, mound, ring of capsules, seesaw hinge, swing hinge, chime hinges, the free ball, walls), the pose and the packed
data. Physics values beyond the contract (for the shell's life host): `setParked(thing, parked)` (Home's things are built parked), `setBallBounds(...)`
(Home's visible table), `angle` / `omega` / `ballVelocity` / `isParked` readouts. NOT BUILT: ramp, turntable, pad, floater, arches, the Shake Pine's
branch, zones' physics (S2 / S3), `setKinematic`, motors (recorded only).
Decisions to know: the swing seat capsule lies ACROSS its travel (local z), as `render/places/hearthlog.ts` draws it (the ThingDef comment says bars lie
along local x); a swing seat weighs `PROPS.SWING_SEAT` 0.5 body masses (no data field); a chime's rail is at 0.95 m (PG_RENDER's assumption); the
ball has a rolling friction of 0.15 m/s^2 on the floor (the data's roll damping 0.5 /s alone took 8 s to stop a 2 m/s ball; PH-05 asks 6 s).

## 3. probe_playground (new; `node _harness/probe_playground.ts`; the quick set is what run_probes.ts runs)
Quick set (no arguments): **35/35 pass in 20.0 s** on this container at load ~4.5 (other lanes' browser jobs running): at the 20 s target, over it by a
hair on a loaded machine. `--only=<section>` runs one section with its larger set; `--full` = 12 families x 3 genomes, both layouts, the long holds.
| Row | Result (quick set unless marked) |
|---|---|
| inert: an empty PropWorld bound = bit for bit the same state hash every frame | equal |
| PH-01 hop at the S1 cap (vy 0.84, ballistic 3.53 cm), 6 families (quick) / 12 (--only=hop): apex within +-25 % and <= 3.6 cm, no land, no second lift-off, fold <= 120 | 12/12 at 3.15 cm each (--only=hop); 0 land events; worst fold 51 deg |
| PH-01 a 1/8 piece at vy x 0.8 (target 2.26 cm) | 2.03 cm |
| PH-01 refusals: held, inside 0.8 s, airborne, a ceremony driver, putty with memoryBusy | 6/6 |
| PH-02 scootTo eases out under a finger (the driver 0 m/s at 7 frames, released), refused while held | pass. RE-SPECIFIED: the first version measured the CENTRE's speed; under a finger the skin the fixed tip held back while the body glided springs back once the glide stops (0.12 m/s at 0.117 s, 0.04 at 0.67 s): that is the finger contact, not the driver, so the row now measures the driver and reports the centre |
| PH-02 a squash pose eases out within 0.12 s of a finger; moveTo untouched (1.32 m in 0.5 s under a finger); scootTo yields to moveTo; a lock alone refuses scoot and hop | pass |
| PH-07 squash 0.75 and 1.12 held: volume within 3 % (my bar: G1's settle band is +-1.5 % at rest; a pose is a held deformation), fold <= 120 | worst |V - 1| 0.0066 |
| PH-09 sleeps within 1.0 s at rest | 0.53 s |
| PH-09 an asleep step | 0.73 us (bar 0.03 ms) |
| PH-09 13 wake causes (finger, grab, nudge, moveTo, scootTo, setSquash, hop, gravity, setFrac, setFold, tremble, reset, wake) | 13/13 |
| PH-09 a 0.04 m/s scoot into a sleeper never wakes it; a toss into it does | pass / pass |
| PH-09 three wholes pressed together sleep within 3 s and stay asleep 20 s (--only=sleep) | pass (see section 5 for the --full numbers) |
| PH-09 putty after a deep press never sleeps while memoryBusy; zero jump on wake | pass; 0.000 mm |
| PH-22 sleep(): at rest yes; refused moving, float, without sleepEnabled, on the rocker; an identical setSquash keeps it asleep | pass. mods NOT BUILT |
| PH-03 block, bar, mound, ring: dropped on and walked into, fold <= 120, penetration <= 1 % R | 16/16 (--only=static, 4 families): worst fold 52 deg, penetration 0.00 % R |
| PH-03 rests 3 s on a box top, creep <= 2 mm, then sleeps | drift 0.00-0.07 mm, sag 0; all sleep. RE-SPECIFIED with reason: creep = horizontal drift and sinking; a memory family RISES out of its landing squash (slime 10 mm, marshmallow 19.5 mm on the box, 6.4 / 0.2 mm on the floor control): its own recovery, reported beside the floor control. Observation: marshmallow lands harder on a box top than on the felt (no tack there) |
| PH-04 rocker (wide; tall with --only): one sitter tips it -8.00 deg (its limit) toward itself; two riders + a teeter hop: within 8 deg, both on 71/72 samples, fold 50 | pass |
| PH-04 swing: a rider, three pushes: seat <= 2.0 m/s, no amplitude growth after the pushes, rider on 60/60 samples | pass, BUT the loaded swing is weak: the pushes share the rider's inertia (0.5 m/s seat speed), and the swing dies within 2-3 half swings (4-7 deg). Known issue (section 6) |
| PH-05 ball (both layouts): 4.1 m/s flick clamped (1.98 / 1.93 m/s), never through a wall, rests in 3.9 s; a 0.26 m/s scoot boops it 0.68 m | pass |
| PH-06 mass parity on a level board (5 s settle): detail 3 8.040, detail 2 8.041 (1.000), 1/8 piece 1.011 (0.126); ideal bodyMass g r 8.10 | pass |
| PH-23 Hearthlog's 15 colliders in order: propThing 0,1,2,3,4x6,5,5,-1,-1,-1, propPart 0,0,0,0,0..5,0,1,0,1,2; Home's 4 props parked; strikes cause 0 (poke) and cause 1 slot 7 (a body) | pass. Cause 2 (weather) has no producer yet (S2/S3) |
| PH-10 determinism (cabin, 3 bodies, sleep, scoot, squash, hop, poke, a rider) | equal |
| PH-11 allocation (--only=alloc / --full): 2 riders + a scooter with a pose, sleep on, 120-frame windows, no event | 0 B in 4/4 windows after a 100 s warm-up; an identical setSquash call allocates 80 B in its caller's (interpreted) tier |
| PH-12 a pressed detail-3 body with 4 props in reach vs none | 1.084 vs 1.049 ms: x1.03 (bar 1.25) |
| PF-05 (--only=pf05) at F = 4: 4 wholes in the cabin, one touched + 3 asleep / one scooting + 3 asleep | 1.17 / 1.37 ms (bar 1.5) on one run; 1.12 / 2.25 on an earlier run whose mover's path bumped a sleeper awake (my scenario's fault, fixed). Load ~4.5: noisy |
NOT covered (not built in this run): PH-08 (mods), PH-13, PH-14 (`auto`, `prop`, `other` on events), PH-15..17 (S2/S3), PH-18 and PH-24 (setBounds /
setHome), PH-19 (contactSlot-keyed 32-slot bump memory, `contacts`), PH-20 (carryTo), PF-06.

## 4. Sizes (14.3: rolldown, the module alone, every import external, minify, ES; `scratchpad/pg_phys/size.mjs`)
| module | HEAD | now | delta | cap |
|---|---|---|---|---|
| src/physics/softbody.ts (first load) | 94 531 B | 107 403 B | **+12 872 B** | physics first-load 18 KB: within |
| src/physics/props.ts (life chunk) | - | 15 149 B | new | 14.3 estimated ~8 KB for props.ts: about 2x that, inside the life chunk's 150 KB |

## 5. PF-00: the phone factor F and the unit weights (for PG_LIFE's attention.ts)
Harness (mine): `_harness/pf00.mjs` (vite on port 5368, headless Chromium, CDP `Emulation.setCPUThrottlingRate` 4) runs `_harness/pf00_work.ts` in the
page (`_harness/physview/pf00.html`) and in node, interleaved round by round (7 batches of 120 frames each, the median). Logs:
`scratchpad/pg_phys/pf00_run1.log` (3 rounds; its piece and pair numbers are void: bodies built `at` a spot are CUT3 pieces and fell asleep) and
`pf00_run2.log` (5 rounds, sleep off for the awake workloads; pieces awake, the pair touching in every round). **The machine was loaded (load 4.5 to 5:
other lanes' browser runs), so every number below is noisy: node's pressed whole read 1.06 to 1.67 ms between rounds.**
| quantity | node (this container) | Chromium x4 throttle | |
|---|---|---|---|
| one awake detail-3 whole, resting | 1.081 ms | 3.780 ms | F_rest = 3.50 |
| the same, pressed (c_whole) | 1.108 ms | 4.164 ms | **F_press = 3.76** |
| F per round (press), both runs, 8 rounds | | | 6.43, 4.32, 2.63, 2.36, 3.76, 3.65, 2.70, 4.64: **median 3.71** |
| a detail-2 piece (6 in contact, the planner) | 0.290 ms each | 1.086 ms | **weight 0.26** (LIFE 0.22) |
| a touching pair (2 wholes, the planner) | 2.442 ms (2 x rest 2.162) | 9.438 ms | **pair extra 0.25** (LIFE 0.25) |
| a sleeper (an asleep whole's step) | 0.25 us | 0.8 us | **weight 0.0002** (LIFE 0.03: a sleeper costs ~nothing in physics) |
| 4 props in reach of the pressed whole | +0.33 ms | +0.89 ms | **props 0.33 ms** (LIFE 0.20) |
**For PG_LIFE (recommendation, not a measurement on a quiet machine):** F = 3.7 measured is inside the noise of the provisional F = 4, and gives the
same mover caps (1 / 1 / 2); keep F = 4 until PF-00 is re-run on a quiet machine (one heavy job: `node _harness/pf00.mjs --rounds 5`, about 4 minutes).
The weights to use: piece 0.26 (was 0.22), pair 0.25 (same), sleeper: keep 0.03 as the conservative floor term (the physics cost is ~0.0002; the
floor of D-85 follows the sleeper weight, so lowering it lowers the floor), props 0.33 ms (was 0.20). With F = 4, props 0.33 and c_whole 0.87:
unitCap = max((B/4 - 0.33)/0.87, floor) = 1.06 / 1.34 / 2.49 (low / med / high), movers 1 / 1 / 2 (unchanged). c_whole itself read 1.11 ms here
(0.87 in PHYS map 4 on a quiet machine): measure it on a quiet machine before changing C_WHOLE_MS.

## 6. Known issues and what is NOT done (honest list)
- NOT BUILT this run (brief S0/S1 items outside this run's scope): `mods` (E2, PH-08, PH-22's mods clause), `setBounds` / `setHome` (E3, PH-18, PH-24;
  the corral is already OFF for a rider on a moving prop and for a scooting body, D-91), `SoftEvent.auto` / `prop` / `other` (PH-14), the 32-slot
  `contactSlot` bump memory and `metrics.contacts` (PH-19; `contactSlot` exists as a field and strikes carry it), `carryTo` (PH-20), PF-06, the S2/S3
  mechanisms (ramp, pad, turntable, floater, arch, Shake Pine branch) and every zone's physics, `setKinematic`, motors. No contract member was added.
- The loaded swing is weak: a push is shared with the rider's inertia (a 1.6 m/s poke gives 0.5 m/s), and with a rider the swing dies within 2 to 3 half
  swings (the rider's own damping drains it through the contact; the seat's data damping is 0.25 /s). A pusher body (S11) pushes through contact,
  not poke; not measured. Candidates: lower the seat's damping with a rider, or a lighter rider coupling; a designer's call.
- PH-04's corral-at-the-edge clause and every bounds row wait for `setBounds`.
- The quick set takes 20.0 s on a loaded machine (the 20 s target).
- PF-05 is timing-noisy at load 4.5 (one run 1.17 / 1.37 ms).
- Swing seat geometry follows the render (across its travel), not the ThingDef comment (along local x): PG_DATA / PG_RENDER should agree on one.
- A body set on a box top lands harder than on the felt (no tack on props, D-54): marshmallow's landing squash is visibly deeper (19.5 mm rise after,
  0.2 mm on the felt).
- Pre-existing, not mine (measured on HEAD too): three bodies built `at` a spot (CUT3 `canSleep`) allocate ~25 KB per 120 frames in restCheck while
  it runs unoptimised (HEAD and now equal); a once-a-frame entry point tiers up only after tens of seconds of use (PH-11 needs a 100 s warm-up).

## 7. Requests to other lanes
- **PG_SHELL** (life host): call the PG members on the SoftBody itself (`BodyProxy.inner`; the render proxy forwards none of them): `sleepEnabled = true`
  for party bodies, `setPropWorld(world)` per body on travel, `contactSlot`, `scootTo` / `setSquash` / `hop` from LIFE's intents, `sleep()` for the
  over-budget rule. One `world.beginFrame()` before the contact planner and the bodies step, one `world.endFrame(dt)` after; `world.drainStrikes`.
  Home: `buildPropWorld(HOME, frame, bodyScale)` builds every thing PARKED: `world.setParked(thing, false)` when a thing arrives, and
  `world.setBallBounds(minX, minZ, maxX, maxZ)` with `visibleTable` (D-67). `stage.bindProps(world.poses, world.count, world.propThing)`.
- **PG_RENDER**: poses are as requested (the part's centre and orientation, the first prop of a thing its mover); the swing seat's frame is the render's
  (capsule across the travel, ropes up its local +y); a chime's rail is at 0.95 m, its parts hang `p.hang` below and swing about the rail (local x).
- **PG_DATA**: a swing seat has no mass field (physics uses 0.5 body masses); if PH-04's rider retention ever fails, the fallback is a box seat
  (`p.box: 1`, size = half sizes [along the travel, up, across]: props.ts builds it); the swing's damping with a rider (section 6).
- **PG_LIFE**: PF-00's F and unit weights: section 5.

## 8. After the edits: every probe again (`probes_after/`)
Working tree with every PG_PHYS edit, one probe after another (`run_phys_probes2.sh after`, 20:24-20:58, load 3.8 to 5.3: other lanes' browser jobs
on their ports). Same checks pass and fail as at HEAD, with the same measured values on every non-timing failure.
| probe | HEAD (section 1 / the brief) | after the edits | |
|---|---|---|---|
| probe_softbody --quick | 114/116 | **114/116** | same 2 fails, same numbers (3.73 % R; 2 976 B / 2 976 B) |
| probe_lock --quick | 45/48 (perf 1.48 vs 0.95 ms) | **45/48** (perf 1.51 vs 0.95 ms) | same known perf fail; hinge visits 8 195 both |
| probe_cut | 17/17 | **17/17** | |
| probe_flush | 11/11 | **11/11** | |
| probe_neck | 8/8 | **8/8** | |
| probe_parts | 11/11 | **11/11** | |
| probe_tips | 34 cuts, 33 made, 1 refused, 33 within | **same** | |
| probe_materials | all passed | **all passed** | |
| probe_families | 22/22 | **22/22** | |
| probe_many --quick | 43/43 | **43/43** | |
| probe_truecut --quick | 104/113 | **104/113** | same builder rows (G2, G3 x2, G4 x4, G7, L2) |
| probe_species | 25/31 | **25/31** | same 6 fails, same measured values (only the perf row's timings and the order of one failing list differ) |
| probe_app | 183/183 | **183/183** | |
| probe_gestures | 160/160 | **160/160** | |
| probe_playground (new) | - | **35/35** quick set, 21.7 s | PH-12 x1.008 this run |
| probe_merge | 22/22 | **22/22** | |
| probe_collection | 74/74 | **74/74** | |
| shellview/node_checks | 130/130 | **130/130** | |
| probe_economy | all passed | **all passed** | |
| probe_catalog | all passed | **all passed** | the DOLLOP rest-shape seam equals the frozen snapshot |
| probe_life | 95 ok / 1 fail | **95 ok / 1 fail** | the fail is LF-02 (lifeStep allocation, PG_LIFE's) |
| probe_chatter | 42/42 | **42/42** | |
| renderview/pg_node_checks | 35 ok | **40 ok, 0 FAIL** | PG_RENDER added rows since the brief |
`npx tsc --noEmit -p tsconfig.json`: exit 0 after the run.

## Log
- 19:20 read the brief, SESSION3, MERGE_PC, LOCK_PHYS, PLAYGROUND_BUILD 2/7/8/14/15/18, PLACES 1/2.1/4.1/4.2, LIFE 5.1/10.3, the maps, the code.
- 19:22 baseline run 1 started in the working tree; probe_softbody --quick finished before my first edit (114/116, the two known failures);
  the later probes of that run overlapped my edits and are DISCARDED. A clean baseline runs on a `git archive` copy of HEAD in the scratch folder.
- 19:28-20:10 softbody.ts additions and props.ts, probe_playground built and debugged (hop tack layer, the gate's re-spec, the sleep wake rule by the
  centres' approach, box-top bobbing -> peel damping on prop support, walk-in creases -> fold-limit hold and the scoot block, PH-11 tier-up and the
  integer / double ternaries, the ball inlined into endFrame, the restCheck early-out for riders).
- 20:16 PF-00 run 1 (void piece / pair numbers); 20:20 PF-00 run 2 (section 5). 20:24 the after-run of every probe started (`probes_after/`).
- 20:58 after-run done: every probe as at HEAD (section 8); tsc clean; no process of mine left running (port 5368 free).
