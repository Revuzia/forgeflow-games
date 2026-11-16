# PG_PHYS lane brief: props, zones, ground, hop, sleep and the LIFE drivers in the soft-body physics

Read first, in this order: `_handoff/STATUS.md`, `_handoff/briefs/COMMON.md`, `_handoff/briefs/SESSION3.md` (it wins where they differ), then this
brief. Paths are relative to `games/wobblehoard`.

**Revision 3 (2026-11-15, after the adversarial review; PLAYGROUND_BUILD.md 2 D-60 to D-84 and 23).** What changed for you: LIFE travels with
a new `scootTo`, never `moveTo` (D-63); `sleep()`, `contactSlot`, `SoftEvent.other` and `SoftMetrics.contacts` are new (D-61, D-65); `auto` now
covers body-to-body bumps (D-62); props map back to things and parts in one fixed order and strikes carry a cause (D-64); the seesaw floor rule
replaces any floor contact for hinges; the Float rule is the shell's (D-83, PH-21 moved to SH-11); one physics bar measured two ways (PF-00 and
the phone factor F, D-60), so PF-05 is 6.0 / F ms, not 2.0 ms; a byte cap for your first-load code (18 KB) and `props.ts` in the life chunk (D-69);
the probe runs its quick set with no arguments.

## When you may start
**Only after the queued physics work is verified**, in one physics owner's hands (JUDGE_COHERENCE M15): STATUS "QUEUED" 2 (the independent
re-verification of checkpoint 47 and the lift fix) and 3 (physics round 3: the pull-into-the-ground fix, multi-pull and LOCK per `_spec/LOCK.md`,
the cut neck swell on putty, slow-rise and firm silicone). If you are the round-3 engineer, finish and verify that first. Nobody else may be in
`src/physics` while you work. **PF-00** (the phone factor and the unit weights, T13) runs at step 0 as one heavy job, before PG_LIFE fixes its
caps; until it reports, F = 4.

## You own
- `src/physics/**`: the additions to `softbody.ts` (and `params.ts`, `shape.ts` only where a row below needs it), the new `src/physics/props.ts`
  (it ships in the **life chunk**, not the first load, PLAYGROUND_BUILD 11.14)
- `_harness/probe_playground.ts` (new: PH-01 to PH-23 and PF-05). **With no arguments it runs the quick set in under 20 s** (that is what
  `run_probes.ts` runs: it passes no arguments, run_probes.ts 12); `--full` runs every row on 12 families x 3 genomes (about 1 to 2 minutes, a
  heavy job); PH-13 behind `--heavy`
- the physics probes you already own (`probe_softbody.ts`, `probe_species.ts`, `probe_families.ts`, `probe_cut.ts`, `physview/**`,
  `browser_physics.mjs`) only to re-baseline hash rows that turn sleep on (PH-10), each with a written reason in your report
- Running report: **`_handoff/reports/PG_PHYS.md`**. Port 5368. Scratch:
  `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_phys/`

## You must not touch
`src/shell`, `src/ui`, `src/input`, `src/render`, `src/audio`, `src/life`, `src/data`, `src/core`, `src/collection`, `_harness/mocks.ts`,
`_harness/run_probes.ts`. Any contract change: additive and optional in the PLAYGROUND block of `src/contracts.ts`, documented, typecheck clean,
reported; never change an existing member. No git write command.

## Read (completely)
`_spec/PLAYGROUND_BUILD.md` 2 (decisions D-04 to D-15, D-38, D-54, D-55, **D-60 to D-65, D-83**), 7 (the members you implement), **8 (all of
it: your spec)**, 14.2 (the frame budget, F and the awake-budget formula), 14.3 (your 18 KB first-load cap and the per-step byte report), 15,
16, 18 (the PHYS rows and PF-00, PF-05), 21, 23; `_spec/PLACES.md` 1 (rules P1 to P12), 2.1 (the 14 mechanisms and their ranges: **the seesaw
floor rule, the ring's clear opening, a capsule's total length**), 2.2 (zones), 2.4 and 2.5 (densities and the float table), 4.1 and 4.2 (Home
and the cabin: the S0 and S1 things; **the cabin has a wide and a tall layout**); `_spec/LIFE.md` 5.1 (the primitives: `scootTo`, the hop
recipe), 5.4 (memory families), 5.5 (HELD), 10.3 (units); `_spec/LOCK.md` 3; `_handoff/maps/PHYS.md` (the E-numbers, measured costs);
`src/contracts.ts` PLAYGROUND block (its header lists every revision 3 member).

## What the code does today (HEAD 4fe77736 line numbers; round 3 will move them, find them by name)
- Support, tack and land detection only near y = 0 (`NEAR` 0.01, softbody.ts 2214-2295); grounded = 3 or more near particles (2788-2836). On any
  prop top a body gets full gravity, sags and creeps and can never sleep or hop (the comment at 1900-1904).
- Supported gravity fades a resting body's weight to zero (1906-1916): a sitter puts no weight on a seesaw unless you transfer it (D-12).
- Particle masses have a mean of 1 (shape.ts 205-216), so Mtot = the particle count (642 at detail 3, 162 at detail 2 and for a 1/8 piece).
- **One `moveTo`** (one target, one flag, 1213-1219) is a horizontal glide with the corral off (1856-1873): nothing climbs (P3), and the
  ceremonies and the cut (cut.ts 213) use it, so it can never be touch-gated: LIFE gets its own `scootTo` (D-63).
- The float hover pulls every body to x = z = 0 (1918-1926). Physics keeps float mode exactly as today: the shell never asks for it where it would
  hurt (D-83), so there is **no** "ignore `gravity = false`" rule in physics.
- The slosh push runs only when `!gravityOn` (2336-2352): in water a water-filled body sloshes through its bulge, not a push.
- Tack is table-only (2241-2271) and strands come from a retracting fingertip only (2825-2831): no tack or strands on props (D-54).
- `boundRadius` is recomputed for every pair (1331-1342); the bump memory is `MAX_OTHERS` 16 keyed `bodyId & 15` (276, 1405), where `bodyId` is
  per process, so it aliases past 16 bodies made in a session; a body bump fires above 0.35 m/s (intensity = speed / 3, so at least 0.117) and
  names no partner (1403-1410).
- `feedback.handle` plays `audio.bump`, `haptics.pop()` and a shake for any bump over 0.05 (feedback.ts 146-151): a LIFE boop between two bodies
  would buzz the phone unless it is `auto` (D-62).
- `emit` allocates three objects per event (2690-2699).
- `dragF` is baked (766) and applied to the whole velocity (2658): ice needs it mutable (mods[3]). Per-body numbers go through a Float64Array, never
  object fields (the V8 representation rule, 224-230). `MAX_SPEED` 14 m/s clamps particles; `LAND_MIN_SPEED` is 0.9 m/s (155); GRAVITY is 10
  (params.ts 16).

## Build, in this order (PLAYGROUND_BUILD 8)
**S0 "Life at Home"** (the exit is FN-01; Home's things are static blocks, a rug patch and one ball):
1. **E9 touch gate** (8.7): while `fingers > 0 || grabbed || carried || locked > 0`, the LIFE drivers (`scootTo`, `setSquash`, `hop`) pause and
   ease out within 0.12 s; `moveTo` and the other ceremony drivers (`setFold`, `tremble`, `burstOpen`) are untouched. Fill `SoftMetrics.locked`
   from LOCK (a locked body is HELD for its own brain; it never silences the party, which is the shell's rule, D-84).
2. **E7 drivers** (8.7): **`scootTo(x, z, speed)`** (D-63): 0.04..0.5 m/s, a rigid horizontal glide eased in and out over 0.12 s, the corral off
   while it acts (the corral test at 1858 also checks the scoot flag), touch-gated, yielding to `moveTo`, NaN x releases it, false when HELD or a
   ceremony driver is on; a scoot at 0.04 m/s or slower into a sleeping partner never wakes it (the wake speed is 0.05 m/s). `setSquash(s, tauS)`
   volume-preserving in `frameUpdate` (2391-2397), refused for putty, mochi dough and bead squeeze while `memoryBusy` (fill
   `SoftMetrics.memoryBusy`: max |MEM - Q| over 0.02 R); **a call identical to the one in force is a no-op and never wakes**. `hop(vx, vy, vz)`
   with glue and peel damping suspended for 10 substeps, vy clamped to the S1 cap 0.84 m/s (`HOP_VY_CAP`), false when HELD, airborne, within 0.8 s
   of the last hop, a ceremony driver is on, or memory is busy; allowed from a supporting prop face (relative to a moving prop's surface
   velocity). `carryTo(x, y, z, s)` (a kinematic arc like the carry, set down with no velocity, no poke, press, release, grab or snap: PH-20);
   `wake()`.
3. **Support on prop faces** (8.3, D-11): a particle on a face within 35 degrees of up counts toward `near` / `nearMass` for supported gravity, the
   friction load, `grounded` and land detection; on a face tilted more than 2 degrees gravity's tangential part is kept (ramps still slide).
4. **E10 sleep** (8.6, opt-in `sleepEnabled`): the rest test (kinetic < 0.02, centre speed < 0.01 m/s, supported by the table, a STATIC prop face or
   floating at rest, no driver, timer or easing of the PHYS map 4 list, for 0.5 s); freeze; wake causes; a contact wakes a sleeper only above
   0.05 m/s or a 0.2 x mean-edge push in one substep; islands; memory families sleep under 0.02 R with `memoryStep` at 1 Hz and a 0.3 s goal ease
   on wake; never on a moving prop; float mode never sleeps; zero position jump on wake; `metrics.asleep`. **`sleep()`** (revision 3): sleeps a
   body at rest at once, false if it is moving, on a moving prop or in float mode; the shell uses it for untouched party members over the awake
   budget and for bodies spawned at rest on travel (PH-22).
5. **E3 bounds** `setBounds` / `setHome` (a place-bounds branch of `matCorral`, 1600-1620: a disc or a rounded rectangle with a corner radius;
   shape -1 restores today's corral). Home's bounds are the visible table the shell passes; a place's are the bounds of the layout in use.
6. **E2 modifiers** `mods` (8 floats, eased over 0.3 s; all 1 except [7] = today bit for bit: PH-10 rows unchanged at Home). **[4] density is
   used for every family** (the pop dome floats as the float table says). **A write wakes a sleeper only when a modifier that acts where the body
   is changes by more than 0.02** ([0..3] on the ground or a prop face, [4] only in a water zone, [5] only in wind or an updraft, [6] only on a
   pad); otherwise it applies at the next wake (a drying foam's mods[4] changing every 0.1 s on dry ground never keeps it awake).
7. **Events** (8.8): `auto` on every `land`, every prop `bump` **and every body-to-body `bump`**, unless the body (for a body bump: either body) is
   HELD or was thrown by the player since its last landing; `prop` = the prop index on prop bumps; **`other`** = the partner's contact slot on
   body bumps (PH-14).
8. **Collide** (8.9): bound radii cached once per body per frame; asleep-asleep pairs skipped before the sphere test; the bump memory widened to
   32 slots keyed by the shell-assigned **`contactSlot`** (0..31; a body without one keeps today's key), and **`SoftMetrics.contacts`** = a bit per
   slot this body touches this frame (PH-19). The mass-blind push stays.
9. **E4 prop pass + E5 `props.ts`, static shapes and the free ball**: the pass once per substep between the fingertip and table passes (2197-2217),
   bounding-sphere test against the cached `bR`, Coulomb friction with the prop's surface velocity (prop mu x the family's table-friction ratio),
   impulses scaled by bodyMass / Mtot with bodyMass = (restRadius / 0.5)^3 x frac (PH-06), prop contacts in the fold limit only while worked
   (penetration over 0.15 x mean edge, relative speed over 0.3 m/s, or a moving prop; mirror of 2227-2229; PH-12).
   **`buildPropWorld(place, layout, bodyScale)`** from a `PlaceDef` and the layout in use (wide or tall, D-68; Home's spots are in slot units x
   bodyScale, D-67), packed layouts documented in the file header, **one fixed prop order** (every prop of things[0] with its parts in order, then
   things[1] ..., walls last; a thing not yet arrived at Home is parked: no collider), **`propThing` / `propPart`** filled from it (PH-23),
   `beginFrame` / `endFrame` once per frame, `poses`, `raycast`, `poke`, **`drainStrikes` as quads [prop, intensity, cause, slot]** (cause 0 the
   player's poke, 1 a body with its contact slot, 2 the weather: a gust or a wave), `stateHash`; the ball with roll damping, walls, bounds (at
   Home the visible table the shell passes, shrunk by its radius) and the 2.0 m/s clamp. Zero allocation, deterministic. A capsule's `size[1]` is
   its **total** length including both caps.

**S1 "Hearthlog Cabin"** (static, hinge and ball only: PLACES 4.2, both layouts):
10. **hinge1** for the Rocker Board (seesaw: board 2.2 x 0.16 x 0.6, pivot 0.24 m, limit 8 degrees) and the Pillow Swing (rope 1.4, limit 30
    degrees, swinging across the room in the wide layout and toward the camera in the tall one): limits, inertia, damping; **moving props advance
    per substep** (pose(t0) + v x k x H, as fingertips at 2129), seat speed at most 2.0 m/s; **weight transfer** (D-12: a body supported by a
    moving prop adds bodyMass x g x its supported share at its contact centroid every substep); teeter hops from the board (S10 in LIFE, turn by
    turn). **Hinges have no floor contact**: the floor rule (pivot >= (L / 2) sin(limit) + (t / 2) cos(limit), 0.232 m for the cabin's board)
    keeps every seesaw clear of y = 0 (the first rocker reached -0.085 m: REVIEW_code-truth M9). If PH-04 shows a board touching the floor anyway,
    report it; do not add a floor contact without the designer.
11. The Snug Basket ring (6 static capsules on r 0.89, gap 120 degrees), the kettle (a block and a static sphere), the fireplace block.
12. **PF-05**: PF-01's node twin on this container (the same scenarios: 4 wholes in the cabin, one touched and three asleep; then untouched, one
    LIFE mover and three asleep): **at most 6.0 / F ms (1.5 at F = 4)**. 14.2 recomputes them at 1.13 and 1.16 ms. PF-02's low case (one awake
    whole, 1.11 ms against 1.0) may miss: that is today's one-body cost, which you report as a physics perf item, never a reason to raise a bar.

**S2 "Water and cold"**: E6 water as a gravity scale (g_eff = g x (1 - f_sub / density), f_sub from the depth at the centre with the zone's 0.4 m edge
ramp; g_eff < 0 rises with drag 2.5 /s relative to the water; whole body only); the current for floating bodies and floaters (at most 0.15 m/s);
`metrics.submerged`; the **flush pad** (slider1 that kicks up: upward speed = gain x landing speed, capped by the apex, at most 5 bounces; the
sticky hold of stickystretch 0.4 s and slimegoo 0.6 s); chimes struck by contact (hinge1, `drainStrikes` with intensity, cause and slot); ice
through mods (grip, drag); then **PH-01's raised hops per family** (normal 6 to 8 cm, vy 1.10 to 1.26; big 12 cm, vy 1.55 for firm silicone and
pop dome) only for the families that pass, with `auto` landings, reported per family.

**S3 "Fields and echo"**: wind and updraft on airborne or floating bodies only (catch from mods[5]; under 0.25 m/s^2 nothing wakes); the magnet on
the steel ball only; the motor turntable (hinge1 on a vertical axis, flush, at most 0.4 rad/s); `setMotor`, `setZoneOn`, `setKinematic` for the
queued Stamp and Roll tools; PH-13 if there is time (heavy, optional).

## Fallbacks (decide with numbers, never by loosening a bar)
- A body slides off the swing's capsule seat in PH-04: try a box seat 0.16 x 0.5 x 0.7 m (still a hinge1 seat); report it so PG_DATA changes the
  ThingDef.
- A seesaw that will not tip under a sitter: check the weight transfer first (D-12).
- PH-03 creep over 2 mm in 3 s on a box top: report the family and genome; do not raise the bar.
- If PH-01 fails a family at the raised S2 hop, that family stays at the S1 cap (V8).
- If one awake whole alone misses PF-02 (low), report it as today's one-body cost (14.2); the shell's awake budget never goes under one whole.

## Acceptance ids you must make pass
PH-01 to PH-12, PH-14, PH-18 to PH-20, **PH-22, PH-23** and PF-05 (S0 and S1); PH-15 and PH-16 (S2); PH-17 (S3); PH-13 optional (PH-21 moved to
SH-11). Plus every existing gate unchanged with no PropWorld bound and sleep off (`probe_softbody --quick`, `probe_species`, `probe_families`,
`probe_cut`, and the shell's `probe_app` and `probe_gestures`, which you run but do not edit), and a clean typecheck.

## Budgets
Physics 6.0 ms mean per frame on a mid-range phone on med (low 4.0, high 10.0), measured by SHELL's PF-01 to PF-03 with a 4x CPU throttle; **its
node twin is the same bar divided by F** (PF-05: 1.5 ms on med at F = 4; low 1.0, high 2.5); an asleep body at most 0.03 ms a step (PH-09); PH-12 at
most 1.25x with 4 props in reach; **0 B per 120-frame window with no SoftEvent** with props, zones and drivers (PH-11: an emitted event
allocates three objects by design, reported per event); determinism with props, zones and sleep (PH-10). **Size:** your first-load code at most
18 KB minified (the drivers, sleep, support on prop faces, the prop pass in `softbody.ts`); `props.ts` goes in the life chunk; after every step
report the minified bytes of each new or grown module (PLAYGROUND_BUILD 14.3's one-file rolldown build). One heavy job at a time (SESSION3).

## Report
Before and after numbers for every row, the re-baselined hash rows with reasons, per-family hop apex and landing speed (PH-14), PF-05 with the load
and the F it used, the module byte sizes after each step, and what you did not check.
