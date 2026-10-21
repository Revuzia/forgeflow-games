# Props polish (lane PROPS) — progress log

Owner bar: League-of-Legends-level, 100 % original. Lane files: art/blender/props/*, art/out/props/*,
art/renders/props/*, and only `art.terrain.props` of content/maps/map_rift.json and map_bridge.json.

## 2026-10-20 14:02 CDT — start
- Read _pass_props/_pass_terrain/_pass_structures, the RIFT/BRIDGE/FRAY briefs, STYLE_BIBLE look rules,
  dialwood.py / kit.py / paint.py / scatter.py / stones.py, terrain.ts (loadTerrainProps, propMat, spots).
- Baseline shots: _harness/_shots/polish_props_base_at0..3 (RIFT 40,55 · 60,45 · 55,28 · 30,80).
- Diagnosis (look-dev renders: paint-as-emission / white clay / final, scratchpad lookdev.py):
  the crowns' value was a property of each PLATE, not of the crown — occlusion and sky were ray-cast
  against the plate soup, so every plate's stem sat in the shade of the plate above it (a dark-stem /
  light-edge step per plate, plus ±jitter, per-plate hue at 10 %): a mosaic of flat chips. The dark slits
  were the 0.84 r bipyramid cores seen 8 cm under the plates (painted −0.04 and fully occluded = near black).
  The shading normal kept 18 % of each plate's own facet. The writer put alpha = 1 in COLOR_0 on every
  prop (stones included): under the new gloss interface everything would have read as lacquer.
- Facts: terrain draws every prop with ONE MeshStandardMaterial (vertexColors, roughness 0.86, FrontSide,
  instance tint per tree 0.86–1.08), spins each instance about Y, tree scale 0.74–0.87; BRIDGE surface
  'span' gets no rock/stone spots (terrain.ts: boulders only on surface 'dial', nStones 0 off the dial).

## 2026-10-20 14:45 CDT — Dialwood crowns: painted as a crown, not as plates (v1–v8)
Look-dev loop: scratchpad lookdev.py (five trees at 52°, RIFT sun, in-game scale ×0.8; passes paint-as-emission /
white clay / final with COLOR_0.a → roughness), then the game (polish_props_v1..v6_*).
- v1 paint = a FIELD over the crown: occlusion + sky ray-cast against the closed cores and trunk only (the
  plates never shade each other in the paint), Gaussian-blurred over the crown (σ 0.12 m), then gentle per-plate
  accents. Ramp turns with value: cool teal-green underside #112326 → sap #2C5435 → warm lit #7A8C42.
  Normals: clump ball × 0.6 + crown form × 0.4 (+ a trace of the plate's facet). Gloss mask written.
- v2 clump read: paint uses the clump ball's up-facing (pnz) and the crown form, AO contrast up, per-clump tone.
- v3 shingles: v1/v2 plates hugged their clumps so neighbours fought for the same depth — jagged shards where
  plates crossed. Plates now sit in LAYERS (the higher in the crown, the further out: LAYER 4.5 cm over the
  height, ±4 mm per plate) with droop matched to the clump's curvature (0.18·L/r) and a smaller roll: every
  tip lies over the stems below it. Clean shingled edges in the clay pass.
- v4 (rejected): all plates hanging down their clump with a cleft fan edge — read as broken shards from 52°.
- v5: plate edge accent only where lit (in the shade plates merge into the mass); limbs dropped inside closed
  crowns (never seen) and their triangles moved into 24-tri puff cores at 0.93 r (were 12-tri bipyramids at
  0.84 r: the dark slots). Cores painted one step deeper than the plates over them, never black.
- v6: lobes stand out (puffs sink 0.24 r, was 0.42), per-clump tone ±0.035; tree-to-tree hue drift at equal
  value (tall jade, broad sap, squat olive-gold, young spring, lean sage-teal).
- v8 (kept): fewer, larger, ROUND fan plates (7-tri arc edge, 0.74× the count, 1.16× the length): bigger
  painted shapes, no pentagon chips; same triangle count.
- Lacquer: per-plate gloss 0.35–1 (glossiest at the leading edge), cores 0.35, bark 0; plate facet weight 0.16
  so a highlight breaks plate by plate (diffuse unchanged to the eye). Preview of the terrain lane's reader
  (runtime-patched material, scratchpad gloss_preview.mjs, approximating its roughness 0.42 + clearcoat 0.55×g):
  _harness/_shots/polish_props_glossprev*_at*.

## 2026-10-20 15:20 CDT — final (v9–v11), BRIDGE set, checks
- v9 palette: the mid/upper ramp desaturated ~12 % and the top turned warmer (#808A4C, L* 55 like before),
  per-clump warm/cool drift 0.26 → 0.20: in full sun the crowns were a toy kelly-green.
- v10 reach held: larger round plates and less-sunk lobes had pushed the crowns out 0.07–0.18 m (lean 1.65 m
  in game vs the 1.53 m the last pass's occlusion census signed off). build_tree now draws each crown in
  horizontally to the HEAD reach (tall 1.30 · broad 1.64 · squat 1.59 · young 1.14 · lean 1.76 m authored,
  normals re-fitted); heights unchanged (≤ 3.30 m authored → ≤ 2.9 m + wall in game).
- Previews draw FrontSide like the game (back faces transparent in Cycles): the dark slivers in the old
  sheets were plate backs the game culls.
- GLOSS: kit.write_glb writes COLOR_0 RGBA u16 with alpha = gloss (default 0). Trees: plates 0.35–1 (mean
  0.61–0.65), cores 0.35, bark 0; every stone / boulder / needle piece 0 (they were alpha 1 = "all lacquer").
  Verified with three.js' own GLTFLoader (scratchpad gloss_check.mjs): color itemSize 4, Uint16 normalized,
  alpha min/max per GLB as written. The terrain lane's reader (seen in its working copy: roughness
  mix(0.86, 0.42, g) + clearcoat 0.55·g at roughness 0.3) treats all-0 alpha as a real mask → matte.
- BRIDGE: terrain.ts places no rock/stone spots off the Dialwood floor, so nothing renders on the span today
  (shots polish_props_final_bridge_at0..3). The needle set is ready for those spots and checked under
  Needlespan's sun on the deck, both terraces and a stub top (art/renders/props/scatter_bridge.png): palette
  cooler and paler than the warm deck (stops to #B2B2AA, fracture #BDB7A8), the carved groove and hour-band
  in chalk inlay like the deck's script (was a near-black #3A3C40 stripe), band ×0.84. New stone set
  needle_chip (100 tris) + needle_shard (156 tris), authored ≤ 0.85 m (≤ 0.36 m at the stone scale).
  map_bridge.json art.terrain.props: "tree": [], rock: needle_drum/slab, stone: needle_chip/shard.
- Tris (budget ≤ 4k/tree; ≤ 750 kept for ~920 RIFT instances): tall 631 · broad 655 · squat 575 · young 415 ·
  lean 683 (avg 592, HEAD 537); boulders 174–284, stones 134–192, needle 100–196. KB 8–26 per GLB.
- In game (RIFT, High, nofog): canopy screen L* p10 14.5 · p50 30.8 · p90 48.5 · p99 56.6 (HEAD-pass report:
  16 · 34 · 50 · 57), chroma p50 0.149 (v5 0.169). Frame tris at 40,55 · 60,45 · 55,28 · 30,80 = 692k · 601k
  · 616k · 683k, trees 183k · 122k · 141k · 209k incl. the shadow pass (≤ 700k scene).
- Shots: _harness/_shots/polish_props_final_at0..3 (RIFT 40,55 · 60,45 · 55,28 · 30,80),
  polish_props_final_gloss_at0..3 (gloss preview), polish_props_final_bridge_at0..3; before/after
  art/renders/props/polish_before_after.png; sheets art/renders/props/scatter.png, scatter_trees.png (paint
  over final), scatter_bridge.png; build report art/renders/props/build_report.json (tris, KB, gloss).
- Build: Blender -b --factory-startup --python-exit-code 1 --python art/blender/props/scatter.py --
  --preview --trees --bridge (~1 min), then npm run content -- --allow-missing-assets.
- Checks: probe_maps 102/102, probe_content_ids, probe_content_build 126/126 PASS; content:check's 100 errors
  are other lanes' missing fighter/skin assets (0 props). No src/ change in this lane.
- Honest read: the crowns now read as soft painted masses (warm lit top → cool teal underside, lobes, no
  slits, round lacquered fan plates, tree-to-tree hue) instead of a mosaic of chips. Not yet LoL-level:
  the plates are still flat-coloured shapes with crisp polygon outlines (no brushwork inside a plate — a
  single vertex-colour material cannot carry it), every crown is one rounded mass on a short trunk, and the
  plates are one size.
- Open / for other lanes: (1) terrain: with smooth crown normals the clearcoat at roughness 0.3 lands as one
  wet hot-spot per clump in my preview; clearcoat roughness ~0.45–0.5 or strength ~0.3 would read as
  lacquer sheen; (2) terrain: rock/stone spots on BRIDGE's stubs, broken deck edges and gorge lip (the needle
  set is waiting); (3) next art step for the canopy: a leaf-vein / brush-stroke detail in the prop shader
  (plate-local UV or the pleat attribute) or a small atlas, plus 2–3 plate sizes per crown.
