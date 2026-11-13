# SKY lane REPORT (Wave 4) - Last Circle
## TRIAGE (top of file): fresh run, nothing was done before. Status: IN PROGRESS (update below as I go)

## Findings so far
- Isolation: other lanes are mid-edit in the shared tree (player.js threw `RIM_COOL is not defined` during a --disk run). All my A/B runs
  therefore serve EVERYTHING from git HEAD (`--rev HEAD`) and override only maps.js (HEAD = before, working copy = after) via
  `_harness/new/sky_lib.py`. A final `--disk` run checks the real merged tree.
- rng hazard: the cloud-sprite loop consumes rng() before towns/props/loot are built; deleting it would reshuffle every seeded world.
  The replacement burns exactly the same number of draws (1 + 4*puffs + 4 per cloud, 24 clouds) so placements stay byte-identical.
- player.js underwaterFx owns fog.density while submerged (W._uw > 0.001); the altitude fog updater yields to it and to the menu phase.

## Progress log
- [done] maps.js: MAPS palette (P4.2 A), water colour, sky dome shader with baked cloud noise (P1.7), sprite clouds deleted with rng burn,
  W.skyUniforms/W.skyDome (C-SKY), warmObjects export, altitude fog updater (P1.10). Boots with 0 console/page/shader errors on all 3 maps (HEAD tree + working maps.js).
- Cloud tuning (in-page variants, tune.py): first scales (0.055/unit) showed NO clouds - the visible sky spanned ~10% of one noise tile. Final: layer A 0.50/unit,
  layer B 1.15/unit (weight 0.28), softness 0.40, per-map coverage isla 0.66 / savanna 0.54 / deepwood 0.72. Looked at 3 tuning sheets; picked soft cumulus.
- OPEN: ocean seam / map edge under thinner fog (edge250_* views), Savanna/Deepwood palette look, imgstats vs refs, framecheck/leaktest/bootcheck/probe_match gates, STEP B sheet.
- [done] Seam fix: the old water plane (2560 m) ended ~560 m past the coast; HEAD already showed a hard band at the ocean horizon in outward views, and thinner fog
  made it worse on Deepwood. Plane is now SIZE*3.5 (5600 m, beyond the 2000 m far plane from anywhere on the map), ripple repeat scaled to keep the ~28 m tile.
  Measured seam score (max row step in the side bands): Isla Viva outward views 0.0030-0.0034 (HEAD) -> 0.0010-0.0017 (new, fog x0.5).
- [done] Savanna horizon back to 10% pull (20% turned the golden haze pale pink); Deepwood water 30% pull (42% was drab grey).
- [written] _harness/new/sky_lib.py, sky_shots.py, sky_fogcurve.py, sky_probe.py (the gate), sky_stepb_sheet.py (Step B A/B). Gate run 1 in progress.

## What changed in maps.js (only file edited; all edits in the sky / fog / palette / water-colour regions, commented "SKY lane")
1. MAPS table: sky / zenith hues re-authored (P4.2 A) + new per-map `cloud` coverage. Isla Viva #7fd4f0/#2f8fd8 -> #9ed0e3/#5c8dc1 (the plan's own hexes);
   Deepwood #9fc7e8/#3a6fae -> #acc5dc/#506e9b; Savanna zenith #4f86bd -> #6585ab, horizon #e7cf98 -> #e5cf9f (10% pull only, golden haze kept).
   Recipe = pull each channel toward the colour's luma in LINEAR space (35%); verified to reproduce the plan's three Isla Viva hexes exactly.
2. Water colour: Isla Viva 0x2ec9d6 -> 0x80c2ca (plan hex), Deepwood 0x2f7d8a -> 0x4b7a84 (30% pull; 42% looked drab grey).
3. Sky dome: gradient + sun disc kept; the 24 sprite-cloud groups (96 billboards) deleted; clouds shaded in the dome fragment shader (Sky.js cloud shaping, MIT)
   from a 256 px periodic fbm DataTexture baked ONCE per page session (kept in _texCache so match teardown never frees it), two scrolling layers,
   per-map coverage, per-seed offset from a SEPARATE rng stream. `low` graphics tier = one layer (a #define fixed per match).
   Birds kept untouched. The deleted loop's rng() draws are burned (1 + 4*puffs + 4 per group) so every seeded world is byte-identical.
4. C-SKY: W.skyUniforms = {top, bot} (the dome material's live THREE.Uniform objects) and W.skyDome set when the map is built, nulled in disposeMapResources.
5. C-WARM: exported warmObjects(W) -> [] (nothing is created after the build; the dome is in the scene when kernel.warmup runs).
6. P1.10 fog: FogExp2.density = K.fog * (1 - 0.5 * smoothstep((agl - 40) / 210)), agl = camera height above terrain/water; full density at <= 40 m, 50% at >= 250 m.
   Only runs in drop/match/over, yields to player.js underwaterFx (W._uw > 0.001) and to the lobby/menu (hud.js owns that fog). No recompile (density is a uniform).
7. Water plane 2560 m -> 5600 m (SIZE*3.5), ripple repeat scaled to keep the ~28 m tile: required by (6), see the seam finding above.
Bake cost (Node, same loops): 28-96 ms once per page session (96 ms cold JIT); wrap-around seam step 0.0031 vs interior step 0.0148 (tiles seamlessly).
