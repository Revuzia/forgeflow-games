# Lane W — world activities (checkpoint)

Owner files: src/world/caches.js, trials.js, bounties.js, beacon.js,
src/shaders/worldact.glsl.js. Probe: _harness/qa_worldact_node.mjs.
Run: `node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_worldact_node.mjs`
Diags (assert nothing): _harness/wa_diag_pool.mjs [realm] (real build's per-trial
record), _harness/wa_diag_walk.mjs [realm] [k] (greedy vs DFS reach per start).

## Session 3 (resume) — 2026-09-30

Baseline (this session, before edits): 70 checks, 5 FAIL (static Math.random,
sand trials 2/3, sand re-validation down 0.87, ash trials failed:1, allocation 274 B/frame).

Root causes found:
- Math.random: only COMMENT text in caches.js:149 and bounties.js:13/418 (code
  already hashes). Fix = reword the comments.
- Sand trial.sand.1 (sunkenColonnade): greedy walk reached 8 gates from 1/90
  unblocked starts (then rejected for passage); a backtracking DFS found 8-gate
  lines from 22 starts. NOTE: anchors of shrines are laid out on COLD (boot
  realm) — the old wa_diag_sand1.mjs built the shrine on sand ground, so it
  saw a different world; wa_diag_pool/walk boot on Cold like the probe.
- Ash "failed:1": stats.failed was CUMULATIVE across realms (sand's failure).
- Sand down 0.87: build sampled grade every 2 m, the probe every 1 m; and the
  post-build re-assert only logged, never rejected.

DONE (trials.js):
- _walkGen = best-first DFS with backtracking (WALK_EXPANSIONS 40/start);
  greedy path first, so it equals the greedy walk wherever greedy succeeds.
- SAMPLE_M 2 -> 1 (same grid as the probe).
- _shippedOK(): Float32-rounded gates + drawn (central-difference) headings
  re-validated BEFORE replay; failing lines skipped (rec.rejectedRevalidate).
- _finalize rounds to Float32 FIRST, derives normals/headings from those.
- other-trial clearance = point-to-POLYLINE (symmetric), not point-to-gate.
- stats.failed / rejectedPass = latest build; failedTotal cumulative;
  stats.lastBuild = per-trial record (instances, walks, pool, rejects, ratio).
Result (run2): all 3 realms "3 trials ... PASS" and "re-validated PASS".

DONE (run5 = 70 checks, 0 failed):
- Math.random comment text reworded (caches.js hash3 doc, bounties.js x2).
- Allocation 344 -> 0.22 B/frame: caches glint basis + beacon uBeaconA are
  Float32Array uniforms (r172 uniform3fv/4fv path) instead of Vector3/4
  field stores; caches shading knobs written only on change; caches
  _signature() writes a Float64Array instead of returning a boxed double;
  beacon re-grounds only on new waypoint / setRealm / terrain.rebakeCount
  change (fallback every 30 frames if no counter). Probe: indexed loops (the
  for...of iterator was harness allocation), per-system attribution, terrain
  stub has rebakeCount, new re-bake re-ground assertion.
  Diag: _harness/wa_diag_alloc.mjs (sampling heap profiler).

DONE (run9 = 71 checks, 0 failed):
- New probe check: busy steady frames (live bounty 0.62 B/f, running trial
  0.04 B/f) after a 6000-frame warm-up (short warm-ups measure the
  interpreter, where every double boxes).
- Build cost: POOL_ENOUGH 8 early exit of the start scan -> CPU 172-297 ms
  per realm (was 450-670 after DFS; ~1M -> 140-340k heightAt). Grade-first
  two-pass tried and REVERTED (no gain). Wall-clock slice stats are
  preemption noise on this box (CPU 100%, 82 chrome, 17 node measured).
- Probe ring check per radius (0.8 @0.5R, 1.6 @0.8R, incl. gate 0).

- trials.js header updated (backtracking walk, 1 m grid, _shippedOK, polyline
  pad, per-build stats). run10 = 71/0 after the edit.
- qa_worldact.py: boot = 15 min x 2 attempts, records rAF/s; a failed boot
  prints "SUMMARY NOT RUN (environment)" and exits 3. qa_worldact.js: realm
  ready wait 120 game-s (time-sliced build).

IN FLIGHT: browser proof `python -u _harness/qa_worldact.py --stage full`
(log: scratchpad browser1.txt). Machine at 100% CPU. Booted in 100 s at
0.59 rAF/s. So far PASS: cold ready; 15 caches 2/12/1; 3 trials (same lines
as node: ideal 29.47/20.7/20.7, rejectedPass 9); pairs re-validated; 3
bounties sited; E opens relic (Rime Heart credited once by lane R), lore
(+13 glass, lore.cold.1), grand (+60 glass); trial.cold.1 GOLD 29.80 s vs
par 36.36 (11 gate events, 120 glass + trail.frost); bounty killed (40
glass, xp granted, enemy:killed.bounty); draw delta 3.43 (perSystem 2/1/0/1).
INVALID evidence in that run: the cache/glint/gate/beacon SHOTS — wall-clock
waits (< 1 frame at 0.59 fps) shot the camera mid-flight (beacon check passed
with camera 82.9 m off and a whole-frame diff). FIXED in the probe for later
runs: visual_one() = game-time settle + projected box on/off diff vs control
box; new `--stage visual`.
FULL RUN RESULT: SUMMARY 34 checks, 0 failed, exit 0, zero page/console
errors (2nd boot 134 s at 0.48 rAF/s). Reload: caches [0,1,4] stay opened,
trial best 29.80 gold persists, killed bounty stays dead. Sand + Ash: ready,
2/12/1, 3 trials each (sand.1 builds: walks 65, pool 8), pairs re-validated,
3 bounties, relic/lore/grand open. Beacon line in that run = NOT evidence.
VISUAL RUN 1 (browser2.txt, old gains): cache close-up PROVEN (3040 px vs
0 control; formation + star visible in crop); trial gate at 29 m visible
but pale (4717 px); glint result INVALID (H.hide never restored the caches'
event-scoped visibility -> fixed in qa_worldact.js); BEACON 200 m FAIL: 0 px,
column found at the projected x=625 but only ~2/255 over the sky.
ROOT CAUSE: scene tone-mapped at S.exposure 0.105; lane W additive output was
in raw scene units. FIX (generator): worldact.glsl.js EMISSION section,
REF_EXPOSURE + emissionGain(); uGlintGain / uGateGain / uBeaconGain =
gain / S.exposure written on change; gains GLINT_GAIN 0.3, GATE_GAIN 0.3,
BEACON_GAIN 0.6 (public `.gain` on each system) — TO CALIBRATE.
Also: trials frame path passes no computed double across calls (_runStep
reads this._dt, inline plane/lateral/smooth) -> running-trial alloc 0.04 B/f
on two consecutive runs; node probe 71/0 (run12_1, run12_2, run13).
Probe: visual_one = pinned rider, off/on/off triple, signal vs off-off noise
and control box, peakRise; beacon also at 380 m; glint at 85 m.
VISUAL RUN 3 (browser3.txt, gains 0.3/0.3/0.6, 3.29 rAF/s): by eye in the
off/on/off crops — beacon column visible at 200 m AND 380 m (absent in both
offs), gate a bright ring at 29 m, cache formation visible; glint at 85 m
NOT visible (camera ~100 m: shader fade on CAMERA distance was full only to
90 m). Strict criterion failed on noise: rider idle animation + camera/sun
drift between frames.
FIXES: GLINT_CAM_ARM 15 (shader read range 105 m camera = rider 90 m);
probe math check updated. Probe: S.freezeTime during the triple (world
still, rendering on), H.clearView() picks a glint viewpoint with terrain
line of sight. Node probe 71/0 (run14-16; one flaky 11.47 B/f combined
allocation run in 5 -> warm-up 2000 -> 6000, run16 0.19 B/f).
VISUAL RUN 4 (frozen world): cache close PASS (1637 px, noise 0), glint
85 m PASS (79 px, peak 67; soft ice star at the Rime Circle foot); gate +
beacons 0 px = PROBE BUG (H.hide restore covered only the caches; under
freeze update(0) re-derives nothing) -> restore all four.
VISUAL RUN 5: cache 1259 px, glint 68 px, gate 2988 px, beacon 380 m 306 px
all PASS with noise 0; beacon 200 m 11 px / peak 17 = faint pale line.
-> BEACON_GAIN 0.6 -> 1.0. RUN 6: beacon 200 m 347 px / 380 m 498 px PASS;
glint 85 m 38 px (pulse trough frozen) = a ~5 px dot -> GLINT_GAIN 0.3 ->
0.5 and glint angular floor d*0.016 -> d*0.022.
RUN 7 (final code): SUMMARY 8 checks, 0 failed — cache close 1420 px (peak
80), glint 85 m 196 px (peak 108), gate 2939 px (peak 68), beacon 200 m 468
px (peak 35), beacon 380 m 526 px (peak 38), all noise 0 control 0; draw
delta 4.0 (2/1/0/1); zero page errors. Node run17 (final code) 71/0.
FINAL GAINS: GLINT 0.5, GATE 0.3, BEACON 1.0 (display units / S.exposure).
FULL BATTERY run 8 (final code): 37/38 — glint 85 m 0 px: probe geometry
(glint projected exactly behind the rider's head, yaw offset 0.12) -> 0.3.
FULL BATTERY run 9 (final code + probe fix): SUMMARY 38 checks, 0 failed,
exit 0 (boots 112 s @2.4 rAF/s, 48 s @6.55). Visual: cache 483 px peak 71,
glint 85 m 119 px peak 80, gate 2914 px peak 67, beacon 200 m 596 px peak
29, beacon 380 m 495 px peak 38 — noise 0 / control 0 each; trial.cold.1
gold 29.81 s (par 36.36, 11 gate events); bounty 2.5x HP lv 4 (+3), tint
mix 0.85, killed -> 40 glass, xp 0->18, enemy:killed.bounty; draw delta 4;
reload persists caches [0,1,4], best 29.81 gold, bounty dead; sand/ash all
pass; zero page errors. Node run18 (final tree) 71/0.
STATUS: DONE. Nothing in flight. Port 8923 has no listener.

## Integrator hooks (main.js — integrator only)
1. imports: RelicCaches (./world/caches.js), WakeTrials (./world/trials.js),
   Bounties (./world/bounties.js), WaypointBeacon (./world/beacon.js), bus.
2. construct after the `let bossKillsSeen = bossEncounters.kills;` block,
   before `initInput(...)`, in this order, on the shared meaning-layer ctx
   (needs scene, terrain, character, rig, spells, crystals: spells.crystals,
   registry, enemies, shrine, landmarks, progression, bus, input, S, overlay,
   getRealm: () => realmToken):
   caches -> ctx.caches; trials -> ctx.trials; bounties -> ctx.bounties;
   beacon -> ctx.beacon; then `if (questSystem && questSystem.waypoint)
   beacon.set(questSystem.waypoint);`
3. enterRealm: right after `landmarks.setRealm(token);`:
   caches.setRealm(token); trials.setRealm(token); bounties.setRealm(token);
   beacon.setRealm(token);
4. frame: right after `progression.update(dt);`:
   caches.update(dt); trials.update(dt); bounties.update(dt); beacon.update(dt);
5. warm-up: seed before `await warmUp(...)`, add `...caches.warmUpMeshes,
   ...trials.warmUpMeshes, ...beacon.warmUpMeshes` to its list,
   finishWarmUp() all three after the WARM_FRAMES loop.
6. E key (lane U): caches.readsInput = false; on the E edge:
   `if (!caches.tryInteract() && shrineMenu.reach) shrineMenu.open(shrineMenu.reach);`
7. ctx.S must be the live settings object (the glint / gate / beacon gains
   divide by S.exposure each frame; without it they fall back to 0.105).

Probes: node `qa_worldact_node.mjs` (71 checks); browser
`python _harness/qa_worldact.py --stage full|visual|smoke|realms` (port 8923).
