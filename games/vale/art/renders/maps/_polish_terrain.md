# Terrain polish (lane TERRAIN) — progress log

Lane files: src/render/terrain.ts, terrain_glsl.ts, terrain_walls.ts, terrain_inlay.ts (terrain_clutter.ts, glsl.ts
untouched), content/maps/map_*.json art.terrain colours / $comment only (no props / landmarks keys). Work done in an
isolated copy (scratchpad vale/, own Vite on :5199) and copied back once green, so the shared :5190 never served a
half-built terrain.

## 2026-10-20 14:05 CDT — start
- Read _pass_terrain / _pass_props / _pass_structures, the three map briefs, STYLE_BIBLE, the integration shots
  (integ_rift_at*, integ_bridge_*, integ_fray_*).
- Found the terrain lane's unfinished FIX PASS from this morning (11:28–11:44, never copied back before the
  usage limit) in the isolated copy. Adopted it as the base after a typecheck and shots: jagged lit Snap crack
  with tapering crazing, camp rooms in ring flags with a hearth ring, plaza border kerbs, the Noonplate rim as one
  true circle (numerals moved inward clear of the rim lip), hour-band rings swept across each notch with planar
  end caps, far-wall buttresses, a fine inlay atlas (crisper strokes), Standing Shadow in long slabs with its own
  core wedge to the tip, Fallen Shaft fragments along the fall axis, shaft water roughness 0.5 (walkable ≥ 0.5),
  flat wall strips textured in world xz (no brushed-metal streaks), clean carved lips.
- Baseline (integ): BRIDGE gorge = flat black (L* < 10 under fog); FRAY plate slate L* ~42 in vision; RIFT block
  tops bare lime lawns (2.7 m grid, 60 % culled > 9 m, 5 m tree-free band south of landmarks, camp bands);
  Standing Shadow screen C* 21–27 (a purple sheet).

## 1. BRIDGE gorge — deep, not a void
- Far walls (map-border chasm edges): new `farWallProfile` (terrain_walls.ts): a rounded sunlit lip tucked under
  the plateau ground (no seam), then TERRACES — battered faces of 2.6–5.4 m ending on ledges that step 0.4–1.3 m
  toward the gorge (capped 8 m in), now and then an undercut bed. From 52° the wall reads as stacked lit bands
  narrowing into the depth, not a flat wall. Rock shader rewritten: fine warped laminations, sparse open joints
  of varied width (closed ones faint), broad stain / damp patches, damp streaks under ledges, up-facing benches
  pale and mossy, a pale edge light on the lip, warm-at-the-rim → cool-in-the-depths falloff. Rock colour
  #3A3E47 → #4D515B (map_bridge colors.rock).
- Height mist (GORGE_MIST_PARS): pale haze under the rim → deep cool blue (#5E6C93 ×0.5 → ×0.17), 0.06/m from
  −1.2 m, near-solid by −25 m. Height only, never camera distance. Applied AFTER the world fog of war (appended
  after <opaque_fragment>), and stone below the deck is lifted before the fog (gorgeFogLift) so unseen drop
  lands at ≈ ×0.75 value instead of ×0.55: it stays a drop under fog, never a black void (nobody can stand in it,
  so it hides nothing). Walkable ground keeps the bible's fog untouched.
- Three drifting mist banks (MIST_SHEET_*: −5.5 / −10 / −14.5 m, unlit, depthWrite off, renderOrder −1..−3 so
  VFX over the drop stay on top), fading out near every wall via the chasm field (no seams), the deepest
  carrying the river's faint winding glint and sparkles (cool, below bloom) where the camera sees past the deck.
- Rock columns: fewer (0.8 %/m²), wider (2.2–5.4 m), tops −2..−9 m, bedded bands, pale mossy sunlit caps,
  same mist. Needle fragments (props lane's rock/stone sets) now placed on the gorge's far lips (brief §5),
  never on the deck.
- Measured (tpol_bridge_nf_at0): gorge L* 21–23 in vision (brief 15–30), ~15–16 under fog (was < 10, flat).
  Still reads instantly as "not walkable": chalk hour-script band + lit lip, then the drop.

## 2. FRAY Noonplate — luminous dial-stone at the Shadowless Noon
- Plate: honed pale dial-stone (colors.lane #4A4A4E → #A19A8B) in rings of slabs, faint grey veins, satin sheen,
  per-slab warm/cool drift. Hour-lines and numerals inlaid DARK basalt (inscription #4C4945, like a sundial's
  cut lines), shop ring mid inlay (#7A766C). New carved hour-ring: a double groove inside the ten marks, one
  outside, a half-hour tick between every two marks and quarter ticks on the outer band (terrain.ts strokes,
  INLAY.groove; plate shader: dark channel + sunlit lip). Seat-colour groove rings unchanged.
- Measured: in vision L* 68–70 (p90 75), out of vision L* ~31 (fog of war still darkens it). Deliberate
  departure from the brief's "polished basalt L* 28–36" per this pass's direction; hour-stones and rim stay
  basalt, so obstacles read dark on the bright stage. Brief §3 table should be updated by the map lane.
- Empty prop roles: `loadTerrainProps` returns an explicit empty list for a role the map lists as `[]`, and
  setScatter draws nothing for it (trees, rocks, stones; stones fall back to the rock set only when the map
  names no stone list at all). FRAY already lists "tree": [], "rock": [], "stone": [] — no procedural fallback.

## 3. RIFT Dialwood density
- Tree spots: lip HEDGE ROWS of smaller crowns (×0.70–0.86) every ~1.55 m, 0.85 m inside every south and
  east/west lip (none along north lips), plus a body on a jittered 1.9 m grid (×0.8–0.94 within 3 m of an edge,
  ×0.92–1.14 to 6 m, ×1.06–1.44 deeper; 35 % fewer but larger past 7 m).
- Each spot stores its room; `treeScale` sizes the tree that lands there (variant's real H and crown reach R
  read from the GLB): crown over the SOUTH lip ≤ 0.8 m (the camera is south, so it hides nothing walkable), over
  east/west lips ≤ 0.5 m, north lips add no occlusion beyond the cliff's own (max(0.78H, 0.51H+R)·s ≤ dN + 0.3),
  ≤ 4 m within 3 m of a south edge, ≤ 9 m anywhere. The old camp band is subsumed by the north rule.
- Landmark band narrowed to what it needs: footprint + 0.4 m, and on its camera side the crown's top and widest
  ring stay under the sight line, letting the base sink ≤ min(1 m, 0.2·height) into the wood (was a blanket
  footprint +1.6 m / +5 m south band).
- Block-top floor: the lime "canopy floor" became the wood's own floor — a sunlit moss cushion along the lip,
  then dark understory with leaf drifts, so gaps between crowns read as depth.
- Census (props lane's census.mjs on this layout): 2373 trees (was 921), tree scene tris 1272k; walkable ground
  hidden by trees beyond the cliff's own cover: chest 20 m², chest+head 1 m² (was 19 / 0).

## 4. Gloss mask (shared interface)
- `propMaterial()`: MeshPhysicalMaterial (one program, no extra draws); with USE_COLOR_ALPHA the alpha of
  COLOR_0 is gloss: roughness mix(0.86, 0.42, g) + clearcoat 0.4·g at roughness 0.48 (softened from 0.55 / 0.30
  after the props lane saw one wet hot-spot per clump). No vertex alpha → exactly as before. A GLB whose alpha is
  1 everywhere (an exporter's opaque default) is treated as "no mask" and loaded as RGB; all-0 alpha is a real
  matte mask.

## 5. Standing Shadow — violet-cool stone
- Tint at stone chroma (20–36 % of #4A4560's saturation, leaning a touch warm against the blue sky ambient), per
  slab grey-slate / cool / plum drift, damp & dust mottling, worn paler arrises, dust in joints; value ×1.62.
  Hard engraved edge, arris and the core wedge kept; keepColor under fog unchanged.
- Measured (no fog): L* 31.3 (p10 26, p90 35), C* 12.3 (was 20.8–26.7), hue −62° (the brief's own tint is −67°).

## 6. Performance and checks
- `VALE_HEADED=1 node _harness/perf_1080.mjs --q high` (main :5190, Apple M5): quiet run 74.5 fps avg, p95
  14.8 ms, p99 15.2 ms, frameMs 3.4, 424 calls, 1.38 M tris; a second run while another lane's Chrome (262 % CPU)
  and two Blenders ran: 62.9 fps avg (p99 38.7 ms). Committed build before this pass: 59.7 fps, 408 calls,
  1.12 M tris (vsync-capped run). Per spot (RIFT 40,55 · 60,45 · 30,80 · 140,45 · 100,30): 1.39–1.63 M tris
  (committed 1.06–1.32 M), 386–463 calls, 60 fps in the quiet isolated runs; BRIDGE 0.71–0.77 M, FRAY 0.09–0.14 M.
- `npm run -s typecheck` clean; `node _harness/probe_maps.ts` 102/102; `node _harness/probe_content_ids.ts` PASS.
  Catalog rebuilt (`npm run content -- --allow-missing-assets`, 101 warnings = other lanes' missing assets).

## Shots
- Final, main :5190: _harness/_shots/tpol_rift_at0..4 (60,45 · 40,55 · 55,30 · 85,28 · 140,45, fog),
  tpol_rift_nf_at0..1 (60,45 · 85,28), tpol_bridge_at0..3 (60,14 · 40,30 · 78,22 · 60,5, fog),
  tpol_bridge_nf_at0..1, tpol_fray_at0..2 (32,32 · 20,14 · 44,20, fog).
- Before / after sheet: art/renders/maps/polish_terrain_before_after.jpg (integ → tpol).

## Open gaps (honest read)
- The gorge is a deep, misted, terraced canyon now, but the far wall is still front-lit stone seen almost
  face-on: the beds and joints read a little regular (quarry rather than wild cliff). A Blender far-cliff set
  (map lane) with real silhouettes, overhangs and hanging cords / prayer-lamps under the deck (brief §5) would
  take it to the bar. The river glint is faint by design and only visible where the camera sees past the deck.
- FRAY now departs from its brief's basalt value band; the brief (and minimap.png, painted L* 30) should follow.
- Trees roughly double the frame triangles (+0.3 M at RIFT spots); fine on High here, worth watching on Medium
  hardware (Low keeps 35 % of trees, Medium 70 %).
- BRIDGE stubs and the deck's broken edges get no fragments yet (only the far lips): a stub-top placement needs
  the stub GLB's top height per spot.
- The Standing Shadow's slab layout still reads tiled at a distance; a second, larger stone scale would help.

## 2026-10-20 15:20–16:30 CDT — FIX PASS (independent review, 9 findings)
Worked in the isolated copy (:5199), copied back once green; main's terrain files were untouched in between.

1. [major] BRIDGE mist seams → fixed. MIST_SHEET_MAIN no longer fades by the chasm field / distance past the map
   edge. terrain.ts slices every gorge surface (flank, terraced far walls and their buttresses, bands, rock stacks)
   at each sheet's height (`sliceAt`) and bakes the cut outlines into a 0.5 m distance texture (one channel per
   sheet). Each sheet fades out over the last ~3.5 m before any rock it meets, with a noisy (wispy) edge. The far
   walls' terraces now also dip and rise ±2.4 m along the wall (`yExtra` in sweep), so no bench runs level for
   150 m. In tfix_bridge_nf_at0 / at1 the stripes are gone; the rock joints are no longer seen through a band.
2. [major] BRIDGE "log" at x=78 → fixed. Chasm polygons that share an edge are merged into one outline
   (`mergeShared`) before the flank and far-wall sweep, the hour-script and the chasm field. There is no flank
   along the internal seam, and the far wall and flank run on across it (tfix_bridge_nf_at1/at2, 78,8 / 78,36).
3. [major] RIFT lime block tops → fixed. The block-top floor (WK.top) is now the wood's shaded understory, a step
   darker than the walkable floor: measured L* p50 22.9 (was 50.9, p90 58.7) against the walkable Dialwood floor's
   L* 29.5. Tree spots: crown room is measured square to every lip (a diagonal lip was missed by the N/S/E/W rays),
   and north/south rays count only from points on the block. The west lip at 150,30 and the south-west lip at
   30,80 now carry their hedge rows. Saplings (≥ 0.5×) fill the strip in front of a landmark, and Elevenmark and
   Fourmark are wooded up to the numeral (tfix_rift_nf_at3/at4).
4. [minor] Seat stones → fixed. Boulders and stones keep off the r 8 Seat disc and its rim step (+1.2 m)
   (tfix_rift_nf_at5).
5. [minor] BRIDGE fragments → fixed. Chips (needle_chip/shard) now lie on the Snap's broken edges, on the chalk
   band at the drop, and never out on the floor. When the stub landmarks load, 2 drums/slabs and up to 3 chips are
   placed on each stub's broken top, found by raycasting the model (`childadded`), so they rest on the stone. The
   far-lip fragments are bigger (0.8–1.65×). The far plateau and the terrace-end blocks are now bare bedrock
   (`valeRockPlateau`: weathered slabs, open cracks, lichen, moss in the hollows) instead of RIFT forest litter.
6. [minor] Quarry look / aliasing / prisms → improved. Strata follow the profile's own height, are faulted per
   joint block, have beds of uneven thickness, and every line is anti-aliased with fwidth and fades before it
   would shimmer. Benches are textured in plan (scree and moss, occluded at the face foot), and the ledge widths
   vary along the wall. The flat-shaded spire prisms are replaced by `rockStack` columns (terrain_clutter.ts):
   bedded 11-gon drums, smooth round, crisp at the joints, flaring with depth, with low caps; one merged mesh.
   Gorge L*: no fog p50 23.0 (upper) / 20.1 (deep); fog 13.4 / 14.7.
7. [minor] FRAY brief/minimap stale, no sheen → fixed. map_fray_landmarks.md §1–§5 now describe the pale
   dial-stone plate (L* 66–72 in vision, ≈ 30 under fog, dark basalt obstacles). tokens.json grade.maps.fray.valueLstar
   is updated. art/blender/ui/minimap_paint.py FRAY reads the plate from colors.lane and the stones from cliffFace,
   and minimap.png is repainted (plate L* ~58 after the painterly pass, with dark hour-lines and stones). The plate
   now has a satin lobe of the overhead sun (half-vector, strength per slab) and honed, even slab tones (no cloudy
   mottle). Measured: in vision L* 70.9, fog L* 30.1.
8. [minor] Lip / road film → fixed. The cap's inner bevel (WK.lipIn) is now opaque dark moss creeping over in a
   ragged line, not a tint over the joints. The road band's moss is driven by its own pores, not by the road
   flags beneath it, and its cut-edge bump is broad and soft (the 3 cm step dotted per pixel quad).
9. [minor] Shadow under fog → fixed. Lit ×1.6 where unseen before the world fog (keepColor kept): fog L* p50 12.9
   (was 5.8, other fogged floor ≈ 6), C* 12.1, hue −64°. In vision L* 33.2, C* 12.6 (in-brief). Slab courses vary in
   width (0.7–1.6 m, warped across) and in per-slab value, so the floor reads as stone and not as tiling.

Performance (`VALE_HEADED=1 node _harness/perf_1080.mjs --q high`, :5190, Apple M5, during heavy contention:
11–15 other lanes' Blender processes running): 56.6 / 61.7 fps avg, p95 27.5 ms, frameMs 14.7–17.3, 429–434
calls, 1.41–1.42 M tris. In back-to-back runs under the same load, the committed-to-main build before this pass
gave 55.5 / 52.5 fps (p99 40 ms), and the isolated fix build 60.3 / 58.4 fps (p99 27.5 ms): no regression. The
props lane's new Dialwood GLBs are larger, so the tree layout was thinned to keep the budget: hedge rows every
1.7 m, body grid 2.0 m, 45 % culled past 6 m from an edge. RIFT trees: 2320 instances, 1.30 M tree tris. The quiet
60 fps figure from the previous entry could not be re-measured while the machine was this busy.
Checks: `npm run -s typecheck` clean · `node _harness/probe_maps.ts` 102/102 · `node _harness/probe_content_ids.ts`
PASS · catalog rebuilt (`npm run content -- --allow-missing-assets`, 101 warnings = other lanes' assets).

Shots (main :5190): _harness/_shots/tfix_bridge_nf_at0..6 (60,5 · 78,8 · 78,36 · 30,38 · 12,5 · 78,22 · 78,14),
tfix_bridge_at0..2 (fog), tfix_rift_nf_at0..6 (40,55 · 30,80 · 150,30 · 55.3,31 · 114.7,85 · 85,55 · 85,28),
tfix_rift_at0..2 (fog: 85,28 · 60,45 · 140,45), tfix_fray_nf_at0..1, tfix_fray_at0..1.
Before/after sheet: art/renders/maps/polish_terrain_fix_before_after.jpg (review_polish_* → tfix_*).

Open gaps
- The far wall now reads as a weathered, terraced canyon. It is still a swept profile, though: no true overhangs,
  arches or hanging cords / prayer-lamps under the deck (brief §5). A Blender far-cliff set (map lane) is the next
  step toward the bar.
- The rock stacks are better but simple (11-gon drums). Seen from straight above near the Snap they read as columns.
- The fog-of-war tree canopy at RIFT reads near-black olive (world fog, not this lane).
- Perf was measured only under heavy contention; it should be re-run quiet before shipping.
