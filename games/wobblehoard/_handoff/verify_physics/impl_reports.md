## PHYSICS REPAIR, FIX ROUND: report

**Outcome:** both major findings are fixed against the targets on the verifier's own harness. MAJOR 2 still has a few rare single-frame creases (listed under known issues). The four new probe rows fail on the pre-fix physics and pass after the fix. The full probe passes 107/109; the 2 failures are the absolute timing rows, run at load 18 on 4 cores. The pre-fix physics is 6dff62e, which is identical to c5076fe. The fix is in the working tree and is already committed in your checkpoint 28 (8bb2e90).

### Root cause
Struts are not the direct cause. They change the trajectory, and taking them out made the fuzz worse (earlier ablation: 70 frames over 120 deg without struts vs 21 with). Three contact defects were behind the creases:
1. **Sticky sliding tip.** Friction 0.9 held every contact particle each substep. A rubbing tip pushed the skin ahead of it into a ridge, and the contact crushed that ridge to about 160 deg every substep. The ridge moved every substep, so 4 fold-limit passes could not keep up.
2. **Foot rim pinched against the table.** The tip sphere was only kept out of the table (cy ≥ tipR). A rub sliding down to the table squeezed the foot rim between the sphere and the table. The table always wins, so the rim was held at the 110-deg fold limit and snapped past 150 deg at the lift. All three "before" filmstrips end in exactly this pinch at the bottom of the body.
3. **Two fingers.** The pinch separation split any overlap 50/50. A rubbing finger that slid into a holding one shoved the holding tip by up to about 0.4 R in one frame (over 15 m/s). That push could also put a tip below the table floor.

### Fix (src/physics/softbody.ts, src/physics/params.ts)
- **Static/kinetic fingertip friction.** New `FINGER.frictionKinetic` 0.3, which takes over as the tip slides sideways (`frictionSlide` 1 R/s, smoothstep). Presses, holds and taps are bit-identical to before: compression 0.204, all wobble rows unchanged.
  - An ungated version failed two gates: compression fell to 0.188 (bar is 0.2) and the f1b1s0 peak wobble tau went to 2.23 s.
- **Table gap.** New `FINGER.tableGap` 0.12 R: the tip sphere's bottom stays this far above the table. It is enforced in `placeTip` and again after the pinch push.
- **Pinch separation.** Each tip gives way in proportion to how far it moved this substep. A symmetric pinch still splits 50/50.
- **Fold limit.** `foldIters` raised from 4 to 8, with an early exit once a pass opens nothing. Cost is flat: step() over the reference kernel is 0.74–0.87 vs 0.77–0.87 for the pre-fix physics.
- **tipSpeed documentation.** `FINGER.maxSpeed` now documents that tipSpeed scales with mesh detail (2.75 m/s at detail 4) and is read once, in the constructor.
- **Fold wake dropped.** I prototyped a fold-limit wake (keep checking skin touched in the last 0.15 s). It gave identical numbers on all four rows and on a 120 000-frame fuzz, so it is not in the fix.

**Ablations.** Each run takes the final set and reverts one knob, then runs the round-5 rows:

| Knob reverted | Rub row | Slide row | Two-finger row | Sane fuzz |
|---|---|---|---|---|
| `tableGap` 0 | **FAIL** 4 frames, 147° | **FAIL** 5 frames, 138° | pass | pass |
| `frictionKinetic` 0.9 | pass | **FAIL** 6 frames, 172° | pass | 3 frames, 2 episodes |
| `foldIters` 4 | pass (111°) | pass (112°) | pass (111°) | 1 frame, 123° |
| old 50/50 pinch | pass | pass | pass | pass on probe seeds |

- I kept `foldIters` at 8 as margin, since 4 also passes.
- I kept the pinch change because of a separate 120 000-frame sane fuzz (5 genomes × 4 other seeds): episodes with a finger down fell from 8 to 1.

### Cited repros, before → after
All measured with the same trace tool, worst angle / frames over 120 deg:

| Repro | Before (pre-fix) | After |
|---|---|---|
| MAJOR 1: starter from (0.05, 0.83, 0.56), 240°, 3 m/s | 179.9° / 31 | 91.4° / 0 |
| MAJOR 1: f0b0s0z0, same start, 225°, 2.5 m/s | 178.7° / 43 | 88.6° / 0 |
| MAJOR 1: f0b0s1z1, same start, 225°, 2.5 m/s | 131.0° / 5 | 101.8° / 0 |
| Drag p12: starter, 315°, 1 m/s | 148.2° / 4 | 60.7° / 0 |
| Drag p15: f0b0s1z1, 0°, 1 m/s | 126.9° / 3 | 69.8° / 0 |
| Drag p15: f0b0s0z0, 90°, 2.5 m/s | 124.1° / 1 | **121.3° / 1 (remains)** |

Verifier's suites:
- **Camera-plane rubs (180):** 192 frames in 22 rubs, worst 180 → 0 frames, worst 110.
- **Drag set (288):** 88 frames, worst 178 → 1 press, 2 frames, 142.7. This was measured with the frictionKinetic/tableGap/foldIters-8 set while I was still choosing the friction gate (plus the wake I later dropped), not re-run on the final build.
- **Realistic fuzz (5 × 20 000 frames):** 199 frames over 120 in 69 episodes, longest 10, worst 180 → 4 frames in 4 episodes, longest 1, worst 173.5.
- **2 Hz rubs across the peak, detail 3:** 2 frames, 137.6 → 0, 111.1.

### The four new probe rows (pre-fix physics → final; all FAIL before, PASS after)

| Row | Before | After | Threshold |
|---|---|---|---|
| Camera-plane straight rubs (180) | 192 frames in 22 rubs, longest 45, 180° | 0, 110° | 0 frames, ≤ 120°, rest ≤ 60° |
| Slides toward the table (112 slides, outward drags skipped) | 26 frames in 6, longest 11, 178° | 0, 110° | same |
| Two fingers, hold + rub (96) | 24 frames in 6, longest 9, 177° | 0, 110° | same |
| Sane-gesture fuzz (5 genomes × 6000 frames) | 152/30000 (5.07‰), 24 episodes, longest 31, 180° | 1/30000 (0.03‰), longest 1, 124° | ≤ 0.5‰, longest ≤ 2, 0 failures |

- I took 3 slide start points out of the slide row because the game camera's ray misses them.
- The probe takes `--round5[=rub,slide,holdrub,sane]` and `--round5-detail` to run or list these rows alone.

### Filmstrips
They are in `/home/user/forgeflow-games/games/wobblehoard/_shots/repair4/`, as `camdrag_{before,after}_{rub_starter,rub_f0b0s0z0,slide_f0b0s1z1,holdrub_starter}.png`.
- **Before:** worst fold 180, 133, 180 and 177 deg, with magenta creases at the foot rim pinched against the table.
- **After:** worst fold 91, 89, 68 and 91 deg. The dent and slide are still visible, there is no crease, and the tip stays clear of the rim.
- The viewer's camdrag scenario now takes `?hu=x,y,z` to add a holding second finger.

### Full probe (`node _harness/probe_softbody.ts`, load 18 on 4 cores): 107/109
The two failures are the unchanged absolute timing rows: step() mean 2.372 ms (bar 2.0) and p99 7.6 ms (bar 5). Everything else passes, including:
- compression 0.20; wobble 14/14; peak flop 31.5 % R
- hard side shove 110 deg (was 112; minor 3)
- substep-resolution row 110 deg (was 113); dense matrix 99 deg
- cold JIT, warmUp alloc 0 B, step() alloc 0 B
- hostile fuzz 0 failures; corral 4 mm; the new relative perf row 0.85 (bar 1.05)

### Perf
At load 9–10, measured A/B in separate processes, two runs each:

| | Pre-fix | Final |
|---|---|---|
| step() best mean | 1.39–1.41 ms | 1.36–1.42 ms |
| step() p99 | 2.13–2.59 ms | 1.99–2.49 ms |

### Disclosures you asked for
**(a) Corral free-excursion row.** Old rule: "no tip within r + 2 mm at the frame end". New rule: a frame counts as held when the tip–skin gap could have closed at any point in the frame. That is bounded by max(gap at start, gap at end) − 1.5 × (largest vertex travel + tip travel + radius change). A tip that appeared, vanished or got a fingerDown in the frame, or a grab() call, also counts as held.
- Because the gap moves no faster than vertex + tip travel, every frame the old rule held is also held by the new one.
- I checked this with a copy of the physics that records "a tip touched the skin in any substep", over the default hostile fuzz (9 243 checkable frames):

| Rule | Frames excluded as held |
|---|---|
| Old rule | 159 |
| New rule | 224 |
| Actually touched | 158 |

- Old held but new free: **0**.
- Actually touched but missed by the old rule: **14**. These are false positives the old gate could raise. Example: f0b0s1z1 frame 1043, where a tip touched in a substep but the frame-end vertex was outside r + 2 mm after 171.7 mm of vertex travel in that frame.
- Actually touched but missed by the new rule: **0**.
- Excluded by the new rule though truly free: 66 (0.7 % of frames). These are conservative exclusions: the gate checks 0.7 % fewer frames than an exact touch test would.
- The gate value is the same under all three rules: 3.9 mm.

**(b) Perf row.** Nothing was replaced. The absolute rows (≤ 2.0 ms mean, ≤ 5 ms p99) are untouched. I added one row: step() divided by an interleaved fixed reference kernel, with PERF_REL_MAX 1.05, which is 1.25 × the pre-fix 0.79–0.84 (6 runs). Under the load-18 run it read 0.85 while the absolute mean read 2.37 ms.

### Other minors
- **(4) 2 Hz rubs across the peak:** fixed at detail 3 (numbers above). At detail 4 it improved from 111 frames in 32 rubs to 50 frames in 12, but worst is still 180, so it is **not fixed**. The game only builds detail 3 (`new SoftBody(g)` in boot.ts).
- **(7) Longer hostile fuzz:** added `--long` (32 runs × 4000 frames) and `--hostile-only`. I did **not run** the long soak in this round because of the CPU limit and time box.

### tsc
`npx tsc --noEmit -p tsconfig.json` passes with exit 0 for the whole tree.

### Files changed this round
- `/home/user/forgeflow-games/games/wobblehoard/src/physics/softbody.ts`
- `/home/user/forgeflow-games/games/wobblehoard/src/physics/params.ts`
- `/home/user/forgeflow-games/games/wobblehoard/_harness/probe_softbody.ts` (the four rows, robust corral rule, relative perf row, hostile modes)
- `/home/user/forgeflow-games/games/wobblehoard/_harness/physview/view.ts` (camdrag `?hu=`)

### Known issues (honest)
1. **Lift-moment snaps.** In the verifier's realistic fuzz, 2 of the 4 remaining frames are single frames right after a finger lifts (160 and 173 deg); the other 2 are 120–124 deg with two fingers down, one dragging. The fold wake did not help, so the next things to try are a slower retract or keeping the retracting tip's near-list.
2. **Grab-pull foot rim.** In my extra 120 000-frame fuzz, a sideways pull with pinned feet leaned the trailing foot rim to 118–121 deg for about 40 frames. That is 6 episodes, longest 4 frames, so **the "≤ 2 frames" target is not met on that seed set**. It is met on the probe's own seeds and on the verifier's fuzz. It is not a fold over: the rim is a 60-deg wedge.
3. **Far-side foot rim.** The f0b0s0z0 p15 drag upward at 2.5 m/s still reaches 121.3 deg for 1 frame, about 7 tip radii away from the finger.
4. **Probe sane fuzz.** Its single remaining frame (124 deg, f0b1s0z0, single finger holding 0.92 s) was not traced.
5. **Rub-across folds at detail 4** remain (minor 4 above).

=================== NEXT REPORT ===================

## PHYSICS ROUND 2 — report

**Outcome:** items 1–6 are all built, but two existing starter gates now fail. Moving DOLLOP onto its catalog recipe broke the slide row and the two-finger row (details under item 1). One species, marigel, also fails the species press matrix. Everything else passes.

Final full `probe_softbody`: 110 PASS / 4 FAIL.
- Two failures are those regressions: the slide row and the two-finger row.
- The other two are the absolute timing rows, run at load ~18: step() mean 2.40 ms (bar 2.0), p99 10.2 ms (bar 5).
  - The relative timing row passes at 0.84 (bar 1.05).
  - The previous full run passed both absolute rows (step() mean 1.61 ms).

`npx tsc --noEmit -p tsconfig.json` is clean (exit 0). I used at most 2 of my processes at a time, and port 5368 for the browser.

### 1. Catalog shapes — DONE, with known issues
- **One code path:** `src/physics/shape.ts` builds every species' rest shape from its catalog recipe via `evalShape`, DOLLOP included. An unknown or hostile species id becomes DOLLOP.
- **What physics adds on top of the recipe:**
  - A flat foot: the lowest 2.5% of the height is snapped onto a plane.
  - A floppy weight per vertex, computed from the recipe. Only tall, narrow bumps and ridges are floppy. DOLLOP keeps the 0.7 rad floppy zone it was tuned with.
  - Struts that only join vertices of the same feature.
- **DOLLOP's shape changed visibly.** The recipe peak is broader and unpinched:
  - tip height 0.951 m instead of 1.016 m;
  - half-width 6 cm under the tip: 14.6 cm instead of 5.6 cm;
  - no lean.
- **Re-targeted probe inputs (geometry only, no threshold touched):**
  - The peak side presses and shoves now aim 6 cm / 12 cm under each genome's own rest tip. The old absolute heights of 0.96 / 0.9 m missed the new tip.
  - The metrics press moved from the shoulder at x = 0.22 m to x = 0.3 m, because 0.22 m now lands on the wider peak's flank. Compression is now 0.22 (bar 0.2).
- **Seam to refresh:** `probe_catalog`'s frozen-DOLLOP seam will now report drift. The content lane should refresh it with `--freeze-dollop`.
- **Starter regressions from the recipe shape (NOT fixed):**
  - Slide row: f0b0s0z0 p14 at 0° and 2.5 m/s gives 165°, 5 frames over 120. It is a foot-rim buckle 3–4 tip radii from the finger, the same mechanism as my old known issue 3.
  - Two-finger row: starter pair0 at 180° and 2 m/s gives 176° for 1 frame.
  - I tried a different flat-foot size:
    - a bigger foot made the slide case worse (179°);
    - no flat foot fixed it (107°) but made crumbit, granulo and marigel creep 13 mm.
  - Next step: a foot-rim stiffening or a crease limit on table-contact edges.

### 2. press and reaction — already filled (done earlier), verified
- At rest both read 0.
- A full side dent at the peak gives press 1.00 while compression is 0.01. press returns to 0 within 0.1 s of the lift.
- reaction for a held full side press: firm 0.82 vs soft 0.59.
- In the family probe, the raw push-back for the same full press ranges from 7.6 (marshmallow) to 171 (gummy). It is exposed as `debug.force`.

### 3. Ceremony drivers — DONE (`setFold`, `moveTo`, `tremble`, `burstOpen`)
All four rows pass: deterministic, allocation-free (0 B per 120 frames when called every frame), and safe with hostile values (NaN, ±Infinity, −5, 1e9, a string, null, undefined, {}).

| Driver | What it does | Measured |
|---|---|---|
| `setFold(t)` | Morphs the goal toward an equal-volume sphere, easing over 0.2 s, at most 2.5/s | sphericity 0.078 → 0.007; volume 1.000; largest move 0.037 R per frame; back to rest at 0.008 R |
| `moveTo(p, k)` | Rigid kinematic slide of the centre (horizontal only on the table); the mat corral is off while it is active | pad miss 0.1 mm |
| `tremble(amp)` | 17 Hz goal jitter, 0.035 R at amp 1 | — |
| `burstOpen(s)` | Momentum-free radial kick plus a 1.25× goal and volume overshoot that settles (τ 0.3 s) | volume up to 1.89; back to 0.009 R in 2 s |

`warmUp()` now exercises all four drivers.

### 4. Material families — P0–P2 DONE, P3–P5 DONE, P6 by the documented fallback
**How a body gets its family.** `new SoftBody(g)` with no options takes the species' family, as `materials.ts` documents: `applyMaterial(deriveParams(neutral), resolveMaterial(familyOf(species), g))` plus its solver material. So the shell's `new SoftBody(g)` already gets families. The class also accepts `{family}` and `{mat}`.

**The starter is not identical to before.** It is the gel family, but its genome now goes through the narrower material band, so smOmega is 24.0 instead of 22.1. Every starter gate except the two above still passes, including flop 31.2% R and wobble 14/14.

**Per-family features (each one is skipped below its threshold, so the gel family pays nothing):**
- **P0:** parameter ratios, plus a new `fingerFriction` parameter.
- **P1:** air-bleed volume target with return and bottom-out (volume bleed ≥ 0.03).
- **P2:** Zener memory arm updated once per frame, with yield, heal, memory cap and plastic edges (memStiff ≥ 0.3).
- **P3:** rate stiffening via the speedDamp ratio.
- **Jam:** stiffness × (1 + 6·jam·c²).
- **P5:** slosh mode.
  - It is horizontal only; a vertical component pumped a 0.8 R hop.
  - It is momentum-free.
  - Its push on the shell acts only in float mode; on the table it slid the body 18 cm back and forth.
- **P6 (fallback):** higher fingertip friction for tacky families, plus a strands signal for the renderer.
- **Not done:** P4 (Darcy damping) and P7 (snap dome).

**Measured signatures** (`probe_families.ts`, 18/18 PASS; DOLLOP shape, neutral genome):

| Family | Target | Measured |
|---|---|---|
| slowrise | sinks, creeps back over ~4.5 s (accepted 2.2–9 s) | volume dips to 0.895, at +1 s 0.969, +3 s 0.993; back in 3.43 s |
| marshmallow | puffs back in ~1 s | volume dips to 0.891, back in 0.82 s |
| mochidough | keeps a thumb-print, then heals | dent 0.45 R at release, 0.26 R at +0.5 s, 0.07 R at +3 s, 0.005 R at +10 s |
| putty | keeps ~1/3 of the dent for > 10 s | dent 0.50 R at release, 0.29 R at +10 s (57%) |
| slimegoo | oozes back slowly but fully | 34% of the dent left at +1 s, 0 at +12 s |
| jellygel / firmsilicone / gummy | back within 0.5 s, incompressible | shape error at +0.5 s 0.019 / 0.005 / 0.006 R; volume ≥ 0.992 |
| waterfill / beadsqueeze | slosh at documented Hz and damping | free swing 2.63 Hz, ζ 0.10 (doc 2.6 / 0.1); 3.27 Hz, ζ 0.35 (doc 3.5 / 0.35) |
| stickystretch / slimegoo | strings on pull-off | strands 0.83 / 0.75, gone within ~0.75 s; no non-tacky family produces strands |
| all | rate stiffening (fast / slow push-back) | high-speedDamp families 4.75 vs low 1.60; slime 8.15, sticky 5.14, firm silicone 1.38 |
| beadsqueeze | jam pushes back harder | 49.7 vs 43.0 without jam |
| all | volume inside family band | slowrise 0.89, marshmallow 0.89, popdome 0.90, beadsqueeze 0.89–0.91; all others ≥ 0.98 |

- **Feel vector:** the closest pair is jellygel / firmsilicone at 0.061. The bar of 0.06 is my own choice, so this check is thin.
- **Slow families recover faster than designed:** slowrise 3.4 s vs 4.5 s, marshmallow 0.8 s vs 1.1 s.

### 5. Gates
- **probe_softbody**, new rows (all pass):
  - every family is allocation-free (0 B each, after a 50 s warm-up per family);
  - per-family volume band from each family's documented bleed;
  - the three ceremony rows.
- **probe_species** (new): 50 species × 3 genomes = 150 bodies; 4/6 checks pass.
  - **PASS:** settle (no hop, no creep, rest fold ≤ 55°).
  - **PASS:** short fuzz (0 failures, one replay per family deterministic).
  - **PASS:** volume band (704 presses).
  - **PASS:** rest after lift. Plastic or slow families get ≤ 90° (no tucked flap), because they keep or are still healing a dent by design. The limit is derived from `materials.ts` recovery times.
  - **FAIL:** press matrix — marigel only, flank press, 144–163°, 78 frames. It is a valley crease between two petals, about 1.9 tip radii from the finger. `strutMaxR` 0.3 fixed it in a test, but that is not applied because it would retune DOLLOP's struts.
  - **FAIL (load):** perf, measured while the full probe ran beside it (the starter itself read 4.93 ms). The quieter run before it had every family's heaviest species at 1.63–1.89 ms, worst putty/fossilo 1.89 ms (1.18× the starter's 1.61 ms).

### 6. Look — DONE
- `browser_physics.mjs` gained `--family`, `--species`, `--sheet` and `--port`.
- New viewer scenario `family_demo` (press-hold-release, then a pull).
- New rest contact sheet at `_harness/physview/sheet.html`.
- I rendered one filmstrip per family plus the sheet into `_shots/r2/`.
- **What I checked by eye:**
  - slowrise sinks and creeps back over seconds; putty keeps a flattened top and a stretched lobe.
  - stickystretch's top press creases at the DOLLOP peak (169°); real sticky species pass at ≤ 110°.
  - Most silhouettes match CATALOG.md. Tails and back fins don't show in the 3/4 front view, and capnap's stalk is hidden.
- I did not tune shapes against the filmstrips for lack of time.

### Stretch-to-2× numbers (for the collection's STRETCH_2X_INTENSITY = 0.8)
Test: grab the outermost +x vertex and pull it straight out 3 R over 1 s.
- **Only stickystretch can reach twice its length** (twangle: up to 2.73×). At 2× it reads stretch 0.20; peak stretch 0.38; snap intensity 0.33.
- **Every other family is capped by maxPull at 1.16–1.69× length:**
  - stretch max: slime 0.42, dollop 0.33, others 0.09–0.33;
  - snap intensity: 0.05–0.42.
- **So 0.8 is unreachable.** A threshold around stretch ≥ 0.2, or snap intensity ≥ 0.3, would mean a real 2× pull.
- The contract says stretch 1 ≈ 2.2× extent, but the metric is measured against the moving shape-matching goal, so it reads much lower than that.

### Contract additions
- `SoftMetrics.strands?` and `SoftMetrics.slosh?` (optional, 0..1) in `src/contracts.ts`.
- Class-level only, not in the ctor contract: `SoftBody` options `{family, mat}`, `body.family`, `debug.force` (harness), and SoftParams `fingerFriction`.

### Your five known issues
- **Issue 3 (far-side foot rim) is worse:** it now fails the slide row (165°, 5 frames).
- **Issue 4 (sane fuzz):** still a single frame, now 130° (was 124°).
- **New regression:** the two-finger 176° frame.
- **Not re-measured:** issues 1 (lift snaps in the realistic fuzz), 2 (grab-pull foot rim) and 5 (detail-4 rub-across).

### Files
`/home/user/forgeflow-games/games/wobblehoard/`:
- `src/physics/shape.ts`
- `src/physics/softbody.ts`
- `src/physics/params.ts`
- `src/physics/struts.ts`
- `src/contracts.ts` (additive only)
- `_harness/probe_softbody.ts`
- `_harness/probe_families.ts` (new)
- `_harness/probe_species.ts` (new)
- `_harness/physview/view.ts`
- `_harness/physview/sheet.html`, `sheet.ts` (new)
- `_harness/browser_physics.mjs`

### Honest limits
- No adhesive tack bonds: only the strands signal (P6 fallback).
- No Darcy damping (P4) and no snap dome (P7).
- I did not run a long or hostile fuzz per family.
- The family thresholds are design values I chose from SQUISHY_SCIENCE (for example the 0.5×–2× recovery bands); the feel-vector bar is the thinnest of them.

=================== NEXT REPORT ===================

PHYSICS FIX ROUND: REPORT (wobblehoard)

All five items are done, and every requested gate passes except the absolute perf rows, which fail inside the full probe runs. The machine is loaded by the other lanes: load average 7–12 on 4 cores, with a headless browser using 160% CPU. The same perf measurements pass when I run them alone (details below). Checkpoint 32 (5727e2a) already contains all of my source changes; I have edited nothing since. tsc is clean. No processes of mine are left running.

== 1. DOLLOP look and starter gates ==
- **New primitive (additive, in src/data/shapes.ts).** The radial primitives cannot express the pinch. A radial bump narrow enough for the tip covers only 1–2 vertices of the 642-vertex mesh and is below SHAPE_MIN_WIDTH. The hand-built DOLLOP got its tip by moving points toward the axis, which packs vertices into the peak.
  - Added: `ShapePeak {dir, width, lift, pinch, lean}`, `ShapeFoot {y, soft, snap}`, optional `swirl.yScale`, optional `ShapeRecipe.peak` / `.foot`, and `shapePoint()` (the forward map).
  - On such a recipe, `evalShape` inverts the map (fixed-point iteration, no allocation). Recipes without these fields go through the unchanged code path.
  - `DOLLOP_RECIPE` is the hand-built constants of 6dff62e written as data.
  - In the physics, `restPoint` uses `shapePoint` (×R0) for a recipe that has its own foot. The peak's floppy weight is exp(-(θ/(1.75·width))²), which is the old 0.7 rad zone.
- **Fit error (radius along each old rest point's direction, R0):**

| | RMS | max |
|---|---|---|
| Round-2 radial recipe | 0.0124 | 0.081 |
| Now | 7e-14 | 9e-13 |

  On 20 000 dense directions the max is 1e-12. Live `restPoint` against the 6dff62e DOLLOP: 2e-16 R0, floppy weights identical, struts 169 (detail 3) / 733 (detail 4) unchanged.
- **Tip height and half-width (rest shape, starter, foot to tip; half-width from a mesh slice 6 cm under the tip):**

| | tip height | half-width | lean |
|---|---|---|---|
| Old hand-built | 1.0148 m | 0.0625 m | — |
| Now | 1.0148 m | 0.0625 m | tip x 0.044, z 0.015 |
| Round-2 recipe | 0.9501 m | 0.119 m | none |

  The earlier 0.056 / 0.146 figures came from a different measurement.
- **probe_catalog: all pass (130 ok).** DOLLOP fit RMS 0.000, worst 0.000. The seam row passes with no drift, so I did not run `--freeze-dollop`.
  - **Outside my lane:** the edit made section 9 fail ("_spec/CATALOG.md matches renderCatalogDoc()"). I ran `node _harness/gen_catalog_doc.ts`, as the check itself instructs (no hand edit). Two lines changed: DOLLOP's row and Flipdome's closest silhouette. Please confirm or revert.
- **Aims:** the old absolute aims (0.9 / 0.96 m) and the x 0.22 metrics press are valid again and restored. The per-genome "tip − 6/12 cm" aims landed within 1.2 mm of them on all 5 genomes; restTop is removed.
- **Slide and two-finger rows:** fixed by the refit alone.
  - Slide: 165° (5 frames) → 110° (0 frames).
  - Two fingers: 176° (1 frame) → 111° (0 frames).
- **Two regressions the restored shape exposed (both fixed at the root, no threshold changed):**
  - **Sane-gesture fuzz failed** (7 frames, longest episode 5). Cause: a foot-rim edge lying on the table creased 137–142° after the finger slid off, 2.5 tip radii away (f0b0s1z1). Fix: while a finger or a grab is active, particles touching the table join the contact fold limit (the same derivation as for the fingertip). After: 1 of 30 000 frames, longest 1, 149°, which passes.
  - **Metrics row failed** (compression 0.198 against > 0.2). Cause: round 2 builds its parameters on a neutral genome, so the starter (firmness 0.38) lost 1% of its press depth (squashDepth 0.450 → 0.445). Fix: the "give" law below. After: compression 0.2036, which passes.

== 2. MARIGEL crease ==
- **Root cause:** struts from valley particles. In a valley between two petals, both petals claim the particle with floppy weight about 0.74. A strut from there runs through one petal's base and pins the valley floor at its rest distance from that petal's far wall.
- **Fix:** each particle gets a strut weight, which is its floppy weight faded by smoothstep(0.5, 0.9, second-strongest feature / strongest feature).
  - A lone feature keeps its full weight, so DOLLOP's struts are unchanged.
  - Strut counts dropped in 18 species (marigel 777 → 430).
- **Result:**

| | before | after |
|---|---|---|
| Flank press | 160.7°, 26 frames | 84° |
| probe_species press matrix | 163°, 78 frames | 112°, 0 frames, 0 missed (704 presses) |

== 3. Feel separation ==
- **Physics change ("give"):** the fingertip is position-driven, and since round 2 every family and genome was pressed exactly as deep. I now scale squashDepth by smOmega^-0.551. The exponent comes from deriveParams' own law (0.66 → 0.34 over smOmega 12 → 40). It applies to:
  - the genome part both ways (starter ×1.03, firmness 0 ×1.13, firmness 1 ×0.88);
  - the family part only where the family is stiffer than gel (firm silicone ×0.76, pop dome ×0.70, gummy ×0.86).
- **Probe change, flagged because it is a change to the probe:** the feel vector had no axis for give, because every family used to press to the same depth. I added an 11th axis: the dent at release divided by 0.4. FEEL_MIN stays 0.06. I also added a new gate row: jellygel vs firmsilicone ≥ 0.12.
- **Results:**
  - jellygel vs firmsilicone: 0.061 → **0.152**.
  - On the old 10-axis vector the pair is 0.101 with give, or 0.120 from the shape restore alone. So the 2× margin depends on the new give axis.
  - Give 0.308 vs 0.151 R; push-back 20.7 vs 23.3; shape error left at 0.25 s 0.41 vs 0.11.
- **probe_families: 19/19**, both families' signatures green.

== 4. Pull intensity ==
- **Event semantics:** there is no 'pull' event kind. A pull is 'grab' → 'snap'.
  - The 'snap' intensity is now the pull level: grab target distance / (`p.maxPull` × restRadius). The physics clamps every pull at that distance, so 1.0 means the body reached its own family's maxPull.
  - A 'snap' now fires when the pull level is > 0.05. It used to require metrics.stretch > 0.05, which slow-rise foam never reached even at its maxPull, so it never snapped.
  - 'grab' still carries a fixed 0.5. metrics.stretch is unchanged.
  - Documented in contracts.ts (comments only).
- **Full pull per family** (target dragged 4 R out on the DOLLOP shape with a neutral genome):
  - The new snap intensity is 1.000 for all 12 families, and 1.000 on each family's first species. A half pull gives 0.500 for all.
  - The old snap value (stretch at release) for the same full pull, with maxPull in R: slowrise 0.04 (0.98), marshmallow 0.12 (1.28), mochidough 0.21 (2.07), jellygel 0.25 (1.70), waterfill 0.21 (1.48), putty 0.22 (2.26), stickystretch 0.40 (2.85), slimegoo 0.32 (2.66), firmsilicone 0.15 (1.13), popdome 0.09 (0.79), gummy 0.13 (1.23), beadsqueeze 0.09 (1.38).
- **Shell lane needs to act:** `src/shell/feel.ts` multiplies snap intensities by 1/stretchFull (about 3.3×), so any pull above roughly 30% would saturate. That rescale should stop applying to snap. Collection's meterfeed 'pull' amount is the snap intensity, so it now reads higher.

== 5. Per-family hostile fuzz ==
- Run with `node _harness/probe_softbody.ts --families-hostile`: 12 families × 2 genomes (the family's first species on its template genome, plus an extreme corner genome on DOLLOP) × 1500 frames of the existing hostile fuzz.
- **Result: 24 of 24 runs, 0 failures** on NaN, inversion, table penetration, events, settling within 8 s, volume within ±0.015 and flipped triangles.
  - Slowest settle: 3.83 s (putty).
  - Worst shape error on an elastic family: 1.20% R.
  - Plastic or slow families are not gated on shape (putty kept 3.40% R by design).

== Probe counts ==

| Probe | Result | Note |
|---|---|---|
| probe_softbody, full (load ~12) | 112/114 | Only the absolute perf rows fail: mean 3.52 ms, p99 26.8 ms. Relative row 0.85 ≤ 1.05 passes. |
| probe_softbody perf, alone | pass | Mean 1.486 ms, p99 3.08 ms, relative 0.78. Other lanes still at load 7–10. |
| round-5 rows | 4/4 | |
| probe_species, full | 5/6 | Only perf fails under load: slowrise (somnuff) 2.42 ms. |
| probe_species `--only` (13 heavy species) | 5/6 | Perf 2.13 ms at load 8 still fails the 2.0 ms bar. |
| probe_species perf, alone (×2) | pass | Worst slowrise 1.76 / 1.86 ms. |
| probe_families | 19/19 | |
| probe_catalog | all pass | |
| families-hostile | 1/1 | 24 runs |

- The "perf alone" rows are scratch copies of each probe's perf code (in r2/), not the probes themselves. probe_species' own perf row failed in both of its runs (full 2.42 ms, `--only` 2.13 ms against 2.0), so I have not shown it passing under its own harness.
- Somnuff (slowrise) is now the most expensive species at 1.14–1.21× the starter.

== Files changed ==
- src/data/shapes.ts: DOLLOP_RECIPE plus the additive peak/foot/yScale primitive and shapePoint.
- src/physics/shape.ts
- src/physics/softbody.ts: give law, table-edge fold limit, struts built on strutW, pullLevel and the snap change.
- src/contracts.ts: comments only.
- _harness/probe_softbody.ts: aims restored, `--families-hostile` mode.
- _harness/probe_families.ts: give axis, 2× row, pair table in `--list`.
- _harness/probe_species.ts: a press on a parametric recipe's peak.
- _spec/CATALOG.md: regenerated by gen_catalog_doc.ts (outside my lane, see item 1).

== Known issues ==
1. **Lift snaps:** a single frame of 149–150° on the starter with no finger down, in the sane fuzz.
2. **Grab-pull foot rim:** not re-measured this round.
3. **Far-side foot rim:** now covered while a finger or grab is active. Not covered after the release, because the fold limit is switched off then to save cost.
4. **Sane-fuzz single frames:** 1–2 frames per 30 000, within the gate.
5. **Detail-4 rub-across:** not re-measured.
6. **New: firmsilicone vs popdome is now the closest pair at 0.062** (0.065 on the 10-axis vector). Give pulled them together, and pop dome's own snap is still unbuilt.
7. **New: the gel / firm silicone margin relies on the new give axis** (0.101 without it).
8. **New: give changes every non-neutral genome's press depth** (×0.88 to ×1.13). Before round 2 the range was wider.
9. **New: CATALOG.md's feature column shows DOLLOP as 1.** The generator counts features plus swirl, not the peak.
10. **New: evalShape on DOLLOP is iterative and slower.** Only measurement and probe code calls it; the physics uses shapePoint.
11. **Perf has little headroom on this loaded machine.** The absolute rows pass only in runs where my perf code ran alone; probe_species' own perf row failed both times.

Scratch outputs are in /tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r2/ (fix_full2.txt, fix_species2.txt, fix_species_perf.txt, fix_fam5.txt, fix_famhostile2.txt, fix_catalog2.txt, fix_r5b.txt, pullfam.txt, perfsolo.ts, spperf.ts, r2dollop.ts).