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

## Fix round 3 (wiring review + in-game notes: 2 major for brightwick, shared targets for all kinds)
- 2026-10-27 13:40 start. Open majors: (1) the hood reads as a face: the 24 x 12 cm tilted slab on the sill = a
  tongue in an open mouth, the round white Aubade rim tube = lips, the pale cowl under it = a beard, the Serenade
  bare cream dome + dotted band + opening = a bald head with a headband and a mouth, a visor slot from 52 deg;
  (2) paint / material below the fighter bar (same matte clay everywhere, no edge light or cavity, few painted
  folds; the Serenade mantle a smooth bulb / flat slab with a squared hem, the collar a plain torus, the Aubade
  staff a near-white tube with a bone foot, the faceted dome top). In-game notes: Aubade blue-grey under the ally
  tint, Serenade tan/amber near the enemy hue, the hood light small from above, flat / plastic surfaces. Shared
  targets: one soft core, Art 2.0 paint, the team read from both seats, hoods L* <= 65 (B5), gates.
- Measuring IN GAME (scratch wick_brightwick/ig_bw.mjs + ig_measure.py): render_bench rift, q high, 1080p 1:1,
  zoom 28.5, seat 0 and seat 5 (team 1); every shieldwick model is served as the brightwick of its faction so
  the first clashes are brightwick crowds; per clash a beauty frame + an accent-mask frame + a body-mask frame
  re-rendered from the same state (post.render(0)); per figure: accent share, Lab dE of the accent against the
  1-4 px ring of body px round it, hood L* (median / p90 of the body px over 1.45 m), value bands. Baseline
  (the 12:21 GLBs): dE Aubade ally 43.7 (min 25.4) / enemy 58.7, Serenade ally 63.9 / enemy 67.4; hood L* p90
  Aubade 74, Serenade 69-75 (over the B5 65).
- HOOD LIGHT: the slab is gone. ONE soft CORE floating in the head space: an ellipsoid 11 x 7 x 5.6 cm (Aubade) /
  12 x 7.2 x 5.6 (Serenade), 16 x 5 rings, front 2.5-3.5 cm behind the opening, at a third of the arch's height
  (eye level: under the middle; 52 deg: over the middle) with dark hollow above, below and both sides from eye
  level, 3/4 and the game camera. Soft falloff: a dim neutral spill painted on the walls that face the core,
  1 / (1 + (d / 7 cm)^2), only at and behind its depth (the floor in front of it stays ink: no tongue, no pale
  ring = no sclera). A soft gradient IN the accent is not possible: the shared load test fails any accent with a
  map (the renderer tints it), and a second emissive shell would need a second team-tinted material. The hollow:
  everything seen through the arch's outline is ink (hood, rim inner wall, cowl / collar cut faces, and the
  Aubade coat's top cap, which sat inside the hood at z 1.356 and showed as a lit shelf), never past the head
  space's back; the ORM makes the ink matte (roughness 1) and occluded (0.05): the sky light + specular had
  greyed the up-facing floor into a shelf. Aubade rim: a FLAT CARVED band (`rim_band`: inner wall into the
  hollow, chamfers, a flat face 1.1 cm proud, a fall) instead of the round tube. Serenade dome: the cap above the
  crown band is its own clean low (`hood_cap`, rings of rays from the dome centre; the decimated top had a flat
  triangle and a polygonal silhouette); radial seams tried and dropped (a pie from 52 deg, as on the greatwick).
- VALUES (B5): part colours down, the shared FACTION_PALETTES untouched (wick_common.py not edited): Aubade hood
  #A2B4C4 -> #7E878F, chalk #D9D6CD -> #98948A / #9C988E, stole #E0DDD4 -> #A8A49A, cowl #646E79, cloak + sleeves
  #6A727B (chroma 8 -> 5.5, same blue-grey family), ash staff #9A8C76; Serenade dome #CCA97B -> #9A846A, mantle
  #A48B6E, tabard / bib #9E876B (L* 71-72 at 39.7 % sat -> ~57-60 at ~31 %), sandstone #A88F70; the RAMP's top
  lifts 1.18 -> 1.09 (A), 1.26 -> 1.14 (S). In game: hood L* p90 61.4 / 63.8 (Aubade ally / enemy seat), 64.0 /
  62.6 (Serenade), medians 34-45; bands top / mid / bottom Aubade 43 / 31 / 24, Serenade 35 / 30 / 26 (light top,
  dark feet).
- PAINT: a `cavity` term on every part (texel surface vs its 2.2 cm 3D low-pass along the normal): carved edges
  and crests take a warm worn edge light from above, seams and creases sink; firmer painted folds / occlusion /
  sky light / key; the concept swatch strokes 0.45 -> 0.75, chalk KCON 0.35 -> 0.60, contact shadow floor 0.30 ->
  0.22; felt nap + fibre speckle; Serenade mantle: the hem dips to a soft point at the centre back (0.962), deeper
  drape sags over the arms and back and beside the lapels, painted felt folds, a darker turned edge and its cast
  shadow on the coat; the rolled collar a slow spiral twist (displaced SDF -> normal map + fold paint); Aubade
  staff: long dark grain streaks, two knots, carved double rings above the grips, a slate ferrule instead of the
  split root foot.
- ACCENT to the brief's 5-7 %: the Aubade hem piping removed (a light at the feet), back stripe 5.6 -> 4.2 cm and
  from z 0.36, stole light 4.6 -> 3.8, seam 4.4 -> 3.6, pauldron inlays 3.2 -> 2.6, crown drops 6.4 -> 5.7 cm,
  lantern glass r 5.4-8.6 -> 5.0-7.9 x 18.8 cm; Serenade sash 9.2 -> 7.0, tabard bands 7.4 -> 6.0, chevron 6 -> 5,
  dome strips 3.0 -> 2.6, crown windows r 3.1 -> 2.9, lantern core r 11.6 -> 10.6.
- 14:39 FINAL builds (both, clip sheets): Aubade 3965 tris / 328 KiB, Serenade 3987 tris / 319 KiB; three load
  test OK, facing +Z, 92 / 91 px at 1080p; QA accent 6.94 % (top half 72.8 %) / 6.85 % (71.6 %); attack1 + death
  ground-solved (body min z 0.000, prop min z >= -0.000 / +0.003). Clips idle / run / attack1 / death unchanged.
  In game (both seats): accent-vs-surround dE Aubade ally 47.0 (min 35.5; was 43.7 / 25.4), enemy 62.0 (min 39.9);
  Serenade ally 61.3 (min 42.2), enemy 70.8 (min 42.6). Lineup (game chain, 8 faction wicks): brightwick A vs S
  IoU 0.861 (>= 0.70), vs every other kind <= 0.659 (<= 0.80); value bands Aubade 49.8 / 41.6 / 29.7, Serenade
  38.2 / 34.4 / 32.3. Fit (paint pose over the plates): IoU Aubade 0.811 / 0.814, Serenade 0.848 / 0.853.
  Evidence: three_brightwick_*.png, three_clips_brightwick_*.png, review_brightwick.jpg, hood_brightwick.jpg (new:
  eye level ally / enemy, 52 deg pitch), lane_brightwick.jpg (in game, real late-match brightwicks, seat 0 and
  seat 5, 1:1 + x3), death_brightwick.jpg, lineup_brightwick.png/json, fit_brightwick_*.png; the scratch review
  set (eye-level close-ups, true-size game camera, in-game measurements) in the session scratchpad wick_brightwick/.
  Open: the core is a uniform matte azure / marigold (factor-only accent: the falloff lives in the dim painted
  spill, subtle under the in-game light); the Serenade top value band (38 in the lineup) sits under the bible's
  70-85 by design now (B5 caps the hoods at 65 and the concept's dark collar / iron domes own the top quarter);
  the paint is richer (cavity, edge light, folds, nap) but still procedural + the concept's swatch strokes, not
  Marund's full projected painting; a 2 mm sliver at the lower right inside the Serenade rim at close range.

## Fix round 4 (wicks fix round 3 review, 2026-10-27; all four kinds in one pass)
- SHARED HOOD LIGHT (wick_common: cap_mesh / halo_mesh / inject_halo / install_halo_export): the core is the front of a
  16-round ellipsoid, wider than tall, ~3 cm behind the opening and centred between the sill and the arch top; round it a
  HALO cap 2.0 x the core (a shallow dome through the core's middle: no parallax slide in 3/4 or leaned views), drawn with
  the kept material `glow_halo`. The export hook (before the optimizer) renames it `accent` (BLEND; the renderer and the
  crowd path tint every material of that name per viewer) and writes COLOR_0 with vertex alpha 0.85 over the core's
  outline falling as (1 - s)^1.5 to 0 at the rim (per cap, from its own geometry: PCA of the welded vertices). The accent
  stays factor-only (load test green). Lamp panes can use `glow_halo_lamp` (1.6 x, used on the greatwick Aubade lantern).
- Measured (three.js, the review's rv.mjs close-ups, 3/4 eye level, ally tint), L* every 3 px out from the core's edge:
  before 60 -> 16 (shieldwick) / 60 -> 3 (brightwick) in one step; now e.g. shieldwick Aubade 61 55 49 45 40 36 32 28 25 22
  19 17, above 51 49 44 39 34 30 26 21 17 14 12 10 8; the same soft fall on all eight (scratchpad wick_r4/close,
  hood_sheet_r4.png). Core centre in the opening (eye level, 3/4): shieldwick A 0.47, greatwick A 0.51, brightwick A 0.50,
  glimwick A 0.46 / S 0.52 (was 0.16 on the sill).
- In game (Rift seed 7, t 74 / 84, zoom 28.5, High 1080p and Low 720p, seats 0 and 5; review tools ig.mjs + analyze.py,
  working-tree GLBs served in every wick slot): see the per-kind lines below. Fighters' top quarter in the same frames
  L* 42-66.
- brightwick: the hood light on the shared core + halo (A 8.4 x 5.4 cm, S 10.2 x 6.4 cm), raised to ~0.5 of the opening.
  Serenade crown rebuilt: a RAISED CIRCLET high on the dome's upper slope (z 1.637-1.69, 1.2 cm proud), ten small round
  windows spaced all round (back included), its value lifted to #7A6A5A, the small felt cap above it: from 52 deg a ring
  of lamps round the crown, no slit / visor / teeth (tried and dropped: a vertical ring lower down read as a tin can, a
  flared coronet round a flattened cap as a jar's mouth). Values: collar #664E3E, pauldrons #5E5047, the feet ramp
  0.60 -> 0.36. Mantle fold paint deeper with lit crests. Aubade staff: #85775F (L* 50) with broad grain streaks, larger
  knots, value drift along the shaft; the seam 3.6 -> 3.2 cm and a smaller core (the 7 % cap with the halo).
  Gates: A 3983 tris / 329 KiB / accent 7.00 % (top half 73 %), S 3977 / 322 KiB / 5.76 % (66 %); load test OK, clips present.
  In game: Aubade under azure dE76 48.1-50.4, under marigold 86-92; Serenade under azure 62.8-66.8; hood top quarter
  A 63-66, S 61; Serenade top / mid / feet medians 34 / 31 / 28 (High), 34 / 34 / 33 (Low) - was 21-40 over 26-36.
  Open: the Serenade mantle and the collar silhouette are still smooth; the Low-tier gradient is flat, not light-top.

## Fix round 6 (wicks review r4 = review:wick:2, brightwick items; wick_common.py untouched)
- 2026-10-27 19:00 start. Major: paint + forms under the Art 2.0 / glimwick bar (Serenade cloak a plain tube, the
  cream mantle a flat slab with a straight hem, crumpled sandstone pauldron bands, a torn notch in the sash at the
  back, crumpled / faceted Aubade forearm wraps and mitts). Minors: Aubade hood top quarter over L* 65 in game,
  the hood core a crisp disc, the Serenade light-top / dark-feet gradient flat (Low 34 / 34 / 33), face hints at
  52 deg (Aubade grey sill block + serrated shelf = a jaw; Serenade thick roll = lips, a lit shard inside), the
  reserved marigold band, budgets.
- Close-up tool: `proto/wick_brightwick_glbview.py` (imports a BUILT GLB in EEVEE under the Rift sky + sun, the
  accent tinted like the game, the halo / core COLOR_0 alpha wired; eye level body + head, 52 deg head + body,
  the gameplay camera at true 1080p scale, forearms). In game: the review's ig.mjs + analyze.py (Rift seed 7,
  t 74 / 84 / 99, brightwick served in the shieldwick slot, seats 0 and 5, High 1080p and Low 720p), run under one
  heavy slot.
- Changes (wick_brightwick.py only):
  - Serenade MANTLE: `mantle_hem` a broad U to the centre back (0.950) with SCALLOPS (a lobe under every drape crest
    at 45 k deg, 1.8 cm, none on the lapels), the bell down to 0.90; the drape (`mantle_drape`, shared by the sculpt
    and the paint) has its valleys between the lobes; the low's columns on every lobe, cusp and half way (38 x 4 rows
    + the turned edge, 380 tris); paint: the drape's folds (valley shadow, lit crest), the underside in shadow, the
    turned edge darker, the shoulders +3 L*; the coat's cast shadow under the scalloped hem deeper; the concept's
    back plate now carries the capelet (PROJ_PARTS).
  - Serenade COAT: folds 1.6 -> 1.9 cm and PAINTED from the sculpt's own fold function (`cloak_fold_w`: lit crest,
    deep valley, opening toward the hem), long vertical brush strokes on the coat and sleeves; the feet ramp
    0.36 -> 0.21 at the hem, the hem bands #3A302A -> #332A25.
  - Serenade PAULDRON BANDS: clean ribbons (no edge noise, no cracks): a fall across each band, a worn edge light on
    its upper edge, a shadowed lower edge, a groove either side; the swatch strokes and the mottle damped on them.
  - SASH: its stations are the coat low's own columns, found the same way (horizontal rays at the world angles), so
    its chords run parallel to the coat's: welded, no notch (the old elliptic stations let coat vertices cut it).
  - FOREARMS (both): a clean helical BANDAGE SPIRAL (`wrap_mesh`: 6 stations a turn, each turn's elbow-side edge
    5.5 mm proud over the turn before, on a slim core tube; Aubade 3.5 turns, Serenade 2.5) over an SDF high with
    the same spiral step (normal + paint); MITTS: a rounded-box low projected on its own SDF (48 tris) + a separate
    THUMB lobe (24 tris, a crease in the high).
  - DETAIL TRANSFER: `apply_concept` uses the glimwick's `wick_common.detail_ratio` (4.5 cm low-pass, 0.66-1.40,
    chroma, outliers and tops masked) at DET[role] (cloth 0.72) on the projected parts; unseen texels keep the
    material swatch.
  - MARIGOLD BAND (Serenade): `wick_common.clamp_reserved` on the finished base colour (24-50 deg, S <= 0.34, 4 deg
    feather; the lampresin rims kept), then each texel's luminance restored (the clamp keeps HSV value: the umber
    came out ~3 L* lighter).
  - VALUES (Aubade, B5): measured in game, the hood region's brightest quarter is the round linen CAP inside the
    circlet (sky + sun from 52 deg): the cap -15 %; the circlet + towers #98948A -> #8C887F with a softer worn tip
    light, the rim #928E85, the pauldron cap plate's top step -11 % and a softer edge light.
  - FACE HINTS: Aubade sill sunk 2 cm (opening 1.330 -> 1.310, the core 1.413 -> 1.420), the top 1 cm of the sill
    inked (ORM matte + occluded) and the chin darkened softly into the scarf; Serenade roll thinned to half down the
    arch's sides (tapered RoundCone chain + a tapered swept low), the painted spill on the hollow's walls halved.
  - HOOD LIGHT: cores 4.2 -> 3.5 cm (A) and 5.1 -> 3.9 cm (S) across (the shared 2.07 x halo had filled 88 % of the
    opening, a lit plate); the halo's ring stations moved into the fall (0.62 / 0.74 / 0.87 / 1.0, same 98 tris).
- 19:45 FINAL builds (both, clip sheets): Aubade 3981 tris / 333 KiB (341,396 B), Serenade 3989 / 321 KiB (328,712 B);
  three load test OK, facing +Z, 92 / 91 px at 1080p; QA accent 6.96 % (top half 72.7 %) / 5.87 % (64.7 %); attack1 +
  death ground-solved (body min z 0.000, prop min z >= -0.000 / +0.002).
  In game (ig.mjs + analyze.py, the review's numbers in brackets):
  - Aubade hood top quarter 62.2 / 62.7 ally High / Low, 62.5 / 61.4 enemy (65.1 / 65.5 / 66.3 / 65.2), p90 63.1-64.8
    (66.6-69.8); dE76 accent vs ring 50.1 / 47.5 ally, 90.2 / 83.7 enemy (50.2 / 47.8 / 92.0 / 86.2).
  - Serenade top / mid / feet 38.4 / 31.1 / 23.2 High, 39.7 / 34.8 / 28.3 Low (34 / 31 / 28, 34 / 34 / 33); hood top
    quarter 61.6 / 61.1, p90 64.8 / 63.6; dE76 66.4 / 62.2 (66.8 / 62.8); Lab marigold share 13.1 % High, 1.0 % Low
    (25.5 / 10.2).
  - Authored base colour (glbtex): Serenade texels in the 25-50 deg band over 0.40 sat 16.2 % -> 10.2 %, those above
    V 0.35 3.7 % -> 2.9 % (the lampresin rims, the brief's <= 4 %); the rest is near-black ink / walnut where the
    WebP's chroma noise moves dark texels.
  - Hood light profile (eye level, L* every 3 px from the core's centre outward): Serenade 59 ... 58 57 54 52 48 45 42
    38 35 30 26 23 18 (before: a flat 60 to the opening's edge); Aubade 58 ... 56 54 50 47 43 39 35 31 27 23 17 11.
  Evidence: fix_r6_brightwick.jpg (before | after: Serenade body eye level + 52 deg, Aubade forearms / mitts and the
  52 deg sill, the hood light ally / enemy, in-game 1080p x4 crops with the hood top-quarter pixels), three_*,
  three_clips_*, build_report_*.
  Not applicable: the halo darkening ring on panes (the brightwick lanterns carry no lamp halo).
  Open: the cross-kind relation to the fighters (wick hoods 61-63 against fighters' top quarters 45-65 in the same
  frames) is for the fighter / B5 lanes; the Serenade Low feet 28.3 sits at the 28 target; tris 3981 / 3989 of 4000
  leave little headroom; a small light sliver at the foot of the Aubade rim band at the 52 deg close-up.

## Fix round 7 (verify wave-b, "verify:wick (wave-b-finish)": the Aubade side face blocker, the Serenade O, the 52 deg disc)
- 2026-10-28 01:15 start. Blocker: from the side at 52 deg the six crown lamps put a LEVEL PAIR (60 / 120 deg) either side
  of the side spire = two eyes, over the near pauldron's closed accent U round a pale stepped cap = an open mouth (1:1 in a
  walking wave, both seats, both tints). Minors: the Serenade roll round a near-round opening = lips round an O, a lit
  sliver in the hollow under the core at 52 deg, the cores flat discs at 52 deg. Close-up tool: proto glbview `--views
  yaw8` (eye level / 52 deg head / gameplay camera x1 and x3 at every 45 deg facing). In game: review_wick ig.mjs, the
  brightwick served in the shieldwick slot (same states as the review's frames: before/after pairs), High + Low, seats 0/5.
- AUBADE CROWN: TEN smaller lamps 36 deg apart (FLAME 5.7 -> 4.3 cm, cups 3.7 -> 2.8 cm, 6-round), one over the arch, one
  on the nape seam, a chalk spire tower facing each side (90 / 270); square-shaft spires (12 tris). From any facing the
  ring's near half shows 4-6 evenly spaced lamps on its arc: the inner two always have neighbours at the same spacing
  (a string of lights, like the Serenade's ten windows), never an isolated level pair. (Rotating six by 30 deg would put a
  pair over the arch; any equal-height ring has some facing where two lamps are level, so the fix is the spacing.)
- AUBADE PAULDRON: the inlay a SHORT ARC on the plate's outer edge only (+-40 deg round the outermost point, 5 stations;
  was front -> outside -> back, 220 deg: a closed U); its painted bezel follows. The cap plate (+ its two points) x0.56
  linear: found by the cap's outer sheet and theta span (`capm`; the old nearest-mid-surface test handed the cap's
  outer face to the first lame, so r6's "cap" darkening never reached it). Measured: Blender g3 yaw 90 cup L* median
  58.4 -> ~47; in game (high s0 t84, the review's face frame) 47.0 -> 36.5 / 47.5 -> 35.4 (p75 56.7 -> 43.7 / 42.6).
- SERENADE OPENING: the roll is a BROW: round 1.6 cm over the arch's top ~100 deg, falling through the shoulders to a
  FLAT felt edge down the sides (8 mm across, 3 mm proud: FlatCapsule chain high, a flattened swept low), run round the
  whole outline (closed, no seam) with a felt-coloured sill run (`_rim_serenade`). The collar's FRONT flattened under the
  opening (`CollarTorus` / `collar_tube`: front top 1.388 -> 1.345, the sides and back the full roll) and the sill
  1.370 -> 1.385: a straight band of felt is the arch's sill between the dark opening and the collar, which no longer
  closes an O under it. The tombstone's bottom corners 4.5 -> 3.4 cm (2 x the corner radius had grown past the box's
  height under the arch: it pinched the outline at the springing line, a notch / ragged teeth either side).
- THE LIT SLIVER: it was BASE COLOUR, not light (rough 1 / no normal map / no specular left it; a black base removed it):
  the decimated hollow floor is one long sliver triangle 3-4 texels wide in UV, wound down, lying exactly on the outline's
  bottom edge, so its texels missed the ink tests and it sampled the sill's felt. Now (`ink_hollow`) every near-level
  texel on the floor band inside the outer shell is ink, and (`floor_uv_mask`) the floor triangles' UV footprints + 2 px
  are inked after the gutter fill (base + the ORM's matte occluded ink: roughness 1, occlusion 0.05). The spill only on
  walls BEHIND the core (0.40 -> 0.25), none in the pocket under it. `refine_hollow` splits any hood-low chord across the
  void (0-1 per build now); `snap_hollow` pulls stray vertices out of the void.
- HOOD LIGHT (both): the halo has its own profile (HALO_BW, registered in wick_common.HALO_PROFILES by name: the shared
  halo_alpha with its plateau ending at 0.15, so core + halo fall 1.0 / 0.78 / 0.43 / 0.26 / 0.10 / 0 from the centre
  instead of a flat 0.8 disc to 1.3 x the core) and leans back 30 deg (its lower fall comes forward under the core, where
  the 52 deg sight line sees it below the brow); 10 round, 6 stations (90 tris). Blender 52 deg close-up, L* from the
  Serenade core's centre downward every 4 px: before 59 60 60 60 60 61 61 60 58 58 52 41 25 10; after 59 60 60 60 60 60 60
  58 47 43 39 34 29 24 19 (across every 6 px: before flat 60 then 54 47; after 59 .. 56 49 46 43 39 35 31 27).
- Budgets: the Aubade hood 440 -> 390, the Serenade hood 310 -> 300 (the crown, the halo stations, the refine).
- 03:00 FINAL builds (both, clip sheets): Aubade 3961 tris / 343,680 B, Serenade 3970 / 326,632 B; three load test OK,
  facing +Z, 92 / 91 px at 1080p; QA accent 5.96 % (top half 72.1 %) / 5.96 % (65.2 %); clips idle / run / attack1 /
  death (+ the stand-ins); attack1 + death ground-solved (body min z 0.000, prop min z >= +0.002 / -0.000).
  In game (same states as the review; its numbers in brackets): Aubade ally High dE76 49.6 (50.1), hood top quarter 61.9
  (62.2), p90 63.0; enemy dE 91.0 (90.2); Serenade ally High dE 65.6 (66.4), hood top 61.9 (61.6), p90 65.1 (64.8);
  Serenade bands top / mid / feet 37.0 / 36.6 / 20.1 High (38.4 / 31.1 / 23.2), 38.4 / 38.2 / 24.5 Low (39.7 / 34.8 / 28.3):
  the mid is lighter (the felt sill and the lowered collar front replace the dark roll there); Lab marigold share
  18.6 % High (13.1; the exposed sand felt under the warm sun, authored albedo clamped as before).
  Evidence: fix_r7_brightwick.jpg (before / after sheet), three_*, three_clips_*, build_report_*; scratchpad bw_r7/: final_<f>_yaw8.png (+ _enemy: eye / 52 deg head / x3 / x1 at 0..315), cmp_a_side_final.png
  (before / after, yaw 90 / 270 / 135 / 225, x3 + x1), cmp_s_front_x3_x1.png, cmp_s_hollow_final.png, qa_three_head_ba.png,
  igcrops/z_bw_a_face_t84_x7_before_after.png, z_bw_a_t84_x1_before_after.png, z_bw_s_front_x8_before_after.png,
  ba_<f>_<tint>_<q>_x4.png, analysis.txt.
  Open: from the side the Aubade pauldron is still a stepped cup (a lighter lame rim round the darker cap, the short arc
  under it) - no eyes above it now; the Serenade opening from 52 deg is a dark arch wider than tall (the 52 deg
  foreshortening of a 19 x 23 cm arch), under its brow roll; a faint lit facet on the upper inner wall in the three QA
  close-up (hidden by the brow from 52 deg).

## Closing CW4 (r12 M8 value half) — 2026-10-29
- Measured in game with the new `_harness/probe_wick_sweep.mjs` (`hood` part: class pass, hood = body pixels skinned
  mostly to the head joint, display L* top quarter, RIFT High t~990): brightwick Aubade 65.2, Serenade 66.7 against the
  65 cap (every other Wick 57.7-62.5; fighters 82.7). PART_HEX only (no geometry, no clip change): Aubade hood #7E878F ->
  #7B848C, chalk circlet #8C887F -> #858178, rim #928E85 -> #8B877E (-1 / -2.7 / -2.7 L*); Serenade felt hood
  #9A846A -> #917C64, cap #93806A -> #8B7964 (-3.2 / -2.8 L*). Rebuilt both: 3961 / 3970 tris (unchanged), accent 5.96 %
  both (unchanged), three load test + QA OK. Re-measure: _harness/_reports/fw_CW4_final_wick_sweep.json.
