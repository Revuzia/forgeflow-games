# glimwick (caster wick) Art 2.0 build: progress

Owner of this log: the glimwick builder. Module: `art/blender/units/wick_glimwick.py`; fit check:
`art/blender/proto/wick_glimwick_fit.py`; outputs `art/out/units/glimwick_{aubade,serenade}.glb`,
renders `art/renders/units/three_glimwick_*.png`, `_glimwick/` working images.

## Milestones
- 2026-10-20 10:25 start. Read the brief (§0-§6, glimwick §3.2), both concepts, wick_common, marund.py,
  marund_v2.py / odrum_fit.py, the pipeline (projection, bake, binding, clips, load test, three QA).
  Concept plates already cut (art/.cache/concept/wicks/glimwick_*). Measured on a 10 cm grid
  (art/.cache/glimwick/grid_*.png): Aubade 1174 px/m (knob top 0.997 m, hood crown 0.953 m, plate top row 205
  = 1.026 m); Serenade 1032 px/m (dome top 0.96 m, plate top row 169 = 1.139 m).
  Plan: SDF sculpt per faction fitted to the concept; the prop layout follows the brief (pole tip 1.32 m, crook
  at 1.20 m reaching 0.17 m forward-out, lamp centre 1.08 m) in BOTH factions (same job silhouette); props take
  the baked procedural bible materials, the body takes the projected painting pulled toward the faction palette.
- 10:45 module written (wick_glimwick.py: both faction sculpts, right arm re-seated on the pole, x_lamp_1 chain,
  4 posed skirt bones x_skirt_{f,b,l,r} with a custom cloak binding, paint finishing pass, bespoke idle/run/
  attack1/death). Fit check proto/wick_glimwick_fit.py: body IoU Aubade 0.70/0.72, Serenade 0.76/0.77 (front/back),
  64 px faction IoU 0.89. First fast Aubade build: load test OK, 3335 tris, 386 KiB, accent 3.69 %.
  Review (unit-mode clip sheet _glimwick/unit_aubade.png): forms + clips work (pole tips 20 deg on the hit, the
  death topples the pole and piles the cloak) but the paint reads near-white (palette cloth2 #BFC6CC pulled the
  hood pale: the "white hood" problem again), accent too low, tris over 3.0k.
- 11:10 v2 fast build of both (blue Aubade linen #A2B3C5 instead of the near-white role colour, accent sash on
  both, bigger lamp + seam). Aubade 3336 tris / 386 KiB / accent 6.03 % (top half 51 %); Serenade 4147 tris /
  390 KiB / accent 5.77 % (46 %). Load tests OK. Review renderer: art/.cache/glimwick/three_view.mjs (--review:
  close turnaround, 52 deg camera zoomed x5 with ally/enemy tint, key poses) -> _glimwick/review_<faction>.png.
  Problems: the palette pull averaged hidden texels too (visible paint too light: Serenade cloak tan, dome cream);
  Serenade crown band floats off the dome; both hood glows read as a flat visor bar; Serenade over 4k tris
  (off-axis parts do not decimate under X symmetry: knob 278, sash 320).
- 11:47 v3 builds (robust visible-paint mean for the palette pull, felt cowl rim hugging the dome, tris trimmed):
  Aubade 2986 tris / 375 KiB / accent 7.05 % (top half 52.9 %); Serenade 3260 tris / 332 KiB / accent 7.86 %
  (52.5 %). Load tests OK. Concept vs model sheet: art/renders/units/glimwick_compare.png.
- 14:05 (resumed after the usage-limit pause) close-up QA mode added to three_view.mjs (--close: head close-ups,
  game camera x9 / x5) -> _glimwick/close_<faction>.png. Findings: Aubade rim_line accent breaks into blue dashes
  along the rim; the waist sash reads as a floating hula-hoop at the game camera; hood glow is a flat slab (reads
  as a mouth); cloak hem facets look crystalline; knob is a faceted diamond. Serenade: the collar roll is a hard
  faceted strap (too few tris), the full lining ring + the band read as diving goggles / porthole, jagged hex
  opening ring, glow blob at the bottom. Plan v4: Aubade accent piping down the stole edges (vertical = dawn
  lines) instead of the hoop, drop rim_line, "sunrise" half-disc hood glow, more cloak/knob tris; Serenade: open
  arch lining (no closed ring), level band higher on the dome, rounder roll with more tris, hollows pushed forward.
- 14:55 v4 (fast builds, 5 iterations): Aubade rim_line + waist hoop dropped; accent piping (2.6 cm) down the inner
  stole edges; seam 3.1 cm; lantern scaled x1.1; knob 96 tris (round, not a diamond); softer cloak folds
  (vfolds soft=0.7, 760 tris). Serenade: no lining ring (goggle/porthole read gone); crown band levelled (6 deg)
  and lifted clear of the opening, 220 tris (no wavy edge); the felt frame hugs the CARVED dome and thins to
  nothing over the arch top (the flap / ear tabs are gone); collar roll 460 tris (round, not a strap). Both: the
  ink back wall is part of the hood/dome mesh (baked alone it came out as lit glossy black shards); the glow is a
  flat pool in the trough behind the lower lip (head-on it hides; a stand-up glow read as a mouth); paint finish
  adds flank refill, rim-ink for the faces turning into the hollow and a padding re-bleed (light seam lines gone).
  Fit (proto/wick_glimwick_fit.py): body IoU Aubade 0.85/0.85, Serenade 0.82/0.82, 64 px faction IoU 0.89.
  Fast stats: Aubade 3195 tris / 366 KiB / accent 6.19 % (top 63 %); Serenade 3574 tris / 324 KiB / 9.39 %.
  Clip sheet (_glimwick/unit_<faction>.png) checked: idle sway, run (feet planted, pole tipped), attack1 (pole
  tips + lamp swings out at 40 %), death (pole topples right, wick sinks into the cloak pile) all read.
- 15:00 FINAL full builds (--clip-sheet): Aubade 3195 tris / 356 KiB / accent 6.19 % (top half 63.3 %); Serenade
  3574 tris / 320 KiB / accent 9.01 % (top half 60.2 %, after thinning the waist sash to 2 cm). Load tests OK,
  facing +Z, heightPx1080 69. Renders: three_glimwick_{aubade,serenade}.png, three_clips_glimwick_*.png,
  glimwick_compare.png (concept vs model + game camera), _glimwick/{review,close,unit}_<faction>.png.
  Open: Serenade accent sits above the brief's 4.5-6 % (inside the task's 6-12 %); the pipeline warns >6 %.

## Fix pass (independent review, 2026-10-20 15:20)
Review findings (major): Serenade hood reads as a helmet with a black visor (convex lit ink egg, band like a
headband, glow bar = mouth); accent has no value contrast on its hosts (azure on the pale Aubade hood, marigold on
the sand dome); the lamp is the smallest light (Serenade waist sash borrows brightwick's marker, 9 % total); paint
finish below the Marund bar (Aubade hood patches, thin crumpled chalk rim, ~10-gon opening; Serenade dome baked
highlight + lobes, wobbly hem bands; both hollows a lit convex egg). Minor: Serenade pole tip a spike, glow a flat
bar, run boot clips the cloak, no left-palm push on the impact frame, Serenade death a "frying pan", IoU vs
shieldwick at the gate, tris over 3.0k, ORM metal leak + unpadded roughness, value bands (Serenade mid dark,
Aubade feet light).
- 15:20 plan: both hollows become a tall ARCH pocket (tapered, concave, inked by depth; no back-wall egg), the glow
  one wide ellipsoid set back 5 cm low in the hollow; Aubade carved chalk rim as an arch frame hugging the hood
  (3.4 cm, block joints painted), Serenade dark felt arch frame + a tilted crown band (high over the arch, low at
  the nape) in a painted ironstone channel; Aubade seam in a painted slate channel; drop the piping and the sash;
  bigger lamps (the biggest accent share), slate lantern mullions; paint = palette base + top light + the concept's
  fine strokes only (3D low-pass detail transfer: no patches, no baked highlights), crisp painted Serenade hem
  bands + dome panel seams; round Serenade knob; run skirt flare follows the forward foot; attack palm push by IK;
  a heaped (not flat) death pile; ORM: metallicFactor 0 + roughness padding (wrapper on bake.bake_asset).
- 16:25 fix builds 1-4 (fast; the machine is loaded, ~8 min per build): Arch / ArchPocket / arch_frame in the
  module; both hollows now a tall dark arch (Aubade 19 x 21 cm in a 3.4 cm carved chalk rim, Serenade 21 x 22 cm
  in a dark felt roll that runs into the collar); glow one ellipsoid 8.5-9 cm back, low, half behind the lip
  (a "rising" pool of light, no mouth bar); every painted texel inside the pocket is ink (the cloak top seen
  through the Serenade opening was a light patch); paint rebuilt as palette colour + top light + gradient + the
  concept's strokes (3D low-pass detail transfer) -> the Aubade hood patches and the Serenade dome highlight /
  lobes are gone; seam / band on painted slate / ironstone channels; Serenade hem bands crisp paint with
  stitching, dome panel seams, quilted collar; Aubade slate hem band. Piping + sash dropped; lamps 21 cm with
  dark mullions / cage. Decimation stalls (surface-nets non-manifold edges on thin tubes: resin rings 558 tris,
  cage 372) fixed by weld + triangulate + non-symmetric collapse. AO reach 10 cm (the lamp baked a dark patch on
  the dome). ORM: metallicFactor 0 in the GLB; the roughness fill needed img.update() before save (fixed).
  Accent shares (camera-projected, 4 facings): Aubade lamp 48 % / seam 34 % / glow 18 %; Serenade band 46 % /
  lamp 40 % / glow 14 % (band to trim).
- 16:40 fix builds shipped (Aubade 3012 tris / 352 KiB / 5.97 %, Serenade 3028 tris / 325 KiB / 5.78 %).

## Fix pass 2 (independent review, 2026-10-21 00:07)
Review findings (major): the hood glow read as a face (a hard lozenge on the lower lip: a tongue up close, a
single eye in the Serenade's dark felt ring at the game camera); the accent trims were broken (the Aubade seam
tube lifted off the cowl in blue spikes, ended in a black tab at the nape; the Serenade band floated past the
dome and missed its painted channel; the resin rings on the lamp decimated into tan shards); painted ghosts and
stains (white stole spikes on the Aubade cloak, torn shards at the hem split, dark blotches on the dome, a lit
strip in the Serenade hollow) and thin fold painting; the Serenade cloak lost its warm dark umber (pale dusty
pink-beige, mantle and cloak one light mass); the Serenade boot pushed through the bell cloak on every run
stride. Minor: lamp not the biggest accent share; Aubade drift (near-white hood, faceted knob, blob lantern cap,
thin rim); crude mitts; glossy accent (white glints); Serenade hem hid the boots, light feet band; tris just
over 3.0k; stale QA images.
- 00:15 diagnosis: the seam / band were closed volumes decimated to 64 / 148 tris (a triangular tube section,
  straight chords cutting the dome); the stole shards were the folded cloak surface cutting through a stole
  shell laid on the UNfolded profile; the dome "blotches" are real-time shadows of the lamp / crook (they vanish
  with --strip shadows), not paint; the Serenade boot swing overshot 6 cm forward at 8-12 cm height (gen_run's
  swing path) right through the bell above the hem.
- 00:20 new helpers in the module: surface_strip / surface_path / ribbon (accent strips as tent-profiled ribbons
  lying ON the uncarved hood / dome surface, 4 tris per segment), hex_roof (crisp pointed hexagonal roof),
  make_low (clean UV-ellipsoid lows for the knob, the glow, the globe; ribbon lows for the strips; the decimated
  SDF mesh otherwise, re-decimated without symmetry when it stalls > 4 %), proto/wick_glimwick_preview.py
  (every part meshed + decimated exactly as the build, flat colours, EEVEE: forms in ~40 s instead of a build).
- 00:35-01:40 builds 1-9 (both factions in parallel, 2-3.5 min each now that the machine is idle):
  * glow: a flat POOL of light (10.5 x 6.4 x 2.2 cm) lying on the hollow's floor 7 cm back, its ends running
    into the floor corners; a team-neutral painted spill round it; never upright in the opening. The Serenade
    dome is carried down inside the collar so the hollow has its own floor (the pocket had cut through the old
    dome bottom and showed the mantle / cloak tops as a pale shelf); the body seen through the opening is inked
    over a deeper box; the felt roll's lip faces inside the arch are shadowed.
  * seam 2.8 cm ribbon from under the rim's top over the crown, tapering to a point at the back (no nape tab);
    band 2.3 cm ribbon on a plane tilted 16 deg (just over the frame at the front); slim 7 mm dark beds each
    side, painted only where the strip is. Ribbon winding fixed (normals out: the first build culled them).
  * accent material matte (roughness 0.85 via extra_materials): no white glints.
  * paint: the concept transfer masks projected texels far from the part's own value (ghost stoles, stains),
    ratio clamp 0.88-1.13; new form value structure (_cavity: ridges / carved edges lighter, creases darker),
    analytic fold paint from the cloak's own displacement (+-20 %), a richer shade side; the cloak folds are
    smoothed away under the stoles and the front (flat chalk stoles, 7.5 mm proud), a clean 9 cm V parting
    with a dark lining, the hem underside lining, dark open cuffs.
  * Serenade: cloak #6A3F2A (warm dark umber, h20), sleeves #6C4129, mantle #B5966E, dome #D4B78F; the frame's
    upper arch painted a mid felt (#7A6250) so frame + collar no longer close into one dark ring; hem lifted to
    9.2 cm (the boots show), hem bands moved with it; lamp: globe 18 cm in six ironstone meridian bars meeting a
    foot dish, domed lid, a glossy lampresin drop (the thin resin rings are gone).
  * Aubade: hood #9AAFC8 blue-grey (not the old near-white), rim 4 cm x 2 cm with painted carved blocks (keystone,
    joints, bevels), knob a round 5 cm chalk ball (UV-sphere low), lantern: dawnglass core between slim slate
    corner posts at the hexagon's corners (they had sat off the flats), chalk plates, pointed hexagonal roof
    with a ball, chalk drop.
  * mitts: the sleeves end in a flat-cut open cuff (rounded rim) inked inside; the fist wraps the pole with a
    knuckle roll and thumb and runs a wrist drum up into the cuff (no hoop, no pale sleeve stump inside); the
    left hand is an open mitten turned palm-forward with the fingers tipped forward and cupped, thumb apart.
  * run: custom scurry feet (planted contact at the exact ground speed, a 4 cm swing straight back to the front,
    no overshoot, no heel kick): boot vertices outside the cloak now only below z 0.063 (Serenade hem 0.092) /
    0.105 (Aubade hem points 0.10-0.14, V parting); before: up to 0.207. Death: the fallen pole lies level, the
    lamp stays above the ground.
  * ORM: the roughness fix never reached the GLB (saving a loaded image after foreach_set wrote its old file
    buffer; the exporter packs from the file): now written through a fresh image and reloaded, and the
    border texels the 1024 -> 256 downscale mixed with the empty gaps are refilled too (they caused glossy
    sparkles at UV seams). Exported G < 0.04: 18 % -> 0.07 %.
- 01:42 FINAL (--clip-sheet): Aubade 2973 tris / 330 KiB / accent 5.2 % (top half 83.5 %); Serenade 2989 tris /
  286 KiB / accent 5.86 % (top half 81.1 %). Load tests OK, facing +Z, heightPx1080 69 / 70, mesh top 1.32 /
  1.335 m (pole tip; hood crown 0.955-0.96, knob 1.00). Accent share at the 52 deg camera (8 facings): Aubade
  lamp 57 % / seam 36 % / glow 7 %; Serenade lamp 54 % / band 40 % / glow 6 %. Game-chain lineup (Cycles,
  map_rift light): value bands Aubade 69 / 51 / 37, Serenade 63 / 33 / 23 (the dark umber cloak is the concept's
  value idea; shieldwick_serenade 74 / 36 / 20); IoU64 glimwick vs shieldwick: Aubade 0.78, Serenade 0.76
  (<= 0.80); across factions 0.86 (>= 0.70). Fit (body vs concept): Aubade 0.85 / 0.85, Serenade 0.82 / 0.81.
  Regenerated: three_glimwick_*.png, three_clips_glimwick_*.png, glimwick_compare.png,
  _glimwick/{review,close,unit,fit_*}_<faction>.png, sil64.png. (_glimwick/unit_*: the unit mode's head-bone
  facing check reports FAIL for a biped; the pipeline gate, bind-pose toe direction, is +Z.)
  Open: the Serenade hollow floor reads as a dark flat shelf up close (lit from above); the right fists are
  still blocky at close range; the Serenade top band sits at L* 63 (dark roll + hollow in the top quarter).

## Fix pass 3 (independent review, 2026-10-21 02:00)
Review findings (major): the Aubade run clip shreds the chalk stoles (the skirt-bone flare pushes the cloak through
the separate stole shells: torn shards on every run frame; a ragged notch in idle side view); the Serenade hollow
reads as broken hardware (a flat dark floor slab with glossy black blades at the lip, mid-brown lit walls with a
back panel, a hard octagon glow decal); the Aubade hollow is a faceted box and both glows are flat stickers (a
tongue on the rim head-on, a pupil in a socket at the 52 deg camera, worst in the Serenade's dark ring); the paint
is flat palette fills (vinyl toy, not hand-painted), faceted silhouettes at hover range. Minor: Serenade mantle
off-concept (narrow puffy slab, V notch; the thick dark felt face roll became a thin light arch); Serenade palette
drift (terracotta-rose cloak, near-cream dome / mantle, light dashed hem bands); the Aubade seam stops as a blue
dagger at the upper back, hood back an unmodelled blob (no nape fold); lamps are flat accent (no glass / core);
dome panel seams pucker at the crown; death leaves the mitts sticking out of a flat cloak disc.
- 02:10 plan: (1) the stoles become part of the cloak mesh (one SDF union, painted chalk by a mask), so no
  deformation can push cloth through them; (2)+(3) the hollow: an accent EMISSIVE RAMP (a 256 x 4 grey ramp as
  the accent material's base-colour and emissive map, per-vertex U = light intensity) so the glow is soft light
  falling off into the ink with no visible edge (the renderer only re-tints color / emissive; the maps stay);
  the glow becomes a wide light lining the floor and lower back of the hollow (a "rising light", not a disc);
  ink painted by direction (any texel within 2 cm of the pocket that faces into it), deeper = darker; rounder
  pocket back; the Serenade dome carried down to a thick floor (no thin slab to shatter); (4) richer paint
  (fold light design, linen / felt stroke texture, edge light, hood nape fold), tris moved to the silhouettes;
  minors as listed.
- 2026-10-27 08:45 resumed (session break). State found: fix pass 3 is in the module (02:58 Oct 21) and in the 03:02
  GLBs (stoles unioned into the cloak, nape chevron fold, PAINT_STYLE brush finish, Serenade lobed capelet, the
  accent EMISSIVE RAMP: lining glow + lamp cores) BUT the shared three.js load test FAILS on both GLBs: "accent must
  be factor-only (the renderer tints it)" (art/tools/three_load_test.mjs: no map / emissiveMap on `accent`). The
  ramp is out. Preview of the hollows (EEVEE flat colours): the lining reads as a big flat screen; the Serenade
  floor is a mess of facets (floor_recess step + roll cut faces) with jagged lining spikes; Aubade pocket a box.
  Plan: factor-only accent; ONE hood light = a wide low ellipsoid sunk into the hollow's floor 9 cm back (brief
  0.2) with a team-neutral painted spill round it on the ink walls; a bowl-backed pocket, no floor recess.
- 09:00-10:05 factor-only rework (builds 1-7, both factions in parallel, ~2.5 min each):
  * the ramp code is gone (RAMP, _glow_lining, _apply_accent_ramp, floor_recess); the GLBs pass the shared load
    test again (accent: no map / emissiveMap).
  * hood light, five tries judged in the new hood QA (three_view2.mjs --hood: the 52 deg camera x12 on the head,
    ally + enemy tint, 4 facings): a floor ellipsoid and a wall-to-wall floor pool both read as an IRIS in an eye
    from the game camera (the chalk rim the lids, the grey painted spill ring the sclera); a flat floor band as a
    mouth slit at eye level. Kept: HoodLight = one small flame (3.6 cm wide, 7.4 / 8.2 cm tall) standing in a
    shallow chalk / ironstone dish 8 / 7.6 cm behind the opening, LEANING 15-20 deg back (upright, the 52 deg
    camera foreshortened it to a round dot = a pupil; the first lean went the wrong way, toward the camera).
    Its glow is a dim team-neutral spill painted only on the walls behind it.
  * sill: the Aubade rim's bottom stands 3 cm up across the opening (arch_frame inner=A_fr), so at eye level the
    flame's foot hides behind it (a candle in the hood, no "tongue"); the Serenade collar is no longer cut by the
    pocket (cut, it decimated into the jagged bowl / dark blades) and tilts 18 deg (front lower) to be the sill;
    the felt frame ends sink into it (arch_frame y_min) instead of crossing the bottom.
  * pocket: bowl-shaped back (no flat back wall / box). Ink: everything inside the void behind the opening is
    ink whichever way it faces, and the ink texels are ORM roughness 1 + occlusion 0.06 (the lifted AO let the
    sky's indirect light + 4 % specular grey the up-facing ink into a lit shelf with "lips").
  * seam 2.8 -> 3.2 cm, band 2.3 -> 2.7 cm (accent 5.4 -> 5.7 %); softer quilting on the Serenade frame /
    collar and softer Aubade rim joints (at 52 deg they read as teeth round the opening).
  Fast stats (build 7): Aubade 2949 tris / 369 KiB / accent 5.70 % (top half 83 %); Serenade 3066 tris /
  301 KiB / 5.76 % (81.5 %). Load tests OK both.
- 2026-10-27 09:52 FINAL (fix pass 3 done; both built with --clip-sheet): Aubade 2949 tris / 369 KiB / accent
  5.70 % (top half 83.1 %); Serenade 3066 tris / 301 KiB / accent 5.76 % (top half 81.5 %). three.js load test
  OK both (the accent is factor-only again), facing +Z, heightPx1080 69 / 70, mesh top 1.32 / 1.335 m (pole tip;
  hood crown 0.955-0.96, content height 1.0). Fit (body vs concept, proto/wick_glimwick_fit.py): Aubade 0.845 /
  0.852, Serenade 0.811 / 0.810; 64 px IoU across factions 0.868 (>= 0.70).
  Renders: three_glimwick_{aubade,serenade}.png, three_clips_glimwick_*.png, glimwick_compare.png (concept vs
  model + game camera), _glimwick/{review,close,hood,unit,fit_*}_<faction>.png, sil64.png. hood_<faction>.png is
  the new hood-light QA (52 deg camera x12, ally / enemy tint, 4 facings + whole wick).
  Open: accent 5.7 % sits in the brief's 4.5-6 % band, under the task's 6-12 % aim (the lamp is the biggest share;
  the flame is small by design); the paint is cleaner than the concept's brushwork (palette fills + top light +
  folds + transferred strokes), not a full hand-paint; the lamps are flat team colour in dark frames (no glass /
  core: the accent cannot carry a gradient); the Serenade frame's lower ends still make two small felt lumps
  beside the flame from the game camera.

## Fix pass 4 (independent review, 2026-10-27 10:10)
Review findings (major): (1) the Aubade hood reads as a single EYE from the game camera (white carved rim = eye
white, dark hollow = iris, pale chalk dish + flame = pupil; the Serenade one a teardrop nose in a dark ring under a
headband); the flame is upright, not the brief's wide soft ellipsoid; (2) accent too small (true-scale 52 deg: 4.4-
5.7 %, shieldwick 6-12 %; the hood a black hole with a 2 px dot) and the hood marks sit on hosts of their own hue;
(3) paint far below Marund (flat palette fills, vinyl toy; crumpled chalk crook elbow / cord hook, wobbly kinked
Serenade cage bars, octagon knob; lamps flat team colour with no dawnglass / lampresin; the pole eats 12-15 % of
the atlas). Minor: Serenade drift (thin frame, narrow lumpy mantle, mauve cloak, sweatband band), Aubade closed
front / no forearm wraps / parka rim; faces in the paint (the hood-back V fold + seam + nape notch = an angry
face; the Serenade dark frame + collar + drop = a bearded face); death ends as a rigid faceted "lampshade" cone,
the pole falls forward-right; run boots sink 1.5-2.3 cm, the swing lifts 3.5 cm (a shuffle); Serenade 3066 tris,
normal 512; the lamp overlaps the pole / hood at 3/4 and side facings; the dark Serenade pole vanishes on dark
ground.
- 10:25 plan: (1) the hood light becomes ONE wide soft ellipsoid of lamplight lying in the bottom of the hollow
  (wider than tall, set back ~3.5 cm, its sides and foot sunk into the walls and floor: no dark ring round it, no
  dish, no flame = no iris / pupil; the dark is only the crescent under the brow); the Aubade opening becomes the
  concept's BELL arch (narrow round top, flared foot), the rim 3.4 cm of carved chalk (not a white ring); (2) the
  hood marks get broader and gain the concept's two side panel seams (Aubade), the Serenade band sits on the
  dome / roll junction (the concept's lit lip over the opening, round the back on the collar top: no sand under
  it = no headband), every strip in a dark bed; bigger lamps with glass + core; (3) the concept projection carried
  through much more strongly (wider detail transfer + its chroma), clean low-poly tubes for the pole, crook, cord,
  cage bars, a round knob, the lamps rebuilt with dawnglass / lampresin panes round an accent core; prop UV weight
  cut. Then the minors (death heap, run feet, hood back, Serenade roll / mantle / cloak colour, budget).
- 10:30-11:35 fix builds 1-5 (fast, both factions in parallel, 2-5 min each on a loaded machine; forms first in
  proto/wick_glimwick_preview.py):
  * HOOD LIGHT (item 1): HoodLight (flame + chalk / ironstone dish) is gone. HoodGlow = one dome of light (dome_mesh,
    14 x 3) lying in the hollow's floor, wider than tall, its front ~2 cm behind the opening, sides sunk well
    into the walls (Aubade 27 x 16 x 6.8 cm, Serenade 30 x 16 x 8.8 cm sitting ON the collar roll that fills the
    hollow's bottom: buried in it, only a slit showed = a mouth). Finding: the 52 deg camera sees the WHOLE hollow
    floor (the brow's sight line meets the floor ~16 cm back), so any light that does not fill the floor wall to
    wall leaves a dark ring round it = an iris. Now the opening reads as a hood full of light with a dark crescent
    under the brow. At eye level the Aubade light is a broad flat horizon (the first narrower dome read as a
    tongue); the Serenade one shows over the collar as a lit band (eye level only; never seen in play).
  * Aubade opening = the concept's bell arch (round top 14.4 cm, foot 19.4 cm); rim_mesh: a clean 3.4 cm carved
    chalk band on the cowl (inner wall, chamfers, flat face, fall; split vertices = crisp creases), tint #CBC7BC
    (less of a white ring), no sill. Hood back: the V chevron fold + nape notch dropped (the "angry face", item 5).
  * HOOD MARKS (item 2): Aubade centre seam 3.2 -> 4.2 cm + the concept's two side panel seams (3 cm meridians at
    +-82 deg: on the flanks, never ringing the opening; at 68 deg they framed it like brackets); 1.1 cm slate beds.
    Serenade: band 2.7 -> 4 cm, its centre line computed per azimuth where the felt roll meets the dome
    (s_band_table, vectorised surface_path_v): the concept's lit lip over the opening, the dome / collar seam at
    the back, never on open sand; a 4.5 mm felt welt above it (the dome's lid edge, shadow crease + stitches);
    and the Serenade family's mantle band (2.2 cm along the scalloped capelet hem, bound like the capelet): the
    side / back read was 3.6-3.9 %. (At 3 cm it pushed the top-half share to 55 %; 2.2 cm -> 62 %.)
  * LAMPS (item 3): Aubade: accent hexagonal core seen through dawnglass pane borders (proc dawnglass), slim chalk
    posts, chalk plates / roof / drop. Serenade: a lit core band (-50..50 deg) between lampresin shoulders, six
    ironstone cage straps as ribbons lying on the globe (no more kinked tubes), domed lid + knob, dish, drop.
    Lamp layout: crook at 1.20 m reaching 0.15 m out + 0.13 m forward (was 0.115 / 0.155), lamp centre 1.062.
  * CLEAN PROPS (item 3): tube_mesh / lathe_mesh helpers: pole (6-sided taper), Aubade spire finial (turned),
    crook + brace (clean tubes, no crumpled elbow), cord; Serenade pole 5.2 cm with two sand-felt bindings (item
    9: the 3-4 px dark pole vanished on dark ground), a turned ironstone knob (was an octagon), crook end cap.
  * PAINT (item 3): the concept transfer widened (clamp 0.88-1.13 -> 0.66-1.40, low-pass 3 -> 4.5 cm, detail
    0.25-0.35 -> 0.6-0.75 on hood / cloak / dome / mantle / roll) plus its chroma variation; up-facing tops excluded
    (the plates' outline stroke made a dark "X" / "V" scar on the dome crown); Aubade open front (pleated tunic +
    wrapped sash between the stoles) and wrapped forearm bindings (item 4); Serenade cloak #614534 -> #79533A and
    a warm shade (the blue-cool shade made it mauve, item 4); smart-project UV limit 62 -> 74 deg and prop UV
    weights 0.1-0.35 (the pole had 12-15 % of the atlas, now ~4 %).
  * MOTION: run (item 7): the ankle is lifted by what the foot pitch pushes under the ground, the swing peaks at
    6 cm early (inside the bell), the pole is carried 5 cm off the ground. Measured (feet30, 30 fps): boot zmin
    -0.002..+0.010 at contact (was -0.015..-0.023), swing peak +0.065 (was +0.039), body zmin -0.002 (was -0.032).
    Death (item 6): the pole topples to the RIGHT (yaw 12, was 40 = forward-right) and lies there; hips sink 10.5
    cm (not 14.5: that forced a 37+ deg flare = the flat "lampshade"), skirt bones flare unevenly 17-33 deg with
    sideways swings (a lumpy heap), the hood droops forward, the left mitt folds in across the front.
  * Budget (item 8): Aubade 2880, Serenade 2994-3028 -> trims (cloak 420, band 36 stations). Normal map kept at
    512 (the brief allows it when folds go mushy: the Serenade piping / stitched bands and the Aubade stole edges
    are normal-map relief), ORM 256; GLBs 327-358 KiB.
  * True-scale accent (reviewer's mask method: 52 deg ortho, 82.1 px/m, x4 supersampled, 4 facings), build 4:
    Aubade 10.0 / 9.3 / 7.3 / 7.5 % (yaw 0 / 35 / 90 / 180; was 4.4-5.7), Serenade 8.8 / 8.4 / 6.2 / 6.7 % (before
    the mantle band was narrowed); shieldwick 10.6 / 9.1 / 6.1 / 5.2 and 11.8 / 10.1 / 9.9 / 10.2 for scale.
- 11:20 Serenade hollow at 52 deg still showed a dark band under the light (the felt roll's inked lower bore: a
  lit bar in a dark ring = a visor): the light moved forward (front 0.6 cm) and HoodGlow.floor_spill paints the
  team-neutral spill on the up-facing floor in front of it -> the opening reads as a lit window in the dark roll.
- 11:35 FINAL (fix pass 4; full builds with --clip-sheet): Aubade 2880 tris / 344 KiB / pipeline accent 8.66 %
  (top half 75.9 %); Serenade 2992 tris / 311 KiB / 8.57 % (top half 61 %). three.js load test OK both (factor-only
  accent, skeleton binds, run planted foot-speed error 2.2 %), facing +Z, heightPx1080 69 / 70, mesh top 1.32 /
  1.33 m (pole tip; hood crown 0.955 / 0.96, content height 1.0). True-scale accent (52 deg, 82.1 px/m, x4, yaw
  0 / 35 / 90 / 180): Aubade 10.0 / 9.3 / 7.3 / 7.5 %, Serenade 10.0 / 9.8 / 6.2 / 6.2 % (task aim 6-12 %; above the
  brief's old 4.5-6 % band on purpose, the pipeline's > 6 % note is expected). Fit (body vs concept): Aubade
  0.845 / 0.852, Serenade 0.810 / 0.809; 64 px IoU across factions 0.856 (>= 0.70). Run feet: boot zmin -0.002 ..
  +0.010 at contact, swing +0.065, body zmin -0.002.
  Renders: three_glimwick_{aubade,serenade}.png, three_clips_glimwick_*.png, glimwick_compare.png,
  _glimwick/{review,close,hood,unit,fit_*}_<faction>.png, sil64.png, lineup52_x2.png (true-scale 52 deg lineup x2,
  yaw 0 and 35, glimwick ally / enemy both factions + shieldwick / greatwick for scale).
  Open: at EYE level (never in play) the Serenade light shows over the collar as a lit band (a visor read in
  close-ups only); the death heap is a rigid cloak on 4 skirt bones (uneven, hood drooped, no longer a flat
  disc, but not a soft crumple); the Aubade rim's split-normal creases may be softened by the pipeline's join;
  the paint is the concept's strokes over palette colour (much richer than pass 3) but not Marund's full
  projected painting; normal map kept 512 (brief allows it for the piping / stitched bands).

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
- glimwick (review r3 BLOCKER): the wide dome lying on the sill (HoodGlow) replaced by HoodCore: a 7.6 x 4.8 cm core (A),
  8.2 x 5 cm (S) centred at 0.47 / 0.45 between the sill (the Serenade collar roll) and the arch top, 3.2 / 3.0 cm back,
  with the shared halo; the hollow's ink no longer pools light at the bottom (radial team-neutral spill only).
  Palette (target 3): Aubade cloth on the shared palette read - hood #6C7279, cloak #4A525C, sleeves #4F5761 (were
  #93A9C3 / #5B6F88 / #63778F, 25-32 % sat in the azure band), a quieter cool shade, and the lamp's pane borders a smoked
  #56677A (the pale blue dawnglass round the core sat on the ally azure's hue and value). Serenade dome #978165 (top light
  0.12), mantle #9C8466, cloak #715444, sleeves #735645. Tris: S roll 330 -> 300, knob 7 sides, mantle 250.
  Gates: A 2956 tris / 334 KiB / accent 8.10 % (top half 79 %), S 2998 / 312 KiB / 7.99 % (62 %) - above the brief's
  4.5-6 % as accepted in round 2 (was 8.66 / 8.57); load test OK, clips present.
  In game: Aubade under the ally azure dE76 46.2-47.1 (was 32-34; dL 16-19), under marigold 74-77; azure band 0 % (was
  34 %), body chroma median 9-11 (was 18); hood top quarter A 61-64 (was 71-73), S 63-66; Serenade dE76 68-74.
  Open: from the 52 deg camera the Serenade core sits partly behind the thick brow roll (the halo shows under it).
