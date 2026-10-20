# Scatter props pass (lane SCATTER PROPS) — progress log

2026-10-20 09:33 CDT — start. Read STYLE_BIBLE, WORLD §maps, RIFT/BRIDGE/FRAY briefs, scatter.py, terrain.ts
(loadTerrainProps + scatter). Facts that drive the design:
- terrain keeps only position/normal/COLOR_0 and draws every prop with ONE MeshStandardMaterial (roughness 0.86,
  FrontSide): the GLB material is ignored, so the lacquer must be painted, and every plate must be closed.
- trees/boulders/stones are rotated randomly about Y per instance -> a baked directional sun would point a
  different way on every tree. Paint only rotation-invariant light: sky visibility, up-facing, AO, rims.
- scales: tree ×0.74–0.87 (uniform) on wall tops ≥ 2.2 m; boulder (s·1.25, s·1.1, s·1.25), s 0.35–1.1 at cliff
  feet; stone (s·1.1, s·0.9, s), s 0.10–0.42 → a stone authored at ≤ 0.85 m lands ≤ 0.4 m.
- BRIDGE: no tree spots (gorge walls are chasms, stubs < 2.2 m); boulders ring the Snap stubs. FRAY: trees on
  the four corner rim walls, boulders at the rim / hour-stone feet, stones on the plate (brief wants none).
Baseline shots: _harness/_shots/props_base_at0..3 (RIFT 40,55 · 60,45 · 55,28 · 30,80), props_base_bridge_*,
props_base_fray_*. Before: cauliflower blobs, near-white pebbles (screen L* 55–67 on lit faces).

2026-10-20 09:57 CDT — M1 new generator. art/blender/props/{kit,paint,dialwood,stones}.py + rewritten scatter.py:
- kit.py: numpy parts, fan_plate (solid 3-lobed fan leaf, midrib fold, chamfer band, domed underside; 32 tris),
  faceted tubes, low cores, own GLB writer (POSITION/NORMAL/COLOR_0 u16, Y-up).
- paint.py: BVH occlusion (cosine AO + 60° sky cone), ramps, posterize, value noise. All light rotation-invariant.
- dialwood.py: 5 trees (tall/broad/squat/young/lean), clumps shingled on a phyllotaxis spiral + one crown plate,
  low dark cores, faceted trunk + root buttresses + limbs. 1.8–3.8k tris, 73–152 KB.
- stones.py: bmesh chisel cuts, broken end, chamfer (chalk), engraved tick groove / recessed hour-band, moss cushions.
- maps: RIFT rock → boulder_block/tick/pair, stone → stone_tick/chip; BRIDGE rock → needle_drum/slab, stone →
  needle_chip/shard; FRAY rock → basalt_slab/chip, stone → basalt_chip; trees = the 5 Dialwood everywhere.
Iterations v1–v5 (shots props_v1..v5_*): spiky maple stars + black cores → phyllotaxis shingling, single raised
crown plate (two crossing crown plates pierced each other), gentle fold (pyramids → fans), wider fans, value grouped
by clump form (lit crown → cool skirt) instead of per-plate salt-and-pepper, stone ramp lifted (sides were L* 28–35).
Content build: needs --allow-missing-assets (fighter GLBs of other lanes absent; not props).

2026-10-20 10:17 CDT — M2 look + budget pass (v6–v11, then props_final_*).
- Phyllotaxis rosettes read as cabbages → dart-thrown plate points, plates turned ±40° off the slope (free on
  the crown). True fans (120–160°): far better cover, the crown reads as one shingled canopy, not a heap.
- Frame cost: the renderer draws ~907 RIFT tree instances (2.68 M tris at 3.0k avg in v8; old blobs were 2.06k).
  Plates below the crown now use the economical 24-tri rounded fan (K=4) → tall 3.1k, broad 2.8k, squat 2.3k,
  young 2.0k, lean 2.1k (avg 2.47k, +20 % on the old set); frame tris at gameplay spots 1.0–1.4 M (High).
- Variant drift (tall cooler, squat warmer, young fresher), young tree enlarged (it left holes at 20 % of spots),
  lighter bark, lighter clump cores (gaps read as shade, not holes), faint lobe ribs, a pale lacquer sheen.
- Stones: poked chisel micro-planes on boulders (≤ 566 tris), mottle, lumpy lobed moss cushions, muted moss,
  shallower chalk tick groove; moss creep only on dial-stone. Screen L* of boulder bodies 37–57 (target 40–55).
- Removed the obsolete dialwood_a/b/c, boulder_a/b, stone_a GLBs (nothing references them).
Final: art/renders/props/scatter.png (sheet), before_after.png (before | after, RIFT 40,55 and 60,45),
_harness/_shots/props_final_at0..5 (RIFT 40,55 · 60,45 · 55,28 · 30,80 · 20,40 · 100,30), props_final_fog_*,
props_final_fray_*, props_final_bridge_at0. Build: Blender ... scatter.py -- --preview (~1 min), then
npm run content -- --allow-missing-assets.
Requests for terrain.ts (not my lane): (1) interior thinning (e > 9 m, 60 % dropped) and the 2.7 m grid leave
block tops bare at gameplay zoom (Elevenmark block) — keep ~100 % to 9 m and 70 % deeper, or step 2.4 m;
(2) a gloss channel: read COLOR_0 alpha (or a second attribute) as roughness so the leaves can be truly
lacquered (0.45) while bark/stone stay 0.86; (3) an empty role array should mean "none", not the procedural
fallback (FRAY's brief wants a clean plate: no boulders/stones on it).

2026-10-20 11:15 CDT — FIX PASS (review: tri budget, occlusion, cabbage read, boulders on walkable floor, FRAY/BRIDGE).
Tools (scratchpad, not shipped): extract.mjs dumps the scatter instance matrices + frame tris from the bench;
census.mjs rasterises every tree into a 52° orthographic depth buffer and tests each walkable m² at chest
(0.95 m) and head (1.9 m), also net of the cliff's own cover; values.mjs masks the canopy (with/without the
group, shadows off) and reports screen L* percentiles. Baseline (previous pass, 921 trees on RIFT):
2,264k tree tris (avg 2,459), chest hidden 391 m², chest+head 226 m² (net of cliff cover: 102 / 34).
Frame tris 1.00–1.47 M at 40,55 · 30,40 · 140,45 · 62,72 · 85,55 (0.50–0.60 M with trees hidden).
- Trees rebuilt from scratch (v1–v8): single-sided K-tri fan leaves (no bevel ring, no notch) dealt by a
  Poisson-disk pick over the exposed hull of each crown's clumps (an envelope + budding puffs), closed low
  cores under them, clump normals (0.66 clump + 0.34 crown + leaf pleat) so a clump shades as one soft
  mass. v1 pentagon pie-slices read as origami; v3 coins on a ball (cores exposed); v5+ hull placement
  gives even cover. Crowns lowered (skirt ~1 m) and narrowed: ≤ 3.3 m authored → ≤ 2.9 m in game.
- Boulders (rock role, RIFT): authored ≤ 0.33 m (≤ 0.36 m in game): low broken slabs, tick bar, pair; no
  chisel micro-planes; worn lit chamfer (+8–50 % toward chalk, not a white line); moss cushions 3 cm with a
  rim feathered into the stone colour; palette darkened (lit faces aimed at L* 40–55).
- Maps (props arrays only): FRAY → none (brief §4 clean stage; terrain.ts already skips the plate); BRIDGE →
  rock: needle_drum/slab only (built for stubs/broken edges/gorge lip; terrain.ts places none on the span
  today), trees and loose stones dropped; RIFT unchanged refs. Deleted needle_chip, needle_shard,
  basalt_slab, basalt_chip GLBs (nothing references them).

2026-10-20 11:32 CDT — FIX PASS done (v9–v12, props_final2/3_*).
- Trees: per-clump warm/cool drift; 12-tri bipyramid core per puff (closed the edge pockets: see-through
  area per heading 0.1–0.2 m² → 0.01–0.08 m², silhouette slivers only); ramp compressed (#152822 → #728447);
  broad/squat narrowed and the lean pulled in (0.62 → 0.45 m) for the lane edges.
  Final: tall 572 · broad 584 · squat 522 · young 388 · lean 616 tris (avg 537 on RIFT's mix), 17–26 KB each.
  RIFT (921 trees): tree scene tris 2,264k → 495k (−78 %); frame tris at 40,55 · 30,40 · 140,45 · 62,72 ·
  85,55 = 632k · 688k · 716k · 633k · 591k (trees add 101–207k incl. the shadow pass; with trees hidden the
  scene is still 480–549k, not this lane). Max in-game height 2.82 m (cap 3.4/4 m), crown reach ≤ 1.53 m.
  Occlusion (walkable m², trees only): chest 391 → 179, chest+head 226 → 65; net of what the cliff itself
  already hides: chest 102 → 19, chest+head 34 → 0. Marker shots: _harness/_shots/props_final_occl_0/1.
  Canopy screen L* (no fog, 4 spots): p10 16 · p50 34 · p90 50 · p99 57; road median 66 (was p90 57, p99 65).
- Stones: extrusion caps over the engraved tick groove / hour-band were left in place by bmesh (a downward
  lid read as a black slot in Cycles, a hidden duplicate in game) → deleted; groove shallow (chalk inlay).
  RIFT boulders in game: max 0.32 m tall (was 0.92; 85 of 180 > 0.4 m → 0); boulder screen L* p50 32, p90 46.
- Download: RIFT props 185 KB (previous pass 824 KB, HEAD 170 KB); BRIDGE 29 KB; FRAY 0.
- Checks: typecheck, probe_content_build (126/126), probe_content_ids, probe_maps (102/102) pass;
  content:check 100 errors, all missing fighter/skin assets of other lanes (none props).
Requests for terrain.ts (not my lane): (1) block tops read sparse now that crowns are small for the lane
edges — pick a larger scale for trees deeper than ~4 m from a block edge (×1.25) and keep ≤ 1.0 near the
north edges, and relax the e > 9 m thinning; (2) boulders: skip thickets (26 of 180 sit in brush) and
chokes; (3) BRIDGE: rock spots on the Snap stubs, broken deck edges and gorge lip for needle_drum/slab (or
the map lane adds them as landmarks); (4) a gloss channel for true lacquer (COLOR_0.a → roughness).
