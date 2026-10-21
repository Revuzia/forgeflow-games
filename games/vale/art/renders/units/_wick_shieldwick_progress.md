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

## 2026-10-20 14:05 resumed (usage-limit break) - hollow + crown fixes
- Review of the 11:46 builds: Aubade hollow showed pale "shards", Serenade dome had a pale patch on the back
  (back-plate band-erase fill), tris 3.27k / 3.39k (brief target <= 3.0k).
- Serenade crown: `tops_full` (in the paint wrapper) re-blends the hood's top plate from n_z 0.10 (common paint
  uses 0.55-0.85) -> uniform felt over the whole dome, patch gone. Aubade hood gets the same from n_z 0.05.
- Hollow, three causes found one by one (flat-texture Blender renders with backface culling + face/texel probes):
  1. the rim's inward-facing tube faces took the rim's front paint -> `hollow_ink` inks rim / hood texels whose
     normal turns to the opening axis (inside the rim's centre line);
  2. the lining's palette-fit gain clipped at 0.2 (painted median 0.42) -> a mid-grey pool under the hood light;
     the lining is now pulled onto its ink (#101318 A / #15110D S);
  3. the Aubade scarf's top rose through the hollow floor -> scarf cut 1.5 cm under the carve, its inside inked.
  Also: `dilate_bake_maps` fills the rough/AO bakes between UV islands (common.bake leaves roughness 0 there and
  the 256 ORM mixed it into island borders); ORM 18K -> 9K.
- Tris trimmed (lining 380 -> 280, hood light 130 -> 80): 3118 (A) / 3244 (S); GLB ~395 KiB each.

## 2026-10-20 15:20 final pass (both factions rebuilt)
- Serenade opening lip fitted to a dark felt (#5C4A3B, brief §2.2 "dark felt rim"; it had read as a pale
  ring); hollow linings lifted a touch to navy #141A24 (A) / umber #1C150F (S) so they read as cloth.
- Gates: three.js load test OK, facing +Z, Aubade 3118 tris / 389 KiB / accent 6.21 % (63 % top half),
  Serenade 3244 tris / 395 KiB / accent 7.44 % (89 % top half); mesh top 1.089 / 1.087 m (content 1.1).
- 64 px IoU (scratchpad sil.py, front / game view): shieldwick A vs S 0.82 / 0.91 (>= 0.70); vs the other
  kinds max 0.75 front / 0.79 game (<= 0.80).
- Renders: three_shieldwick_{aubade,serenade}.png, three_clips_shieldwick_{aubade,serenade}.png,
  shieldwick_beauty.png (close 3/4), shieldwick_review.png (game camera, ally/enemy tints, lane crowd),
  shieldwick_clips.png (idle / run / attack1 / death strips, both factions).
- Note: a --clip-sheet three_snapshot hung once under heavy machine load (killed; rerun fine).

## 2026-10-20 15:47 FIX PASS start (independent review, 11 items)
- Majors: (1) hood light invisible at 52 deg on both (0.00 %), (2) painted defects (Serenade white patch under the
  right sleeve, white lantern-lid tip, white zig-zag cracks on both hoods, pale flecks in the S atlas top rows),
  (3) Aubade opening: porthole + thin jagged lip + shards + octagon pill vs the concept's arch + broad chalk rim +
  soft teardrop, (4) Serenade crown band lumpy / wavy / uneven -> clean inset glowing slit.
- Minors: ink grooves under accents (team-0 contrast), job silhouette (disc outline, mace), crisp hems, faceting
  on accent shapes + Aubade hood-back value step, stiffer clips (waddle, attack readability), tris <= 3.0k,
  Serenade accent 7.4 % -> spread, metallicFactor 0.
