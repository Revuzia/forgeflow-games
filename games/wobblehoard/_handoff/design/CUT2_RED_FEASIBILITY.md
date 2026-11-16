# CUT2 RED TEAM: PHYSICS FEASIBILITY AND ROBUSTNESS

Reviewer lens: try to break the geometry, the solver contract and the join algebra of `_spec/CUT2.md` and its three memos. Read-only: nothing under `src/`, `_harness/`, `_spec/` or `public/` was touched, no git write command was run, no browser was started.
Date of the review: 2026-10-08. Reviewer default: needs-changes unless no real flaw is found. **Verdict: needs-changes (4 MAJOR, 13 MINOR).**

What the review did: read `RESUME.md`, `CUT.md`, all of `CUT2.md`, the PHYS memo (soundness, nested cuts, joins, morph, perf sections) and the SHELL memo's tree algebra; read `softbody.ts` (constructor 521-800, `reset` 813-861, `step` 863-884, `measureCut`/`setNeck`/`setFrac`/`collide` 1259-1445, `substep` 1843-2325, `frameUpdate` 2357-2439, `neckGoal` 2446-2537, `dampPass` 2585-2667, `finalize` 2712-2840, `foldLimit` 1677-1785, `matCorral` 1600-1625), `shape.ts`, `mesh.ts`, `shapes.ts`, `species.ts`; then re-ran and EXTENDED the designers' own prototypes (PHYS `piece3.mjs`, `region.mjs`, `centre.mjs`, `cuttree.mjs`, the patched solver `proto/softbody_p.ts`, `e3s_sequential.mjs`, `e1s2_swapflow.mjs`, `e4_morph.mjs`; I imported them unchanged) on planes and situations they did not try.

**Measurement caveats, stated once.** (1) Every PHYS number in the spec comes from a plain-JS prototype around a COPY of `softbody.ts`; so do mine (same copy, same flags: the "final" contact flags of `chain13.sh`). Nothing of CUT2 exists in `src/` yet, so nothing here is a measurement of the port. (2) The machine was shared with another agent's browser runs, so wall-clock numbers are order-of-magnitude (the same vertical-half build took 25 to 383 ms across six repeats, S19); counts of ray queries, particle counts and geometry numbers are not affected. (3) I kept to one heavy job at a time except for three short overlaps (a duplicate sweep left by an abandoned shell wrapper, killed after about a minute; a two-minute dihedral measurement while a sweep ran; sub-second simulations) and killed every process I started (checked at the end). (4) The line references in appendix A of the spec that I opened (12 groups in `softbody.ts` and `shape.ts`) all match the code.

Scratch scripts (all mine, all reproducible): `C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad/truecut/redfeas/` (`SCR` below). Run as `cd games/wobblehoard; node SCR/<script> <args>` (a working directory under the long scratch path fails on Windows: "path longer than allowed").

---

## 1. Findings

| id | severity | one line |
|---|---|---|
| PF1 | MAJOR | "6 pieces cost no more than 2 whole bodies" is false for the partitions the 0.35 detail rule allows (one big piece + five 1/8 pieces = 1452 particles against 1284) |
| PF2 | MAJOR | The "rim snap reverted" fallback (1.9 % of detail-2 builds, 2.8 % of the 1/8 slivers) leaves the piece outside its own half-space (up to 0.35 R0), overlapping its sibling (up to 0.22 R0), with near-zero-mass particles and 165-176 degree creases in the solver; cause found: the adaptive foot (step 8) |
| PF3 | MAJOR | A FIT union (two touching pieces that are not tree siblings) is built by a builder that was never validated on unions: 39 % reverted rims, IoU median 0.84 (min 0.42), skin offset up to 0.97 R0, 37 of 72 with more than 10 non-star triangles; the PHYS sweep built zero of them |
| PF4 | MAJOR | Reconnect all after the Split-in-two chain (the X10 keyboard path) has a detail-2 receiver growing 4 to 8 times; it misses X23 and X04 (peak centre speed up to 1.37 m/s, 4 of 12 species over 0.3; swap pop median 0.04 R0 against 0.03) |
| PF5 | MINOR | Split in two: `fa = 0.5 to 1e-5` against `canSplit` guard `1e-6`: 3.5 % of simulated five-press runs refuse the fifth press |
| PF6 | MINOR | `centreGB` does not remove the whole-body drift of a tilted-plane neck (COM 1.3 to 1.7 m/s, 15 to 20 cm in 0.3 s, 10 of 50 species); X13/L9 give the children zero velocity, so they never see it |
| PF7 | MINOR | Thin slices do not "tip onto their curved side": they stand on 3 to 5 rim particles leaning 1 to 27 degrees, centre up to 13 cm below its rest height (supported-gravity `supp` plus weeble torque) |
| PF8 | MINOR | Nested skin offset is stated "under 0.005 R0" (4.3); PHYS's own nested data: median 0.011, p95 0.031, max 0.152 R0 at detail 2 |
| PF9 | MINOR | L9 says "50 species x 3 trees"; 12 were run. The other species (14 run by me, 42 sequences): fold excess 163 degrees (swishel), 88, 87, 81, 79; no launch |
| PF10 | MINOR | X13 "every failure is one of the named categories" is false for at least 12 of the 28 failing rows of PHYS's own `e1final2.jsonl` |
| PF11 | MINOR | `loose` refusals are concentrated: selenuff refuses 14 % of horizontal swipes at +0.375 to +0.55 R0 (spec: 0.14 % of a grid) |
| PF12 | MINOR | `planCut`'s soundness work has no budget: 5 000 to 75 000 ray queries per nested cut in the prototype, 316 ms median / 2.6 s p95 on this machine |
| PF13 | MINOR | The "at most 64 leaves" rule is not an invariant of the algebra (abstract simulation passes 64 leaves) and has no defined behaviour |
| PF14 | MINOR | The swap frame depends on wall-clock build budgets (`prepareCut(budgetMs)`), so X22's determinism claim needs a stage-count budget |
| PF15 | MINOR | "A re-merge returns the identical rest shape" (4.5) holds only at equal detail; a sibling re-merge of two detail-2 children is a new detail-2 build, not the parent's detail-3 mesh |
| PF16 | MINOR | Bundle: the physics builder alone minifies to 25 KB (10 KB gz) with none of `planCut`, `setRegion`, `adoptRest`, `joinable`, `collide` changes, render cap shader, `cutRegion`; headroom is 86 KB and is shared with the UI overhaul and PETS |
| PF17 | MINOR | `placeAt` does not say it re-homes the piece (`homeX`, `homeZ` drive `matCorral`, `reset`); the cell classifier (eps 1 %) can leave a leaf overhanging its cut plane |

---

## 2. MAJOR findings

### PF1. The perf guarantee holds for one partition only

**Claim under test.** CUT.md rule 4.6 / X08 and the owner's brief: "6 pieces cost no more than 2 whole bodies". CUT2 3.2 keeps CUT.md's rule "`frac < 0.35` -> detail 2 (162 particles), else detail 3 (642)", and 5.8 / X08 test dollop and kneadle with "six pieces".

**Arithmetic of the rule.** Six pieces of at least 1/8 can contain exactly one piece of 0.35 or more (0.35 + 5 x 0.125 = 0.975). That partition is 642 + 5 x 162 = **1452 particles against 1284** for two whole bodies (x 1.13 before any per-particle cost differences, struts, `collide`). It is also the partition a player produces by the cut the spec describes in section 1 ("near an edge gives a small piece and a big piece") five times. PHYS's E6 (`phys/fill/E6.md`, `e6_perf.mjs`) searched seeds until all six pieces were under 0.32 (972 particles). Its own row "6 pieces, detail 3 from 0.2" is 1452 particles and costs 1.44 (dollop) / 1.14 (kneadle) of two whole bodies at the best batch. The spec's K8 already records kneadle at 1.10 for the favourable partition.

**Measurement.** `SCR/s6_perf.mjs <species>`: shipped `softbody.ts` (no CUT2 contact), `collide` every frame, interleaved batches of 60 frames, best of 10, shared machine.

| species | two wholes (1284 p) | six pieces, all under 0.35 (972 p) | 0.375 + 5 x 0.125 (1452 p) | 0.5 + 5 x 0.125 (1452 p) |
|---|---|---|---|---|
| dollop | 4.83 ms | 0.74 | **1.11** (median ratio 0.91) | **1.27** |
| kneadle | 4.05 ms | 0.87 | **1.36** (median 1.53) | **1.37** |
| twangle | 4.99 ms | 0.73 | 0.94 (median 1.06) | **1.06** |

X08 as written (ratio at most 1.0, dollop and kneadle, "six pieces") would pass on the first column and fail on the player's natural partition; with the CUT2 closest-point contact on top (not in these numbers) it gets worse.

**Fix.** Replace the single 0.35 rule by a particle budget: the sum over live pieces must stay at most 2 x 642. Concretely: when a cut makes the fourth piece (third on `low`), rebuild the largest detail-3 piece at detail 2 (an event; the cache key already includes the detail) or simply make "5 or more pieces => every piece detail 2". State the rule in 3.2, add the worst partitions (0.375 + 5 x 0.125, 0.5 + 5 x 0.125) to X08, and re-take the bar there.

### PF2. The reverted-rim fallback is not safe

**Claim under test.** 4.1 step 7: "if the snap breaks validity it is undone to the step-5 mesh and the piece is reported `rimClean = false`"; step 8: "The foot never moves a vertex that lies on a cap plane"; step 9: "A piece never leaves its half-spaces: 0 of 114 pieces overlapped their sibling"; probe L10: "0 vertices across a plane beyond 1e-9 R0, 0 particles inside the sibling deeper than 0.001 R0"; G3: "`rimClean` on at least 99.5 % of regions"; the memo: the snap applied "569 of 569 (d2)".

**Measurement.** `SCR/s5_build.mjs` builds BOTH sides of 905 planes on all 50 species (1810 builds; 699 at detail 2) with PHYS's `buildPiece3` and the searched centre, in four plane families the designers did not use: 1/8 slivers (small side bisected to 0.125 to 0.155), planes through the thin features' tips (ears, horns, tails), planes through the foot, random. Checked per build: vertices across the own half-space, deepest sibling vertex inside the other piece (point-in-mesh by ray parity), exact volume, validity.

| check | result |
|---|---|
| unsound side (`phi` under 0.95) | 0 of 1810 |
| volume `restVolume / (frac V3) - 1` over 1e-9 | 0 of 1810 (held) |
| piece aspect under 0.08 (the `thin` refusal) | 0 of 1810 (minimum 0.172) |
| **rim snap reverted** | **13 of 1810; all 13 at detail 2 = 1.9 % of the 699 detail-2 builds; 7 of 250 (2.8 %) of the small side of a 1/8 sliver plane** |
| **vertices across their own plane** | **8 of 1810 sides** (worst **0.35 R0**; 7 of the 8 are reverted pieces, the 8th is a snapped capnap piece, 6.5e-3 R0) |
| **deepest sibling overlap over 0.001 R0** | **11 sides; 6 over 0.01 R0; worst 0.216 R0 (capnap sliver 0.13)** and 0.084 R0 on its 0.87 sibling |
| tributary mass under 0.01 or over 8 of the mean (G4) | 14 builds (mass down to 8.7e-6) |
| triangle with a minimum angle under 1 degree | 9 builds (0.01 degree at worst: wisplet) |

**Cause, found by switching stages off** (`SCR/s10_dbg.mjs`, five offending planes: capnap x2, caromel, tidelume, hushpuff): with the adaptive foot (step 8) off, `across = 0` in all five; with it on, 5, 5, 3, 7, 1 vertices cross (worst -0.351, -0.164, -0.008, -0.013, -0.003 R0). Turning the volume clamp off makes it worse (6, 15, 6, 11, 5). Step 8 shifts every non-cap vertex vertically (`y = floor` for the lowest ones, `floor + t^2/(2k)` for the shoulder, `y - k/2` above) and has only the "never a vertex ON a cap plane" rule; step 9's half-space clamp is applied to the volume offset only. How far the foot moves things (`SCR/s20_footshift.mjs`, same planes, foot on against off, whole-frame positions): maximum vertex shift **0.60 R0 (capnap), 0.47 (hushpuff), 0.33 (capnap), 0.16 (tidelume), 0.03 (caromel)**, with 89 to 135 of the 162 vertices moved by more than 0.01 R0, and the lowest point of the capnap sliver lifted from -1.156 to -0.557 R0. The floor is "the 8th-lowest vertex", so on a sliver whose bottom is an edge or a point the "foot" is not a 0.035 R0 flat patch as on a whole (`shape.ts:70-76`) but a cut of up to 0.6 R0 off the bottom. Even where it does not cross a plane it changes the silhouette: a plain dollop eighth moves 0.07 R0 with 108 of 162 vertices.

**What the solver does with those pieces** (`SCR/s15_degen.mjs`: the swap-flow rig, 4 s, final contact flags, 7 of the 11 affected species, every reverted piece they produced): no safety reset and no non-finite state, but the small piece creases or loses volume: fold excess over rest **165 (nuzzo), 175 (wisplet), 176 (selenuff)** against the bar 75 (110 for thin slices), volume ratio 0.939 (wisplet) and 0.983 (capnap), peak centre speed 1.53 m/s after 0.2 s (capnap). Masses of the smallest particles: 8.8e-5, 8.7e-6, 3.0e-5 of the mean.

**Fix.** (1) Cap the foot's lift (a foot is the whole's 0.035 R0 patch; when 7 vertices cannot be brought to one floor within, say, 0.05 R0, do not add a foot: that is decision 8, the slice tips) and apply to step 8 the same room clamp as step 9 (a vertex may not move across or within 0.005 R0 of a cap plane; `room = max(0, sd - min(sd, 0.005 R0))`). (2) Add a post-condition at the end of the build (all vertices on the kept side of every cap plane to 1e-12, tributary mass at least 0.02 of the mean, no inverted tetrahedron, volume) and, when it fails, retry once with the foot off, then refuse the plane with the `thin` line rather than ship the piece. (3) Put the 1/8 sliver, foot and feature plane families of `s5_build.mjs` into L10, G3 and C2 on 50 species; the "0 of 114" sample misses this class. (4) Restate G3: the revert rate at detail 2 is 1.9 %, not 0.

### PF3. FIT unions are not a validated build

**Claim under test.** 7.2 rule 1 and 5.7: a touching pair whose union is sound (`phi` at least 0.95) is replaced by "the union of their cells"; "PHYS builds the union exactly like any region"; X14(b), (d) target "at least 90 % of face-contact joins are FITs". 4.1 defines the builder for a region, and its plane handling (steps 6 to 9: cap planes, corner rules, the clamp) is written for convex cells.

**What the prototype does with a union.** `buildPiece3` takes `planesOfUnion(reg)`: every plane of every cell, with BOTH orientations of a shared plane (`+x` from one cell, `-x` from the other). The shared plane is interior over its common face and exposed over the rest, so the cap/rim snap, the corner rule ("a vertex on two cap planes is fixed") and the volume clamp ("keep the kept side of every plane") are wrong for it. PHYS's sweep 5 built no union (`sweep5.mjs` output: "union pieces 0"); E4 built three morph targets ("half + quarter") and judged the morph against the target it had built itself, so a poor target could not show.

**Measurement 1, controlled** (`SCR/s16_union.mjs`, 12 species, searched centre; U1 = half + quarter, the E4 case; U4 = half + the eighth under it; U2 = a convex union that is not a tree node): the rim snap **reverted on 10 of 12 (U1) and 8 of 12 (U4)** with the prototype's plane list; with no planes it never reverts, with the opposite pairs removed it reverts on 12 of 12 (the exposed face is a partial face, no list of whole planes describes it). IoU 0.976 / 0.959 / 0.987: in these simple cases the shape is fine and the rim is not; in the random trees below both fail.

**Measurement 2, random cut trees** (`SCR/s3b_unions.mjs`, one tree per species on 12 species, up to 6 pieces, every pair joined and every join target BUILT with the searched centre and measured; fractions from the cell volumes; 165 pairs):

| join target | n | IoU vs the true region (median / p5 / min) | skin offset R0 (median / p95 / max) | rim reverted | more than 10 non-star triangles | min angle under 3 degrees | build ms (median / p95 / max) |
|---|---|---|---|---|---|---|---|
| sibling (tree node) | 27 | 0.971 / 0.946 / 0.906 | 0.008 / 0.017 / 0.028 | 1 | 0 | 3 | 7 / 451 / 1408 |
| SPAN node (convex group) | 11 | 0.975 / 0.961 / 0.961 | 0.009 / 0.015 / 0.016 | 0 | 0 | 0 | 13 / 62 / 1190 |
| **FIT union** | **72** | **0.842 / 0.673 / 0.416** | **0.055 / 0.185 / 0.968** | **28 (39 %)** | **37** | **25** | 32 / 1613 / 2115 |

51 of the 72 FIT targets have IoU under 0.9, 21 under 0.8, 41 a skin offset over 0.05 R0, 13 over 0.1 R0. Volume stays exact (1e-13) because the secant moves the skin, so the failure is hidden from the volume check. Pair outcomes in my trees: sibling 16 %, FIT 44 %, SPAN-node 7 %, SPAN-to-root 33 % (spec: 15 / 49 / 36). The sound-union test (`phi`, visible share of the volume from one point) does not predict this: all 72 passed it.

**Also for this item.** (a) 66 of the 110 built join targets are detail 2 with `frac` at least 0.35 (up to 0.74): the receiver rule produces big 162-particle bodies; a detail-2 whole behaves like a detail-3 one under the X07 press and rub (`SCR/s7_d2press.mjs`, 16 species: no safety reset, fold excess within the same range as the detail-3 control), so that part is fine. (b) Build time: 24 of 110 targets took over 120 ms and 18 over 400 ms (shared machine; the prototype is allocation-heavy), while the lead the spec gives `prepareRegion` is the ARMED window plus the 0.4 s hold at 3 ms a step (about 40 steps, 120 ms of CPU); the spec's own fallback is a synchronous in-frame build, i.e. exactly the hitch the design wanted to avoid.

**Fix.** Either (A) ship the SAFE subset: a join is a sibling collapse or a SPAN node (convex, IoU 0.97, rim clean, 8 to 60 ms), and every other touching pair also takes SPAN (more "everything comes back" joins: 83 % of my SPANs are the whole squishy, say so to the owner as question 1 option A), or (B) specify and measure the union builder: boundary-plane extraction (only the exposed part of a shared plane is a cap; interior faces are not planes at all), a per-vertex local cap test instead of whole-plane classification, and a quality gate on the BUILT target (IoU at least 0.93, rim clean, no non-star triangle) with fallback to SPAN. Whichever is chosen, replace X14's "at least 90 % FIT" target by a quality bar on the built union, and add union builds to G1 to G7.

### PF4. Reconnect all after five Split-in-two presses has a detail-2 receiver

**Claim under test.** 7.2 rule 4: receiver = "the anchor if it is in the group and is detail 3 (or no member of the group is detail 3)". X10: five presses of Split in two reach six pieces on 50 of 50 species, then Reconnect all. X23: peak centre speed at most 0.3 m/s; X04: morph RMS median at most 0.007 R0 (max 0.021), swap pop median at most 0.03 R0.

**The state.** Five presses give [0.125 x 4, 0.25 x 2] (6.6): every piece is under 0.35, so every piece is detail 2, the group is the whole squishy, and the receiver is the anchor: "the larger child of the last cut of the anchor" (3.5) is a 0.25 or a 0.125 piece. It must grow 4 to 8 times in volume at 162 particles in `JOIN_ALL_S` = 1.2 s and is then swapped for a fresh 642-particle body. PHYS's E4 measured half -> whole (detail 3), quarter + quarter -> half and half + quarter; never a detail-2 receiver growing to the whole.

**Measurement** (`SCR/s12_morph8.mjs`, the E4 method with the patched solver's `morphTo`, 12 species, an eighth (d2) and a quarter (d2) of a vertical/horizontal split morphing to the detail-2 root scaled to the volume, 150 frames, then compared with a fresh detail-3 whole):

| receiver | peak centre speed (m/s) median / max, species over 0.3 | shape RMS to the target, R0, median / max | swap pop (Chamfer to the fresh whole), R0, median / p95 / max | worst absolute fold |
|---|---|---|---|---|
| eighth -> whole | 0.23 / **1.37 (capnap)**; capnap 1.37, chunkle 0.56, boingle 0.42, kneadle 0.37 (4 of 12; crumbit 0.30) | 0.012 / 0.026 (bars 0.007 / 0.021) | **0.046** / 0.068 / 0.100 (bar median 0.03) | 113 |
| quarter -> whole | 0.13 / 0.53 (capnap 0.53, chunkle 0.33) | 0.007 / 0.019 | **0.041** / 0.057 / 0.084 | **169 (capnap)** |

(RMS values are PHYS's receiver-radius numbers converted to R0 by cbrt(frac): the E4 table divides by `b.restRadius`.) No safety reset, volume reaches 0.996 to 1.002 of the target, the body is at rest within 16 mm/s at the end, yaw at the swap under 4 degrees.

**Fix.** For a group of 0.35 or more with no detail-3 member, do not morph a 162-particle body: (a) make the receiver the LARGEST member, not the anchor, and (b) rebuild it at detail 3 at the start of the join (a cache hit for the target, an event like the swap), or seed a fresh detail-3 root from the receiver's particle state (the swap fallback PHYS already measured, 0.02 R0 median). Re-run X04/X23 on the eighth/quarter -> whole cases and add them to the matrix.

---

## 3. MINOR findings

**PF5. Split-in-two tolerance (6.6, 5.6).** `'median'` is "bisect ... until fa = 0.5 to 1e-5" and then "both parts equal `target.frac / 2`", but `canSplit` is false below `2 PIECE_MIN - 1e-6` = 0.249999. A 0.25 piece made by halving a 0.5 piece is 0.25 +- 5e-6 when the bisection stops at the first iterate under 1e-5. Simulation (`SCR/s17_split_tol.mjs`, 20 000 five-press runs, smooth monotone `fa(d)`): **691 (3.5 %) refuse the fifth press** with the stop rule as written, 0 with the full 40-step bisection or a 1e-7 stop. X10 ("five presses reach six on 50 of 50") then depends on a loop the spec did not pin. Fix: bisect to 1e-9 (the 40 steps), and use `PIECE_TOL` (1e-4) in `canSplit` exactly as the `small` refusal does.

**PF6. A tilted-plane neck still moves the whole body; X13 cannot see it.** 5.1 and 5.4 say centring the neck goal removes "the neck swell and the whole-body rise". `SCR/s8_neckvel.mjs` (patched solver, `centreGB` on, per-family depth and `NECK_S`, 3 planes x 50 species) reads the lobe means that `planCut(..., 'latched')` would pass as `velA`/`velB`: x-planes COM speed 0 of 50 over 0.5 m/s, level planes 3 of 50, **tilted planes 10 of 50**; lobe speed median 0.13, p95 0.64, **max 2.22 m/s**. `SCR/s8b_neckcom.mjs` traces chunkle and cindergoo: with `centreGB` on the COM reaches 1.56 / 1.32 m/s and the body moves (-0.11, +0.05, -0.16) / (-0.17, +0.04, -0.15) m in 0.3 s; off, 1.64 / 1.64 m/s. So on these two species centring helps by only 5 and 20 %; another term (the non-mass-weighted Laplacian pass on a strongly necked goal, or the table contact) carries the momentum. `SCR/s13_birthvel.mjs` runs the real swap: neck, read pose and lobe velocities, build and place the halves with them, then the X13 rig: vertical and level planes pass every bar; tilted planes (normal 0.6, 0.64, 0.48) on 7 species: birth speed up to 2.2 m/s, peak speed after 0.2 s up to 1.17 m/s (bar 1.2), 1 s later up to 0.34 (bar 0.3), displacement over 0.10 m on 8 of 14 pieces (0.13 to 0.35 m; bar 0.10; the "sloped face" exemption covers sliding, not a pair that was already travelling). No rise (at most 5 mm), no safety reset. Fix: hold the parent with `moveTo` at its current centre during the neck (the parting already uses it), give the children `vel = lobe mean - parent COM velocity`, and run X13/L9 with the real birth velocities. Correct 5.1's sentence.

**PF7. How a thin slice really rests (decision 8, rule 11, 1).** The spec says a slice cut off the side "may tip onto its curved side". `SCR/s9_pose.mjs` (swap-flow rig, side cuts at x 0.5, x 0.3 and z 0.4 R0, 7 species, 12 distinct slices of 0.14 to 0.28): none lies on its side. Final tilt of the frame from upright **1.3 to 26.9 degrees**, **3 to 5 particles on the table** for 10 of the 12 (the putty puddlo: 8 and 23), centre **1 to 13 cm below** its rest-pose height (plumpet 0.14 slice: 27 degrees, 13 cm lower; twangle 0.2 slice: 10 cm lower), speed under 0.04 m/s except putty (0.09 to 0.17 m/s, still creeping at 5 s). Mechanism in the code: `supp = smooth01((near - 1) / 4)` (softbody.ts:2290) removes gravity once 5 particles are within 1 cm of the table and gives 16 to 50 % of it at 3 or 4, and the weeble torque (`kUp = 40`, :2640) pulls the frame back toward the rest +y, so the slice stays propped on its rim, drooped. It is stable and at rest, so X13 passes it; it is not the "natural pose" of section 1. Fix: say so in 1 and 5.2, or accept/test a "lies down" rule (drop `kUp` for a body with fewer than 5 contact particles).

**PF8. Nested skin offset (4.3).** "they differ by the parent's re-mesh error (at most 1.5 %) and step 9 removes it (under 0.005 R0 of skin offset)". PHYS's own `out/s5b.jsonl` (560 nested pieces, all detail 2): |delta| median **0.0108**, p95 **0.0314**, max **0.1522 R0** (knubby 0.133, four cap planes), 46 % over the single-plane maximum 0.0118. My single-plane detail-2 builds: median 0.0054, p95 0.0175, max 0.0773 (the spec's 0.0213). A 0.15 R0 offset on a piece whose own radius is 0.5 R0 is a bulge, and it is what makes the nested IoU 0.86. Fix: restate 4.3 with these numbers; bound `|delta|` (say 0.05 R0) as a build post-condition with the PF2 fallback.

**PF9. L9 coverage (13.2).** L9: "50 species x 3 random trees ... 0 of 36 launched". The run behind it (`chain13.sh`, `nfinal`) used 12 species (36 sequences). I ran the same `e3s_sequential.mjs` with the same final flags on 14 of the other 38 species before stopping (`SCR/nested38.txt`, 42 sequences, 3 per species: plumpet, glugbean, munchip, cushlet, thumbly, nuzzo, tadpolo, swishel, granulo, sproutle, acornel, knubby, hooplet, spirelo): no launch (max upward speed 0.44 m/s, max rise 27 mm, spirelo), but fold excess **163 degrees (swishel trial 1), 88, 87 (sproutle), 81 (spirelo), 79 (cushlet)** against X07's 75: 5 of 42 sequences; PHYS's 36 peaked at 86. The "same twice true" in the log is trivially true with `NODET=1`. Fix: run the 50 x 3 the row names and either explain the 163 or add it to the named exceptions.

**PF10. X13's "every failure is one of the named categories".** Re-graded `phys/out/e1final2.jsonl` (586 pieces) with the spec's own rows: 558 pass (95.2 %, the spec says 87 %, so the designers were conservative), 28 fail. Not covered by "a piece falling from its built height, a thin slice tipping, a sloped face sliding": level (|n.y| >= 0.75) upper caps that slid 10 to 14 cm off their lower piece (tadpolo, knubby, burrbin, rattlebead, somnuff, prismelo, caromel, ambrosel; bar 0.10), pieces still moving at 0.31 to 0.48 m/s one second after the landing (petalop, tidelume, ambrosel; both the 0.24 caps and the 0.76 lower pieces; bar 0.3), caromel stacked tilted pieces penetrating 0.18 to 0.21 R (bar 0.15), marigel's 0.80 piece with fold excess 95. Fix: name the categories honestly or fix the rows.

**PF11. Where `loose` bites.** 7 500 random camera-plane swipes (normal in the screen plane, pitch 0.27) and 7 500 uniform planes (150 per species), both sides >= 1/8 (`SCR/s1_sound.mjs`): unsound regions only on munchip (2 of 150 uniform), selenuff (3 of 150 camera, 5 of 150 uniform), ambrosel (1 of 150), the three species the designers found. `SCR/s2_band.mjs` sweeps 8 swipe angles x offset -0.95..0.95 R0 step 0.025 on all 50: 19 522 eligible offsets, 21 refused, **all selenuff: 7 of 48-50 eligible offsets (14 %) of every near-horizontal swipe at +0.375 to +0.55 R0**, i.e. the natural "cut the head off". The spec's 0.14 % is a grid average. Say it in 4.4 / owner question 1; "cut both ears off" is refused on three species (6 %).

**PF12. `planCut` soundness has no budget (5.6, X20).** X20 bounds the swap frame, the 3 ms `prepareCut` slice and the build, not `planCut`, which the shell calls in the swipe frame. Per nested cut `planCut` must classify every crossed leaf (500 directions per cell) and test every NEW cell and both children for soundness (360 directions each, up to 190 evaluations x 360 rays if the centroid sees under 0.97): 5 000 to 75 000 ray queries. `SCR/s14_timing.mjs` (prototype, shared machine): first-cut soundness of both children p50 15.6 ms, p95 892 ms; nested `planCut` work **p50 316 ms, p95 2.6 s, max 18.8 s** over 46 cuts. Order of magnitude only, but the port needs the same slicing as `prepareCut`, or `sound` must be computed in `prepareCut` and `planCut` must return a provisional answer. Fix: add `planCut` to X20 with a bar and a count of ray queries.

**PF13. Leaves.** CUT2 3.3 "the tree never holds more than 64 leaves" (X18 "cells <= 64", `CutPlan.cellFa` preallocated 64); the SHELL memo adds "cannot be hit with 6 pieces because joins collapse siblings (tested with 100 000 random operations)". FIT joins of non-siblings keep both leaf sets, and a cut splits every leaf it crosses. Pure tree simulation with `cutPiece`/`joinPieces`/`group`/`touches` exactly as defined (`SCR/s4_leaves.mjs`, `s4b_leaves.mjs`; the free choices are the crossing probability q and the share pFit of touching unions that are sound): with the measured pFit 0.64 and q 0.8, 19 of 40 runs pass 64 leaves within 30 000 operations (median first at op 11 482, earliest 506); with pFit 1, 6 of 6 reach 400+ (one piece with 286 leaves). Geometry makes this rare, but the property is a hope, not a theorem. Fix: define the overflow (refuse the cut with `limit`, or normalise by SPAN-ing the largest group) and assert it in X18.

**PF14. Determinism of the swap time (6.3, X22).** `prepareCut(budgetMs)` runs "as many stages as fit in the budget" and the swap waits for `plan2.built`, extending the hold up to 0.15 s; the frame at which the build completes therefore depends on wall-clock speed, so two runs of a scripted session can swap on different frames and `stateHash` differs. Fix: budget by stage count (N stages per call) in node/test mode, ms only as a cap.

**PF15. Re-merge identity (4.5, M1).** "Identical inputs return the SAME arrays, so a re-merge returns the identical rest shape" is true for an equal key (planes, detail). A sibling join of two detail-2 children (receiver rule: all members detail 2) is built at detail 2; the parent was built at detail 3 if its fraction was 0.35 or more. In my trees the sibling targets of 0.36 to 0.41 were detail-2 builds (IoU 0.97, fine) but they are not the parent's mesh. Fix: key the root-of-subtree case on the parent's detail, or drop the claim.

**PF16. Bundle.** X24: "bundle <= 1229 KB (1143 at SHELL-4; report the delta)". The PHYS prototype builder (piece3 + region + grid + geom + centre, exploratory code included) bundles and minifies to **25.2 KB (10.3 KB gzip)** with rolldown (`SCR/size_entry.mjs`); that is without `planCut`, `prepareCut`, `joinable`, `setRegion`/`adoptRest`, the four `collide` changes, the shell's `cutRegion`, the render's `PieceBuild`, cap shader, 12 `CAP_LOOKS`, eye clipping. STATUS already says the 1229 KB gate "will not hold UI + pets". Fix: give each lane a byte budget before building; consider lazy-loading `piece.ts` / `region.ts` (the Cut tool is opt-in).

**PF17. Small contract gaps.** (a) `placeAt(at, vel, frame)` is "before its first step ... exactly" but `homeX`/`homeZ` (the point `matCorral` glides a piece back to when it is more than 0.6 m away, and `reset()`'s drop point; softbody.ts:784, :1609-1618) are set only in the constructor from `piece.at`; a pre-built piece placed later keeps the build-time home. State that `placeAt` re-homes. (b) The classifier `cellFa` (< 0.01 / > 0.99) sends a leaf whole to one side although the plane clips up to 1 % of it; the clipped sliver stays on the wrong side of the cut face (a step in an otherwise flat face). It never triggered in the 46 single-leaf cuts I ran (a multi-leaf piece only exists after a FIT join), so unquantified; use the exact clip, not a classifier, to decide, or set eps to 0.

---

## 4. What held up (re-measured, confirmed)

* **Soundness of single planes** (4.4, C2): 7 500 camera planes, 7 500 uniform planes (15 000 regions each) and the 19 522 offsets of the band scan: only the three known species are ever refused; 0 unsound regions anywhere else (`s1_cam.jsonl`, `s1_sph.jsonl`, `s2_band.jsonl`).
* **Exact volume** (2 rule 3): 1810 single-plane builds and 26 nested children, `|restVolume / (frac V3) - 1|` under 1e-9 in all; with the fraction taken from the clip of the PARENT'S BUILT MESH (what the shell does) the mismatch between mesh share and cell share of the same split was p50 0.14 %, max 0.80 % of the parent and p50 0.30 %, p95 1.0 %, **max 3.0 %** of the child (`s3_tree.jsonl`, 3 trees, 13 cuts; the spec says at most 1.5 %): the 4.3 mechanism works, with a wider tail.
* **No thin pieces** : minimum aspect over 1810 builds 0.172 (the `thin` refusal at 0.08 is never needed); no flipped tetrahedron anywhere.
* **Launch** : PHYS's `e1final2.jsonl` re-graded: 95.2 % of 586 pieces pass the X13 rows with the spec's categories; no rise over 17 mm, no safety reset; nested sequences on 14 more species: max upward speed 0.44 m/s.
* **Float mode** (gravity off, the G key; the hover spring pulls every body to the world origin): two flush halves and six pieces (`s11_float.mjs`, `s11b_float6.mjs`): the CUT2 contact is better than the shipped one (deepest interpenetration over the last second 0.000 R against 0.65 R shipped for the same six pieces).
* **Detail-2 near-whole bodies** (`s7_d2press.mjs`, 16 species): no safety reset, press/rub fold excess in the same range as the detail-3 control; so "a merged piece keeps its receiver's detail" does not make a big body crease.
* **Whole-body hinge limit** (5.3): the largest rest dihedral of the detail-3 whole is 55 degrees on all 50 species (`s18_restdih.mjs`), so `lim_h` stays exactly 110 for wholes. (At detail 2 five species reach 81 to 97 degrees, which only matters for pieces.)
* **Tree algebra**: `joinLeaves`, `group`, `touches` terminate and end at the root in all my trees; SPAN nodes and sibling collapses build cleanly (IoU 0.97, 1 revert in 38); 83 % of my SPAN groups are the whole squishy (spec 79 %).
* **Shipped-code line references** in appendix A of the spec: all 12 groups I opened match.

## 5. What I did not check

The port (nothing of CUT2 is in `src/`); the real `adoptRest` constructor refactor (K7); GPU cost, the cap shader, eye clipping, any render claim; the shell's intent machine; audio; Hoard/economy; X21 bit-identity of whole bodies (needs the port); a phone-class CPU (build times scale 3 to 5 times); a Web Worker; nested sequences for 24 of the 38 species PHYS skipped; more than 12 join-target trees; any timing on an idle machine.

## 6. Reproduction (every command from `games/wobblehoard`)

| item | command |
|---|---|
| PF1 | `node SCR/s6_perf.mjs dollop` (and kneadle, twangle) |
| PF2 | `node SCR/s5_build.mjs out.jsonl "" 5` then `node SCR/a_s5build.mjs out.jsonl`; causes: `node SCR/s10_dbg.mjs '[{"id":"capnap","n":[0.667,0.718,-0.199],"d":-0.527,"side":-1}]'`; solver: `node SCR/s15_degen.mjs <SCR>/../phys/proto capnap,caromel,tidelume,hushpuff,nuzzo,wisplet,selenuff` |
| PF3 | `node SCR/s16_union.mjs`; `node SCR/s3b_unions.mjs out.jsonl "" 1` then `node SCR/a_s3b.mjs out.jsonl` |
| PF4 | `node SCR/s12_morph8.mjs <phys>/proto` |
| PF5 | `node SCR/s17_split_tol.mjs` |
| PF6 | `node SCR/s8_neckvel.mjs <phys>/proto "" out.json`; `node SCR/s8b_neckcom.mjs <phys>/proto chunkle t`; `node SCR/s13_birthvel.mjs <phys>/proto chunkle,cindergoo,glimglop,munchip,twangle,marigel,dollop t,x,y` |
| PF7 | `node SCR/s9_pose.mjs <phys>/proto out.jsonl twangle,kneadle,capnap,boingle,puddlo,petalop x.5` |
| PF9 | `NODET=1 TRIC=1 RIGIDREF=12 RAMP=1.0 RVERT=1 PUSHCAP=1 RIGIDCAP=1 node <phys>/e3s_sequential.mjs <phys>/proto <species> 3` |
| PF10 | `node SCR/a_e1b.mjs <phys>/out/e1final2.jsonl` |
| PF11 | `node SCR/s1_sound.mjs out.jsonl "" 150 cam`; `node SCR/s2_band.mjs out.jsonl` |
| PF12 | `node SCR/s14_timing.mjs` |
| PF13 | `node SCR/s4b_leaves.mjs` |

`<phys>` = `.../scratchpad/truecut/phys` (the designers' scripts, unchanged).
