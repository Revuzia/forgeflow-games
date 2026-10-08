# CUT_A RENDER running report (lane RENDER; task R1, then R1 part 2). Keep under 10 KB.

## Leg 2 (render-1): R1 PART 1. STATUS: code + node checks done; browser rows in progress (see the end of this file for what is measured)

### Files (all mine)
- `src/render/pieceBuild.ts` (new, pure): `buildPieceMesh(restLocal, indices, PieceInfo, n)` = cap classification (a vertex is on plane k within 1e-6 R0; a sim triangle is `cap k` iff all 3 vertices are),
  the I2 check (`rimClean`: cap = whole triangles with a simple boundary loop, no stray on-plane vertex or edge), the n x n subdivision with the class split (cap planes first, skin last, rim vertices
  welded per class, `twin` skin->cap), the attributes `aCap (k, rim)`, `aCapP`, `aCapD` (8 x 8 thickness grid), `aRest = normalize(P_W - m_W)`; `pieceFineN` (8.2 size formula); `degraded` fallback (majority class).
- `src/render/jelly.ts`: piece path in `rebuild`/`update` (`updatePiece`: skin normals from skin triangles only, one normal set per cap from its own triangles, two relax passes each, rim twin takes the cap
  position, `caps[k]` centroid/normal/d per frame, dent radius 0.45 x whole radius), `rimClean`/`degraded`/`pb`; a WHOLE binds zero-filled `aCap/aCapP/aCapD` (own BufferAttribute over one shared array); the
  piece path is entered only for `body.piece` with >= 1 plane, and `body.piece` is compared by reference every frame (a merge's new PieceInfo rebuilds once). Whole path untouched.
- `src/render/material.ts`: ONE cut-face look (uniforms `uCapRough/Coat/Tint/Depth/Glow` from `capLookOf(look)`: roughness+coat mix toward the family's values, paler interior on opaque families, thickness from
  `aCapD`, rim catch `pow(vCap.y,3)*0.5`, skin grain and seam band off on a face, low tier alpha +0.1), cap code always compiled and inert for a whole (`jCap = vCap.x > 0.5`), program key `wh-jelly-v5`.
- `src/render/bodyproxy.ts`: `piece`, `morphT`, `meanEdge`, `frac` pass-through getters.
- `src/render/bodyview.ts`: `isPiece` (body.piece with a plane); `scale = whole.radius / 0.5`; no `setFrac` growth for a piece; eyes (face hidden) and ember blob (core group hidden) off until part 2; `chunk` honoured only for a body without `piece`.
- `src/render/face.ts`: `centreOut` (world eye centres) + DEV-only `visibleEyes` / `visibleMask` (behind `import.meta.env.DEV`). `src/render/stage.ts`: DEV-only `eyeCentres(viewId)`.
- `src/render/stubBody.ts`: `RestProvider` (injected real rest geometry), `piece`/`meanEdge`/`morphT` on the stub, exact placement (`at.y`) for region pieces. The old analytic stub and the chunk path are unchanged.
- `_harness/renderview/physPieces.ts` (new): PHYS's PURE builder (`CutJob`, `buildPiece`) behind `RestProvider` (reads `src/physics/piece.ts`, edits nothing). `_harness/renderview/piece_checks.ts` (new, node).
- DECISION: no separate dev `clipRest()` was written. Task text allows "a dev clipRest stub OR PHYS's pure builder once it exists"; `src/physics/piece.ts` exists, so the stub uses the real builder through the injection (one source of truth, real species, 50-species sweeps possible).

### Measured (node, `node _harness/renderview/piece_checks.ts`, 8 species x 8 planes + 8 nested cuts = 64 cuts, 144 pieces, 0 refused)
- rimClean (my I2 test on the sim mesh) 143 of 144 (99.3 %); the one dirty piece (ambrosel nested A.A, 3 stray on-plane things) takes the `degraded` fallback and still builds.
- cap fine vertices off their plane: max 5.6e-8 R0 (bar 1e-6). Index buffer open ONLY along the crease: 0 open edges off the rim; no non-manifold edge; no degenerate fine triangle; rim twins at gap 0; winding outward on all.
- aRest = normalize(P_W - m_W) to 5e-8; continuity vs the ORIGINAL whole (nearest point): median 0.0006, p95 0.0067, max 0.0159, 4.0 % of samples over the 0.008 bar. CAUSE is PHYS's mesh (G3: piece skin sits 0.006 .. 0.02 R0 off the original, capnap worst), not PieceBuild: row printed KNWN, not loosened.
- PieceBuild cost (once per piece): high median 2.3 ms / p95 11 ms; med 1.8 / 8; low 1.5 / 4. Fine vertices / (N_tier frac^(2/3)): high 0.91 median (max 1.22); low tier floor n >= 2 gives 1.5 at detail 3 (spec: 0.74-1.0 of a high-tier body at 4 pieces).
