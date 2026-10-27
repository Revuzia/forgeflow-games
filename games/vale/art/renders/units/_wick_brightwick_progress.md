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
- 2026-10-20 16:41 builds (fix pass): Aubade 3778 tris / 347 KiB / accent 4.63 % (top 59.4 %); Serenade 4211 tris /
  370 KiB / accent 5.94 % (top 63.3 %). Clip sheets / lineup / review sheet NOT regenerated (stale, 14:5x).

## Fix pass 2 (second independent review: 8 major, 7 minor)
- 2026-10-21 00:10 start. Review: (1) paint = flat procedural fill, not the concept projection; (2) Serenade cloak a
  straight barrel with 12 staves + a sash hoop; (3) hood light a big flat disc (porthole / mouth); (4) Serenade
  pauldrons small dark shards + a flat sawtooth mantle (not the concept's big domes + thick rounded mantle);
  (5) decimation damage (cowl teeth, crumpled plates, ragged band, overhanging window caps, card collar);
  (6) Serenade 4211 tris > 4.0k; (7) Aubade accent 4.63 % < 5 %; (8) death: the staff planted vertically behind
  the pale hood (spire + hood line up); minors: stale evidence, paint smears, Aubade hood near-white + frost-lich
  spikes, spear-like Aubade staff / orb-on-a-stick Serenade lantern, tabard spikes, drum cloaks, stiff clips.
  Plan: A-line bells; game lows made by PROJECTING clean parametric grids onto each part's SDF (cloak, mantle,
  crown band, pauldron domes: clean rows at every hem/edge, no decimation teeth); small deep hood glows;
  Serenade dome pauldrons + thick mantle + caged four-pane lantern; Aubade blue-grey hood, blunt chalk points,
  gnarled ash staff with a split root foot; paint = palette-anchored concept projection in the paint pose (the
  concept's strokes and painted fold light kept, its mean colour moved to the palette) over a painterly
  procedural base (fold light, edge wear, mottle, grain); death staff planted out to the side, leaning away.
- 2026-10-21 00:30 geometry rebuilt: A-line `Bell` (radius AND depth ratio per height: the side view flares too;
  Aubade +-0.33 -> +-0.43, Serenade +-0.29 -> +-0.40, measured on the plate masks), the front opening a wedge
  (widens toward the hem); CLEAN LOWS projected onto the SDF instead of decimated (`lathe_low`: cloak, mantle,
  cowl with a row on every hem point / opening wall / notch; `central_low`: the Serenade domes; `box_low`: each
  Aubade chalk plate its own clean slab), explicit bands (crowns, gorget), torus collar, explicit tabard panel +
  ribbon inlays. Serenade: bullet hood (capped frustum: the RoundCone's end sphere had lifted the crown to
  1.76), big ironstone dome pauldrons (0.98 m across: the widest point), thick sand mantle with lapels + a
  notch, caged lantern (two 4.2 cm iron bands = four panes, heavy collars, cap + knob). Aubade: blunt chalk
  lamp-posts with flame drops (crown <= 11 cm), blunt plate horns, gnarled ash staff with a split root foot,
  blue-grey hood. Hood lights small (6-7 x 4 cm), deep (12 cm behind the opening), mid-height; the rims are
  arches (the sill is the cowl / collar), Serenade opening a tall arch. Fit (paint pose over the plates): IoU
  Aubade 0.82 / 0.83, Serenade 0.83 / 0.84. Tris 3685 / 3755.
- 2026-10-21 00:45 PAINT (`paint_hybrid`): palette base painted from the sculpt (fold light, edge wear, mottle,
  grain, felt nap, top light, ramp) x CONTACT AO between parts (`contact_ao`, ray-cast on the assembled rest mesh,
  arms/staff excluded: the shadow under the mantle / domes / collar the exploded bake never had) x the CONCEPT:
  (a) its brushwork per material from swatches cut out of the graded plates (seamless, 1:1 in metres, every
  texel), (b) the registered front/back projection in the paint pose on the cloak and tabard (own-part
  visibility, figure mask, a consistency gate). Tried the registered projection on every part: at minion scale
  it landed neighbouring features (the concept's bosses and dome stripes as ghosts on the mantle, the rim
  shadow as blotches on the hood), so those parts carry the swatch brushwork only.
- 2026-10-21 00:50 pauldrons bound RIGID to shoulder.L/R: the old shoulder/upper-arm blend crumpled them into
  shards in the guard pose (the reviewer's "crumpled pointed dark shards" were the skin, not the sculpt).
  Death: the staff planted out to the right side and forward (lantern at x -0.79, y -0.52, z 1.35 while the hood
  is at x -0.25, z 1.43: never above / behind the hood), slides sideways onto its left side (hips roll 78 deg),
  the staff toppling outward to lie on the ground (lantern z 0.21). Run: hip yaw 9 / roll 7 + a per-side thigh
  lean in the cloak bind (lateral 0.55) so the hem swings.
- 2026-10-21 00:58 builds 7 (both, --clip-sheet): Aubade 3685 tris / 377 KiB / accent 6.99 % (top half 64.4 %),
  Serenade 3755 tris / 337 KiB / accent 5.27 % (top half 81.2 %); load test OK, facing +Z, mesh top 1.735 / 1.700,
  92 / 90 px at 1080p; death body min z 0.000, prop min z +0.006.
- 2026-10-21 01:10 hood lights moved to where the 52 deg camera looks in (low, ~10 cm behind the opening): deep
  at mid-height the hood's brow hid them completely (accent unchanged by any size). Serenade: a sand robe "bib"
  between the mantle lapels (the notch showed a 9 cm deep dark cavity: a keyhole slot), iron tops get the
  concept's pale sheen and the dome bands widen (top value band), hood contact shadow floored (a decimated hood
  triangle dipping into the collar painted a dark spike). Death: the planted staff leans further out (lantern
  clear of the hood in every clip-sheet view); lying on its left side the right fist rests on the ground and the
  staff lies flat ahead-right (it stood on its lantern).
- 2026-10-21 01:41 FINAL builds (both, --clip-sheet): Aubade 3685 tris / 361 KiB / accent 6.97 % (top half 65.2 %);
  Serenade 3854 tris / 348 KiB / accent 5.24 % (top half 82.1 %). three load test OK, facing +Z, mesh top
  1.735 / 1.700 m (content 1.7), 92 / 90 px at 1080p; base textures 122 / 97 KB WebP (were 88 / 78).
  Death ground solve: body min z 0.000, prop min z +0.003 / +0.006; attack1 Aubade boot toe -0.009 at the lunge.
  Fit (paint pose over the plates): IoU Aubade 0.821 / 0.827, Serenade 0.842 / 0.846.
  Lineup (lineup_qa, Cycles game look, 64 px): brightwick A vs S IoU 0.857 (same job >= 0.70), vs every other
  kind <= 0.62 (<= 0.80); value bands Aubade 70/61/39 (front), Serenade 52/43/34 (front; side 40/46/30: the
  big iron domes own the top quarter from the side); lineup accent max 5.5 % / 4.8 %.
  Evidence (all from these GLBs): three_brightwick_*.png, three_clips_brightwick_*.png, review_brightwick.jpg
  (concept | three.js front, 3/4, back | UNLIT paint front, back | game camera), lineup_brightwick.png/json,
  fit_brightwick_*.png. Debug maps (not shipped): art/.cache/brightwick_paint/.
  Open: in three.js the Serenade reads greyer than the concept's orange (the palette caps warm saturation at
  40 %, and the QA light is cool; the unlit paint is warm umber / sand); the registered projection only lands on
  the cloak and tabard; the death ends as a toppled bell on its side (the cloak is rigid drapery by the brief,
  no cloth bones); the hood light from eye level sits at the bottom of the arch (seen from the game camera it is
  a pool of light inside the hood).

## Fix pass 3 (third independent review: 8 major, 4 minor)
- 2026-10-21 start. Review: (1) faces in the hoods (Serenade band windows over the low hood light = eyes + mouth,
  tall narrow arches + a lens at the bottom = mouth + tongue, Aubade's crumpled pale cowl = beard); (2) death end
  = a bent tube / log with a flat hem cap; (3) Aubade pauldrons = stacked slabs (fingers / fists); (4) Aubade
  lantern = claw + gem; (5) Serenade lantern = orb / bauble; (6) Serenade upper body = primitives (tin-can hood,
  cardboard mantle, small grey pauldrons, agate bands); (7) paint / geometry defects (ghost arm, chest hole,
  flecks, dome slit, window slivers, AO bar); (8) Serenade accent 3-4.8 % per facing, top value L* 40-52;
  minors: scurry run + shin poke, weak slam, Aubade helm hood / floating back ribbon, 12 octagon windows,
  static idle, lineup same-kind gate.
- 2026-10-27 08:50 resumed (after a long break). State found: fix pass 3 mostly in the module (tombstone hood opening,
  Serenade felt dome flaring into the collar, 14 round crown windows, shell-plate Aubade pauldrons, hexagonal Aubade
  lantern, three-band caged Serenade lantern, x_hem_1 hem bone + piled death, 18 f run, idle scan); last builds
  02:55 / 02:57 on 10-21 (3755 / 3941 tris, 332 / 325 KiB, accent 5.85 / 5.54 %), module touched after them.
  Rebuilding both with clip sheets to re-baseline.
- 2026-10-27 08:50 re-baseline builds (both, clip sheets): Aubade 3755 tris / 332 KiB / accent 5.85 %, Serenade 3921 /
  324 KiB / 5.75 %; load test OK. Review of the evidence: the hood light (a broad lens tilted 40 deg, 0.20 x 0.21 m in a
  0.24 m opening) filled the arch at eye level: a lit visor / face plate in every close-up.
- 2026-10-27 09:05 hood light reworked with a new numpy check, `proto/wick_brightwick_hoodlight.py` (sphere-traces the hood
  sculpt + crown band shell and the light from eye level and the 52 deg pitch; `--sweep` renders candidates side by
  side). Tried: small deep ellipsoid (brow hides it at 52 deg: a dark slot with a lit lip = mouth + tongue), 45 deg
  tilted disc (a band at the slot's bottom), pooled on the sill (egg on the sill at eye level). Chosen: ONE deep
  rounded volume, wider than tall (17 x 10 cm, 17 cm front to back), centred at 33 % of the arch height with ink
  all round it at eye level, deep enough that the 52 deg camera sees it fill most of what the brow leaves visible
  (128 / 124 cm2 visible at 52 deg vs 65 for the small one). Same read as the sibling kinds (glow low in the
  hollow). 16 x 6 mesh (smooth outline; the 14 x 5 one read almond / eye-shaped in close-up).
  Serenade: 14 crown windows r 3.0 -> 3.4 cm, 12-gons (were octagon-looking 10-gons); hood felt #DAC09A -> #D8BA8E
  (a little warmer, still the top band); hood decimation 370 -> 350 tris (budget).
- 2026-10-27 09:12 builds: Aubade 3803 tris / 333 KiB / accent 6.31 % (top half 61.3 %), Serenade 3977 / 326 KiB /
  6.00 % (66.8 %); load test OK, facing +Z. Lineup (game chain, 8 wicks): A vs S IoU 0.866 (>= 0.70), vs every other
  kind <= 0.63 (<= 0.80).
- 2026-10-27 09:25 Serenade dome pauldrons #3F362F -> ironstone #4B4039 with the iron top sheen (+30 %) the other iron
  parts had (the concept's pale dome crowns; the top value band looks down on them). attack1: a `rise` key at 0.68
  (the lantern swings UP out of the ground, grip 0.52) before the settle: the 0.70 frame showed the staff out level
  like a spear thrust.
- 2026-10-27 09:30 FINAL (fix pass 3 closed): Aubade 3803 tris / 332 KiB / three QA accent 6.31 % (top half 61.3 %);
  Serenade 3977 tris / 325 KiB / 6.00 % (top half 66.8 %). three load test OK, facing +Z, mesh top 1.735 / 1.715 m
  (content 1.7), 92 / 91 px at 1080p; attack1 / death ground solve: body min z 0.000, prop min z >= 0.
  Fit (paint pose over the plates): IoU Aubade 0.816 / 0.818, Serenade 0.845 / 0.849.
  Lineup (game chain, all 8 faction wicks, `lineup_brightwick.png/json`): A vs S IoU 0.866 (>= 0.70), vs every other
  kind <= 0.634 (<= 0.80); value bands Aubade 66.5 / 54.1 / 35.6, Serenade 55.2 / 41.8 / 34.0 (front); lineup
  accent per facing Aubade 5.1 / 3.9 / 4.3 / 3.3 %, Serenade 3.8 / 3.8 / 5.5 / 3.7 %.
  Evidence (all from these GLBs): three_brightwick_*.png, three_clips_brightwick_*.png, review_brightwick.jpg,
  lineup_brightwick.png/json, fit_brightwick_*.png; debug: art/.cache/brightwick_paint/, art/.cache/brightwick_look/.
  Fix-pass-3 items: (1) faces: even 14-window ring (no lit pair), one rounded glow low-middle in the arch with ink
  all round; (2) death: kneel on the planted staff -> slide off -> heap, hem piled by x_hem_1, ground-solved;
  (3) Aubade pauldrons: curved shell lames + cap; (4) Aubade lantern: hexagonal dawnglass, chalk roof + spire;
  (5) Serenade lantern: ball in a three-band iron cage + collars; (6) Serenade dome hood flaring into the collar,
  thick mantle with lapels + bib, 0.98 m dome pauldrons; (8) accent 6.0 % at the QA camera.
  Open: Serenade top value band (55 front, 31 side: the iron domes and the crown band own the top) stays under the
  bible's 70-85 (the concept's dark domes; lifting them more loses the culture read); Serenade reads greyer/paler
  than the concept's orange (palette cap: <= 40 % saturation in the marigold band); from the 52 deg camera every
  wick's hood shows a dark slot with the glow at its lower half (family-wide, as on the sibling kinds).

## Fix pass 4 (fourth independent review: 1 major, 7 minor)
- 2026-10-27 09:30 start. Review: (1, major) Aubade ALLY read: azure accent on blue-grey/pale bodies, Lab dE 18.6-21.4
  against the pixels round it (the other three states 35-45); thin 1-2 px lines, tiny crown drops, a 24-tri lantern
  core; hood bluer than cloth2; the chalk tabard a narrow grey strip. Minors: (2) glossy egg hood light, (3) Serenade
  greige, no amber, top band low, (4) Serenade collar missing in front + ear-muff pauldrons, (5) Aubade helm-hood +
  crest seam + cog pauldrons, (6) paint richness / lumpy rim / lit hollow streaks / Serenade pinched tip, (7) candle
  crown + button windows (0.25 accent roughness), (8) Aubade lantern stacked over the hood from a back 3/4.
- 09:40 measuring harness (scratchpad bw5/: the reviewer's lane render + an id-mask pass, per-figure accent share and
  dE of the mean accent Lab against the 2-4 px ring of body pixels round it; reproduces the review's 18-21 / 39-45 /
  36-38 / 33-40 on the old GLBs). Finding: the renderer draws the ally accent at L* ~70, C* ~27 (the 0.3 x colour
  diffuse + 0.8 emissive through AgX), so a PALE or chalk ring only reaches dE ~20-27; dE >= 35 needs a ring at
  L* <= ~42: every Aubade light needs a dark setting.
- 10:00-10:55 Aubade (11 builds, dE / lineup checked each time): hood back to cloth2 (#BFC6CC) with soft drape folds
  (mirror-symmetric: an asymmetric fold term had creased the back meridian and zig-zagged the seam), narrower and
  domed (x +-0.18, top 1.72), opening reduced to the concept's dark hollow (x +-0.099, z 1.33-1.56); a dark slate-felt
  CAP inside the circlet; slate circlet + slate lamp cups + six round dawnglass lamp drops (6.4 cm) + six little chalk
  spire TOWERS between them (were candle posts / then teeth); the seam a fine 3 cm lit line over the cap, 5 cm down the
  back of the cowl in a slate channel; the stole wider (23 cm) chalk-white with ONE 6.2 cm centre light pointed above
  its V in a painted slate channel (`channel`), a dark belt, a slate under-robe in the front opening; back stripe
  6.2 cm in a 5.5 cm slate channel; lantern glass r 5.4-8.6 cm x 20 cm in a slate frame + roof (chalk knob + short
  spire), staff head bound in dark leather; pauldrons: three stepped plates with straight edges (no notched V: cog)
  wrapping less, two broad blade horns; staff guard more lateral (0.82, -0.08, 0.57), head bend 22 -> 14 deg.
  Variants measured and rejected: pale cap (dE 26.5-29.5 / top 58-60), dark ring + pale crown (30.7 / 53), chalk
  circlet (32.5 / 41).
- Serenade: felt dome SEATED IN a thick dark rolled collar (r 7.4 cm, its front roll the arch's sill), a short arch
  (1.37-1.575, was 1.29-1.55), pauldrons lowered to the shoulder line (z 1.226) with the bosses on the front-inner
  top, broad sandstone bands on the domes, warmer palette (hood #DBB988, mantle #D3AF7F, tabard #CFAB7D, all <= 40 %
  sat; umber cloak #7B5842 at 23 deg), amber LAMPRESIN rims either side of the lantern's iron bands, 9 cm crown band,
  sash 8 cm + tabard bands 6.8 cm with ironstone borders.
- Both: accent material matte (`matte_accent`, roughnessFactor 0.78: no hotspot eggs / buttons / gems), hood light
  small + deep + centred in the arch (10 x 7 cm Aubade, 11 x 8 cm Serenade: visible at eye level 56 / 66 cm2, hidden
  from 52 deg by design), clean swept-tube rim lows, ink on every texel behind the opening plane, the concept swatch brushwork on every
  painted part (was cloak + sleeves only), hood lows 440 / 410 tris (the decimated pole read as a pinched point).
- 11:15 FINAL builds (both, clip sheets): Aubade 3910 tris / 341 KiB, Serenade 3999 tris / 344 KiB; three load test OK,
  facing +Z, 92 / 91 px at 1080p, QA accent 7.44 % (top half 64.6 %) / 6.61 % (64.3 %), attack1 + death ground-solved
  (body min z 0.000, prop min z >= 0.001), accent roughnessFactor 0.78, metallicFactor 0.
  Lane harness (52 deg, 1080p 1:1, map_rift sky, ally #3F9CFF / enemy #FF9A1F, idle + run, 8 facings):
  Aubade ally dE 31.1-41.4 (mean 35.0; was 18.1-21.0), enemy 50.3-57.6; Serenade ally 37.8-38.9, enemy 35.0-40.4;
  accent share per facing Aubade 2.8-7.9 % (mean 5.6), Serenade 3.8-7.2 % (mean 5.1).
  Fit (paint pose over the plates): IoU Aubade 0.812 / 0.817, Serenade 0.848 / 0.853.
  Lineup (game chain, all 8 faction wicks): A vs S IoU 0.866 (>= 0.70), vs every other kind <= 0.604 (<= 0.80);
  value bands top / mid / bottom Aubade 37 / 49 / 31 (front), Serenade 49 / 38 / 34.
  Evidence: three_brightwick_*.png, three_clips_brightwick_*.png, review_brightwick.jpg, lineup_brightwick.png/json,
  fit_brightwick_*.png; lane/close renders and the harness in the session scratchpad (bw5/).
  Open / trade-off: the Aubade TOP value band fell 66.5 -> 37 (front, 52 deg): from the game camera the top quarter is
  the cap, and the cap is the crown lamps' + seam's dark setting; every pale-cap variant left the ally read at dE
  26-31. The bible's light-top ramp and the ally read conflict for lights placed on the hood top; this build favours
  the ally read (the review's major). The pale linen hood still makes the top at eye level. Serenade top band 49
  (dark collar + iron domes, the concept's design). The stole reads chalk-edged (3.8 cm each side) round a slate
  centre panel, not all-white. The Aubade side facings (90 / 270 deg) carry the least accent (2.8-5 %).

## Fix pass 5 (fifth independent review: 3 major, 5 minor)
- 2026-10-27 11:40 start. Review: (1) death ends in a kneeling forehead-to-ground bow (a prostration, not a death;
  the brief says it slides sideways off the staff); (2) Aubade drifted from its concept: the slate cap / circlet /
  cups / lantern frame / tabard channel read as a black spiked helmet over a white visor and a blue sword, top
  value L* 37 against the 70-85 law; (3) accent adequate but not generous at the real camera: the hood light is
  invisible from 52 deg, side facings 2.8-4.6 %; minors: flat paint + small defects, the hood light a hard oval
  badge, Serenade a loose match (small taupe ribbed domes, cup bosses, cream strata dome, 14 beads, mauve mitts),
  budgets full (3999 tris).
- 11:45-12:05 changes: DEATH ends LYING ON ITS LEFT SIDE off the staff (slip -> fall; knees drawn, right fist + staff
  on the ground ahead, hood and crown resting sideways); the lower bell rides x_hem_1 with a keyed LOCATION + SCALE
  (`hem_loc`, `hem_sq`: this module wraps anim.write_action / apply_pose to key them) along the drawn-up thighs,
  flattened (scale 0.58 across): the coat folds at the waist and lies over the legs (never a barrel); its underside
  is painted as the coat's dark inside. AUBADE back to its concept: pale linen hood all over (no slate cap), CHALK
  circlet + spire towers, slim slate bezel cups round each lamp, CHALK lantern frame / posts / roof with two thin
  slate bezel rings at the panes, chalk-white stole with a narrower (4.6 cm) square-ended light and a 1 cm painted
  bezel (no channel, no point: no sword), chalk-linen belt (was dark), back stripe 5.6 cm with a 1 cm bezel.
  ACCENT: the hood light is now a broad low volume (24 x 12 cm, 13 cm in, sides tucked behind the opening's walls,
  top leaning back) that the 52 deg camera sees over the sill (Aubade 115 cm2, Serenade 135 cm2 visible; was 5 / 0),
  smooth 18-segment outline, a painted neutral spill on the hollow's walls round it (the falloff); Aubade
  pauldrons get a dawnglass INLAY along the middle lame (front -> outside -> back: the side read); Serenade sash
  9.2 cm, tabard bands 7.4 cm, lantern core r 11.6 cm with slimmer bands. SERENADE: 12 spaced windows (r 2.9 cm,
  11-gons), flat convex sandstone bosses (no cup), darker iron domes #3F3530, dark iron mitts, richer ochre felt
  (#D0AD7E, ramp ^0.5 on the dome / mantle), the dome's swatch from the mantle (the old one caught the collar edge:
  horizontal strata). Concept projection faded at the stole's top (the squiggles under the cowl).
- 12:05-12:20 iterations (lane harness = the reviewer's: three.js, road, 1080p 1:1, 52 deg, 8 facings): Aubade side
  facing (270) 3.6 -> 4.5 %: a lit HEM PIPING over the ironstone hem band, following the pointed hem round the back and
  sides (a flat inlay, 2 tris a segment; `flat_strip`), pauldron inlay 3.2 cm; Serenade sides 3.1 -> 5.2 %: a
  LAMPRESIN STRIP set in each iron dome (back -> outside -> front, short of the boss: a band, never a disc), 12
  windows r 3.1 cm. Hood lights re-placed with the hoodlight proto: tilted 35 deg, front 3 cm behind the opening
  (52 deg sees 136 / 145 cm2, eye level 172 / 168). Aubade hood bluer (#A2B4C4: the concept measures L* 71-85, blue);
  Serenade felt / mantle lighter ochre with ramp^0.75, domes #433934, bigger (0.182 x 0.208 x 0.144). The Serenade
  felt's horizontal STRATA were the paint's fold term: the finite-difference Laplacian of the trilinear SDF grid steps
  at every voxel layer -> low-passed (`lowpass3d`, 1.4 cm) before painting; the felt dome / mantle carry the
  procedural felt only (the plate swatches tiled into bands / a pitted biscuit). SDF highs Taubin-smoothed (voxel
  terraces). Iron gorget removed (hidden under the mantle; its edge poked through as dark dashes under the collar).
  Death end tuned: the lower bell lies along the drawn-up thighs, 0.38 m from the hips, flattened x0.70 (a compact
  curled heap on its side, not a barrel); the coat's underside painted as lining (#2F353D / #3A2E26), not black.
  Stand-in clips (attack2, cast_*, recall, idle_lobby, channel, stunned, victory, dash): static guard pose at the
  shortest legal length. Tri trims: hood lights 16 x 4, crown cups 3-ring, inlays 8 points, lantern socket, Serenade
  lantern collars / core, boss nu 8, sash 13 points, band 18, staff cap, sleeves / forearms / staff / hood budgets.
- 12:21 FINAL builds (both, clip sheets): Aubade 3937 tris / 336 KiB, Serenade 3822 tris / 321 KiB (texture 1024 base,
  256 normal / ORM); three load test OK, facing +Z, mesh top 1.728 / 1.714 m (content 1.7), 92 / 91 px at 1080p;
  QA accent 9.39 % (top half 62.4 %) / 8.89 % (64.7 %); attack1 + death ground-solved (body min z 0.000, prop min z
  >= +0.001; death hips dz up to +0.18 m).
  Lane harness per facing (0..315 deg): Aubade 6.4 6.3 6.4 8.6 8.3 7.6 4.5 5.9 % (mean 6.8; was 2.8-7.9), Serenade
  5.9 6.3 5.9 9.1 8.3 8.7 5.2 6.4 % (mean 7.0; was 3.8-7.2). Ally dE Aubade 21.3-22.6 (the price of the concept's pale
  setting; the other Aubade wicks measure 17.7-20.6 in the same lane scene), enemy 40-46; Serenade ally 38-39, enemy
  37-42. Lineup (game chain, 8 faction wicks): A vs S IoU 0.862 (same job), vs every other kind <= 0.655; value bands
  (front) Aubade 63 / 53 / 35 (was 37 / 49 / 31), Serenade 46 / 40 / 34. Fit (paint pose over the plates): IoU
  Aubade 0.812 / 0.815, Serenade 0.848 / 0.853.
  Evidence: three_brightwick_*.png, three_clips_brightwick_*.png (row 9 = death), death_brightwick.jpg (three.js:
  mid-fall kneel on the staff | end at eye level | end at 52 deg), lane_brightwick.jpg (lane crowd, both viewers),
  review_brightwick.jpg, lineup_brightwick.png/json, fit_brightwick_*.png.
  Open: the Serenade top value band (46) stays under the 70-85 law: the concept's big dark iron domes and dark
  collar own the top quarter from 52 deg (the review asked for them darker and bigger); the hood light at eye
  level is a broad glow over the sill (the price of seeing it from 52 deg); seen from the feet end at eye level the
  lying coat shows its (lining-coloured) underside; QA-camera accent 8.9-9.4 % sits over the brief's 5-7 % (the lane
  mean is 6.8-7.0 %); small paint defects left: a dotted texel seam on the inside of the Aubade rim, two dark slits
  where the cowl's V meets the stole, a notch where the belt crosses the stole light (sub-pixel at 92 px).
