# Structures pass (lane STRUCTURES) — progress log

2026-10-20 09:27 CDT — start. Read STYLE_BIBLE, WORLD §2/§3, map briefs, structures.py, actors.ts, CONTRACT §12.
Before: art/renders/units/structures.png = one neutral white-stone set for both teams (6–12k tris, plain shafts,
two dark bands, a small accent eye). Plan: (1) art.teamModels per-team model ref (schema, renderer, preload,
build check, CONTRACT §12); (2) two faction sets — Aubade (tall chalk spires, dawnglass) and Serenade (low
ironstone domes, lampresin) — sharing dial-stone plinths with hour-tick rings; (3) verify in RIFT/BRIDGE shots.

2026-10-20 09:28 CDT — CODE done. UnitDef.art.teamModels (catalog.ts), ModelLibrary.unitModelRef/unitTemplate(unit, team)
(cache key per unit+model, failed team model → art.model), refsFor(..., teams) + renderer preload passes the sides
(seats + structure placements; null in FFA via isFfaMode), syncActors passes palette.ffa ? null : e.team.
build_content: teamModels refs resolved like any asset + must be .glb. CONTRACT §12 documented. typecheck OK.

2026-10-20 10:27 CDT — ART v1 (all ten built, fast bakes). New kit art/blender/units/structure_kit.py (boolean-free lathe /
sweep / prism / crystal pieces per material, per-stone vale_var, bible paint materials + weather streaks/chips, one baked
base-colour atlas per structure with AO multiplied in, object clips on the accent core). structures.py rewritten (legacy
SDF helpers kept for small_units.py + maps/landmarks.py). Content points all five structures at <id>_aubade / _serenade.
Lessons from the in-game camera (52°): anything under a roof is invisible from above -> Aubade cores live in an open
"needle's eye" (converging chalk ribs), Serenade cores in short open cupolas; dome gores parted by glowing accent seams
read instantly; Lanterns became gates (arch faces the camera: they never turn, facing 0 = camera sees the model's -X).
Shots: _harness/_shots/structures_t3_*, t4_*, t6b_*.

2026-10-20 10:36 CDT — ART v2. Aubade Hourbell: belfry + pent-roof skirt with flush glowing lancets and a pinnacle
crown + an open eight-rib "needle's eye" holding the great crystal (a roofed upper stage hid the core from the camera).
Serenade Hourbell: the bell now hangs in the open air in a crown of crossed iron arches over the lamp cupola (inside the
drum it was invisible), a lampresin brazier lights the arcade. Serenade needles gain wall lamps; dome gores lighter.
Bake scratch + unquantized exports moved to art/.cache/structures (gitignored). First full-quality build: 1024² atlases
(needles/lanterns, 0.3–0.5 MB GLBs), 2048² hourbells (~0.9 MB); all ≤ 20k tris.

2026-10-20 11:21 CDT — ART v3 (final full-quality build). Painted coursed masonry (Brick texture in arc-length × height,
faded on tops) on chalk / sandstone / ironstone; buried faces (stacked lathe caps, sunk frame backs) culled before UV
packing (−10–15 % tris, much denser atlas); Serenade Hourbell trimmed to the 20k budget. Icons re-rendered from the
Aubade models (same file names). Old single-model GLBs (needle_outer.glb … hourbell.glb) removed — nothing references them.
Final: 5.4k–16.5k tris, 0.29–0.80 MB GLBs (webp + quantized), clips idle/attack1/death on the accent core.
Checks: typecheck OK, build_content OK, probe_content_ids / probe_content_build / probe_maps PASS.
Shots: _harness/_shots/structures_riftnf_at0..9 (no fog), structures_rift_at0..9 (fog), structures_bridge_at0..5;
contact sheet art/renders/units/structures.png (Aubade front row, Serenade back row).
Honest read: two unmistakable cultures, accents read ally/enemy from the gameplay camera, layered silhouettes with
trims/bands/inlays; surfaces are a clean stylised paint (not yet LoL-level brushwork — next step would be hand-painted
detail / normal maps). Map-lane note: Needlegrass now overlaps the low-lane outer Needle plinths (≈59.5,94 / 110.5,94).
