# ART-B report (lane: offline asset intake)
TRIAGE (top): fresh run 2026-10-05, no previous attempt found. Progress below, newest last.

## Task status
| # | task | state |
|---|---|---|
| 1 | P2.0 decoders | DONE: meshopt_decoder.module.js (24,850 B) vendored; Draco wasm files were already present and byte-identical |
| 2 | town-kit intake | IN PROGRESS: tooling built (art_b_glb.py, art_b_render.py, art_b_pack.cjs), compression + browser decode proven on 4 samples; art_b_city.py (full pipeline + manifest + colliders) next |
| 3 | ground/road textures | DONE (5 jpgs, 1,028,855 B) |
| 4 | fx particle textures | DONE (spark/puff/glow/tracer, 27,473 B) |
| 5 | weapon silhouettes | DONE (6 PNG, 13,137 B; looked at them) |
| 6 | CREDITS.md | not started |
| gates | art_b_check.py | not started |

## Log
- T1: vendored `assets/vendor/three/examples/jsm/libs/meshopt_decoder.module.js` 24,850 B (cmp identical to node_modules/three r0.172.0). `draco/` already had draco_decoder.wasm 285,747 B + draco_wasm_wrapper.js 58,763 B (+ draco_decoder.js 719,410 B), all byte-identical to three r172, so nothing was added or overwritten there.
- T3: `_tools/art_b_textures.py` -> assets/tex/{road_asphalt(aerial_asphalt_01) 277,591 B, sidewalk_concrete(asphalt_04) 236,830 B, ground_grass_rock 227,562 B, ground_beach(aerial_beach_01) 90,213 B, ground_sand(aerial_sand) 196,659 B}, 1024x1024 q80, wrap-aware resize. No normal maps: sets on disk have no normal map (diffuse/ao/displacement/rough only).
- T4: `_tools/art_b_fx.py` -> assets/fx/{spark 3,549, puff 18,648, glow 4,428, tracer 848} B. Looked at the preview sheet: star with bright core, round mottled puff, round soft glow, horizontal streak that fades to the tail.
- T5: `_tools/art_b_wpn.py` renders assets/hud/wpn_<id>.png (160x60 white silhouette, muzzle right) from the game's own protos via W.weaponProto (real Chrome). Looked at the 3x sheet (sheets/wpn_sheet.png): pistol, smg, ar, shotgun, sniper, glauncher all read as the right gun. FINDING for the weapons owner: the in-game SMG proto has its MUZZLE at -Z (probe render with real material: orange muzzle device at -Z, stock at +Z; weapons.js heuristic counted 577 verts in the +Z third vs 870 in the -Z third; WPN_FLIP lists only ar+glauncher), so the SMG is probably held stock-forward. Not verified in a match; the HUD icon is mirrored so it reads muzzle-right. The sniper Meshy model has a floating butt-stock (gap ~4 px at 160 px); the icon bridges it.
- T2 groundwork: staging decision = geometry-only GLBs (no embedded texture) + per-palette PNG in palettes/, so the suburban and commercial `Textures/colormap.png` name clash never arises and the town code assigns ONE shared Texture per palette (flipY=false, sRGB). POSITION kept FLOAT32 (snapped to a 0.5 mm grid) instead of KHR_mesh_quantization int16: measured building-type-b 146,720 B source -> 19,588 B (float snap) vs 18,096 B (quant14); avoiding the dequantisation node transform keeps `InstancedMesh(geometry)` and applyMatrix4 bakes safe. Decoded and rendered in headless Chrome through the vendored meshopt decoder: identical looking to the uncompressed files.
- T2 (interim, 12:35): `_tools/art_b_city.py` ran end to end: 81 types (27 buildings: suburban 10, commercial 7, skyscraper 5, lowdetail 5; 14 street/yard props; 8 cars; 16 furniture; 16 wall modules), 60,440 tris total, 908,816 B of GLB (source 5,081,576 B). `_harness/new/artb_decode.py` PASS in real Chrome (81/81 decode through the vendored meshopt decoder, tris + bbox match the manifest, POSITION is Float32Array, 0 page errors/failed requests). `_tools/art_b_check.py` PASS. Looked at every contact sheet (sheets/gate/*.png) and the collider plots (plots/colliders_*.png). A final clean full regeneration is running (city_full_run.log) to make the final files come from the generator end to end.
- Walls fix: a single bbox collider blocked the doorway gaps of wallDoorway/wallDoorwayWide/doorwayOpen; those now use a front-elevation decomposition (jambs + lintel, 3 boxes) and the two corner modules use plan-view boxes.
