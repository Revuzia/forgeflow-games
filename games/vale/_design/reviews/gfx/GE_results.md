# GE results

Lane GE, 2026-11-06. A and B are the same page, the same held frame, and one uniform changed (`_harness/gfx_ge_frames.mjs`). Machine load during the runs was 3-70, so no absolute timing below is an idle figure.

## GE-1 ground micro-detail: kept

- **Switch:** `GE_STONE_MICRO` in `src/render/terrain.ts` (1 on, 0 off). The uniform is `uGeStone`; `setScatter` forces it to 0 on Low.
- **What it adds:** tool marks running one way per flag, pits, grit and chalk flecks on paved stone at 3-12 px. Joints, inlays, grooves, the carved band, the fracture, turf and the honed disc stay clean.
- **Sheet:** `GE1_ground_micro_ab.png`.

| Read | RIFT | BRIDGE | FRAY |
|---|---|---|---|
| Central high-pass, off to on (lane spot) | 7.60 to 7.70 | 4.85 to 5.11 | 6.57 to 6.79 (north) |
| Under telegraph footprints: high-pass, mean of all spots | 11.6 to 11.7 | 10.3 to 10.3 | 7.9 to 8.0 |
| Telegraph delta / ground high-pass, mean of all spots | 3.22 to 3.17 | 3.56 to 3.53 | 5.49 to 5.44 |
| value_probe lane p50, High / Low (bar 85-100) | 89 / 90 | 91 / 90 | 87 / 87 |

- **value_probe:** RIFT, BRIDGE and FRAY on High and Low, 82 PASS, 0 FAIL (`value_probe --tag gfx_ge_final --flash 0`).
- **Cost:**
  - One existing program, no new one. Three texture fetches added, no noise calls. A first version with four value-noise calls read about +2 ms in most same-page A/B pairs (one pair each way was swamped by load), so it was replaced.
  - About 350 KB of GPU memory (one 256 x 256 RGBA tile with mips). Triangles and draws unchanged.
  - GPU A/B could not be resolved: p25 per window ran 17-48 ms under load 11-20, with B sometimes below A. This needs the idle gate.
- **Low:** skips the layer behind one branch, so its frame is unchanged.

## GE-2 baked ground contact: rejected

- **What was tried:** real Cycles AO from the static world dumped out of the client (`_harness/gfx_ge_dump_static.mjs`, `art/blender/maps/ground_contact.py`), 0.25 m a texel, on RIFT. It could only ever deepen the existing wall-foot ramp. The bake took 7 s for 238,758 triangles.
- **Result:** about 4-11 % of pixels went darker by more than 2 levels (ambient motes and birds also moved between the two frames), and at the game camera the only readable change is a slightly darker road edge. Boulders and landmarks are too small, or already shadowed by the sun and N8AO, to gain from it. It was not plainly better, and walkable spread is already 42 of 45 on RIFT High.
- **Cost if kept:** one more fetch and sampler, about 1.6 MB per map, one content build per map.
- **Sheet:** `GE2_ground_contact_ab.png`. Code removed; the bake tool stays. Local report: `_harness/_reports/gfx_ge_ge2.json` (gitignored).

## GE-3 wall edge light: rejected

- **What was tried:** the upper part of each wall face lifted by up to +50 % in the wall program. The audit only weakly called for it (`GE_audit.md`).
- **Result:** it thins the contrast between face and painted lip, and the lip is what already separates the wall. RIFT's walls look washed and FRAY's rim is unchanged. Frame high-pass moved by under 0.1. No value_probe run was needed to reject it.
- **Sheet:** `GE3_wall_lift_ab.png`. Code removed. Local report: `_harness/_reports/gfx_ge_ge3.json` (gitignored).

## Budgets with GE-1 on

`perf_1080 --prod --match-seeds 7 --out _harness/_reports/gfx_ge_perf.json` printed GATE PASS with every timing half "not measured: machine busy".

| Read | Value | Bar |
|---|---|---|
| Match peak triangles | 452k | 500k |
| Match peak draws | 253 | 450 |
| Match peak programs | 40 | 40 |
| Programs first seen after 1:00 | 0 | |
| Memmaps match renderer + GPU, peak | 1967 MB (match_4_rift) | 3.0 GB |
| Home renderer + GPU, peak | 1329 MB | 2.5 GB |

The memmaps row `match_4_rift` shows 41 programs. The last five `fw_CW1_r3*_perf*` reports read the same, so it predates this pass.
