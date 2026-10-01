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
