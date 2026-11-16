# PG_RENDER running report (PLAYGROUND, render lane)

Brief: `_handoff/briefs/PG_RENDER.md` (revision 4). Started 2026-11-16 10:22 UTC (container clock) at HEAD 1965cd2c2. There had been no render-lane
change since 1e5a1159 (`git diff --stat 1e5a1159c HEAD -- src/render _harness/browser_render.mjs _harness/renderview` was empty), so this was a
fresh lane. Scope of this run: build-order step 0 and slice S0, then whatever of S1 needs no other lane. Port 5364. Scratch:
`/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_render/` (run logs `run1..6.log`, `size.mjs`).

**If you are the next engineer:** read "Status", then "Not done" and "Requests". Do not redo a row marked done. Re-run the checks with:
`npx tsc --noEmit -p tsconfig.json`, `node _harness/renderview/pg_node_checks.ts` (light, under 1 s), and
`node _harness/browser_render.mjs --only=emote,pose,homeview,place` (one heavy job, about 6 minutes, port 5364).

**Round 2 (2026-11-16 15:48 to 19:xx UTC) is at the END of this file ("Round 2"): read it first; the round-1 tables below are history.**
Round 2 re-run commands: `npx tsc --noEmit -p tsconfig.json`, `node _harness/renderview/pg_node_checks.ts` (35 rows),
`node _harness/browser_render.mjs --only=place` (about 9 minutes, all four places) and `--only=pose` (RD-05, RD-06, RD-11).

## Status (end of ROUND 1: tsc clean; node 28 ok / 2 FAIL (RD-17 twin rows); browser 23 ok / 3 FAIL (RD-06, RD-17 x2), 0 console problems)
| # | Step | State | Evidence |
|---|---|---|---|
| 0 | read the brief, the specs (PB 2, 7, 9, 13, 14, 18, 23; PLACES 1, 2.3, 3, 4.1, 4.2; LIFE 5.1, 7, 9, L7, L8; UI tokens), maps/RENDER.md, the SHELL_4 seams | done | |
| 1 | S0: faces (`setBodyGaze`, 5 eyes-only expressions), render pose + breath (vertex stage + eye anchors), sleep skip, `lite` mesh, eye depth fade, autonomy framing, `visibleTable`, `setObstacles`, `bodyScreenPoint`, `bindProps`, emotes, Home's things | done | files below |
| 2 | first-load size: 33.9 KB at first, so the bubbles and Home's things moved into a lazy render module `lifelook.ts` (14.3 overflow step 1) | done | bytes |
| 3 | node checks `_harness/renderview/pg_node_checks.ts` (N1 visibleTable projection, N2 bubble contrast, N3 bubble layout and motion, N4 pose, N5 Home's things, N6 place framing) | 28 ok, 2 FAIL (N6a/b = RD-17) | |
| 4 | browser sections `emote`, `pose`, `homeview` (scenarios `_harness/renderview/pg.ts`) | ok but RD-06 | table below |
| 5 | S1 step 14 body looks: `uLook` (frost, wet, sand, toast), `uHeat`, `setBodyLook`, `setHeatPoint` (sand and snow are carried for S2, not drawn) | done; toast still subtle by eye | `fn02_fireplace.png` |
| 6 | S1 step 11 `setPlayBounds` (`placeview.ts` fit, the stage's place camera, P8 orbit / zoom limits) | done; **RD-17 bars not met (spec conflict)** | below |
| 7 | fixes from judging the shots: larger group count dots; eye fade floor 0.25 -> 0.15 behind a clear jelly (0.25 still read four-eyed) | done | |
| 8 | S1 steps 10, 12, 13: the place host and props kit `place.ts` (away chunk), the cabin `places/hearthlog.ts` (both layouts; positions from PG_DATA's `place_hearthlog.ts`), first-load seams (`Table.setSky` / `setFelt`, `EnvHub.setPanels` with the old cube disposed, the `Particles` normal-blend twin, `JellyMaterials.setLight` with the white balance re-derived per place key), `loadPlace` / `setPlace` under the ScreenFx snapshot crossfade, movers posed from `bindProps` | done | |
| 9 | first-load size again (18.4 KB): the swap, light and fit logic moved from the stage into the away chunk | done: **15.5 KB of 16** | bytes |
| 10 | browser section `place` (`pg.placeShot`, `fireplace`, `placeSwaps`); four look passes judged by eye (firelight key low at the hearth with a wide cone; plum and dusk logs and dusk floorboards, browns from amber-cream mixes, since amber-plum mixes slide through red; the swing beam a round log across the room, V ropes; the window under the beam; a golden toast) | done | `_shots/render/pg/cabin_*.png`, `fn02_fireplace.png` |
| 11 | final sweep `--only=emote,pose,homeview,place` (run 6) | 23 ok / 3 FAIL | `run6.log` |

## Browser results (run 6, the final sweep; real soft body, quality med, SwiftShader)
| Row | Phone 390x844 | Desktop 1280x800 |
|---|---|---|
| lazy `lifelook` loads | ok | ok |
| RD-04 8 bubbles in ONE draw call | ok | ok |
| RD-12 eyes behind a clear jelly (dollop in front) are depth-faded | ok (0.15, 0.40) | ok (0.15, 0.15) |
| RD-14 with autonomy framing on, a body sliding and hopping by itself moves the camera | ok: 1.5e-8 m (off: 0.600 m) | ok: 3.0e-9 m (off: 0.246 m) |
| RD-16 `visibleTable` vs the rendered frame, n 1..5 x scale 0.8 / 1.0 / 1.25 (15 cases) | ok: worst 0.0000 m | ok: worst 0.0000 m |
| RD-16 every slot centre inside the corral rectangle | ok (0 out) | ok (0 out) |
| RD-16 every shown Home thing in view (PLACES 4.1 spots, the ASSUMED insets) | ok, all in view | ok, all in view |
| RD-11 a leaning, swaying sleeper: the bead at its posed anchor | | ok 0.000 px (the anchor uses the vertex stage's own formula: node N4e) |
| RD-05 4 asleep vs 4 awake, CPU update; fine-mesh updates while asleep | | ok: 1.98 vs 0.03 ms, x0.015; 0 |
| **RD-06** 6 pieces (chunks `lite`, 2562 vertices) vs 2 wholes | | **FAIL x1.299** (same run, chunks not lite x1.352; run 1: x1.402 vs x1.548). Bar 1.2 |
| RD-01 the cabin loads and is set | ok (tall) | ok (wide) |
| RD-08 the cabin's set and props, no body out | ok: 29 calls, 7 370 triangles | ok: 29 calls |
| RD-13 play-area mean linear luminance (bar 0.35; PLACES 4.2: about 0.20) | ok 0.066 | ok 0.069 |
| **RD-17** a 1 m squishy, measured on the live camera | **FAIL** 80.1 front / 69.0 mid px | **FAIL** mid 118.3 px (front 146.1) |
| RD-07 10 swaps Home -> cabin -> Home (+-2) | | ok: programs 16 -> 17, textures 4 -> 4, geometries 21 -> 22 |
| console errors / warnings / failed requests | 0 | 0 |
Shots (`_shots/render/pg/`): `icons_{phone,desktop}_{0..3}[_calm].png` (the 24 icons and the styles), `faces_*.png`, `eyes_through_*.png`,
`pose_a/b.png`, `home_{phone,desktop}_n{1,3,5}.png`, `cabin_tall_phone.png`, `cabin_wide_desktop.png`, `fn02_fireplace.png`.

**My own judgement of the shots (a verifier must redo it):** the bubbles read cleanly (cream disc, plum line, tail, think dots, double outline,
badge, still dot); some icons are small inside the bubble, and the giggle squiggle reads weakly. The faces are eyes only (RD-10): happy arcs,
sleepy heavy lids, surprised wide with small irises, shy looking down and away, proud half-lidded. The eye fade removes the four-eyed read
except a faint hint at 0.15. Home's things stand where PLACES 4.1 puts them, in view; on a phone with 3 out the Felt Ball covers the front body's
lower half (that is its data spot). The cabin reads as an evening log cabin (plum and dusk logs, dusk floorboards, hearth fire with embers, the
snowy window, swing, kettle, rocker, yarn ball, braided rug, basket). Its weak points: mean luminance 0.07 against the design's 0.20 (the room
interior is lit; the dark band above the walls and the dark floor edges pull the mean down); on the tall frame a black band above the room;
the marshmallow's toast reads warm beige, not clearly golden (FN-02 may want it stronger); the rocker and wedge are plain boxes.

## RD-06 (FAIL x1.30): analysis and options (not done)
The lite mesh cuts a chunk's CPU mesh work (2562 vs 5762 vertices), but each piece still costs about 10 draw calls (jelly, core blob and halo,
two decals, FX) plus its fragment work, and 6 x 2562 = 15.4k fine vertices is still 1.34x the 11.5k of two wholes. Options, render-only, the bar
stays 1.2: a smaller lite mesh for pieces under 1/4 volume (frequency 12: 1442 vertices); one instanced draw for every piece's two decals; no
core halo quad on a lite chunk (its glow stays in the jelly shader). SwiftShader ratios are noisy (x1.30 to x1.40 between runs).

## Spec conflict: RD-17's bars against whole bodies framed inside the insets (for the orchestrator; I loosened nothing)
`setPlayBounds` must frame "a body anywhere inside [the bounds], a back body's bubble included, inside the HUD safe insets" (contracts,
PLAYGROUND_BUILD 9). Fitted by search over pitch 0.15..0.9, aim and distance (`fitPlayBounds`, node N6) with the assumed insets (390x844: 151 / 60 /
170 / 16; 1280x800: 120 / 24 / 150 / 24), a 1 m squishy comes out at the numbers below; the browser measured exactly the implemented row.
| Model | tall 1.25 x 3.0 on 390x844 (front / mid px) | wide 3.4 x 2.4 on 1280x800 (mid px) |
|---|---|---|
| whole bodies R 0.625, height 1.25, back bubble 0.45 m (what the contract says; **IMPLEMENTED**) | 80 / 69 (pitch 0.45, 20.9 m) | 118 (front 146) |
| whole bodies R 0.5, height 1.0, bubble 0.45 | 86 / 74 | 123 |
| body CENTRES only (no lateral margin), height 1.0, bubble 0.45 | 121 / 97 (pitch 0.40, 14.2 m) | 136 |
| nothing but the bounds' floor rectangle | 127 / 108 | 155 |
The designer's "pitch 0.5 at about 14 m, 101 / 83 px" matches the centres-only model; with the largest body's own width the 60 px right inset
binds. RD-17 (100 / 80 tall, 150 wide) cannot pass with whole bodies in frame. A decision is needed: narrower tall bounds (for example half width
0.9 m), a smaller right inset, or framing body centres and letting a body at a side edge sit partly under the HUD. `fitPlayBounds` takes `bodyR`,
`bodyH` and `bubbleUp`, so the chosen model is a one-line change in `PlaceHost.fit` (`src/render/place.ts`).

## Bytes (PLAYGROUND_BUILD 14.3's one-file method: rolldown, the module alone, imports external, minify, es; `scratch/pg_render/size.mjs`)
| Module | Chunk | HEAD | now | delta |
|---|---|---|---|---|
| `render/stage.ts` | first load | 15 492 | 22 878 | +7 386 |
| `render/material.ts` | first load | 18 130 | 20 035 | +1 905 |
| `render/face.ts` | first load | 8 108 | 9 916 | +1 808 |
| `render/bodyview.ts` | first load | 7 924 | 9 172 | +1 248 |
| `render/pose.ts` (new) | first load | 0 | 1 823 | +1 823 |
| `render/homeview.ts` (new) | first load | 0 | 628 | +628 |
| `render/table.ts` | first load | 8 543 | 9 100 | +557 |
| `render/particles.ts` | first load | 6 618 | 7 069 | +451 |
| `render/env.ts` | first load | 3 548 | 3 660 | +112 |
| **render first-load share** | | | | **+15 918 B = 15.5 KB of 16 (466 B left)** |
| `render/emotes.ts` + `homekit.ts` + `lifelook.ts` | lazy `lifelook` | 0 | 16 805 + 7 293 + 217 | **24.3 KB** |
| `render/place.ts` + `placeview.ts` | away | 0 | 6 843 + 1 235 | **7.9 KB of 90** (PG_AUDIO's ambience bed not counted by me) |
| `render/places/hearthlog.ts` | cabin | 0 | 11 814 | with `audio/places/hearthlog.ts` 2 681 and `data/place_hearthlog.ts` 3 936: **18.4 KB of 45** |
At the end of step 1 the share was +33.9 KB (emotes 16.4 + homekit 7.3 inside the stage chunk); after step 8 it was 18.4 KB. **For the
orchestrator (T1):** the size gate must name the lazy facade `src/render/lifelook.ts` (I propose counting it with the life chunk: it is the draw
half of LIFE and loads on the first emote, Home thing, keepsake, prop binding or `setAutonomyFraming(true)`, all sent only by the LIFE host),
`src/render/place.ts` (the away chunk) and `src/render/places/hearthlog.ts` (the cabin). Most of emotes.ts is GLSL text the minifier cannot
shorten: compacting it is the next lever if the life chunk is tight. The first-load margin is only 466 B: the next first-load addition must
first move something out (for example the place framing's camera branch, or `Table.setSky`).

## Node check numbers worth quoting (`node _harness/renderview/pg_node_checks.ts`)
- N1: `visibleTableAt`'s box edges land on the inset lines in three's own projection within 0.0000 px (2 frames x 3 scales x 2 aims). One body
  at scale 1 with the assumed insets: 390 x 844 box x -0.555..0.419, z -3.4..1.212 (near row 0.974 m; spec 0.78 to 1.22); 1280 x 800 x
  -1.357..1.357, z -3.4..0.345 (spec: the bottom HUD covers z > about 0.3).
- N2: on the 0.92 cream fill over ink: ink 15.29, plum 13.33, amber 3.35, lagoon 3.34, coral 3.32, dusk 7.26 (:1).
- N3: phone bubbles 36 px, insets held, no overlap once settled (0.00 px; a bubble with no room above slides sideways), not-Calm max scale 1.120,
  Calm scale exactly 1, a wish holds still to 0.000 px, a wish rests as its still dot after its two re-glances.
- N4: identity bit for bit at 0; lean clamped to 0.1 R; a shiver 7 Hz at 0.015 R; Calm turns a 3 Hz wiggle into 2.00 Hz; sleep breathing 0.012
  of the height.
- N5: no thing shown = nothing drawn; arrival scale-in (0.698 at 0.1 s, 1 at 0.6 s); Calm or reduced motion = a fade at full size that ends
  opaque; a bound pose moves the Felt Ball; a parked thing is not drawn; keepsakes on the shelf.
- **Spec conflict resolved (for PG_VERIFY):** LIFE 7.2's "x0.85 for a group" makes a 30.6 px phone bubble, under RD-04's 36 px floor. A group
  bubble keeps max(36, 0.85 x base) px and draws its icon x0.85 ("a smaller icon", LIFE 7.2 Styles).

## Files (all in the lane)
- NEW: `src/render/pose.ts`, `emotes.ts`, `homekit.ts`, `homeview.ts`, `lifelook.ts` (lazy facade), `placeview.ts`, `place.ts` (away chunk),
  `places/hearthlog.ts` (cabin chunk); `_harness/renderview/pg.ts` (scenarios), `_harness/renderview/pg_node_checks.ts` (node rows).
- CHANGED: `src/render/stage.ts`, `face.ts`, `bodyview.ts`, `material.ts` (vertex-stage pose, the look block, cache key **wh-jelly-v5**,
  `setLight`, `keep`), `table.ts` (`setSky`, `setFelt`), `env.ts` (panels as data, `setPanels`), `particles.ts` (normal-blend twin);
  `_harness/browser_render.mjs` (sections `emote`, `pose`, `homeview`, `place`); `_harness/renderview/view.ts` (`__RV__.pg`).
- CHANGED `src/contracts.ts` PLAYGROUND block, **additive and optional**: `bindProps` gains an optional third argument `propThing`;
  new optional `StageLike.setAutonomyFraming(on)`, `setBodyBreath(id, depth)`, `setHomeThing(thing, shown, x, z, yaw)`, `setKeepsakes(mask)`.
  Why: the contract had no way for the shell to tell the stage (a) that LIFE is on at Home, so the camera must stop following live positions
  (D-37) while today's toy keeps today's framing bit for bit; (b) a basking deep breath (LIFE 5.1 / PLACES 3.1 list it as a render pose, and
  setBodyPose has no breath argument); (c) when and where one of Home's things shows (the rug is a patch with no prop pose, and the stage chunk
  cannot import the lazy PlaceDef); (d) which keepsakes stand on the shelf; (e) which pose drives which thing.

## Decisions a reader should know (each also in the code's header comment)
- **Bubble anchor:** "1.3 x rest radius above the body's top" (LIFE 7.2) is read as the tail tip at max(top + 0.15 R, centre + 1.3 R).
- **setEmotesInPhoto(false)** hides the bubbles from the next frame until set true (WYSIWYG). PG_SHELL calls it with the Snap bar's switch value
  while the Snap tool is open, and true when it closes. The stage cannot tell which frame is the photo.
- **Wish still dot:** `emote` flags bit 1 (value 2) draws a wish as its still 14 px dot; a think bubble also becomes its dot by itself after its
  re-glances at 8 s and 30 s; a re-show with the same icon grows it again.
- **Reduced motion is read by the stage itself** (`matchMedia`, live) and OR-ed with Calm for every new motion (bubbles, arrivals, keepsake
  drops, sway held to 2 Hz or less, the window snow and fire flicker, embers), so "each on its own" holds without a contract member.
- **Autonomy framing:** with `setAutonomyFraming(true)` each whole body counts for the camera at its mat slot (matLayout order = the order the
  views were added), except a body the player is moving (a finger or grab, then until it has been still 0.4 s), which counts live. Chunks count
  only while the player moves them. Off = the old code path exactly. `visibleTable` always uses this rest framing (yaw 0, zoom 1, pitch 0.27).
- **Eye depth fade (RD-12):** per eye, a ray test against the other bodies' jelly boxes as ellipsoids (x 0.94), only bodies whose centre is
  nearer the camera; floor 0.15 behind a clear jelly, 0 behind the most opaque family (`JellyMaterials.keep`), eased. One body: opacity 1 exactly.
- **Accents (RD-04):** amber, lagoon and coral at OKLCH L 0.60 / 0.585 / 0.62 (same hue and chroma as the token); dusk as is.
- **RD-02 (gallery identical to v4 with looks at 0): identical by construction, NOT measured.** Every new vertex term adds an exact zero
  (`x + 0*h + (x - c)*(-0.0)`), and the look block and the emissive toast line are skipped behind uniforms that are exactly 0. No v4 reference
  shots exist on disk; an A/B needs HEAD's render code served beside this one.
- **Place lights:** the stage's SpotLight becomes the hearth's firelight (low at the fire, `keyAim` / `keyAngle`), its rim the window. Every
  jelly's `uKeyDir` / `uRimDir` / `uKeyCol` / `uRimCol` follow, and the white balance is re-derived against `PlaceLight.keyTint`.
  Home's values come back on `setPlace(null)`.
- **Movers:** a pose drives the FIRST prop of its thing (through `propThing`), taken as the prop's centre and orientation.
- The Bounce Pad (Home thing 5) draws nothing yet (S2: pads).

## Not done (honest list)
- RD-06 fails (x1.30); RD-17 fails (the spec conflict above); RD-13 passes but the cabin is darker than the design's 0.20.
- RD-02 browser A/B; RD-03 (the flash gate per place, the ceremony dim easing over 1.0 s or more: the cabin's dim is 0, the dim itself is not
  built); RD-09 as a rendered-pixel row (the node rows N3f and N5c cover the logic); RD-10 judged only by me; context loss inside a place not
  exercised (`hub.rebuild` re-bakes the current panels by construction).
- D-80 particle presets for the reaction cells (steam wisp, drips, bubble cling): the `Emitter` class exists, embers use it, but no preset is
  exposed for the shell to fire. Also missing: the kettle's steam puff, the fire puff on a tap, the finale spectacle (the fire swells and the
  embers rise in time; Calm: a slow glow) and the strand look when a tacky body leaves a prop (D-54). Each of these needs a small optional stage
  member (for example `placeFx(kind, thing, amount)`), which was not added.
- `setObstacles` and `bodyScreenPoint` are implemented but untested in a browser.
- FN-01's one-squishy portrait framing of the Felt Ball (PLAYGROUND_BUILD 24 q1) is not built: the brief says wait for the orchestrator.
- No full render sweep (the 52-minute run); only the PG sections ran. The gallery, ceremony and flash sections were not re-run after the shader
  change (v5), so they are UNVERIFIED against today's tree.
- S2 / S3: not started.

## Requests to other lanes
- **PG_SHELL:** call `setAutonomyFraming(true)` when the LIFE host attaches at Home (false in a place or with autonomy detached);
  `setHomeThing(i, shown, spot.x * bodyScale, spot.z * bodyScale, yaw)` per thing on its event, on party changes and on frame changes;
  `setKeepsakes(mask)`; `bindProps(world.poses, world.count, world.propThing)`; `setBodyAsleep` mirroring physics sleep; `setBodyBreath(id, 1)`
  for a basking firm silicone or pop dome; emote flags bit 1 for a still dot; `setEmotesInPhoto` with the WYSIWYG meaning above;
  at travel: `await stage.loadPlace(id)`, `setPlace(id, fade)`, then `setPlayBounds(layout bounds)`; `setPlace(null)` going home.
- **PG_PHYS:** a prop pose's xyz should be the prop's centre (the ball's centre, the rocker board's centre on its pivot, the swing seat capsule's
  centre) and its quaternion the prop's orientation; the first prop of a thing is its mover.
- **PG_DATA:** nothing blocking. RD-16 found every Home spot in view on the assumed insets; re-check once the UI overhaul's real insets exist.
- **Orchestrator:** decide RD-17's model; name `render/lifelook.ts`, `render/place.ts` and `render/places/hearthlog.ts` in T1; accept or refuse
  the four optional contract members and `bindProps`' third argument; the RD-06 options above.

## Log
- 10:22 baseline tsc exit 0. 10:37 step 1 written. 10:41 node 27/27. 10:47 browser run 1 (emote, pose, homeview): 19 ok, RD-06 FAIL.
- 10:50 looks and setPlayBounds; tsc briefly red from `src/audio/ambience.ts` (PG_AUDIO's file, being written), clean a minute later.
- Places: run 2 (dark cabin), run 3 (spot pool), run 4 (pink room), run 5 (palette fixed), run 6 = final sweep, 23 ok / 3 FAIL.

## Round 2 (engineer 2 of round 2, started 2026-11-16 15:48 UTC from HEAD 7efee6677)
No render-lane file changed since 8dc806641 (`git log -- src/render _harness/renderview _harness/browser_render.mjs`): the cut-off first
round-2 engineer left no render edits, so this round starts from round 1's tree. Baseline tsc exit 0.
Scope (orchestrator): RD-17 framing re-stated (body CENTRES plus radius inside the safe insets; a bubble is not part of the fit and is clamped
on screen into the safe frame instead); chunk naming (lifelook.ts with the life chunk, place.ts with the away chunk, places/<id>.ts each its own);
(1) RD-06; (2) cabin luminance toward 0.20 and a clear marshmallow toast; (3) reaction-cell particle presets as stage members, EMOTE style 3;
(4) S2 places Ripple Shore, Frostbell Ridge, Rainleaf Garden; (5) re-run gallery, ceremony, flash and cut sections once on the final tree.
Constraint: nothing under src/physics, src/shell, src/ui, src/input or vite.config.ts is edited this round (requests go below).

| # | Step | State | Evidence |
|---|---|---|---|
| R0 | read brief, report, other lanes' requests | done 15:48 | |
| R1 | RD-17 re-stated and implemented (node): framing by body CENTRES plus radius, the bubble clamped on screen with its tail turned to its body, the place lens rule; EMOTE style 3 | done 16:25 (node 35 ok / 0 FAIL; browser rows re-stated, run below) | below |

### R1. RD-17: the orchestrator's model, as built (and the one thing it needed beyond the model)
**Model (re-stated RD-17 rows, `src/render/placeview.ts` header and node N6):** for a body whose CENTRE stands anywhere in the bounds, the
column from the ground under it to its top (2 x R, R = the largest body's 0.625) lies inside the HUD safe insets; laterally the centre does
(a body at a side edge may sit up to half its width past the side inset). A bubble is not in the fit: `emotes.ts` clamps it into the safe frame,
where it slides along the edge (held down by the top inset it also slides toward the frame's middle, off its body's face, by as much as it
was pushed, at most 2.4 radii) and its tail, or a wish's trailing dots, turns to point at its squishy (new instanced attribute `iT`; exactly
0 when the bubble is not displaced, so undisplaced bubbles are today's pixels). **Written reason:** whole bodies cannot meet the bars on the
tall layout: the front row spans the bounds plus one body's width in the 314 px between a phone's side insets, so a 1 m squishy is at most
314 / (2.5 + 2 x 0.5) = 89.7 px there (node N6e), under the 100 px bar whatever the pitch, aim or distance.
**The lens (needed beyond the model, my decision, please confirm):** on the WIDE layout at 1280 x 800 the model gives only 135.4 px at
mid-depth with the stage's 35 degree lens (bar 150): there the middle row is 2.4 m behind the front row, and perspective (not the fit) binds.
Every model I tried tops out under 150 at 35 degrees (centres only 138.5, ground and centre only 147.8; only the bare floor rectangle with no
body height at all reaches 154.5). So `fitPlace` takes the WIDEST lens of [35, 30, 26, 23, 21, 19] degrees whose best framing meets RD-17's
bars with a 1% margin (the live camera eases onto the fit), else the stage's 35 degrees; the stage sets `camera.fov` from the fit in a place
and back to 35 at Home (Home's lens never changes). Results (node N6, assumed insets): **tall 390 x 844: 35 deg, pitch 0.35, 14.0 m: 120.6 px
front / 96.2 px mid (bars 100 / 80); wide 1280 x 800: 19 deg, pitch 0.50, 16.0 m: 176.4 front / 152.6 px mid (bar 150)**; every wider lens
misses (35: 135.4, 30: 139.9, 26: 144.4, 23: 147.6, 21: 150.1 under the 1% margin). The fit takes about 30 ms a lens (node), at most six
lenses, memoised for the last four frames. The look at 19 degrees is flatter (a long lens): judged on the screenshots below.
**EMOTE style 3** (LIFE's WISH_DOT): `emote(..., style 3, ...)` now draws the wish as its 14 px still dot (it was clamped to style 2, a group
bubble). Node N3i (clamp and tail), N3j (style 3).
| R2 | RD-06: a lite piece of a quarter of the body or less draws the frequency-12 mesh (1442 vertices; 2562 above a quarter), and a lite chunk draws no core halo quad (its glow stays in the jelly's analytic halo) | done 16:47: **x1.139 / x1.157 / x1.149 in 3 runs (bar 1.2)** | below |

### R2. RD-06 (the report's options a and c; the bar is unchanged)
`src/render/bodyview.ts` `fineFreqFor` (a lite body: frequency 12 at frac <= 0.25, else the low tier's 16) and `src/render/core.ts` `noHalo` (set for
a lite chunk). The harness row's vertex sub-condition is re-stated from `=== 2562` to `=== 1442` for its sixths (the orchestrator chose option
a, which is exactly that). Three separate runs, `node _harness/browser_render.mjs --only=pose` (logs `scratch/pg_render/r2_rd06_{1,2,3}.log`),
each the best of 3 inside the run, SwiftShader, med, 1280 x 800: **lite x1.139, x1.157, x1.149** (chunks not lite x1.497, x1.393, x1.414);
draw calls: two wholes 28, six pieces lite 56, six pieces not lite 66; render ms (two / six lite) 647-720 / 737-807, 656-720 / 759-1018,
667-827 / 767-1026. RD-05 in the same runs: x0.017 / x0.018 / x0.021, 0 fine updates asleep; RD-11 0.000 px. 0 console problems.
Option b (one instanced draw for every piece's decals) was not needed and not built.
| R3 | first-load bytes: the 29 GLSL comments inside material.ts's shader strings (COLOR, EMISSIVE, GRAIN stages; 3.1 KB shipped as text) moved into `${/* ... */ ''}` interpolations, which the minifier folds away; the shader code is unchanged (`scratch/pg_render/cmp.mjs`: 0 of 10 template strings differ once comments and blank lines are set aside) | done 16:58: material.ts 20 033 -> 16 883 B | bytes table at the end |
| R4 | toast look (FN-02): golden on the heat side (0.35..1.15 of the look by facing), a few browner patches fixed to the skin, amber lifted 6% (was 18%: beige); cabin palette: warm honey boards (amber-cream deeper; the dusk-amber boards read magenta), grey stone (ink-cream), lighter under-roof, a warmer, stronger fill | code done 17:00, judged in the place run below | |
| R5 | D-80 reaction presets as stage members: `reactFx(kind, bodyId, x, y, z, amount, lifeS)` (life.ts PARTICLE ids 1 steam, 2 embers, 4 drips, 5 bubbles, 9 puff; follows its body; LIFE 10.1's budget kept by the stage: 48 / s desktop, 24 phone, a third in Calm, none with reduced motion) and `thingFx(thing, kind, amount)` (kind 1 a thing's puff: the kettle's steam, the hearth's fire puff, the pine's snow puff, the drip leaf's shower; thing -1 kind 2 the finale: the cabin's fire swells and its embers rise, Calm or reduced motion a slow glow; Rainleaf's rain stops) | code done 17:45; browser run below | contracts.ts PG_RENDER additions |
| R6 | S2 places' visuals (`src/render/places/{ripple,frostbell,rainleaf}.ts`, both layouts from PG_DATA's laid layouts) and the shared kit (`place.ts`: water surfaces, ground surfaces, backdrop cards, Batch, zero-allocation emits, movers per PART, the ceremony dim) | code done 17:45; browser run below | |

### Place run 1 (17:50, `--only=place`, log `scratch/pg_render/r2_place_1.log`): what it found, and what changed before run 2
- Every place booted; RD-08 22 to 30 calls; RD-17 all eight frames passed (tall 120.6 / 96.2 px at 35 deg; wide 152.6 px mid at 19 deg; the
  model's worst margin 0.0 px on the live camera); RD-07 12 swaps over the four places: programs 18 -> 19, textures 4 -> 4, geometries 23 -> 24.
- Cabin luminance **0.152 tall / 0.186 wide** (round 1: 0.066 / 0.069). Ripple 0.329 tall but 0.447 wide; Frostbell 0.433 / 0.472 (bar 0.35);
  Rainleaf 0.139 / 0.131.
- Bugs: the water surface shader did not compile (a template placeholder left the token `NOISE` in the GLSL: no pool or puddle drew; the
  console row failed); the preset test ran while the stage was still in a place (its "not at Home" sub-row); the particle budget was a token
  bucket whose burst let a 2 s window exceed the per-second cap in Calm (17.5 / s against 16).
- Judged by eye: the cabin's wide view at the 19 deg lens reads well (a diorama look, warm boards, the hearth's light on the floor); the tall
  frame showed a black void above the back wall; the kettle read pink; the marshmallow at toast 0.6 still read lavender (the hearth is behind
  the bodies, so the camera sees the side AWAY from the heat, which my first stronger-contrast toast left at 0.35 of the look). Frostbell: the
  far ground and the ramp read olive / mint (OKLCH cream-to-lagoon mixes pass through green), the mountains sat too far back to show (only a
  flat purple band), the nest read as pipes. Rainleaf: too many orange fallen-leaf flecks.
- Fixes before run 2: the water GLSL; the preset test goes Home first; the budget is a sliding 1 s window (the last 48 particle times: ANY
  second holds at most the cap; a puff's burst fits in it); Ripple's sand x0.9 and its key 820 -> 740; Frostbell's snow L 0.7, key 520, the
  far ground and the ice from lagoon (no cream-lagoon mid mixes), the mountains closer (z -13 / -15) and lighter with real snow caps, the nest
  as overlapping drift ellipsoids; Rainleaf's flecks rarer and darker, a warmer loam; the cabin: an upper back wall and gable card (log bands
  darkening upward) instead of the void, a copper kettle (coral-amber), and the **toast covers the whole body at 0.8 of the look plus up to
  0.45 more on the heat side**, its browner patches darken both the lit skin and the body's own glow (jToB); and the S2 **sand and snow
  looks** (uLook.z sand grains on the lower body; `uSnowL` a snow cap on up-facing skin, matte), which round 1 carried but did not draw.

### Place run 2 (18:10, log `r2_place_2.log`): 3 FAIL, all RD-13 (Frostbell 0.376 tall / 0.393 wide; Ripple wide 0.411); the rest ok
- Fixed by run 2: the water draws (the Rock Pool, the Steam Pool and the puddles), 0 console problems; D-80 starts every preset in a place and
  none at Home; the budget measured 29.0 / s (8 presets, desktop, cap 48) and exactly 16.0 / s in Calm (cap 16); RD-07 programs 19 -> 19,
  textures 4 -> 4, geometries 24 -> 24 over 12 swaps.
- Judged by eye: FN-02's marshmallow STILL read lavender at toast 0.6. Cause: a foam's colour is mostly its sheen and scatter, which the
  diffuse and glow mixes barely move; the toast now tints the whole outgoing light last (0.9 x its weight). Presets: too faint at the wide
  framing (bigger, stronger steam, drips and bubbles); the kettle's steam left its spout INTO the side wall (the spout now faces the room).
  Frostbell: olive blotches in the snow (a cream-lagoon tint mixed with the blue shade), cracks too big; now plain cream snow with a blue-dusk
  shade, finer cracks, pointy peaks (16 to 25 per card). Rainleaf: the stones read pink (dusk-cream passes through pink), the loam purple,
  the moss and the puddles read alike (blue discs with a hard rim); now dusk-lagoon stones, an umber loam (coral-amber taken deep), moss and
  leaves from lagoon-amber mixes (a garden green, an OKLCH token mix), puddles with a soft rim and no foam line. Ripple: sand x0.92 again,
  smoother rocks (an icosahedron of detail 1).

### Bytes at the end of round 2 (14.3's one-file method; `scratch/pg_render/size.mjs`, HEAD = 7efee6677)
| Module | Chunk | HEAD | now | delta |
|---|---|---|---|---|
| `render/stage.ts` | first load | 22 878 | 23 223 | +345 (the lens, `reactFx` / `thingFx`, the body lookup) |
| `render/material.ts` | first load | 20 033 | 17 676 | **-2 357** (GLSL comments out of the shipped text -3 150; toast, sand, snow +793) |
| `render/bodyview.ts` | first load | 9 172 | 9 233 | +61 |
| `render/core.ts` | first load | 4 323 | 4 347 | +24 |
| **render first-load share** (against 1e5a1159, round 1's method) | | 15 918 | **13 991** | **13.7 KB of 16 (2.4 KB left)** |
| `render/emotes.ts` (+ `homekit.ts` 7 293, `lifelook.ts` 217) | lazy `lifelook`: **the life chunk** | 16 805 | 17 612 | +807 (the tail turn, style 3): 25.1 KB in all |
| `render/place.ts` + `placeview.ts` | **the away chunk** | 8 078 | 16 146 | +8 068: **15.8 KB of 90** (PG_AUDIO's bed not counted by me) |
| `render/places/hearthlog.ts` | the cabin chunk | 11 814 | 13 681 | with `audio/places/hearthlog.ts` 2 681 + `data/place_hearthlog.ts` 3 936: **20.3 KB of 45** |
| `render/places/ripple.ts` (new) | Ripple's chunk | 0 | 7 551 | with audio 1 000 + data 3 686: **12.0 KB of 45** |
| `render/places/frostbell.ts` (new) | Frostbell's chunk | 0 | 7 938 | with audio 1 200 + data 4 134: **12.0 KB of 45** |
| `render/places/rainleaf.ts` (new) | Rainleaf's chunk | 0 | 8 055 | with audio 804 + data 3 746: **12.3 KB of 45** |
Chunk naming (orchestrator, for vite.config.ts): `src/render/lifelook.ts` (and the emotes / homekit it imports) with the life chunk;
`src/render/place.ts` (and `placeview.ts`) with the away chunk; `src/render/places/<id>.ts` each its own place chunk.

### Place run 4 = the final place sweep (18:40, `node _harness/browser_render.mjs --only=place`, log `scratch/pg_render/r2_place_4.log`): **ALL RENDER CHECKS PASSED**, 0 console problems
Chunk hashes (git hash-object): place.ts db43c34b0e, placeview.ts f496cee3e6, places/hearthlog.ts e33f811770, ripple.ts e50012912d, frostbell.ts d1cd6e0c9b, rainleaf.ts 696d72c9b1.
| Place | Layout / frame | RD-01 | RD-08 calls (set and props, no body) | RD-13 luminance (bar 0.35) | RD-17 a 1 m squishy (lens) | RD-17 model margin |
|---|---|---|---|---|---|---|
| Hearthlog Cabin | tall 390 x 844 | ok | 30 | 0.155 (round 1: 0.066) | 120.6 front / 96.2 mid px (35 deg) | 0.0 px |
| Hearthlog Cabin | wide 1280 x 800 | ok | 30 | 0.186 (round 1: 0.069) | 176.4 front / 152.6 mid px (19 deg) | 0.0 px |
| Ripple Shore | tall | ok | 28 | 0.267 | 120.6 / 96.2 (35) | 0.0 |
| Ripple Shore | wide | ok | 28 | 0.342 | 176.4 / 152.6 (19) | 0.0 |
| Frostbell Ridge | tall | ok | 29 | 0.306 | 120.6 / 96.2 (35) | 0.0 |
| Frostbell Ridge | wide | ok | 29 | 0.328 | 176.4 / 152.6 (19) | 0.0 |
| Rainleaf Garden | tall | ok | 22 | 0.123 | 120.6 / 96.2 (35) | 0.0 |
| Rainleaf Garden | wide | ok | 22 | 0.121 | 176.4 / 152.6 (19) | 0.0 |
(Every PlaceDef's layouts are the same bounds, 1.25 x 3.0 tall and 3.4 x 2.4 wide, so RD-17's numbers are the same in every place.)
- D-80 presets: steam, drips, bubbles and embers started on four bodies, the kettle's puff and the hearth's fire puff: all true; at Home false.
  LIFE 10.1 budget: 8 presets at full amount, 29.0 particles / s on a desktop (cap 48), **16.0 / s in Calm (cap 16)**.
- RD-07: 12 swaps (Home -> each of the four places in turn -> Home): programs 19 -> 19, textures 4 -> 4, geometries 24 -> 24.
- The bubble clamp in a place (tall Ripple, the largest body at the back-right corner): inside the safe frame. Its tail was 0.0 deg: at the
  final framing that bubble had room above (the corner top sits on the inset line, the bubble rises from it to y 293 px); node N3i proves
  the clamp and the tail turn on a body whose anchor is above the top inset.
- Shots (`_shots/render/pg/`): `cabin_{tall_phone,wide_desktop}.png`, `ripple_*`, `frostbell_*`, `rainleaf_*`, `fn02_fireplace.png`,
  `presets_bodies.png`, `presets_things.png`, `bubble_clamp_phone.png`.

**My judgement of the final shots (a verifier must redo it):** the cabin now reads as a warm firelit room: honey boards with the hearth's light
pooled in front of it, grey stone, a copper kettle, plum and dusk logs, a gable of darker logs instead of the void on the tall frame. The
marshmallow at toast 0.6 reads toasted (a warm brown-gold with browner patches), clearly different from its lavender self; it reads more
brown-beige than bright gold. The 19 deg lens on the wide frame gives a calm diorama look; I find it better than the 35 deg one for a
party, but it is flatter. Ripple: a golden cove, a deep sea with surf lines, the Rock Pool's teal water inside dark rocks with the coral life
ring, the log, the chimes; the driftwood log on the tall layout is seen end-on (its data yaw lies it along z) and reads as a stump; the chime
frame is thin. Frostbell: cream snow with blue shade, a glossy blue ice pond, a cyan ice ramp with rails, a blue-teal pine with snow, the
steam pool in its snow bank, snow drifts for the nest; the snow still shows faint warm mottling under the cream key, and the mountains are
only a strip at the top of the tall frame (under the HUD inset). Rainleaf: dark umber loam, green giant leaves, coral mushrooms, moss-green
bouncer, dark plum puddles, violet-grey stones, rain streaks; the leaves on the teeter and the drip leaf read pale mint. The presets are
subtle at this framing (the kettle's steam and the embers read; drips and bubbles are small).

### Decisions a reader should know (round 2; each is also in the code's header comment)
- **RD-17's model and the lens** (R1 above): bodies by their centres plus radius; the bubble clamped on screen (its tail turned to its body,
  held-down bubbles slide toward the frame's middle); a place camera takes the widest lens of 35 / 30 / 26 / 23 / 21 / 19 deg that meets the
  bars with a 1% margin. **The orchestrator should confirm the 19 deg lens on wide desktop frames**: it is the only way I found to reach 150 px
  at mid-depth on 1280 x 800 without letting back bodies' tops under the HUD.
- **Movers by part:** a thing's props in PropWorldLike's order drive its parts in order (`PlaceBuilt.movers[k]` may be an array). Chimes and
  bells: one part each (the part's pose is the bell's centre and orientation; its string runs `hang` up its local +y to the pivot). The Shake
  Pine: part 0 the trunk (not drawn as a mover), part 1 the branch. The Bob Ring, the balls, the rocker, the leaf teeter, the moss pad: part 0.
- **Assumed heights PG_PHYS must match or tell me:** the chime and bell rails at y 0.95 m (each part hangs `p.hang` below it); the Shake
  Pine's branch centre at its pivot height `p.pivotY` + half its length out from the trunk; the Moss Bouncer's pad top at its half thickness.
- **Water:** one translucent surface per water zone after the jellies (depth test on, no depth write); a disc's edge ring hides the side (the
  Rock Pool's rocks, the Steam Pool's snow bank; a puddle fades at its rim); the Surf Edge's 0.06 -> 0.12 m swell is the render's own slow
  clock (8.5 s), not synchronised with physics' wave. `setBodyWater` is NOT implemented: the surface itself tints what is below the line.
- **Weather:** spray motes (additive), flakes and rain (normal blend), the steam pool's wisps, the drip leaf's drips; caps by tier, x0.3 in
  Calm, none with reduced motion; Rainleaf's showers are the render's own 40 s on / 30 s off clock (the physics `shower` zone has its own).
- **The ceremony dim** (PLACES 2.3): the place host eases the three lights to (1 - ceremonyDim) while `director.active`, 1.2 s each way
  (Ripple and Frostbell 0.3, the cabin and Rainleaf 0). Not measured by RD-03 per place (not done, below).
- **Toast** tints the whole outgoing light last (see R4 / run 2); **sand** grains on the lower body (`uLook.z`), **snow** a matte cap on
  up-facing skin (`uSnowL`, setBodyLook's fifth value). Every look at 0 skips the block (RD-02 by construction, not measured).
- **The particle budget** is a sliding one-second window kept by the stage (`ReactFx`), so the shell need not count preset particles.

## Requests to other lanes (round 2)
- **PG_SHELL** (src/shell is frozen this round; for the next shell round): (1) a reaction cell with `chan === CHANNEL.PARTICLE`: call
  `stage.reactFx(arg, bodyId, 0, 0, 0, amount, lifeS)` (arg is the PARTICLE id; 1 steam, 2 embers, 4 drips, 5 bubbles, 9 puff are drawn; 3
  sparkles, 6 strands, 7 glow, 8 ripple return false); (2) `stage.thingFx(thing, 1, 1)` when the kettle whistles (thing 5 at the cabin, with
  `audio.musicBox({ on: true, tune: 1 })`), on a hearth tap (thing 0), on a Shake Pine shake (Frostbell thing 6, with its `lifeAddLook` snow
  puff) and on a Drip Leaf tap (Rainleaf thing 3); `thingFx(-1, 2, amount)` for the finale (0 ends it; Rainleaf's ends the rain); (3)
  `setBodyLook(id, frost, wet, sand, toast, snow)`: sand and snow are now drawn; (4) `setPlayBounds` with the layout's bounds: the stage
  picks the lens itself; nothing else changes for the shell. (5) Round 1's requests stand (setAutonomyFraming, setHomeThing, setKeepsakes,
  bindProps with propThing, setBodyAsleep, setBodyBreath, emote flags, setEmotesInPhoto, loadPlace / setPlace).
- **PG_PHYS** (src/physics frozen this round): the assumed heights above (chime / bell rails 0.95 m; the pine's parts trunk then branch);
  a prop pose's xyz = the part's centre, its quaternion the part's orientation (round 1's request stands).
- **PG_DATA:** nothing blocking. Ripple's tall layout lies the Driftwood Log along z, which the camera sees end-on (it reads as a stump):
  a yaw near 0 would read better if DT-01 allows.
- **Orchestrator:** confirm the place lens (19 deg on 1280 x 800 wide); accept the two new optional StageLike members `reactFx` and
  `thingFx` (contracts.ts PG_RENDER additions); name `render/places/{ripple,frostbell,rainleaf}.ts` as their places' chunks.

## Not done (round 2, plainly)
- **Finales of the S2 places:** Ripple's sunset and Frostbell's stars over a snuggle are NOT built (`thingFx(-1, 2)` returns false there);
  Rainleaf's finale only stops the rain (its "five drips in key" are not choreographed); the cabin's finale (the fire swells, embers rise;
  Calm: a slow glow) is built but not checked in a browser.
- **Marks** (`stampMark`, the ring buffer of prints, trails, dust, dents and glows) are NOT built: the contract member has no stage
  implementation yet, so no place shows prints. **`setBodyWater`** (the under-the-waterline tint member) is not implemented (the surface
  tints what is below it by itself). RD-15 (water: the surface draws over the right bodies, the tint below the line, the edge ring hides the
  side) has screenshots only (`frostbell_wide_desktop.png`: a body standing in the Steam Pool), no row.
- **RD-03 per place** (the flash gate with the ceremony dim easing over 1.0 s or more in each place) is not run; the dim is built (1.2 s each
  way) but unmeasured. **RD-02** (looks at 0 are pixel-identical to v4) is still by construction only (the toast, sand and snow lines are
  skipped at 0), not measured against a v4 reference.
- **The Wind Gap's snow streaks**, the Surf Edge's wave synchronised with physics, and Rainleaf's shower synchronised with the physics
  `shower` zone are render-only clocks, not driven by the shell.
- **Frostbell's look** still shows faint warm mottling in the snow under its cream key; its mountains show only as a strip on the tall frame.
  Ripple's tall Driftwood Log reads as a stump (its data yaw). Both are look issues, not check failures.
- No full render sweep (the 52-minute run): only the sections named in "Final run" below and `place` ran on this tree.
