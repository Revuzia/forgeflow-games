# LOOT lane report (Wave 4) - Last Circle P1.3 rarity beams + floor rings

## STATUS (updated as I go)  -- last update: loot.js rewritten + boots; look tuning in progress
- Triage: FRESH START (no previous REPORT.md). loot.js was clean in git at start.
- Files I edit: games/last-circle/runtime/3d/royale/loot.js ONLY. New gates: _harness/new/loot_*.py.
- [x] baseline captured (framecheck drop cluster 240 calls; main:loot 37 calls + main:loot[inst] 1; drop frame 1 main:loot 33 calls) -> framecheck_baseline.json
- [x] loot.js rewritten: 3 instanced pools (beams / rings / glow billboards), ceiling clamp ray-cast at spawn, storm fade via W.stormU (+ own 3 Hz fallback), warmObjects, debugLootFx hook
- [x] browser boots, my shaders compile clean (0 shader errors from loot materials; another lane's StormBolt shader has `vec3 flat` = reserved word in GLSL ES 3.00, see requests)
- [ ] look tuning (rings cleaner, far beams wider) - in progress
- [ ] gates (loot_ring_ab.py, framecheck, leaktest, probe_match, bootcheck)

## Design (what loot.js does now)
- ONE InstancedMesh each: loot-beams (open 10-seg cylinder), loot-rings (flat quad + procedural double-ring shader, NORMAL blend premultiplied, dark outline + coloured emissive band), loot-glows (camera-facing billboard). renderOrder 6/7/8 (>= 6 per C-LOOT-RENDER).
- Slot allocator = free list + zero-matrix park (same pattern as the contact blobs); pickup / net take / chest open all go through releaseItem / openChest.
- Beam clamp: ceilingAbove() queries the collider grid once per item at spawn: lowest collider footprint-overlapping the beam whose underside is > floor+0.6 m.
- Fades in the shaders (no per-frame CPU): distance per rarity, near-camera, storm circle (W.stormU {cx,cz,r}; fallback = own 3 Hz read of the sim circle).
- Pools are page-lifetime (like blobs). disposeMatch resets slots; disposeLootResources keeps the pool geometry/material by identity.

## Gate run 1 (loot_beams_rings.py, partial, box very contended: 7-13 other automated Chromes; each run ~10-15 min)
- PASS pools x6 (3 instanced meshes ro 6/7/8; 0 torus, 0 sprites in loot group; markers add EXACTLY 3 draw calls (139 on / 136 off); 101 weapons all ring+beam; 194 ammo/consumables 0 beams; beam heights 2/4/7/10.5/14 m)
- FAIL pools chest c28 had no markers -> cause: chest on a non-box surface >0.6 m above the terrain, surfaceUnder() gave up. FIX applied (markerSurface fallback: flat floor under the thing itself).
- PASS clamp (147 beams, 38 under a roof, 0 violations, module ceiling == independent brute-force ceiling for all)
- CNJ ceilpix (framing: 14 m beam top off screen at 7 m) -> gate fixed (26 m back + computed pitch)
- FAIL pickup rows were GATE bugs (player already at the 3-gun cap, so a plain pickup refused; chest-open slot re-used at once by the loot the chest drops) -> gate fixed. net-take mirror row passed on its own (ring/beam slots zero).

## Notes
- Other lane's StormBolt shader error spams the console during my runs; I filter by material name (`mine_shader_errors`).
