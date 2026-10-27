# Structures: r12 M9 pass (2026-10-27, fix round 1 the same day)

Gap M9 in `_design/research/r12_lol_parity_benchmark.md`: structures were oversized, could hide units and
vanished on death.

## Scale (presentation only; sim footprint and collision unchanged)
- Every design is built at its authored size, then shortened where needed (the shafts of the Aubade needles,
  the Hourbell belfries) and scaled uniformly (`DESIGNS` in `art/blender/units/structures.py`). Each culture
  keeps its proportions: Aubade spires stay tall and slender, Serenade domes stay low and broad.
- Every plinth still covers the sim's collision disc: needles 1.31-1.52 m against a 1.1 m disc, lanterns
  1.98-2.02 m against 1.5 m, Hourbells 2.7-2.83 m against 2.6 m.
- Nothing is scaled up. The Serenade lantern is built at 1.0 (it was 1.15x: 2.6 m plinth, columns 2.09 m out,
  cutting into fighters standing at its disc). Its piers stand in (1.0 m off the axis, 0.42 m radius) so the
  pier caps end at 1.52 m, within the 1.5 m collision disc + 0.1 m; a small ribbed lamp-dome on the keystone
  keeps its height at 4.69 m.
- World heights: lane structures 4.59-4.74 m, Hourbells 5.28-5.29 m. Fighters are 1.65-2.35 m (median 2.05 m).
- On screen, measured with `_harness/shot_structures.mjs` at the gameplay camera (52 deg pitch, 28.5 m away,
  1080p). "Standing px" is the vertical from the ground to the real top, at the unit's own spot. A median
  2.05 m fighter stands 110 px.
  - Lane structures stand 266-276 px, 2.42-2.51x that fighter.
  - Hourbells stand 313-314 px, 2.85x.
  - Screen boxes (silhouette plus plinth footprint): needles 216-250 x 351-368 px, lanterns 327-333 x 401-406 px,
    Hourbells 446-467 x 506-513 px. r12 measured the old art's boxes at 400-478 px for lane structures and
    605 px for the Hourbell, about 4x a fighter.
  - Protected (with the shell): +0.8 to +1.7 % in height, no wider (needles 356-376 px, lanterns 406-411,
    Hourbells 513-517).

## GLB layout (structure_kit.py, the r12 M9 section)
- Node layout: `_base` (the plinth) and `_glow_base` (its hour-ticks); `_upper`, which carries `_chip1`,
  `_chip2`, `_dmg1`, `_dmg2`, `_glow` and `_core`; and `_ruin`.
- Chips are small pieces from the top two-thirds of the tower. The crown's tip always goes at the first
  threshold. Dome gores are never chipped.
- Cracks are ribbons of dark ink with a live accent seam inside. Rays cast onto the tower's surface place
  them. A Serenade dome shows the gameplay camera its top, so its first stage casts its rays down toward the
  axis too (cracks land on the upward faces) and is denser, wider and longer: 4 more cracks, 1.45x as wide,
  walks of 8-14 steps (`SERENADE_CRACK1`).
- The ruin is three sectors of the tower, broken along their own tilted planes. Every break is capped in raw
  stone. Rubble made of the tower's own baked stones lies on and around the plinth. All ruins stand at most
  1.39 m.
- Contact sheets: `structures.png` (intact), `structures_damaged.png` (both crack sets, chips gone) and
  `structures_ruin.png`.

## Runtime (src/render/structures.ts; content: UnitDef.art.damage / art.ruin)
- **Damage states.** At 66 % and 33 % hp the cracks show and the chips break off: each stone of the real
  `_chip` mesh (its connected pieces) tumbles away from the tower and lands under gravity in ~0.5 s, then
  shrinks away. `lib_structure_crack` plays where the largest stone broke (24 chips of 0.32 m, about
  12-18 px at 1080p). The accent light flares to 1.25x rest for ~3 frames, then flickers, never brighter
  than its rest glow. Healing 6 % past a threshold mends that stage.
- **Death.** The collapse takes 1.8 s (2.0 s for the Hourbell):
  - a 0.2 s shudder with every crack lit;
  - the top tips over its foot, away from the killer, with `lib_structure_break` at the break;
  - `lib_structure_land` where it lands;
  - it sinks through the ground and fades out.

  The ruin stays for the match. A gate that respawns rises out of its plinth in 0.9 s.
- **Occlusion.** Your fighter, the hovered unit or the targeted unit may stand behind a live structure from
  the camera. The structure's upper part (from 0.5 m above the plinth) then fades to 35 %, using per-actor
  see-through clones over a depth prepass. "Behind" is a world-space ray test: 12 rays from the camera to
  points on the unit's body against an occluder proxy built once per template from the upper's triangles
  (0.5 m bands, one box-and-cylinder volume per connected footprint, so a gate's piers and its open arch are
  told apart). On at 25 % of the rays blocked, off below 12 %. No screen boxes, so no aspect-ratio dependence.
- **Protected shell.** A protected structure wears a dawnglass glaze on its own silhouette (its surface
  pushed out 7 cm along smoothed normals: fresnel rim, the shield's 45-degree hatch, a slow rising band) over
  a low foot ring of twelve hour-ticks on the plinth. The glaze fades with the occlusion fade. It bursts
  outward in 0.45 s when the protection drops.
- **Overhead bars.** Fighter bars draw after every structure and unit bar, your own last (renderer.ts), so
  a fighter standing behind a structure keeps its bar and name on top of the structure's.

## Verify
`node _harness/shot_structures.mjs rift|bridge|fray` writes `_harness/_shots/structures[_bridge]_<state>.png`
and `_harness/_reports/structures_<map>.json`. States: scale, occlusion, sweep, damage66/33, collapse_*, ruin,
shell (with the protected-box growth), gate_ruin/rise/back. Damage goes through the bench's own sim
(`dealDamage`), a harness hook only.

`--states sweep` is the occlusion gate: your fighter on every walkable spot behind each structure kind of
both sides (collision radius + 0.65 to 2.4 m, every 15 deg from -165 to -15 deg); it exits 1 if any spot
leaves the fighter under 50 % visible while the fade is off. Fix round 1 (RIFT, default camera):
- 1080p High, team-0 seat: 305 spots, 0 failures; the worst unfaded spot is 0.80 visible.
- 720p Low: 321 spots, 0 failures; worst unfaded 0.68. Team-1 seat, 1080p High: 332 spots, 0 failures;
  worst unfaded 0.82.
- With the fade on, the fighter reads 0.31-1.0 visible (the lowest right behind a narrow needle, where the
  plinth and the tower's foot stay opaque).
- The trigger is identical at 21:9 and 4:3 (the same spots, the same blocked shares).
