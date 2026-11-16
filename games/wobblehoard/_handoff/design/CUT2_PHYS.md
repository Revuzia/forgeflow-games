# CUT2_PHYS: the true cut, physics and geometry lens

Lane PHYS (src/physics). Designer read-only: nothing under src/, _harness/, _spec/ or public/ was edited. Every number below was produced this session by a script in the designer's scratch folder (prototype of the builder in plain node against a patched COPY of `softbody.ts`; the shipped files were only read). Where a number comes from the shipped code it carries a path:line. The other two lens memos (CUT2_SHELL.md, CUT2_RENDER.md) were read in full and this memo conforms to their contracts (section 7 lists every addition).

Owner request this serves: "when i SPLIT, it just takes out a little ball and the squishiy itself splits - but i wanted a REAL cut, like if i cut a squishy in half, one eye is on one side and one is on the other - these are clean cuts, not a little ball/piece".

## 0. The design on one page

**What a piece is.** A piece is the part of the ORIGINAL squishy that lies on its side of the cut plane(s). Its rest mesh keeps today's icosphere topology (642 particles, 162 under 0.35) and is made by casting the 642 rays of the icosphere from the part's centroid through a high-resolution copy of the whole (detail 4, 2 562 vertices), relaxing the vertices along their rays, sliding the vertices of the cut-face boundary in the cut plane out to the skin ("rim snap"), and moving the skin by a small uniform normal offset so the rest volume is EXACTLY `frac x V3`. The flat cut face is part of the REST shape (it is what the shape matching aims at), the eyes, ears and belly are the original's, and a piece is never cut from its parent's mesh but always from the same high-resolution source, so nested cuts do not compound.

**What the solver changes (all small, all measured).** (1) every goal that is pinched or morphed has zero mass-weighted mean (this alone removes 95 % of the old chunk launch, measured on 50 species: median 3.3 m/s to 0.15 m/s, max 13.6 to 0.43); (2) the contact fold limit knows each hinge's REST dihedral (a true rim is 100 to 140 degrees at rest); (3) `setNeck` latches its rest-space plane and takes a `depth`; (4) `setRegion` morphs the goal and the volume target to a merged piece and rotation is extracted against the goal being morphed; (5) `collide` needs four changes, scoped to pairs that contain a piece (distance and direction from the closest point on the other surface, pushes capped at 1 mm per frame, the contact skin of the two pieces of one cut eased in over 1 s, the whole-body shove scaled by contact count and vertical on a flat patch), or flush faces and piles of pieces throw each other about (the shipped one fails the SHELL's flow on 29 of 46 cuts); (6) the foot rule is adaptive (at least 7 particles on the table) and never moves a vertex of a cap plane; (7) the builder keeps every piece inside its half-spaces and keeps the corners where two cuts meet fixed.

**What merging is.** Any two pieces join by the SHELL's rule (union of cells when they touch across a cut face and the union is sound, otherwise the lowest-common-ancestor group), and PHYS makes that always buildable by refusing, at cut time, a cut that would leave a cell or a child that is not one body (0.14 % of single-plane cuts; a plane that takes both ears of munchip or selenuff off at once). The last join is the root: the shell swaps in a fresh `createBody(genome)`, bit-for-bit the original, after the receiver has morphed to it.

**Where the numbers stand** (details in sections 2 to 6; the test plan with thresholds fixed before measuring is section 9):

| question | measured answer |
|---|---|
| Why did the old chunk launch at 1.5 to 14 m/s? | the shape-matching goal of the flat face (`FLAT`) was not mass-centred (mean 0.015 to 0.056 R0 on all 50 species), so the goal pulled the body along the cut normal every substep; centring that one goal takes 50 species from a median 3.3 / max 13.6 m/s to 0.15 / 0.43 m/s (section 1) |
| Expected launch speed of the new build | zero by construction; measured on the SHELL's own swap flow, 50 species x 6 planes x both pieces (586 pieces): **0 of 293 cuts launch**, rise <= 17 mm, upward speed <= 0.69 m/s; 256 of 293 cuts (87 %) pass every row of the swap-flow test (section 9, L1) |
| Is the cut "true"? | 2 210 of 2 213 single-plane regions are sound (3 refused: both ears of munchip and selenuff taken off by one plane, ambrosel 93 %); rest volume = `frac V3` to 1e-12; caps planar to 4e-16 R0, cap area 0.958 of the true section (median), rim snapped on 2 207 of 2 210; IoU against the clipped source median 0.987, against the ORIGINAL detail-3 mesh by voxels median 0.963 (the stated 0.95 bar fails on 19 of 78 cuts, the horned species worst); the two pieces of a cut are disjoint at birth (0 of 114 overlap) |
| Nested cuts and merging | 100 random cut trees (up to 6 pieces): 0 unsound cells, every piece built, reconnecting everything ends at the root in 100 of 100; 195 of 1 302 pairs are siblings (exact), 632 more form a sound union, 475 escalate to the lowest-common-ancestor group (the whole squishy in 79 % of them); the morph to a merged piece arrives: 36 joins, shape RMS <= 0.021 R0, at rest within 41 mm/s (30 of 36 under 4 mm/s) |
| Rest, rim, neck | 36 of 36 poses (cap down, standing on the old foot, dome down, 12 families) at rest with >= 10 particles on the table; for the six pieces with a sharp rim, a finger on the dome moves the rim 1 to 10 degrees with the per-hinge fold limit against 23 to 46 degrees with the flat 110, and the piece rests within 1 mm/s instead of 33 to 114 mm/s; the neck swap pop is 0.15 R0 at today's waist and 0.065 (visible faces) at depth 0.35 |
| Cost | six pieces at detail 2 under 0.35 cost 0.78 to 1.10 of two whole bodies per frame; a build is 15 ms median and 76 ms p95 per detail-3 piece in the prototype (20 to 73 ms warm per half, up to 412 ms for a union): the median pair fits the neck's 45 to 70 ms, the tail is up to 3 times over it, so the port must be faster at the tail (R2) |
| Where the shipped solver fails | `collide`: the same swap flow passes every row on only 17 of 46 cuts and 23 of 36 nested sequences launch a child above 0.3 m; four scoped changes fix it (40 of 46, 0 of 36), whole bodies stay bit-identical (section 4, L8) |
| Not met | voxel IoU bars (G1), cap area and quality at detail 2 (G2, G4), the render's 15 degree cap triangles on 5.2 % of regions (R3), build cost, sloped faces slide, thin slices tip over; each is in section 10.2 with its number |

## 1. What the code does today (read this session) and where the owner's two complaints come from

| # | Fact | Where |
|---|------|-------|
| 1 | The cut is a goal morph, not surgery: `measureCut` clips the CURRENT deformed mesh (tetrahedra from a plane point), `setNeck` pinches the shape-matching goal into a waisted peanut (waist 0.3 of the cross-section, Gaussian over 0.42 R0, the lobes swell to keep the goal's volume); the shell holds t = 1 for 0.08 s and swaps the body for two new bodies | softbody.ts:1259-1293 (`measureCut`), 1299-1309 (`setNeck`), 2446-2537 (`neckGoal`), 204-209 (`NECK_WAIST`, `NECK_SIGMA`, `NECK_SWELL`, `NECK_TAU`); cut.ts:315-359 (`part`) |
| 2 | A piece is `createBody(genome, { piece: { frac, chunk, cutNormal, at, vel } })`. A face piece is the WHOLE species mesh scaled to the volume (`buildRest` x cbrt(frac x whole volume / rest volume)); a chunk is `buildChunkRest` (a 1.1 x 0.85 x 1.1 ellipsoid with the standard flat foot). Both are scaled to EXACTLY frac x the detail-3 whole's volume. A piece under 0.35 uses icosphere detail 2 (162 particles) | softbody.ts:279-292 (`pieceRest`), 526-537, 202-203; shape.ts:239-275 (`buildChunkRest`) |
| 3 | A chunk's flat face is NOT in its rest shape. `flatPoints` builds a second goal (`FLAT`, the rounded blob with everything beyond 0.55 R0 pulled onto a plane, rescaled about the ORIGIN to keep the volume); `frameUpdate` mixes it in as `GB = (Q + flatK (FLAT - Q)) x scale`, `flatK` decays with `ROUND_TAU` 2 s (putty 6, mochi 4, beads 3) | shape.ts:282-294; softbody.ts:704-710, 2373, 2390-2397, 210 |
| 4 | Shape matching: goal `g_i = c + R QG_i` where `c` is the centroid of the PREDICTED positions and `R` is extracted against the REST shape `Q`; every particle is pulled `XP += (g - XP) K soft_i`. Nothing in `frameUpdate` re-centres `GB` / `QG` (only `MEM` is: softbody.ts:2581-2582) | softbody.ts:1935-1992, 2551-2583 |
| 5 | The weeble: a torque rights the REST +y axis of the best-fit frame (`kUp` 40, `cAng` 8), and "supported gravity" fades gravity out while >= 5 particles touch the table. So a body always stands in its rest orientation, on whatever its lowest rest particles are, and rests exactly only if it has a patch of coplanar particles (the flat foot every shape gets) | softbody.ts:2633-2641, 1906-1916, 2290; shape.ts:70-76, 172-176 |
| 6 | Folds near a fingertip, a grab, the table edge or the neck are limited to a FLAT 110 degrees between adjacent triangle normals (the rest shape's own maximum is 50) | softbody.ts:1677-1785 (constants at 1687-1688), params.ts:207-210 |
| 7 | `setFrac` scales the rest volume and the goal by cbrt (a uniform scale of the SAME shape): that is how a reconnect "grows" the face piece. `collide` splits every contact push half-half between two bodies whatever their sizes | softbody.ts:1313-1319, 2368-2371, 1331-1414 |
| 8 | The shell: `lobeCentres` (mean of the particles on each side) places the pieces; the face goes to the side that holds `faceAnchor` (0, 0.08 R, 0.9 R); every other piece is a `chunk`; a closed-loop `moveTo` steers each new chunk to a SETTLE_GAP 0.16 m surface gap for 0.8 s as a stopgap for the launch | cut.ts:162-188, 304-308, 327-328, 63-75 |

### The cause of the launch (VERIFY_SHELL4_A F3, SHELL_4 "Known issues": 1.5 to 14 m/s), named and measured here

`flatPoints` does not re-centre its output (shape.ts:292-293 scales by `k` about the origin and stops). The mass-weighted mean of `FLAT` is not zero, so the shape-matching goal (softbody.ts:1980-1991) pulls the body's centre of mass along the cut normal every substep: the goal's centroid is `c + R mean_m(QG)`, the best-fit centroid of the positions is `c`, so the net pull is `K x soft x mean_m(QG)` per substep with no reaction. Momentum is not conserved, nothing damps it except drag, the table friction cap and MAX_SPEED (14 m/s).

**Measured (E0, `e0_oldchunk.mjs`, all 50 species).** The shipped chunk (`chunk: true`, cut face to the side or down, frac 0.5 and 0.3, `at` on the table, velocity 0, 120 frames, no fingers) against the SAME build with exactly one change, the goal re-centred (`sum m GB = 0`, section 3.2). First, the size of the defect: the mass-weighted mean of `FLAT` is 0.015 to 0.056 R0 for the 50 species (granulo 0.015, somnuff 0.056, most about 0.03 to 0.045; the "goal drift" column of the E0 table). Peak centre-of-mass speed in m/s:

| cut face | build | min | median | p90 | max |
|---|---|---|---|---|---|
| to the side, frac 0.5 | as shipped | 0.31 | **3.30** | 8.15 | **13.60** |
| to the side, frac 0.5 | goal centred | 0.07 | **0.15** | 0.33 | 0.43 |
| to the side, frac 0.3 | as shipped | 0.32 | 3.44 | 9.11 | 14.07 |
| to the side, frac 0.3 | goal centred | 0.07 | 0.18 | 0.38 | 0.45 |
| face down, frac 0.5 | as shipped | 0.31 | 0.98 | 9.89 | 14.18 |
| face down, frac 0.5 | goal centred | 0.83 | 1.28 | 1.53 | 1.64 |
| face down, frac 0.3 | as shipped | 0.04 | 1.01 | 13.57 | 14.24 |
| face down, frac 0.3 | goal centred | 0.81 | 1.21 | 1.37 | 1.51 |

So the shipped launch (VERIFY_SHELL4_A F3: 1.5 to 14 m/s) is reproduced on all 50 species (the families that launch hardest are the stiff ones: pop dome 12-14 m/s, firm silicone 7.5-11, slow-rise 6-8, gummy 4-9, putty 4.7-6.4; the soft ones less: water-fill 0.3-0.5, marshmallow 0.7-1.2), and ONE line, the centring, removes 95 % of it for a face to the side (median 3.3 to 0.15, max 13.6 to 0.43). For a face DOWN the centring removes the 14 m/s tail but leaves 0.8 to 1.6 m/s for every species: that is the second contributor, the chunk is built at the rounded `Q` while the goal and the edge rest lengths already follow `FLAT` (softbody.ts:2425-2431), so a face-down chunk is placed by the rounded shape's resting height and its flat goal then pulls it down onto the table (0.8 to 1.6 m/s is the speed of a fall of 3 to 13 cm; I did not separate the two effects further). Both vanish when the rest shape is the final shape (R4) and the goal is centred.

## 2. Shape: how a piece's rest mesh becomes the true part

### 2.1 Representation (what a piece IS in the physics)

* **Source solid S** = the whole squishy's rest mesh at icosphere detail 4 (2562 vertices, 5120 triangles) from the same `restPoint` recipe path (`buildRest(genome, buildIcosphere(4))`), re-expressed in the rest frame of the detail-3 whole (origin = its tributary-area centroid; a constant 3-vector shift). It is cached per (species, size) beside `WHOLE_VOL` (softbody.ts:282) and is the ONLY geometry a piece is cut from, however many cuts deep (a child is never cut from its parent's re-meshed polyhedron, so no cut compounds the previous one's error). Why detail 4: the sim mesh (detail 3) is already a 0.14 rad sampling of features 0.35 rad wide; re-sampling a polyhedron of that resolution would be a second generation of the same sampling. Measured (`t_src.mjs`, 6 species x 3 planes, against the detail-5 whole as the finest reference): a detail-3 source gives pieces whose volume is 2.88 % short of the detail-5 clip at the median (worst 4.67 %) and whose skin lies 0.0058 R0 from the detail-5 skin on average (p95 0.016); a detail-4 source 1.86 % (worst 2.55 %) and 0.0036 R0 (p95 0.012). The whole's own volumes at detail 3, 4, 5 are in the ratios 0.978 to 0.9925 (3 / 5) and 0.9955 to 0.9985 (4 / 5). Detail 4 cuts the detail-3 sampling error by about a third at the price of one 2 562-vertex source per species and size, built once and cached.
* **Region** = S intersected with the cells of the piece. A cell is a list of half-spaces `n . x >= d` in the WHOLE's rest frame (the shell's literals name them; `PieceRegion.planes` carries them); a piece is the UNION of its cells (one cell for a fresh half; several after a join of neighbours). Nothing else is stored: the region is an immutable value, the mesh is a pure function of (genome, region, detail).
* **Frames.** Every piece's rest frame has the SAME axes as the whole's (no rotation is ever baked in) and its origin at the tributary-area mass centroid of its own rest mesh: `restLocal_piece[i] = x_whole[i] - offset`, exactly (no scale: see 2.3 on volume). That is RENDER's contract R1/R7 and it makes nested cuts, merges and the plane pull-back pure translations. `offset` is a 3-vector in the whole's rest frame; `rayOrigin = centre - offset`.
* **Fractions** are always shares of V3 = the detail-3 whole's rest volume (the game's definition of "the whole", `WHOLE_VOL`). A piece's built rest volume is exactly `frac x V3` (2.3).

### 2.2 The build, step by step (all of it in a new pure module `src/physics/piece.ts`, no three, no DOM, deterministic, allocation only at build time)

Input: genome, region (cells), target detail d (3, or 2 under the budget rule 2.6), `frac`. Output: a `RestShape` (shape.ts:24-45: `restLocal, floppy, feature, strutW, mass, restRadius, restCenterY, peakVertex, restVolume, height`) plus `{ offset, rayOrigin, planes }`.

1. **Ray stack.** For a ray `o + t u`: the sorted crossings of S's triangles (uniform 14^3 grid over S's bounding box, Moller-Trumbore, same-sign duplicates on a shared edge merged) give the inside intervals `[a_k, b_k]`; each cell clips them to the span of its half-spaces: for plane `(n, d)` with `s0 = n . o - d`, `den = n . u`: `den > 0: t >= -s0/den`, `den < 0: t <= s0/(-den)`, `|den| < 1e-14: empty if s0 < 0`. A union merges the cells' interval lists (touching intervals within 1e-9 are one). `exit(o, u)` = the end of the interval that starts at 0 (the first exit). Measured: the grid walk tests ~26 to 37 triangles per ray instead of 5120, and it agrees with brute force on 4500 random rays.
2. **Centre.** `c` = the volume centroid of the region. For a child of `planCut` it is the exact centroid of the parent's REST MESH clipped by the plane (the same tetrahedra-from-a-plane-point sum `measureCut` already does, extended with the tetra centroids; no rays). For a region built from its cells alone (a join, a `setRegion`, a reload): `V = 1/3 int sum(b^3 - a^3) dOmega`, `c = (1/4 int sum(b^4 - a^4) u dOmega) / V` over 600 Fibonacci directions from the origin (valid for any origin and any shape).
3. **Soundness (star-shapedness).** `phi(c) = (1/V) 1/3 int exit(c, u)^3 dOmega` over 360 directions: the share of the region's volume that straight rays from `c` can reach. If `phi < 0.97` search another centre (a deterministic 160-point Fibonacci scan of S's box, then a 5-round pattern search, <= 190 evaluations); the region is SOUND iff the best `phi >= 0.95`. An unsound region is refused (2.7): its volume is not one body.
4. **Seed.** `x_i = c + exit(c, u_i) u_i` for the n direction vectors of the icosphere (`IcoMesh.dirs`), so the topology is exactly today's (642 / 162) and the mesh is star-shaped about `c` by construction.
5. **Radial relaxation, K = 4, lambda = 0.7.** `m_i` = mean of the 1-ring; `u' = normalise(x_i + lambda (m_i - x_i) - c)`; `x_i <- c + exit(c, u') u'`. Every vertex stays exactly on the skin or exactly on its cap plane (the re-projection is onto the true boundary), the map stays radial, and the vertex density equalises between the dense middle of a flat face (seen from an interior point a flat face is a gnomonic stretch: spacing grows with sec^2 of the angle off the face normal) and its rim.
6. **Rim snap** (RENDER R2). For every cap plane `p` (a vertex is "on p" when `|n . x - d| < 1e-8 R0`): the cap's triangles are those with all three vertices on `p`; its boundary vertices `B_p` are the on-`p` vertices that touch a triangle that is not a cap triangle; `g_p` = their mean. Each `i in B_p` slides OUTWARD in the plane, `w = normalise(proj_p(x_i - g_p))`, to the silhouette: `x_i <- x_i + w min(t, 0.9 e_i)`, with `t = exit(x_i + 1e-7 R0 n, w)` (the ray is started a hair on the kept side so a ray that lies in the plane is inside it) and `e_i` the vertex's mean edge (a bound that keeps the snap local). After it the rim is an edge loop that lies on the plane AND on S's skin (distance to S's skin <= 1e-7 R0), so the cap is a union of whole triangles and no triangle mixes cap and skin vertices across the rim.
   **Corners of a multi-cut piece (found by the cut-tree sweep, section 5.2).** Where two cap planes meet, a rim vertex that slides in its own plane runs into the other plane and lands on the line where the two caps meet; three adjacent vertices on that line are collinear, the triangle has zero area, and the validity gate reverts the whole snap to the unsnapped (chamfered) mesh: with the single-plane rules above 441 of 560 pieces of the random cut trees (79 %, pieces with 2 to 5 cap planes) reverted. Two rules: a vertex that already lies on two or more cap planes (a corner) is fixed in both the snap and the cap relaxation, and a rim vertex stops 0.3 of its mean edge short of every OTHER cap plane it is moving toward. Single-plane pieces are untouched by both rules. After them the snap reverted on 1 of the 560 pieces of the random cut trees (2 to 5 cap planes), and IoU against the clipped source rose from a median 0.922 to 0.957.
7. **Cap interior**: 12 in-plane Laplacian passes (lambda 0.8) on the on-`p` vertices that are not boundary (they stay exactly in the plane); **skin**: 4 radial relaxation passes (lambda 0.5) of the vertices that are on no plane (a skin vertex whose new direction would end on a cap plane stays where it is, so classes never change). Validity gate: no tetrahedron `(c, tri)` inverted and every triangle area > 1e-4 of the mean; otherwise the snap is undone (3 of 2 210 sound regions revert to the unsnapped mesh of step 5).
8. **Foot (adaptive).** If fewer than 7 vertices lie within 0.004 R0 of the lowest point (the shipped rule says 5), flatten the bottom: the floor is `f = max(y_min + 0.025 (y_max - y_min), the 8th-lowest vertex height)`, so AT LEAST 7 vertices land exactly on it, with a quadratic shoulder instead of the shipped smooth max (which never lands a vertex exactly on the floor unless it is more than 0.077 R0 below it): `t = y - f; y' = f (t <= 0), f + t^2 / (2k) (0 < t < k), y - k/2 (t >= k)`, `k = 0.035 R0` (the same width as shape.ts:70-76). A piece with a cap down or with the old foot already has its flat patch and is left alone. Why adaptive: with the shipped rule a half laid dome-down on the dollop (the lower half of a level cut, 0.5 R0 tall) had only 4 particles on the table and sagged 27 mm and moved at 0.35 m/s while it settled; with the 7-vertex rule: 11 on the table, no sag, 0.000 m/s (E2 below). In the 2 210-region sweep the shipped 5-vertex rule fires for 854 detail-3 and 437 detail-2 regions; in the swap-flow run (586 pieces) the adaptive 7-vertex rule gave 206 pieces (35 %) a foot patch. Rest on the table is exact for every piece measured (E2). The foot never moves a vertex that lies on a cap plane (a vertical shift takes it off an oblique plane and across it: that was the cause of 22 of the 114 pieces overlapping their sibling on an oblique cut, 0.01 to 0.02 R0, before the rule).
9. **Exact volume, without a scale.** The rest volume must be exactly `frac V3` and `restLocal + offset` must stay the whole-frame position of the same material (RENDER R7). A uniform scale does the first and breaks the second by up to 6 % of the distance from the centroid, so the skin vertices (those on no cap plane) move together by `delta` along their area-weighted vertex normals; `V(delta)` is monotone, solved by secant steps to 1e-12 (6 steps gave 3.6e-9 once a hard clamp was inside the loop; with the limit below 6 and 14 both reach 1e-12; use 14). Measured `|delta|`: median 0.0002 R0, p95 0.0062 R0, max 0.0118 R0 (the radial relaxation removes most of the 1.5 % an inscribed polyhedron loses, and the sag of the chords is the same order as `delta`, so the offset moves the chords TOWARD the true curved skin).
   **A piece never leaves its half-spaces (found by running the two pieces of a cut against each other).** In the 57-cut test (`m2_overlap.mjs`, 12 species x 5 planes, both pieces) 22 of 114 pieces had vertices on the wrong side of their own plane, 40 to 210 of them, up to 0.0195 R0, so the two pieces of such a cut overlapped by that much; only oblique planes did. The cause was the foot (step 8): its vertical shift of every vertex below the floor took cap vertices off an oblique plane and across it. Two rules fix it: the foot never moves a vertex that lies on a cap plane, and in the offset of this step the component of a skin vertex's move TOWARD a cap plane is limited so that the vertex keeps `min(its distance, 0.005 R0)` from it (the limit is inside `V(delta)`, so the volume is still solved exactly: 7.5e-13 to 1e-12 over 117 pieces). A first version that projected crossing vertices onto the plane instead collapsed triangles (aspect ratios of 1e16, 29 wrong-facing triangles): do not do that. With the two rules: 0 of 114 pieces overlap or cross their plane, and the mesh quality is that of the table in 2.2.1.
10. **Normalise.** Tributary-area masses `m_i` (a third of each incident triangle, mean 1), mass centroid `c_m`, `offset = c_m`, `restLocal_i = x_i - c_m`, one more numeric re-centre so `sum m_i restLocal_i = 0` to 1e-17, `restRadius = R0 cbrt(frac)`, `restCenterY = -min y`, `height`, `peakVertex`.
11. **Weights.** For each vertex the whole-frame direction from the recipe origin gives `floppyOf(recipe, dir)`, `floppyFeature`, `floppySecond` (shape.ts:117-137) and `strutWeight`; a cap vertex deep inside the body is not a thin tip, so the weight is faded by `sstep(0.55, 0.9, rho / r_skin(dir))` (`rho` = distance from the recipe origin, `r_skin` = `evalShape(dir) R0`). `buildStruts` (struts.ts) is called unchanged on the new rest mesh: a cut ear has its struts; a cap through an ear keeps the ear's flop.

#### 2.2.1 The final sweep: all 50 species x 23 planes x both sides

Planes: level (`y`), vertical (`x`, `z`) and two oblique families (`t1`, `t2`) at offsets -0.5, -0.2, 0, +0.2, +0.5 R0 from the centre (the `x` family at 0, +0.2, +0.5, the others symmetric), each with both sides: 2 300 candidate regions, 87 skipped (a side under 1/8), **2 213 built, 2 210 sound** (3 unsound, section 2.4). Every row is the FINAL pipeline (relax 4, rim snap, cap 12, skin 4, normal-offset volume with the half-space limit, adaptive 7-particle foot that leaves cap vertices alone, 14 secant steps). The reference is the source solid clipped by the plane (not the voxel row G1, which uses the detail-3 whole).

Detail 3, 2 210 regions, by plane class and offset (offsets are of the plane from the centre, both signs pooled):

| plane (offset R0) | regions | volume of the radial mesh before the exact-volume step: median / worst | normal offset for exact volume (median / max, R0) | IoU vs the clipped source (median / min) | min triangle angle (median / p5 / min) | cap area / true section (median / min) | rim dihedral (median / p95 / max) | cap triangle < 15 deg |
|---|---|---|---|---|---|---|---|---|
| level 0 | 100 | -1.9 % / -4.9 % | -0.0001 / 0.0014 | 0.989 / 0.972 | 21.8 / 13.0 / 3.5 | 0.951 / 0.890 | 99 / 125 / 139 deg | 3/100 |
| level 0.2 | 200 | -1.9 % / -5.1 % | -0.0001 / 0.0034 | 0.989 / 0.969 | 21.5 / 9.6 / 0.7 | 0.956 / 0.801 | 101 / 133 / 156 deg | 7/200 |
| level 0.5 | 167 | -1.5 % / -6.3 % | -0.0001 / 0.0038 | 0.989 / 0.971 | 20.8 / 7.3 / 1.5 | 0.968 / 0.834 | 86 / 142 / 159 deg | 14/167 |
| tilted 0 | 200 | -1.7 % / -3.0 % | 0.0002 / 0.0068 | 0.983 / 0.961 | 18.9 / 9.7 / 3.7 | 0.957 / 0.936 | 117 / 135 / 146 deg | 2/200 |
| tilted 0.2 | 400 | -1.7 % / -6.1 % | 0.0004 / 0.0118 | 0.984 / 0.939 | 18.7 / 10.0 / 3.5 | 0.959 / 0.749 | 117 / 141 / 159 deg | 14/400 |
| tilted 0.5 | 385 | -1.7 % / -9.8 % | 0.0003 / 0.0107 | 0.985 / 0.868 | 16.7 / 4.8 / 0.2 | 0.961 / 0.864 | 113 / 147 / 168 deg | 33/385 |
| vertical 0 | 200 | -1.7 % / -4.6 % | 0.0005 / 0.0044 | 0.984 / 0.959 | 20.0 / 13.2 / 8.6 | 0.957 / 0.886 | 104 / 129 / 146 deg | 5/200 |
| vertical 0.2 | 300 | -1.8 % / -5.3 % | 0.0004 / 0.0051 | 0.983 / 0.945 | 19.3 / 9.0 / 1.8 | 0.953 / 0.768 | 111 / 141 / 162 deg | 16/300 |
| vertical 0.5 | 258 | -1.4 % / -5.8 % | 0.0002 / 0.0057 | 0.977 / 0.941 | 19.3 / 9.5 / 0.8 | 0.970 / 0.791 | 94 / 148 / 158 deg | 20/258 |

Detail 2 (pieces under 0.35), 569 regions:

| plane (offset R0) | regions | volume of the radial mesh before the exact-volume step: median / worst | normal offset for exact volume (median / max, R0) | IoU vs the clipped source (median / min) | min triangle angle (median / p5 / min) | cap area / true section (median / min) | rim dihedral (median / p95 / max) | cap triangle < 15 deg |
|---|---|---|---|---|---|---|---|---|
| level 0.2 | 59 | -6.5 % / -9.8 % | 0.0066 / 0.0127 | 0.968 / 0.937 | 16.6 / 10.5 / 4.6 | 0.878 / 0.700 | 113 / 144 / 146 deg | 1/59 |
| level 0.5 | 69 | -6.1 % / -12.0 % | 0.0057 / 0.0106 | 0.973 / 0.924 | 16.0 / 3.9 / 2.6 | 0.861 / 0.736 | 114 / 141 / 161 deg | 6/69 |
| tilted 0.2 | 66 | -5.9 % / -9.8 % | 0.0123 / 0.0184 | 0.962 / 0.918 | 15.5 / 8.2 / 5.6 | 0.909 / 0.832 | 123 / 141 / 155 deg | 1/66 |
| tilted 0.5 | 185 | -6.6 % / -13.7 % | 0.0058 / 0.0213 | 0.956 / 0.823 | 13.9 / 7.0 / 1.8 | 0.882 / 0.813 | 129 / 148 / 166 deg | 1/185 |
| vertical 0.2 | 80 | -6.8 % / -11.0 % | 0.0089 / 0.0167 | 0.953 / 0.922 | 16.0 / 9.5 / 8.8 | 0.881 / 0.746 | 123 / 150 / 161 deg | 2/80 |
| vertical 0.5 | 110 | -6.1 % / -12.1 % | 0.0076 / 0.0131 | 0.951 / 0.920 | 16.5 / 7.8 / 2.0 | 0.886 / 0.783 | 125 / 151 / 163 deg | 8/110 |

Per species, the worst of its detail-3 regions (sorted by worst IoU; columns: regions | IoU min | smallest triangle angle (degrees) | radial-mesh volume before the exact-volume step, worst | rim dihedral max (degrees) | skin coverage max-of-samples (R0) | cap / true section, min):

```
  capnap      n 44 | 0.868 | 1.8 | -9.8 % | 167 | 0.198 | 0.913
  selenuff    n 44 | 0.939 | 1.8 | -6.1 % | 159 | 0.196 | 0.908
  puddlo      n 42 | 0.941 | 0.8 | -5.1 % | 145 | 0.056 | 0.801
  tadpolo     n 42 | 0.943 | 1.8 | -3.8 % | 150 | 0.076 | 0.899
  crimpo      n 42 | 0.945 | 4.8 | -4.7 % | 153 | 0.078 | 0.827
  granulo     n 42 | 0.946 | 0.2 | -5.0 % | 145 | 0.099 | 0.826
  marigel     n 40 | 0.946 | 2.8 | -4.9 % | 146 | 0.135 | 0.768
  fossilo     n 46 | 0.947 | 3.7 | -4.6 % | 168 | 0.195 | 0.864
  thumbly     n 44 | 0.948 | 3.1 | -5.8 % | 155 | 0.070 | 0.791
  pastrel     n 42 | 0.949 | 0.8 | -5.3 % | 151 | 0.081 | 0.843
  glimglop    n 46 | 0.953 | 5.4 | -5.5 % | 152 | 0.058 | 0.871
  burrbin     n 46 | 0.954 | 8.5 | -4.5 % | 146 | 0.062 | 0.901
  rattlebead  n 46 | 0.955 | 9.1 | -3.4 % | 153 | 0.074 | 0.895
  dimpla      n 44 | 0.955 | 13.1 | -4.5 % | 136 | 0.052 | 0.900
  wrigglo     n 40 | 0.955 | 3.6 | -4.0 % | 149 | 0.088 | 0.872
  caromel     n 46 | 0.956 | 5.1 | -4.4 % | 150 | 0.050 | 0.919
  boingle     n 43 | 0.956 | 2.9 | -3.7 % | 146 | 0.048 | 0.901
  wisplet     n 42 | 0.956 | 4.3 | -4.6 % | 157 | 0.059 | 0.749
  knubby      n 44 | 0.956 | 7.9 | -4.1 % | 139 | 0.084 | 0.888
  petalop     n 44 | 0.956 | 9.8 | -4.9 % | 140 | 0.070 | 0.837
  dollop      n 44 | 0.957 | 2.4 | -3.4 % | 150 | 0.065 | 0.880
  kneadle     n 44 | 0.957 | 9.8 | -4.0 % | 153 | 0.050 | 0.877
  constello   n 46 | 0.958 | 9.7 | -4.3 % | 147 | 0.056 | 0.895
  prismelo    n 46 | 0.959 | 4.4 | -4.1 % | 154 | 0.086 | 0.862
  glugbean    n 42 | 0.959 | 4.7 | -4.1 % | 142 | 0.076 | 0.867
  hooplet     n 44 | 0.959 | 12.4 | -5.0 % | 144 | 0.042 | 0.834
  hushpuff    n 46 | 0.959 | 4.4 | -4.3 % | 154 | 0.072 | 0.882
  ambrosel    n 44 | 0.960 | 4.3 | -3.1 % | 160 | 0.063 | 0.876
  swishel     n 44 | 0.960 | 4.5 | -2.9 % | 155 | 0.040 | 0.882
  cindergoo   n 44 | 0.960 | 11.9 | -3.5 % | 164 | 0.085 | 0.892
  thudge      n 46 | 0.961 | 12.9 | -5.3 % | 140 | 0.061 | 0.886
  flipdome    n 46 | 0.961 | 6.3 | -3.9 % | 149 | 0.052 | 0.900
  spirelo     n 44 | 0.961 | 5.2 | -3.7 % | 147 | 0.080 | 0.905
  gloopsy     n 46 | 0.961 | 5.6 | -4.0 % | 150 | 0.060 | 0.887
  crumbit     n 46 | 0.961 | 3.6 | -3.8 % | 152 | 0.056 | 0.881
  somnuff     n 46 | 0.962 | 4.0 | -4.1 % | 156 | 0.099 | 0.892
  sproutle    n 44 | 0.962 | 3.5 | -3.5 % | 149 | 0.054 | 0.891
  diademo     n 46 | 0.962 | 8.7 | -3.7 % | 158 | 0.063 | 0.888
  slumbrel    n 44 | 0.962 | 2.2 | -3.6 % | 154 | 0.127 | 0.896
  tidelume    n 45 | 0.963 | 4.5 | -4.4 % | 162 | 0.056 | 0.890
  munchip     n 41 | 0.963 | 3.3 | -4.2 % | 150 | 0.109 | 0.886
  zingle      n 45 | 0.963 | 6.3 | -3.3 % | 149 | 0.092 | 0.904
  chunkle     n 44 | 0.965 | 9.8 | -4.7 % | 144 | 0.104 | 0.877
  nuzzo       n 44 | 0.965 | 1.5 | -6.3 % | 150 | 0.060 | 0.900
  taffelin    n 45 | 0.965 | 5.4 | -4.0 % | 146 | 0.091 | 0.891
  cushlet     n 46 | 0.966 | 0.7 | -3.4 % | 138 | 0.083 | 0.780
  acornel     n 46 | 0.967 | 12.1 | -3.6 % | 144 | 0.069 | 0.895
  plumpet     n 46 | 0.968 | 16.9 | -3.3 % | 133 | 0.068 | 0.903
  skeinara    n 45 | 0.968 | 6.2 | -3.3 % | 153 | 0.302 | 0.899
  twangle     n 42 | 0.970 | 4.3 | -3.7 % | 144 | 0.084 | 0.879
```

Foot: the shipped 5-vertex rule would have added a foot patch to 854 of the 2 210 detail-3 regions and 437 of the 569 detail-2 regions (the adaptive rule of step 8 fires when fewer than 7 particles are on the floor, a few more; the swap-flow run in section 9 footed 206 of 586 pieces). Reading the tables: the volume column is the seed's deficit before the normal offset restores it (the radial mesh inscribes the part); the offset itself is 0.0002 R0 at the median at detail 3 and 0.008 R0 at detail 2; the rim dihedral is the TRUE edge of the cut (a half ball has 90, a lens 130 to 170) and is what the solver's fold limit has to accept (3.3).

### 2.3 Two approaches measured, and why the radial re-mesh

Same 13 species (dollop, chunkle, puddlo, twangle, kneadle, crimpo, wisplet, capnap, boingle, dimpla, crumbit, spirelo, marigel) x 4 planes (level, vertical, vertical 0.5 R off-centre, tilted 0.2 R off-centre) x both sides = 102 regions, the same source solid, the same metrics (`sweepB.mjs`): volume of the polyhedron against the exact clipped volume BEFORE the volume fix, smallest triangle angle, regions that contain a triangle under 15 degrees, flipped triangles (negative tetrahedron from the centre), largest rim dihedral, flat cap area against the exact section area, and the one-sided Hausdorff distance from sampled points of the original skin (kept side) to the piece mesh, in R0.

| approach | volume vs exact (median / worst) | min angle (median / p5 / worst) | regions with a triangle < 15 deg | regions with a flip | cap area / true | coverage max-of-samples (median / p95 / worst) | rim dihedral (median / p95 / max) |
|---|---|---|---|---|---|---|---|
| **A** radial re-mesh from the centroid (first exit), detail 3 | -2.3 % / -6.7 % | 23 / 13 / 8 | 8 | 0 | 0.67 | 0.056 / 0.111 / 0.142 | 97 / 125 / 133 |
| A + dihedral-limited Laplacian bevel (60 deg) | -5.2 % / -36.6 % | 25 / 15 / 12 | 6 | 0 | 0.38 | 0.132 / 0.316 / 0.473 | 59 / 60 / 60 |
| A + bevel (90 deg) | -2.8 % / -13.5 % | 24 / 13 / 12 | 6 | 0 | 0.62 | 0.067 / 0.192 / 0.276 | 85 / 89 / 90 |
| **A + radial relaxation x 8** | -1.6 % / -3.0 % | 27 / 15 / 10 | 4 | 0 | 0.74 | 0.038 / 0.060 / 0.113 | 94 / 122 / 135 |
| **B** clamp and squash (the whole's own 642 vertices: kept ones stay, removed ones are projected onto the plane and scaled into the section outline) | -1.7 % / -6.2 % | **0 / 0 / 0** | **93 of 102** | **83** | 0.90 | 0.041 / 0.083 / 0.097 | 180 / 180 / 180 |
| B + bevel (75 deg) | -2.2 % / -9.0 % | 1 / 0 / 0 | 93 | 13 | 0.79 | 0.058 / 0.153 / 0.194 | 71 / 75 / 95 |
| A at detail 2 | -8.0 % / -25.8 % | 25 / 17 / 14 | 4 | 0 | 0.49 | 0.131 / 0.234 / 0.302 | 94 / 125 / 140 |
| A + relaxation x 8 at detail 2 | -4.4 % / -6.7 % | 27 / 17 / 14 | 2 | 0 | 0.60 | 0.078 / 0.116 / 0.153 | 90 / 114 / 128 |

* **B (correspondence-preserving: the piece keeps the whole's vertices)** is the attractive idea (eyes and patterns stay on their vertices; merging is the reverse map) and it fails on the mesh itself: the removed hemisphere's vertices, projected onto the plane, are dense at the rim and degenerate (the projection of a hemisphere has Jacobian cos(theta) -> 0 at the equator), the squash folds the cap over itself (83 of 102 regions have inverted triangles) and the minimum angle is 0. No bevel repairs a cap that is already folded. Rejected.
* **A with a bevel** is the obvious way to get a rim the fold limit likes (<= 60 degrees), and it is wrong: a Laplacian that keeps iterating until the sharpest hinge is under the limit erodes thin pieces (volume -36 %, the flat cap shrinks to 38 % of the section, the rim recedes by up to 0.47 R0). The rim of a true cut IS 90 to 140 degrees; the solver should accept it (3.3) and the mesh should not hide it.
* **A + radial relaxation** is the cheap fix of the real defect of A (the gnomonic stretch of the flat face): vertices move to the mean of their neighbours and are put back ON the true boundary along the same rays, so volume, silhouette and cap are not eroded. The final pipeline uses 4 passes (K = 4), chosen from tuning runs of 1, 2, 4 and 8; the "x 8" row above is the 13-species comparison (volume -1.6 % median), the full sweep below is K = 4 (relaxed volume -1.72 % median over 2 210 regions) and costs half the relaxation rays.
* The full sweep (all 50 species, 2 300 candidate regions, 2 213 built; 2.2.1): the exact-centroid radial re-mesh has no star-shapedness problem on 2 210 of the 2 213 built regions (2.4), a relaxed-mesh volume error of -1.7 % at the median (worst -9.8 %) before the exact-volume step, and a median skin coverage error of 0.003 R0.

### 2.4 Star-shapedness: ears, tails and thin features

The cut part is star-shaped about its centroid when straight rays from it reach all of it. Over the 2 216 single-plane regions of the sweep (50 species, 5 normals x 5 offsets x both sides, >= 1/8): the share of the region's volume that rays from the exact centroid reach (`phi`) has median 1.0000 and p5 0.998; `phi >= 0.99` for all but 8 regions, `< 0.97` for 6, `< 0.94` for 3. The three that fail: **munchip and selenuff, a level plane at +0.5 R0 on the upper side** (both species have two big mirrored ears; the plane takes both ears off together: the part is TWO islands, the centroid lies in the valley between them OUTSIDE the material, `phi` = 3.6 % and 4.3 %), and ambrosel at an oblique 0.5 R0 plane (`phi` 93.0 %). The next worst are capnap (94.3, 95.6 %), selenuff (95.9 %), fossilo (97.4 %), munchip (98.6 %). So the answer to "what happens when the clipped part is not star-shaped about its centroid" is, measured: it essentially does not happen for ONE plane (0.14 % of regions), it happens when a plane takes off two features at once, and for nested cuts 0 of 460 accepted nested cuts produced an unsound cell or child in the random trees of sweep 5.

Policy (the code of 2.2 step 3): (1) the centroid; (2) if `phi < 0.97` the deterministic centre search, which is written (`centre.mjs`: the 160-point scan and the pattern search) and used on every cell of the cut trees of sweep 5 (below); sweep 4f did not run it on the three single-plane regions that fail the centroid test, because two of them (munchip, selenuff: two islands) cannot be rescued by any centre; (3) the part is SOUND if the best `phi >= 0.95`; the missing <= 5 % of the volume (a shadowed ear tip) is simply not meshed and the exact-volume step (2.2 step 9) puts the volume back into the rest of the skin (+0.1 to +0.4 % of R0 of normal offset); (4) otherwise it is NOT ONE BODY (two islands): `planCut` reports `sound = false` and the shell refuses with its own line ("That cut would leave loose crumbs. Try another angle."). No bridge, no web, no hull: a piece that is a fake shape would break "everything on that side stays with it". The same test is applied to every NEW cell of the cut tree, which is what makes the shell's lowest-common-ancestor join always buildable (5.2).

### 2.5 Nested cuts

A cut of a piece is a new half-space in the WHOLE's frame (`d_w = d_r + n_r . offset`), so the child's region is S cut by the whole list (or union of lists) and is built from S, not from the parent's mesh: nothing compounds. The child's FRACTION comes from the exact clip of the parent's rest mesh (`planCut`), the child's GEOMETRY from S; the two differ by the parent's re-mesh error (<= 1.5 %) and the exact-volume step removes it (< 0.005 R0 of skin offset). Up to 5 cuts deep (6 pieces) on all 50 species: the pieces of the 100 cut trees of sweep 5 (560 pieces with 1 to 5 cap planes, detail 2 or 3 by the 0.35 rule): IoU against the clipped source median 0.957, min 0.864 (by cap planes: 1: 0.920, 2: 0.864, 3: 0.900, 4: 0.893, 5: 0.963); skin coverage max-of-samples p95 0.177 R0, worst 0.375 (bar p95 <= 0.08: NOT met; most nested pieces are small and at detail 2, where the single-plane sweep gives 0.128); smallest triangle angle median 12.9, p5 5.8 degrees, a triangle under 15 degrees in 413 of 560 (74 %); no flip; sum of the fractions of every tree is 1 by construction (the shell derives B = parent - A). The nested pieces are visibly coarser than the first-generation ones

### 2.6 Small pieces (detail 2) and the vertex budget

CUT.md 4.3: a piece under 0.35 uses the 162-vertex mesh (softbody.ts:529). Measured with the final pipeline (sweep 4f, 569 sound detail-2 regions against 2210 at detail 3): IoU against the clipped source median 0.958 (p5 0.936, min 0.823) against 0.987 (0.962, 0.868); the radial mesh holds 6.4 % less volume than the part (median; worst 13.7 %) against 1.7 % (worst 9.8 %), so the exact-volume step moves the skin 0.0078 R0 out (p95 0.0150, max 0.0213) against 0.0002 (0.0062, 0.0118); 253 regions (44.5 %) contain a triangle under 15 degrees against 430 (19.5 %); the flat cap holds a median 0.886 of the true section (0.958 at detail 3); skin coverage max-of-samples median 0.066 R0 (0.024). At detail 2 the rim and the cap are twice as coarse, and the polyhedron is inscribed more deeply. The vertex budget decides it (E6, section 6.4): six pieces at detail 2 under 0.35 cost 0.78 to 1.10 of two whole bodies per frame, with detail 3 from 0.2 they cost 1.14 to 1.44, with detail 3 everywhere 4.2 to 4.4. The rule therefore stays CUT.md's: **`frac < 0.35` -> detail 2, else detail 3**, and the quality cost of detail 2 above is the price of "6 pieces <= 2 whole bodies".

### 2.7 The foot, and a plane through the foot

The whole's foot (shape.ts:70-76, 170-176) is a patch of exactly coplanar particles; S contains it, so a piece that holds part of it gets the cut part of the patch (the ray stack ends the ray on the foot triangles like any other skin), and the radial relaxation keeps those vertices on the plane. A vertical plane through the middle gives each half a half-disc foot (>= 10 coplanar particles on the table in the measured poses of E2, 53 for the dollop's vertical half); a tilted plane through the foot gives a wedge. A piece with no foot (a slice from the side, a top cap) gets the adaptive flat patch of 2.2 step 8 at its lowest part, never including a vertex of a cap plane (so a thin slice cut off the side has nothing flat to stand on and tips over: section 4 and owner question 3). A level plane BELOW the foot's height misses the body; a plane just above it leaves a slab under 1/8 and is refused.

## 3. The solver with a true rest shape

### 3.1 What the loop does with it (nothing new is needed in the hot path)

The new rest shape is a `RestShape` like any other, so the constructor (softbody.ts:579-784) builds everything from it unchanged: `Q`, the masses `M`, `H0` and the `foot` list (softbody.ts:605-612: for a cap-down piece the whole cap, 100-200 particles, is the foot), edge rest lengths `EL` / `EL0`, hinge pairs `HD` / `HP`, the Laplacian offsets `LQ`, `invH`, `MEM = Q`, the struts, `volS0`. The shape-matching goal `g_i = c + R q_i` aims at `Q` (`goalOn` is false unless memory, a ceremony or a neck is active). The flat cut face is therefore held by the shape matching exactly as the foot, the belly or an ear is: it stays flat because it IS the rest shape. Consequences, each checked by a probe row (section 9):

* **Volume constraint**: `restVolume = meshVolume(Q) = frac x V3` to better than 1e-8 (the exact-volume step of 2.2); `S0`, `volAlphaT` follow. `fracBuilt = frac`, `setFrac` keeps working as a uniform scale (it is only used by the legacy path now).
* **Strut / floppy weights**: from the recipe at each vertex's whole-frame position (2.2 step 11): a cut ear flops, a cap through the middle of the body does not.
* **Shape-matching frame**: `extractRotation` is warm-started and bounded; a thin slab (frac 0.125 of a flat species) has a small third singular value of `A = sum m p q^T`: measured: no safety reset and a bounded motion on the thin pieces (the 29 pieces under 0.2 of the swap-flow run (E1 below) rise 0 mm above where they were born, peak at 0.44 m/s upward speed, are at rest within 0.047 m/s over the last half second, keep a volume ratio of at least 0.981, peak at 89 degrees of fold excess and cause no safety reset (the rotation extraction is not the failure mode of a thin piece; its tipping and creasing are, section 10.2)).
* **Family memory**: `MEM = Q`, so a plastic family (putty memStiff 5, mochi 3, beads 2) holds only what is pressed into it after the cut, as on a whole body. Nothing rounds over in time: no `flatK`, no `FLAT`, no `ROUND_TAU`, no `roundTau`, no `buildChunkRest`, no `flatPoints` for a piece with a region (they stay only for a body built the old way: the mat uses `{ frac: 1, chunk: false, at }`, boot.ts:111-112). A putty piece keeps its flat face for ever because it IS flat, not because a time constant is long. Decision on the rim: it is the true edge, one edge loop on the plane and the silhouette, the same for every family; the render's Phong smoothing of the sim normals (jelly.ts) is the only softening, and RENDER owns the fresh-cut sheen. I do NOT add a per-family rim bevel: the 60-degree bevel I measured costs 5 to 20 % of the volume of a thin piece and moves the rim 0.13 R0 inward (sweep 1, "A + bevel"), and RENDER needs a clean rim loop (R2).

### 3.2 Rule 1: every goal has zero mass-weighted mean (the launch fix) (measured effect on the OLD chunk: median 3.3 to 0.15 m/s, max 13.6 to 0.43 m/s over 50 species, section 1)

`centreGB()`: after `GB` is composed in `frameUpdate` (softbody.ts:2390-2399: fold, burst, setFrac scale, flat face, neck) and before `memoryStep` / `QG` (2401-2410): `GB_i -= sum_j m_j GB_j / Mtot`, where the goal has a neck or a morph (`nk > 0 || morphOn`). I measured the size of the mean BEFORE the correction for every existing term (below): the fold sphere (max 0.011 R0), burst and setFrac (exactly 0: uniform scales) are small or zero, and the neck is the large one (median 0.026-0.056, max 0.099 to 0.177 R0 for the pinch along x, y, a tilted axis), so the neck and the morph are centred and the other terms are left ALONE. That keeps every whole body bit-for-bit what it is until its first `setNeck` (E11 below: identical `stateHash` at every checkpoint through press, rub, pull, release, nudge, fold ceremony and burst; the first differing checkpoint is the first `setNeck` call, and with the centring switched off the whole scripted session, neck and setFrac included, is identical). It costs 6n flops per frame while a neck or morph runs. `goalDrift` (a debug field next to `debug`) holds the size of the correction; the probe asserts it is <= 1e-9 R0 after the call and prints the size BEFORE it for every existing term:

| goal term (mass-weighted mean of `GB`, 50 species) | max (species) | median | decision |
|---|---|---|---|
| fold sphere `QS` (`setFold(1)`) | 0.0112 R0 (capnap) | 0.0023 | not centred (below any visible drift; keeps whole bodies bit-identical) |
| burst (`burstOpen`) | 0.0000 | 0.0000 | uniform scale about the origin |
| `setFrac` | 0.0000 | 0.0000 | uniform scale |
| neck, pinch along x (`setNeck`, t = 1, plane through the centre) | **0.0991 R0** (nuzzo) | 0.0467 | **centred** |
| neck, pinch along y | **0.0779 R0** (diademo) | 0.0257 | **centred** |
| neck, pinch along a tilted axis | **0.1767 R0** (marigel) | 0.0555 | **centred** |
| old chunk `FLAT` (shape.ts:282-294) | 0.015 to 0.056 R0 | about 0.03 | the launch (section 1); gone with the rest shape |

The neck is the only existing term with a mean of the size of the launch cause, and it acts on the WHOLE body during the 0.3 s pinch, so the old cut also pulled the parent's centre of mass along the pinch during the neck (I measured the size of the goal's mean here, not the resulting speed); centring removes that too.

### 3.3 Rule 2: the fold limit knows the rest dihedral (needed because the rim is a true edge)

softbody.ts:1687-1688 computes ONE limit for every hinge: `half = (pi - 110 deg) / 2`, `ch = cos(half)`, `sh = sin(half)`, `cosMin = cos(2 half)`. A true rim hinge is 100 to 140 degrees AT REST (sweep 4: median 110 degrees, p95 143, max 168), so a fingertip or the table edge near it would hold the rim "folded" past the limit for as long as it is near and the loop would re-open it by force every substep. The fix is data, not logic: three `Float64Array(nh)` (`HC`, `HCH`, `HSH`) filled in the constructor from the rest dihedral of each hinge, `lim_h = max(FINGER.foldMaxDeg, restDih_h + FOLD_MARGIN)` with `FOLD_MARGIN = 30` degrees and the limit never above 170 (the prototype omits this cap: a rest hinge over 140 degrees, 5 % of the regions, would otherwise get a limit past 180; none was near a finger in E10), and `foldLimit` reads them per hinge instead of the locals (the three locals and `deepCos` move inside the hinge loop). For every hinge of a whole body (rest dihedral <= 55 degrees) `lim_h` is exactly 110 and the three numbers are bit-identical to today's: identical `stateHash` at all 33 checkpoints of a scripted session (press, rub, pull, release, nudge, fold ceremony, burst, neck, setFrac) on 12 of 12 species with the rest-aware fold limit alone; with the goal centring added, identical through checkpoint 28 (press, rub, pull, release, nudge, fold, burst) and different from checkpoint 29, the first `setNeck`, on all 12 (by design: the neck goal is the term that was off-centre). Measured (E10, `e10_rim.mjs`): the TOP piece of a level cut at +0.3 R0 and +0.45 R0 (8 species; the cap is down on the table, so the sharp rim IS on the table) with a finger pressing the dome for 0.8 s, the flat 110-degree limit (shipped) against the per-hinge limit. Columns: rim hinges (rest dihedral over 100 degrees) / largest change of a rim hinge from its own rest dihedral / the piece's centre speed 2.5 s after the finger left:

| piece | rim hinges at rest > 100 deg | flat 110: rim moved / late speed | rest-aware: rim moved / late speed |
|---|---|---|---|
| dollop +0.3 R0 (frac 0.23) | 9 | 23 deg / 43.3 mm/s | **8 deg / 0.8 mm/s** |
| dollop +0.45 R0 (0.13) | 12 | 27 deg / 51.4 mm/s | **10 deg / 0.4 mm/s** |
| kneadle +0.3 R0 (0.24) | 5 | 46 deg / 114.1 mm/s | **4 deg / 0.1 mm/s** |
| kneadle +0.45 R0 (0.14) | 5 | 36 deg / 53.8 mm/s | **4 deg / 0.1 mm/s** |
| crimpo +0.3 R0 (0.19) | 18 | 25 deg / 45.8 mm/s | **4 deg / 0.1 mm/s** |
| dimpla +0.3 R0 (0.20) | 10 | 29 deg / 32.7 mm/s | **1 deg / 0.0 mm/s** |
| boingle +0.3 R0 (0.23) | 5 | 6 deg / 7.1 mm/s | 3 deg / 0.0 mm/s |
| wisplet +0.3 R0, twangle +0.3 and +0.45, chunkle +0.3 and +0.45 | 0 to 8 | identical in both (no hinge past 100 degrees, or the finger never reaches them) | identical |

With the flat limit the rim is held 23 to 46 degrees away from its own rest shape while the finger or the table is near, the loop re-opens it by force every substep and the piece keeps moving 2.5 s after the release (33 to 114 mm/s); with the per-hinge limit the rim stays within 1 to 10 degrees and the piece is at rest within 1 mm/s on all seven affected pieces. For a whole body the per-hinge limit is exactly 110 on every hinge (rest dihedral <= 55 degrees), so nothing changes there (E11).

### 3.4 The neck ends in the two true parts

`setNeck(plane, t, depth?)` today re-derives the rest-space plane every frame from the WORLD plane and the body's current frame (softbody.ts:2453-2456), so a body that drifts or turns during the 0.3 s pinch moves the pinch relative to its material, and the plane the shell used to predict the fractions at the swipe is not the plane the pieces will be cut by. Changes:

1. **Latch.** The first call with `t > 0` computes the rest-space plane once, `n_r = R^T n`, `d_r = n . (p - c)` (c = the body's centre of mass, R = its frame) and stores it (`nrx, nry, nrz, drest`); `neckGoal` and the contact fold band (softbody.ts:2200-2207) use the latched plane. The same latched plane is what `planCut` / the children are built from, so prediction, pinch and pieces are one plane. A call with `null` releases it.
2. **Depth.** `depth` in [0, 1] scales the pinch: `waist = 1 - depth (1 - NECK_WAIST)` (depth 1 = today's 0.3, depth 0.35 = a 0.755 groove), the Gaussian width and the swell solve are unchanged. The shell's per-family table is its own (CUT2_SHELL 5.2); what PHYS owes is the measurement of the swap, below.
3. **Where the pinch is.** The pinch is a Gaussian about the plane, the two lobes keep their rounded faces, and the swap replaces them with flat-faced halves placed on the plane. I measured the distance between the necked parent's surface and the new pieces' surfaces at the swap (the shell's N10 Chamfer, both directions, p95 and max, in R0): measured on 12 species, one per family (E5, `e5_neck.mjs`): the shipped `setNeck` with the shell's timing (smoothstep over NECK_S, 5 frames held at t = 1), the waist parameter swept (waist = 1 - depth (1 - 0.3)), then the two TRUE halves of the vertical rest plane through the centre placed in the necked body's frame. Chamfer = half the sum of the mean surface distances in both directions, in R0; "visible faces" leaves out the two halves' cap triangles (those lie inside the necked body until the swap, nothing shows them), so the cap's 25 % of the area does not count as a pop:

| waist (SHELL depth) | Chamfer, all faces: median / worst (species <= 0.08) | Chamfer, visible faces only: median / worst (species <= 0.08) |
|---|---|---|
| 0.30 (1.00, today) | 0.147 / 0.249 kneadle (0 of 12) | 0.137 / 0.256 kneadle (0 of 12) |
| 0.50 (0.71) | 0.118 / 0.193 kneadle (0 of 12) | 0.109 / 0.195 kneadle (0 of 12) |
| 0.65 (0.50) | 0.098 / 0.134 kneadle (4 of 12) | 0.085 / 0.128 kneadle (4 of 12) |
| 0.755 (0.35) | 0.083 / 0.113 capnap (5 of 12) | 0.065 / 0.098 capnap (10 of 12) |
| 0.90 (0.14) | 0.060 / 0.087 capnap (9 of 12) | 0.032 / 0.061 capnap (12 of 12) |

So the swap continuity of the shell's N10 depends on the neck depth much more than on anything the builder does: at today's waist 0.3 the pop is 0.11 to 0.17 R0 on every family (median 0.147; putty 0.25: the known neck swell); at a uniform depth of 0.35, 10 of 12 families pass N10 on the visible faces (capnap 0.098 and kneadle 0.087 fail). With the shell's per-family table (0.35 for gel, gummy, water, silicone, pop dome and beads; 0.5 for slow-rise and marshmallow; 0.6 for putty and mochi) the first group passes (gel 0.072, gummy 0.063, water 0.051, silicone 0.071, pop dome 0.065, beads 0.075), marshmallow passes (0.072 at 0.5), mochi is borderline (about 0.08 at 0.6, interpolated between the measured waists 0.5 and 0.65), and slow-rise (0.112 at 0.5) and putty (about 0.15 at 0.6) fail; only a groove (depth <= 0.2) passes on all 12. Two recommendations: N10 should count the visible faces (the caps are born interior faces), and the depth table should be re-fitted with this table (slow-rise and putty need about 0.25 or less). The sticky and slime families (depth 0.9 in the shell's table, where the strand hides the swap) are 0.135 to 0.144 R0 at depth 1.0 and are judged by the render's luminance step instead. The pieces are the same in all rows: the pop comes from the necked goal (the Gaussian pinch plus the lobe swell), not from the pieces.

### 3.5 Why the old chunk launched, and the expected launch speed of the new build

Cause (section 1): the unbalanced goal. Second contributor: the particles are BUILT at the rounded rest `Q` and the goal and the edge rest lengths already follow `FLAT` (softbody.ts:2425-2431), so a flat face starts with a strain; face-down it pushes into the table. Both vanish when the rest shape is the final shape and every goal is centred. **Expected launch speed of the new build: zero** (any COM speed after the swap is the velocity the shell gave it, the free fall of a piece that starts above the table, or settling); how it is measured: section 9, row L1 (the SHELL's swap flow on the true pieces: born flush with no velocity, scripted parting, `collide` every frame, 4 s; the centre read from positions; 50 species x 6 planes x both pieces). Measured: the SHELL's swap flow on the true pieces (`e1s2_swapflow.mjs`, final prototype: closest-point contact, 1 mm caps, 1 s skin ramp, shove scaled and vertical, adaptive foot that leaves cap vertices alone, the half-space limit, the corner rules), **50 species x 6 planes** (vertical through the centre, level through the centre, vertical at 0.5 R0, tilted 50 degrees at 0.2 R0, level at 0.3 R0, tilted 25 degrees at 0.1 R0) = 293 cuts (7 skipped: a side under 1/8) = 586 pieces, 4 s each, born flush with no velocity, the scripted parting, the upper half of a level cut dropped 5 cm, `collide` every frame, the centre read from positions:

| row (threshold fixed before the run) | result |
|---|---|
| **launch**: rise above the birth position <= 0.06 m and upward speed <= 1.0 m/s | **0 of 293 cuts fail**; rise median 0, p95 1 mm, max 17 mm; upward speed median 0.26, p95 0.47, max 0.69 m/s |
| speed: supported pieces <= 1.2 m/s from 0.1 s and <= 0.3 m/s from 1 s | 4 cuts fail (three level cuts at +0.3 R0, petalop and ambrosel among them, and one vertical slice of plumpet at 0.32 m/s); from 0.1 s median 0.58, p95 0.79, max 2.02 m/s (a tail cut free 0.39 m above the table: its free fall); from 1 s median 0.09, p95 0.23, max 0.44 m/s |
| settled: speed over the last 0.5 s <= 0.05 m/s | 3 cuts fail (the 25-degree faces of knubby and marigel at 0.054 to 0.070 m/s, a slice of puddlo); median 0.0014, p95 0.043 |
| displacement from flush + parting <= 0.10 m on vertical and level planes | 24 cuts fail: 15 of the 44 vertical cuts at 0.5 R0 (the small slice, 0.17 m at the 90th percentile, tips over and rolls instead of standing on its edge), 8 of the 49 level cuts at +0.3 R0 (the small upper cap ends 0.10 to 0.14 m from where it landed), 1 centre level cut |
| nothing below the table (-2 mm), no safety reset | 0 and 0 |
| penetration <= 0.15 R | 1 cut fails (caromel 25-degree face, 0.18 and 0.21 R) |
| fold excess over the hinge's rest <= 75 degrees | 8 cuts fail (6 of them the vertical cut at 0.5 R0); peak excess median 13, p95 40, max 106 degrees |
| **every row** | **256 of 293 cuts (87 %)** |

By plane: vertical through the centre 50 of 50, level through the centre 49 of 50, vertical at 0.5 R0 23 of 44, tilted 50 degrees 49 of 50, level at 0.3 R0 39 of 49, tilted 25 degrees 46 of 50. The built pieces: rest volume against `frac V3` within 1.0e-12, mass-weighted mean of the rest shape 2.6e-16 R0, particle masses 0.019 to 7.35 (mean 1), 206 of the 586 pieces needed a foot patch, 0 build errors. For the same cuts with the SHIPPED `collide` (8 species, 46 cuts, final builder) 17 pass every row and 12 launch (section 4). With a flat foot patch that includes the cap vertices (an earlier version) the thin slices of the vertical cut at 0.5 R0 stood on their rim and creased instead: 19 fold failures (against 6) and 0 displacement failures on that cut (against 15); the choice between "creased on its rim" and "tipped over" is owner question 3.

## 4. Mass, centre of mass, inertia, placement, velocity, resting

* **Mass.** A particle's mass is its tributary area, mean 1 per body (shape.ts:204-216), so every body has `Mtot = n` whatever its size and the loop never needs a body mass: gravity, the shape matching, the damping and the self-righting torque are mass-free. Body mass matters in exactly one place, `collide`, which splits every contact push and every velocity change half-half between two bodies (softbody.ts:1368-1380, 1397-1400): an eighth pushed against a half moves the half as far as the half moves it. A piece's physical mass is `frac`. I tried weighting every share by `wa = f_b / (f_a + f_b)` (`f` = `fracNow`, bit-identical for two equal bodies) on the SHELL-flow stress set: it calms the big piece next to a small one and throws the small one, 4 cuts of 11 passing against 5 of 11 without it, so the recommended design keeps half-half (see the contact paragraph below).
* **Centre of mass.** The solver's COM is the tributary-area surface centroid; the solid's COM differs by a few percent of R0 (a half ball: 0.333 R vs 0.375 R from the cap). The PIECE IS PLACED BY THE SAME DEFINITION on both sides: `offset` is the mass centroid of the built rest mesh in the whole's rest frame, so each particle is born at exactly the whole-frame position of the material it represents: `X_i = c_parent + R(frame) (restLocal_i + offset - offset_parent)`. That is "the centre of mass of the true part" in the only sense the sim has, and the pieces are flush: their cap planes coincide to 1e-9 R0 (the caps are the same plane, sampled from the same S), no gap, no overlap. The shell's `lobeCentres` (the mean of the particles on each side of the CURRENT deformed mesh) is not used: a body pinched into a peanut with swollen lobes (the neck goal) has lobe means that are not where the true halves' centres are, and its deformation at the swipe would be baked into the placement. (Measured for dollop, 5 planes x 2 pieces: the solid's centre of mass lies 0.022 to 0.045 R0 from the surface mass centroid the solver uses. The placement uses the second, so the pieces are flush to 1e-9 R0 whatever that offset is, and no one has to correct for the first.)
* **Inertia** is whatever the particle cloud has; nothing is stored. A true half ball has the cap's mass on a flat face, so a different inertia from a shrunken whole, and the self-righting torque (`kUp` 40, `cAng` 8, softbody.ts:2640) is an angular acceleration per radian, so it rights a light slab and a heavy half in the same time.
* **Velocities.** Momentum is conserved across the cut: each child gets the mean world velocity of the parent's particles on its side of the plane (`velA`, `velB` of `CutPlan`), O(n). The physics adds NO push: M2 of CUT2_SHELL shows a 0.22 m/s push never separated anything on the table, and the shell's open-loop parting script (CUT2_SHELL 5.5) does the opening. The constructor's `vel` stays (clamped like `nudge`).
* **Orientation.** `PieceOpts.frame` is the parent's best-fit rotation; the child's particles start rotated by it and its `qr` starts equal to it (the child's rest frame has the whole's axes, so this is the parent's pose). Without it a tilted parent pops at the swap by its tilt.
* **Resting on the table: which face is down.** The weeble (softbody.ts:2633-2641) rights the REST +y axis and nothing else, so a piece rests in its rest orientation: a vertical half stands on the old foot with its cap vertical (the half foot is a patch of coplanar particles), the top half of a level cut sits cap-down (the whole cap is the foot), a slice with neither gets the adaptive foot of 2.2 step 8 on its SKIN vertices (never on a cap vertex), so a thin slice cut off the side has nothing flat to stand on and tips onto its curved side (owner question 3). I considered a re-orientation (a rest rotation baked into `Q`, so a half lies on its cap) and rejected it: it needs a topple (a rotation of a soft body about its COM sweeps its corners 0.3 to 0.5 R0 into the table: each substep's projection of that penetration is a velocity of up to `pen / H`, the same family of launch), it breaks `x_piece = x_whole - offset`, and nothing is gained: the weeble of a whole already stands on its foot whatever the support polygon is (supported gravity, softbody.ts:2290). Measured (E2, 12 species, one per family, 3 poses, 4 s on the table, nothing else): every one of the 36 pieces is at rest: peak centre speed 0.000 m/s, last-second jitter 0.00 mm and 0.00 mm/s, lowest particle 0.00 mm, frame tilt 0.00 degrees. Particles on the table: cap down (the top half of a level cut) 125 to 259; standing on its old foot (a vertical half) 10 to 54 (capnap 10, chunkle and twangle 16); dome down (the half flipped, cap up) 11 to 105 (dollop 11, all others 19 or more). Before the adaptive foot, dollop's dome-down half had 4 particles on the table, sagged 27 mm and moved at 0.35 m/s while settling (the same experiment with the shipped foot rule, section 2.2 step 8).
* **Two pieces touching: `collide()` needs four changes, scoped to pairs that contain a true piece (found by running the SHELL's swap flow on the true pieces; this is the one place where the true cut does NOT work with the shipped solver).** The SHELL (CUT2_SHELL 5.2.1, 5.5) bears the pieces FLUSH, lets the upper half of a level cut drop 5 cm onto the lower one ("stacked flat faces resist sliding") and cuts the pieces again one at a time. Today's `collide` (softbody.ts:1331-1414) does not survive that, for four separate reasons, each measured:
  1. **The distance and the push direction come from the nearest VERTEX's normal** (1366-1368). On two touching surfaces whose vertices do not match (every flush pair of different detail, every rim) the nearest vertex of the other body is beside the particle, not under it, and `d = (p - q) . n_q` invents a penetration of the size of the vertex spacing times the sine of the rim angle. Measured on tadpolo's 14 % tail and twangle's second cut: 42 to 75 of the 162 to 642 particles are "in contact" at frame 1 with the pieces exactly flush, the whole-body shove is 15 to 50 mm per frame, centre speeds reach 1 to 2.5 m/s within 0.2 s and a 5-piece pile ends interpenetrating by 0.5 R. **Change (a): use the closest point on the other body's surface** (the triangles around the nearest vertex, Ericson 5.1.5; ~40 lines, the vertex-to-triangle list is built once per body): `d` is the distance to that point, signed by the triangle normal (outside if the vertex normal agrees, for a point beyond a convex edge), the push direction is `(p - c) / |p - c|`. Touching surfaces then have `d = 0`, not a manufactured penetration.
  2. **The pushes are not bounded.** A particle is moved by `0.5 (skin - d)` per frame, and each body is shoved as a whole by the mean push of its contacts (`CONTACT_RIGID`, 1395-1400): in a pile of 5 or 6 bodies a body feels 20 to 50 mm of correction per frame from several neighbours and gains energy. **Change (b): each particle push and each whole-body shove is at most 1 mm per frame** (the separation speed is then at most 0.06 m/s per contact, which is what the parting script needs and no more).
  3. **A flush pair starts inside its own contact skin.** The skin is `0.25 (meanEdgeA + meanEdgeB)`: 32 to 44 mm at detail 3, about twice that when one piece is at detail 2. **Change (c): the skin of two pieces born in the same step eases in, `skin *= smoothstep(age / 1.0 s)`** (identified by equal `simTime`). In my first variant (without (a), (b) and (d)) a ramp of 0.5 s launched a child above 0.3 m in 2 of 4 nested sequences, no ramp in 2 of 4, 1.0 s in 0 of 4; the parting script (G 0.06 to 0.16 m over 0.30 to 0.45 s) has separated the pair by the time the skin arrives.
  4. **One contact shoves a whole body sideways.** With few contacts (the rim of two flush faces) the mean push of ONE contact moved the whole piece by up to 31 mm along an almost horizontal normal; on the dollop level cut (upper 23 % at detail 2 on the lower 77 %) the upper piece left the lower one at 0.4 s, fell 0.55 m and landed 0.6 m away at about 2.7 m/s. **Change (d): the whole-body shove is scaled by `min(1, contacts / 12)` (twelve or more contacts, every stack of whole bodies, unchanged) and is VERTICAL only when the mean contact normal is within 37 degrees of the vertical (`|m_y| > 0.8`)**: a stack is separated up and down, never sideways.
  All four apply only when at least one body of the pair has a cut face (`capFlat`, true for a body built with a region); a pair of whole bodies runs the shipped code and is bit-identical (row L8: two whole bodies, a drop of one onto the other, 7 s with `collide` every frame, all four contact changes switched ON in the patched copy: identical `stateHash` at 7 checkpoints for 5 of 5 species). The pieces must also be BORN consistently, which is the shell's side of the same fix: both children get the SAME lift (the constructor lifts a piece whose lowest particle would be below the table BY ITSELF: 3 to 55 mm of difference between siblings produced 22 to 48 overlapping particles at birth) and the parent's best-fit rotation (`PieceOpts.frame`; a toppled parent had 92 degrees and its children, born upright, started 0.5 R inside their neighbours): with a region the constructor must not lift, and `placeAt` takes exact positions.
  Measured: (1) the SHELL's flow with the final builder, 8 species (dollop, chunkle, puddlo, tadpolo, kneadle, wisplet, boingle, crumbit) x 6 planes = 46 cuts, every row of L1 for both pieces:

  | `collide` | cuts passing every row | launch | speed | not settled | displacement | penetration | fold |
  |---|---|---|---|---|---|---|---|
  | shipped | 17 / 46 | 12 | 25 | 6 | 13 | 4 | 11 |
  | (a) + (b) + (c) | 34 / 46 | 0 | 1 | 8 | 4 | 0 | 2 |
  | (a) + (b) + (c) + (d) (**recommended**) | **40 / 46** | 0 | 1 | 1 | 3 | 0 | 2 |

  (an intermediate variant of mine, pairwise vertex normal + shove scaling + vertical shove + 0.5 s ramp, with the earlier builder, passed 35 of 46; the row "shipped" of the earlier builder was 18 of 46)

  (2) nested cuts the SHELL's way (one cut at a time, parting after each, 2.5 s of settling, up to five cuts = six pieces, children born in the parent's pose with a common lift, `collide` among all bodies; 12 species x 3 random trials = 36 sequences, `e3s_sequential.mjs`): with the shipped `collide` **23 of the 36 sequences launch a child above 0.3 m** (worst rise 1.5 m, worst upward speed 4.65 m/s); with my first variant (before the closest-point contact and the caps) 11 of 36 did (worst 1.7 m, a pile ending 0.5 R interpenetrated); with (a) + (b) + (c) + (d) **0 of 36** (worst child rise 20 mm, worst upward speed 0.70 m/s, peak fold excess 110 degrees, no safety reset, no interpenetration; four of the sequences run twice give identical `stateHash`es). (With (a) + (b) + (c) alone, built from the previous builder, also 0 of 36, worst 75 mm.)
  What is left after (a)-(d) is physics or a separate defect, listed in section 10.2: a piece on a SLOPED cut face slides down it (the contact has viscous damping of the relative velocity, no static friction), a thin tail that is cut free in the air falls and crumples on landing, and the putty and sticky halves of a level cut end 12 to 17 cm from where they landed.
* **Stacked flat faces rest 39 to 55 mm apart, and the COM readout of a stacked pair shows +-0.16 m/s that is not motion.** With the contact skin of 32 to 44 mm, two true halves stacked on their cut faces settle with a gap of 39 mm (dollop) and 55 mm (chunkle) whatever the gap they started with (0, 20, 50, 80 mm), against 31 to 33 mm for two whole bodies stacked (`e13`, `e13c`): the shell's join must treat `gap <= 0.07 R0` as touching, and nothing in the physics hides it. The same stack reads a body COM velocity of +-0.15 to 0.17 m/s with a position jitter of 0.0 to 0.6 mm, for two WHOLE bodies as well (157 to 171 mm/s): `collide` moves positions after the solve and the velocity is read from the difference, so a speed gate on a stacked pair must read positions (row L1 does) or be set above 0.2 m/s.
* **Lean at the cut (optional, not recommended as default).** Because the swipe plane contains the camera, a fresh face is seen edge-on (CUT2_RENDER 6.4). A physical alternative to RENDER's camera peek is an initial outward tilt of each half of 10 to 15 degrees about the horizontal axis in the plane (the weeble rights it in ~0.5 s with a wobble): `PieceOpts.frame` already carries it. Not measured; RENDER's peek is cheaper and reversible.

## 5. Merging: any two pieces, always valid, always exactly whole at the end

### 5.1 Today (verified)

`startJoin` picks the receiver (the face piece, else the larger), calls `recv.setFrac(recv.frac + giver.frac, JOIN_S)` and `giver.setFrac(PIECE_MIN, JOIN_S)`, makes the giver a ghost and flows it into the receiver with `moveTo` (cut.ts:443-454, 413-441); `joined` removes the giver and adds the fractions (362-377); when one piece is left `whole()` swaps in `createBody(genome)` (381-408). `setFrac` eases `fracNow` with a smoothstep and `frameUpdate` scales the goal and the volume target by `cbrt(fracNow / fracBuilt)` (softbody.ts:1313-1319, 2368-2371, 2380-2381): it grows or shrinks the SAME shape. That was right for "a shrunken whole" and is wrong for true parts (a half cannot grow into a whole by getting bigger).

### 5.2 The rule (the three lenses agree on it; PHYS's part)

1. **Fits** (CUT2_SHELL 5.4 case 1): two pieces whose regions touch across a cut face with positive area and whose union is sound are replaced by the UNION OF THEIR CELLS, with the siblings collapsed back into their node by the shell's tree (so the sibling join is literally the parent's cell list). PHYS builds the union exactly like any region: the ray stack merges the cells' intervals, so a face shared by the two cells is not a boundary (no vertex ends on it). `joinable(a, b)` = the shared-face test + `phi(best centre) >= 0.95` of the union.
2. **Does not fit** (case 2): the shell takes the lowest common ancestor node N of every leaf of the two pieces and joins every piece under it. N is ONE convex cell, S intersected with a chain of half-spaces. **PHYS makes this always buildable** by one obligation at CUT time: `planCut` validates the soundness of every cell the cut creates AND of both children, and refuses the cut (`sound = false`, the shell's `loose` line) if any is unsound. Then every node of the tree is a body that existed or could exist, so the LCA group is always a valid body, and the last join is the root: a fresh `createBody(genome)`.
3. **Exact whole.** The root is detected by the shell (`isWhole`); the swap is the existing `swapWhole` (cut.ts:398-408): a body built without `piece`, i.e. the original constructor path and the original genome, bit-for-bit. PHYS adds the morph that makes the last animation arrive: the receiver's `setRegion(root, JOIN_ALL_S)` targets `buildRest(genome, mesh_d)` scaled to the volume (not a re-meshed S: the root region is special-cased so the end state is the original rest shape at that detail; the existing X04 bar is RMS < 0.002 R0).

Measured soundness of the algebra (random cut trees on all species, 6 pieces, every pair joined): `sweep5.mjs`, 100 random cut trees (2 per species, all 50 species), each up to six pieces (cuts chosen at random through the largest or a random piece, 60 % near-horizontal normals): 460 accepted cuts, 560 pieces; every new cell and both children of every accepted cut passed the soundness test (0 loose-crumb refusals; 2 051 attempted cuts were refused only because a side was under 1/8); all 560 pieces built (0 errors, 0 flipped tetrahedra, 6 wrong-facing triangles, the rim snap reverted on 1 piece after the corner rules of 2.2 step 6; 441 before them). Joins, all 1 302 piece pairs of the 100 trees: 195 are sibling nodes (the union collapses to the node's own cell list: bit-identical, M1), 632 have a sound union of cells (at least 0.97 of its volume visible from the best centre; the sweep used 0.97 for a union and 0.94 for a cell or a child, the engineer's single bar of 0.95 lies between them), 475 do not and fall to the lowest-common-ancestor group; the group of such a pair is the WHOLE squishy for 377 of the 475 (79 %), is always a sound region (smallest visible share 0.996), and reconnecting all the pieces in a random order ends at the root in 100 of 100 trees (the last join is `createBody(genome)`). The cheap "touching" test of the sweep passed all 1 302 pairs, so it is only a necessary condition: the real shared-face test (positive area) is the engineer's `joinable`, and its pass rate is what decides how often a join escalates (R11 in 10.2)

### 5.3 `setRegion(region, seconds)`: the receiver's morph, then the commit

The receiver's goal eases from its rest shape `Q` to the target `QT` (the merged piece's rest mesh, built at the SAME icosphere detail so the topology matches vertex by vertex) and its volume target from `V_Q` to `V_T`. In `frameUpdate`, before `GB` is composed, with `e` the smoothstep of the elapsed fraction:

```
QM_i = Q_i + e (QT_i - Q_i)                   // both are centred on their own mass centroid: re-centre QM with THIS body's M (rule 1 of 3.2)
V*   = V_Q + e (V_T - V_Q)                    // the volume target: volScale = V* / restVolume
k    = cbrt(V* / meshVolume(QM));  GB_i = k QM_i   // the goal's own volume equals the constraint's (a blend of two shapes is not their blend of volumes)
```
**The rotation is extracted against the goal being morphed (found by measurement; without it the morph does not work).** The shape matching builds `A = sum m p q^T` against the REST shape `Q` (softbody.ts:1941-1955). During a morph the particles chase `QM`, not `Q`, and for a half becoming a whole (or two quarters becoming a half) `A` against the old `Q` is a biased matrix: the best-fit rotation drifts, the goals `c + R QG` are rotated wrongly and the body wobbles for seconds. The one-line fix is `q = morphOn ? QG : Q` in that loop (the memory arm keeps `Q`: its goal differs from `Q` by a bounded amount). Measured on dollop and chunkle (E4): with `A` against `Q` the receivers were still moving at 108 to 241 mm/s one second after the morph and a swap to a fresh body differed from the morphed one by up to 1.8 R0; with `A` against `QG`: 1.4 to 9.3 mm/s, differences 0.004 to 0.10 R0.

`meshVolume(QM)` is summed inline into a scratch cell (no double crosses a call, as `neckGoal` does at softbody.ts:2487-2492). The skin's rest lengths follow the goal (they already do for every shaped goal, 2425-2437). At `e = 1` the body COMMITS in place: `adoptRest(rest)` re-runs the rest-dependent part of the constructor (arrays reallocated: `Q, restLocal, M, invM, Mtot, floppyW, softW, H0, foot, EL, EL0, ESOFT, HD, HD0, HP, HW, H3, HE3, HC, HCH, HSH, LQ, LQG, invH, MEM, QG, QGN, GB, QS, NRM, NN, TPH, S3, SL, SW, ns, volS0, volAlphaT, restVolume, restCenterY, restRadius, params.smOmega`; 40 ms is fine, it is an event), keeps `X, XP, V, GOAL, qr`, clears the morph and publishes a NEW immutable `PieceInfo` object (RENDER R7). Because the goal at `e = 1` equals the new `Q` the commit changes no position and no force: measured on 12 species x 3 joins = 36 morphs (E4, `e4_morph.mjs`; the receiver settles 1.5 s, `morphTo` runs 1.2 s, then 1 s more; rotation extracted against `QG`; peak centre speed during the morph, shape RMS of the receiver to the target rest shape in R0 at the end of the morph, volume of the receiver against the target, centre speed 1 s after the morph, and the position difference over the next second between the receiver and a FRESH body built from the target and handed the receiver's particle state, which is the swap fallback):

| join | n | peak speed (m/s) median / max | shape RMS to the target (R0) median / max | volume / target | speed 1 s later (mm/s) median / max | swap to a fresh body (R0) median / max |
|---|---|---|---|---|---|---|
| half -> whole (the last join) | 12 | 0.052 / 0.262 | 0.0062 / 0.0206 | 0.999 - 1.006 | 1.7 / 7.5 | 0.018 / 0.104 |
| quarter + quarter -> half (siblings) | 12 | 0.034 / 0.211 | 0.0070 / 0.0207 | 0.998 - 1.000 | 1.4 / 40.8 | 0.012 / 0.186 |
| half + quarter (a union of cells that is not a node) | 12 | 0.058 / 0.112 | 0.0055 / 0.0166 | 0.998 - 1.000 | 1.3 / 10.2 | 0.026 / 0.052 |
| all | 36 | 0.058 / 0.262 | 0.0069 / 0.0207 | 0.998 - 1.006 | 1.5 / 40.8 | 0.021 / 0.186 |

No safety reset, `goalDrift` after the call 1e-17 to 2e-16 R0, a fold only where the rest shape itself changes (the peak dihedral is the TARGET's rim, up to 120 degrees, so the "excess over the old rest" column of the raw table is not a fold). Everything arrives: the shape to 0.02 R0 (the RMS bar of the existing X04 is 0.002 R0 AFTER the commit to the fresh body, which is exact by construction), the volume within 0.6 %, the body at rest within 41 mm/s at worst (twangle's quarter pair; 30 of the 36 morphs under 4 mm/s), the swap to a fresh body would move the particles by 0.02 R0 at the median and 0.19 R0 at worst (boingle's quarter pair), which is the case for the in-place commit that RENDER prefers. The speed during the morph is bounded by the easing: the body moves less than 0.3 m/s at its fastest. (The alternative that needs no refactor of the constructor is a swap: build the merged body and copy `X, V, qr` from the receiver into it before its first step; RENDER prefers the in-place commit because the view keeps its id and clock, and I measured the swap as a fallback: see the last column of the same table.)

### 5.4 The data that is carried, and where it lives

| datum | owner | form |
|---|---|---|
| the cut table (planes in the whole's rest frame, with ids) | SHELL (`planes: RestPlane[]`) | PHYS never compares floats of different planes; it derives `n_r`, `d_r` itself in `planCut` |
| a piece's region | SHELL builds it from the tree; the BODY keeps the value it was built from | `PieceRegion { planes, cells }` (CUT2_SHELL 4): immutable, plain JSON, no class |
| the built rest mesh, `offset`, `rayOrigin` | PHYS, cached by (species, size, region key, detail) | the key is a string of the cells' literals and the planes' 17-digit floats: identical inputs hit the same entry, so a re-merge returns the SAME arrays |
| `SoftBodyLike.piece` | PHYS, published for RENDER | `PieceInfo` (CUT2_RENDER 2.1): `whole`, `offset`, `rayOrigin`, `cells` as planes with OUTWARD normals |

## 6. measureCut consistency, determinism, zero allocation, perf

### 6.1 One plane, one clip: prediction = construction

Today `measureCut(plane)` clips the CURRENT deformed mesh `X` with the world plane (softbody.ts:1259-1293) while the pieces are built from a rest shape: they agree only if the body is undeformed. `planCut` replaces it for the shell (CUT2_SHELL 4; `measureCut` stays, implemented on the same routine, for the existing probes). Algorithm, in this body's REST frame:

1. Pull the plane back: `n_r = R^T n`, `d_r = n . (p - c)` (R = the best-fit frame `qr`, c = the centre of mass). The body's rest mesh `Q` has the whole's axes, so this is the whole-frame plane up to the translation: `n_w = n_r`, `d_w = d_r + n_r . offset`. (The same latched plane drives the neck, 3.4.)
2. Clip `Q` by it (Sutherland-Hodgman per triangle, tetrahedra from a point on the plane): the exact share `fa` of THIS body's volume on side A, its centroid and its second moments (for `aspectA/B`: `sqrt(lambda_min / lambda_max)` of the covariance). `mode = 'median'`: bisection on `d_r` between the extremes of `Q` along `n_r` (40 steps of a 1280-triangle clip = 3 ms) until `fa = 0.5` to 1e-5.
3. `cellFa[k]`: the share of each cell of this body's region on side A, from the cell's true region by the radial-interval integral (500 directions per cell). It is only a classifier (< 0.01: wholly B; > 0.99: wholly A; else the plane splits the cell, and the shell makes two child nodes); the children's volumes come from step 2.
4. `sound`: for each child and each NEW cell, `phi(best centre) >= 0.95` (2.2 step 3). A cut that fails is reported `sound = false`.
5. `velA/velB`: mass-weighted mean world velocity of the particles on each side of the WORLD plane (O(n)). `offA/offB`: the children's rest origins in this body's rest-local frame: exact (`offset_child - offset_this`) once the children are built (cached, see `prepareCut`), the clipped volume centroids otherwise (`built = false`, error <= 0.04 R0).

Then `fA = p.frac x fa` and the child built with that `frac` has `restVolume` exactly `fA x V3` (2.2 step 9): the prediction equals the construction to 1e-12, and the GEOMETRY follows the plane to the independent bar of row G1. Where the clip is of the REST mesh, a body that is deformed at the swipe predicts what it will be built as, not what it looks like: the difference, pressed or wobbling, is measured (E9, 8 species, vertical plane at 0, 0.2 and 0.4 R0 from the centre): the shipped `measureCut` (the CURRENT deformed mesh, the world plane) against the rest-frame clip (the rest mesh and the plane pulled back through the body's frame, what `planCut` does), as a share of the whole. Settled: identical to 0.0 % on all 24 plane/species pairs. 0.15 s after a nudge (compression 0.01 to 0.05): 0.0 to 0.6 %. Pressed by a finger for 0.6 s (compression 0.08 to 0.43): -2.3 % to -0.6 % at the centre (median -1.0 %), up to +2.0 % at 0.2 R0 and +3.9 % at 0.4 R0 (twangle, compression 0.31; dollop +3.3 % at compression 0.43). So the live clip cannot be the prediction for a body that is being pressed, and the 0.5 % bar of the old consistency row is met only for a settled body; `planCut` clips the REST mesh, equals what is built to 1e-12 (the built `restVolume / (frac V3) - 1` is at most 1.0e-12 on all 586 pieces of the final swap-flow run, 14 secant steps), and differs from what is on screen by exactly the table above, which is the price of "prediction = construction" and the reason the shell refreshes the plan at t = 1.

### 6.2 Determinism

The builder is a pure function of (genome, region, detail): fixed direction tables, fixed iteration counts (4, 12, 4, 6), no `Math.random`, no `Date`, no `Map` iteration order in the arithmetic (the cell lists are sorted by literal), no data-dependent early exit except the validity gate, which is itself deterministic. `Math.cbrt`/`sqrt`/`acos` are the engine's (as everywhere in the solver). A region key (cell literals + the planes' floats) addresses the cache, so two requests for one region return the same arrays. Probe L4 runs a scripted session twice and compares `stateHash` of every piece at 6 checkpoints.

### 6.3 Zero allocation per step

No new code runs per step except: `centreGB` (loops over typed arrays), the morph blend (scratch `NSCR`, inline volume sum), the per-hinge fold arrays (read-only). Building, `adoptRest`, `planCut`, `joinable` allocate; they are events (a cut, a join), never in `step()`. The existing allocation rows of probe_softbody / probe_cut (bytes per frame after JIT) must keep passing; add a row "zero bytes per step while a morph runs".

### 6.4 Perf with 6 pieces, and the build itself

Measured (E6, `e6_perf.mjs`, probe_cut X08's method: interleaved batches of 60 frames, 8 batches, `collide` every frame, `warmUp` first; dollop and kneadle; six pieces of 0.13 to 0.26 from a random cut tree against two whole bodies of 1 284 particles; the machine was shared with other agents, so the medians are noisy and the best batches are the instrument):

| set | particles | dollop best / median ratio to 2 wholes | kneadle best / median |
|---|---|---|---|
| 2 whole bodies | 1 284 | 5.96 ms/frame (median 11.0) | 5.58 ms/frame (median 12.6) |
| 6 pieces, detail 2 under 0.35 (CUT.md, recommended) | 972 | **0.78** / 0.85 | **1.10** / 0.84 |
| 6 pieces, detail 3 from 0.2 | 1 452 | 1.44 / 2.24 | 1.14 / 1.85 |
| 6 pieces, detail 3 for all | 3 852 | 4.38 / 4.24 | 4.17 / 3.98 |

The recommended policy meets "6 pieces <= 2 whole bodies" on the best batches for dollop (0.78) and within the noise for kneadle (1.10 best, 0.84 median); the two richer policies do not. The struts are the other cost (dollop: 0 at detail 2, 40 at 'detail 3 from 0.2', 117 at detail 3 for all). Per-step work added by this design: none for a whole body, `centreGB` (6n flops) while a neck or morph runs, one boolean per contact pair.

Budget rule for the sim mesh detail: CUT.md 4.3's `frac < 0.35 -> detail 2` stays (E6 above: the richer policies cost 1.14 to 4.4 times two whole bodies), the shell's limit of 6 pieces (4 on low) stays the guard. A merged piece keeps its RECEIVER's detail (a half made of two quarters stays at 162 particles until the last join, which swaps in the fresh detail-3 body; E4 measured exactly this case); re-meshing to a higher detail during a join needs a particle resample and is not designed.

The build cost, measured on the prototype (plain JS, allocation-heavy, on a machine shared with other agents): 5 000 rays and 130 000 to 190 000 ray-triangle tests per detail-3 piece (26 to 37 per ray against 5 120 for brute force: the 14^3 grid walk, `grid_stats`), the final sweep (2 213 builds, a quieter machine) median 15 ms and p95 76 ms per detail-3 piece, median 4 ms and p95 20 ms at detail 2 (the sweep run on a loaded machine: 37 / 202 and 7 / 49 ms); warm best of five 20 to 73 ms for a half (dollop, spirelo, marigel, chunkle); the six-piece builds of E6 (union regions, dense centre) median 43 ms (dollop) and 179 ms (kneadle), max 412 ms. **The median pair fits the neck, the tail does not**: the shell has 15 to 24 frames of neck (NECK_S 0.25 to 0.4 s) and `prepareCut` may take about 3 ms of each, i.e. 45 to 70 ms for BOTH children, against 30 to 150 ms measured for two pieces (15 ms median and 76 ms p95 each in the quietest run, 20 to 73 ms warm for a half). The port must therefore be up to 3 times faster at the tail than the prototype (typed scratch arrays, the grid built once per species and cached beside `WHOLE_VOL`, no per-ray allocation, the relaxation passes fused; I did not profile for this) or the neck must run longer than 0.4 s, or the children of a plane are built from the LIKELY plane during the swipe. The design keeps the interface that makes any of them possible: `prepareCut(budgetMs)` runs the build as a resumable sequence of stages (seed, 4 relaxations, snap, cap, skin, foot, volume, normalise, weights; stage sizes are a target, not a measurement) and returns true when both children are cached; the constructor takes the cache; a cold first build (JIT) is paid by `prewarm()`.

---

## 7. Contract additions (all optional and additive; conform to CUT2_SHELL section 4 and CUT2_RENDER section 2.1; PHYS-specific additions marked NEW)

```ts
/* CUT2 (true cut), physics members */
export interface PieceOpts {
  /* existing: frac, chunk, cutNormal, at, vel.  With `region`, `chunk` and `cutNormal` are ignored. */
  region?: PieceRegion;                    // SHELL 4. Absent = the old build (a whole at `at`, or a legacy chunk).
  frame?: { x: number; y: number; z: number; w: number };   // SHELL 4. The parent's best-fit rotation: the child is born in the parent's pose (its particles rotated about `at`'s parent centre, `qr` set). MEASURED NEED: a toppled parent (92 degrees) otherwise gives children that start 0.5 R inside their neighbours.
  /* PHYS: with `region`, `at` is EXACT (no lift by the constructor): the shell gives both children the same lift (placeAt), because a per-piece lift of 3 to 55 mm between siblings overlaps them by 22 to 48 particles at birth. A body built without `region` keeps the legacy 'never below its resting height'. */
}
export interface CutPlan {                 // SHELL 4, with two PHYS fields
  /* rest, fa, cellFa, cellN, offA, offB, velA, velB, aspectA, aspectB as in CUT2_SHELL 4 */
  sound: boolean;                          // NEW: false = a new cell or a child is not one body (the cut would leave loose crumbs): the shell refuses with its own line
  built: boolean;                          // NEW: offA/offB are exact (the children are cached); false = estimated from the clipped volume centroids (<= 0.04 R0)
}
export interface SoftBodyLike {
  /* SHELL/RENDER: piece?, planCut?, setRegion?, placeAt?, joinable?, setNeck depth */
  prepareCut?(budgetMs: number): boolean; // NEW: after a successful planCut: builds the two children in time slices (call once per neck frame, 3 ms); true when both are cached
  /** NEW (optional): the contact skin, m (`0.25 (meanEdge + other.meanEdge)` is the pair's), so the shell can size a gap or a join test; absent on an old body. */
  readonly meanEdge?: number;
}
```
`FRAC_MIN` (softbody.ts:202) drops to 0.124 (CUT2_SHELL 5.2 step 3: the exact halving of a 1/4 piece is 0.125 +- 2.5e-6). `PieceInfo.cells` is derived from the region (a literal `+id` is the outward plane `{ n: -n_k, d: -d_k, id }`). `SoftBodyLike.frac` is the body's own measured share (`restVolume / V3`).

Not added: no `PieceOpts.mode`, no per-family rim parameter, no fused/lump region (the owner question of CUT2_SHELL, option B, is not needed).

---

## 8. Exactly what changes where (src/physics only; contract and other lanes listed in 7)

| file | function / place | change |
|---|---|---|
| NEW `src/physics/piece.ts` | `wholeSource(genome)`, `rayIntervals`, `regionStats`, `soundness`, `buildPiece(genome, region, detail, frac)` (2.2), `clipMesh(Q, plane)` (planCut), `PieceBuilder` (resumable stages), cache | ~600 lines, pure, no allocation outside builds |
| NEW `src/physics/region.ts` | `regionKey`, cells to planes (outward), `joinable` | ~150 lines |
| `softbody.ts` ctor (524-537, 579-784) | `pieceRest` is called only for a body without a region; with `opts.piece.region` the constructor takes the built `RestShape` and `PieceInfo`; the rest-dependent block moves into a private `initRest(rest, mesh)` (also used by `adoptRest`); `FRAC_MIN` 0.124; `frame` rotates the initial particles and sets `qr` | the FLAT block (702-710), `roundTau`, `flatK` remain for the legacy chunk path only, and are deleted when the shell no longer builds chunks |
| `softbody.ts` `frameUpdate` (2357-2439) | `centreGB()` after the neck and in a morph (2399); morph blend before the GB loop; `shaped` includes the morph; the shape-matching `A` against `QG` while a morph runs (1941-1955) | 3.2, 5.3 |
| `softbody.ts` `foldLimit` (1677-1785) + ctor | per-hinge `HC/HCH/HSH` | 3.3 |
| `softbody.ts` `setNeck` / `neckGoal` (1299-1309, 2446-2537) / contact band (2200-2207) | latch the rest plane; `depth` | 3.4 |
| `softbody.ts` `measureCut` (1259-1293) | rest-frame clip (shared routine); `planCut`, `prepareCut`, `joinable`, `setRegion`, `placeAt` added | 6.1 |
| `softbody.ts` `collide` (1331-1414) + `ensureContactData` | the four scoped contact changes of section 4: closest-point-on-triangle distance and direction for pairs with a piece (a per-body vertex-to-triangle list, built once; ~60 lines), push cap 1 mm per particle and per body per frame, skin ramp `smoothstep(age / 1 s)` for a pair born in one step, shove scaled by `min(1, contacts / 12)` and vertical for a flat patch (`|m_y| > 0.8`); a field `capFlat` set when the body is built with a region; whole-body pairs untouched | 4, L8 |
| `softbody.ts` ctor placement (780-795) | with a region the constructor does not lift (`placeAt` gives both children one lift); `frame` rotates the particles about the parent's centre | 4 |
| `piece.ts` (builder) | the half-space clamp inside the secant volume loop; the adaptive 7-particle foot | 2.2 steps 8, 9 |
| `shape.ts` | `buildChunkRest`, `flatPoints` deleted after the shell stops using them; `restPoint`, `floppyOf`, `strutWeight` unchanged | |
| `params.ts` | nothing | |
| `_harness/probe_cut.ts`, new `_harness/probe_truecut.ts` | rows of section 9 | CUT2_SHELL 7.2 lists the old rows to re-specify |

## 9. Test plan (probe rows; each has an INDEPENDENT measurement, a threshold stated before measuring, and the prototype's result where I could run it)

"Independent" means measured by something other than the builder: the voxel/ray-parity point-in-mesh test of probe_cut.ts (`inside`, `voxelFrac`, `depthInside`), the ORIGINAL detail-3 whole mesh (not S, the builder's source), the physics' own `positions`, the divergence-theorem volume of the live mesh, a stepped sim clock. New file `_harness/probe_truecut.ts` (plain node, deterministic, same table format as probe_cut.ts); rows for ALL 50 species unless said.

Verdicts of the prototype against the bars written below (details in each row; "not met" is reported, not hidden):

| row | verdict |
|---|---|
| G1 | NOT all met: IoU >= 0.95 on 59 of 78 cuts, >= 0.93 on 69, 2 cuts under 0.90 (horned species); overlap 0.00 %; restated bar proposed |
| G2 | met at detail 3 (cap area p5 0.906, planarity 4e-16 R0); NOT met at detail 2 (p5 0.803) |
| G3 | not measured as specified (the engineer writes it against the detail-3 mesh) |
| G4 | no flips and no zero areas; the min-angle bar of 3 degrees on every region and the mass bar [0.03, 6] are NOT met (p0 0.2 degrees; masses 0.019 to 7.35); 90 % of regions >= 10 degrees is met |
| G5 | p95 met at detail 3 (0.059 R0); worst NOT met (0.302, skeinara's horn); detail 2 NOT met (p95 0.128) |
| G6 | 27 of 1 194 half-eyes (2.3 %) over the bar; centre cuts give one eye per half by construction |
| G7 | IoU median 0.957, min 0.864; skin p95 0.177 R0 NOT met (small nested pieces at detail 2) |
| L1 | launch: 0 of 293 cuts; every row: 256 of 293 (87 %); the thin-slice displacement and sloped-face rows fail as listed |
| L2 | met: 36 of 36 poses at rest |
| L3 | met on the seven affected pieces (rim moves 1 to 10 degrees, at rest within 1 mm/s) |
| L4 | met (identical hashes) |
| L5 | the before-numbers are measured (the neck up to 0.18 R0, the old chunk up to 0.056 R0); after centring the drift is 1e-17 to 2e-16 R0 in the morph (M2) |
| L6 | met: identical at all 33 checkpoints with the fold limit alone; first difference at the first setNeck (by design) |
| L7 | met: 3.5 and 0.8 mm with the changes against 0.60 m and 0.46 m shipped |
| L8 | met: identical stateHash at 7 checkpoints on 5 of 5 species |
| L9 | met: 0 of 36 nested sequences launch a child, against 23 of 36 shipped |
| L10 | met: 0 of 114 pieces overlap their sibling |
| M1 | same region built twice: bit-identical; union rebuild of two siblings equal to 1.1e-16 R0, not bit-identical (the shell's sibling collapse makes the join exact) |
| M2 | the morph ends within 0.021 R0 (median 0.007); after the in-place commit the shape is the cached one exactly (by construction, not a timing measurement) |
| M3 | met on speed (0.262 m/s) and volume (0.6 %); fold-excess bar to be re-specified |
| M4 | met: 100 of 100 cut trees reconnect to the root |
| C1 | the 0.01 bar holds at the median, not at the maximum (2.77 % at R0/20); prediction = construction to 1e-12 |
| C2 | met: exactly the 3 known unsound regions |
| B1 | met on the best batches for dollop (0.78), within noise for kneadle (1.10 best, 0.84 median) |
| B2 | NOT met by the prototype (median 15 ms and p95 76 ms against 12 and 40 for the port) |
| B3 | not run (the designer edits no source) |

#### G1 (X01)

**What.** a centre cut and four more planes (level, vertical, tilted, off-centre 0.2 R, 0.5 R, both signs) give two TRUE parts

**Independent evidence.** for each piece placed in the whole's frame (`restLocal + offset`): voxel IoU (cells R0/20) against the ORIGINAL detail-3 whole mesh clipped by the plane (point-in-mesh by ray parity, then the half-space test), AND the pair: mutual overlap, uncovered share of the whole

**Threshold, fixed before measuring.** IoU >= 0.95 per piece (0.93 for a piece with a feature thinner than 0.4 rad), overlap <= 2 % of the smaller, uncovered <= 3 %, `restVolume / (frac V3) = 1 +- 1e-9`, fractions sum to 1 +- 1e-9

**Prototype result.**

`g1_voxel.mjs`, 16 species (12 + spirelo, marigel, selenuff, munchip) x 5 planes (centre vertical, centre level, vertical at 0.5 R0, tilted 0.2 R0, z at -0.2 R0) = 78 cuts, voxel cells R0/20, point-in-mesh by ray parity against the ORIGINAL detail-3 whole, final builder: IoU of the worse piece median 0.963 (p10 0.924, min 0.847); mutual overlap 0.00 % on every cut (before the half-space clamp: 10 cuts, all tilted, 2.2 to 3.8 %); uncovered share of the whole median 0.91 %, max 5.49 %; piece material on the wrong side of the plane by more than 0.02 R0: max 0.00 %. **The bars I fixed before measuring are NOT all met**: IoU >= 0.95 holds for 59 of 78 cuts (19 below), >= 0.93 for 69 (9 below), and 2 cuts are under 0.90 (capnap level 0.847, marigel vertical at 0.5 R0 0.862: both species with big ears or horns, where a 642-vertex piece cannot follow a 0.14 rad feature); uncovered <= 3 % fails on 1 (capnap level, 5.5 %). Two things keep this from being worse than it reads: (1) the instrument: at R0/32 the same kind of cut (dollop, chunkle, twangle, 14 cuts) gives median 0.978 and min 0.909, so part of the shortfall at R0/20 is voxel boundary noise; (2) the reference: the original detail-3 mesh is itself 1.9 to 2.9 % smaller than the smooth body it samples (`t_src`: volume against the detail-5 clip -2.88 % median, worst -4.67 %), the pieces are cut from the finer detail-4 source and then given the exact detail-3 volume by the normal offset, so they differ from the visible whole's skin by the mesh's own sampling error (mean 0.0036 R0, p95 0.012, worst 0.076 R0 against the detail-5 skin, 0.0058 / 0.016 / 0.078 for a detail-3 source). I recommend restating G1 as IoU >= 0.90 at R0/20 (all but 2 rows) with the horned species listed as known exceptions, and checking the plane-side and cap rows (G2, L10) exactly instead of through voxels.

#### G2

**What.** the flat cut face is flat and whole

**Independent evidence.** cap vertices (those within 1e-6 R0 of the plane in the whole's frame, from `restLocal + offset`, NOT from the builder's classification)

**Threshold, fixed before measuring.** max distance to the plane <= 1e-9 R0; their triangles' area / the exact section area (the ORIGINAL mesh cut by the plane, polygon area) >= 0.90

**Prototype result.**

final sweep (2 210 sound detail-3 regions, 569 at detail 2): cap vertices lie on their plane to 4.2e-16 R0 (worst planarity, both details); the cap's area against the exact section area (the clipped source) median 0.958, p5 0.906, min 0.749 at detail 3 (bar 0.90: met at p5) and median 0.886, p5 0.803, min 0.700 at detail 2 (NOT met: a 162-vertex piece has a coarse rim, which cuts the corners of the section)

#### G3

**What.** the rim is an edge loop on the plane AND the silhouette

**Independent evidence.** distance of each rim vertex (on the plane, touching a triangle that is not entirely on it) to the nearest triangle of the ORIGINAL whole mesh

**Threshold, fixed before measuring.** <= 0.005 R0 (the original is a detail-3 polyhedron, the builder's S is detail 4)

**Prototype result.**

not measured as specified (distance of the rim loop to the ORIGINAL detail-3 mesh). What was measured: the rim snap applied to 2207 of 2210 sound detail-3 regions and to all 569 at detail 2 (3 reverted to the unsnapped radial mesh by the validity gate), the rim lies on the detail-4 source skin to 1e-7 R0 by construction, and the skin coverage row G5 (which includes the rim region) below. The row has to be written by the engineer against the detail-3 mesh

#### G4

**What.** mesh validity

**Independent evidence.** every tetrahedron (mass centroid, triangle) and (vertex mean, triangle) positive; no zero-area triangle; min angle; particle masses

**Threshold, fixed before measuring.** no inversion; min angle >= 3 degrees on every region, >= 10 degrees on 90 % of them (report the table); masses within [0.03, 6] of the mean

**Prototype result.**

final sweep, 2 210 sound detail-3 regions: flipped tetrahedra 0, wrong-facing triangles 6; smallest triangle angle p0 0.2, p1 3.7, p5 8.6, median 19.3 degrees (the bar "min angle >= 3 on every region" is NOT met: p0 0.2; 90 % of regions >= 10 degrees is met: 147 regions, 6.7 %, are under 10); 430 regions (19.5 %) have a triangle under 15 degrees; 114 regions (5.2 %) have a CAP triangle under 15; at detail 2 (569 regions) flips 0, p0 1.8, p5 7.4, median 15.5, 253 regions (44.5 %) under 15 and 19 (3.3 %) with a cap triangle under 15. Particle masses on the 586 pieces of the swap-flow run: min 0.019, max 7.35 (bar [0.03, 6]: NOT met; the extremes are sliver triangles on thin ears). The solver does not care (no flips, no zero areas, `safetyResets` 0 in all 586 pieces), but R3 of the render memo is only partly met (section 10.1)

#### G5

**What.** the skin is the skin

**Independent evidence.** one-sided Hausdorff from sampled points of the ORIGINAL skin on the kept side to the piece mesh

**Threshold, fixed before measuring.** p95 <= 0.08 R0, worst <= 0.25 R0 (a thin horn cut at its base excepted: list them)

**Prototype result.**

final sweep, detail 3, 2 210 regions: one-sided Hausdorff from sampled points of the source skin on the kept side to the piece mesh, max-of-samples per region median 0.024 R0, p95 0.059 (bar p95 <= 0.08: met), worst 0.302 (bar worst <= 0.25: NOT met; a thin horn cut near its base: skeinara 0.302); mean 0.0033 R0; at detail 2: median 0.066, p95 0.128, worst 0.452 (p95 bar NOT met)

#### G6 (X03')

**What.** a cut THROUGH an eye splits its footprint between the pieces; a centre cut between the eyes gives one eye per half

**Independent evidence.** the eye footprint computed from face.ts's formulas on the ORIGINAL rest mesh (jelly.ts RestMapper from the vertex mean), split by the plane; skin points of each side vs the piece that owns that side

**Threshold, fixed before measuring.** every footprint point of a side lies within 0.05 R0 of that side's piece; none within 0.01 R0 of the other piece's skin; the two eye centres lie on opposite pieces for a plane between them

**Prototype result.**

`e7_eye.mjs`: for each of the 50 species the eye footprint (the disc of the skin within the eye's radius, 0.13 to 0.14 R0) is split by 24 planes through and near each eye (both eyes, vertical and tilted), 1194 half-eyes: the distance from the footprint points of one side to that side's piece, in eye radii: median over the cases of the per-case p95 0.076, worst single miss 0.79 (skeinara), 27 cases (2.3 %) over 0.5 eye radii (0.065 R0; bar 0.05 R0 = 0.38 radii: NOT met on those). The misses are the rim loop: its vertex spacing (0.15 to 0.25 R0) is coarser than the eye (0.26 R0 across), so a cut through an eye leaves a rim polyline that follows the true half-disc to within 0.1 R0; a centre cut between the eyes (vertical plane x = 0) puts one eye on each piece by construction (the eyes are at |x| > 0.2 R0). RENDER's decal is drawn from the footprint on the piece mesh, so a miss shows as a slightly clipped half-eye

#### G7 (nested)

**What.** up to 5 cuts deep, any directions

**Independent evidence.** G1-G5 on every leaf; sum of fractions = 1 +- 1e-9; every piece >= 1/8

**Threshold, fixed before measuring.** as above

**Prototype result.**

the pieces of the 100 cut trees of sweep 5 (560 pieces with 1 to 5 cap planes, detail 2 or 3 by the 0.35 rule): IoU against the clipped source median 0.957, min 0.864 (by cap planes: 1: 0.920, 2: 0.864, 3: 0.900, 4: 0.893, 5: 0.963); skin coverage max-of-samples p95 0.177 R0, worst 0.375 (bar p95 <= 0.08: NOT met; most nested pieces are small and at detail 2, where the single-plane sweep gives 0.128); smallest triangle angle median 12.9, p5 5.8 degrees, a triangle under 15 degrees in 413 of 560 (74 %); no flip; sum of the fractions of every tree is 1 by construction (the shell derives B = parent - A). The nested pieces are visibly coarser than the first-generation ones

#### L1 (X07 and SHELL N7, launch)

**What.** the SHELL's swap flow on the true pieces: born flush at the parent's centre + R off, `collide` every frame, the scripted parting (`|n.y| < 0.75`: horizontal `moveTo`; `|n.y| >= 0.75`: the upper piece 5 cm up and dropped), 4 s, no fingers; 50 species x 6 planes (vertical through the centre and at 0.5 R0, level at 0 and 0.3 R0, tilted 50 degrees, tilted 25 degrees) x both pieces

**Independent evidence.** the centre of the piece read from POSITIONS (finite difference over 0.1 s, not the solver's `vc`, which reads +-0.16 m/s on any stacked pair); rise above the birth position; lowest particle; fold excess; deepest particle of one piece inside the other (surface distance, ray parity on a COPY of the other's positions); `stateHash` twice

**Threshold, fixed before measuring.** thresholds fixed before the run: rise <= 0.06 m and upward speed <= 1.0 m/s; supported pieces (born within 2 cm of the table) <= 1.2 m/s from 0.1 s and <= 0.3 m/s from 1 s; speed over the last 0.5 s <= 0.05 m/s; displacement from flush + parting <= 0.10 m for vertical and level planes (a sloped cut face may slide); lowest >= -2 mm; no safety reset; penetration <= 0.15 R; fold excess <= 75 degrees

**Prototype result.**

the SHELL's swap flow on the true pieces (`e1s2_swapflow.mjs`, final prototype: closest-point contact, 1 mm caps, 1 s skin ramp, shove scaled and vertical, adaptive foot that leaves cap vertices alone, the half-space limit, the corner rules), **50 species x 6 planes** (vertical through the centre, level through the centre, vertical at 0.5 R0, tilted 50 degrees at 0.2 R0, level at 0.3 R0, tilted 25 degrees at 0.1 R0) = 293 cuts (7 skipped: a side under 1/8) = 586 pieces, 4 s each, born flush with no velocity, the scripted parting, the upper half of a level cut dropped 5 cm, `collide` every frame, the centre read from positions:

| row (threshold fixed before the run) | result |
|---|---|
| **launch**: rise above the birth position <= 0.06 m and upward speed <= 1.0 m/s | **0 of 293 cuts fail**; rise median 0, p95 1 mm, max 17 mm; upward speed median 0.26, p95 0.47, max 0.69 m/s |
| speed: supported pieces <= 1.2 m/s from 0.1 s and <= 0.3 m/s from 1 s | 4 cuts fail (three level cuts at +0.3 R0, petalop and ambrosel among them, and one vertical slice of plumpet at 0.32 m/s); from 0.1 s median 0.58, p95 0.79, max 2.02 m/s (a tail cut free 0.39 m above the table: its free fall); from 1 s median 0.09, p95 0.23, max 0.44 m/s |
| settled: speed over the last 0.5 s <= 0.05 m/s | 3 cuts fail (the 25-degree faces of knubby and marigel at 0.054 to 0.070 m/s, a slice of puddlo); median 0.0014, p95 0.043 |
| displacement from flush + parting <= 0.10 m on vertical and level planes | 24 cuts fail: 15 of the 44 vertical cuts at 0.5 R0 (the small slice, 0.17 m at the 90th percentile, tips over and rolls instead of standing on its edge), 8 of the 49 level cuts at +0.3 R0 (the small upper cap ends 0.10 to 0.14 m from where it landed), 1 centre level cut |
| nothing below the table (-2 mm), no safety reset | 0 and 0 |
| penetration <= 0.15 R | 1 cut fails (caromel 25-degree face, 0.18 and 0.21 R) |
| fold excess over the hinge's rest <= 75 degrees | 8 cuts fail (6 of them the vertical cut at 0.5 R0); peak excess median 13, p95 40, max 106 degrees |
| **every row** | **256 of 293 cuts (87 %)** |

By plane: vertical through the centre 50 of 50, level through the centre 49 of 50, vertical at 0.5 R0 23 of 44, tilted 50 degrees 49 of 50, level at 0.3 R0 39 of 49, tilted 25 degrees 46 of 50. The built pieces: rest volume against `frac V3` within 1.0e-12, mass-weighted mean of the rest shape 2.6e-16 R0, particle masses 0.019 to 7.35 (mean 1), 206 of the 586 pieces needed a foot patch, 0 build errors. For the same cuts with the SHIPPED `collide` (8 species, 46 cuts, final builder) 17 pass every row and 12 launch (section 4). With a flat foot patch that includes the cap vertices (an earlier version) the thin slices of the vertical cut at 0.5 R0 stood on their rim and creased instead: 19 fold failures (against 6) and 0 displacement failures on that cut (against 15); the choice between "creased on its rim" and "tipped over" is owner question 3.

#### L2

**What.** rest poses: cap down, standing on the old foot, dome down (flipped)

**Independent evidence.** settle speed over the last second, jitter of the COM height, particles touching

**Threshold, fixed before measuring.** <= 2 mm/s, <= 0.3 mm, >= 7

**Prototype result.**

Measured (E2, 12 species, one per family, 3 poses, 4 s on the table, nothing else): every one of the 36 pieces is at rest: peak centre speed 0.000 m/s, last-second jitter 0.00 mm and 0.00 mm/s, lowest particle 0.00 mm, frame tilt 0.00 degrees. Particles on the table: cap down (the top half of a level cut) 125 to 259; standing on its old foot (a vertical half) 10 to 54 (capnap 10, chunkle and twangle 16); dome down (the half flipped, cap up) 11 to 105 (dollop 11, all others 19 or more). Before the adaptive foot, dollop's dome-down half had 4 particles on the table, sagged 27 mm and moved at 0.35 m/s while settling (the same experiment with the shipped foot rule, section 2.2 step 8).

#### L3

**What.** touching a rim

**Independent evidence.** peak dihedral EXCESS over each hinge's own rest dihedral; COM hop; speed 2.5 s after the release

**Threshold, fixed before measuring.** rim hinges move <= 15 degrees from their rest; hop <= 5 mm; <= 5 mm/s

**Prototype result.**

Measured (E10, `e10_rim.mjs`): the TOP piece of a level cut at +0.3 R0 and +0.45 R0 (8 species; the cap is down on the table, so the sharp rim IS on the table) with a finger pressing the dome for 0.8 s, the flat 110-degree limit (shipped) against the per-hinge limit. Columns: rim hinges (rest dihedral over 100 degrees) / largest change of a rim hinge from its own rest dihedral / the piece's centre speed 2.5 s after the finger left:

| piece | rim hinges at rest > 100 deg | flat 110: rim moved / late speed | rest-aware: rim moved / late speed |
|---|---|---|---|
| dollop +0.3 R0 (frac 0.23) | 9 | 23 deg / 43.3 mm/s | **8 deg / 0.8 mm/s** |
| dollop +0.45 R0 (0.13) | 12 | 27 deg / 51.4 mm/s | **10 deg / 0.4 mm/s** |
| kneadle +0.3 R0 (0.24) | 5 | 46 deg / 114.1 mm/s | **4 deg / 0.1 mm/s** |
| kneadle +0.45 R0 (0.14) | 5 | 36 deg / 53.8 mm/s | **4 deg / 0.1 mm/s** |
| crimpo +0.3 R0 (0.19) | 18 | 25 deg / 45.8 mm/s | **4 deg / 0.1 mm/s** |
| dimpla +0.3 R0 (0.20) | 10 | 29 deg / 32.7 mm/s | **1 deg / 0.0 mm/s** |
| boingle +0.3 R0 (0.23) | 5 | 6 deg / 7.1 mm/s | 3 deg / 0.0 mm/s |
| wisplet +0.3 R0, twangle +0.3 and +0.45, chunkle +0.3 and +0.45 | 0 to 8 | identical in both (no hinge past 100 degrees, or the finger never reaches them) | identical |

With the flat limit the rim is held 23 to 46 degrees away from its own rest shape while the finger or the table is near, the loop re-opens it by force every substep and the piece keeps moving 2.5 s after the release (33 to 114 mm/s); with the per-hinge limit the rim stays within 1 to 10 degrees and the piece is at rest within 1 mm/s on all seven affected pieces. For a whole body the per-hinge limit is exactly 110 on every hinge (rest dihedral <= 55 degrees), so nothing changes there (E11).

#### L4

**What.** determinism

**Independent evidence.** two runs of a scripted session (cut, parting, joins)

**Threshold, fixed before measuring.** equal `stateHash` of every piece at 6 checkpoints, 4 species

**Prototype result.**

four nested sequences (dollop and twangle, 2 random trees each, 4 to 5 cuts) run twice from scratch: identical `stateHash` of every piece at the end; the earlier packing test (`e3_nested.mjs`, 137 pieces of 12 species placed together, run twice) also gave identical hashes on all 24 runs; no `Math.random`, no `Date` anywhere in the builder or the new solver code

#### L5

**What.** every goal term is centred

**Independent evidence.** `goalDrift` after `centreGB` in a frame of each of: fold 1, burst, setFrac, neck (3 planes), morph

**Threshold, fixed before measuring.** <= 1e-9 R0; and BEFORE the call: the old build FAILS it (flat face 0.015 to 0.056 R0 over 50 species, the neck up to 0.18 R0)

**Prototype result.**

| goal term (mass-weighted mean of `GB`, 50 species) | max (species) | median | decision |
|---|---|---|---|
| fold sphere `QS` (`setFold(1)`) | 0.0112 R0 (capnap) | 0.0023 | not centred (below any visible drift; keeps whole bodies bit-identical) |
| burst (`burstOpen`) | 0.0000 | 0.0000 | uniform scale about the origin |
| `setFrac` | 0.0000 | 0.0000 | uniform scale |
| neck, pinch along x (`setNeck`, t = 1, plane through the centre) | **0.0991 R0** (nuzzo) | 0.0467 | **centred** |
| neck, pinch along y | **0.0779 R0** (diademo) | 0.0257 | **centred** |
| neck, pinch along a tilted axis | **0.1767 R0** (marigel) | 0.0555 | **centred** |
| old chunk `FLAT` (shape.ts:282-294) | 0.015 to 0.056 R0 | about 0.03 | the launch (section 1); gone with the rest shape |

The neck is the only existing term with a mean of the size of the launch cause, and it acts on the WHOLE body during the 0.3 s pinch, so the old cut also pulled the parent's centre of mass along the pinch during the neck (I measured the size of the goal's mean here, not the resulting speed); centring removes that too.

#### L6

**What.** whole bodies unchanged

**Independent evidence.** bit-identical `stateHash` of the shipped and the patched SoftBody through a scripted session (press, rub, pull, release, nudge) on 50 species; the existing probe_softbody / probe_cut / probe_species / probe_families rows

**Threshold, fixed before measuring.** 50/50 identical until the first `setNeck` (the term that is re-centred); every existing row unchanged

**Prototype result.**

identical `stateHash` at all 33 checkpoints of a scripted session (press, rub, pull, release, nudge, fold ceremony, burst, neck, setFrac) on 12 of 12 species with the rest-aware fold limit alone; with the goal centring added, identical through checkpoint 28 (press, rub, pull, release, nudge, fold, burst) and different from checkpoint 29, the first `setNeck`, on all 12 (by design: the neck goal is the term that was off-centre)

#### L7

**What.** two flat cut faces on each other (level cut at 0 and 0.3 R0, upper piece 5 cm up and dropped)

**Independent evidence.** position of the upper piece's centre over 4 s, with the shipped `collide` (must FAIL: a regression row that proves the finding) and with the scoped changes

**Threshold, fixed before measuring.** with the changes: within 0.05 m of where it landed; shipped: leaves the lower piece

**Prototype result.**

dollop, level cut at +0.3 R0 (upper 23 % at detail 2 on the lower 77 % at detail 3), the upper piece dropped 5 cm, 4 s: with the shipped `collide` the upper piece ends 0.60 m from where it landed (it slides off the lower one at 0.4 s and falls 0.55 m) and the lower piece is pushed 0.46 m; with changes (a) to (d) 3.5 mm and 0.8 mm. A level cut through the centre of kneadle (putty): 26 and 48 mm shipped, 33 and 13 mm with the changes. The shipped row is the regression row that must FAIL on the old code

#### L8

**What.** `collide` unchanged for whole bodies

**Independent evidence.** two whole bodies stacked, 7 s, shipped file against the patched one

**Threshold, fixed before measuring.** identical `stateHash`

**Prototype result.**

two whole bodies, a drop of one onto the other, 7 s with `collide` every frame, all four contact changes switched ON in the patched copy: identical `stateHash` at 7 checkpoints for 5 of 5 species

#### L9

**What.** nested cuts the SHELL's way: one cut at a time, parting after each, up to 5 cuts (6 pieces), children born in the parent's pose (`frame`) with one common lift, `collide` among all bodies; 50 species x 3 random trees

**Independent evidence.** upward centre speed and rise above birth of every new child, the deepest interpenetration of every pair at the end of each cut (surface distance, ray parity on a copy), every piece's speed, `stateHash` twice

**Threshold, fixed before measuring.** no child rises over 0.3 m, upward speed <= 1.0 m/s, interpenetration <= 0.02 R, `safetyResets` 0, hashes equal

**Prototype result.**

`e3s_sequential.mjs`, 12 species x 3 random trees (up to 5 cuts = 6 pieces, parting after each cut, 2.5 s settling, `collide` among all bodies, children born in the parent's pose with one common lift): with (a) to (d) 0 of 36 sequences launch a child above 0.3 m (worst rise 20 mm, worst upward speed 0.70 m/s, peak fold excess 110 degrees, no safety reset); four sequences run twice give identical `stateHash`es; with the shipped `collide` 23 of 36 launch a child above 0.3 m (worst 1.5 m, 4.65 m/s). The interpenetration column was printed only for the failing prototype run (0.5 R at the end of a cut) and for one sequence with the final contact (0.000 R at the end of every cut); the probe row computes it for all of them

#### L10

**What.** the pair of one cut is disjoint at birth

**Independent evidence.** every vertex of each piece against its own cap planes, and the deepest particle of one piece inside the other (surface distance) in the whole's frame, no physics

**Threshold, fixed before measuring.** 0 vertices across a plane beyond 1e-9 R0, 0 particles inside the sibling deeper than 0.001 R0

**Prototype result.**

`m2_overlap.mjs`, 57 cuts (12 species x 5 planes: centre vertical, centre level, vertical at 0.5 R0, tilted 0.2 R0, level at 0.3 R0), both pieces: 0 of 114 pieces have a particle deeper than 0.001 R0 inside the other and one vertex is across its own plane by less than 1e-4 R0. Without the half-space clamp of 2.2 step 9: 22 of the 114 (all on the tilted plane), up to 0.0195 R0

#### M1

**What.** a sibling join returns the parent

**Independent evidence.** `restLocal` of a body built from the merged cells vs the one built before the cut (same detail)

**Threshold, fixed before measuring.** bit-identical (hash equal)

**Prototype result.**

(a) the same region built twice: bit-identical `restLocal` and `offset` on 12 of 12 species (so a cache hit and a rebuild are the same arrays); (b) a parent P cut into A and B and rebuilt from the UNION of A's and B's cells (the case where the shell does not collapse the siblings) against P built directly: largest vertex difference 1.1e-16 R0 over the 12 species, i.e. equal to rounding but not bit-identical, which is why the shell's sibling collapse (the node's own cell list) is what makes the join return the parent exactly

#### M2 (X04)

**What.** `setRegion` arrives

**Independent evidence.** shape RMS of the receiver to the target after the morph; the last join = root: `restLocal` hash of the swapped body vs `new SoftBody(genome)`

**Threshold, fixed before measuring.** RMS < 0.002 R0 (after commit exactly 0); hash equal

**Prototype result.**

measured on 12 species x 3 joins = 36 morphs (E4, `e4_morph.mjs`; the receiver settles 1.5 s, `morphTo` runs 1.2 s, then 1 s more; rotation extracted against `QG`; peak centre speed during the morph, shape RMS of the receiver to the target rest shape in R0 at the end of the morph, volume of the receiver against the target, centre speed 1 s after the morph, and the position difference over the next second between the receiver and a FRESH body built from the target and handed the receiver's particle state, which is the swap fallback):

| join | n | peak speed (m/s) median / max | shape RMS to the target (R0) median / max | volume / target | speed 1 s later (mm/s) median / max | swap to a fresh body (R0) median / max |
|---|---|---|---|---|---|---|
| half -> whole (the last join) | 12 | 0.052 / 0.262 | 0.0062 / 0.0206 | 0.999 - 1.006 | 1.7 / 7.5 | 0.018 / 0.104 |
| quarter + quarter -> half (siblings) | 12 | 0.034 / 0.211 | 0.0070 / 0.0207 | 0.998 - 1.000 | 1.4 / 40.8 | 0.012 / 0.186 |
| half + quarter (a union of cells that is not a node) | 12 | 0.058 / 0.112 | 0.0055 / 0.0166 | 0.998 - 1.000 | 1.3 / 10.2 | 0.026 / 0.052 |
| all | 36 | 0.058 / 0.262 | 0.0069 / 0.0207 | 0.998 - 1.006 | 1.5 / 40.8 | 0.021 / 0.186 |

No safety reset, `goalDrift` after the call 1e-17 to 2e-16 R0, a fold only where the rest shape itself changes (the peak dihedral is the TARGET's rim, up to 120 degrees, so the "excess over the old rest" column of the raw table is not a fold). Everything arrives: the shape to 0.02 R0 (the RMS bar of the existing X04 is 0.002 R0 AFTER the commit to the fresh body, which is exact by construction), the volume within 0.6 %, the body at rest within 41 mm/s at worst (twangle's quarter pair; 30 of the 36 morphs under 4 mm/s), the swap to a fresh body would move the particles by 0.02 R0 at the median and 0.19 R0 at worst (boingle's quarter pair), which is the case for the in-place commit that RENDER prefers. The speed during the morph is bounded by the easing: the body moves less than 0.3 m/s at its fastest

#### M3

**What.** a join is smooth

**Independent evidence.** peak COM speed during the morph, peak fold excess, volume target ratio, speed after the commit

**Threshold, fixed before measuring.** <= 0.3 m/s, excess <= 75, volume within 3 % (6 % air-bleed families), no jump

**Prototype result.** From the 36 morphs of the table under M2: peak centre speed 0.262 m/s at most (bar 0.3: met; median 0.058), volume of the receiver 0.998 to 1.006 of the target (bar 3 %: met), centre speed 1 s after the morph 1.5 mm/s median and 41 mm/s at most (no jump), no safety reset. The fold-excess bar cannot be read from this experiment: the morph changes the rest shape itself, so the dihedral over the OLD rest is not a fold (the peak dihedral is the target's own rim, up to 120 degrees); the probe row should compare against the TARGET's per-hinge limit instead.

#### M4

**What.** every pair of pieces can join

**Independent evidence.** for random trees: touching pairs (union sound?), non-touching (LCA group sound?), reconnect-all order ends at the root

**Threshold, fixed before measuring.** group always sound; ends whole 100 %

**Prototype result.**

`sweep5.mjs`, 100 random cut trees (2 per species, all 50 species), each up to six pieces (cuts chosen at random through the largest or a random piece, 60 % near-horizontal normals): 460 accepted cuts, 560 pieces; every new cell and both children of every accepted cut passed the soundness test (0 loose-crumb refusals; 2 051 attempted cuts were refused only because a side was under 1/8); all 560 pieces built (0 errors, 0 flipped tetrahedra, 6 wrong-facing triangles, the rim snap reverted on 1 piece after the corner rules of 2.2 step 6; 441 before them). Joins, all 1 302 piece pairs of the 100 trees: 195 are sibling nodes (the union collapses to the node's own cell list: bit-identical, M1), 632 have a sound union of cells (at least 0.97 of its volume visible from the best centre; the sweep used 0.97 for a union and 0.94 for a cell or a child, the engineer's single bar of 0.95 lies between them), 475 do not and fall to the lowest-common-ancestor group; the group of such a pair is the WHOLE squishy for 377 of the 475 (79 %), is always a sound region (smallest visible share 0.996), and reconnecting all the pieces in a random order ends at the root in 100 of 100 trees (the last join is `createBody(genome)`). The cheap "touching" test of the sweep passed all 1 302 pairs, so it is only a necessary condition: the real shared-face test (positive area) is the engineer's `joinable`, and its pass rate is what decides how often a join escalates (R11 in 10.2)

#### C1 (X02)

**What.** `planCut` predicts what is built

**Independent evidence.** `fa` against the voxel share of the ORIGINAL mesh on that side (R0/20); `median` mode; `cellFa` against the voxel share per cell

**Threshold, fixed before measuring.** |fa - voxel| <= 0.01; median = 0.5 +- 1e-5; cellFa classifies right on every cell

**Prototype result.**

`g1_voxel.mjs` second metric: the planned fraction (the exact clip of the rest mesh, what `planCut` returns) against the voxel share of the ORIGINAL detail-3 mesh on that side and against the built piece's own voxel share, max over the cuts: 2.77 % (median 0.58 %) of the whole at R0/20 and 1.50 % (median 0.65 %) at R0/32. The bar (0.01) holds at the median but not at the maximum (2.77 % at R0/20, 1.50 % at R0/32), and the shortfall is the instrument (the exact clip and the voxel count of the SAME mesh disagree by that much; refining the cell halves the maximum but not the median). The consistency that matters for the shell is exact: the built piece's `restVolume / (frac V3) - 1` is 1.0e-12 at most on all 586 pieces of the final swap-flow run (14 secant steps), so prediction = construction. A voxel row cannot verify 0.5 %: use the analytic clip of the original mesh as the reference (it is the same routine) and keep the voxel row as a sanity bar of 0.03

#### C2

**What.** the cut is refused when it would leave crumbs

**Independent evidence.** `sound = false` on the two known unsound single planes (munchip / selenuff, level plane at +0.5 R0, side A) and `true` on every one of the other 2 210

**Threshold, fixed before measuring.** exact

**Prototype result.**

sweep 4f: 3 of 2213 single-plane regions are unsound (munchip and selenuff, level plane at +0.5 R0, upper side: 3.6 and 4.3 % of the part reachable from the centroid; ambrosel, oblique plane at +0.5 R0: 93.0 %); all other 2210 are sound. The row asserts exactly these three

#### B1 (X08)

**What.** frame cost

**Independent evidence.** 6 true pieces with `collide` every frame vs 2 whole bodies (probe_cut X08's interleaved batches)

**Threshold, fixed before measuring.** ratio <= 1.0 (best batches)

**Prototype result.**

Measured (E6, `e6_perf.mjs`, probe_cut X08's method: interleaved batches of 60 frames, 8 batches, `collide` every frame, `warmUp` first; dollop and kneadle; six pieces of 0.13 to 0.26 from a random cut tree against two whole bodies of 1 284 particles; the machine was shared with other agents, so the medians are noisy and the best batches are the instrument):

| set | particles | dollop best / median ratio to 2 wholes | kneadle best / median |
|---|---|---|---|
| 2 whole bodies | 1 284 | 5.96 ms/frame (median 11.0) | 5.58 ms/frame (median 12.6) |
| 6 pieces, detail 2 under 0.35 (CUT.md, recommended) | 972 | **0.78** / 0.85 | **1.10** / 0.84 |
| 6 pieces, detail 3 from 0.2 | 1 452 | 1.44 / 2.24 | 1.14 / 1.85 |
| 6 pieces, detail 3 for all | 3 852 | 4.38 / 4.24 | 4.17 / 3.98 |

The recommended policy meets "6 pieces <= 2 whole bodies" on the best batches for dollop (0.78) and within the noise for kneadle (1.10 best, 0.84 median); the two richer policies do not. The struts are the other cost (dollop: 0 at detail 2, 40 at 'detail 3 from 0.2', 117 at detail 3 for all). Per-step work added by this design: none for a whole body, `centreGB` (6n flops) while a neck or morph runs, one boolean per contact pair.

#### B2

**What.** build cost

**Independent evidence.** `buildPiece` ms (median, p95, max), `prepareCut` slice <= 3 ms, the swap frame (ctor from cache)

**Threshold, fixed before measuring.** median <= 12 ms and p95 <= 40 ms per detail-3 piece in the browser, a stage <= 3 ms, swap-frame physics <= 8 ms

**Prototype result.**

prototype numbers (6.4): detail 3 median 15 ms and p95 76 ms in the final sweep (37 and 202 ms on a loaded machine), detail 2 median 4 ms and p95 20 ms; warm halves 20 to 73 ms; six-piece union builds up to 412 ms. Row B2 therefore also states the TARGET of the port: median <= 12 ms and p95 <= 40 ms per detail-3 piece in the browser, with a stage <= 3 ms

#### B3

**What.** whole-body perf unchanged

**Independent evidence.** the existing probe_softbody perf rows

**Threshold, fixed before measuring.** no regression beyond noise

**Prototype result.**

not run as a timing row (the designer does not edit src/). By construction a whole body does no new work per step (two boolean tests: `morphOn`, `capFlat`) and is bit-identical to the shipped one (E11 for the solver until the first `setNeck`, E14 for `collide`), so the existing perf rows must pass unchanged; the row exists to prove it on the engineer's machine

## 10. Answers to the other lenses, risks, owner questions, estimate

### 10.1 What PHYS commits to, against the other two memos' requirements

| requirement | answer | where |
|---|---|---|
| RENDER R1: closed outward mesh, icosphere topology, star-shaped about `rayOrigin`, `restLocal` mass-centred to 1e-6 R0 | yes by construction (seed = first exit from the centroid; flips = 0 on all 2 210 sound regions); mass centroid is exactly 0 to 1e-17 | 2.2 steps 4, 10 |
| R2: exact flat face, clean rim | cap vertices on the plane to 4e-16 R0 (planarity), the cap is a union of whole triangles, the rim loop lies on plane and skin (rim snap applied to 2 207 of the 2 210 sound detail-3 regions and all 569 at detail 2 regions; the 3 where the snap would have folded the mesh revert to the unsnapped radial mesh and are reported) | 2.2 steps 6-7 |
| R3: cap triangles >= 15 degrees | PARTLY. Measured: cap triangle minimum angle median 30 degrees, p5 14, p1 4.3; a cap triangle under 15 degrees occurs in 114 of 2 210 regions (5.2 %) at detail 3 and 19 of 569 (3.3 %) at detail 2, and a triangle anywhere on the piece under 15 degrees in 19.5 % and 44.5 % of them (the cap ones: a rim vertex squeezed against two interior vertices at a narrow lens). The solver does not mind (min triangle angle is not a constraint; no flips, no zero areas); the render copes with slivers visually, as its own memo says. A rim-spacing rule (re-space the rim loop by arc length before the cap relaxation) would fix most; it is listed as a tuning item, +1 day | 2.2, sweep table |
| R4: particles, goal and edge rest lengths agree at t = 0 | yes: the rest shape IS the final shape; no `FLAT`, `flatK`, `ROUND_TAU` for a piece with a region | 3.1 |
| R5: `piece.whole` by identity, `frac` the true fraction, stable plane ids | `PieceInfo.whole` arrays are the cached source (identity per species/size); `frac` = `restVolume / V3`; the ids are SHELL's literals | 7 |
| R6: born flush in the whole's pose | minimum form (parent's frame, `at = c + R off`, lobe velocity): `placeAt`. Measured: the two pieces' cap planes coincide to 1e-9 R0. The "preferred" form (initialise particles from the deformed whole at each material point) is not designed: the Cut tool releases the fingers and the parent is near rest; the pop is bounded by N10 (3.4) | 3.4, 4 |
| R7: merge changes `piece` by identity | `setRegion` morph, then `adoptRest` in place and a NEW immutable `PieceInfo` in the same step | 5.3 |
| SHELL: `planCut` incl. `median`, `cellFa`, `sound`, `built`; `setRegion`, `placeAt`, `joinable`, `setNeck(.., depth)`, `prepareCut` | all listed in 7 with their algorithms in 5 and 6 | 5-7 |
| SHELL: FRAC_MIN 0.124, fractions are shares of V3 | yes | 7 |
| SHELL N7 (no launch) on the true pieces, near-level and tilted planes (marked NOT MEASURED in CUT2_SHELL 5.5) | measured here with the SHELL's own flow (flush birth, scripted parting, lifted upper half): 256 of 293 cuts (87 %) pass every row and none launches (rise <= 17 mm, upward speed <= 0.69 m/s); the SHELL's 0.10 m displacement bar holds for 50 of 50 vertical cuts through the centre, 49 of 50 level cuts through the centre and 41 of 49 level cuts at +0.3 R0, and fails for the thin slices of a vertical cut at 0.5 R0 (they tip over: 23 of 44 pass) and for the small cap of the level cut at +0.3 R0 on 8 species; the 50-degree faces slide a median 7.5 cm and are at rest by 4 s on 50 of 50, the 25-degree faces a median 9 cm and 48 of 50. N7 should therefore read: no launch on any plane, displacement <= 0.10 m on vertical and level planes except thin slices, at rest by 4 s on sloped faces | 4, 9 (row L1) |
| SHELL N10 (swap continuity, Chamfer <= 0.08 R0) | measured as a function of the neck depth: Chamfer on the visible faces 0.137 R0 at today's waist, 0.109 at depth 0.71, 0.085 at 0.5, 0.065 (median; 10 of 12 families <= 0.08) at 0.35 and 0.032 (12 of 12) at 0.14; all faces 0.147 / 0.118 / 0.098 / 0.083 / 0.060. The SHELL's depths pass for gel, gummy, water, silicone, pop dome, beads and marshmallow and fail for putty (about 0.15 at 0.6) and slow-rise (0.112 at 0.5); the bar should count visible faces only | 3.4 |

### 10.2 Risks

| # | risk | evidence / size | mitigation |
|---|---|---|---|
| R1 | **`collide` is the weakest part of the design.** The solver's contact was tuned for two or three round bodies; flush flat faces, unmatched vertices and piles of 5 to 6 pieces expose it. Without the changes of section 4 the SHELL's own flow passes every row on only 17 of 46 cuts (8 species) and 23 of 36 nested sequences launch a child above 0.3 m; with them 40 of 46, 256 of 293 over 50 species, and 0 of 36 nested launches | 4, 9 (L1, L7, L9) | the changes are scoped to pairs with a piece (wholes bit-identical, L8); each has its own probe row; if a row cannot be met the fall-back is the SHELL's open-loop parting with a longer ramp and NO contact between the pieces of one cut for the first second |
| R2 | **Build cost.** 20 to 73 ms per piece warm in the prototype, up to 412 ms for a union region, against a neck of 15 to 24 frames at 3 ms each | 6.4 | the median pair (30 ms) fits, the tail (p95 pair about 150 ms, warm halves up to 73 ms each, unions 412 ms) does not: the port must be up to 3 times faster at the tail (typed scratch arrays, grid cached per species and size) or the neck longer than 0.4 s; `prepareCut`'s resumable stages and `prewarm()` are in the contract so any of these is possible without a shell change |
| R3 | **Thin slices tip over or crease.** A slice cut off the side (vertical plane at 0.5 R0, 14 to 28 % of the body, detail 2) cannot stand on its edge: with a foot patch across its cap it stood and creased (19 of 44 cuts with a fold excess over 75 degrees), with the cap left alone it tips over and rolls (15 of 44 end more than 0.10 m from where it landed, median 62 mm, worst 297 mm). Pieces cut free in the air (tadpolo's tail) fall and crumple on landing: peak fold excess over the rest 106 degrees at most in the final run | 9 (L1), owner question 3 | an owner choice (3); the contact fold limit already exists near fingers and the table edge, extending its "near" list to particles in body-to-body contact is the obvious next step (not tested); the rim itself is protected by the rest-aware limit (E10) |
| R4 | **Neck swap pop** is a property of the neck goal, not of the pieces: 0.15 R0 at today's waist, 0.06 to 0.1 at depth 0.35; N10 as written (all faces) cannot be met by a deep pinch | 3.4 | restate N10 on visible faces and re-fit the per-family depth with the table of 3.4 (slow-rise and putty need <= 0.25) |
| R5 | **Voxel IoU bars not met** (19 of 78 cuts under 0.95, 2 under 0.90: the horned species), cap area against the true section 0.91 at p5 for detail 3 and 0.80 for detail 2, 19.5 % of the detail-3 regions (44.5 % at detail 2) with a triangle under 15 degrees (RENDER R3 partly met) | 2.2.1, 10.1 | restated bars in G1; rim re-spacing by arc length before the cap relaxation is the first thing to try (+1 day, untested); horned species are listed exceptions |
| R6 | **Loose crumbs refused.** 0.14 % of single-plane cuts (both ears of munchip and selenuff taken off by one level plane at +0.5 R0) and an unmeasured share of nested ones | 2.4, sweep 5 | owner question 1; the refusal is cheap (`planCut.sound`) |
| R7 | **The constructor refactor for `adoptRest`** touches about 40 arrays; a missed one is a subtle bug that shows only after a join | 5.3 | the fall-back (swap to a fresh body with the receiver's `X, V, qr`) moved the particles by 0.02 R0 at the median and 0.19 R0 at the worst (E4), so the in-place commit is a nicety, not a necessity; a probe row compares the two |
| R8 | **Sloped cut faces slide, putty and sticky halves creep 13 to 17 cm on a level stack, stacked halves rest 39 to 55 mm apart** | 4 | physics of a contact without static friction; the shell's N7 displacement bar applies to vertical and level cuts only; the join test must treat a gap under 0.07 R0 as touching |
| R9 | **The prototype is plain JS around a COPY of `softbody.ts`**; every number here must be re-measured on the port by the probe rows, and the thresholds in section 9 were fixed before measuring but not all were met (G1, G2 at detail 2, G4, G5, G6, G7, C1, B2) | 9 | the rows are written to report, not to hide: an exception list per row, not a loosened bar |
| R10 | **Detail 2 pieces** are the coarse end of the quality tables (IoU against the clipped source 0.958 against 0.987, 44.5 % of regions with a triangle under 15 degrees against 19.5 %) and carry a 6.4 % deficit of the radial mesh, corrected by the volume step at 0.008 R0 (median) | 2.6 | stays CUT.md's rule because of the 6-piece budget (E6) |
| R11 | **Non-sibling joins escalate.** Of the 1 302 piece pairs of the random cut trees, 195 are siblings (exact, free), 632 form a sound union and 475 (36 %) do not; for those the SHELL's lowest-common-ancestor rule joins a group that is the whole squishy in 79 % of the cases (the player joins two pieces and everything comes back) | sweep 5, 5.2 | a product question for the SHELL (owner question 5); the physics can build any sound union, so a more permissive `joinable` (two-body unions, or a looser soundness bar than 0.97) reduces escalation without a physics change |

### 10.3 Owner questions (genuine product choices only; everything else above is engineering)

1. **A cut that would leave loose crumbs: refuse it, or allow it?** Measured: 3 of 2 213 single-plane regions (0.14 %) are two islands (a level plane at +0.5 R0 on munchip and selenuff takes BOTH big ears off at once; an oblique 0.5 R0 plane on ambrosel reaches only 93 % of its part from the best centre). My recommendation: **refuse** with the shell's own line ("That cut would leave loose crumbs. Try another angle."), because the alternative is a fake bridge or a two-body piece and both break "everything on that side stays with it". The same test guards every nested cut, which is what keeps every later join buildable.
2. **Does the flat face stay flat for ever on the soft families?** Today a chunk's cut face rounds over with the family's time constant (putty 6 s, mochi 4 s, beads 3 s). In the true cut the face IS the rest shape: it stays flat and the rim stays a true 100 to 140 degree edge; only fingers deform it, and the family memory holds what is pressed in afterwards, as on a whole squishy. My recommendation: **flat for ever, crisp rim** (the owner asked for "clean cuts"; a time-based round-over reads as the old "little ball"). The render's normal smoothing is the only softening, and a per-family bevel of 60 degrees costs 5 to 36 % of a thin piece's volume (measured, 2.3), so I do not recommend it.
3. **Which way does a half lie?** The weeble keeps a piece in its REST orientation: the top half of a level cut sits cap-down (dome up), a vertical half stands on its old foot with its cut face vertical, the lower half sits dome-down with the cap up. The alternative (a half topples to lie on its cap) needs a topple that sweeps the corners 0.3 to 0.5 R0 into the table (same family of launch) and breaks `x_piece = x_whole - offset`. My recommendation: **stand in the rest orientation**; if the owner wants the cut face seen, RENDER's camera peek (CUT2_RENDER 6.4) is cheaper and reversible than a physical lean. One measured exception is a product choice: a THIN slice cut off the side (14 to 28 % of the body) has nothing to stand on but the edge of its cut face. With a foot patch across that edge it stands and its rim creases under the landing (fold excess over 75 degrees in 19 of 44 cuts); with the cap left exactly flat it tips over and lies on its curved side, 6 cm from where it landed at the median and up to 30 cm. I recommend **letting it tip over** (it is what a real slice does and it leaves no crease).
4. **How deep is the pinch before the cut?** Product feel versus pop: a deep pinch (today's waist 0.3) looks like a knife pressing through and ends in a visible swap pop (Chamfer 0.15 R0 on dollop); a groove (waist 0.755) pops at 0.05 to 0.10 R0 on the visible faces but looks like a seam. My recommendation: the SHELL's per-family table for gel, gummy, water, silicone, pop dome and beads (0.35) and marshmallow (0.5), but 0.25 or less for putty and slow-rise (the measured pops at the SHELL's depths are 0.15 and 0.11 R0), 0.9 for sticky and slime where the strand hides the swap; judge it by eye on the 11 families once.
5. **When two pieces that are not the two halves of one cut are joined, what happens?** Measured on random cut trees of up to six pieces: 36 % of the piece pairs cannot be merged into one sound body (the union is not star-shaped from any point) and the shell's rule then reconnects the smallest group that is a clean cut-off part, which is the whole squishy in 79 % of those cases. My recommendation: **accept it for now** (it is always correct and ends with the exact original), and decide by feel after the first playtest whether a join of two arbitrary pieces should instead be refused with a line ("These two don't fit") or allowed to make a piece with a visible seam.

### 10.4 Estimate (engineer-days, one engineer who has read this memo and the two others)

| work | days |
|---|---|
| `piece.ts`: source solid and grid, ray stack, centre and soundness search, seed, radial relaxation, rim snap, cap/skin relaxation, adaptive foot, normal-offset volume, normalise, weights, cache, resumable stages (port of the prototype `piece3.mjs`, `region.mjs`, `grid.mjs`; the algorithms are in 2.2) | 4.5 |
| `region.ts`, `planCut` (rest-frame clip, median, cellFa, soundness of cells), `prepareCut`, `joinable`, `placeAt`, `setRegion` + `adoptRest` (constructor refactor into `initRest`), `PieceInfo` | 4 |
| solver patches: `centreGB`, per-hinge fold limit, morph blend and rotation extraction, `setNeck` latch + depth, `collide` pair normal and push scaling (scoped), `FRAC_MIN`, adaptive foot | 2 |
| `_harness/probe_truecut.ts`: rows G1-G7, L1-L6, M1-M4, C1-C2, B1-B3 on 50 species; re-specify the old chunk rows of probe_cut | 3.5 |
| tuning and defects (rim spacing for R3, detail policy, neck depth table with SHELL, the E1/E3 residuals) | 2 |
| **total** | **16** |

CUT2_SHELL guessed 10 to 12 days for the PHYS lane; the difference is the collide finding (1 day with its tests), the rest-frame `planCut`/`joinable`/soundness machinery (2 days), and the probe on 50 species (3.5 days). A cut down version that ships the true halves for the FIRST cut only (no unions, no `setRegion`, joins by the existing shrink-and-swap into a fresh body, no `prepareCut`) is 9 days and keeps every solver patch.
