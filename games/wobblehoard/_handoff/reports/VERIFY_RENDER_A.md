# VERIFY_RENDER_A: independent verification, RENDER lane, lens A (flash safety, robustness, bundle, memory)

Verifier: session-2 independent verifier (did not write this code). RUNNING REPORT, updated after every finished item.

## Snapshot
- Made with `scratchpad\tools\snap.mjs C:\Users\TestRun\AppData\Local\Temp\vra` (the LIVE game folder, as the task says).
- snapshotHash: `5171e13798e3e03e` (250 files; identical to the live tree at copy time; the live hash was still the same later in my run).
- Live tree vs committed HEAD `af1d77f2`: at snapshot time the live tree had UNCOMMITTED edits to `src/render/ceremony.ts`
  (+27/-3: burst-peak framing floor `BURST_OVERSHOOT`, calm hop 0, `framingForHeight`) and `src/render/stage.ts` (+8: `framingForHeight`, a
  REMOVE-WHEN-PHYSICS-FIXED comment). So this verdict covers HEAD + those two uncommitted edits, exactly as snapshotted (hash above).
- node_modules in the snapshot is a directory junction to G\node_modules (read only use).
- Snapshot-only edit outside `src/`: `vite.config.ts` got one line, `cacheDir` pointing at a private folder, so my vite never writes the shared
  `G\node_modules\.vite` (other agents run vite from G). No `src/` file touched. Harness port changed 5364 -> 5370 in the snapshot where needed.
- My scripts: `<scratch>\verify\render_a\scripts` (ported from `_handoff/verify_render/*`: paths, port 5370, `createStageDev` now lives in
  `src/render/stageDev.ts`, so lib.js imports it from there; plus my own `cutflash.mjs`, `cutleak.mjs`, `cutlib.js`, `advfuzz.mjs`, `misuse.mjs`,
  `alloc.mjs`, `particles_end.mjs`). Logs in `<scratch>\verify\render_a\logs`.
- Port 5370 only. One heavy job at a time. tsc on the snapshot: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` -> no output, exit 0
  (116 src files listed by --listFiles; tsc 7.0.2).

## Status (updated as I go)

### 1. VERDICT.md MAJOR 1 (chained ceremonies exceed the flash budget): adv.mjs
Old: 4 luminance transitions (>= 0.04 swing of mean linear luminance) inside 1 s. Now, same script, same definition:
- `SEQ=mythicSkipThenQuickCommon FPS=30 node adv.mjs 320 240 low`: win04 = 2 (was 4); flips at 1.63 s and 1.87 s; one ramp only
  (second flash refused by the governor, burst played soft); L 0.045..0.233; console problems 0.
- `node adv.mjs 480 300 med` at 60 fps (all 10 sequences), worst 1 s window at swing 0.04 / WCAG 0.1:
  quickpops5 2 / 0; quickpops5_uncommon 2 / 0; mythicSkipThenQuick 2 / 2; legendarySkipThenQuick 2 / 2; mergeMythicSkipThenQuick 2 / 2;
  mythicSkipThenUncommon 2 / 2; mythicSkipThenQuickCommon 2 / 2; mythicThenCommon 2 / 2; epicCapsules3 1 / 0; capsuleRareQueue_skip 2 / 0.
  At the stricter swing 0.02 the worst is 4 (quickpops5, Common x5 at 0.8 s spacing); the gate is the 0.04 definition (harness, old verdict). Console problems 0.
  Ramp starts show the mechanism: quickpops5 granted ramps at 0.32 / 1.92 / 3.52 s (every second quick pop gets no screen flash and plays soft).
  Old failing three (Mythic -> quick Uncommon, Legendary -> quick Uncommon, Mythic merge -> quick Uncommon) were 4/4/4: now 2/2/2.
- Governor alone (`gov_fuzz.mjs`, 2000 random runs x 400 requests): 0 violations of every check; maxGrantsIn1s = 1, minGrantGap = 1.0 s
  (the old script's "two ramps at 0.48 s" line is hard coded and no longer reachable: the governor now spaces flashes >= 1.0 s).
  Verdict on item 1: FIXED (pending my own random chains below).

### 3. Flash gate for the cut visuals (CUT.md X09), my own driver (`cutflash.mjs` + `cutlib.js`)
Real stage API (`setCutSeam` every frame of the neck, `addBody({chunk})`, `partPieces`, `setBridge`), real `SoftBody` (`setNeck`, `piece` opts, `collide`,
`setFrac`, `moveTo`) at 480x300 med, 60 fps, family sticky stretch (species `twangle`), global mean linear luminance, zigzag >= 0.04, worst rolling 1 s;
the cut is driven exactly as `src/shell/cut.ts` does (neck 0.3 s + 0.08 s hold, swap to two pieces, bridges for Reconnect all over 1.2 s).

| scenario | win04 (gate <= 3, aim 2) | win02 | WCAG 0.1 | worst 3x3 cell win04 | max frame jump | screen light | cut glow peak | pieces / strands / bridges (peak) |
|---|---|---|---|---|---|---|---|---|
| 10 rapid cuts + Reconnect all, normal | 2 | 3 | 0 | 5 | 0.0357 | 0 | 0.517 | 6 / 5 / 5 |
| same, Calm | 1 | 2 | 0 | 3 | 0.0214 | 0 | 0.142 | 6 / 3 / 5 |
| cut 0.25 s after a Mythic capsule burst, then Reconnect all | 2 | 3 | 2 | 5 | 0.0542 | 0.187 (the ceremony's own ramp) | 0.517 | 2 / 3 / 1 |
| 3 cuts, Reconnect all, then a Legendary capsule reveal | 2 | 3 | 2 | 5 | 0.0860 (the burst) | 0.177 (ceremony) | 0.521 | 4 / 5 / 3 |

The cut visuals never raise the screen light (0 in the two pure-cut runs), 0 console problems. Max pixel luminance 1.0 (specular), max near-pure-red pixel
fraction 0.0004. Re-running the first row gave identical numbers (win04 2, local 5, jump 0.0357): the run is deterministic.

CONTROL (same bodies, same motion, `setCutSeam` / `partPieces` / `setBridge` replaced by no-ops, `cutflash.mjs` with NOGLOW=1), 10 rapid cuts + Reconnect all, normal:
win04 1, win02 2, WCAG 0, worst cell 4, max one-frame global jump 0.0182. With the cut visuals: 2 / 3 / 0 / 5 / 0.0357. So the cut visuals add one global
transition, one cell transition, and double the biggest one-frame jump of the mean luminance. Where (`jumps.mjs`): t = 1.38 s, the frame of the first swap
(body -> two pieces + parting strands + carried seam): +0.0356 (control +0.0182), then -0.0141 on 1.40 s. That is 89% of the 0.04 swing that counts as a
transition; it stays under the gate here (2 transitions in the worst second), but it is a margin of 11%, see FINDING list (R-A1) and `swapjump.mjs` below.
The worst 3x3 cell is the centre one (the squishy): 5 swings >= 0.04 in 1 s at the first cut, WCAG-style (>= 0.1) 3 (at the limit, allowed), and the control has 4,
so most of the cell activity is the body deforming and parting, not the glow.

### 2a. VERDICT repro results so far: `robust.mjs` (all 20 cases, 276 s, "console problems left: 0", EXIT 0), `gov_fuzz.mjs`, BodyProxy, misuse
- VERDICT 3 (clearBodies / removeBody(result) mid-ceremony orphans the result): CHANGED to correct. `misuse_mid`: after `clearBodies` and after `removeBody(h.resultBodyId)`
  `primaryBodyId()` is `null`, `bodies` 0, `done` resolved (was: an id pointing at a removed view). `removePrimary`, `setBody`, `addBody`, `calmOn`, `resize`, `setQualityLow`
  during a merge: result adopted, primary has a view, visible, no throw. (`h.resultBody` still returns the body object after the caller removed its view: expected.)
- VERDICT 4 (createBody throws): merge, throw on 2nd parent and on the result: scene children 10 -> 10, views 1, ceremony false (was: hidden play body + orphan parents).
  Capsule: children +1 = the capsule itself (still standing, `ceremony:false`), no pillar/dome leak (was +2 and "opening" for good). Recovery run: see `recover.mjs` below.
- VERDICT 13 (dispose warnings after context restore): FIXED in `context_loss_mid`: lose -> resize -> skip -> restore, `console: []` (was ~30 INVALID_OPERATION warnings),
  `lostAfterRestore false`, 96.7% of pixels non-background after restore, mem 14 geo / 3 tex / 19 prog.
- Known: skip vs natural end `diffVsNatural` (mean |dRGB| of a 48x36 fingerprint, /255): capsule common 0.162, epic 0.233, mythic 0.222 (0.409 at end-50ms), merge common 0.464,
  legendary 0.436, mythic 0.373 (0.653 at end-50ms): STILL not bit-identical (old 0.13 to 0.79), invisible. Skip at 0 / 50 ms / burst+40 ms gives the SAME final frame per ceremony, result hidden on 0 frames, `done` always true.
- Known: stale capsule handle: `staleRevealCapsuleVisible true` (the reveal takes a fresh standing capsule, no crash): unchanged (as the old verdict, not a fault).
- overlap (6 combinations, merge/capsule over merge/capsule at 0.2 .. 2.9 s): `done` of both handles resolves, 1 body, no capsule left, scene children 10, memory 13 geo / 3 tex / 14 prog after.
- dispose mid-ceremony (merge 0.5 s and 2.85 s, capsule 1.7 s and 0.05 s): `memAfterDispose` geometries 0, programs 0, textures 1; calls on the disposed stage are inert (no throw).
  The 1 texture is the same for ANY rendered stage (see `dispose_baseline_textures`: a body + 20 frames, no ceremony: before [7 geo, 2 tex, 8 prog], after dispose [0, 1, 0]); it does not grow (20-round runs below).
- determinism: `maxPixelDiff 0` over 11 fingerprints, equal soft-body state hash (2027416708) in two runs of a Mythic merge.
- 20 mixed ceremonies (`twenty`, 30 fps, med): geometries 9..15 cycling by tier, textures 3 then 4 from the first skip (the crossfade snapshot) and flat, programs 16..19 cycling,
  scene children 10 throughout (old: 9, +1 is the cut-fx group), particles 0 at the end except two merges that ended with 16 and 7 live motes (see item 5 below), JS heap 16.04 -> 16.23 MB
  after 20 ceremonies (old 14.53 -> 14.70): flat, +0.19 MB.
- BodyProxy forwards every `SoftMetrics` field (VERDICT note): `bodyproxy_forwards_every_metric`: a sticky body pressed and lifted, 60 frames, keys
  `compression, compressionRate, stretch, volume, kinetic, grounded, fingers, grabbed, press, reaction, strands, slosh, pull, carried`: 0 mismatches between body.metrics and proxy.metrics
  (strands was non-zero during the lift): FIXED.
- Misuse of the new stage members (`misuse.mjs`, 11 cases): `setCutSeam` with 21 garbage argument sets, `setBridge` (self-bridge, unknown ids, NaN, 500 calls in one frame -> 1 bridge),
  `partPieces`, `matLayout(0, -1, 6, 1e9, NaN, '3', ...)` (always 1..5 finite offsets), quality / calm toggles mid cut visuals: no throw, no console message, renderer healthy afterwards.
  Two cases flagged, investigated below: degenerate `resize`, and the capsule spot on a 320x200 frame.

### 3a. Every ceremony, normal and Calm: `flash.mjs 480 300 med 60` (1194 s, 28 scenarios, console problems 0), my own luminance code
Columns: win04 = worst 1 s window of global mean linear luminance swings >= 0.04 (gate <= 3, aim 2); wcag = same at the 0.1 relative swing; cellWCAG = worst 3x3 cell at 0.1; light = peak screen-light alpha (cap 0.25); dur err = actual vs DESIGN 6.1 budget.
- Normal capsule Common..Mythic: win04 2 / 2 / 2 / 1 / 2 / 2, wcag 0 / 0 / 0 / 0 / 1 / 1, cellWCAG 2 / 2 / 2 / 4 / 2 / 4, light 0.098 / 0.118 / 0.148 / 0.167 / 0.177 / 0.187, mean luminance peak 0.109 / 0.105 / 0.123 / 0.128 / 0.185 / 0.225 (base 0.033), dur err 1.0 / 0.8 / 0.6 / 0.5 / 0.4 / 0.4 %.
- Normal merge Common..Mythic: win04 2 / 2 / 2 / 2 / 2 / 1, wcag 2 / 0 / 0 / 1 / 2 / 2, cellWCAG 2 / 2 / 2 / 4 / 2 / 2, light same ladder, luminance peak 0.175 / 0.130 / 0.150 / 0.175 / 0.236 / 0.296 (base 0.055), dur err 0.8 .. 0.3 %.
- Tier-up Mythic merge: win04 1, peak 0.295, 5.617 s (budget 5.6); 3-parent Epic merge: win04 2; quick-pop Common: win04 2, 0.800 s.
- Calm capsule Common..Mythic: win04 0 / 0 / 0 / 0 / 1 / 1, light 0.000 everywhere (no screen flash), peaks 0.068 .. 0.167; Calm merge: win04 2 / 2 / 0 / 1 / 1 / 1, light 0.000, peaks 0.109 .. 0.174; calm quick pop 0 / 0.
- Worst over all 28: win04 = 2 (old verdict 2 normal, calm up to 2; gate 3), screen light max 0.187 (old 0.226; cap 0.25).
- VERDICT 10 (calm busier at the frame centre, old: calm 4 vs normal 2..3 in a cell): cellWCAG calm is <= 3 everywhere (capsule 2/2/2/2/3/3, merge 3/3/3/2/2/2) and equals or is one above normal
  for Legendary capsule (3 vs 2) and Common..Rare merges (3 vs 2); the other calm cells are below normal. IMPROVED, not eliminated (cells are not gated in normal mode: capsule Epic and Mythic and merge Epic read 4 in a cell in NORMAL mode, as the engineer's own report says).
- Brightness (known item): the Mythic merge burst takes the mean luminance from 0.055 to 0.296 (capsule 0.033 -> 0.225; old capsule 0.256): still bright by design and inside the gate (2 transitions, light <= 0.187).

### 3c. 10 rapid cuts + Reconnect all, other families and sizes (same driver; win04 = global worst 1 s window at 0.04, WCAG = global at 0.1, "cell" = worst 3x3 cell, WCAG 0.1 swing)
| family (species) | size / quality | mode | global win04 | global WCAG | worst cell win04 | worst cell WCAG (cell) | max 1-frame jump | screen light | pieces max |
|---|---|---|---|---|---|---|---|---|---|
| stickystretch (twangle) | 480x300 med | normal | 2 | 0 | 5 | 3 (4) | 0.0357 | 0 | 6 |
| stickystretch | 480x300 med | calm | 1 | 0 | 3 | - | 0.0214 | 0 | 6 |
| mochidough (crimpo) | 480x300 med | normal | 2 | 0 | 8 | 4 (4) | 0.0558 | 0 | 6 |
| marshmallow (wisplet) | 480x300 med | normal | 2 | 0 | 6 | 3 (3) | 0.0369 | 0 | 6 |
| beadsqueeze (crumbit) | 480x300 med | normal | 2 | 0 | 6 | 4 (4) | 0.0620 | 0 | 6 |
| slimegoo (wrigglo) | 390x844 low | normal | 0 | 0 | 2 | 2 (4) | 0.0134 | 0 | 4 |
| slimegoo | 390x844 low | calm | 0 | 0 | 2 | 1 (4) | 0.0203 | 0 | 4 |
| putty (kneadle) | 390x844 low | normal | 0 | 0 | 4 | 1 (4) | 0.0155 | 0 | 4 |
| putty | 390x844 low | calm | 0 | 0 | 4 | 1 (4) | 0.0215 | 0 | 4 |
Global gate (<= 3 transitions in any 1 s, aim 2): met in every run (max 2), screen light 0 in every pure-cut run, no console problem. The cell column is above 3 (the old verdict's
local-cell yardstick, a MINOR there) in normal mode for mochidough and beadsqueeze at WCAG 0.1 and for several families at 0.04: see R-A1.

### 3b. The swap frame of a cut (`swapjump.mjs`): one-frame jump of the global mean luminance, WITH the cut visuals / CONTROL without them
First cut of a whole squishy at 60 fps (neck, hold, swap to two pieces), every material family (first catalog species of each), global mean linear luminance,
the biggest frame-to-frame jump anywhere in the run (always at the swap frame, +/- 1 frame). The gate's transition threshold is a 0.04 swing.

Desktop 480x300 med (marshmallow..putty from `swapjump_desk.log`, the first five from the interrupted first run):
jellygel 0.0309 / 0.0253, stickystretch 0.0329 / 0.0186, waterfill 0.0307 / 0.0222, beadsqueeze 0.0553 / 0.0456, gummy 0.0097 / 0.0181, marshmallow 0.0465 / 0.0435,
mochidough 0.0417 / 0.0144, firmsilicone 0.0130 / 0.0117, popdome 0.0507 / 0.0477, slimegoo 0.0172 / 0.0139, slowrise 0.0108 / 0.0049, putty 0.0455 / 0.0417.
Phone 390x844 low (`swapjump_phone.log`): jellygel 0.0094 / 0.0149, stickystretch 0.0123 / 0.0115, waterfill 0.0176 / 0.0157, beadsqueeze 0.0179 / 0.0248, gummy 0.0160 / 0.0085,
marshmallow 0.0245 / 0.0286, mochidough 0.0141 / 0.0360, firmsilicone 0.0144 / 0.0161, popdome 0.0169 / 0.0201, slimegoo 0.0136 / 0.0168, slowrise 0.0109 / 0.0099, putty 0.0088 / 0.0137.
- The biggest part of the step is NOT the cut visuals: the CONTROL (setCutSeam / partPieces / setBridge are no-ops, same bodies) already jumps by 0.0417 .. 0.0477 on desktop for
  beadsqueeze, marshmallow, popdome, putty in the swap frame (e.g. popdome mean 0.0692 -> 0.1199, and it stays high: a step, not a flash). Replacing the necked body by two new views makes the
  frame brighter in one frame; that comes from `removeBody` + `addBody` x2 (the shell does `swapTo` + `addExtra`, the same two new views).
- The cut visuals alone add up to +0.027 (mochidough desktop: 0.1311 -> 0.1729 -> 0.1849 -> 0.1526 -> 0.1555: a 3-frame bump of +0.054 that falls back, control 0.0144), otherwise <= +0.014.
  That is the one place the cut visuals themselves make a frame-to-frame jump above the 0.04 swing (0.0417).
- Several families exceed a 0.04 one-frame step at the swap on desktop (4 in the control, 5 with the visuals: beadsqueeze 0.0553, popdome 0.0507, marshmallow 0.0465, putty 0.0455,
  mochidough 0.0417). Each is ONE up-step, followed by a slow decay (not an opposite transition): the 10-rapid-cuts runs above count 2 and 1 transitions (sticky). I list the
  swap step as MINOR R-A1 and the mochidough bump as part of it; the family-wide rapid-cut gate numbers are in section 3c.

### 5a. Cut leaks, dispose, context loss, determinism (`cutleak.mjs`, sticky stretch, 320x240 med, console problems 0)
- 20 rounds of "cut into 6 pieces, wait, Reconnect all (1.2 s), settle" with the real SoftBody and the stage API (random planes, `refused` counts = cuts the 1/8 rule or the plane refused):
  at 6 pieces geometries 30 .. 32, textures 3, programs 14, scene children 15, bodies 6; after Reconnect all geometries 15 (rounds 0 to 13) then 17 (rounds 14 to 19: the tube pool of the cut
  fx grew by 2, it is capped at 16 tubes by design), textures 3, programs 14, scene children 10, bodies 1, `frac` 1 (equals the original), `cut` live strands 0 / bridges 0 / glow 0 every round.
  JS heap after forced GC: 13.53 MB (round 0), 14.27 (round 9), 14.42 (rounds 16 to 19): +0.9 MB over the first 16 rounds, flat for the last four.
- Dispose with a neck in progress, with parting strands up (3), and with a bridge up (strands 3, bridges 1, glow 0.335): no throw, geometries 0, programs 0, textures 2 after dispose
  (1 more than the 1 a plain rendered stage leaves, see 2a); `update / render / setCutSeam / setBridge / partPieces / dispose` on the disposed stage are inert (no throw).
- Context loss with 2 pieces and a bridge up, resize while lost, restore: `restore true`, `lostAfter false`, 94.8% non-background pixels after, bridge finished, 0 console messages.
- Determinism of a cut + Reconnect all (4 pieces, 128 frames at 240x160 low, same script twice): per-frame luminance series and the final 24x16 fingerprint hash identical (4119527044 = 4119527044),
  soft-body state hash identical (2442751105).

### 2c. VERDICT 2 (non-opaque pixels in the alpha:true canvas), 1280x800 med: FIXED
- `alpha_probe.mjs` (20 s): pixels with alpha < 1 -> idle + waiting capsule 0 (old ~18,000), idle no capsule 0, calm Common burst + 9 frames 0 (old 51,000; 17,700 at alpha 0),
  and 0 after hiding each object group in turn. Views listed, console `[]`.
- `rawpx.mjs` (16 s): raw framebuffer under a waiting capsule and at calm burst+9: `alpha0: 0`, `rgbGreaterThanAlpha: 0` (old: 17.7k alpha-0 pixels with colour above alpha); sample pixels alpha 255.
- `black2.mjs` (128 s): black (<= 3) pixels in `toDataURL` captures of the calm Common and Rare reveals, frames burst-2 .. burst+12, sparse and every-frame rendering: 0 in all 30 captures (old: black holes).

### 2b. Follow-ups from misuse.mjs (`edge2.mjs`, 158 s)
(a) Degenerate `resize` (fresh 320x200 med stage, resize, 2 frames, then back to 320x200):
- `resize(0,0)`, `(1,1)`, `(320,0)`, `(0,200)`, `(-5,200)`: no throw, but WebGL logs 18 x `GL_INVALID_FRAMEBUFFER_OPERATION: glClear/glDrawElements: Framebuffer is incomplete:
  Attachment has zero size` (a 1 px dimension makes an offscreen target zero sized; 2x2 and up are clean); the stage recovers (`lumAfter 0.0552`, same as a healthy frame).
  The shell can reach 0: `canvas.clientWidth || window.innerWidth` (boot.ts:133) is 0 for a hidden iframe. -> MINOR R-A3.
- `resize(NaN,100)` and `resize(100,NaN)`: `Math.max(1, Math.floor(NaN))` is NaN, the drawing buffer becomes 0 px, 18 GL warnings, `info.camScale` becomes NaN and stays NaN after a valid
  `resize(320,200)` (`lumAfter 0.0069` = a black frame): the stage is poisoned until it is rebuilt. Every other new/old input is finite-guarded (zoom, orbit, shake, dpr, dt, time).
  The shell never passes NaN (clientWidth is finite); -> MINOR R-A3 (same finding).
- `resize(4000,4000,4)` -> a 6000x6000 drawing buffer (pixel ratio is capped by the quality tier only at `setQuality`, not here): no error on this PC, 0 warnings. NOTE.
(b) Capsule spot (numbers only; the look is lens B), `dropCapsule` -> landed -> `screenPoint()` vs the canvas and the insets (default `{bottom:72}`, and "shell-like" `{top: 9% H, bottom: min(130, 20% H)}`;
the real shell sends `{top: topBar.bottom, bottom: window.innerHeight - bottomRow.top}` from hudBinding.ts:121), 1 / 2 / 6 bodies on `matLayout`, no disc overlap with any body (centre + 0.8 R discs):
- ok (inside the canvas, inside the safe band, no body overlap) in 35 of the 36 combinations of the six listed sizes (1280x800, 1920x1080, 390x844, 844x390, 568x320, 320x256) x {1,2,6 bodies} x {default, shell-like}; the one failure is next.
- 320x256, 1 body, shell-like insets `{top:23,bottom:51}`: capsule centre (284,142), r 44 -> right edge 328 > 320: 8 px OFF THE RIGHT EDGE (the same frame with default insets: r 39 at x 269, inside). -> MINOR R-A4.
- 320x200 (below the smallest listed size), 1 and 2 bodies, default insets: r 20 at (238,110) is 2 px under the 72 px bottom inset (130 > 128). NOTE.
(c) `addBody(..., {position: {x: 1e12}})` (finite, absurd): `camScale` 1.03 -> 3.3e11 while it is there, 13.5 after `removeBody` + 6 s (eases back, no poison). NaN positions are sanitised. NOTE (no clamp on AddBodyOpts.position).

### 9. What `RENDER_R.md` did not test (read only after my own first pass; my first pass had produced items 1 to 3, 5, 2a to 2c above before I opened it)
- Cut visuals: the engineer's X09 runs were 5 cuts + Reconnect all on sticky / gel / putty / slime at desktop (and 10 cuts only with the stub body), global metric only. Not measured by it:
  10 rapid cuts with the real body in 5 more families (mochi, marshmallow, beads), the phone size and the `low` tier (4-piece limit), the per-cell metric of cuts, the swap frame
  against a no-visuals control, the 3-second windows around a cut next to a ceremony, Calm cut + Reconnect (sticky only here), leak rounds of cut/reconnect, determinism of a cut run.
- Stage robustness for the new members (garbage / NaN / extreme arguments to `setCutSeam`, `setBridge`, `partPieces`, `setSafeInsets`, `matLayout`, `addBody`, `resize`): not in its report. Findings R-A3, R-A4 and the notes come from there.
- It names sections not re-run after its last two edits (main, phone, sky, lifecycle, film, gallery, glow, strands, mat, capspot, cut, perf); I ran the whole harness on the snapshot (section 7).
- It records that the 3x3 cell metric is not gated in normal mode; the swap-frame step of a cut (R-A1) is not mentioned anywhere in it.

---
## SESSION 3 (continuation after the usage-limit cut-off; a fresh agent of the same lens)

### Setup re-check
- Live tree hash (treehash.mjs) = `5171e13798e3e03e`, 250 files: identical to the hash the cut-off verifier snapshotted. `git log`: HEAD is now `58fb66ec` (the two uncommitted edits to
  `src/render/ceremony.ts` and `stage.ts` that the snapshot carried were committed as 58fb66ec; `git diff HEAD -- games/wobblehoard/src` is empty). A file-by-file compare of live vs
  snapshot (CRLF-insensitive) differs in `_harness/browser_render.mjs` (port 5364 -> 5370) and `vite.config.ts` (private `cacheDir`) only (the snapshot-only harness edits; report files are not copied): `src/` is byte-identical.
  So the snapshot `C:\Users\TestRun\AppData\Local\Temp\vra` covers HEAD 58fb66ec. snapshotHash = `5171e13798e3e03e` (treehash of the live tree).
- tsc on the snapshot again: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` -> no output, exit 0.
- Found and killed the cut-off verifier's strays on MY port 5370: `particles_end.mjs` (node 72932 + vite 78040 + wrapper bash) had finished its work (its log is complete, "console problems: 0") but hung at
  close for ~55 min and held port 5370; plus four `batch*.sh` waiter shells (which would have launched heavy jobs by themselves) and a `tail -f`. Killed with taskkill /T /F (their command lines named my
  scratch and the vra snapshot). Other agents' processes (vrb = verifier B) were left alone.
- Work ordering now (one heavy job at a time, port 5370): alloc (item 6), bundle (item 4), recover, advfuzz x2, then looks, then the full harness (item 7) last.
- Incident, reported plainly: chaining my batch scripts through wait-for-`.done`-file loops went wrong once. Several of the batch files had been written with CRLF line endings, so their `bash` runs failed at once without a log, wrote their `.done` files, and the cascade started TWO copies of the full harness
  within a minute (one heavy job rule broken for about 1.5 minutes, same port, one shared vite). I killed both harness trees and all waiter shells with `taskkill /T /F`, discarded that harness log, and re-ran everything from a single LF script (`batch9.sh`, strictly sequential). Every result in this report comes from the clean sequential runs; the aborted runs produced nothing that is quoted.

### S3-1. Bundle (lens A item 4; VERDICT minor 11 and the known `__shot` note): FIXED
`bundle.mjs` (run from the snapshot, log `logs\bundle.log`): `vite build` production (115 modules, 8 files, **1137 KB of the 1229 KB budget**, built in about 1 s) and a positive control built with
`--mode development` (119 modules, 1149 KB), then a grep of every file of both outputs for dev-only names. Production / dev-control counts:
- must be absent: `createStageDev` 0 / 0, `StubBody` 0 / 0, `stubBody` 0 / 0, `renderview` 0 / 0, `__RV__` 0 / 0, `lifecycle3` 0 / 0 -> **none ships from src/render**.
- the stage's dev members (stage.ts is now `if (import.meta.env.DEV) Object.defineProperties(...)`): `particlesDropped` 0 / **1**, `fineVertices` 0 / **1**, `contextLost` 0 / **1**, `eyeLook` 0 / **1**, `screenLight` 0 / **1**,
  `restoreContext:` 0 / **1**, `loseContext:` 0 / **1** (the dev-control column proves the grep sees them: 0 in production means they are really gone; old verdict: they shipped).
- the other dev hooks: `__shot` 0 / 1, `__WH__` 0 / 3, `debugHook` 0 / 1: the shell's dev hook no longer ships either (old verdict: `__shot` shipped in the index chunk).
- what still matches in production and is NOT a render dev member: `WEBGL_lose_context` x3 / `.loseContext()` x2 / `.restoreContext()` x1 = the shell's `src/ui/errorCard.ts:36` throwaway-canvas probe (index chunk) and three.js's own
  `forceContextLoss/forceContextRestore` (stage chunk); `drawingBuffer` x4 is three.js's. The public cut API (`setCutSeam` 4, `setBridge` 5, `partPieces` 2, `setSafeInsets` 3) ships by design.
- budget: 1137 of 1229 KB (the old verdict's build was 866 KB: the shell, cut and toy-tray lanes grew it; 92 KB headroom). NOTE for the orchestrator.

### S3-2. Robustness recovery after a throwing createBody (VERDICT minor 4, deeper): FIXED
`recover.mjs` (log `logs\recover.log`, 140 s, console `[]`): 6 cases (Legendary / Mythic / Epic capsule with `createBody` throwing on call 1; Mythic merge throwing on parent 2, and on call 3; Legendary merge), each followed by a
normal ceremony of the same kind. After the throw: `ceremony false`, primary body visible, views 1; capsule cases leave the capsule itself standing (scene children 11 = 10 + the capsule, no pillar / dome leak; old +2 and "opening" forever);
merge cases scene children 10 (old: hidden play body + orphan parents). Recovery run: result body adopted, `primaryIsResult true`, scene children back to 10, `ceremony false` in all 6 ("not recovered / leaking: 0"). Memory after:
14..17 geometries, 3 textures, 19..21 programs, flat for the same ceremony kind.

### S3-3. Particles at the end of a ceremony (VERDICT minor 5): FIXED for a natural end, a skip still clears at once (hidden by the crossfade)
`particles_end.mjs` (log `logs\particles_end.log`, per-frame counts across the end, 60 fps, all 12 capsule / merge tiers + tier-up + 3 parents + quick pop) and `particles_tail.mjs` (log `logs\particles_tail.log`, 429 s, every 0.1 s for 3 s afterwards):
- NATURAL end: the motes live out their own short lives. Tier-up merge (Epic and Mythic): 16 sparkles on the last frame, 16 on each of the next 12 frames, 16, 16, then 0 at 0.3 s (old: 16 -> 0 in one frame). Quick Common pop: 12 on the last frame, 10 after
  7 frames, 0 at 0.5 s. Common capsule 5 -> 0 over 8 frames; Common merge 5 -> 1 over 12 frames; Uncommon merge 6 -> 0; Mythic merge 2 -> 0. Nothing lingers: every case reaches 0 within 0.5 s, so there is no stuck-mote leak (the "16 and 7 live motes" noted
  at the end of the 20-ceremony run were this tail, sampled one frame after the end).
- SKIP at 70% of the budget: particles are 0 on the first frame after the skip (`ceremony.ts:526/830`: `if (skipped) host.particles.clear()`), i.e. the old one-frame drop is still there for a SKIP, under the 120 ms crossfade snapshot. Not a defect (a skip jumps to the final state by design).
- console problems 0 in both runs.

### S3-4. Per-frame allocation (lens A item 6): the new paths are small; the old jelly path is the big one (NEW FINDING R-A5)
First attempt `alloc.mjs` (logs `alloc.log`, `alloc2.log`) was cold (one round, JIT still warming) and mixed one-time constructors in; superseded by `alloc3.mjs` (log `logs\alloc3.log`, 396 s, console `[]`): CDP `HeapProfiler.startSampling` (64 B interval, minor and major
collected objects included), attributed to the allocating `src/` function; 2 warm-up rounds, then 3 measured rounds of each path, 320x240 `low`, 30 fps; per-body-creation constructors listed separately (`ctor-like`).
Bytes allocated per frame by `src/render/` (3 measured rounds each settle: the numbers below are round 3, rounds 1 and 2 are within 1%):
| path (frames per round) | render/ total | of which `jelly.update` + `relaxNormals` + `stage.render` | everything else |
|---|---|---|---|
| IDLE: one static whole body, update + render only (138) | 222,841 | 220,952 | 1.9 KB (face.update 656, stage.update 344, framingFor 299, primary 138, bodyproxy.sync 122, updateCamera 104, core.update 83, bodyview.update 66) |
| seam only: `setCutSeam` 0..1 on that body (138) | 225,574 | 223,523 | +2.7 KB vs idle; seam-specific: `bodyview.setSeam` 46, `get seamAmount` 26, `stage.setCutSeam` 29 B/frame |
| cut x3 + Reconnect all, real SoftBody, cut visuals ON (142) | 506,400 | 437,409 (+ 60,075 one-time constructors: new bodies per cut) | `cutfx.update` 587, `strands.build` 273, stage.update 886, framingFor 483 |
| same, cut visuals OFF (control, setCutSeam / setBridge / partPieces no-ops) | 501,833 | 435,253 (+ 59,524) | no cutfx / strands entries |
| tack strands (press, hold, lift on a sticky body) (64) | 226,891 | 222,227 | `bodyview.update` 1,748 (strand spots), face.update 995, `strands.build` 48, `strands.update` 28 |
| ceremonies x4 (merge mythic, capsule legendary, quick common, merge epic) (415) | 416,195 | 357,230 (+ 45,820 one-time) | `rarity.update` 2,301, `ceremony.tick` 1,253, face.update 976, stage.update 932, `burstParticles` 761, `particles.emit` 311, `tickResult` 255, `ceremony.step` 213, `capsule.update` 220 |
- The cut visuals cost +4.6 KB/frame over the control (506,400 vs 501,833), of which `cutfx.update` 0.59 KB and `strands.build` 0.27 KB; the seam call 0.1 KB. The ceremony code (`ceremony.ts` tick + step + tickResult + burstParticles) is about 2.5 KB/frame averaged over those frames
  (the engineer's report says 1.0 to 1.6 KB/frame; same order, mine includes the burst frames and all four ceremonies). VERDICT minor 12's two named sites are gone from the lists (`MergeRun.dirOf` is replaced by precomputed `dirX / dirZ` arrays, `ceremony.ts:547..553`; the tell array is no longer
  allocated): **FIXED for the two sites**. No path is allocation-free, and the engineer did not claim it.
- **R-A5 (MINOR, new, pre-existing code, not a regression; not part of the new cut / ceremony code but it multiplies with the cut)**: 99% of all render allocation is `JellyView.update` -> `relaxNormals` (`src/render/jelly.ts:172` and `:174`, `Math.hypot(a, b, c)` called twice per vertex per pass, two passes per frame per body). Node micro-benchmark, optimised code,
  no GC between (`scripts\hypot_micro.mjs`, `hypot_micro2.mjs`, run from the snapshot): `simNormals` 7 B/call, `evalSurface` 5.5 B/call, **`relaxNormals` x2 passes 266,508 B per frame per body** at the 642-vertex whole body; the same function with `Math.sqrt` (verifier-local copy, repo untouched)
  **7.6 B** and a result with max |difference| 0. Cost: about 0.26 MB per body per frame = 16 MB/s per body at 60 fps; 6 pieces 1.6 MB per frame (about 96 MB/s), so V8 scavenges the young generation every ~0.2 s while a 6-piece cut is on screen. Not a visible defect on this PC (the frame cost
  numbers are the engineer's); a GC-jank risk on weak phones, and the file's own comment above `simNormals` says "Allocation free" while its sibling is not. Repro: `node --expose-gc --min-semi-space-size=256 --max-semi-space-size=512 scripts\hypot_micro.mjs` from the snapshot root; fix: `Math.hypot(...)` -> `Math.sqrt(x*x+y*y+z*z)` at those two lines.

### S3-5. Random chains of ceremonies (lens A item 3 and VERDICT major 1, my own fuzz `advfuzz.mjs`, 320x240 low, 30 fps, global mean linear luminance, swing >= 0.04, worst rolling 1 s; gate <= 3)
Chains of 2 to 4 ceremonies (70% capsule, any tier, 60% quick on Common / Uncommon capsules, 50% skipped at a random 0.05 to 2.55 s, next one launched 0.15 s to 3.2 s after the previous START: so they OVERLAP when the previous one is still running).
- Normal mode, seed 1, 30 chains (`logs\advfuzz1.log`, 528 s): worst win04 per chain 1..4; 29 chains <= 3 (distribution of the worst window: 1 transition x1 chain, 2 x18, 3 x10, 4 x1), **1 chain over: chain 29 = 4** (`capsule:rare@0 skipped at 2.19 s > capsule:uncommon:q@1.04 (overlapping) > capsule:common@2.3`). Peak screen light across chains <= 0.176 (cap 0.25). Console problems 0.
- Calm mode, seed 2, 20 chains (`logs\advfuzz2.log`, 345 s): worst 1..4; **2 chains over: 17 and 18 (both 4)**, both four ceremonies started within 2 s and all overlapping (`rare@0 s1.66 > epic@0.22 > legendary@0.91 > rare@1.4 s1.36` and `uncommon:q@0 > rare@0.2 > legendary@1.51 s2.23 > common:q@1.97`). Screen light 0.000 in every calm chain. Console problems 0.
- These chains are beyond what the shell can produce: `src/shell/ceremonies.ts` runs ONE ceremony at a time (`active`), starts the next only >= BURST_SPACING_MS = 1000 ms after the previous 'burst' beat, and honours a skip only from SKIP_GATE_MS = 350 ms. Chain 29 and calm 17 / 18 all overlap ceremonies (a second one started while the first still ran) and calm 17 skips at 1.36 s a ceremony started 1.4 s earlier.
  So they are a stage-API stress, not a player path. Drill-down and a shell-RULES fuzz (one at a time, 1 s after a burst, skip from 0.35 s) follow in the next sections.

### S3-6. VERDICT minor 9 (a capsule waiting on the table, parents pass through it): FIXED
`capsule_park.mjs` (log `logs\capsule_park.log`, 59 s, console `[]`): drop a capsule, land, play a 2-parent merge (Common and Epic) at 480x300. During the merge two scene objects (children 9 and 10 of the scene; I did not name them, one is the capsule's group per `parkCapsule` in stage.ts) are hidden at every 20-frame sample
(`st.info.capsule` stays true: it is parked, not discarded); after the merge (90 frames) the visibility mask equals the one before and `cap.screenPoint()` is identical (x 396.65, y 160.48, r 48.7 Common; 395.4 / 162.0 / 47.2 Epic). Picture `scripts\out\look\extra_1280x800_med\x_at02.png`:
two parents side by side on a clear pad, no capsule (old: parents passed through a standing capsule).

### S3-7. Camera framing through a merge, and setBody with mat bodies (known item "Common merge zoom"; the owner's "camera jump on setBody"): FIXED / CHANGED
`zoom.mjs` (log `logs\zoom.log`, 34 s, console `[]`), `info.camScale` per frame (rest 1.0259 for every size):
- Desktop 1280x800 and 320x240: Common merge min 0.9959 / max 1.0065 = **-1.9%** (old verdict: +12% widening for a Common); Uncommon +7.2%, Rare +13.0%, Mythic +40.3% (tier ladder as designed); largest per-frame step 0.0013 (Common) .. 0.0391 (Mythic).
- Phone 390x844: Common +40.0%, Uncommon +47.1%, Rare +49.4%, Mythic +56.7% over rest (the narrow aspect needs a wide pad for two parents: the old verdict also saw the parents clipped at the phone's edges); largest per-frame step 0.055 .. 0.070. `ceremony.ts:625` sets the framing with `snap = true` ("a cut: the merge starts a new scene, every play body hides"), so
  the first-frame jump is intentional.
- `setBody` swapping the play body with 2 mat bodies out: before 1.0508, after the swap min 1.0497 / max 1.0601, largest per-frame step **0.0012** desktop (engineer: 0.0066); phone before 1.5741, min 1.5427, max 1.5851, step **0.0314** (engineer's number 0.0128 for the same case). The phone step is 2.5 x the engineer's number and about 2% of the scale in the worst frame (old: a 0.55 jump); I did not look at a film of it. NOTE.

### S3-8. Pictures (my own captures; art judgement is lens B's job, I only repeat the old verdict's repro frames) at 1280x800 med, `look.mjs` (logs `look_extra`, `look_capsule`, `look_merge`, console `[]`)
- VERDICT minor 6 (Epic play body sliding off: laser lines): CHANGED. `extra_1280x800_med\slide_epic_play_b.png`: the Epic body's orbiting motes are now sparkles on the body; three short pale-red streaks trail it (each about 60 to 150 px long, 2 to 4 px thick), no
  line crosses the frame (old: long laser lines across the frame). Judge: acceptable; they read as speed streaks. `rarity.ts:326..336` caps the follower lag.
- VERDICT minor 7 (capsule halves as wire hoops / a mouth): FIXED in the drop frames of all six tiers (`crops\capsule_drop_sheet.png`: no hoop, no U under the eyes). Small thin arcs remain around the body at the Epic, Legendary and Mythic burst peaks (`crops\capsule_burstpeak_sheet.png`): the flying shell halves, 20 to 30 px, gone by the drop frame. NOTE.
- VERDICT minor 8 (merge T2 tell): FIXED to the eye. `crops\merge_chargeend_sheet.png`: Common white / Uncommon pale cyan / Rare violet / Epic coral with violet pool / Legendary gold with a pillar / Mythic pearl in a prism dome: six different reads (old: Uncommon cream, Epic pink).
- VERDICT minor 5 (tier-up sparkles cut): the last frame and the frame after (`x_tierUpLast.png`, `x_tierUpAfter.png`) look the same, sparkles all there.
- **R-A6 (MINOR art, NEW): a hard straight edge across the shock ring** in `x_tierUpLast.png` and `x_tierUpAfter.png` (Epic tier-up merge, last frame): the bright pink ring at the left of the body is cut by a horizontal line at y = 557, x = 322..365: pixel (340, 556) = (255,117,146), (340, 558) = (224, 50, 92).
  Crop `crops\tierup_edge.png`. Bisect (`edge_probe.mjs`, log `logs\edge_probe.log`, 20 s, console `[]`; it replays the same preamble and the same frame, 125 of 126, then hides the 13 visible scene meshes one at a time and re-renders): the vertical step at x 330..350,
  y 540..575 is 54.7 with everything on, **1.6 with only the mesh `renderOrder -39`, a PlaneGeometry in a Group, hidden** (= `Decals.pool` in `src/render/decals.ts:108`, the additive light pool that also draws the Epic+ caustic ring `uRing2`); hiding any of the other 12 meshes (the table, the
  shadow decal at -40, the bodies, the fx instances, ...) leaves it at 54.6..54.7. So the pool decal produces the straight line; my reading (not tested by changing the quad) is that the Epic+ caustic ring still has light at the pool quad's border, the quad being `rx * pS + 0.1` wide. Not a flash; a visible hard line in an Epic+ ring at 1280x800.
  Repro: `node scripts\look.mjs extra 1280 800 med` then open `x_tierUpLast.png` at (340, 557), or `node scripts\edge_probe.mjs 1280 800 med`. Severity MINOR (art; the old verdict's "hard straight quad edge under the waiting capsule" was the alpha-halo bug, fixed; this is the pool's own edge).

### S3-9. Drill-down of fuzz chain 29 (`chain_drill.mjs 1 29`, log `logs\chain29.log`, 63 s, console `[]`; 320x240 low, 30 fps)
Chain: Rare capsule at 0 (skip at 2.19) > quick Uncommon capsule at 1.04 > Common capsule at 2.3. Per-frame luminance and events:
- as is: win04 **4** (transitions at 0.93, 1.20, 2.40, 2.57, 2.93, 3.30: the worst window is 2.40 to 3.30). Max screen light 0.139. Events: ceremony 0 burst 0.93; **ceremony 0 ends at 1.07 because ceremony 1 was launched while it ran** (overlap = the running one is finished at once, like a skip); ceremony 1 burst 1.30, settle 1.87;
  ceremony 2 launched at 2.30 (exactly 1.00 s after ceremony 1's burst, which the shell's 1 s rule allows), burst 2.93. Governor: ceremony 1 got no light ramp and played a soft burst (`ramps 0, softBurst 1`), ceremony 2 got its ramp.
- variants of the same chain: no skips 4; **sequential (each started 0.25 s after the previous one's end or skip) 2**; Rare alone 2; first two 2; **last two alone (quick Uncommon, then the Common 1.26 s later) 2**.
  So the pair that a player can really produce is fine; the 4 needs the Rare capsule that was cut short by an overlapping launch (my reading of the trace: it leaves the scene brighter, mean L 0.077 against an idle 0.062, and ceremony 2's own start bump 0.077 -> 0.101 -> 0.061 at 2.40 to 2.57, its burst at 2.93 and the decay at 3.30 then make four swings of >= 0.04 inside 0.9 s; I did not isolate the cause further).
- Verdict on the fuzz: chain 29 and the two Calm chains (17, 18) all need two or more ceremonies running at the same time, which `src/shell/ceremonies.ts` never does; MINOR "stage API under overlapped ceremonies can reach 4 transitions in a second" (R-A8); the shell-rules fuzz below decides whether the real path is clean.

### S3-10. Phone pictures (390x844 low, `look.mjs` capsule and merge, logs `look_capsule_phone`, `look_merge_phone`, console `[]`; sheets `crops\phone_merge_burstpeak.png`, `crops\phone_capsule_burstpeak.png`)
- At the burst peak on the phone the Rare to Mythic pools and the grey shock rings span the whole 390 px width: the ring's two ends touch the frame sides (Epic and Legendary merge: both tips at x = 1 .. 2 and 388 .. 389 px). Mean RGB of the outermost three columns over y 330..520 against columns 40..44 (the glow reaching the edge):
  Common 45.8/29.0/63.7 vs 47.2/30.1/65.1 (clear); Rare 45.2/26.7/69.6 vs 52.7/33.7/77.0; Epic 69.5/43.6/75.3 vs 84.1/46.6/78.9; Legendary 86.5/63.4/84.0 vs 191.6/120.9/138.6; Mythic 52.9/42.4/76.7 vs 69.4/61.8/93.6 (every Epic+ edge is lit, Common and Uncommon are not).
  The old verdict's "phone halos touch the frame sides" is therefore NOT cleanly gone by my simple edge-versus-interior measure of the burst frame. What the harness checks is narrower (`_harness/browser_render.mjs:792..801`, `__RV__.haloEdge(tier)`): the tier HALOS (Rare aura, Epic ring, Legendary pillar glow, Mythic dome) with the FX on versus hidden, mean |difference| of the 6 px edge columns <= 0.75/255 (the engineer reports 0.00); the burst's light pool and shock rings are not in that check, and they are what reaches the sides in my pictures. Its result in the full run is in section S3-12. The parents are no longer clipped at the start (the 'press' frames, `crops\phone_merge_press.png`: both parents fully inside the frame for Common, Rare, Epic, Mythic; their pools reach the frame sides for Rare, Epic, Mythic). Severity MINOR (art / layout, lens B). The "x = 1 .. 2 and 388 .. 389" above are read off the sheet, not measured.
- Capsule burst peak on the phone: pools and rings the same (Rare to Mythic rings reach both sides), the flying shell fragments appear as small thin arcs at the Epic, Legendary and Mythic peaks, no hoop under the eyes.

### S3-11. Shell-RULES fuzz (`advfuzz_shell.mjs`: one ceremony at a time, the next only after the previous ended AND >= 1.000 s after its 'burst' beat, a random human gap of 0 to 1.5 s, a skip only from 0.35 s; real stage, my own luminance code)
- Normal, 320x240 low, 30 fps, seed 3, **30 chains** of 3 to 5 ceremonies (`logs\advfuzz_shell1.log`, 698 s, console `[]`): worst window (swing >= 0.04, gate <= 3, aim 2) per chain: **1 transition x1 chain, 2 x25, 3 x4, 4+ x0**; "worst win04 3, violations(>3) 0". WCAG 0.1 swing: 0 x11, 1 x9, 2 x10 chains. Peak screen light 0.176 (cap 0.25).
  The four chains at 3 (chains 6, 9, 11, 28) are inside the gate but not at the aim of 2; each skips a Legendary, Mythic or Epic ceremony (at 1.42, 1.05, 0.85 and 1.11 s) and starts the next one soon after (`merge:legendary@0 s1.42 > capsule:common:q@1.8 ...`, `merge:rare@0 > merge:mythic@3.7 s1.05 > capsule:common@6.03 ...`,
  `... capsule:epic@1.23 s0.85 > merge:legendary@2.63 ...`, `capsule:legendary@0 s1.11 > merge:legendary@1.53 ...`).
- Normal, **480x300 med, 60 fps**, seed 4, **10 chains** of 3 to 5 ceremonies (`logs\advfuzz_shell2.log`, 1002 s, console `[]`): worst per chain 2 / 2 / 2 / 2 / 2 / 2 / 2 / **3** / 2 / 2 (chain 7: `capsule:legendary@0 > capsule:rare@4.57 s0.8 > capsule:common:q@6.1 s2.31 > merge:common@7.98 s1.1`); violations(>3) 0; WCAG 0.1: 1 or 2 per chain; peak screen light 0.187 (cap 0.25).
- So, under the shell's own rules (one at a time, 1 s after a burst, skip from 0.35 s), 40 random chains (about 150 ceremonies) never broke the gate: worst window 3 in 5 chains, 2 or less in the other 35, no screen light above 0.187. The Calm shell-rules run follows.
- **Calm, shell rules**, 320x240 low, 30 fps, seed 5, **20 chains** (`logs\advfuzz_shell_calm.log`, 366 s, console `[]`): worst window 1 x5 chains, 2 x14, **3 x1** (chain 15: `capsule:uncommon:q@0 > capsule:legendary@1.33 s2.36 > capsule:legendary@4.43 s2.03`), violations(>3) 0; **screen light 0.000 in every chain** (Calm never flashes the screen).
  Together with the overlap stress above (Calm chains 17 and 18 at 4 only when four ceremonies ran at once): under the shell's rules the flash gate holds in 60 random chains (30 + 10 normal, 20 Calm), worst 3.

### S3-12. The FULL `_harness/browser_render.mjs`, once, on the snapshot (lens A item 7)
Command (from the snapshot root, my port 5370, Playwright Chromium 145 + SwiftShader, no `--only`): `node _harness/browser_render.mjs > logs\harness_full.log`. Result: **`ALL RENDER CHECKS PASSED`, `EXIT 0 after 2395 s` (39.9 minutes): 276 `ok`, 0 `FAIL`, 1 `KNOWN` (not gated), and the last check
"zero console errors / warnings / page errors / failed requests (incl. shader compile errors)" is ok.** The engineer's own full run (its report): 274 ok / 2 FAIL / 1 KNOWN, then fixed; mine has those two ok (276) and no failure. The one `KNOWN`, verbatim: `KNOWN (PHYS, not gated) CUT neck/pieces vs the frame top (putty, putty): lobes reach -69 px / pieces 14 px from the top of the 640x480 frame (negative = cut off)`:
the cut neck morph of putty (physics, named in my task as not a render fault).
Checks that bear on this lens, with the numbers the harness printed:
- bundle: `production bundle (vite build + grep)`: ok, `built true, 8 files, dev names found: [], .loseContext() x2, .restoreContext() x1, WEBGL_lose_context x3 (stage chunk x2)` (the same as my own grep, S3-1).
- flash, normal: capsule Common..Mythic worst 1 s window 2 / 2 / 2 / **1** / 2 / 2, max alpha 0.093 .. 0.176; merge Common..Mythic 2 / 2 / 2 / 2 / 2 / 2, alpha <= 0.176; tier-up Rare / Epic / Mythic 2 / 2 / 2 (3.63 s vs 3.6, 4.23 vs 4.2, 5.63 vs 5.6 s budgets); governor: 12 requests in 1 s grant 1, alpha capped at 0.25, granted flashes start >= 1 s apart.
- chains: `CHAINED ceremonies` worst 2 (mythicSkipThenQuickCommon) and the 60 fps repro of VERDICT major 1: worst 2.
- skip: all 12 `skip() ends on the same final frame`: RGB fingerprint mean |diff| 0.18 / 0.42 / 0.08 / 0.27 / 0.28 / 0.27 /255 for the capsules (bar 1.5), result hidden on 0 crossfade frames; skip transitions 0 to 2.
- Calm in cells: `Calm is no busier than normal in any 3x3 cell`: capsule rare 2 vs 4, epic 2 vs 4, legendary 3 vs 2, mythic 3 vs 4, merge mythic 2 vs 4 (bar <= 3 and <= normal + 1).
- memory: `20 cycles of addBody x3 + removeBody x3` geometries 11 x20, textures 3 x20, programs 13 x20; `3 bodies x 18 cycles with merge + capsule ceremonies (skipped): lap 3 == lap 2` (geometries 9..16 cycling by lap); `stage.dispose()` -> geometries 0, textures 2 (three's own), programs 0 (twice);
  `CeremonyHandle.done never rejects or hangs`; context loss + restore: nothing throws, 96% of pixels non-background afterwards, and 0 "does not belong to this context" warnings (old: about 30).
- cut: `CUT X09` (sticky, gel, slime_calm with the stub; sticky, gel, putty, slime_calm with the real body): worst 1 s window 0, 0, 0, 0, 0, **2** (putty), 0; screen light 0; <= 6 pieces; whole again with one view and one face; `CUT frame budget: 6 pieces cost <= 1.5 x two whole bodies  861 ms vs 608 ms (x1.41)` (the engineer's number was x1.32; bar 1.5);
  `CUT parting threads (putty): at most one wisp`; `CUT seam (slime_calm)` carried over every swap at 0.43; `CUT framing (putty)`: 6 pieces inside the 640x480 frame, smallest 86 px.
- phone and mat: `no tier halo reaches the sides` rare / epic / legendary / mythic 0.00 /255 (<= 0.75; tier halos only, see S3-10); mat framing swaps largest step per frame 0.0066 desktop, 0.0128 phone (both ok); capsule spot on 568x320, 320x256, 844x390, 1280x800, 390x844, 360x640, 412x915, 320x568 with the shell's HUD rows: beside the squishy, overlap 0 px2;
  all 50 species at 390x844: smallest capsule 0.46 of full size, mean 0.62.
- `update() allocates ~nothing per frame` is ok with "heap delta 64.5 KB (0.072 KB/frame)" over 900 frames. **That check cannot see the garbage of R-A5**: it forces a GC before and after and compares what is still alive, so short-lived allocation (the 266 KB per body per frame of `relaxNormals`) is collected and invisible to it; the check passes with R-A5 present (NOTE).

### S3-13. FINAL: every old VERDICT item against this snapshot (HEAD 58fb66ec, tree hash 5171e13798e3e03e)
| old item | now | the number |
|---|---|---|
| MAJOR 1 chained ceremonies exceed the flash budget | **FIXED** (one residual stress case, R-A8) | `adv.mjs` worst window 4 -> 2 (320x240 low 30 fps repro) and 4/4/4 -> 2/2/2 (the three 480x300 med 60 fps repros); `gov_fuzz` 2000 x 400: 0 violations, grants >= 1.0 s apart; harness chains 2; shell-rules fuzz 60 chains worst 3 (0 over); overlapped-ceremony fuzz 3 of 50 chains at 4 (1 of 30 normal, 2 of 20 Calm) |
| 2 non-opaque pixels in the alpha canvas | **FIXED** | alpha < 1 pixels 0 (old about 18,000 idle capsule, 51,000 calm burst); rawpx alpha0 0; black pixels in 30 toDataURL captures 0 |
| 3 clearBodies / removeBody(result) mid-ceremony | **FIXED** | `primaryBodyId()` null, bodies 0, `done` resolved |
| 4 createBody throws leaks / hides | **FIXED** | scene children 10 -> 10 (merge), capsule +1 = itself (old +2 and stuck opening); recovery run ok in 6 of 6 |
| 5 particles cleared on the last frame | **FIXED** (natural end) | tier-up 16 sparkles live on 14+ frames after the end and reach 0 at 0.3 s; a SKIP still clears at once under the crossfade (by design) |
| 6 Epic motes stretch to laser lines | **CHANGED** | three short streaks (60 to 150 px) on a sliding Epic body; nothing crosses the frame |
| 7 capsule halves read as hoops / a mouth | **FIXED** in all six drop frames | small thin shell arcs (20 to 30 px) remain at the Epic+ burst peaks |
| 8 merge T2 tell invisible for Uncommon / Rare / Epic | **FIXED** to the eye | six tiers read six colours at the charge end |
| 9 waiting capsule not moved during a merge | **FIXED** | parked (2 scene objects hidden) for the whole merge, back at the same screen point |
| 10 Calm busier than normal in the frame centre | **IMPROVED** | harness cell check ok: calm 2/2/3/3 (capsule rare..mythic) and 2 (merge mythic) vs normal 4/4/2/4 and 4 |
| 11 dev stage members ship | **FIXED** | production: particlesDropped, fineVertices, contextLost, eyeLook, screenLight, loseContext:, restoreContext:, `__shot`, `__WH__`, debugHook all 0 (the development-mode control build: 1 each, `__WH__` 3); createStageDev / StubBody / renderview / `__RV__` / lifecycle3 are 0 in both builds |
| 12 per-frame allocations (dirOf, tell array) | **FIXED** for the two named sites | `dirOf` gone (precomputed arrays); ceremony.ts about 2.5 KB/frame; BUT R-A5 (jelly relaxNormals 266 KB/frame/body) |
| 13 dispose warnings after a context restore | **FIXED** | 0 warnings (old about 30) |
| known: skip not identical to the natural end | **CHANGED**, still not bit-identical, invisible | fingerprint mean |diff| 0.08 .. 0.65 /255 (old 0.13 .. 0.79; bar 1.5); result hidden on 0 frames |
| known: no 350 ms skip gate | shell-owned, now present | `SKIP_GATE_MS = 350` in `src/shell/ceremonies.ts` |
| known: Common merge zoom | **FIXED** | desktop -1.9% (old +12%); phone +40% (needed for two parents on 390 px, cut not eased by design) |
| known: phone halos touch the frame sides | **CHANGED**: the tier halos are clear (0.00 /255), the burst pools and shock rings are not | R-A7 |
| known: Uncommon subtle, Epic two-tone, burst brightness | unchanged by design | luma peak capsule Mythic 0.266 in the harness's run (0.225 mine at 480x300), merge Mythic 0.345 (harness) / 0.296 (mine); 2 transitions max |
| known: stale capsule handle; harness parents | unchanged / harness only | `staleRevealCapsuleVisible true`, no crash |
| BodyProxy forwards every SoftMetrics field | **FIXED** | 0 mismatches over 14 fields |

### S3-14. Findings of this verification (none MAJOR)
| id | sev | what | repro |
|---|---|---|---|
| R-A1 | MINOR | The swap frame of a cut (body -> two pieces + parting strands + carried seam) raises the global mean luminance by up to 0.0553 (beadsqueeze; control without the visuals 0.0456) in ONE frame on desktop (5 of 12 families above the 0.04 swing; the same swap WITHOUT the cut visuals already gives 4); the cut visuals add up to +0.027 (mochidough 0.0417 vs 0.0144 control). One up-step then a slow decay, not a flash pair: rapid-cut worst window 2 (gate 3). | `node scripts\swapjump.mjs marshmallow,mochidough,popdome,putty,beadsqueeze 480x300x0` from the snapshot root (logs `swapjump_desk.log`) |
| R-A2 | MINOR | 3x3 cell metric in cut runs (not gated in normal mode): worst cell 5 (sticky) / 6 (marshmallow, beadsqueeze) / 8 (mochidough) transitions per second at 0.04, 3 to 4 at the WCAG 0.1 swing (mochidough 4, beadsqueeze 4, marshmallow 3); Calm is lower (sticky 3). The no-visuals control is about the same (mochidough 7 and 4; sticky 4), so this is mostly the bodies' own motion, not the glow. | `node scripts\cutflash.mjs 480 300 med rapid10 mochidough,beadsqueeze` (logs `cutflash_desk_more.log`, section 3c) |
| R-A3 | MINOR | `stage.resize(0 or 1 px, ..)` logs 18 GL "Framebuffer is incomplete: attachment has zero size" errors; `resize(NaN, 100)` leaves `camScale` NaN and a black stage until rebuilt. The shell can reach 0 (`boot.ts:133` `canvas.clientWidth || window.innerWidth` in a hidden iframe), never NaN. | `node scripts\edge2.mjs` (logs `edge2.log`) |
| R-A4 | MINOR | Capsule 8 px off the right edge at 320x256, 1 body, insets `{top 23, bottom 51}` (proportional insets of mine; the harness's real HUD rows top 56 / bottom 77 are inside: ok). | `node scripts\edge2.mjs` section (b) |
| R-A5 | MINOR | `relaxNormals` (jelly.ts:172, :174) `Math.hypot` boxes its arguments: 266,508 B allocated per frame per 642-vertex body (7.6 B with `Math.sqrt`, identical result); 99% of all render garbage, about 96 MB/s with 6 pieces at 60 fps. Pre-existing, not new code. The harness check "update() allocates ~nothing per frame" cannot see it (GC forced before and after). | `node --expose-gc --min-semi-space-size=256 --max-semi-space-size=512 scripts\hypot_micro.mjs` and `hypot_micro2.mjs`; `node scripts\alloc3.mjs low` (logs `alloc3.log`) |
| R-A6 | MINOR (art) | A hard straight horizontal edge cuts the Epic+ shock ring at the end of the Epic tier-up merge (1280x800): step 54.7 in G across y 556 -> 558, removed only by hiding the light-pool decal (`decals.ts:108`). | `node scripts\edge_probe.mjs 1280 800 med` (log `edge_probe.log`), picture `out\look\extra_1280x800_med\x_tierUpLast.png` (340, 557) |
| R-A7 | MINOR (art / layout) | On the phone (390x844) the Epic to Mythic burst pools and shock rings span the whole width and touch both frame sides (edge columns lit: Epic 69.5/43.6/75.3, Legendary 86.5/63.4/84.0 vs 45.8/29.0/63.7 for a Common burst); the harness only checks the tier halos (0.00). | `node scripts\look.mjs merge 390 844 low`, sheet `crops\phone_merge_burstpeak.png` |
| R-A8 | MINOR | The stage API under OVERLAPPED ceremonies (a second one launched while the first runs; the first is then finished at once) can still reach 4 transitions in 1 s: 1 of 30 normal chains and 2 of 20 Calm chains of my overlap fuzz (screen light 0 in Calm). Not reachable through the shell as written (one ceremony at a time, 1 s after a burst). | `node scripts\advfuzz.mjs 30 320 240 low 30 1 0` (chain 29), `... 20 320 240 low 30 2 1` (chains 17, 18); drill-down `node scripts\chain_drill.mjs 1 29` |
| notes | NOTE | skip vs natural end not bit-identical (0.08 .. 0.65 /255, bar 1.5); production bundle 1137 of 1229 KB (92 KB left); 6 pieces cost x1.41 of 2 whole bodies (bar 1.5, engineer x1.32); phone `setBody` swap step 0.0314 per frame (engineer 0.0128); the cut neck morph standing putty / slow-rise / firm-silicone lobes up (physics, `KNOWN` in the harness) and the weak Reconnect bridge (shell timing) are not render findings. |

### S3-15. Verdict and what I did not check
**PASS** for lens A: no MAJOR finding; tsc clean (`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`, no output, exit 0, run at the start and at the end on the snapshot); the full harness 276 ok / 0 FAIL / 1 KNOWN with zero console problems, no page or console error in any of my own runs; no regression against the old
verdict's checks (every old item FIXED, CHANGED or IMPROVED, none STILL FAILS); the cut visuals pass the flash gate with my own measurement (2 transitions in the worst second in the 10-rapid-cuts + Reconnect-all runs, 1 in Calm, screen light 0). Covers HEAD 58fb66ec, `src/` byte-identical to the live tree at the end (hash 5171e13798e3e03e).
Not checked: (1) a real GPU, real phones, real browsers other than headless Chromium on SwiftShader (shader compile, GC jank of R-A5, thermal, compositing); (2) the real shell stack: I read `src/shell/ceremonies.ts` and emulated its three rules in `advfuzz_shell.mjs`, I did not drive the real shell; (3) audio and haptics; (4) the art of the 50-species gallery, the strands per family, mat looks and the capsule placement across sizes
(lens B's job; I used only the harness numbers and my repro frames); (5) frame cost in milliseconds (only the harness's relative numbers); (6) soaks longer than 20 rounds, and memory in a production (non-DEV) build at run time (the production bundle was only grepped; leaks were measured in the DEV stage); (7) determinism across machines (two runs on this PC only); (8) luminance with a photometer: my measure is the global mean of linear luminance
of the canvas readback; (9) Epic "khaki" and the Uncommon / Epic two-tone looks.
Process: ports 5370 only; stray processes of the cut-off verifier killed (S3 setup); my incident with the doubled harness (above); scratch junctions and the snapshot's `node_modules` junction removed at the end with `cmd /c rmdir`.
