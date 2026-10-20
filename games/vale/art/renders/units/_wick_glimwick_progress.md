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
