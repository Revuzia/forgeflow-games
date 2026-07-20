# Last Circle — Final Drop Parity Build (Pass A–D)

Working tracker for the multi-pass upgrade to reach the Final Drop quality bar.
Source audit: session 2026-07-20 (9-agent workflow, all MUST-fixes verified).
Status legend: `[ ]` todo · `[~]` in progress · `[x]` done+verified · `[!]` blocked/gated

## Pass A — High Textures (the "high textures" ask)
- [~] A1 Unify graphics settings → single `W.applyGraphics` authority, boot-applied, persists (fixes: LC "high" never applied; two systems)
- [~] A2 Quality tiers drive REAL fidelity (shadow map 2048/4096, anisotropy, per-tier) — folded into A1
- [~] A3 Procedural tiling PBR terrain (grain albedo + normal map, world-planar UV, keeps vertex-color biome tint)
- [~] A4 Textured structures (grain/brick albedo + normal map on every merged mesh)
- [~] A5 Water normal map + scroll (procedural ripple; retires the dead waternormals.jpg question)
- [ ] A6 Red-roof meshes + road/parking decals (overlaps B roads) — defer into B

## Pass B — World Density (fixes "gets boring")
- [ ] B1 Road network pass (POI→POI spline graph, asphalt band in colorAt + ribbon meshes)
- [ ] B2 Town-builder (houses on a road, front-to-street, yards, parking aprons)
- [ ] B3 Farmland builder (crop grid, barn, silo, fences) for the Farm POIs
- [ ] B4 Prop-kit expansion (procedural house/vehicle/street-furniture/landmark variants — no Meshy spend)
- [ ] B5 Ramp/terracing helper + fix: interior tower ramp slab dead-end, overpass ramp under-shoot, sky-island collider 0.86×, steep 39–60° ramps
- [ ] B6 Multi-zone biome masks + a snow zone

## Pass C — Meta + Multiplayer
- [ ] C1 XP/level bar + in-match challenge cards (fed by W.match counters, persist to localStorage)
- [ ] C2 MP: mirror host-bot chest-opens to guests (net.js:36)
- [ ] C3 MP: grenade/barrel splash routes through net authority (explode() netRemote gate)
- [ ] C4 Barrel-anchored muzzle FX (muzzle world pos from the held weapon, not the eye)
- [ ] C5 Spectator HUD (source from W._camFocus, not the corpse)
- [ ] C6 Settings/ESC modal stack fix + clear orphaned keybind capture

## Pass D — Everything Else / Polish
- [ ] D1 Menu lighting/bloom/exposure leak — snapshot at init, restore in buildMap
- [ ] D2 Remote gunfire FX relay (fired event → tracer/muzzle/sound on guests)
- [ ] D3 Hit feedback: headshot marker + hitmarker SFX
- [ ] D4 Glider/umbrella descent (earlier deploy + forward glide feel)
- [ ] D5 coverReflex determinism (setTimeout → sim-time)
- [ ] D6 Supply-drop cadence (spread one drop to the late game)
- [ ] D7 Selftest: quick tier-mix assert + factor bot decision helpers for node coverage
- [ ] D8 Full keybind rebind list (move/fire/ADS/slots)
- [ ] D9 Compass ribbon HUD
- [!] D10 Real upright RUN clip — GATED (Meshy credit spend). Ship code-only rig-agnostic lean-correction; regen awaits explicit owner OK.

## Deploy / verify notes
- Verify each edited .js with `node --check`; sim via `node runtime/sim/royale.selftest.cjs` (must stay 45/45).
- Deploy at pass milestones with `deploy_game.py`; bump the two `?v=` tags in index.html each redeploy.
- Render verification (textures/towns/HUD) needs the live pump+rAF-shim+upload_server pipeline.
