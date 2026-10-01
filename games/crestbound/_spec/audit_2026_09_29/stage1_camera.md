# Stage 1 - camera lane (swept sphere via Rapier) - PROGRESS

Owner files: runtime/player/camera.js, _harness/camcheck.py, runtime/world/camworld.js (new),
assets/vendor/rapier/ (new). Never game.js / course.js / index.html.

## Plan
1. Vendor @dimforge/rapier3d-compat 0.20.0 (compat build embeds wasm) into assets/vendor/rapier/,
   import by relative path from camworld.js, init once async (dynamic import, off first frame).
2. camworld.js: a Rapier world with the course's STATIC colliders (broadphase boxes that are not
   hazard/critter/moving) + terrain heightfields. Built from inside camera.js when the broadphase
   identity changes. Until ready, the old whisker path runs unchanged.
3. camera.js: the lens probes in `_clearance` become one castShape(ball R) from the focus along
   the heading (static part) + the old rays for the dynamic part (movers, rotors, occluders).
   Keep ease-out, minDist, hero-fade. Add CAMERA VOLUMES (course-data schema) + hero-on-screen rule.
4. Prove: camcheck --headless (all interior stations), fort ramp / granary / verdant-2 kick shaft
   driven with real input, boot-to-first-frame before/after.

## Log
- 2026-09-30: read CONTRACT, HARNESS_NOTES, PLAN, sm64_bar section 2, gap_crestbound 2.3,
  DYEFIELD physics.ts + camera.ts, camera.js (3386 lines) in full.

## Status (resume run, 2026-09-30 evening)
- BUILT (uncommitted at resume, verified present): assets/vendor/rapier/rapier.mjs (0.20.0 compat, 2.86 MB)
  + LICENSE; runtime/world/camworld.js (491 lines: loader, incremental budgeted build, raw castShape
  sweep, membership/pose watch, demotion of moving 'world' boxes); camera.js +537 lines (sweep in
  `_clearance` with RAY_DYNAMIC fan for movers, `_sweepLens` embedded/touching rules, CAMERA VOLUMES
  orbit/fixed/tight, `_guardHeroOnScreen`, `?camrapier=0` A/B switch, `__test.camworld()`).
- camcheck.py NOT yet changed at resume.
- modulecheck: 71 modules, 0 failing (resume run).
- HARNESS TRAP (measured): the shared server on 8788 (ThreadingTCPServer, listen backlog 5) REFUSES
  connections when several lanes boot at once: `REQFAIL runtime/hazards/fluids.js
  net::ERR_CONNECTION_REFUSED` and the game never boots. The lane runs its own copy on
  127.0.0.1:8797 with backlog 256 (scratchpad serve_cam.py, same handler). Box at 100 % CPU,
  67 chrome processes: title -> keep took 141 s, so bootcheck's 45 s leave_title fails with
  "stuck at 'title'" -- load, not code.
- Stations the audit named (coordinates from the audit's own logs):
  * fort ramp: hero (11.38, 9.00, -23.85) UNDER the ROUTE C ramp, pressed on the fort's east wall
    (x 11), cam yaw -1.8 (lens toward the wall) -> dist 0.12, 120+ frames of grass (bailey.log 62-65).
  * granary: ridge-stair foot, hero (-6.0, 13.92, -20.9) on the granary's NORTH wall (z -20.5..-20.0),
    camera south of him (yaw 0) -> lens inside the granary (verdant-3#26, still reproduces).
  * verdant-2 kick shaft: existing camcheck row `verdant-2/@kickshaft` (minDist 0.148 vs 1.60 before).

## Evidence so far (resume run)
- Commit edc69e5c: vendored Rapier + camworld.js + camera.js (bootcheck --headless keep CLEAN on :8797).
- Vendored rapier.mjs is byte-identical to dyefield/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs (0.20.0).
- Node unit test of CamWorld vs real Rapier: wall sweep 5.1500 (want 5.15), heightfield bump 2.6500 / transposed
  5.6500 (row-major game layout transposed right), add/remove/toggle/move/demote all mirrored, 3000-box build in
  23 budgeted frames (worst 6.1 ms), 5000 raw sweeps 125 ms.
- In game (keep): 366-373 boxes + 1 heightfield mirrored, Rapier import+init 88-103 ms, build 5 frames.
- Static A/B at the audit's fort-ramp point (11.38, 9, -23.85, yaw -1.8): NO collapse in either mode on today's
  code (off 5.71-6.01 m, on 6.24-6.64 m, yaw slide -1.35, 0 off-screen frames). Driven A/B (real keys):
  run in under the ramp to the wall: off min 3.42 m / on min 3.57 m, 0 off screen. From the wall, run at the
  camera into the corner: one transient while the yaw slide flips sides through the wall heading: off 0.12 m
  (fade 1.0, 2 frames), on 0.41 m (fade 0.78, 3 frames) -- the sweep halves the worst frame; both inside the
  0.30 s ghost-line budget the kick rows use.
- Granary (verdant-3 #26) static A/B at (-6, 13.92, -20.95) yaw 0: both 6.8 m, slid 1.9 rad east, lens outside,
  0 off screen; frame read: hero on the stair beside the granary wall, terrain bank fills the right ~40 %.
- camcheck (commit 2dc61495) new rows: rapier PASS (rig 7/7 mirrored, sweep 5.150 = want, 792 sweeps, 0
  fallbacks), onscreen PASS (447 frames, 0 off screen); thinpost/volumes fixed after the first run (post sat ON
  the 0.25 m whisker; the orbit walk curved out of the volume). Timing rows starved at ~2 fps (box 100 % CPU,
  a runaway `find / -name ch35_1001_diffuse.png` pid 14732 not ours, 84 chrome processes).
- camcheck rows now time off engine.elapsed (game time, wall-clock runaway guard): a starved box had made
  shaft/framing/recenter/peek fail on 5-10 frames. Rows-only run (commit after 2dc61495): 12/12 PASS --
  thinpost A/B: fan alone 6.80 m with the lens path 0.075 m from a post between whiskers; sweep 2.72 m,
  path clearance 0.359 m. volumes: tight 3.00 m, fixed err 0.000, manual E push 0.767 then back 0.000,
  orbit err 0.000, exit vol null 6.80 m. onscreen 1005 frames 0 off. rapier rig 7/7, 5.150 = 5.150, 1566 sweeps, 0 fallbacks.
- camworld.js: a heightfield added after the build now triggers one rebuild (`_hfSeen`); unusable ones count
  as skipped so terrain stays on the rays (Node: rebuilt in 1 frame, new hf sweep 9.6500 exact, no loop).

## Final evidence (resume run, 2026-09-30/10-01)
- FULL camcheck --headless (:8797, quality low, autoscale 0): 23/23 station rows PASS with `cwLive true` on
  every course; MEASURE rows 11/12 in that run (volumes failed: a teleport out of a 'fixed' volume kept steering
  the yaw while easing out) -> fixed in `_snapToPlayer` (a snap is a cut for volumes too) -> rows re-run 12/12 PASS.
- Audit stations, before (fan only, `setSweep(false)`) -> after (sweep):
  * verdant-2/@kickshaft (10 real kicks): min dist 1.115 m (86 frames) -> 1.957 m (302 frames), fade 0.057 -> 0.
  * verdant-1/@fortramp (posed at bailey/031's point and yaw, 4 headings): 3.90 -> 3.88 m min, 0 off screen both;
    frame read: the lens slides along the east wall under the ramp, hero solid, grass + coins + ramp in frame.
  * verdant-1/@ramprun (real keys): 3.59 -> 3.57 m. @rampwall (run at the camera into the corner): 0.12 m with
    fade 1.0 (first-person commit) -> 0.795 m, fade 0.45, 0.20 s under the 1.25 m ghost line (budget 0.30).
  * verdant-3/@granary: 5.11 -> 2.40 m min (the sphere is more conservative), 0 off screen, lens outside;
    @granaryrun (forbid box = granary interior): 0 forbid frames both.
- bootcheck --headless keep CLEAN, verdant-1 CLEAN (after the last camera.js change).
- Boot A/B (camcheck --boot-ab 2): nav -> first live frame 41.5 / 42.0 s without Rapier, 40.8 / 39.1 s with it
  (box at ~90 % CPU: noise); the Rapier import starts 4.5 s / 2.7 s AFTER the first live frame, import+init
  80 / 75 ms, zero long tasks (>50 ms) inside the load window, the frame spanning it 161 / 119 ms (= the
  run's median frame).
- RESIDUAL: verdant-2/@midwalk passes but one heading still commits to first person (camDist min 0.12, fade 1
  inside the near-plane commit, 0 off screen) -- not A/B'd, not one of the three audit stations.
