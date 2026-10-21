# brightwick (super Wick) faction build: progress

Owner of this file: the brightwick builder. Module `art/blender/units/wick_brightwick.py`, protos
`art/blender/proto/wick_brightwick_*.py`, outputs `art/out/units/brightwick_{aubade,serenade}.glb`,
renders `art/renders/units/*brightwick*`.

## Milestones
- 2026-10-20 10:11 start: read brief §3.4, concepts, wick_common, HANDOFF Art 2.0, marund/ervet/burdam patterns.
- 2026-10-20 10:20 concepts measured on a 10 cm grid (Aubade 709 px/m, Serenade 744 px/m). Default plate cut loses
  Aubade's chalk pieces (pale on pale): a low-threshold background-difference mask recovers pauldrons, crown,
  staff and lantern. Plan: A-pose rest rig + a PAINT POSE (armature posed to the concept's staff hold, plus a
  small yaw for Aubade's slightly turned front view) for the projection only; staff on prop.R re-headed along
  the staff (ervet precedent); bespoke idle/run/attack1/death.
- 2026-10-20 10:30 plates: `proto/wick_brightwick_plates.py` -> `art/.cache/concept/wicks/brightwick_<f>_bw_*` (new mask,
  painted glow erased where accent geometry sits, Aubade hem darkened, Serenade warm saturation soft-clipped to 37 %).
  Review: `_brightwick_<f>_plates.jpg`.
- 2026-10-20 10:40 first sculpt of both factions in `wick_brightwick.py` + fit proto `proto/wick_brightwick_fit.py`
  (game mesh, skinned, posed in the paint pose, over the plates). Aubade IoU front 0.83 / back 0.83 on the first try.
  Fixes: Aubade staff head bends 30 deg up above the left fist (the concept's lantern stands upright on a diagonal
  staff), front yaw 9 -> 12 deg, crown ring +1 cm.
- 2026-10-20 11:04 first full builds (both factions): load test OK, facing +Z, attack1 lever-slam / death kneel-and-topple
  read in the clip sheet. Over budget (6.9k / 7.4k tris, 574 / 608 KiB); accent Aubade 6.0 %, Serenade 2.5 % (too low);
  the hood light read as a flat disc in the opening; Serenade greyer than the palette.
- 2026-10-20 11:06 per-part tri budget table (TRIS, ~3.8k), hood light smaller + deeper, wider seam/stripes, bigger
  crown lamps; Serenade: crown windows 5 -> 6.2 cm, lantern ball 0.20 -> 0.22 m with a thinner cage, taller sash,
  accent boss windows on the pauldrons, warm soft-clip 0.37 -> 0.40; Aubade hood rounder (helmet-round, top 1.73);
  recall/idle_lobby short loops (a minion never plays them; ~60 KB saved).
- 2026-10-20 11:30 build 2: Aubade 4.5k tris / 491 KiB / accent 8.8 %; the pipeline's symmetric collapse stalled on
  thin slabs (tabard 526 tris for a 70 budget) and the decimated SDF strips went ragged (wedge-shaped seam/stripe);
  Serenade's thin mantle/cloak shells TORE at their budgets. Fixes: lows made in the module (symmetric collapse,
  plain collapse when it stalls), seam + back stripe as clean ribbon meshes laid on the real SDF surface, Serenade
  windows as flat 8-gon caps on a hole-free band, SOLID cloak/mantle bells (half the triangles of a shell) with
  the front opening as a recess down to a robe floor (robe part dropped), tabard/strips skinned by weight transfer
  from the cloak.
- 2026-10-20 11:41 build 3: 3.83k / 3.80k tris, 469 / 484 KiB, load test OK, clean meshes. Accent fell to 4.4 % /
  3.8 % with the honest ribbons; Aubade's recess walls read as a block (10 cm deep). Build 4: recess 4 cm, wider
  seam/stripes, bigger lamps/windows/boss windows, Serenade lit inner lip of the hood (the concept's glowing arch).
- 2026-10-20 11:47 build 4 (both): 3.90k / 3.99k tris, 477 / 491 KiB, load test OK; accent Aubade 6.1 % (top half 56 %),
  Serenade 4.9 %.
- 2026-10-20 14:05 resumed (usage-limit break). Review of build 4 (`review_brightwick.jpg`): (a) glassy blue-grey sheen on
  both cloaks = the WebP ORM's chroma bleed puts metalness 0.1-0.38 on ~20 % of texels (glTF metallicFactor 1 lets it
  through; same on the other wicks): module now exports metallicFactor 0 (`_gltf_material`); (b) Serenade read all-beige:
  graded sand pieces sat at L* 51-57 against cloth2 73 while the cloak sat at 40 - the plate grade now lifts the sand
  (hue 26-32) separately (tabard 64, mantle 61-66, hood 63-82, cloak 32-41: the concept's sand-over-umber two-tone);
  (c) the Serenade lit inner lip + core read as one big eye in the close-up: lip dropped, a wider, set-back hood light
  instead; (d) Serenade sash moved up to the concept's bands (z 0.93 / 0.99); Serenade windows 7.0 -> 7.8 cm; Aubade
  crown lamps larger, back stripe tapers toward the hem (top-half accent); hood lights rounder (64 tris);
  (e) GLB size: unused required clips (attack2, cast_*, channel, stunned, victory, dash) are short stand-ins (~45 KB).
- 2026-10-20 14:20 build 5: 3.93k / 3.89k tris, 409 / 425 KiB (short stand-in clips), accent 6.5 % (top 59 %) / 5.2 %;
  load test FAILED on the stand-ins (12 frames: impact at 40 % needs a multiple of 5) -> 10 frames.
- 2026-10-20 14:30 build 6: load test OK. The glassy cloak survived metallicFactor 0: a `--strip roughnessMap` render
  is matte, so it is ROUGHNESS. Area-weighted per-region sampling of the shipped ORM: cloak back/sides median 0.54
  (cloth authors 0.9). Cause: the bake clears the ORM to roughness 0 outside the islands; the atlas islands on the
  cloak are tiny (~4 texels per tri at 256), so the 1024 -> 256 scale (and three's mipmaps) average those zeros in.
  Fix in the module: `_set_image_array` fills empty ORM texels from their neighbours at full size before the scale;
  roughness floored at 0.5; deeper bake cage (3 cm / 8 cm ray). Aubade plates: the chalk tabard is spared from the
  bottom value ramp (L* 60 -> 64). Serenade: lantern 0.24 m, wider sash and chevron (accent).
- 2026-10-20 14:50 build 7: ORM fill works (26-29 % empty texels filled; 0 texels needed the 0.5 floor); the cloaks are
  matte warm umber / slate in three. The 0.24 m Serenade lantern decimated to 422 tris (faceted ball, 4.14k total):
  reverted to 0.224 m with thinner cage bands and a larger glass core.
- 2026-10-20 14:56 builds 8-9 (FINAL): Aubade 3930 tris, 397 KiB, accent 6.28 % (top half 60.4 %); Serenade 3889 tris,
  413 KiB, accent 5.63 % (top half 64.2 %). Load test OK, facing +Z, mesh top 1.734 / 1.713 (content 1.7), 92 / 91 px
  at 1080p. Lineup (`lineup_brightwick.png/json`, Cycles game look, 64 px): brightwick Aubade vs Serenade IoU 0.83
  (same job, >= 0.70), vs every other kind <= 0.60 (<= 0.80); value bands Aubade 66/49/27, Serenade 57/37/26
  (Serenade family 44-64 / 40 / 22-30). Review: `review_brightwick.jpg`, clip sheets `three_clips_brightwick_*.png`.
  Open: Serenade back cloak shows a squared hem corner from the 52 deg camera (thigh weights); the WebP-ORM metal bleed
  and the tiny-island roughness averaging likely affect the other wicks too (fixed here inside this module only).

## Fix pass (independent review: 7 major, 4 minor)
- 2026-10-20 15:20 fix pass start (after a usage-limit break). Plan: (1) death: staff planted foot-down (lantern
  up), a curled side-slump end pose, and a per-frame ground solve on the skinned mesh (no vertex below z 0);
  (2) run: hip-dominant cloak weights (thighs <= ~0.2, centre-front averaged: no shear, no tear) + a shorter
  stride under the hem; (3) paint: procedural painterly paint from the palette (SDF fold/cavity light, value
  ramp, painted bands) instead of the misregistered concept projection; (4) hood lights: smooth ellipsoids set
  back at mid-height; (5) Aubade crown: six chalk points with small flame drops (no gem-cut lamps);
  (6) Serenade accent up (inset curved windows, visible boss lenses, 3D caged lantern); (7) Aubade chunky
  stepped pauldrons; minors: hem bands, attack1 forward slam, ORM B 0 + per-material roughness, value bands.
- 2026-10-20 15:45 pose proto `proto/wick_brightwick_pose.py` (rig + sculpt + lows + binds, no bake: clip strips over an
  opaque ground + per-frame lowest body / prop vertex, lantern centre). Cloak bind `("bw_cloak",)`: hips (spine/chest
  above the waist) + the AVERAGE of both thighs up to 50 % at the hem: in the run the thighs swing opposite ways
  (no shear, no tear between the legs); kneeling/curled the bell folds at the hips (no rigid slab). Run 14 f, 0.52 m
  stride, low swing, slimmer trousers (they live under the bell); legs stay under the hem, boots show.
- 2026-10-20 15:55 death rebuilt: recoil -> sinks onto the right knee leaning on the staff planted foot-down (lantern
  up by the hood, z 1.46-1.50) -> slides off sideways/forward-left into a kneeling heap, hood down, the staff on the
  ground ahead-right. `ground_solve` poses the skinned mesh per frame and moves the hips so the lowest body vertex is
  at z 0 (body min z 0.000 every frame); `settle_prop` turns the staff about the fist so it never goes below the
  ground and rests ON it from frame 48 (lantern centre z 0.11 on the ground, prop min z +0.004). attack1 gets the
  same prop lift (the lantern lands on the ground at impact, never through it). New slam: wind-up over the hood,
  impact at 40 % with the lantern 1.4 m in front at z 0.24, the staff ~35 deg below level, torso ~28 deg.
- 2026-10-20 16:05 PAINT rebuilt: `paint_procedural` replaces the concept projection (misregistered, painted light
  baked in). Per texel: the sculpt surface + normal (Newton onto each part's SDF grid), SDF Laplacian (fold crests
  light, valleys dark) + SDF occlusion, a soft sky term, a painted key, the bible ramp (light top / dark feet), hue-
  shifted shadows, low-frequency brush noise (+ felt grain on Serenade cloth). Regions: Aubade ironstone hem band on
  the pointed hem, robe floor + lining in the front opening; Serenade two ironstone hem bands, sandstone stripes on
  the pauldrons, cracked gorget; walnut/ash grain on the staffs. ORM: roughness per material role (cloth 0.92 ...
  leather 0.66), metal channel 0 and Metallic wired through a x0 multiply -> GLB metallicFactor 0 on ONE shared
  ORM (B median 0.00, was 1.00).
- 2026-10-20 16:10 geometry: hood lights = smooth explicit lenses at mid-height 5 cm behind the opening; Aubade crown =
  six short chalk points with chalk cups holding smooth flame drops (no gems); Aubade pauldrons = three 8-10 cm
  stepped chalk plates (0.74 m across) + two short points; Serenade crown band = rounded-rect lathe (the scaled
  torus had a non-manifold rim: 768 tris) with 12 curved window caps (r 4 cm) that follow the band; Serenade lantern
  = smooth lampresin ball inside a world-aligned "+" cage; boss lenses on the pauldrons; Aubade folds 14 around
  (0.03 m), Serenade 12 (0.02 m), faded at the bell's axis (the singular angle made non-manifold knots: the cloak
  decimated to 1522 tris instead of 600). Aubade back stripe laid on the smooth bell (it zigzagged over the folds).
- 2026-10-20 16:20 lineup (game look): Aubade accent 5.7/6.4/7.3/6.1 %, Serenade 5.1/3.7/3.1/3.5 % (sides/back low);
  IoU A vs S 0.90 (>= 0.70), vs other kinds <= 0.62. Fixes: Serenade sash wraps round the waist (back + sides),
  windows 4 cm, boss lenses turned outward; Aubade bottom ramp darker + robe floor darkens to the hem (bottom 41).
