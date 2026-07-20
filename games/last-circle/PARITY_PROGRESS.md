# Last Circle — Final Drop Parity Build (Pass A–D)

Working tracker for the multi-pass upgrade to reach the Final Drop quality bar.
Source audit: session 2026-07-20 (9-agent workflow, all MUST-fixes verified).
Status legend: `[ ]` todo · `[~]` in progress · `[x]` done+verified · `[!]` blocked/gated

## Pass A — High Textures (the "high textures" ask)  [code-complete, committed afffe5e]
- [x] A1 Unify graphics settings → single `W.applyGraphics` authority, boot-applied, persists (fixes: LC "high" never applied; two systems)
- [x] A2 Quality tiers drive REAL fidelity (shadow map 2048/4096, anisotropy, per-tier) — folded into A1
- [x] A3 Procedural tiling PBR terrain (grain albedo + normal map, world-planar UV, keeps vertex-color biome tint)
- [x] A4 Textured structures (grain/brick albedo + normal map on every merged mesh)
- [x] A5 Water normal map + scroll (procedural ripple; retires the dead waternormals.jpg question)
- [ ] A6 Red-roof meshes + road/parking decals (overlaps B roads) — defer into B
- NOTE: gates passed (ESM syntax clean ×3, sim selftest 45/45). Render-verify pending at the Pass-A deploy milestone (pump pipeline). Commit afffe5e is LOCAL — push to GitHub is blocked on the env's Git Credential Manager (interactive auth); needs owner to push/authorize. Does not block build or deploy (games deploy via deploy_game.py).

## Pass B — World Density (fixes "gets boring")
- [x] B1 Road network (greedy nearest-neighbour tree over POIs → cosmetic textured asphalt ribbons, no colliders). Verified live: 5352-tri road mesh on isla.
- [x] B2 Town-builder (town/house/parkingLot helpers): houses in lots along a street, front doors to the road, coloured (terracotta) roofs, parking lot + cars. Wired to isla (4 villages) + deepwood (logging, lakeside). Verified live: builds w/o exceptions, red-roof meshes present. TUNING: towns on over-water POIs (e.g. isla banana_farm ~-1.5m) build the street but skip houses — refine POI snap-to-land later. TODO: ashgrid savanna outpost town.
- [x] B3 Farmland builder — farmland(): crop-row grid (bushes) + red barn (hay-ramp roof chest) + silo + cosmetic fence. Wired to isla Banana Farm (relocated inland from the -430,480 waterline) + deepwood Meadow Farm. Verified live: barn/silo/fence meshes present on deepwood meadow.
- [ ] B4 Prop-kit expansion (procedural house/vehicle/street-furniture/landmark variants — no Meshy spend); house() gable roofs are a start
- [~] B5 Traversal fixes DONE: interior tower ramp now emerges via a stairwell hole (addSlabHole); overpass ramp reaches deck top; sky-island collider 0.86×→0.92×. Terrace helper for over-steep ramps (rangerTower 60°/crane 39°) DEFERRED (feel refinement, not a bug).
- [x] B6 Multi-zone biomes + snow: deepwood = green forest (south) + SNOW biome (north, geographic mask w/ organic edge); ashgrid = golden savanna (west) + sand DESERT (east). Verified live ?v=23 via colorAt sampling w/ position: deepwood far-north 255/255 snow + 616 green, ashgrid far-east 245/254 sand; ZERO grey on both (no regression).

## Pass C — Meta + Multiplayer
- [x] C1 XP/level bar + in-match challenge card (top-center, matches the Final Drop screenshots). Persistent lc_progress {level,xp}; rotating 3-challenge queue per match off W.match/W.t counters; completing a challenge awards XP + advances; match-end XP (kills+damage+placement+survival+victory) on the post screen. Verified live at ?v=21: survive→DONE at t≥180 awards +150 XP, bar shows LVL 12 / 250/8500, card advances to "Get 1 elimination".
- [x] C2 MP: mirror host-bot chest-opens to guests (net.js:36 `a===W.player` → `!a.netRemote`)
- [x] C3 MP: grenade/barrel splash routes through net authority (explode() netRemote gate)
- [x] C4 Barrel-anchored muzzle FX — muzzle world pos from the held weapon (right-hand bone + per-weapon barrel len), not the eye. Verified live: shot muzzle offset +0.23 right / +1.02 up / -0.75 fwd from body axis (was body-centre).
- [x] C5 Spectator HUD — HUD sources from W._camFocus (spectated actor) not the corpse; inventory reads guarded for partial remote inventories. Code-verified (no throw); full spectate needs a multi-actor match.
- [x] C6 Settings/ESC modal stack fix + clear orphaned keybind capture (ESC closes settings; Esc cancels capture; captureKey cleared on close/rerender)

## Pass D — Everything Else / Polish
- [x] D1 Menu lighting/exposure leak — snapshot kernel defaults at init, restore in buildMap (bloom left as established look)
- [ ] D2 Remote gunfire FX relay (fired event → tracer/muzzle/sound on guests)
- [x] D3 Hit feedback: headshot hitmarker (yellow, 34px, longer) vs body (white, 26px) + a hitmarker ping in audio.js (1400Hz head / 950Hz body). Verified live: headshot marker turns yellow/34px.
- [x] D4 Glider — canopy deploys at 110m (was 60m) so most of the descent glides; gentle auto forward-glide (0.15x) even inputless so the umbrella glides not drops (kept small to avoid the old AFK-into-sea drift). Verified live: deploys ~105m AGL, auto-fwd 0.83 m/s, fall slows -17.9→-8.4 on deploy.
- [x] (B2 follow-up) Ashgrid savanna outpost town — new POI (220,250) + town() with adobe/sandstone walls + terracotta roofs. Verified live: 9 POIs, adobe roof meshes, 18 loot pts near outpost.
- [x] D5 coverReflex determinism (setTimeout → sim-time `coverReflexUntil`)
- [x] D6 Supply-drop cadence (one early ~phase 2, one late ~phase 5+)
- [ ] D7 Selftest: quick tier-mix assert + factor bot decision helpers for node coverage
- [ ] D8 Full keybind rebind list (move/fire/ADS/slots)
- [x] D9 Compass ribbon HUD — top-center canvas, scrolling cardinal heading (N/E/S/W + ticks) from the camera facing + center marker. Verified live ?v=23 (320x18 canvas, drawCompass runs clean).
- [!] D10 Real upright RUN clip — GATED (Meshy credit spend). Ship code-only rig-agnostic lean-correction; regen awaits explicit owner OK.

## MILESTONE 2026-07-20 — ?v=19 deployed + render-verified on live CDN
Deployed to R2/CDN (12 files, cache PURGED — purge token IS configured, no 4h staleness).
Live: https://forgeflow-games-cdn.isimcha85.workers.dev/last-circle/index.html (status stays draft).
Live verification (browser pane, rAF-shim revived the hidden tab):
- Boots clean, ZERO console errors; boot-time applyGraphics ran (W._texAniso=4) → "high graphics never applied" bug FIXED.
- Full match builds to phase "match" with ZERO exceptions → exercises the texture code, B5 slab-hole/ramp geometry, D1 lighting restore.
- Terrain material: CanvasTexture map + normalMap over vertexColors, world-planar UVs (~8m tiles). Structures: all 23 merged meshes textured. Water: ripple normalMap. All confirmed via scene inspection.
- Terrain vertex colours sampled COLOURFUL (sand/rock/grass, 0/7 greyish) → no "removed the colours" regression.
- LIMITATION: actual pixel appearance NOT capturable — a hidden/background browser tab throttles the WebGL buffer to black. Visual "does it look good" is PENDING a foregrounded browser (owner opens the live URL). Code/mechanism fully verified; aesthetic pending human eyes.
- B6 strategy unblocked: verify biome colours by sampling colorAt outputs programmatically (colourful + not grey), no pixels needed.

## Deploy / verify notes
- Verify each edited .js with `node --check`; sim via `node runtime/sim/royale.selftest.cjs` (must stay 45/45).
- Deploy at pass milestones with `deploy_game.py`; bump the two `?v=` tags in index.html each redeploy.
- Render verification (textures/towns/HUD) needs the live pump+rAF-shim+upload_server pipeline.
