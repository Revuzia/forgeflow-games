# PLAYER lane report (Wave 4)

## TRIAGE (top)
Fresh run: no prior REPORT.md. Nothing was done before this attempt.
Status legend: [ ] not started, [~] in progress, [x] done+verified

- [x] 1a P1.5 gun hidden while gliding (player.js viewPass)
- [x] 1b P1.8 faint cool rim + SQUAD UP ally rim (player.js zone-tint onBeforeCompile, new cache key, warmObjects)
- [x] 2  P3.1 (isla_viva + ashgrid verified, deepwood run in flight) camera wall pull-in (player.js updateCamera)
- [~] 3  P1.1 shared clip files, clone per skin (code written, NOT yet run in a browser)
- [~] 4  P1.6 seeded pick among 7 Mixamo death clips (code written, NOT yet run)
- [~] 5  P2.6 canopy GLB swap (code written against ART-A's real files, NOT yet run)
- [~] 6  corpse sink on sim time (code written, NOT yet run)
- [ ] gates written under _harness/new/player_*.py

## Baseline (git HEAD 3619646e served via --rev HEAD, before any edit)
framecheck PASS 18/18: drop cluster 175 calls / 1,004,567 tris / 49 actors / chute calls 2 / nametag 1;
match frame 190 calls / 985,620 tris; queryColliders 103 per match frame; 91.8 KB allocated per match frame (limit 100, so NO new per-frame allocation);
0 new programs on sampled frames (77 sampled). Report: baseline_framecheck.json / .log in this folder.

## Progress log

### Step 1 DONE (P1.5 + P1.8), verified in a real browser
- player.js: weapon visibility line is now d2 < wl2 && !emoting && !gliding. Zone-tint patch gained the rim (cache key lcZoneTint -> lcZoneTintRim1; uniforms
  zRimCol/zRimP per material + ONE shared zRimK = W.rimGain); applyRim() switches a SQUAD UP ally (teamId equal to the human's) to green (mode 2) from actorView.
  warmObjects adds a LOD0 warm body when no skin has a LOD1 (the warm frame already forces every live rig visible, so the program compiles there).
- Gate _harness/new/player_rim.py (+ player_lib.py --isolate, player_isowrap.py): 16/16 PASS. Measured (isla_viva seed 7, A/B render rim off/on, other actors hidden):
  outside-mask delta <= 1/255 (noise floor 0); wraith at 45 m edge luminance 35.3 -> 46.3 (x1.31); every skin mean edge ratio 1.01-1.31 (bar <= 4);
  p99 gain in mask 12-60/255 (bar 70); ally dRGB (0.8, 15.4, 5.3) = green dominant; 50 body materials, 1 program, 1 shared gain uniform.
  Sheets (A0 | A1 | diff x6): shots/player_rim_wraith_far_sheet.png, player_rim_ally_sheet.png etc. LOOKED AT: dark wraith hood/shoulders/arms get a faint blue edge, ally a clear green edge, no glow.
- framecheck (isolated, HEAD + my files) 18/18 PASS: drop frame 1 new programs 0; drop cluster 173 calls (baseline 175), 992,657 tris (1,004,567), actor-weapon calls 3 (4); match frame 189 calls (190); queryColliders 103/frame; KB/frame 93.5 (91.8 baseline, limit 100, noise).
- NOTE: other lanes' half-written files broke gates twice (loot.js threw mid-edit), so all my runs use --isolate = git HEAD 3619646e + my files from the working copy.

### Step 2 DONE (P3.1 camera wall pull-in), verified in a real browser
- player.js: camWall()/camRayHit(): ONE queryColliders per frame from the EYE to the free smoothed camera, expanded-box slab test (lens radius 0.28 m, props < 2 m wide ignored,
  an eye already within the lens radius of a face shrinks the radius instead of ignoring the box), snap in on contact, ease out at 2.2/s (63% in ~27 frames = 0.45 s), pure dolly
  (look target translated by the same offset so the orientation is unchanged), body hidden when the lens is < 0.75 m from the eye (back at 0.95 m, hysteresis), W.noCamWall test switch,
  W._camWall readback. Skipped in first-person scope and while gliding.
- Gate _harness/new/player_camwall.py (independent slab test, covered spots = floor loot under a roof box + 4 offsets, 4 yaws x 3 pitches x 4 frames):
  isla_viva 300 configs / 1200 frames / 25 spots: 0 violations (245 configs actually pulled in, min lens-eye distance 0.12 m), CONTROL (pull-in off) 980 violations on the 360-config run;
  ashgrid 288 configs / 1152 frames: 0 violations; open field idle on all 90 turn frames (lens on the free boom to 9e-16 m, vertical heave 0.0005-0.0006 m/frame);
  ease 63% in 27 frames, recov after 1 frame 3.7%, after 6 frames 20.1%, snap in within 1 frame (gap 0); orientation delta 4e-8..5e-8 rad while the lens moves 0.38-0.41 m;
  pull-in adds 0.88-0.97 queryColliders per frame (interleaved A/B), max 14-38 in one frame.
- LOOKED AT shots/cam_isla_viva_1_old.png (pull-in off: the whole frame is a blank brick wall, camera behind it) vs cam_isla_viva_1_new.png (pull-in on: camera inside the room behind the soldier,
  doorway, ramp, ceiling and a floor rifle readable) and cam_isla_viva_0_new.png (another room position, same result).
- Found + fixed during the probe: a wall closer than the lens radius to the eye was ignored (lens went through it, 48/1440 frames); fixed in camRayHit (retest with the radius the eye really has).
- Not mine, for the orchestrator: weapons.js crosshairPoint marches the camera ray from d = 3 m; with the lens pulled in against a wall behind the player a wall within ~3 m IN FRONT of the lens is skipped
  by that march (the projectile still collides normally). Only matters at point-blank against a wall; no change needed unless it is seen in play.
