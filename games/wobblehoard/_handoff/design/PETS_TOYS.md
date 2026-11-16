# PETS_TOYS: real toys and play (designer memo, 2026-10-08)

Lens: toy objects in the 3D world with the squishy. Read-only on the game. Every number was produced this session by scripts in `scratchpad\pets\toys\sim\` (a COPY of `src/physics` with the prototype patched in). The machine was loaded (CPU 100%), so timings are +-30%.

## 1. Decision: toys are NOT SoftBody instances; they are rigid colliders in a small ToyWorld, and the soft body gets one new pass

| Option | Verdict, with evidence |
|---|---|
| A. Toy = tiny SoftBody through `collide()` | Rejected. `collide()` is SoftBody-vs-SoftBody only (`softbody.ts:1338`). A 162-particle ball on a dollop: 0 mm penetration, but it **barely bounces** (apex 5 to 8% of the drop) and **cannot roll**: the weeble torque (`softbody.ts:2633-2641`) rights it (tilt back to 0.2 deg). Host plus ball 3.5 to 9.9 ms/frame under load (host alone about 2). |
| B. Rigid toys, soft body contact **once per frame** like `collide()` | Rejected. Skin pushed 47 to 60 mm into the ball (4.5 m/s is 12 mm per substep; a frame-rate pass sees only the end pose). |
| C. **Hybrid (chosen):** rigid toys (sphere, capsule, box, torus) in a `ToyWorld` at 360 Hz; each is an SDF collider; the soft body projects its skin out of it **inside every substep**, like a fingertip, and books the momentum back on the toy | Prototype: `solids.ts`, `toyworld.ts` (6 DOF, table, restitution, friction, rim), `solidPass` / `triPass` / `reseatSolids` in `softbody.ts`, and `launch()` (a hop). |

How C works: `beginFrame` publishes each toy's pose at frame start and end; each body interpolates it per substep, moves its skin radially out of the SDF (skin 4 mm), applies Coulomb friction against the toy's motion, adds the touched particles to the fold limit's list and re-seats them there; `commit()` applies the booked impulses. Held toys are kinematic.

## 2. Feasibility numbers (prototype, shipped tree untouched)

| Test | Result |
|---|---|
| Ball r 0.15 m (mass 60 and 120) dropped from 2.2 m (impact 4.5 m/s) on a dollop, in-substep pass | Skin vertex inside ball **0.0 mm**; triangle-level overlap max **5.9 mm**; host fold max **70 deg** (rest shape 50; the contact fold limit is 110), **0 frames over 120**; safetyResets 0; booked peak impulse 89 to 101 against the ball's m v of 270 to 540 (no momentum invented). |
| Same, six more families (4 s runs) | Triangle overlap 0 to 3.2 mm (puddlo 0, boingle 0, wrigglo 1.6, crumbit 2.7, kneadle 3.2), fold 37 to 56 deg, **0 frames over 120 in all.** |
| Rebound off a 1.2 m drop (family character comes free) | puddlo 33 cm, boingle 28, dollop 17, crumbit 9, capnap 7, kneadle 5.5, wrigglo 0 (swallows it). |
| Stick (capsule, held, 1.2 m/s, 22 cm deep), particles only | Tip poke: the **tip slips between particles**: overlap 44 mm (r 5 cm), 33 mm (r 3.5 cm). |
| Same with the **triangle pass** (edge midpoints and centroid, pushes the three vertices) | Tip, r 5 cm: **0.1 mm**; r 3.5 cm: 9.6 mm; r 2.5 cm: 23.9 mm. Sideways: **0.0 mm**. Fold 51 to 60 deg, 0 over 120. **Rule: stick radius at least 5 cm (0.1 R) at detail 3**; thinner needs a segment-vs-edge test (not built). |
| Ring (torus R 0.2, tube 0.045) dropped on peaks | Dollop, centred: the ring **stays around the peak**; offset 6 cm, spirelo, twangle, hooplet: it slides off and rolls away; plumpet: rests on top. 0.0 mm skin inside the tube, fold at most 64. |
| Squishy bats a resting ball by hopping into it (hop 1.2 to 2.0 m/s, ball 12 to 30 cm away, mass 40 and 90) | Ball leaves at **0.6 to 1.8 m/s**, direction error **0 to 3 deg**, rolls 18 to 95 cm in 4 s (putty least, silicone most); host fold 53 to 68, 0 skin inside the ball. This is the fetch "nudge it back". |
| **A hop needs a new body call.** `nudge()` alone, 10 species, v_y 2.2 to 3.8 | Stiff or tacky families barely leave the mat (chunkle, boingle, dimpla, twangle rise 1 to 6 cm and emit no `land`): the tack layer (`softbody.ts:2218-2250`) pulls the foot back. With `launch(v)` = nudge + tack released for 54 substeps (0.15 s): **every family rises 12 / 20 / 35 cm and travels 19 / 30 / 48 cm** for v_y 1.6 / 2.2 / 3.0, `land` event 0.3 to 0.5, fold at most 72, settle 1.7 to 3.5 s. |
| Perf, CPU ms/frame, medians of 3 interleaved rounds (host alone **2.03**) | Ball far away 1.98 (culled, +0.0). Ball resting on the host 2.19 (+0.0 to 0.2). Three toys near the host 2.76 (**+0.57**). Stick pressed into the flank with the triangle pass 2.29 (+0.1). The 2.0 ms bar is already marginal (STATUS: 1.8 to 2.3). |
| Determinism | Soft-ball run through `collide()` twice: hash identical. The rigid path is fixed-step arithmetic only, **but I did not hash-test it**. |
| Allocation | 0.16 to 1.0 MB of heap over 300 frames against 0.14 MB for the host alone. **Not proven zero**: `ToyWorld.plane()/rot()` still pass doubles; run the shipped allocation row on the port. |
| Not measured | Browser/render; toy-vs-toy contact; two bodies around one toy; hostile input (`WORLD_LIMIT` guards needed); gripping. |

Prototype cost in minified bytes (rolldown): softbody additions (solid pass, triangle pass, re-seat, `launch`, `solids.ts`) **+5.2 KB**; `toyworld.ts` 7.6 KB including `solids.ts`, so about 5.4 KB more. Physics total about **11 KB**.

## 3. Mechanics shared by all toys

- **Shelf and move.** The dock's Toys shelf (UI.md decision 7) lists toys from data. Drag one onto the mat: the pointer ray meets the mat plane (`rayPlane`, `camera.ts`) and the toy follows 0.4 m above it. Release throws with the pointer's 40 ms smoothed velocity, capped at 6 m/s (`TOSS_MAX`). Tap a toy to pick it up again. Keyboard: Tab to a toy (named button), arrows move 10 cm, Enter picks up or drops, Space tosses toward the squishy. "Put away" returns it to the shelf. Nothing breaks, vanishes or expires; past the mat rim it bounces back.
- **How many out:** low 2, med 3, high 4 (like `MAT_LIMIT`, `mat.ts:22`), refused when the frame is busy; the physics holds 6 solids.
- **Looking and wanting.** The face follows `pointerNdc` (`face.ts`); while a toy moves the shell feeds its projected position instead. A want is an invitation (look, bob, one hop); it never nags, times out or scolds, and no toy touches any pet need.
- **Hop, bat, fetch.** Fetch: the player throws; the squishy looks, crouches 0.2 s, hops toward it (`launch`), the hop bats it back toward the player's edge of the mat (measured direction error 0 to 3 deg). The shell aims the hop from the toy's position and the camera side. Tug (stick): the player holds one end, the squishy's near skin is `grab()`-attached to the stick tip (existing API; the pull stretches a lobe, and release springs back). **Risk, not built:** a `grab` emits `grab`/`snap` events that pay the meter (`feedback.ts` twin flag precedent) and uses one of the two finger slots; a toy-driven grab needs a no-pay flag and a third internal slot.
- **Carry and clipping.** No mouth, so "picking up" = the toy is spring-attached to a surface anchor while the skin wraps it through the same SDF pass (no clipping). Designed, not measured.
- **Economy.** Toys pay **0 SP** (moving, fetch and play pay nothing, like cutting and stacking: FUN.md section 2, point 5). No farm path, so `sim_economy.ts` was not needed; squeezes and stretches pay by the existing rules.
- **Calm and sound.** Calm: bubble count x0.3, no shake on bumps, hop height x0.6. Toy sounds sit under master and mute, use the `BumpLimiter` token-bucket pattern (`interact.ts`), at most 4 toy voices of 24, follow the pet-voice off switch, and caption discrete events in the live region.
- **Render.** Procedural three.js primitives, one draw call each, no images; decal shadow (`decals.ts`).

## 4. The toys (18). Build cost: S = days, M = a week, L = more. "Likes" = families that approach and play longest.

| # | Toy | What it is and how it behaves | Squishy does | Sound (all synthesized) | Cost | Likes |
|---|---|---|---|---|---|---|
| 1 | **Ball** | Sphere r 0.15, restitution 0.72, rolls | Fetch: looks, hops, bats it back; sits on it (round species) | Soft thud pitched by size (a `bump` variant) | M (pays the ToyWorld) | jelly gel, firm silicone, pop dome |
| 2 | **Stick** | Capsule r 0.05 half length 0.35, triangle pass | Tug (lobe grab), fetch, taps it | Dry wood click + 400 to 700 Hz tone | M | sticky stretch, slime goo, gummy |
| 3 | **Squeaky duck** | Sphere plus capsule beak, hollow | Squished by the squishy on landing; squeaks | Pitch-swept formant squeak 700 to 1100 Hz, 90 ms | S | water fill, marshmallow |
| 4 | **Bubble wand** | Held kinematic ring; blows bubbles (existing `bubbles` FX) | Watches, pops them, giggle-wobble | `bubble()` stream plus `pop()` | S | water fill, bead squeeze |
| 5 | **Little drum** | Dome, box solid; struck by landings | Hops on it; wobbles to the beat (small beat hops) | Membrane sine 140 to 90 Hz plus 30 ms noise, 3 pitches by spot | S to M | pop dome, bead squeeze |
| 6 | **Feather** | Kinematic floaty (drag, wind sway) | Tracks it, follows, bats it up | Air-noise swish | S | marshmallow, slow-rise |
| 7 | **Spinner** | Disc with angular velocity; flicked | Spins it with a hop, watches | Held whirr tied to spin rate | S to M | bead squeeze, pop dome |
| 8 | **Blocks** | 3 boxes; stack, topple | Knocks the tower over; pushes | Wood clacks | L (box-box stacking) | putty, gummy, mochi |
| 9 | **Bell** | Hung sphere, swings | Bats it and listens | 3 inharmonic partials (the Rare "bell cluster") | S | gummy, jelly gel |
| 10 | **Trampoline** | Spring plate the squishy lands on | Bounces higher, wobbles | Spring "boing", glide with vibrato | L (foot rules assume a flat mat) | firm silicone, jelly gel |
| 11 | **Ramp** | Static wedge | Slides down or rolls the ball | Rumble by speed | L (foot, gravity, tack are flat-table) | slime goo, sticky stretch |
| 12 | **Ring** | Torus; ring toss, rolls | Wears it on its peak (peaked species only, measured) | Ceramic clink, 2 partials | M | gummy, mochi |
| 13 | **Plush** | Compound capsule and sphere, fuzzy render | Hugs it (leans, soft contact), sleeps on it | Muffled thump | M | slow-rise, marshmallow |
| 14 | **Kite** | A diamond on a string, wind | Watches, tugs the string | Wind flutter (held noise) | M | sticky stretch, water fill |
| 15 | **Yo-yo** | Disc on a 2-segment string | Follows the bob | String whirr | M | mochi, slime goo |
| 16 | **Paddle** | Held kinematic box | Hit-the-ball game with the player | Slap | M | putty, firm silicone |
| 17 | **Cushion** | Soft box | Sits, settles | Cloth rustle | S | sleepy families |
| 18 | **Firefly jar** | Drifting light | Chases the glow | Glass chime | S | aurora species |

## 5. First five and cost

**Build first:** (1) Ball and (2) Stick, because the owner named them and they carry the whole physics (ToyWorld, SDF pass, triangle pass, `launch`); (3) Squeaky duck (sound-first, nearly free once the ToyWorld exists); (4) Bubble wand (no collision, reuses the bubble FX and the pop voice, calm and cheap); (5) Little drum (shows the soft body: beat hops and wobble). Then feather, bell, spinner, cushion, ring, plush; blocks, trampoline and ramp last.

**Bytes (estimates, except physics which was measured):** physics about 11 KB; toy meshes and shelf icons about 8 KB; toy behaviours (fetch, tug, looking, shell glue) about 12 KB; five voices at the 2 to 2.5 KB each that `interact.ts` costs (12 KB for five) about 11 KB. **First five about 42 KB. All 18 about 80 KB.** The gate: G0 is 1229 KB with 1143 KB used, 86 KB free, and the UI overhaul alone needs about 90 KB, so **there is no room for toys: the gate has to rise** (UI plus first five = about 1275 KB; UI plus all toys = about 1313 KB). That is the owner's decision.

**Perf:** up to +0.6 ms per frame with three toys touching the host, +0.0 with none near it, on top of a bar that is already marginal. Keep to 3 toys near any body and cull by the bound radius (already in the prototype).

**Honest gaps:** node-only prototype (no render, browser, fuzz or independent check); restitution and rolling constants are guesses; blocks, trampoline and ramp break the flat-table assumptions in the foot, tack and supported-gravity code and need the physics owner first.
