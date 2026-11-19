# R10 LOCOMOTION: squishies crawl like slugs / snails (owner, 2026-11-19)

Running report (updated after each finished step). Engineer: LOCOMOTION. Scratch copy: `scratchpad/locomotion10/` (may be wiped by a restart; the key code is kept as `_handoff/reports/R10_LOCOMOTION.patch` once it works).

## Step 0 (start, HEAD ad75c5043)
- Scratch copy made (tar of the game without node_modules / dist / _shots / _live_snapshot; node_modules symlinked). Working tree clean at the start.
- Today's motion: LIFE's SCOOT intent -> `body.scootTo(x, z, speed)` (later-life.ts applyIntent) -> softbody.ts `scootStep()`: a RIGID horizontal translation of every particle per substep (no momentum, friction never sees it). That is the "slide".

## Step 1 (prototype in scratch: WORKS on flat ground)
Design (all new logic in the lazy props chunk; softbody.ts gets a ~4-line hook):
- `src/physics/crawl.ts` (new, imported only by props.ts -> the `later-props` chunk): one `Crawl` per body a prop world tracks (props.ts `trk` attaches it,
  untrack removes it). `PropWorld.beginFrame` steps each crawl once a frame BEFORE the bodies step: (1) GOAL: a travelling wave of axial strain along the
  travel direction in the body's rest frame (front leads the rear by 2 kappa), mass-weighted mean 0, written to `SoftBody.crawl.d` and added to the goal in
  `frameUpdate`; (2) GRIP: each particle is moved once a frame by w x the frame's glide along the travel direction (w = -1 planted .. +1 reaching), like the
  glide a move of X before the substeps (friction never sees it, no momentum); the wave of (1) is its integral so shape matching agrees; (3) FADE when the
  glide stops / touch gate / held / carried / ceremony / float / long air / Calm.
- softbody.ts hook: public `crawl: {on, d} | null`; frameUpdate adds `d` to GB while on (and counts as "shaped"); step() runs frameUpdate while on;
  the shape-matching rotation is fitted against the goal QG while the crawl is on (as for the neck: fitting against Q spun the deformed body up and
  launched it 0.5 m: putty flew; with QG the walk is stable).
- scootTo's glide (speed, ease, gate, target) is untouched: WHERE / WHEN unchanged.
First numbers (node, template genome, 2 m walk on flat ground, family glide speed; `exp_crawl.ts` in `_handoff/reports/r10_locomotion/`):
| family | arrive crawl / glide | footprint osc (% body length) | volume | rest after stop |
| jellygel | 7.52 / 7.57 s | 16.4 | 0.999..1.000 | 0.28 s |
| putty | 15.83 / 16.32 s | 17.7 | 0.999..1.000 | 0.80 s |
| firmsilicone | 5.82 / 6.17 s | 20.8 | 0.998..1.001 | 0.85 s |
| slimegoo | 18.87 / 19.57 s | 17.9 | 1.000 | 0.48 s |
Front leads mid by ~0.15 cycle and mid leads rear by ~0.18 cycle (velocity phase of body thirds). Yaw / lateral drift ~0.
Browser filmstrip (`crawl_film.mjs`, scratch, port 5356; canvas captured with toDataURL because page.screenshot times out on the paused dev page):
reads as a soft body pulsing along; firm silicone pulses tall/flat strongly. Open: the COM surges 0..2x the glide speed (the bulge pitches the body);
the hump travels front->rear (earthworm) rather than the inchworm's middle hump on the pull-in.

## Step 2 (scratch: probe_crawl.ts written, tuned; patch saved as R10_LOCOMOTION.patch against HEAD ad75c5043)
- Shape: an inchworm arch (the middle rises as the body shortens, flattens as it reaches; `hump` per family) + a smaller travelling local bulge + head lift + lean.
- `CRAWL.beta` 0.35: a third of the wave's instantaneous mean is taken out of the grip move (the centre surges 0.4..1.6 x instead of 0..2 x; the planted
  base still holds: its slip is 0.22..0.26 of the glide speed, the glide's base slides at 1.0).
- No crawl under 0.045 m/s (LIFE's contact approach at 0.04 m/s glides as before), full from 0.09 m/s; the wave lets go at 3 % (8 % under the touch gate).
- ALLOCATION (found and fixed): (1) dt / grip passed as doubles into the non-inlined Crawl.step boxed a HeapNumber per call (PH-11 3/3 FAILED: 3840..9600 B
  per 120 frames); now the crawl reads them from the world; (2) an idle crawl's early return read a Float64Array element (a HeapNumber in code not yet
  optimised): now it tests the boolean `on`. probe_playground --only=alloc: PH-11 3/3 PASS (0 B, 0 B, 16 B first window as at baseline).
  (A probe that toggles the module constant CRAWL.on before measuring sees 128 B/frame: V8 const-field deopt; the game never toggles it: CR-13 measures first.)
- probe_crawl quick (scratch): 13/13 with CR-12 run first: CR-01 footprint 18.5..22.0 %, CR-03 travel -0.4..-2.6 %, CR-04 rest <= 0.63 s, volume <= 0.62 %,
  CR-06 base slip 0.22..0.26 (glide 1.00), CR-07 turns ok (lean 0.095), CR-08 ice slip 0.69..0.73 (felt 0.25), water / ramp / mound = glide,
  CR-09 small/big/half chunk/mini ok, CR-10 gate 0.133 s, CR-11 Calm bit-identical, CR-12 crawl step 17 us/body/frame, crawl - squash pose 10..19 us/body.
- NOTE: the working tree's softbody.ts now has another engineer's D-97 edits (descendT); the port must merge around them.

## Step 3 (PORTED to the working tree; tsc clean)
- softbody.ts (merged around the other engineer's D-97 edits): public `crawlOn = false; crawlD = new Float64Array(0)` (no object reference: the substep reads a
  boolean, so the first walk does not deoptimise it; warmUp runs one frame with crawlOn so the goal and fit paths are warmed); step() runs frameUpdate while
  crawlOn; frameUpdate adds crawlD to GB (shaped); the rotation fit uses QG while crawlOn.
- props.ts: `calm` field, `crawls: Crawl[]` parallel to `bodies` (trk push / splice, crawlOn cleared on untrack), beginFrame steps them.
- new src/physics/crawl.ts (lazy: imported only by props.ts -> the later-props chunk), new _harness/probe_crawl.ts.
- later-life.ts: ONE line after `s.calm = ...`: `if (world) world.calm = s.calm || s.reducedMotion;` (Calm / prefers-reduced-motion -> today's glide).
- Patch (my parts only, against HEAD ad75c5043): `_handoff/reports/R10_LOCOMOTION.patch`.

## Step 4 (working tree checks so far)
- `npx tsc --noEmit -p tsconfig.json`: clean after every edit.
- `node _harness/probe_crawl.ts --only=gate`: 2/2 (touch gate 0.133 s; Calm bit for bit = glide; no walk = before).
- `node _harness/probe_playground.ts` (quick): 74/74 PASS with the crawl (its scoot rows now crawl).
- `node _harness/probe_playground.ts --only=alloc` (scratch, same code): PH-11 3/3 PASS, 0 B (was 3/3 FAIL before the boxing fix; baseline 3/3 PASS).
- `node _harness/probe_quests.ts`: all run checks pass (3 NOT RUN as before). No physics in it.
- `node _harness/probe_life.ts`: 127/128; the one FAIL (LF-02, lifeStep allocation, kinematic host, no physics) fails identically on untouched HEAD
  (scratch baseline copy) and in the scratch crawl copy: pre-existing, not this change.
- D-100 written at the end of `_spec/PLAYGROUND_BUILD.md`.
- Bytes (rolldown minify of each module, as vite 8 builds): softbody.ts +217 B raw / +73 B gzip (FIRST PLAY); props.ts +192 B raw (later-props);
  crawl.ts 3,822 B raw / 2,164 B gzip (later-props); later-life.ts one line (~50 B raw). Whole build (T1): about +4.3 KB raw.

## Step 5 (FINAL, working tree; tsc clean)
Fixes after step 4: (a) the wave's goal is made volume-neutral to first order (the rest mesh's volume gradient; a uniform scale gives the change back): the
foams and the beads breathed 0.89..1.08 before, now 0.975..1.002, inside what today's walk (glide + gait hops + their squash) already does to them
(marshmallow 0.935..1.029, beads 0.958..1.012); CR-04's volume bar is "within 1 % or within the family's own range on today's walk"; (b) a CUT CHUNK ran
away at 5..10 m/s: its goal (flat cut face) is not centred, and the rotation was fitted against that goal in world coordinates; now the fit uses
`crawlF` = rest shape + wave (centred), kept by the crawl; (c) the crawl step was trimmed (one main pass, extents from the last frame).

probe_crawl.ts (working tree; sections run separately while the machine was loaded): `--full --only=flat,turn,surf,gate` 10/10, `--full --only=scale`
1 row 12/12 walks, `--only=cost` 2/2. All 12 families (template genome, 2 m walk):
| family | footprint osc % len | front->mid / mid->rear lead (cycles) | cycle s | travel vs glide | volume | at rest after stop |
| slowrise | 21.8 | 0.20 / 0.23 | 1.42 | -3.5 % | 0.986..1.000 | 0.38 s |
| marshmallow | 22.7 | 0.20 / 0.22 | 1.00 | -2.1 % | 0.975..1.002 | 0.40 s |
| mochidough | 18.4 | 0.18 / 0.26 | 1.75 | -2.3 % | 0.997..1.001 | 0.78 s |
| jellygel | 16.8 | 0.22 / 0.22 | 0.70 | -0.7 % | 0.999..1.000 | 0.30 s |
| waterfill | 17.1 | 0.20 / 0.23 | 0.99 | -1.9 % | 1.000 | 0.38 s |
| putty | 16.2 | 0.19 / 0.27 | 2.65 | -2.0 % | 0.999..1.000 | 0.60 s |
| stickystretch | 22.4 | 0.21 / 0.22 | 1.09 | -2.2 % | 0.999..1.000 | 0.37 s |
| slimegoo | 15.6 | 0.21 / 0.28 | 2.57 | -3.3 % | 1.000 | 0.33 s |
| firmsilicone | 20.9 | 0.20 / 0.22 | 0.67 | -0.8 % | 0.999..1.000 | 0.28 s |
| popdome | 20.8 | 0.19 / 0.22 | 0.76 | -1.2 % | 0.990..1.001 | 0.28 s |
| gummy | 20.8 | 0.20 / 0.22 | 0.79 | -1.7 % | 0.999..1.000 | 0.35 s |
| beadsqueeze | 21.7 | 0.19 / 0.22 | 1.39 | -4.7 % | 0.975..1.001 | 0.78 s |
Planted base slip 0.21..0.26 of the glide speed (glide: 1.00); fold <= 65 deg; lateral drift 0 mm; yaw <= 0.4 deg; centre speed 0.21..1.89 x (never backward).
Turns (90 deg retarget): on time, lean 0.095. Ice: base slip 0.68..0.72 (felt 0.24). Water 8 cm, ramp, mound: same as the glide (the glide itself
cannot climb the ramp or mound from the floor: a static prop blocks the scoot; LIFE rides them by carryTo). Small / big genome, half chunk, 1/8 mini of
jelly, putty, firm silicone: all crawl (osc 12.1..48.8 %, on time within 8 %). Touch gate: crawl off in 0.133 s. Calm: bit for bit the glide.
Cost: crawl step 17..21 us per walking body per frame (node, loaded machine) + the goal reshape a squash pose already costs; frame of 2 walking bodies
crawl vs glide x 1.02..1.09 (noisy), crawl - squash pose -3..+27 us per body; 0 us for a body that does not walk (boolean test, 0.3 us).
Allocation: CR-13 0 B; probe_playground --only=alloc PH-11 3/3 0 B.
Bit identity: a body with no crawl steps bit for bit as softbody.ts without the hook (4 scripts x 560 frames: press, scoot, squash, hop, grab, float).
Other probes on the working tree: probe_playground quick 74/74; probe_life_selfuse --quick all pass (SU-01 6/6 places, SU-02, SU-03, SQ-01);
probe_quests all pass; probe_life 127/128 (LF-02 = pre-existing, identical on untouched HEAD). probe_softbody NOT run to the end (over 6 min on a
machine at load 12; replaced by the bit-identity check above).
Bytes (rolldown minify per module): FIRST PLAY softbody.ts +281 B raw / +90 B gzip; lazy: crawl.ts 4,599 B raw / 2,481 B gzip, props.ts ~+190 B,
later-life.ts ~+50 B. T1 total about +5.1 KB raw. No vite build was run (the other engineer owns the T1 trim).
Browser (working tree, port 5357, `_harness/crawl_film.mjs`, canvas captured by toDataURL): `_shots/crawl/` (gitignored): LIFE-driven Dollop at Home
1280x800 and 390x844, at Hearthlog 1280x800 (8 frames over a cycle each, game camera + side-on), sheets `sheet_*.png`, scripted family side views
`sheet_family_{jellygel,putty,firmsilicone}_side.png`. 0 console problems. Judgement: reads at a glance as a soft creature gathering itself and reaching
(tall and short -> long and low -> tall), smooth, not glitchy; firm silicone pumps tall/flat strongly (springy, lively, near the upper limit);
putty creeps in slow heavy pulses. Open: the body does not turn to face its travel (the face stays to the camera, as with the glide), so a sideways
walk crawls "crab-wise"; turning bodies is a separate decision. The gait hops of LIFE still happen on top of the crawl (LIFE's, untouched).
Files: NEW src/physics/crawl.ts, _harness/probe_crawl.ts, _harness/crawl_film.mjs; EDITED src/physics/softbody.ts (hook), src/physics/props.ts,
src/shell/later-life.ts (1 line), _spec/PLAYGROUND_BUILD.md (D-100 at the end). Patch: R10_LOCOMOTION.patch.
