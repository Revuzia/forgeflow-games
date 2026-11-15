# SEAM MAP: PHYS lane for PLAYGROUND (read-only analysis, 2026-11-15)

Scope: `src/physics/**` (softbody.ts 2841 lines, params.ts, shape.ts, struts.ts, mesh.ts, mathx.ts), `src/data/materials.ts`, the physics part of
`src/contracts.ts`, the probes `_harness/probe_softbody.ts`, `probe_species.ts`, `probe_families.ts`, `probe_cut.ts`. Line numbers are HEAD as read today.
Numbers marked "measured here" come from three short node scripts I ran on this container at load 0.1 (dollop, best of 5 x 60 frames); every other
number is quoted from the code or a named report.

## Summary
- The ground is one flat plane at y = 0, hard-coded in about 20 places (table pass, tack, pins, collide, fold limit, fingertip floor, volume
  blocking, land event). A per-place ground needs one small "ground query" (height, normal, grip, slip, sink) called from those places. The hard
  parts are SUPPORTED GRAVITY (a resting body has no gravity at all, so it can never slide down a slope) and the TACK layer (measured as absolute
  height above y = 0).
- Every external contact today is per particle only: 2 kinematic fingertip spheres per body (per substep) and body-to-body `collide` (per FRAME,
  position level, mass-blind, half each). There is no shared world step: each body runs all 6 of its substeps alone. So props can be solved
  inside each body's substep as kinematic shapes, and moved by the impulses they collected, once per frame (one-frame lag). That is the cheap,
  deterministic path; a true two-way per-substep coupling needs a world-level substep loop (a big refactor).
- Autonomous motion has the parts but no gait: `nudge` (uniform velocity), `moveTo` (a rigid glide, no deformation, no friction), `setFold`,
  `tremble` (17 Hz only), `burstOpen`, the carry. A hop needs a new squash goal plus a launch that gets past the family's tack, which differs about
  5x between families. Nothing in physics stops a driver when the player touches the body: that gate must be added.
- No sleep exists. A body at rest still costs the full step (measured here: 0.69 ms at detail 3, 0.17 ms at detail 2). Sleep is safe to add as a
  pure function of state, but `metrics.kinetic` is INTERNAL energy only, and a `moveTo` glide shows up in neither kinetic nor velocity.
- A whole squishy can be built at detail 2 today (`opts.detail`, contracts.ts:198): 4x cheaper, rests fine on all 12 families (measured here),
  but nothing about it is gated (all fold, hop and press rows run at detail 3). Detail cannot change at run time; only a rebuild (swap) can.
- Runtime material scaling: grip, tack and edge compliance are read every substep and can be scaled now; stiffness is one cheap field away
  (`smW2` feeds a per-substep K); damping, drag, volume compliance and the hinge limits are baked in the constructor.

## 1. Ground contact today, and a ground model per place
**Today.**
- Table pass, `softbody.ts:2217-2291`, once per substep, after the fingertips. For each particle with y < NEAR (0.01 m, :184): project to y = 0
  (:2240), Coulomb friction as a position cap `mu x pen` (:2245-2250), with `pen` = penetration + the supported weight `supp x g x H^2`
  (`load`, :2221) + the fingertip's downward push (`fload`, :2222). `tableMu` = 1.5 (params.ts:123) x the family ratio (materials.ts:579,
  family tableMu / gel 0.60, so firm silicone 2.25, slime 2.375, sticky stretch 2.75).
- Supported gravity, `:1906-1916`: while the foot is down gravity is faded out by `supp` = smoothstep((near particles - 1) / 4) (:2290), and only
  comes back when the lowest goal point floats GOAL_FLOAT 0.03 R up (:1915). The body at rest has ZERO gravity: rest is exact (drift 0.0 mm,
  kinetic 0.0000 over 2.5 s on all 12 families, measured here).
- Tack, `:2241-2244` and `:2262-2271`: a foot particle lifting off its REST height H0 (absolute height above y = 0, built at :604-605) by less
  than `glue` is pulled back (`H0 + lift x k^2`). glue = 0.02 m x (R / 0.5) x (1 - fold) x family glue scale (1+0.1)/(1+memStiff) (materials.ts:584):
  putty x0.18, slime and mochi x0.28, slow-rise and beads x0.37. Peel damping removes up to `groundDamp` x smoothstep of the upward centre speed
  per substep (:2273-2276, applied :2630); groundDamp = 0.35 x (0.5+1.5 tack)/0.725: sticky stretch 0.89, slime 0.78, firm silicone 0.31, pop dome 0.24.
- Feet pin, `grab()` :1062-1066 and `:2278-2282`: on a grab every particle with y < NEAR is held exactly in x/z and at y = 0, for `pinHold`
  0.5 s after the last grab lets go (params.ts:114).
- Mat corral, `matCorral` :1600-1620, gated at :1857-1861: about the body's HOME (homeX/homeZ, :344, set only from `piece.at` in the
  constructor :784): dead zone 0.6 m, ramp 0.6 m, brake 6 1/s, glide back 0.35 m/s, rim 2.5 m with RIM_BOUNCE 0.35 (params.ts:141, softbody :222).
  Off while a grab, pinned feet, a touching fingertip or `moveTo` holds the body, and in float mode.
- Float mode (`gravity = false`, :802-809): a hover spring on the centre toward the WORLD ORIGIN x = z = 0 (not home!) at height R + 0.35 m
  with a 0.03 m, 0.33 Hz bob (:1918-1926); stiffer while touched. Slosh pushes the shell only when floating (:2346).
- Other y = 0 sites: collide clamps (:1370, :1372, :1398-1399), fold limit at the table (:1711-1778), fingertip floor `tipR + 0.12 R` (:1528, :1584-1586),
  volume-constraint blocking (:2052), `fingerDown` "supported" test (:953), carry floor `restCenterY` (:1882), `reset` (:815), land event (:2683-2685),
  `grounded` = 3+ near particles (:2793).

**What a ground model per place takes.** One query `ground(x, z) -> height h, normal n, grip mu, slip, sink, tack` (data from `places.ts`),
called through cached fields, not a function returning doubles (boxing rule, header :3-5).
| Want | What changes | Difficulty |
|---|---|---|
| Grip (sand) | scale `tableMu` (read per substep :2218) and `glue` | trivial, works today by writing `body.params.tableMu` |
| Ice | lower `tableMu`; ALSO lower `drag` (baked `dragF` :766, applied to the WHOLE velocity :2658, so even mu 0 stops a slide in 0.5-1 s); lower `CONTACT_MU_BODY` for body pairs | small |
| Soft / sink (snow, sand) | floor per particle = h - sinkDepth x load, or a penetration spring; render must draw the dent | medium; unmeasured for folds at the foot rim |
| Slope or height field | replace every `y < 0` / `y = 0` with `y < h(x,z)`; friction in the tangent plane of n (today x/z only, :2245); tack lift measured above LOCAL ground; keep gravity's tangential part while supported (else a resting body never slides); pinned feet on h | large: 20 sites, the supported-gravity and tack rules were tuned flat |
| Place bounds | the corral is a circle about home: a LIFE body that walks away is glided back to home at 0.35 m/s after `moveTo(null)`. Needs `setHome(x,z)` or a place bound (circle or rounded box) independent of home | small |
Self-righting is toward WORLD up (:2633-2641, kUp 40): on a slope a body stands plumb, not normal to the slope (probably fine and cute).

## 2. Fingertips, body-to-body contact, props and zones
**Fingertips** (`substep` :2122-2197): two kinematic spheres per body (`Finger` :96-126), every particle inside is projected out radially
(:2169-2173) with static/kinetic friction (0.9 / 0.3, params.ts:165-178), feeding `react` (metrics.reaction), the volume blocking (:2046-2056)
and the contact fold limit list (`foldNear` 1.3 tip radii, up to 16 Gauss-Seidel passes :1677, params.ts:228; early exit when nothing folds).
Cost per tip is O(n) per substep plus the fold limit near it. A pressed body measured here 0.87 ms vs 0.69 at rest (detail 3).
**Body-to-body** (`collide` :1331-1414): called once per FRAME before step (shell `bodies.ts:171-175`), all ordered pairs (bodies.ts:101: N x (N-1)
calls). Broad phase: bounding spheres (`boundRadius` O(n) on BOTH bodies on every call, :1334, :1339). Narrow: each particle inside the other's
sphere finds the nearest particle via a 1024-slot hash (27 cells, :1354-1363), pushes both apart half each along the other's vertex normal,
inelastic, friction 0.9 (:1368-1378), then whole-body friction 0.5 and a rigid share of the push (:1383-1401). It is MASS-BLIND: a 1/8 piece
shoves a whole body exactly as hard as the reverse. `bump` when a contact starts (none for 72 substeps) and closes > 0.35 m/s (:1403-1410);
contact memory has MAX_OTHERS 16 slots keyed `bodyId & 15` (:276, :1405) and `bodyId` only grows (:722), so with more than 16 bodies ever made
two partners can share a slot and swallow a bump.
Cost measured here (dollop, detail 3): touching pair 1.64 ms per frame for both bodies vs 1.42 without collide (+0.22 ms per touching pair,
both directions); far-apart pair +0 ms; six detail-2 pieces with all-pairs collide 1.15 ms in total.

**Prop colliders.** Insert a "prop contact" pass right after the fingertip pass and before the table (between :2197 and :2217), on XP, per
substep, against a packed Float64Array of shapes the shell or a PropWorld fills once per frame:
- sphere (reuse the fingertip projection, friction from the place), capsule (closest point on segment, then sphere), box (closest point on an
  oriented box), plane (a wall or a slide: half-space, plus the ground model for the floor). Each: O(n) per shape per substep, after a
  bounding-sphere test against the body (`bR`), so a far prop costs ~nothing. Particles only: a prop thinner than the mean edge (about 0.07 m
  at detail 3 for R 0.5, 0.14 m at detail 2) can slip between particles (no triangle test exists anywhere).
- Two-way: accumulate per shape the mass-weighted correction (as `react` does, :2186) into an impulse and a moment about the prop's pivot; the
  prop integrates them ONCE PER FRAME after all bodies stepped (bodies step one after another, each with its own 6 substeps: there is no shared
  substep). One-frame lag is stable for heavy, damped props (seesaw, swing, springy cap with a damped spring); a light free ball needs a speed
  clamp. Put the touched prop particles into the fold-limit list (as the table does at :2238) or soft props will crease skin (untested).
- Seesaw (one-axis hinge): a box collider whose angle is a 1-DOF state (I, damping, limits); swing/pendulum: a capsule or box on a 1-DOF
  angle; springy cap: a sphere or box on a 1-DOF damped vertical spring. A carried body landing on them gives the impulse through the same pass.
- Zones (water, wind, warm, cold): a per-frame list of AABBs or spheres. Water: per particle below the surface add buoyancy (up accel x
  submerged share) and drag relative to the water velocity, in the predict loop (:1929-1933) or as one extra loop; whole-body share keeps the
  shape (like the corral), per-particle share bulges the skin (looks right for water fill). Supported gravity must be off in water (the body is
  not on the table). Wind: uniform acceleration or per particle on windward vertex normals (`VN`, built in `ensureContactData` :1426-1445).
  The float hover spring is NOT buoyancy (it pulls toward the world origin): do not reuse it for water.

## 3. Autonomous motion (hop, lean, wiggle) and what touch must override
**What exists.** `nudge` :1194-1202 (uniform velocity change, clamped 12 m/s). `moveTo` :1213-1220 and :1866-1873: a rigid translation of X
before the prediction, horizontal only on the table, at most 3 m/s x stiffness (0.1..4): the body GLIDES without deforming, friction never sees
it, it arrives without momentum, and it turns the corral off (:1858). `setFold` :1207 (goal toward a sphere, >= 0.4 s), `tremble` :1223
(17 Hz, 0.035 R: a shiver, too fast for a wiggle), `burstOpen` :1229-1247 (momentum-free radial kick 2.2 m/s + 1.25x overshoot). The goal is
rebuilt once per frame in `frameUpdate` :2357-2439 (GB = Q + fold + flat face, x burst and frac scale; QG = GB + memory + tremble; the edge rest
lengths follow QGN). Carry: `updateGrabs` :1787-1825 lifts at 1.15 x maxPull with a lone hand, `startCarry` :1831, kinematic follow at
CARRY_OMEGA 18 (:1877-1897), toss up to 6 m/s on release (:1101-1113).
**A hop (anticipation squash, then an impulse).** Add a driver `setSquash(s)` (or `pose`) that scales GB anisotropically and volume-preserving
(y x s, x and z x 1/sqrt(s)), eased like the fold. Then `hop(vx, vy, vz)`: a nudge plus, for its first ~10 substeps, glue x 0 and peelK x 0
(the fold already scales glue by (1 - fold), :2218, so the mechanism exists). Without that the same nudge leaves the table at very different
heights per family (glue x0.18..x1, peel damping 0.24..0.89 per substep). Height: v = sqrt(2 g h), g = 10 (params.ts:16): 0.1 m needs
1.41 m/s. Landing at >= 0.9 m/s (h >= ~4 cm) fires a `land` event (:155, :2285): the shell plays sounds and haptics on it, so autonomous hops
must be marked or kept under 4 cm, or they bypass the attention budget (D4). Gate: no fold over 120 deg, no second hop, for 12 families x
template and soft-corner genomes and for pieces at detail 2 (a new probe row in probe_species style).
**Lean toward a point.** A small shear of the goal (top shifted toward the target by <= 0.1 R), not a rotation: the rotation is extracted
against the REST shape Q (:1944, not QG), so a rotated goal reads as a tilt and the self-righting torque (kUp 40) fights it. Unmeasured.
**Wiggle.** A new low-frequency goal mode (side-to-side shear at 2-4 Hz, amplitude <= 0.05 R); `tremble` is fixed at 17 Hz.
**Walking.** `moveTo` slides; for a cute gait chain hops (squash, hop with a horizontal part, land) and use `moveTo` only for long glides.
**Pieces.** smOmega x 1/cbrt(frac) (:574), restRadius x cbrt(frac); glue scales with R. Detail-2 pieces have few foot particles (whole species
at detail 2: 1 to 31, measured here; slow-rise capnap has 1, so `supp` stays low and it drifted 1.2 mm with kinetic 0.0014 over 2.5 s).
**What touch must override.** Today NOTHING in physics cancels a driver on touch: `moveTo` keeps gliding under a pressing finger (only the
corral checks touch), tremble, fold and burst stay on; `fingerDown` cancels only a grab on the same id (:927). Add one internal gate: while
`fingers > 0 || grabbed || carried`, the LIFE drivers (moveTo from LIFE, squash, hop, lean, wiggle) are paused and eased out. Keep ceremony
drivers as they are (the shell owns those).

## 4. Sleeping and lighter background bodies
**State that would freeze:** X, V, XP, GOAL, qr, cx..vcz, acc (time accumulator), simTime and subIdx (or let them run: subIdx parity schedules
the Laplacian, :1999), metrics (kinetic forced to 0). **Must be finished before a body may sleep** (all are timers or easings in the code):
fingers down or retracting, grabs, pinCount / pinHold (0.5 s), `carried`, `moveOn`, fold != target, burstO > 0, trembleAmp > 0, neck,
fracDur > 0, flatK > 0 (a chunk's face rounds over ROUND_TAU 2 s, putty 6 s, :210), tableFoldT (1.5 s, :172), the tip-fold wake (180 substeps,
up to 6x for memory families, :699), air bleed vt < 1 (returns over volInTau, slow-rise 1.45 s), slosh offset, strands. Memory families:
MEM heals over memHealTau (putty 40 s, mochi and beads 2.5 s): either sleep only after MEM converged or keep `memoryStep` running while asleep.
Float mode never rests (the bob, :1923): no sleep in float mode, or freeze the bob.
**Rest test:** `metrics.kinetic` < 0.02 (the G1 settle bar) is INTERNAL energy only (`dampPass` :2651-2653, normalised by 0.08, :2792): a
rigid drift reads ~0, and a `moveTo` glide is not in V at all. So also require |vc| < ~0.01 m/s, grounded, and no driver flags, for ~0.5 s.
**Wake on:** fingerDown, grab, nudge, moveTo, any driver, gravity toggle, setFrac/setNeck, reset; a contact from an AWAKE body (collide must wake
the sleeper and skip sleeper-sleeper pairs); a prop or zone that starts touching it; a ground or material modifier change.
**Saving:** about 0.69 ms per resting detail-3 body (measured here), plus its collide calls. Deterministic if the decision is a pure function of
state; but a sleeping run's stateHash differs from a never-sleeping one, so keep sleep opt-in and re-baseline any hash row that turns it on.
**Detail 2 for whole squishies.** Possible today: `new SoftBody(g, { detail: 2 })` (contracts.ts:198, softbody.ts:529-531). Measured here: 162
particles, 0.17 ms per resting step vs 0.69 ms (x4.0); construction 1.7 ms vs 5.2 ms (warm; first call 6 / 29 ms). Behaviour: rests without hop
or creep on all 12 families (one per family, 3 s); bendK x0.25 (:757), hinge limit raised by 0.1 to the 0.97 clamp (:760-761), tip speed
unchanged; Mtot = n (masses mean 1, shape.ts:216), harmless since collide is mass-blind. Cost: thin features (peaks, ears, horns) are coarse and
NOT gated at detail 2 (fold, press, rub, pull and hop rows all run at 3 or 4); the renderer refines the sim mesh (not checked how it looks).
**Run-time detail change:** impossible in place (every array is sized in the constructor, :583-779). A swap means building a new body at the
same spot (`piece: { frac: 1, chunk: false, at }`) and handing it to the stage: it starts at its rest shape, upright (rotation and dents are
lost), allocates (a GC event), and the render swap step is a known luminance tick. Only sensible while the body is at rest.

## 5. Run-time material modifiers (cold, warm, soaked, sandy)
| Parameter | Where read | Safe to scale at run time? |
|---|---|---|
| tableMu, glue, groundDamp | per substep, `this.p` (:2218, :2275) | YES now (write the field); grip, sand, ice |
| fingerFriction | per substep (:2138) | YES now |
| edgeAlphaT, edgeHarden | per substep (:2086) | YES now (stretchier when warm), keep within the family band |
| strutMin / strutAlphaT, creaseLo/Hi/Gain, bendFloor | per substep | technically yes; do not (anti-fold tuning) |
| maxPull, squashDepth, pinHold | read at grab / fingerDown / release | yes, takes effect at the next touch |
| smOmega (stiffness) | baked into smK / smW2 (:749-753) BUT K is rebuilt every substep from smW2 (:1963) | one field away: make smW2 mutable. Keep smOmega 12..40 rad/s (params.ts:99-100: above ~40 a squash launches the body) |
| bendK | baked (:757) but read per substep from `this.bendK` | one field away |
| intDamp, affDamp, intDamp2, drag | baked to dampInt/dampAff/dampQ/dragF (:763-766) | small change (mutable fields); ice needs drag |
| volKappa (compressibility), air bleed, memory, slosh, jam | baked (:688-700, :768) | no (switches like memOn, bleedOn decide code paths) |
| edgeSoftStrain, peakSoft, struts geometry, hinge limits | baked into ESOFT, softW, S3, hingeLim | no |
| mass / "heavier when soaked" | masses fixed, GRAVITY a module constant (params.ts:16), and resting bodies have no gravity anyway | add a gravity scale for airborne / water only; or say "soaked" with lower hop height and buoyancy |
Rules: write through a small Float64Array of modifiers, not object fields (V8 representation changes deopt the solver: the `settleDoubles`
note :224-230; `this.p` is not passed through it). Ease every change over >= 0.3 s. Any scaled family must pass the hop, press, rub and pull
rows again (the round-2 verifier found 12 of 50 species launching after a retune: VERDICT.md).

## 6. Determinism, zero allocation, perf, probes
**Rules (header :3-7 and comments throughout).** No Math.random / Date / DOM / three; seeded `mulberry32` (:781); fixed substep H = 1/360 with an
accumulator (:863-884, params.ts:8-13); fixed loop orders; `reset()` bit-identical to a new body; nothing keyed on `debug` counters. Zero
allocation per frame after JIT: typed scratch only, no object literals or closures in hot paths, no double passed to or returned from a large
non-inlined function (each one is a HeapNumber), no small-int/double mixing in one variable (`settleDoubles`, INT_FIELDS :238). Events allocate
one object only when emitted (cap 128 per step, rate limit 0.05 s per kind and finger, :2690-2700). probe_cut measures 0 B per 120 frames for
collide + setFrac + rounding (:473-499); a neck eased every frame is a KNOWN 0 or ~42 KB.
**Perf numbers.**
| What | Number | Source |
|---|---|---|
| One whole body, loaded machine | 1.6 to 2.3 ms per frame (starter 1.63; most families 1.8 to 2.3; bar G1p 2.0 ms mean, p99 5 ms) | HANDOFF.md:114, probe_softbody.ts:2018-2019 |
| G1p workload alone | 1.486 ms; 1.681 ms in a verifier run; 2.37 to 2.40 at load 18 | impl_reports.md:362, VERDICT.md:105, impl_reports.md:69,131 |
| 5 whole bodies with collide | about 10 ms per frame | HANDOFF.md:116, DIRECTION.md section 4 |
| 6 pieces vs 2 whole (physics X08) | bar ratio <= 1.0 | probe_cut.ts:470 |
| 6 pieces vs 2 whole (render, whole frame) | x1.32 to x1.45 against a 1.5 bar | VERIFY_RENDER_A_R1.md:222 |
| Resting body, quiet machine | 0.69 ms (detail 3), 0.17 ms (detail 2); pressed 0.87 ms | measured here |
| Touching pair, collide | +0.22 ms per frame for both directions (detail 3); far pair +0 | measured here |
| 6 detail-2 pieces with all-pairs collide | 1.15 ms total | measured here |
| warmUp() | 1.17 s here (0.8 to 1.4 s quoted, :1147) | measured here |
**Probes.** Each file builds a `rows` table through `add(what, value, limit, pass)` and exits 1 on any FAIL (probe_softbody :1697 also has a
gate column; probe_species :362; probe_families :168; probe_cut :35). probe_softbody has modes (`--quick`, `--round5[=rub,slide,...]`,
`--hostile-only`, `--families-hostile`, `--long`, :52-67) and a worker pool (`runPool(jobs, 4)`): the full run is a heavy job. probe_species
loops 50 species x 3 genomes; probe_families the 12 families on the dollop shape; probe_cut is the CUT / B2 / B3 table. `run_probes.ts` runs every
`probe_*.ts` in sequence. New PLAYGROUND rows fit best in a new `_harness/probe_playground.ts` (ground per place, props, zones, hop, sleep, detail-2
wholes) with the same `add()` table, plus family-sweep rows (hop, ground) in probe_species style; keep each runnable with `--quick`.

## 7. Known open physics issues that PLAYGROUND would make worse or must avoid
- Pull into the ground (LOCK.md section 4): a lone finger dragged straight down folds 5 of 12 species to ~180 deg, putty stays creased, twangle
  turns inside out. Slopes, sink and ledges make "below the ground" far more common: the grab and carry floor fix must use the ground query.
- Cut neck swell on putty / slow-rise / firm silicone (STATUS KNOWN OPEN; render stopgap in stage.ts framingFor).
- Two-handed pulls crease; rare creases: 2 of 612 full pulls, 4 of 449 rubs, slime / putty / kneadle rest creases; probe_species 22/31 (HANDOFF.md
  open issues). Props pressing the skin are new contacts outside the fingertip fold limit: they need the same fold-limit treatment.
- Perf already at or over the 2.0 ms bar per body; 5 bodies ~10 ms. PLAYGROUND must rely on sleep and detail 2, not on more bodies awake.
- Plastic memory captures repeated bursts with fingers down (HANDOFF): repeated autonomous squash/hop on putty could set a permanent dent.
- Pop dome's bistable snap is not built (materials.ts:339-342 `planned`): do not promise a "pop" reaction in places.
- collide is mass-blind and per frame; bump memory aliases past 16 bodies (:276, :1405); the float hover pulls to the world origin.
- `land` events fire for every drop over 0.9 m/s: autonomous hops and prop launches will reach audio and haptics unless filtered.

## Extension points
| # | What to add | Where | How hard | Risk |
|---|---|---|---|---|
| E1 | Ground query (h, n, mu, slip, sink, tack) replacing y = 0 | softbody.ts table pass :2217-2291 + ~20 sites (section 1) | large | high: supported gravity and tack were tuned on a flat plane; re-run every hop/fold row |
| E2 | Flat-ground modifiers only (grip, ice, tack) | write p.tableMu / p.glue / p.groundDamp; mutable dragF | trivial to small | low; ice needs drag too |
| E3 | `setHome(x, z)` / place bounds for the corral | matCorral :1600-1620, homeX/homeZ :344 | small | low |
| E4 | Prop contact pass (sphere, capsule, box, plane), packed Float64Array, impulse accumulators | new pass between :2197 and :2217 | medium | medium: new creases at prop edges; thin props tunnel between particles |
| E5 | 1-DOF props (seesaw, swing, springy cap) integrated per frame from E4 impulses | new pure module `src/physics/props.ts` | medium | one-frame lag; clamp speeds |
| E6 | Zones: water (buoyancy + drag, supported gravity off), wind | predict loop :1929-1933 or one extra loop | medium | float/slosh interplay (slosh pushes only when floating, :2346) |
| E7 | `setSquash` goal driver + `hop()` with glue and peel suspended | frameUpdate GB :2391-2397, table pass :2218, :2275 | medium | per-family hop height; land events |
| E8 | Lean (goal shear) and low-frequency wiggle drivers | frameUpdate | small to medium | righting torque fights a rotation; unmeasured |
| E9 | Touch gate pausing LIFE drivers | substep start :1849-1853 | small | must not touch ceremony drivers |
| E10 | Sleep (rest test, freeze, wake rules, sleeper-pair skip in collide) | step() :863, collide :1331 | medium | hash rows change; memory and timers must finish first |
| E11 | Detail-2 whole bodies for the background, rebuild-swap at rest | constructor opts.detail; shell swap | small (physics), medium (render) | ungated thin features; swap tick |
| E12 | Runtime stiffness / damping modifiers through a Float64Array | smW2 :753, bendK :757, damp fields :763-766 | small | must stay in the family band; re-gate hop/press |
| E13 | Mass-aware collide share, bump memory beyond 16 | collide :1368-1401, :276 | small | changes tuned stack rows (B2) |
| E14 | probe_playground.ts | _harness | medium | heavy if it sweeps 50 species: keep --quick |

## Constraints and numbers
- H = 1/360 s, 6 substeps per 60 Hz frame, MAX_DT 1/20 (params.ts:8-13); g = 10 m/s^2; R = 0.4 to 0.625 m (shape.ts:68).
- Detail 3 = 642 particles, detail 2 = 162, detail 4 = 2562 (mesh.ts:2); pieces under frac 0.35 use detail 2 (:203); no piece under 1/8 (:202).
- Mat: dead zone 0.6 m, rim 2.5 m about home; play-mat disc 3.5 m (params.ts:69).
- moveTo <= 3 m/s x stiffness 0.1..4; nudge <= 12 m/s; toss <= 6 m/s; particle speed clamp 14 m/s (:158-159, :194-195, :220).
- Fingertip radius 0.2 to 0.45 R, floor 0.12 R above the table, speed cap 5.5 m/s (params.ts:161, 203, 234).
- Events: land >= 0.9 m/s, bump >= 0.35 m/s and 0.2 s since the last contact with that body; 0.05 s per kind; 128 per step.
- Budgets (DIRECTION.md D6/D7, section 4): a body 1.6 to 2.3 ms; the shell refuses more bodies over a 30 ms frame average.

## Open questions for the designers
1. Slopes: do any of the four places really need a height field (a dune, a snow slope, a slide), or can every place be flat ground plus props
   (a slide as a tilted box collider)? Flat ground with modifiers is E2+E3 (small); a height field is E1 (large, high risk).
2. Should a squishy on a slope slide down by itself (needs gravity kept while supported) or stay put like today?
3. Hop height cap: under 4 cm stays below the `land` event; higher hops need a "quiet land" flag for autonomous jumps. Which?
4. Which props must move (two-way) and which can be static? A one-frame-lag prop is fine for a seesaw and a swing; is a freely rolling ball needed?
5. Water: float on top (whole-body buoyancy, shape kept) or sink in and bulge (per particle)? Does every family float, or do some sink (beads)?
6. Background bodies: detail 2 only while asleep and far from the camera, or always for non-party characters? Is the upright pop on a swap acceptable?
7. Character caps per tier assuming sleep: e.g. awake whole bodies <= 3 (low) / 4 (med) / 5 (high), the rest asleep or detail 2 (please set from measurements).
8. Modifiers: which of cold-stiffer, warm-softer, soaked, sandy are physics (felt) and which are only looks and sounds? Stiffness changes cost re-gating.

## Not checked
No browser run, no full probe suite, no render look of detail-2 wholes, no chunk pieces at rest, no fold metering of any proposal above, no
`foldLimit` cost under props, no float-mode or slosh behaviour in water, no hop experiment. My timings are one quiet run, not best-of-many under load.
