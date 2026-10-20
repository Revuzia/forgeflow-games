# Terrain pass (lane TERRAIN) — progress log

Owner bar: League-of-Legends-level ground, cliffs, brush curbs and floor marks for RIFT, BRIDGE and FRAY.
Lane files: src/render/terrain.ts, src/render/terrain_*.ts, src/render/glsl.ts (additions), art/out/textures/terrain_*.webp,
tools/terrain_textures.py, content/maps/map_*.json art.terrain (not props/landmarks) + art.lighting.

## 2026-10-20 09:38 CDT — start
- Read STYLE_BIBLE, WORLD §3, the three map briefs, terrain.ts (v5), world_material.ts, glsl.ts, the harness.
- Baseline shots: _harness/_shots/terrain_base_{rift_at0..5,bridge_*,fray_*}.png (rift at 40,55 · 60,45 · 85,55 · 15,55 · 155,55 · 70,30).
- Baseline perf (High, 1080p, rift fight): 59.7 fps (vsync-capped), frameMs 2.5. Terrain group static triangles
  2.16 M, of which Dialwood tree props 1.87 M (3 GLB variants × ~700 spots; props GLBs are another lane's).
- Findings: roads = one uniform cobble texture (stone_road) on a world grid; cliff faces sample the strata painting by a
  per-facet "along" coordinate, so it jumps every 0.9 m (the repeating brick stripe); 12 analytic radial hour-lines run
  under everything (the seam across the base plaza); Standing Shadow = road texture tinted violet on a flat sheet; FRAY
  floor = the Dialwood moss (brief: polished basalt L* 28–36) and hour-stones 1.6–2.2 m (brief 1.2 m, wallHeights unread);
  BRIDGE gorge = a flat blue floor at −22 m (no far wall, nothing reads as depth), deck edges grassy.
- Plan: isolated dev copy (own Vite on :5199, own deps cache) so the shared :5190 never sees a half-built terrain;
  new modules terrain_{shaders,walls,clutter,inlay}.ts; procedural flags (voronoi / polar / coursed) + new painted
  tiling textures with height in alpha for height-blended transitions; course-built cliff geometry with arc-length UVs,
  a chamfered lip with a painted edge light; gorge flank + far walls + mist layers; instanced clutter.

## 2026-10-20 10:52 CDT — the new terrain lands (all three maps)
- New modules: src/render/terrain_glsl.ts (ground / wall / shadow shader chunks), terrain_walls.ts (course-built
  wall sweeps: battered cut-stone courses, protruding cap with a chamfered painted edge light, carved lip; the gorge's
  needle-stone flank + columnar rock; carved hour-band rings), terrain_inlay.ts (engraved / inlaid strokes baked to a
  4-channel distance field: road hour-ticks, Dialwood hour-line grooves, the shadow tip, the deck's hour-script, the
  Snap's lit fracture + crazing, FRAY hour-lines / numerals / shop ring / Sunmote dishes / seat grooves),
  terrain_clutter.ts (solid instanced moss cushions, fan leaves, pebbles, wall-foot tufts; quality 0/½/full).
- tools/terrain_textures.py → art/out/textures/terrain_{litter,grain,moss}.webp (seamless, RGBA: alpha = height).
- terrain.ts rewritten around them: art.terrain.surface (dial / span / plate), plazas, gorge, snap, plate,
  hourLines.paths, noonline.standingShadow.tip, wallHeights (small/hourStones, large, frame/rim), temperature field
  as an albedo cast; per-flag road-edge dropout (whole flags lost to the wood), moss creeping into verge / room joints,
  wall-foot moss banks + occlusion, broad hue/value drifts in the Dialwood, water caustics in the Fallen Shaft.
- Content (lane keys only, surgical patcher keeps other lanes' lines byte-for-byte): textures, colors, surface,
  plazas, gorge, snap, plate, hourLines.paths, standingShadow.tip, BRIDGE temperatureField.
- Measured L* (no fog, after grade): RIFT road 64.7, room 51.4, Dialwood 38–39 (p10 22, p90 53), Standing Shadow
  31.8, Fallen Shaft 43.7, wall faces 22.0, Aubade plaza ~63, Serenade ~66; BRIDGE deck ~60 (was 55.8 before the
  lift), chalk band ~59–78, gorge 20–22; FRAY plate 32–35.
- Perf (machine shared with 5 Blender jobs, load avg 77–91, so perf_1080 is noise here): A/B frame time on the
  same harness, new vs old at 60,45 · 40,55 · 85,55 = 8.5/10.4/12.1 ms vs 16.1/10.8/11.6 ms (min of 7×20 frames) —
  no regression. Rendered triangles at those spots 0.56–0.64 M (≤ 700k). Terrain-lane geometry: RIFT 206k
  (cliffs 56k, Needlegrass 98k, clutter 53k), BRIDGE 80k, FRAY 24k; the rest of the terrain group is the props
  lane's trees/boulders and the landmarks.
- Checks: typecheck clean; probes 37/39 — probe_maps + probe_content_ids PASS; the 2 failures are outside the lane
  (probe_kits_B: ervet ROSTER row / clips — fighter lane; probe_sim_core_perf p99 tick spike under machine load).

## 2026-10-20 10:58 CDT — final
- Final shots (main :5190, --nofog): _harness/_shots/terrain_rift_at0..7 (40,55 · 60,45 · 85,55 · 15,55 · 155,55 ·
  50,35 · 85,25 · 85,80), terrain_rift_def_*, terrain_bridge_at0..5 (30,14 · 100,30 · 78,22 · 10,22 · 146,22 · 55,8),
  terrain_fray_at0..4 (32,32 · 32,12 · 14,24 · 50,45 · 6,10).
- Re-ran: typecheck clean; probe_maps, probe_content_ids, probe_content_build PASS. Catalog rebuilt with
  npm run content -- --allow-missing-assets (the fighter lane's missing GLBs fail the strict build).
- Open: the FRAY seat grooves read FRAY_SEATS from render/palette.ts (fixed per seat, not mode.playerColors); the
  Snap's lit fracture uses colors.lit (#FFE2B8) at emissive ≤ 0.75; BRIDGE gorge far walls still read a little
  "wallpaper" at the top edge — a Blender far-cliff set (other lane) would add true silhouette.
