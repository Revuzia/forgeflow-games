# RIFT monsters set B — build progress (creatures_b.py)

Build: `Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/creatures_b.py -- --only <id> [--fast] [--no-qa] [--icons-only]`
Order: longshade → sunsplinter → gloamoth → gloamoth_little → stray_numeral → stray_tick → icons (longshade_icon, sunsplinter_icon).
Imports creature_kit.py (armature, limb IK, SDF → low/high, weights, fold repair); the build pipeline is a copy of
creatures.py's, extended: PoseB/RigB (per-bone armature-space loc / uniform scale / absolute matrices, ground chains,
root scale track), tag-bound rigid pieces, flat factor-only lamp materials, GSculpt (slice-wise ground cut), icon renderer.

## Log
- [longshade DONE] art/out/units/longshade.glb — 10858 tris (body 9000 + mask 900 + claws 798 + eyes 160), 771 KiB,
  top 4.20 m, 26 bones (no hind legs: 2 IK forelimbs + 6-bone tail laid on the ground in world space each frame).
  Clips idle 3.0 / run 0.8 (hand-over-hand crawl @3.2 m/s, foot-slide 0.2 %) / attack1 1.0 / cast_a1 1.167 (Shadow
  Sweep) / cast_a2 1.333 (Pooled Shade) / cast_a3 2.167 (Full Length: rears 1.6 s, crash at f48-51) / death 1.833
  (collapse, lamps scale out, root Z-scale flattens it into the ground). Load test OK, sheet
  art/renders/units/longshade.png looked at (+ zoomed scratch sheets). Materials longshade_body (2048 base) +
  longshade_lamp (factor-only, emissive 0.8: the test caps units at 0.8; the eyes swell in wind-ups instead).
  Icon art/out/units/longshade_icon.png rendered (mask + hood, dark ink wash).
  Look: ink storm-cloud back (billows) + flat shadow-tail with scalloped ink edges, pale chalk mask with hour-line
  fan and ink tears. Iterations: cone wisps / flat ribbons / bead puffs all read as spikes or beads at game
  distance; overlapping dorsal billows read as smoke.
  Notes: body dips up to ~0.3 m below ground in run / casts (it pours into its own shadow; hidden by the ground).
  Full Length's crash is at 74 % of the clip (as specified), but actors.ts maps 40 % of every cast clip to the
  cast time (0.5 s), so in game the crash would play ~0.9 s after cast start while the effect lands at 1.6 s.
- [sunsplinter DONE] art/out/units/sunsplinter.glb — 8214 tris (stone pieces 7400 SDF-meshed one grid per piece +
  dawnglass crystals + a 240-tri light orb), 762 KiB (1024² atlas: 2048² blew the budget), top 3.20 m (the
  glazed point), 34 bones (hover hips, core, head = the tip, 12 stones, 7 glass rays, 6 chips; every piece rigid on
  its own bone pivoting at the orb's centre). Clips idle 4.0 (the halo drifts and rocks; the identical glass rays
  turn one slot per loop, the identical chips one slot the other way: seamless) / run 0.8 (lean, pieces trail) /
  attack1 1.0 (tip draws back, stabs forward-down at 40 %) / cast_a1 1.333 (Shard Rain: rises, pieces lift into a
  crown, launch skyward and shrink away at 40 %, re-form out of the orb) / cast_a2 1.5 (Noon Glare: 1.2 s charge, orb
  swells 1 -> 1.6 and shivers, pieces draw in and spin up; flare: orb 2.5, pieces blast out) / cast_a3 1.167
  (Splinter Spray: tip levels, pieces gather behind it point-first, spray forward at 40 %, re-form) / death 1.667
  (orb flickers out, pieces fall with gravity and lie scattered, the tip plants point-first like an obelisk).
  Load test OK (no planted feet: the GLB carries no vale_run_ref_speed, the renderer reads moveSpeed from
  units.json). Sheet art/renders/units/sunsplinter.png looked at. Materials sunsplinter_body + sunsplinter_noon
  (factor-only gold, emissive 0.8). Icon art/out/units/sunsplinter_icon.png (Noon Glare charge pose: the needle
  tip upright over the swollen orb).
  Fixed on the way: rigid pieces bound per vertex could drag a neighbour's vertices (a long streak in Splinter
  Spray) -> tag binding now votes per connected island.
- [gloamoth DONE] art/out/units/gloamoth.glb — 4700 tris (fluffy SDF body 2300 + four solidified polar-grid wings),
  382 KiB, top 1.61 m (wing tips; body hovers at ~1.1 m, origin on the ground), 15 bones (hips, head, 2 abdomen,
  2 antennae, root + tip bone per wing). Clips idle 2.0 (hover bob, 4 soft flexing beats, hindwings lag) / run 0.6
  (pitched forward, 3 hard beats) / attack1 1.0 (rears with the wings up, dives forward-down, the wings sweep forward
  to brush at 40 %) / death 1.5 (stutter beats, wings fold up together, spirals down, lands on its side, a twitch).
  Load test OK, sheet art/renders/units/gloamoth.png looked at. Materials gloamoth_body + gloamoth_wing (base-texture
  glow 0.3). Lamp-shade wings: pleated panels between dark radial veins, lit amber panel centres -> rose -> dusk
  violet scalloped edge, cream decor bands, one painted dot per panel, cream fringe.
  Notes: the stock QA sheet (AgX) shows the wings pastel; with the game's Neutral tone map (checked in a scratch
  copy of the snapshot tool) they are saturated amber -> violet as intended. New pipeline bit: NO_AO parts (the
  baked whole-body AO is divided back out of the wing texels, else the forewing's occlusion travels on the
  hindwing when they flap).
- [gloamoth_little DONE] art/out/units/gloamoth_little.glb — 3020 tris (body 1500 + wings), 209 KiB (512² atlas),
  top 0.80 m, same rig as the gloamoth (Gloamoth subclass, S 0.52: rounder 1.25x thorax and abdomen, rounder
  wings, 6 beats per 2 s idle). Clips idle 2.0 / run 0.5 / attack1 0.833 (dive-brush, impact 40 %) / death 1.5.
  Load test OK, sheet art/renders/units/gloamoth_little.png.
- [stray_numeral DONE] art/out/units/stray_numeral.glb — 4298 tris (7 chalk chunks, each its own SDF piece cut
  along shared noisy crack surfaces so they fit), 358 KiB, top 2.40 m, 14 bones (hips = apex, strut.L/R hinges,
  neck, a facing marker, 7 chunk bones). An inverted V of serif strokes (thick left, thin right) on bracketed
  foot-serifs, a neck block, a crossbar head with flared serif ends and two drilled eyes; grime, lichen, hairline
  cracks along the break lines. Clips idle 3.0 (rocks from foot to foot about the serif edge, the bar wobbles, a
  settling thunk) / run 0.8 (stiff hop-waddle solved per frame so the stance foot stays planted: foot-slide 0.3 %,
  swing foot clears 7-13 cm) / attack1 1.0 (rock back, hop, stomp + head-bar slam at 40 %) / cast_a1 1.5
  (Topple: rocks back, falls flat on its face under gravity at 40 %, bounces, levers itself upright) / death 1.667
  (shudder, crumbles chunk by chunk into a heap; per-frame ground clamp). Load test OK (feet checked),
  sheet art/renders/units/stray_numeral.png looked at.
  Notes: serif edges dip <= 7 cm into the ground while it rocks on one foot (rigid stone rocking on an edge).
  Pipeline fixes found here: per-piece meshing must use the whole figure's bounds (a clipped box left an open,
  zero-volume chunk); crack displacement +f / -f on the two sides; controller bones renamed strut.L/R (three
  strips dots: leg.L collided with the legL chunk); multi-piece parts bind by piece index; fracture faces get
  their bake AO divided out (they are buried in the rest pose).
- [stray_tick DONE] art/out/units/stray_tick.glb — 1500 tris (3 chunks), 118 KiB (512² atlas), top 1.00 m, 5 bones.
  A serifed "I" stroke with two drilled eyes. Clips idle 2.0 (two little bounces, a curious lean) / run 0.4 (one
  pogo hop per cycle at 3.5 m/s) / attack1 0.833 (lean back, hop in, chop the top serif down at 40 %) / death 1.5
  (cracks into three chunks that topple apart). Load test OK, sheet art/renders/units/stray_tick.png.
- [final] longshade + sunsplinter rebuilt with the final pipeline (piece-index binding, AO hooks); all six GLBs
  load-test OK and are <= 790 KiB; `node tools/build_content.ts --check` lists none of the six models or the two
  icons (no units.json asset errors remain).
