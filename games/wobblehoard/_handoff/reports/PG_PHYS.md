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

# Round 4 (2026-11-17 from 05:04 UTC, on HEAD 7e64f2018: the published game merged with PLAYGROUND, wired into the shell and playable)

Scope (orchestrator): (1) the prop count bug PG_SHELL found (props.ts `things` table filled with -1 and counted from -1: setParked skipped one-part
things) + a probe row, and tell PG_SHELL its `parkThing` fallback can go; (2) D-95 REVISED (the owner's clarification at the end of the brief wins):
the default swing and rocker die down naturally as measured (unchanged), plus a per-hinge-thing AUTO drive `setAuto(thing, on)` (a gentle steady
arc with or without a rider, eased in and out; a held prop or a held rider always wins) and the seat and the rider grabbable by hand so a pull or a
push swings it, with probe rows for all three; (3) whichever of setBounds / setHome, SoftEvent auto / prop / other, the contactSlot bump memory and
carryTo the shell's S1 / S2 needs (PG_SHELL.md lists its FALLBACKS for all five); (4) the S2 mechanisms and zones as far as I get. Files:
`src/physics/**` and `_harness/probe_playground.ts` only. No git write command. The container restarted at 05:01 (my scratch survived).

## R4.0 Baseline (HEAD 7e64f2018)
The whole suite ran on a `git archive HEAD` copy (`scratchpad/pg_phys/head_r4/`, runner `run_r4.sh before`, logs `r4_before/`), one probe after
another, 05:07 to 05:44, load 1 to 7.7 (other lanes' jobs). Every result is the known state (round 3 section 8 and the orchestrator's list):
| probe | HEAD 7e64f2018 | | probe | HEAD 7e64f2018 |
|---|---|---|---|---|
| probe_softbody --quick | 114/116 (G1 stickystretch hostile shape, G1p warmUp alloc: known) | | probe_app | 187/187 |
| probe_lock --quick | 45/48 (2 known open, LOCK perf: known) | | probe_gestures | 160/160 |
| probe_cut | 17/17 | | probe_playground | 35/35 (quick set, 12.4 s) |
| probe_flush | 11/11 | | probe_merge | 22/22 |
| probe_neck | 8/8 | | probe_collection | 74/74 |
| probe_parts | 11/11 | | shellview/node_checks | 156/156 |
| probe_tips | 34 cuts, 33 made, 1 refused, 33 within | | probe_economy | all passed |
| probe_materials | all passed | | probe_catalog | all passed |
| probe_families | 22/22 | | probe_life | 95 ok, 1 fail (LF-02, PG_LIFE's) |
| probe_many --quick | 43/43 | | probe_chatter | 42/42 |
| probe_truecut --quick | 104/113 (G4 x4, G7, L2 ... builder rows: known) | | renderview/pg_node_checks | 40 ok, 0 FAIL |
| probe_species | 25/31 (535 s; press gloopsy, FULL PULL putty, RUBS x4: known) | | `npx tsc` | 0 at 05:04 |

## R4 steps (updated after every finished step)
| step | what | state |
|---|---|---|
| 1 | the prop count bug: `props.ts` now fills only each thing's FIRST-prop field with -1 and counts its props from 0 (round 3 filled both with -1, so `setParked` looped over count - 1 props: a one-part thing, every Home thing, never changed; the kettle's sphere and the basket's last segment stayed as they were). New row in `--only=order` / the quick set: Home's 4 props shown, the Felt Ball raycasts and rolls 0.498 m in 0.5 s on a 1.2 m/s poke, all parked again (raycast -1); the cabin's basket (6 parts) and kettle (2) park and show whole | DONE 05:20: tsc 0; `--only=order` 4/4. **To PG_SHELL: `parkThing()` (later-life.ts, FALLBACK) can go: `world.setParked(thing, parked)` now does exactly what it does** |
| 2 | **D-95 revised** (props.ts + softbody.ts): the DEFAULT is untouched (no motor, the data's damping, the measured die-down); **AUTO** per hinge thing (`world.setAuto(thing, on)`); **the hand** on a hinge prop (`grabProp` / `dragProp` / `dragPropRay` / `releaseProp`); **a held rider** turns its seat or board with it. Details and numbers below (R4.2) | DONE 05:40: tsc clean for src/physics and my probe (the only error is PG_SHELL's in-progress `later-life.ts` LifeHostApi edit, not mine); `--only=d95` 5/5; quick set **41/41 in 19.5 s** (load 7.7) |

### R4.2 D-95 (revised) in physics: what to call and what it does (FOR PG_SHELL: the API; all on `PropWorld`, life chunk, no contract change)
- `world.setAuto(thing, on): boolean` (PlaceDef.things index; false for a thing with no hinge prop: only the swing, the rocker and chimes have one) and
  `world.isAuto(thing)`. OFF by default; the player's toggle only (never LIFE, never autonomy). `world.autoShare(prop)`: 1 while the arc drives the prop,
  0 while AUTO is off or a hand or a held rider has it (a readout for the toggle's look).
- AUTO keeps a steady arc: the swing **10 deg** (`PROPS.AUTO_SWING_DEG`), the rocker **5 deg** (`AUTO_ROCK_DEG`, period 2.8 s), a chime 6 deg (at most 0.7 x
  the limit). It takes the motion it finds (the arc's amplitude and phase from the angle and angular velocity of that moment: no jump, max frame-to-frame
  change of the angular velocity 0.021 rad/s empty, 0.030 with a rider; a push's 1.6 m/s poke is a 0.4 rad/s step) and EASES its amplitude to its size at
  6 deg/s (from rest: half swings 4.1, 10.0, 10.0 ... empty; 0.8, 5.9, 10.0 ... with a rider). The swing's pace with riders is the RIDERS' own pendulum (their
  centres sit ~0.45 m above the seat; at the seat's own sqrt(g / rope) they were pushed and held back every half swing).
- **A rider holds on** while AUTO or a hand drives a swing (softbody.ts: its centre is sprung toward the seat's centre line along the travel, `PG.holdK` 16 /
  `holdC` 6, x AUTO's share; S[34] carries the share). Without it every rider but slime rolled off the ROUND capsule seat (r 0.09) within a few half swings at
  any arc (5, 7 and 10 deg tried; on 30..47 of 84 samples), and off a seat a hand yanked 20 deg. A box seat (half sizes 0.22 x 0.06 x 0.35, `p.box: 1`) kept
  them on without the hold (tang offset <= 0.09 m at 10 deg): see the request to PG_DATA / PG_RENDER. With the hold: 84/84 for jelly gel, firm silicone,
  slime, marshmallow and gummy over 14 s, fold 50 to 51 deg.
- **AUTO off** (`setAuto(thing, false)`): the prop carries on from its motion and dies down by its own damping exactly as without AUTO (with a rider the seat's
  angular speed falls from 0.33..0.56 rad/s to 0.001..0.004 within 10 s; the empty seat decays by the data's 0.25 /s: 9.1, 7.9, 6.8, 5.9 deg half swings).
- **The hand**: `world.grabProp(prop, x, y, z)` (the point from `world.raycast`'s hit: pass NaN x to use the last raycast's hit point), then every frame
  `world.dragPropRay(prop, ox, oy, oz, dx, dy, dz)` with the pointer's camera ray (or `world.dragProp(prop, x, y, z)` with a world point), and
  `world.releaseProp(prop)` (prop < 0: every hand) on pointer up. The prop turns so the grabbed spot points at the hand (time constant 0.08 s), over its riders
  and over AUTO, inside its limits and the 2 m/s clamp; on release it keeps the hand's angular velocity (a flick swings it). `dragPropRay` puts the hand on
  the plane the spot turns in (perpendicular to the hinge axis: the wide swing and the rocker), or on the horizontal plane through the spot when the ray runs
  nearly along that plane (the tall swing, which travels toward the camera). `world.isHandHeld(prop)`. grabProp is false for a static, parked or ball prop.
  Measured: the seat pulled 0.5 m along its travel holds at 19.7 deg (the hand's 20.2); AUTO's share 0 while held; released it swings 19.6, 7.4, 6.4 and dies
  (AUTO off) or 27.4, 21.7, 15.8, 10.0, 10.0 (AUTO on, back to its arc); the rocker board's end pulled down 0.12 m holds at -6.86 deg (the hand's -6.86).
- **A held rider** (the player holds the body on the seat or board by a finger, a grab, a carry or a lock: the shell's normal body input, nothing new to call):
  the seat or board turns with the rider's centre about the axis (`PROPS.RIDER_TAU` 0.1 s), and AUTO yields while it holds (and 0.25 s after its last touch).
  Measured: the rider grabbed on top and pulled 0.35 m along the travel swings the seat 15.8 deg (AUTO off) / 11.2 deg (AUTO on) and keeps its seat (6/6
  samples), AUTO's share 0 while held; released: dies down (AUTO off) or back to the 10 deg arc (AUTO on). Without the coupling the same pull swung the seat
  6.9 deg and pulled the rider off it.
- Probe rows (`--only=d95`; the quick set runs one family and 8 s holds): the default dies down (with a rider: 3.97 deg and 0.394 rad/s in the first 2 s,
  0.009 rad/s after 3 s; the empty seat only decays; AUTO's share 0); AUTO on the swing (empty + 5 families; quick: empty + jelly gel); AUTO on the rocker
  (0, 1, 2 riders: every half swing 5.0 deg after the ease-in, riders 72/72); by hand (the seat, AUTO off and on; the rider, AUTO off and on; the rocker
  board); determinism with AUTO, a rider and a hand (equal). Tall layout checked by a scratch run (`scratchpad/pg_phys/d95.ts ... tall`): AUTO 10.0 deg with a
  rider 84/84, the hand 19.8 deg (hand 20.3), the rider pull 16.2 deg.
| 3 | the shell's S1 / S2 needs (PG_SHELL.md's five FALLBACKS): `setHome`, `setBounds`, `SoftEvent.auto` / `prop` / `other` (with prop bumps), the contactSlot-keyed bump memory and `metrics.contacts`, `carryTo`. Details in R4.3 | DONE 05:45: tsc 0; new rows PH-14, PH-19, PH-18/24, PH-20 pass; quick set **45/45 in 21.1 s** at load 6.4 (section times with `PGTIME=1`); probe_app 187/187, probe_gestures 160/160, node_checks 160/160 (PG_SHELL added 4 rows today) on the working tree; the full after-run started 05:45 on a snapshot (`r4_after_s3/`) |

### R4.3 What the shell can drop (FOR PG_SHELL: each FALLBACK in later-life.ts and what replaces it)
- **parkThing()** -> `world.setParked(thing, parked)` (step 1).
- **setHome** -> `body.setHome(x, z)` exists now (your `rehome()` already calls it when present: nothing to change; the `homeX` write path becomes dead).
- **setBounds** -> `body.setBounds(shape, cx, cz, a, b, round)`: 0 disc (a = radius), 1 rounded rectangle (a, b half sizes, round = corner radius), -1 back to
  the home corral. The mat corral's brake, glide (0.35 m/s, never under 10 % of it) and rim bounce, about the area's EDGE (the dead zone is the whole area); the
  rim is `PG.boundsRim` 0.6 m past the edge. Off, like the home corral, under a grab / lock / pinned feet / moveTo / scootTo / carryTo and for a rider on a
  moving prop (D-91). It wakes the body (a sleeper outside the new area is brought back; one at rest inside falls asleep again within 0.5 s). Call it on travel
  and spawn, and at Home when the frame or the party changes (D-87: the rectangle of visibleTable + every slot in use + 0.05 m, round 0). Measured (PH-18/24):
  bodies resting at spots inside never move (0.00 mm in 3 s); a body tossed out at 2.5 m/s reaches 2.13 m and comes back to the edge (1.750); a disc shrunk past
  a body brings it back to the edge (1.600) in 7 s; shape -1 + setHome hand it back to the home corral (0.600 = its dead zone); a rider on the AUTO swing with
  bounds 0.1 m wide stays on the seat (48/48) 0.13 m past them.
- **SoftEvent.auto / prop / other** -> every event now carries `auto` (boolean), `prop` (number, -1 = none) and `other` (number, -1 = none). `auto` is set on
  'land' and 'bump' (prop and body): true unless the player touches the body (a finger down, a grab or a carry; for a body bump either body) or let go of it
  (a grab or carry released, a finger lifted) since its last landing or since it settled (0.3 s on a support under 0.1 m/s); a LOCK alone never stops it
  (D-86). The player's own events (poke, press, release, grab, snap) carry auto false. `prop` = the prop index on a PROP bump (NEW: a body meeting a prop's
  side or underside faster than 0.35 m/s at the start of a contact, at most one per prop per 0.2 s; a landing on an up-facing face is the 'land', as before);
  `other` = the partner's contactSlot on a body bump. **Your takeAuto must now check `e.prop`**: a bump with `prop >= 0` is a PROP bump, not a body bump
  (today's FALLBACK would pair it with the nearest character as a fake body bump). NOTE: a LIFE scoot glides by a rigid translation, so a scoot into a body or
  a prop closes at no speed a bump counts: LIFE's own boops make NO bump event (they never did); bumps come from hops, falls, launches, the ball and tosses.
- **metrics.contacts** -> a bit per contactSlot (bit k = the body with contactSlot k) of the bodies it touched in the frame's collides (both bodies of a pair
  record each other; published at the body's next step, so read it after the step as today). Slots 0..31; bit 31 reads as a negative int32.
- **Bump memory**: keyed by contactSlot (32 entries; a body without one keeps the old `bodyId & 15` key in its own 16 entries): two partners never share an entry
  (PH-19: two partners whose bodyIds alias both bump within 0.2 s: 2 bumps with slots, 1 without).
- **carryTo** -> `body.carryTo(x, y, z, seconds)`: the body is lifted along an arc and set down so that it STANDS at (x, z) on a support whose TOP is at height y
  (y 0 = the table; for a ride pass the seat's or board's top: the pose's y + the part's half height or radius). 0.2..5 s; a rigid kinematic move (shape kept,
  weight held), the path a Bezier whose apex clears the higher end by ~0.15 + 0.25 x distance m (at most 0.6); set down at rest; the home corral's spot moves
  there. No event at all on the way (never pays); its landing and its next 0.3 s at rest are not auto. False when HELD, carried, a ceremony driver is on, or
  the point is bad; a scoot is released by it; a touch ends it where the body is. `body.carryingTo` (readout). Measured (PH-20): floor -> a 0.4 m box top 1.2 m
  away in 1.2 s: on the box (onProp), x 1.200, lowest 0.400 m, centre speed after 0.000 m/s, 0 events, fold 52.
- **Sizes after step 3** (14.3's one-file rolldown): `softbody.ts` 107 403 -> **112 878 B** (PG first-load total **+18 347 B over the PC line's 94 531**: inside
  the 18 KB = 18 432 B cap by 85 B, after trimming: the place corral merged into matCorral, two harness readouts removed, compact validation); `props.ts` 15 149
  -> 19 402 B (life chunk). **The physics first-load cap is now full**: S2's zone physics goes into the life chunk (props.ts) as far as it can.
| 4 | **S2 mechanisms and zones** (as far as I got): water (float / wade, the current, `metrics.submerged`, scootTo on a floater, clean exits), the flush pad (kicks, sticky hold, at most 5), the ramp (slab + rails), the floater (Ripple's Bob Ring). All in the LIFE CHUNK (props.ts): the physics first load is at its cap. Details R4.4 | DONE 06:01: tsc 0; new rows PH-15 (4 quick, 5 with --only), PH-16 (2), ramp + floater (2) pass; quick set **53/53 in 25.2 s at load 8.7** (the 35 old rows take 14.2 s of it today against 12.4 s in this morning's baseline run: the machine is slower now; see R4.6) |

### R4.4 S2 physics: what is built (props.ts, life chunk) and how the shell uses it
- **How it reaches the bodies without first-load code**: `SoftBody.setPropWorld(world)` now tells a props.ts world which bodies are bound to it (`world.trk(body,
  on)`: 70 B in softbody.ts), and the world applies its zones and pads ONCE A FRAME in `beginFrame()` (which the shell already calls before the bodies step)
  through `SoftBody.nudge` (a velocity change of the whole body) and the body's own hop machinery (the glue suspension). Nothing to call for the shell: bind
  the place's world as today. `world.tracked` (readout). `metrics.submerged` is now in the metrics literal (0 outside water).
- **Water** (PLACES 2.2 / 2.5): the deepest water zone at the body's centre (its surface ramped in over the zone's `ramp`), f = the submerged share of the body's
  sphere measured from the body's OWN bottom (centre - rest centre height: a body resting on the floor has h = the depth, as the table assumes). density =
  `mods[4]` when the shell writes it, else FAMILY_REACT's dry density. A body FLOATS when share(depth, R) > density (the generated table): it gets g x f / rho
  back each frame (rises until f = rho), its tack and the support's gravity fade let go (as for a hop), and a drag of 2.5 /s toward the water's velocity (a
  disc zone's `flow` = [tangential, radial], a box's [vx, vz]): it drifts with the current and never sleeps. Otherwise it is a SITTER (wades; today's supported
  fade; it sleeps) with a horizontal drag of 2.5 x f. Measured (PH-15): **21/21 family x radius cases as the table** (7 families x R 0.42 / 0.51 / 0.60:
  marshmallow floats at all three, pop dome and dry slow-rise at 0.42 and 0.51, the rest wade); floaters ride at submerged = density (+-0.02) and drift
  0.075 m in 1.5 s in a 0.08 m/s swirl, sitters 0; a floating marshmallow scooted 1.8 m across the pool keeps its height within 0.06 cm and, scooted on to a
  dry spot, sits on the floor (submerged 0); bodies launched into the pool enter cleanly (fold 52); the places' own water: Ripple's Rock Pool floats a
  marshmallow (submerged 0.131) and wades a jelly gel, Frostbell's Steam Pool floats a pop dome, Rainleaf's 0.07 m splash spot only wets (wade).
- **Flush pad** (PLACES 2.1 M11; Rainleaf's Moss Bouncer, Home's Bounce Pad): a box collider just under the floor (bodies land on the table there); a body
  whose centre is over it and that lands (airborne, falling faster than 0.3 m/s) is kicked up at gain x the family's bounce gain x its landing speed, capped
  by sqrt(2 g apex), after the family's sticky hold (0.4 s sticky stretch, 0.6 s slime), at most maxBounces in a row; the kick suspends the glue 45 substeps
  (a hop's 10 left a sticky body, squashed flat by its hold, in the tack layer); the pad strikes (cause 1, the body's contactSlot: its boing) and its top
  rises `travel` and back over 0.2 s (the pose's y and state: a look). Measured (PH-16, a drop from 0.35 m): jelly gel, firm silicone, gummy, pop dome 5 kicks,
  apex 24.2..25.1 cm (cap 30); marshmallow 4 kicks, 9.3 cm; sticky stretch 2 kicks, first 0.42 s after landing (hold 0.4), 5.9 cm; slime 2, 0.60 s (hold 0.6),
  3.1 cm; putty 2, 0.7 cm; every landing auto. LIFE's "one small hop and the pad does the rest": a 0.84 m/s hop on the pad grows to 5 kicks and 15.5 cm.
  Note: the soft and sticky families swallow most of a kick (their squash recovers instead of lifting): a designer's call whether that reads right.
- **Ramp** (M5; Frostbell's Glide Ramp): the slab as the render draws it (slopes down toward local +x, its high edge at `top`, centre y = top - hl sin a -
  ht cos a) and, with `p.rails`, two capsules (r 0.03) along its sides 0.07 m over its centre line: 3 colliders. Static; a body on it keeps gravity's part
  along the slope (D-11). Measured: firm silicone, jelly gel and gummy set at the top by carryTo slide 1.04..1.05 m down the slope in 4 s, fold 50..51.
  (Ice grip per family needs `mods`, not built: every family slides on the ramp's own mu 0.1 today.)
- **Floater** (M12; Ripple's Bob Ring): a closed ring of `p.segments` capsules at the surface of the water it stands in, on a kinematic vertical bob (`p.bob`
  0.03 m at `p.bobHz` 0.3 Hz), anchored; a moving support (a body on it rides: never corralled, never asleep). Measured: 6 segments, centre y 0.250..0.310.
- **Shake Pine** (Frostbell, built at 06:10): the trunk (part 0) and the low branch (part 1) where the render draws it (from the trunk's side along local x at
  pivotY, capsule r branchR, length branchL), on a springy hinge (2 Hz, limit 20 deg, damping 2 /s), strikable; a body brushing the branch, or meeting the
  trunk faster than p.bumpSpeed (0.3 m/s, by its centre's travel, so a LIFE scoot counts), shakes it: a strike (cause 1, the body's slot) for the rustle and
  the snow puff. Measured: a scoot at 0.45 m/s into the trunk: 2 strikes (slot 3), branch 3.3 deg; at 0.2 m/s: none. Frostbell now has 15 props.
- **NOT built** (S2 physics left): `mods` (E2: grip, glue, peel, drag, density, catch, bounce gain) and with them ice (Frostbell's Ice Pond), wet grip and
  soaking (a slow-rise soaking to its soaked density: the shell writes mods[4], physics already reads it); the bulge slosh in water; waves (Ripple's surf edge)
  and weather strikes (cause 2); the current zone kind (a water zone's own flow acts); chimes struck by the weather; PH-01's raised S2 hops per family (vy 1.10..1.26, big 1.55: the S1 cap 0.84 stays);
  wind and updraft (S3, PH-17).
- **Sizes after step 4**: `softbody.ts` **112 948 B** (PG first load +18 417 B: 15 B under the 18 432 B cap); `props.ts` **24 876 B** (life chunk; 15 149 at
  HEAD).

### R4.5 Requests to other lanes (round 4)
- **PG_SHELL**: (1) `parkThing()` can go: `world.setParked` works for every thing (step 1). (2) Your takeAuto already reads `e.prop` and `e.other`, and your
  D-95 code already calls `setAuto` / `grabProp(prop, NaN, NaN, NaN)` / `dragPropRay` / `releaseProp` and `setBounds` (seen in later-life.ts at 06:02): they
  are real now. (3) `carryTo(x, y, z, s)` exists for LIFE's USE intent and "Go play with...": y is the TOP of the support (the seat's or board's pose y + its
  radius or half thickness; 0 for the floor), the body is set down standing there. (4) The S2 places need nothing new from you: bind the place's world to each
  body (`setPropWorld`) and call `beginFrame` before the bodies step, as today; water, pads and floaters act from there. When you write `mods` (not built in
  physics), physics reads `mods[4]` as the density in water already. (5) A body's `metrics.contacts` replaces your centre-distance FALLBACK for touching pairs.
  (6) A world now keeps a list of the bodies bound to it: when a body leaves play (back to the shelf, merged, disposed), call `body.setPropWorld(null)` so the
  world lets go of it (otherwise its zones keep nudging a body nobody steps, and the world holds a reference to it until the place is left). later-life.ts
  already does (its remove paths call `setPropWorld(null)`): nothing to change unless a new remove path appears.
- **PG_DATA**: the swing seat stays a capsule (the rider HOLDS ON under AUTO or a hand: physics); if a designer prefers no hold, a box seat (half sizes
  0.22 x 0.06 x 0.35, `p.box: 1`) kept every rider on at 10 deg without it.
- **PG_RENDER**: a pad's pose y is its centre (-half thickness at rest) plus its kick offset, the state the offset (0..travel over 0.2 s after a kick); a floater
  is `p.segments` capsule props (one per segment, in order) whose poses bob together; the ramp is 3 props (slab, rail -side, rail +side) matching your
  frostbell.ts geometry (the rails' centre ht + 0.07 over the slab centre, r 0.03). Home's Bounce Pad now has a prop (thing 5, parked: Home's count is 5).
- **PG_LIFE**: LIFE's own scoots never make a 'bump' (the glide is a rigid translation: no approach speed); bumps come from hops, falls, launches, pads and the
  ball. A floating body never sleeps (the water nudges it every frame) and gets `metrics.submerged`.

## R4.6 After the edits: every probe again
**Run A, the step-3 snapshot** (`r4_after_s3/`, 05:45 to 06:06, load 5.7 to 8.7; everything of steps 1 to 3: the prop count fix, D-95, setHome / setBounds,
the events, the bump memory, contacts, carryTo). Every check passes and fails as at HEAD, with the same measured values on every non-timing failure:
| probe | HEAD | run A | |
|---|---|---|---|
| probe_softbody --quick | 114/116 | **114/116** | the same 2 known fails, same numbers (3.73 % R; G1p unchanged); only timing rows and one INFO row differ (garbage in the first 2 x 60 frames after warmUp, information only: 496 -> 515 B a frame) |
| probe_lock --quick | 45/48 | **45/48** | same known perf fail (1.14 vs 0.74 ms); an alloc row's best window 0 B both |
| probe_cut / flush / neck / parts | 17/17, 11/11, 8/8, 11/11 | **same** | |
| probe_tips | 34 cuts, 33 made, 1 refused, 33 within | **same** | |
| probe_materials / families / many --quick | all, 22/22, 43/43 | **same** | |
| probe_truecut --quick | 104/113 | **104/113** | same builder rows; only INFO timings differ |
| probe_species | 25/31 | **25/31** | same 6 fails, same values (timing row and one failing list's order differ) |
| probe_app / gestures | 187/187, 160/160 | **187/187, 160/160** | |
| probe_playground | 35/35 | **45/45** (21.1 s) | 10 new rows |
| probe_merge | 22/22 | **22/22** | |
| probe_collection | 74/74 | **73/74** | C08 (previewTouch allocation, collection code: no physics import) is FLAKY: on the HEAD copy 74, 74, 74, 73 in 4 runs; on the working tree 73, 74, 73 (known: PG_SHELL.md 1, STATUS) |
| shellview/node_checks | 156/156 | **161/161** | PG_SHELL added rows since this morning |
| probe_economy / catalog | all / all | **all / all** | |
| probe_life | 95 ok, 1 fail | **95 ok, 1 fail** | LF-02, PG_LIFE's |
| probe_chatter | 42/42 | **42/42** | |
| renderview/pg_node_checks | 40 ok | **40 ok, 0 FAIL** | |
**Run B, the final snapshot** (`r4_final/`, from 06:07: step 4 adds the world-tracking hook in setPropWorld, `metrics.submerged`, the S2 world code, the Shake Pine,
and a round-4 PH-11 row): the probes those edits can reach, 06:07 to 06:22 (`run_r4_final.sh`); the snapshot is byte-identical to the working tree's
softbody.ts, props.ts and probe_playground.ts at the end:
| probe | HEAD | run B |
|---|---|---|
| probe_softbody --quick | 114/116 | **114/116** (same 2 known fails, same numbers; only timing rows and the INFO garbage row, 515 / 512 B, differ) |
| probe_lock --quick | 45/48 | **45/48** (same known perf fail) |
| probe_cut / probe_many --quick / probe_truecut --quick | 17/17, 43/43, 104/113 | **17/17, 43/43, 104/113** |
| probe_app / probe_gestures | 187/187, 160/160 | **187/187, 160/160** |
| probe_playground (quick set) | 35/35 | **54/54** in 23.9 s (load ~7) |
| probe_playground --only=alloc (PH-11) | 0 B | **0 B in 4/4 windows** (the round-3 row) and **0 B in 4/4** (the new round-4 row: AUTO swing + rider holding on + AUTO rocker + a floater in a current) |
| probe_merge / probe_collection | 22/22, 74/74 | **22/22, 74/74** |
| shellview/node_checks | 156/156 | **161/161** (PG_SHELL's rows) |
| probe_economy / probe_catalog | all / all | **all / all** |
| probe_life | 95 ok, 1 fail (LF-02) | **95 ok, 1 fail (LF-02)** |
| probe_chatter / renderview/pg_node_checks | 42/42, 40 ok | **42/42, 40 ok** |
Not re-run in run B (no code path reaches them from step 4: they bind no PropWorld; run A covered the shared softbody.ts edits): probe_flush, probe_neck,
probe_parts, probe_tips, probe_materials, probe_families, probe_species. `npx tsc --noEmit -p tsconfig.json`: exit 0 at 06:23. No process of mine left running.

## R4.7 Known issues and NOT done (round 4, honest list)
- **The physics first-load cap is full**: softbody.ts is 112 948 B, +18 417 B over the PC line's 94 531 (cap 18 432 B: 15 B left). Anything more in the solver
  (`mods`, ice, wind) must first move code out of softbody.ts (14.3's overflow rule) or land in the life chunk as S2 did.
- NOT built: `mods` (E2) and everything that reads it (ice grip and drag on the Ice Pond and the ramp, wet grip, soaking: physics reads mods[4] for density
  only), PH-08, PH-22's mods clause; waves, weather strikes (cause 2); the current zone kind; the bulge slosh in water; PH-01's raised S2 hops (the S1 cap 0.84
  stays for every family); S3 (wind, updraft, magnet, the turntable, setMotor, setKinematic; PH-13, PH-17); PF-06; the Sunbow Arch.
- The rider HOLDS ON while AUTO or a hand drives a swing (a physics assist, softbody.ts): without it riders roll off the round capsule seat at any steady arc.
  A designer may prefer the box seat (PG_DATA) and no hold.
- The soft and sticky families get little lift from a pad (sticky stretch 5.9 cm, slime 3.1, putty 0.7, marshmallow 9.3 against 24 for the firm ones): their
  squash recovers instead of lifting. Inside the spec (at most the cap) but a designer should look at it.
- LIFE's scoots make no bump events (a rigid glide has no approach speed): bumps come from hops, falls, launches, pads, the ball and tosses.
- The quick set of probe_playground: 54 rows in 25.2..26.0 s at load 6.4..8.7 today (the 35 old rows take 14.2 s of it, 12.4 s in this morning's baseline
  run): over the 20 s target on this loaded machine; `PGTIME=1` prints each section's time. The long rows (`--only=<section>`, `--full`) are unchanged in
  kind.
- probe_collection C08 is flaky at HEAD and after (not physics).
- The AUTO-off die-down with a rider, after a 10 deg arc, takes 7 to 9 s (the rider and the seat rock together, about 3 s a swing): about 3 swings.

## Round 4 log
- 05:04 read round 3's report, the brief (D-95 revised), SESSION3, PG_SHELL.md; the container had restarted at 05:01 (scratch intact). Working tree clean at
  7e64f2018. 05:07 baseline run on a `git archive` copy (R4.0).
- 05:20 step 1 (the count bug). 05:22-05:40 step 2 (D-95): AUTO first as a blend over 0.6 s (a jolt on the rocker at its limit: replaced by an arc that
  starts from the state), riders rolled off the round seat at any arc (the rider's pendulum pace alone did not help; a box seat did; the hold-on did), the
  hand, the held rider's coupling (without it the seat swung 6.9 deg and lost its rider).
- 05:40-05:45 step 3 (events, contacts, bounds, home, carryTo); the softbody.ts size went over the 18 KB cap (18 820 B) and was trimmed under it (the place
  corral merged into matCorral, readouts removed, compact validation). 05:45 run A on a snapshot.
- 05:47-06:01 step 4 (S2 in the life chunk: water, pad, ramp, floater); 06:05 the Shake Pine. 06:07 run B on the final snapshot.
