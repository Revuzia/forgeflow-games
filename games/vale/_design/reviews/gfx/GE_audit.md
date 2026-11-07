# GE audit: what the world already has at the game camera

Lane GE, 2026-11-06. Camera 28.5 m, 52 deg pitch, 1080p, High, real bench match (seed 7, t 75, sim held, fog and VFX off).
Tool: `node _harness/gfx_ge_frames.mjs --tag base` (frames in `_harness/_shots/gfx_ge/base/`, numbers in `_harness/_reports/gfx_ge_base.json`).
Masks: `_harness/_reports/gfx_ge_value_ge1.json` (`value_probe --tag gfx_ge1`). `hp` is the central block's high-pass luma std (luma minus its 9x9 box mean).

## What is already baked or per-pixel

| Surface | Where it comes from | Occlusion already in it | Gap at the game camera |
|---|---|---|---|
| Ground, all maps | One program per style (`terrain_glsl.ts` `GROUND_MAIN_GLSL`): per-pixel flags, families, long tone, walked track, dust, joints, moss, inlay field (`terrain_inlay.ts`), three painted tiles (grain 3 m, moss 4 m, litter 6 m), derivative bump | Distance-field wall-foot ramp (`wallD`, 0.5 at the foot, 1.0 at 1.9 m); N8AO on High and up; sun shadow | **Inside a flag there is nothing between 3 and 12 px.** The grain painting is soft at 3 m a tile, so stone reads airbrushed. Worst on FRAY's honed plate and BRIDGE's deck |
| Dialwood floor (RIFT) | Litter and moss tiles, ground clutter (`terrain_clutter.ts`: moss cushions, leaves, pebbles, tufts) | As above | None: already busy (hp 6.2-6.8 with the canopy) |
| Walls, RIFT and FRAY | Generated mesh (`terrain_walls.ts`), per-pixel courses in `WALL_MAIN_GLSL` | Painted: joints, damp foot `mix(0.6,1,y)`, moss foot, streaks under the lip; shadow map; N8AO | None big: painted lip and edge light separate it (below) |
| Gorge walls and far rock, BRIDGE | Same program, strata branch | Depth falloff, ledge occlusion, height mist | None |
| Landmarks, skirts, structures | Blender Art 2.0 atlases (`structure_kit.bake_body`, `skirts.py`, `landmarks_art2.py`): painted, AO multiplied into base colour, chalked edges | Baked per object (`glass_belfry`, `hour_stone`, `shaft_drum`, `skirt_*`: one `*_stone` atlas) | Not on the ground under them: only the sun shadow and N8AO |
| Boulders, stones, trees | Vertex colour (`art/blender/props/paint.py`: BVH cosine AO, 60 deg sky cone, ramps) | Baked per vertex, rotation invariant | As above, and they are small |

## Numbers per map

| Map | Spot hp (base) | Lane p50 | Walkable p5-p95 | Wall face / lip / edge p50 | Next floor p50 |
|---|---|---|---|---|---|
| RIFT | lanes 5.5-7.6, jungle 6.2-6.8, centre 10.1 (units in frame), base 9.0 | 89 | 59-101 | 33 / 50 / 76 | jungle 37, verge 44 |
| BRIDGE | lanes 4.9-5.8, tower 7.1, base 8.6 | 91 | 70-103 | 25 / 49 / 70 | verge 46 |
| FRAY | centre 4.2, north 6.6, rim 4.9-5.3 | 87 | 54-97 | 19 / 57 / 58 | plate 87 |

## Conclusions

1. **GE-1 is called for on all three maps**: the paved stone is the flattest thing on screen and the biggest. Lowest hp is BRIDGE's deck and FRAY's plate.
2. **GE-2 has a narrow case.** Objects already carry their occlusion. The one surface with no real occlusion is the ground: the wall ramp is even along a wall and does not deepen in a corner, and landmarks and boulders leave no contact of their own on it. Prototyped on RIFT.
3. **GE-3 is only weakly called for.** Walls separate through the painted lip (edge p50 58-76 against wall face 19-33). The closest case is RIFT's wall face 33 against the Dialwood floor 37, so one cheap test was run.

## Other findings, no change made

- **BRIDGE, Snap stubs** (`snap_stub.glb`, `landmarks_art2.py:303`): from the game camera the raw break, a fan of triangles to one centre, reads as a puckered, tied-off sack. It sits at the map's centre. Not rebuilt in this pass. The fix would be an irregular fracture in `broken_drum`, and `shaft_drum` shares that helper.
- **RIFT, verge turf**: the moss cushions along the road edge repeat visibly at this zoom (`_harness/_shots/gfx_ge/base/rift_high_lane1.png`). Not touched: it is a composition call, not micro-detail.
- `_harness/shot_lane.mjs` and `value_probe` settle the camera for 14 frames at 1/60 s. In a same-page A/B that left the first frame about 40 px off the second. `gfx_ge_frames.mjs` settles for 90 frames. Single-frame gates are unaffected, because they read statistics rather than compare pixels.
