# CUT_A PHYS running report (lane PHYS; tasks P0, P1a, P1b, then P2, P3). Keep under 10 KB.

## Leg 1 (phys-1): P0, P1a, P1b DONE (code + probe); 10 probe rows MISS their bars (listed honestly below). Next leg: P2 (constructor), then P3.

### Files (all mine; `src/contracts.ts` untouched, constructor untouched)
- `src/physics/softbody.ts` (P0 only): `centreGB()` after `neckGoal()`, `nk > 0` only; `debug.goalDrift`; static knob `SoftBody.centreGoal` (default true; probe L6 runs the shipped goal with it).
  The patch file EXISTS (`_handoff/reports/SHELL_4_FIX2_physics_goal_centroid.patch`); only its neck half is applied (as spec 5.1 words it); its `flatPoints` half is NOT.
- `src/physics/region.ts` (P1a, new): source solid S (detail 4, W frame, LRU 8), 14^3 grid + Moller-Trumbore ray stack, `exitDist`, `regionIntervals`, `measureRegion`, `regionCentroid`, `starVolume`
  (V and phi from one pass), `starShare`, resumable `CentreSearch` (160-point R3 scan + 5 pattern rounds), `clipMesh` (exact clip: volume, centroid, covariance, aspect), `compileCell`.
- `src/physics/piece.ts` (P1b, new): `PieceJob` (19 stages, `run(budgetMs, maxStages)`), `CutJob` (the pair with the 0, +-0.004 .. +-0.012 R0 ladder; `badSide`), `planChildren`, `buildPiece`,
  `pieceDetail`, LRU 64 cache (`clearPieceCache`), `PIECE_TUNING` (mutable knobs: FOOT_LIFT_MAX, DELTA_MAX, SNAP_PASSES, STAR_GUARD, RIM_SMOOTH, CAP_PASSES, RELAX_REPEAT, GS_RELAX ...).
- `_harness/probe_truecut.ts` (new): rows G1-G7, C2, L10, L4, L5, L6, build cost, allocation. `--quick` (8 species), `--species=`, `--skip=geom,eyes,nested,cost,alloc,l5,l6`, `--tune=KEY=VALUE`.
  `_harness/run_probes.ts` passes `--quick` to it. Full run: `node _harness/probe_truecut.ts` (about 11 min when the machine is quiet, 20+ when busy).
- tsc clean. Existing `probe_cut.ts` 17/17 with P0 (incl. the neck allocation row at 0 B). Geometry is bit-identical across my last refactors (checksum over 5 species x 4 planes unchanged).

### Measured (final full run, 50 species; 59 of 69 rows pass; the 10 that do not are the FAIL list)
- Sets: 1066 of 1069 sweep planes built (81 skipped under 1/8), 855 of 858 red-team-family planes, 355 of 356 nested cuts (up to 5 deep), 3842 single-plane pieces, 455 nested leaves.
- G1 IoU (columns R0/32, exact in z): median 0.9886 (bar 0.95), p10 0.9652 (0.90), **min 0.7865 (0.82)**: one piece, `ambrosel` 1/8 sliver. Overlap 0.000 %, uncovered median 0.51 % / max 2.05 %, volume error 9.9e-13, fractions sum exact.
- G2 planarity 6.5e-16 R0; cap/section d3 p5 0.996 (0.90); **d2 min 0.386 (0.65)**, p5 0.976 (0.78): 5 pieces under 0.7 (capnap foot3, rattlebead thin0, selenuff z+0.2, munchip, hooplet): the plane cuts thin features and
  the part of the section a ray from the centre cannot see is not meshed (spec 4.1 step 3 "the missing at most 5 %").
- G3 rimClean d3 99.92 % (99.5), d2 99.76 % (98). Every rim vertex to S: p50 3.0e-8 R0 (the 1e-7 hair), 98.24 % within 1e-6 R0, p99 9.9e-3. **Rim to the ORIGINAL detail-3 mesh: p50 0.0116, p95 0.0278, 41.4 % within 0.01, max 0.349 R0 (bar 0.01)**
  and **rim to S max 0.35**: the 1.8 % of rim vertices that stay off the silhouette are snap moves the validity guard refuses (a long move on a small cap seen at a grazing angle). The 0.01 bar also fails for ON-S vertices
  because S (detail 4) is finer than the original (detail 3): typical 0.01-0.03 R0 near features (dollop peak, horns).
- G4: 0 inverted tetra about the star centre, 0 tiny triangles, masses 0.048..6.76 (gate). **Mass-centroid flips 17 triangles in 3 of 3842 pieces** (capnap x2, selenuff: non-star about the mass centroid, star about the ray origin),
  **wrong-facing (vertex-mean apex) max 1.875 % = 6 of 320 triangles on one detail-2 piece (bar 0.5)**, **smallest angle p1 0.6 / median 12.9 deg (bar 3 / 15)**, **CAP triangle under 15 deg on 25.4 % of regions (d3 24.5, d2 27.1; bar 6 %)**.
- G5 coverage d3 p95 0.051 / worst 0.069 R0 (0.08 / 0.35), d2 p95 0.052 (0.14). G6 half-eyes 100 % of 1440 within 0.065 R0 (97 %), none near the other piece.
- G7 nested: sums exact (2e-16), smallest leaf 0.130, IoU median 0.9784 / p10 0.9608 / min 0.9379, coverage p95 0.074 / worst 0.221, rims clean 99.8 %, volumes 9.9e-13; **3 inverted tetra about the mass centroid in 3 leaves (hushpuff, slumbrel, ambrosel; 0 about the ray origin)**. Nested smallest-angle median 4.9 deg.
- L10: 0 vertices across their own plane (bar 1e-9 R0), 0 particles deeper than 0.001 R0 inside the sibling, in 2276 pairs (sweep + red-team + nested).
- C2: refused as unsound exactly munchip and selenuff level +0.5 R0 side A (and no other sweep plane; the spec's ambrosel oblique case is not reproduced because the spec's oblique normals are not recorded). Red-team families: selenuff sliver1 A.
  Refusal rate single planes 0.31 % (6 of 1927: 3 loose, 3 thin by the mass gate: selenuff x3, skeinara); ladder repaired 3. **Nested 0.28 % (1 of 356)** (bar 3 %).
- Cost (best of 3, JIT warm): detail-3 piece median **8.5 ms** / p95 10.7 (bar 12 / 40), detail 2 median 2.3 / p95 2.8; every stage max 1.96 ms (bar 3); the single-piece probe shows one volume-stage outlier of 3.9 ms (median 0.33). 
  L4: 250 of 250 cold rebuilds bit-identical, same stage count. Allocation: 0 B per stage in the median and p95 (a stage-0 sample of 160 B); the output arrays (stages 17, 18) allocate by design.
- L5: after `centreGB` the neck goal mean is 3.4e-16 / 4.6e-16 / 4.2e-16 R0 (x, y, tilted planes, 50 species; bar 1e-9). BEFORE: median 0.041 / 0.012 / 0.051, max 0.099 / 0.076 / 0.134 R0. burst 2.2e-15, setFrac 1.2e-15; fold sphere left alone (max 0.0125).
- L6: 50/50 species identical `stateHash` at the 9 checkpoints before the first setNeck; the first setNeck differs on 50/50 (by design).

### Deviations from the spec text (each found by a probe row; all are knobs in PIECE_TUNING)
1. Rim snap runs 3 passes (SNAP_PASSES) with a per-vertex backtracking guard (STAR_GUARD 0.002 of the mean tetra / area). One pass (the spec text) leaves rim vertices 0.08-0.6 R0 inside the skin (first quick run, 8 species:
   cap/section 0.93 but rim-to-original max 0.6; cap triangles under 15 deg 3.9 % d3 / 9 % d2). Three passes put the cap on the true section (median 1.000) at the price of thin cap triangles (25 %). A real fix is T1 (arc-length rim re-spacing, task P8).
2. Tried and rejected on 4 species: tangential rim smoothing (RIM_SMOOTH=3: 14.8 -> 17.1 % cap triangles), Gauss-Seidel relaxation, CAP_PASSES 40, RELAX_REPEAT 2, SNAP_PASSES 6 and 10 (no gain). Defaults are the best found.
3. `exitDist` returns 0 when the origin is outside S and has a `verify` mode (the snap needs both; without it passes 2-3 pushed rim vertices out to 1.36 R0). Centre and phi share one 360-ray pass when a centre is given.
4. The saved 23-plane / 905-plane lists and the prototype scripts are not on this PC: families regenerated deterministically (t1 = (0.667, 0.718, -0.199), t2 = (-0.45, 0.62, 0.64) are MY choice).

### Next (leg 2)
P2 constructor (`initRest`, `region`, `frame`, `PieceInfo`, no lift, FRAC_MIN 0.124, per-hinge fold arrays, `meanEdge`, `capFlat`), probes L2/L3/L6; then P3 `planCut`/`prepareCut`/`placeAt` on `CutJob`/`planChildren`/`clipMesh`.
Open for the orchestrator: whether the 10 missed rows are re-specified (G4 cap triangles, G3 vs the original) or fixed in P8 (T1); `piece.ts` consumers must call `clearPieceCache()` when the squishy is whole again.
