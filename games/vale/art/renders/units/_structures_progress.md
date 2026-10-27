# Structures: r12 M9 pass (2026-10-27)

Gap M9 in `_design/research/r12_lol_parity_benchmark.md`: structures were oversized, could hide units and
vanished on death.

## Scale (presentation only; sim footprint and collision unchanged)
- Every design is built at its authored size, then shortened where needed (the shafts of the Aubade needles,
  the Hourbell belfries) and scaled uniformly (`DESIGNS` in `art/blender/units/structures.py`). Each culture
  keeps its proportions: Aubade spires stay tall and slender, Serenade domes stay low and broad.
- Every plinth still covers the sim's collision disc: needles 1.31-1.52 m against a 1.1 m disc, lanterns
  1.98-2.6 m against 1.5 m, Hourbells 2.7-2.83 m against 2.6 m.
- World heights: lane structures 4.59-4.74 m, Hourbells 5.28-5.29 m. Fighters are 1.65-2.35 m (median 2.05 m).
- On screen, measured with `_harness/shot_structures.mjs` at the gameplay camera (52 deg pitch, 28.5 m away,
  1080p). "Standing px" is the vertical from the ground to the real top, at the unit's own spot. A median
  2.05 m fighter stands 110 px.
  - Lane structures stand 266-276 px, 2.42-2.51x that fighter.
  - Hourbells stand 313 px, 2.85x.
  - Screen boxes (silhouette plus plinth footprint): needles 351-368 px, lanterns 401-462 px (wide plinths),
    Hourbells 506-513 px. r12 measured the old art's boxes at 400-478 px for lane structures and 605 px for
    the Hourbell, about 4x a fighter.

## GLB layout (structure_kit.py, the r12 M9 section)
- Node layout: `_base` (the plinth) and `_glow_base` (its hour-ticks); `_upper`, which carries `_chip1`,
  `_chip2`, `_dmg1`, `_dmg2`, `_glow` and `_core`; and `_ruin`.
- Chips are small pieces from the top two-thirds of the tower. The crown's tip always goes at the first
  threshold. Dome gores are never chipped.
- Cracks are ribbons of dark ink with a live accent seam inside. Rays cast onto the tower's surface place
  them.
- The ruin is three sectors of the tower, broken along their own tilted planes. Every break is capped in raw
  stone. Rubble made of the tower's own baked stones lies on and around the plinth. All ruins stand at most
  1.39 m.
- Contact sheets: `structures.png` (intact), `structures_damaged.png` (both crack sets, chips gone) and
  `structures_ruin.png`.

## Runtime (src/render/structures.ts; content: UnitDef.art.damage / art.ruin)
- **Damage states.** At 66 % and 33 % hp the cracks show, the chips break off and `lib_structure_crack`
  plays on the tower's flank. The accent light flickers, never brighter than the 0.8 rest glow. Healing 6 %
  past a threshold mends that stage.
- **Death.** The collapse takes 1.8 s (2.0 s for the Hourbell):
  - a 0.2 s shudder with every crack lit;
  - the top tips over its foot, away from the killer, with `lib_structure_break` at the break;
  - `lib_structure_land` where it lands;
  - it sinks through the ground and fades out.

  The ruin stays for the match. A gate that respawns rises out of its plinth in 0.9 s.
- **Occlusion.** Your fighter, the hovered unit or the targeted unit may stand behind a live structure from
  the camera. The structure's upper part (from 0.5 m above the plinth) then fades to 35 %, using per-actor
  see-through clones over a depth prepass.
- **Protected shell.** A protected structure wears a dawnglass bell jar: fresnel rim, the shield's 45-degree
  hatch, hour-ticks at its foot. It shatters in 0.45 s when the protection drops.

## Verify
`node _harness/shot_structures.mjs rift|bridge|fray` writes `_harness/_shots/structures[_bridge]_<state>.png`
and `_harness/_reports/structures_<map>.json`. States: scale, occlusion, damage66/33, collapse_*, ruin,
shell, gate_ruin/rise/back. Damage goes through the bench's own sim (`dealDamage`), a harness hook only.
