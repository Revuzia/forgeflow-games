
---------------------------------------------------------------------------------------------------
## DATA — live browser runs (framepump5.py / framepump6.py / framepump7.py; seed 1, isla_viva, standard, tier medium)

Exact counts (reproducible; seed-deterministic — the first drop frame gave the identical 9,908,496 triangles in all
three runs):

| moment | draws | triangles | biggest share | programs |
|---|---|---|---|---|
| menu (sampled) | 287-293 | 92.5 k | — | 18-19 |
| after startMatch warm-up | — | — | — | 19 -> 46 (run 5), 18 -> 45 (run 6): +27 |
| FIRST rendered drop frame | 360-367 | 9,908,496 | shadow:actors[skinned] 22 draws / 8,573,580 (86.5%) | **+27 on this frame** (3 of 3 runs) |
| drop +4 s | 373 | 10,139,419 | shadow:actors[skinned] 21 / 8,491,270 | +0 |
| match, t = 32.9 s, 42 alive, on the ground | **440-446** | **16,478,983** | **main:actors[skinned] 34 draws / 13,380,760 (81%)**; shadow:actors[skinned] 6 / 2,007,820 | **+2 on this frame** |

Match frame, full attribution: main:actors[skinned] 34 / 13,380,760 · shadow:actors[skinned] 6 / 2,007,820 ·
main:map[inst] 33 / 717,876 · main:map 133 / 197,597 · shadow:loot 67 / 88,905 · shadow:actors 4 / 24,008 ·
main:loot 113 / 22,079 · shadow:map 32 / 15,212 · main:fx[inst] 2 / 12,416 · main:actors 3 / 11,912 · main:storm 2 · post 14.
=> In the match the problem moves from the shadow pass (G1) to the main pass (G2): 34 full-detail characters in view,
most of them a few pixels tall, ~394k triangles each. The draw count (446) is already at the 450 budget with 113 loot
draws + 67 loot shadow draws for ~111k triangles — the loot is draw-call-heavy, triangle-light.

Scene census: drop +4 s — 495 visible drawables (227 mesh, 50 skinned, 35 instanced, 181 sprites, 2 lines), 129 shadow
casters, 268 materials, 72-74 programs, 50-51 mixers; match t = 32.8 s — 571 visible drawables, 195 shadow casters,
272 materials, 96 textures, 399 geometries.

Weapon cadence, measured IN THE PAGE through the real weapons.js `update(W, dt)` (held trigger, 10 s, infinite mag) —
identical to the Node mirror:
  SMG (design 720): 165 Hz 708 · 144 Hz 720 · 120 Hz 660 · 75 Hz 648 · **60 Hz 600** · 50 Hz 606 · 30 Hz 606 · 20 Hz 600 ·
  60 Hz with +/-0.5 ms jitter 666.
  AR (design 330): 165 Hz 336 · 144 Hz 324 · 120 Hz 330 · 75 Hz 324 · 60 Hz 330 · 50 Hz 306 · 30 Hz 306 · 20 Hz 300 ·
  60 Hz jitter 330.

Forced layout (CDP, no-yield pump): drop 1.00 layout + 1.15 style recalcs per frame (0.28-0.29 ms + 0.06 ms);
match 0.15 layout + 0.77 style recalcs per frame (0.12 ms + 0.21 ms). Contaminated timings, exact counts.

CPU per pumped frame (contaminated INFORMATION — 8 Chromes on one iGPU box, CPU-only frames):
  drop, 1,671 frames: sim+view p50 3.4 ms · p90 10.1 · p99 24.3 · max 179.6 (updaters mean 3.56, mixers mean 1.58);
  match, 1,200 frames: sim+view p50 9.8 ms · p90 16.3 · p99 32.3 · max 95.9 (updaters mean 8.4, mixers mean 2.69).
  Render submit on the sampled frames: 15.8 s - 186 s (GPU starved; meaningless except as proof the box was saturated).
  So on this box the CPU half of the frame alone overshoots the 22 ms p99 target in the match — before any rendering.

Heap: run 6's sampling used the default (retained-only) mode, so its 0.6 KB/frame is NOT an allocation rate and is not
used. Run 7 repeats it with includeObjectsCollectedByMinorGC/MajorGC (total allocated) — result appended below.
