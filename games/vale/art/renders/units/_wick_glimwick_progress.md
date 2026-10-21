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
