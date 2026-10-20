# shieldwick (Aubade + Serenade) build progress

Owner of: art/blender/units/wick_shieldwick.py, art/blender/proto/wick_shieldwick_*.py,
art/out/units/shieldwick_{aubade,serenade}.glb, art/renders/units/*shieldwick*.

## 2026-10-20 10:11 start
- Read brief §0-§6 (_design/units/wicks.md), wick_common.py, HANDOFF Art 2.0, marund.py, marund_v2.py, kemdo.py/_fit.
- Plates exist (art/.cache/concept/wicks/shieldwick_{aubade,serenade}_*), default cut. Masks checked:
  Aubade knob not in the cut (pale on pale background) -> knob painted flat chalk; plate top row 236 =
  z 1.04 on the measuring grid (hood dome top measures 1.00, knob top 1.10). Serenade plate top 220 = dome
  crown, measured at 1.08.
- Measured both concepts on a 5/10 cm grid (scratchpad grid overlays).

## 2026-10-20 11:00 first sculpt + build
- wick_shieldwick.py: both faction sculpts (parts_aubade / parts_serenade), per-faction arm joints in rig_extras
  (prop.R up the haft, prop.L along the shield normal), bespoke idle / run / attack1 / death, palette fit wrapper
  around project.paint_object (only active with PROJECTION["palette_fit"]).
- proto/wick_shieldwick_fit.py -> art/renders/units/shieldwick_fit_{aubade,serenade}.png (silhouette overlay):
  both fit the concepts; Serenade hood lip rebuilt as a tube along the cut edge (a planar ring floated).
- First builds: surface-nets non-manifold edges stalled the decimator (hem band 4.5k tris) -> make_low():
  decimate, fall back to voxel remesh + decimate. Now ~3.2-3.5k tris, ~415 KiB.
- Review (scratchpad three.js review sheet -> art/renders/units/shieldwick_review.png): both read as distinct
  cultures, but far too pale on top (fit to palette medians blew out under the game sun) -> fit targets now a
  step under the palette (painted medians), Aubade hood blue linen L* 72, Serenade felt #C0A078.
- Accent 5.2 % (A) / 5.9 % (S) -> seam, band, shield inlay ring, lantern windows enlarged.
- Death legs fixed (were sticking up behind), wind-up raises the lantern above the hood.

## 2026-10-20 11:45 paint pass
- Top plates (TOPS, painted fields: cloth median + key light + brush patches + radial folds / felt mottle) for the
  hood, cloak, scarf (A) and hood, collar, mantle, cloak (S): the front/back projection had streaked the silhouette
  top-edge highlight across every crown (near-white domes from the 52 deg camera).
- Region-limited glow erase (ERASE) on top of graded_projection: hood flame / Serenade hollow glow, painted seams,
  lantern panes, boss glow, the Serenade band; +7 px edge re-pad on the Serenade sheet (its pale rim-light outline
  left white streaks on the arms / shield edge).
- Hood lining vs hood inner surface interpenetrated after decimation (pale facets in the hollow): hood carve now
  1.2 cm outside the visible lining surface, lining 2.2 cm thick.
- Serenade lantern simplified (4 bars, larger accent globe), knob rounder, hood light smoother.
- Colours: Aubade hood #93A7BA (blue linen), cloak #62748A; Serenade felt #B0916C / mantle #B79A74, pads #AD9C80.
- Accent 6.2 % (A) / 7.4 % (S) at the game camera. Tris 3.18k / 3.32k, GLB 422 / 406 KiB.
