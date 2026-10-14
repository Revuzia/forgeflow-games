# RIFT camp monsters — build progress (creatures.py)

Build: `Blender -b --factory-startup --python art/blender/units/creatures.py -- --only <id>`
Order: glasshorn → resinback → stilltusk → stilltusk_young → icons (glasshorn_icon, resinback_icon).

## Log
- [start] kit design: custom quadruped armature + analytic leg IK (art/blender/units/creature_kit.py),
  SDF bodies (common/hifi/sdf.py), baked paint (common/bake.py), clips written as layered actions → NLA.
  run clips authored at the unit's base.moveSpeed (the renderer uses it as runRef for units).
- [glasshorn DONE] art/out/units/glasshorn.glb — 8032 tris (body 7600 + dawnglass antlers 432), 458 KiB,
  top 2.201 m, 32 bones (custom quadruped + scapulae), clips idle 3.0 s / run 0.70 s (gallop @3.4 m/s,
  foot-slide 1.9 %) / attack1 1.0 s / cast_a1 1.167 s / death 1.5 s; load test (--unit) OK; sheet
  art/renders/units/glasshorn.png looked at (facings, all clips). Materials glasshorn_body +
  glasshorn_dawnglass (emissive 0.55, base-texture driven). Death min z -0.03 (hoof, mid-fall).
  Tool changes: art/tools/three_load_test.mjs `--unit --clips --feet`, three_snapshot.mjs `--unit [--cam y,p]`.
- [resinback DONE] art/out/units/resinback.glb — 10198 tris (body 6998 + resin 3200), 563 KiB, top 1.808 m,
  clips idle 3.0 / run 0.6 (lope @3.3 m/s, slide 0.2 %) / attack1 1.0 (forepaw slam) / cast_a1 1.167 (spit:
  rear + lunge, jaw wide at 40 %) / death 1.5 (collapse onto the belly, legs splayed). Load test OK, sheet
  art/renders/units/resinback.png looked at. Materials resinback_body + resinback_lampresin (emissive 0.6,
  base-texture driven: plate centres glow). Death min z -0.04 (paw sole while lying).
  Kit additions: soft leg reach (foot bone swings about the planted joint), auto scapula swing,
  ground clamps (ball / tip / wrist), fold repair, non-symmetric decimation, bake-hole fill.
- [stilltusk DONE] art/out/units/stilltusk.glb — 6820 tris (body 6400 + stone tusks 420), 497 KiB, top 1.40 m,
  clips idle 3.0 (rooting) / run 0.4 (trot @3.4 m/s, slide 1.6 %) / attack1 0.833 (tusk hook) / cast_a1 1.167
  (Still Stamp: rears on the hams, stamps at 40 %) / death 1.333 (drops onto its right side). Load test OK,
  sheet art/renders/units/stilltusk.png looked at. Materials stilltusk_body only (tusks baked into the same
  atlas, honed chalk-stone with hour notches). Death min z -0.03 mid-fall.
  Kit: low meshes now get an OpenVDB voxel remesh before decimation (surface-nets non-manifold verts at
  thin bristle tips made bone heat fail) — glasshorn/resinback to be rebuilt with it in the final pass.
- [stilltusk_young DONE] art/out/units/stilltusk_young.glb — 3820 tris, 327 KiB, top 0.897 m, clips idle 3.0 /
  run 0.333 (trot @3.5 m/s, slide 0.1 %) / attack1 0.833 / death 1.333. Built from the Stilltusk design at
  S 0.803 with a vertical leg compression (stubby legs), bigger head and eyes, pale flank bands, low mane,
  tusk nubs. Load test OK; sheet art/renders/units/stilltusk_young.png looked at.
- NEXT: icons (glasshorn_icon.png, resinback_icon.png 128²), then a final rebuild of all four with the
  voxel-remesh kit + content check.
- [icons DONE] art/out/units/glasshorn_icon.png, resinback_icon.png (128², RGB, idle pose, 3/4 head-and-shoulders,
  bible lighting with the rim pair turned down, dark painted ground, vale_grade_01).
- [FINAL PASS DONE] all four rebuilt with the final kit (`creatures.py -- --icons`); boar run clips now hold two
  strides (stilltusk 0.8 s, young 0.667 s). Every GLB: load test --unit OK, sheets regenerated.
  `node tools/build_content.ts --check --allow-missing-assets` OK; without the flag none of the 4 models /
  2 icons is listed missing.
