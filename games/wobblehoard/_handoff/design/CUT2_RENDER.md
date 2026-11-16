# CUT2, RENDER lens: how the stage draws a TRUE cut

Date 2026-10-08. Lens: RENDER (`src/render`). Status: DESIGN ONLY. Nothing under `src/`, `_harness/`, `_spec/`, `public/` was edited; the
only files written are this memo and my scratch scripts (listed in section 12). Every statement about the current code carries a
`path:line` read in this session; every number says how it was measured.

The owner's request (2026-10-08): "when I SPLIT, it just takes out a little ball and the squishy itself splits ... I wanted a REAL cut,
like if I cut a squishy in half, one eye is on one side and one is on the other. Clean cuts, not a little ball/piece."

---------------------------------------------------------------------------------------------------------------------------------

## 0. The design in one page

A piece is the real part of the squishy on its side of the plane. The render lane draws it from four things the body already owns or
will own: its rest mesh (`restLocal`, `indices`), a small additive record `SoftBodyLike.piece` (`PieceInfo`: where this piece sits in the
WHOLE squishy's rest space, and which cut planes bound it), the live sim positions, and the genome. Everything position-bound (eyes, the
core, glitter, constellation stars, pattern coordinates, cut-face noise) is defined once in the WHOLE's rest space and then handed to the
piece that contains it, so putting the pieces back together puts the image back together.

| # | Decision | Why (one line; evidence in the section named) |
|---|---|---|
| D1 | `chunk` stops meaning anything for a body that has `piece`. Faces, glitter, stars, core and patterns come from geometry, not from a flag. The old flag stays accepted for bodies without `piece` (nothing breaks). | s8 |
| D2 | New optional `SoftBodyLike.piece?: PieceInfo` carries `{ whole, offset, rayOrigin, cells }`; no `AddBodyOpts` change is needed (an optional `piece` hint is added only for stage grouping). | s2 |
| D3 | A piece's FINE mesh is built by subdividing the sim triangles n x n (no ray casting), and the cut face is its own set of fine triangles with its own normals. The geodesic mesh used today cannot make a clean edge (measured chamfer 0.07-0.08 R0, up to 0.175 R0). | s3, s12 S5 |
| D4 | PHYS must hand over a rest mesh with an exact flat face whose rim is an edge loop lying on both the plane and the silhouette (rim snapping). Plain radial clipping leaves 70-90 straddling triangles with a 0.08 R0 bevel per cut. | s2.2, s12 S2 |
| D5 | Eyes: each eye is kept by every piece that holds at least 12% of its width, clipped exactly at the cut face (a half eye on each side), hidden where less remains. Measured: an eye is within reach of a random swipe plane in 46% of cuts. | s4.3, s12 S3 |
| D6 | A piece with no eye gets no Face object (no blink, no mood, zero draw calls). That is the common case: 79% of random cuts leave one piece without an eye. It stays good-looking through core share, glitter, pattern, rim light, cap cross-section, tier FX. | s4.4 |
| D7 | The core (inner ember) is a sphere in whole-rest space: each piece draws the part on its side (clipped), and the cut face shows the ember's cross-section as a soft glowing disc. A piece without ember keeps a 0.35 ambient floor. | s4.5, s5.4 |
| D8 | Cut-face look is data, per family (12 rows), procedural only: window / satin / matte / porous / bead. One shader program for wholes and pieces (no first-cut compile hitch). | s5 |
| D9 | The cut face does not round over. Cut faces stay flat (the piece is a real part); only a short "fresh cut" warm sheen (tau 0.45 s) fades. This also designs out the chunk launch (s8.3). | s5.5, s8.3 |
| D10 | Per-piece fine resolution scales with the piece (n = max(2, floor(sqrt(2 N_tier frac^(2/3) / T) + 0.35))): all partitions into <= 6 pieces stay <= 1.92x one whole body's fine vertices at med/high (<= 2.5x at low, max 4 pieces); settled pieces skip their per-frame mesh update. The fixed sim-normal cost (0.45 ms per 1280-triangle body, measured) means six MOVING pieces only match two whole bodies (x1.0 model), so the idle skip is required, not optional. | s3.3, s3.4, s12 S8, S10 |
| D11 | Tier world effects (dome, pillar, orbiting motes, table caustic ring) belong to the group: drawn once, on the largest piece, sized to the group's union; per-piece effects (aura, pool, shadow, glitter, stars, iridescence) stay per piece. | s7.3 |
| D12 | Merge of pieces that were not cut apart from each other: the merged piece is the union of cells if they share a cut face and the union is star-shaped from its centroid; otherwise the lowest common ancestor cell of the cut tree (everything under it joins). Always a valid body; the last merge is the root = the fresh whole. | s8.4 |
| D13 | Because the swipe plane contains the camera, a fresh cut face is seen exactly edge-on. Optional non-calm render-owned "peek": ease camera yaw <= 8 degrees toward the face for ~1 s. | s6.4 |
| D14 | The shell must stop calling `stage.setBody` for a cut (it rebuilds every other piece's view: `bodies.ts:112-115`). | s8.5 |

Cost summary: about 13.5 engineer-days for the render lane (section 11).

---------------------------------------------------------------------------------------------------------------------------------

## 1. What the render lane does today (verified)

### 1.1 The face is two eyes and nothing else
* `src/render/face.ts:10` states the whole face: "two glossy ink-dark bead eyes ... no mouth". The only feature meshes are, per eye, a dome
  and a squint arc (`face.ts:152-165`, `face.ts:119-120`). I grepped `src/render` and `src/core` for mouth, cheek, brow, blush, freckle,
  whisker, accessor, nose, tongue: the only hits are the unrelated "pressure blush" shader term (`material.ts:8,186-188`), two comments in
  `capsule.ts:235,326` that say a lingering shell once READ as a mouth, and `face.ts:10` itself. There are no cheeks, brows, mouth or accessories to
  assign. The genome has only `eyeStyle, eyeSpacing, eyeSize, eyeHeight` for the face (`src/core/genome.ts:42-45`).
* Eye placement is a function of the whole: `radius = restRadius * (0.095 + 0.07 eyeSize)` (`face.ts:105`), elevation
  `(3 + 26 eyeHeight)` degrees, azimuth `max((9 + 17 eyeSpacing) deg, azMin)` with `azMin` chosen so big eyes never touch (`face.ts:122-125`), the
  direction cast against the REST mesh from its vertex mean (`face.ts:161-163`, `jelly.ts:30-53`, `jelly.ts:56-107`), plus four footprint samples
  east/west/north/south (`face.ts:174-193`). Every frame the bead is fitted to those five samples on the live mesh (`face.ts:221-255`).
* Blink, squint and widen are one state shared by both eyes (`face.ts:200-219`); the look-at is computed per eye from the pointer
  (`face.ts:257-282`).

### 1.2 Everything else that is bound to a place on the body
| thing | where | how it is anchored today |
|---|---|---|
| core ember blob + halo | `core.ts:140-159` | at `body.center` (`core.ts:141-147`), radius `0.17 * scale * coreSize` (`core.ts:82,146`) |
| core glow on the skin | `material.ts:206-231` | analytic halo from `uCoreWorld` (`bodyview.ts:193`) |
| suspended glitter specks | `fx.ts:230-243`, `fx.ts:270-293` | rest direction -> sim triangle + barycentric + radius fraction `f` toward `body.center` (`fx.ts:285-287`) |
| Mythic constellation stars + links | `rarity.ts:263-297`, `rarity.ts:363-385` | same scheme, `f` 0.35-0.75 |
| patterns (speckle / swirl / bands), Epic two-tone, Legendary aurora, Mythic thin film | `material.ts:161-193`, `material.ts:233-248` | functions of the vertex attribute `aRest` = the fine vertex's unit direction (`jelly.ts:270`, `material.ts:98-111`) |
| tier aura / dome / pillar / motes / satellites | `rarity.ts:303-360` | world space, around `body.center` and the footprint |
| light pool, shadow, Epic+ caustic ring | `decals.ts:127-155` | per body, from the jelly's min/max extents (`bodyview.ts:195-198`) |
| bubbles / dust puffs | `fx.ts:101-113`, `fx.ts:420-445` | transient, spawned at touch points |

### 1.3 What `chunk` does
`AddBodyOpts.chunk` (`contracts.ts:299-302`) -> `BodyView` hides the face group and the rarity group and skips `face.update`
(`bodyview.ts:120`, `bodyview.ts:211`). The shell passes it for every piece except the face piece (`bodies.ts:108`) and builds the face piece with the
whole shrunk by cbrt(frac) (`softbody.ts:283-292`). Because the eyes' radius reads `body.restRadius` (`face.ts:105`), a shrunken face piece also
had shrunken eyes.

### 1.4 How a view's fine mesh is made today
`JellyView.rebuild` builds a geodesic sphere of frequency 32 / 24 / 16 (`quality.ts:21-23`; 10242 / 5762 / 2562 vertices) and maps EVERY fine vertex
to a sim triangle by casting its direction from the vertex mean against the rest mesh (`jelly.ts:247-258`, `RestMapper.locate`, `jelly.ts:56-107`).
Each frame `update()` places each fine vertex by Phong tessellation (`jelly.ts:114-139,146-170`) using sim normals that are area-weighted and then
relaxed twice (`jelly.ts:173-209`, `jelly.ts:284-286`): this deliberately rounds every crease. The geodesic is rebuilt for every view even though it
depends only on the frequency (`jelly.ts:248`).

### 1.5 The cut moment, as the shell drives it
`cut.ts:315-359`: the cut body is replaced by two pieces; the face piece goes through `bodies.swapTo` = `stage.setBody` (`bodies.ts:110-115`), and
`commit` then re-adds EVERY extra (`for (const x of extras) showExtra(x)`, `bodies.ts:115`) so each existing piece's `BodyView` and `JellyView` is
rebuilt on every cut. A swipe plane is `{ point: camera position, normal: cross(ray0, ray1) }` (`cut.ts:503-505`); Split in two is the vertical
plane through the camera and the piece's centre (`cut.ts:529-537`). Both contain the camera: **a fresh cut face is seen exactly edge-on** from the
camera that made the cut (section 6.4).

---------------------------------------------------------------------------------------------------------------------------------

## 2. The PHYS <-> RENDER contract

### 2.1 Additive, optional, in `src/contracts.ts` (marked `CUT2`)

```ts
/** One bounding plane of a cell. WHOLE-rest coordinates (the uncut squishy's restLocal frame, centred on its centre of mass).
 *  The piece lies where dot(n, p) <= d. n is a UNIT vector pointing OUT of the piece. `id` is one number per cut: the two faces a cut makes
 *  carry the same id with opposite n / d (this is how the stage knows which two faces were one). */
export interface CutPlaneRest { n: V3; d: number; id: number }

/** What a TRUE piece of a cut squishy is. Absent on a whole squishy (and on a piece with no cuts: cells = [[]]). */
export interface PieceInfo {
  /** The uncut squishy's rest mesh at detail 3 (Float32 / Uint32, read-only), the SAME array objects for every piece of one squishy
   *  (pieces of a squishy are grouped by this identity). `radius` = its restRadius (R0). */
  readonly whole: { readonly restLocal: Float32Array; readonly indices: Uint32Array; readonly radius: number };
  /** restLocal_piece[i] = (the same material point in the whole's rest space) - offset. Composes for nested cuts. */
  readonly offset: V3;
  /** PIECE coordinates: the centre the piece's rest mesh was re-meshed radially from; the mesh is star-shaped about it (a ray from it meets the skin once). */
  readonly rayOrigin: V3;
  /** The piece is the union of these convex cells; each cell is the intersection of its planes. A fresh piece has one cell. */
  readonly cells: ReadonlyArray<ReadonlyArray<CutPlaneRest>>;
}
// SoftBodyLike:   readonly piece?: PieceInfo;        // CUT2 (SoftBody and StubBody fill it for pieces; absent = a whole squishy)
// AddBodyOpts:    piece?: boolean;                   // CUT2 hint only (the stage infers it from body.piece); chunk? stays, see D1
```

`frac` (already optional, `contracts.ts:158-159`) becomes the TRUE volume fraction of the piece.

### 2.2 What the render lane relies on in the rest mesh (invariants for PHYS, R1-R7)
* **R1** closed triangle mesh, outward winding, today's icosphere topology (642 vertices, or 162 under 0.35), star-shaped about `rayOrigin`;
  `restLocal` centred on the MASS-WEIGHTED centroid (|mean| <= 1e-6 R0).
* **R2 exact flat face with a clean rim.** Every sim vertex of a cut face lies on its plane (<= 1e-6 R0). The cap region is a union of WHOLE
  triangles, and its boundary (the rim) is an edge loop of vertices that lie on BOTH the plane and the silhouette ("rim snapping": cap-boundary vertices
  slid outward IN the plane until they hit the skin). Why this is a requirement, not a nicety (my prototype, section 12 S2, 642-vertex mesh, species
  plumpet / dollop / twangle / wisplet / puddlo, centre / tilted / edge planes):
  | | plain radial clip `r = min(r_skin, r_plane)` | with rim snapping |
  |---|---|---|
  | triangles that mix face vertices and skin vertices | 70-90 per cut | 0 |
  | bevel height of those triangles | mean 0.076-0.093 R0, max 0.134-0.192 R0 | 0 |
  | cap vertices / rim vertices | 113-255 / 33-44 | same |
  | mesh volume / exact clipped volume | 0.940-0.986 | 0.986-0.994 |
  A 0.09 R0 chamfer is ~22 px on a 250 px body: it reads as a rounded edge, which is exactly what the owner does not want.
* **R3 no sliver faces.** After snapping, cap triangles must keep a minimum angle >= 15 degrees. Measured right after snapping: 8.7-15.7 degrees on the seven
  centre / high / edge cuts and 2.7 degrees for the 30 degree oblique plane; 12 in-plane Laplacian passes on the cap-INTERIOR vertices (rim fixed) give 21-36 degrees on
  every case except the oblique one (2.7 degrees remained: a triangle with two rim vertices and one interior vertex, so the rim spacing itself needs a rule). PHYS owns this; render copes with
  slivers visually (flat shading) but PHYS's solver may not.
* **R4 particles, goal and edge rest lengths agree at t = 0** (no `FLAT` goal, no `flatK`). See section 8.3: this is the chunk-launch cause.
* **R5** `piece.whole` arrays are shared by identity; `frac` is the true volume fraction; the cap planes' `id`s are stable for the life of the cut.
* **R6 pieces are born flush, in the whole's current pose where possible.** Preferred: each piece's particles (and velocities) are initialised from the deformed whole at the material point they represent. Minimum (the SHELL memo's
  rigid placement: the parent's frame, a centre `at`, the lobe's velocity, `CUT2_SHELL.md` 5.2.1): the pieces' cut faces lie on the plane, gap 0. A parent that is still wobbling then pops by its deformation at that instant; that pop is
  bounded and measured by the SHELL memo's N10 (Chamfer <= 0.08 R0) and by my swap luma step (P6). (The Cut tool pauses the other gestures and releases the fingers at the swap, so the parent is normally near rest.)
* **R7 a merge changes `piece` by identity.** When a body's region changes (a join), PHYS first updates `restLocal` / `indices` in place and then publishes a NEW immutable `PieceInfo` object in the same step (the old one stays valid). The view compares
  `inner.piece` by reference each frame; on a change it rebuilds its piece mesh, features and cut-face classification once (~8 ms, budget P9), keeping its view id, clock and face state. Until then the old classification stands, which is right
  during a join: the cut face about to disappear stays a cut face until the giver has flowed into it.
* A body with `piece` undefined, or `cells = [[]]`, takes today's code path unchanged (bit-identical whole-body rendering; the harness has many
  thresholds tuned on it).

### 2.3 What the render derives itself (so PHYS does not have to emit it)
* Which sim vertices are on cut k: `|dot(n_k, restLocal_i) - (d_k - dot(n_k, offset))| <= 2e-4 R0`.
* Which triangles are cap triangles (all three vertices on the plane), which vertices are rim (on the plane AND touching a non-cap triangle).
* The live cap planes (centroid, mean normal, d) every frame from the deformed cap triangles; the eye clip planes, the core clip planes and the
  strand anchors use these.

---------------------------------------------------------------------------------------------------------------------------------

## 3. Drawing a piece: the fine mesh

### 3.1 Why the geodesic cannot do it
Casting geodesic directions onto a flat face stretches the fine vertices toward the rim (a face seen from an interior point: the ray hits the plane at
`h tan(theta)`, the spacing grows with `sec^2`). Measured on a half piece, fine frequency 24 (5762 vertices), snapped rest mesh (S5):
246-266 of 11520 fine triangles (2.1-2.3%) straddle the rim; the edge across the rim is 0.07-0.08 R0 mean, up to 0.11-0.175 R0; fine edges on the face average 0.03-0.045 R0 but the longest reach
0.13-0.175 R0 (near the rim). No shading trick hides a chamfer in the SILHOUETTE. So the fine mesh of a piece is built differently.

### 3.2 Construction: native subdivision of the sim triangles
Input: `indices` (T triangles), the cap classification of section 2.3, and `n >= 2`.
* For each sim triangle t = (a, b, c) and each lattice point (i, j), i + j <= n: barycentric `(u, v, w) = ((n-i-j)/n, i/n, j/n)` over (a, b, c).
  Vertices on a sim edge are shared with the neighbouring triangle (key: (min, max, k from the lower index)); sim corners likewise; interior points are unique.
* Sub-triangles per lattice cell, same winding as the parent: `(i,j),(i+1,j),(i,j+1)` and `(i+1,j),(i+1,j+1),(i,j+1)`.
* **Class split.** A sim triangle is `cap k` when its three vertices are on plane k, else `skin`. Fine vertices are welded separately per class, so a
  vertex on a rim edge exists TWICE (one per class) at the same position. The duplicates are (rim loop length x n): 80 / 120 / 160 for n = 2 / 3 / 4 on a 40-edge rim. The index buffer
  is open exactly along the crease and nowhere else (S9 checks: vertices = `T n^2 / 2 + 2` plus the duplicates, triangles = `T n^2`, no edge used three times, 160 / 240 / 320 open index edges
  = the two sides of the crease), which is what gives a mathematically crisp edge; no threshold or blur.
* Attributes (arrays as `vA, vB, vC (sim index x 3)` + `bw (u, v, w)`, i.e. exactly what `update()` already consumes, `jelly.ts:318-327`):
  `aCap = (k, rim)` (k = 0 skin, 1..5 cut face; rim = 1 on a crease vertex), `aCapP = whole-rest position / whole.radius` (the cut face's noise coordinate:
  the SAME on both faces of a cut), `aCapD` (depth of the piece behind the point along -n, / whole.radius), and
  `aRest = normalize(P_whole - m_whole)` with `P_whole = sum(lambda_i restLocal_i) + offset` and `m_whole` = the whole mesh's vertex mean (the origin the whole's
  pattern coordinates were cast from, `jelly.ts:36-37`). Because `aRest` is a function of the material point, **patterns, two-tone, aurora and thin film continue
  across the cut with no other change** (the cap uses the same attribute, so the pattern meets the skin's at the rim).
* `aCapD` by a thickness map, not by ray casting: splat the skin sim vertices and triangle centroids into an 8 x 8 grid in the face's plane (value = their depth along -n, max per cell, one smoothing pass) and read it
  bilinearly at each face sim vertex; O(1000) operations, ~0.1 ms (estimate). The exact version (an inward ray from each of ~200 face vertices against all 1280 triangles) measured **30 ms** in my prototype (S9, 256k ray tests), too much for the cut frame.
* Cost of the build: O(vertices), no ray casting. A whole body's build is ~8 us per fine vertex today (S1, best of 3 on a loaded machine: 10242 vertices ~79 ms,
  5762 ~45 ms, 2562 ~23 ms; the geodesic itself 8-13 ms and identical for every view, `jelly.ts:248`). My unoptimised `Map`-welding prototype of the subdivision builds n = 2 / 3 / 4 (2642 / 5882 / 10402 vertices) in
  **5.8 / 11.3 / 7.3 ms** (best of 2, S9), i.e. 1-4 us per vertex on a loaded machine; typed-array welding should halve that. Target (P9): warm `stage.addBody` of a piece <= 8 ms at med.
* A tier change (`BodyView.applyQuality`, `bodyview.ts:153-159`) rebuilds the piece mesh with the new n.

### 3.3 Per frame
Same loop as today (`jelly.ts:318-327`) with these changes:
1. Sim normals are computed in two sets: **skin normals** from skin triangles only, **face normals** from cap triangles only (accumulate over triangle index
   lists built at construction, then the same two relax passes restricted to the same lists). A rim vertex therefore has a skin normal that knows nothing of
   the face and a face normal that knows nothing of the skin. Whole bodies compute one set exactly as now.
2. A fine vertex evaluates `evalSurfaceBw` with the face-normal array if its class is a cut face, else the skin array (one branch per vertex). A flat face has
   equal corner normals, so Phong tessellation adds nothing and the face stays planar; a dented face (a finger on the cut face) bends smoothly. Rim vertices
   take their POSITION from the face formula for both copies (no crack) and their normal from their own class.
3. New per-frame outputs: for each cut face k (<= 5): centroid, mean unit normal, d (`jelly.caps[k]`), from the face normals of its vertices. These are the eye clip planes,
   the core clip planes and the strand anchors. Extents (`minX...`), `press`, `pull` stay as they are, with `0.45 * restRadius` (`jelly.ts:302`)
   replaced by `0.45 * whole.radius` for a piece (a thin slab has a tiny restRadius and would over-report dents).
4. **Idle skip (pieces only; wholes stay bit-identical).** The sim-normal part of `update()` is NOT small and does not shrink with the piece: `simNormals` + 2 x `relaxNormals` on 642 vertices measured
   0.41 ms (min) / 0.53 ms (median) per call (S10), against a best whole-body `update()` of 1.2 ms at the low tier. A resting piece repeats the same arrays every frame. So a piece whose sim positions moved less
   than 2e-5 R0 (about 0.005 px on a 250 px body) since the last frame it built skips normals, extents and the fine loop (an O(3 x 642) comparison, a few microseconds); the eyes, which read the positions
   and normals directly, keep animating. A finger pressing and holding keeps the mesh static too: the last `press` / `pull` values persist, which is correct.

### 3.4 Size per piece (the "6 pieces cost no more than 2 whole bodies" bar)
Fine vertices of a subdivided mesh: `V(n) = T n^2 / 2 + 2` (T sim triangles; 1280 -> `640 n^2 + 2`, i.e. 2562 / 5762 / 10242 for n = 2 / 3 / 4, which
are exactly the three tier frequencies 16 / 24 / 32 = 8 n). Per-piece rule:

`n = max(2, floor( sqrt( 2 * N_tier * frac^(2/3) / T ) + 0.35 ))`  (N_tier = 10242 / 5762 / 2562; T = 1280, or 320 for a detail-2 piece)

Checked over EVERY partition of the whole into 1-6 pieces (each >= 1/8, fractions in steps of 1/64; S8): worst total fine vertices / one whole body's =
**1.923 (high), 1.890 (med), 2.501 (low)**. At low the floor `n >= 2` (below it the silhouette is the sim mesh's polygon) makes the worst case four pieces
at 6408 vertices, still under ONE high-tier body (10242) and capped at 4 pieces. Without scaling it is 6.0x.

CPU `update()` model (parts measured, the sum is a MODEL to be verified by P8): best whole-body `update()` is 1.2 / 2.8 / 3.6 ms at freq 16 / 24 / 32 (S1; up to 3x worse under load); of that the
sim-normal part is ~0.45 ms for a 1280-triangle mesh (S10) and does not scale with the piece, the rest is the fine loop (~linear in fine vertices). Pieces under 0.35 are built on the detail-2 mesh
(320 triangles, `softbody.ts:529`), so their sim part is ~4x smaller (~0.12 ms); at most two pieces can be >= 0.35. Six moving pieces at high: 2 x 0.45 + 4 x 0.12 + 1.92 x 3.1 = ~7.3 ms against two whole bodies
2 x 3.6 = 7.2 ms (x1.0); at med ~5.8 against 5.6 (x1.0). That is "no more than 2 whole bodies" with no margin when all six are moving, so the idle skip (section 3.3 item 4) is the margin: settled pieces cost ~0.
Fragment cost follows covered pixels, which flush pieces do not increase.

### 3.5 Fallbacks
* No `piece` -> today's geodesic path, untouched.
* `piece` present but the physics did not give a clean rim (R2 violated: some triangle mixes face and skin vertices) -> the builder flags `degraded` and falls
  back to the SAME subdivision with a per-vertex threshold: face class decided by the majority of the three corners, normals as the skin set. The edge is then a
  chamfer of one sim triangle (~0.1 R0); the probe in section 9 reports `rimClean` so the failure is visible, never silent.

---------------------------------------------------------------------------------------------------------------------------------

## 4. Features: who holds what

### 4.1 One frame for everything: the WHOLE's rest space
Every position-bound thing is first defined in the whole's rest space and then handed to the piece that contains it. The render keeps one `WholeRef` per squishy
(keyed by the identity of `piece.whole.restLocal`): the whole rest mesh, its vertex mean `m_whole`, and a `RestMapper` over it (reuses `jelly.ts:18-108`). For a
piece, a point `q = P_whole - offset` is located on the piece with `PieceLocator.at(q)`: a ray from `rayOrigin` through q against the piece's rest mesh (the existing
2-ring candidate search, 15 us per call, S1), and `PieceLocator.nearest(q)` (brute-force closest point over 1280 triangles, 72-87 us per call, S4) for the few cases that
need a point that is not on the skin. A piece-aware `locate(dx, dy, dz, out)` keeps the signature `Face`, `Fx.layout` and `RarityFx.buildConstellation` already call.

### 4.2 Membership is exact and never double counts
A whole-rest point P belongs to a piece iff it is inside one of its cells: `all_k( dot(n_k, P) - d_k < 0 )`, where a point exactly on a plane goes to the side whose outward normal is the lexicographically larger of the pair
(n, -n). That partitions every point to exactly one piece, so specks and stars are conserved to the unit. Eyes are the only objects with extent and use the reach rule below
(`rho` is a conservative isotropic extent used only for the keep / hide decision; the exact cut is made by the clip plane in the shader).

### 4.3 Eyes
Inputs: the eye's whole-rest anchor `P_e` and footprint samples E, W, N, S (computed ONCE per squishy on `WholeRef`, with the exact formulas of `face.ts:122-125,161-163,174-193`, but
using `whole.radius`, not `body.restRadius`, so eye size no longer shrinks with a piece), the reach `rho = r * 1.24 * max(sx, sy)` (the widest the bead gets, `face.ts:250`).

**Straddle policy: CLIP, exactly at the cut face.** For every piece, per eye:
* `s = max_k(dot(n_k, P_e) - d_k)` over the planes of the cell containing P_e (or of the nearest cell); signed distance beyond the face (positive = outside the piece).
* remaining width fraction `f = (rho - s) / (2 rho)` clamped to [0, 1]. **keep iff f >= 0.12**; otherwise the eye is not built on this piece. (Both pieces always satisfy
  `f_A + f_B = 1`, so the lost sliver is at most 12% and only exists while the pieces are apart.)
* the kept eye gets 1-2 clip planes (those cut faces within `rho` of the eye) in WORLD space, refreshed each frame from `jelly.caps[k]` (the actual deformed face, not the
  rigid plane, so a dented face still clips flush). Mechanism: `material.clippingPlanes` on the dome and arc materials with `renderer.localClippingEnabled = true`
  (it is `false` by default, `WebGLRenderer.js:267`, and nothing sets it today; I grepped `src`). The eye materials are created WITH two inert planes (normal 0, constant 1e6)
  on every Face, so whole bodies and pieces share one program (no first-cut compile). The dome material becomes `DoubleSide` with a `gl_FrontFacing` branch
  that returns flat ink-dark: where the front faces are clipped away you see the inside of the shell, shaded as the solid bead's cross-section (the bead is solid ink anyway).

Why clip and not "the piece holding the centre keeps the whole eye": (1) it is the only rule under which the two pieces recombine to the identical image (the
reassembly probe in section 9 asserts it); (2) assigning the whole eye to one side makes it overhang the cut face by up to rho = 0.12-0.27 R0 (a bead floating in air)
and deletes it on the other side; (3) it is not rare: S3 (Monte Carlo, all 50 species, 1500 valid random swipe cuts each, camera yaw +-60 degrees, both parts >= 1/8) finds
an eye within its reach of the plane in **46.3% of cuts on average (35-54% by species)**; for Split in two (plane `x' = 0` through the centre of mass) an eye is touched at
rest size in **3 of 50 species** (granulo, wrigglo, knubby; tadpolo and petalop join them at the 1.24x squeeze: 5 of 50) and the plane never comes within 0.25 r of an eye centre.
(The `azMin` rule in `face.ts:124` keeps the eyes apart from EACH OTHER; it does not keep them off a plane through the centre of mass when the species is lopsided.)

**Pose of an eye on a piece.** The eye's frame is today's footprint fit (`face.ts:221-255`). On a piece:
1. Anchor `h` = `PieceLocator.nearest(q_e)` (q_e = P_e - offset): the closest point of the piece's skin (the exact skin point for an unclipped eye; the rim for an eye that straddles).
2. `off` = q_e - h (rest coordinates, expressed in the eye's rest frame (restX, restY, restN)); set to 0 when |off| < 0.01 R0 (chord-vs-surface difference between the whole's and the piece's meshes,
   both are chords of the same smooth surface: <= 0.005 R0 measured as the radial sagitta bound) so unclipped eyes are bit-for-bit today's pose.
3. Each frame: today's position and frame at `h`, then `position += vX*ox + vY*oy + vZ*oz`.
4. Footprint samples that fall beyond a cut face are replaced by the one-sided difference from the centre (`vX = 2 (P_E - P_C)`); with fewer than two usable samples the eye uses the
   rigid rest frame (the existing `dotN < 0.72` fallback, `face.ts:239-242`).

Exact computation of an eye's surface position and normal on a piece (all of it done once at build, the per-frame part is today's code):
```
at the whole (once per squishy):   d_e = (sin(az*side) cos(el), sin(el), cos(az*side) cos(el));  hit_e = RestMapper(whole).locate(d_e);   P_e = sum(lambda_i whole.restLocal_i);   footprint P_E, P_W, P_N, P_S likewise
on a piece (once per piece):       q = P - offset                                           (P = P_e, P_E, ... each)
                                   (tri, u, v, w) = PieceLocator.nearest(q).bary;  h = sum(lambda_i restLocal_i);  off = q - h  (0 if |off| < 0.01 R0)
                                   restN = normalize((h_E - h_W) x (h_N - h_S)), flipped outward;  restLx, restLy = |h_E - h_W|, |h_N - h_S|     (today's anchorFootprint, face.ts:189-192)
per frame (today's code, face.ts:221-255):  position = Phong(P_live, N_skin, tri, u, v, w, alpha 0.7) + vZ * lift;  normal vZ = best-fit footprint normal, tempered toward R(frame) * restN
                                   + vX * off.x + vY * off.y + vZ * off.z
```
`N_skin` is the SKIN normal set (section 3.3), so an eye at the rim sees the skin's normal, not the face's.

**Blink / look-at / mood on a piece with one eye.** One `Face` per piece that holds at least one eye, with only its eyes. Blink timer: `mulberry32(seed ^ 0xeee1e5 ^ salt)` with `salt` = hash of
the piece's first plane id (`face.ts:107` seeds from the genome alone, so two halves would blink in lockstep like twins); a merged or whole body takes salt 0 = today. Look-at is already per
eye (`face.ts:257-282`). Squint, widen and the happy arc follow the PIECE's own compression and rate (`bodyview.ts:211` passes `smComp` and `rate`): poke the half with the eye and it
squints; poke the eyeless half and nothing changes on the face (there is none). `lookOut` (dev readout) is zero for an absent eye.

### 4.4 A piece with no features
No Face object: no eye materials, no meshes, 4 fewer draw calls, no blink, no mood. It is jelly: it still dents, blushes, glows under a fingertip (`bodyview.ts:277-287`), spawns bubbles,
shows its glitter, pattern, iridescence/aurora, core share, cut face, rim light, and its own aura and light pool. S3: **79.0% of random cuts leave one piece with no eye** (70-87% by
species), so this is the normal case and must look finished, not dead. Concretely:
* the core halo keeps a floor: `coreAmt = max(share, 0.35)` for the shader's analytic halo (a piece without ember is lit by the neighbour's ember, so it is not black); the blob itself
  appears only if it really holds some ember;
* glitter and stars are conserved (section 4.5), so a glittery squishy keeps its sparkle on whichever pieces hold the specks.

### 4.5 Core, glitter, stars, patterns, tier effects
* **Core.** The ember is a sphere at whole-rest (0, 0, 0) (the centre of mass; `core.ts:147` puts it at `body.center`), radius `rc = 0.17 * scale_w * coreSize` (`core.ts:82,146`),
  halo `3.4 rc`. In the piece it sits at `coreRest = -offset` (piece coordinates): world position `center + R(frame) * coreRest` (new `Core.offset`; zero for wholes = identical).
  The core is at the whole-rest origin, so its signed distance to cell plane k is `s_k = d_k` (positive = the centre is on the kept side). The fraction of the ember sphere kept by one plane is
  `1` for `s >= rc`, `0` for `s <= -rc`, else `1 - (rc - s)^2 (2 rc + s) / (4 rc^3)` (the spherical-cap volume); for two planes within `rc` use the product (a close bound). That fraction scales
  `Core.amount` / the blob intensity and `uCoreAmt` (with the 0.35 floor of section 4.4 for the analytic halo only).
  The blob (additive `ShaderMaterial`, `core.ts:87-96`) gets two world clip planes (from `jelly.caps`, the faces within `1.5 rc` of the core) and discards beyond them, so it never pokes out of the
  cut face into the air. The halo billboard (`halo.ts:36-45`) is camera-facing: a point on it has no fixed relation to the cut plane, so it is NOT clipped; it is scaled by the kept fraction instead
  (the glow around a cut ember is the glow around part of an ember). The jelly's analytic halo (`material.ts:219-231`) reads `uCoreWorld`, which `bodyview.ts:193` copies from `core.center`, so it
  follows `coreRest` with no other change.
* **Glitter.** `Glitter.layout` replays the whole body's seeded stream (`fx.ts:233-242`: same `mulberry32(seed ^ 0x6117e7)`, the same N the whole would have at this tier) against the WHOLE's mapper, gets
  each speck's whole-rest position `P = f * S` (`S` = the whole skin point; the live formula in the whole is `centre + (skin - centre) f`, `fx.ts:285-287`), keeps the specks inside the piece's cells and
  re-locates them with `PieceLocator.at`. Live position: `A + (S_live - A) f'` with `A = center + R(frame) * rayOrigin` (the piece's interior anchor; wholes keep `center`). Total specks over pieces = the whole's, exactly.
* **Stars.** Same scheme (`rarity.ts:263-297,363-385`); a link is drawn only when both of its stars are on the piece.
* **Patterns / Epic two-tone / aurora / thin film.** Section 3.2 (`aRest`). Continuity tolerance: the whole's mesh and the piece's mesh are different chords of one smooth surface, so corresponding
  points differ by <= 0.005 R0; the test threshold is `|Delta aRest| <= 0.008`, not 1e-5.
* **Colour.** One genome -> one `JellyMaterials` per view with identical uniforms (`material.ts:361-402`); white balance, absorption and tier tint are identical across pieces by construction.
* **Time-phased idle effects** read `BodyView.clock` (`bodyview.ts:57-65`): the stage hands a piece the clock of the body it was cut from (section 7.2), so aurora, thin film, core pulse and glitter twinkle do not restart.

### 4.6a Wiring in `BodyView`'s constructor (so the build order is unambiguous)
```
piece   = inner.piece && inner.piece.cells[0]?.length ? inner.piece : null          // null = today's path, untouched
scale   = (piece ? piece.whole.radius : inner.restRadius) / 0.5                      // bodyview.ts:101
jelly   = piece ? new PieceJellyView(proxy, material, n(frac, tier, T), piece) : new JellyView(proxy, material, spec.fineFreq)
feat    = piece ? PieceFeatures.build(piece, genome, WholeRef.of(piece.whole), jelly.locator) : null      // eyes[], coreRest, coreKept, membership(P)
core    = new Core(genome, palette, scale, style, feat?.coreRest)                    // offset 0 for wholes
face    = !piece || feat.eyes.length > 0 ? new Face(proxy, genome, jelly, hub, feat) : null     // BodyView.face becomes Face | null
fx      = new Fx(..., feat)    // Glitter.layout keeps the specks inside the piece     rarity = new RarityFx(..., feat)   // stars + links
legacy  : if (!piece && chunk) { faceHidden = true; face.group.visible = false; rarity.group.visible = false }     // bodyview.ts:120 stays
```
Everything that reads `view.face` (the stage's dev `info.eyeLook`, `stage.ts:885`; `debugHook.ts:348` counts views with a face) must tolerate `null`; the dev readouts gain `view.face?.visibleEyes`, `view.jelly.caps`, `view.jelly.rimClean`
(behind `import.meta.env.DEV` like the rest, so the production bundle grep (A11) still finds nothing).

### 4.6 The feature table (answer to "assigned to the piece that holds it")
| feature | defined in whole-rest as | piece rule | straddles the plane | piece without it |
|---|---|---|---|---|
| left / right eye | `P_e` + footprint on the whole mesh | keep iff >= 12% of width remains; clip at the live cut face | clipped (half eye each side) | no Face object |
| core ember | sphere at the origin | draw the clipped part; ember cross-section on the cut face | clipped | 0.35 ambient halo floor |
| glitter specks | seeded `f * S` | inside the cells | none (points) | none |
| constellation stars + links | seeded | inside the cells; link needs both ends | link dropped | none |
| pattern, two-tone, aurora, iridescence | `aRest = dir(P_whole - m_whole)` | automatic | continuous | automatic |
| tier aura, light pool, shadow | footprint of the piece | per piece | n/a | per piece |
| tier dome, pillar, motes, satellites, table ring | group | once, largest piece | n/a | none |

---------------------------------------------------------------------------------------------------------------------------------

## 5. The cut face

### 5.1 Data flow (what comes from where)
PHYS: `restLocal`, `indices`, `piece.cells` (planes) -> render `PieceBuild` (once): cap classification, `aCap, aCapP, aCapD, aRest` -> `JellyView` per frame: face normals + `jelly.caps[k]` ->
`JellyUniforms` (material.ts, new fields below) -> the jelly fragment shader (new `CAP_STAGE`, injected at the places the file already splices: `color_fragment`, `normal_fragment_maps`,
`lights_physical_fragment`, `transmission_fragment`, the emissive block; `material.ts:485-499`). **No `AddBodyOpts` field is needed**; the mask is the `aCap` attribute.

New uniforms (per view, `material.ts:27-89` pattern): `uCapRough, uCapCoat, uCapTint, uCapPore, uCapPoreF, uCapWet, uCapGlow, uCapDepth` (family constants), `uFresh, uFreshIdx`
(the warm sheen, section 5.5), `uCoreR` (blob radius for the ember cross-section). Program key bumped `wh-jelly-v5-...` (`material.ts:500`). The cap code is ALWAYS compiled (one program for wholes and pieces) and
inert for a whole (`vCap.x = 0`); whole bodies bind one shared zero buffer for the three new attributes, so the first cut compiles nothing (probe P10).

### 5.2 Shader skeleton (not final code)
```glsl
// vertex
attribute vec2 aCap; attribute vec3 aCapP; attribute float aCapD;
varying vec2 vCap; varying vec3 vCapP; varying float vCapD;
... vCap = aCap; vCapP = aCapP; vCapD = aCapD;

// fragment, after COLOR_STAGE's blush/pale mixes
float jCap = step(0.5, vCap.x);                         // 1 on a cut face (constant per triangle: the vertices are duplicated at the crease)
if (jCap > 0.5) {
  float dd = clamp(vCapD * uCapDepth, 0.0, 1.0);        // piece depth behind this point
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaleCol, uCapTint);       // opaque families show a paler, floury / airy interior
  diffuseColor.rgb *= 1.0 - 0.18 * dd;                                 // clear families: deeper = denser (the transmission term does the real work)
  // pores / flour / beads share one cell function on the 3D cut-face coordinate q = vCapP * uCapPoreF:
  //   foam, marshmallow: dark holes with pale lips   mochi, putty: fine speckle   beads: round discs (a 3D bead sliced by the plane) with dark gaps
}
// GRAIN_STAGE: on a cut face the skin grain (vRest-based, material.ts:305-322) is replaced by the cut-face bump (same bump helper, q from vCapP)
// roughnessFactor = mix(roughnessFactor, uCapRough, jCap);                 (after normal_fragment_maps; roughnessFactor exists from roughnessmap_fragment)
// after lights_physical_fragment:  material.clearcoat *= mix(1.0, uCapCoat, jCap);
// TRANSMISSION (material.ts:196-204): jThick = mix(jThick, 0.2 + 0.8 * clamp(vCapD * 1.2, 0.0, 1.0), jCap);
// EMISSIVE (material.ts:206-284), added to jExtra:
//   ember section: h = signed distance of uCoreWorld to the face plane (world, along the face normal), rSec2 = max(uCoreR^2 - h^2, 0), in-plane distance e from the core's foot point;
//                  jCap * uCapGlow * uCoreAmt * (smoothstep(sqrt(rSec2), 0.6 * sqrt(rSec2), e) + 0.35 * exp(-e^2 / (uCoreRadius^2)))  in uCoreCol
//   rim line:      vCap.y (1 on the crease, 0 one fine edge in) -> pow(vCap.y, 3) * 0.5 added in the family's pale colour (the edge catches the light)
//   fresh sheen:   (abs(vCap.x - uFreshIdx) < 0.5) * uFresh * uSeamCol * (0.25 + 0.75 * emberDisc)
//   skin seam band (material.ts:256-260): multiplied by (1 - jCap): the face itself is NOT at distance 0 of "the seam plane" any more
```
The shader needs NO normal override: the cut-face fine vertices already carry face normals (section 3.3), so the interpolated `vNormal` is the face normal inside a face and the
skin normal outside, with a true crease between them.

### 5.3 Per family (12 rows; initial values, to be tuned on filmstrips; constants live in a new table `CAP_LOOKS` in material.ts, keyed by `MaterialFamilyId`, fallback = jellygel)
Skin numbers are the family's `look` from `materials.ts:270-363`.
| family | skin look (rough / transl / fuzz / grain) | cut face reads as | uCapRough | uCapCoat | uCapTint | pores / grain | uCapWet | uCapGlow (ember) |
|---|---|---|---|---|---|---|---|---|
| jellygel | .08 / .82 / 0 / 0 | clear glassy window; ember disc; one clean softbox streak | 0.10 | 1.0 | 0 | none | 0.5 | 1.0 |
| waterfill | .04 / .93 / 0 / 0 | clearest window, bright thin rim like a membrane edge | 0.06 | 1.0 | 0 | none | 0.6 | 1.0 |
| gummy | .15 / .90 / 0 / 0 | satin window, denser colour, faint sugary haze | 0.22 | 0.7 | 0.06 | haze 0.15 | 0 | 0.9 |
| stickystretch | .12 / .60 / .05 / 0 | wet window, wider glossy rim line | 0.07 | 1.0 | 0 | none | 0.8 | 0.9 |
| slimegoo | .03 / .70 / 0 / 0 | very wet window; meniscus bead along the rim (rim normal tilts out) | 0.05 | 1.0 | 0 | none | 1.0 | 0.9 |
| putty | .45 / .08 / .10 / .10 | matte plastic, fine speckle | 0.80 | 0 | 0.15 | speckle 0.2, f 40 | 0 | 0.5 |
| mochidough | .85 / .18 / .55 / .50 | floury matte, soft sheen, pale dusty interior | 0.95 | 0 | 0.35 | flour 0.5, f 30 | 0 | 0.5 |
| slowrise | .70 / .04 / .35 / .55 | open cells: dark holes, pale lips | 0.85 | 0 | 0.30 | pores 1.0, f 14 | 0 | 0.4 |
| marshmallow | .95 / .05 / .80 / .30 | airy fine cells, bright cream, fuzzy rim | 0.95 | 0 | 0.45 | pores 0.7, f 22 | 0 | 0.4 |
| firmsilicone | .35 / .25 / .05 / .10 | uniform satin solid | 0.40 | 0.3 | 0.05 | none | 0 | 0.5 |
| popdome | .20 / .35 / 0 / 0 | uniform glossy solid | 0.25 | 0.6 | 0.05 | none | 0 | 0.6 |
| beadsqueeze | .30 / .35 / 0 / .90 | bead cross-sections: round discs of different radii (a bed sliced) with dark gaps | 0.35 | 0.4 | 0.10 | beads, f 6 (matches `GRAIN_FREQ`, `material.ts:302`) | 0 | 0.5 |

Two properties come for free: (1) the cut-face noise coordinate is `aCapP` = a function of the whole-rest position, so the two faces of one cut show the SAME cross-section
mirrored, and a bead bed really looks sliced; (2) the face of the translucent families is a refractive flat window, which three's transmission term already does
(`material.ts:196-204`) once the thickness is the real depth.

### 5.4 Ember cross-section, thickness, low tier
* The face of a piece that holds part of the ember shows a soft disc of radius `sqrt(rc^2 - h^2)` plus a wide faint halo: "the inside of the squishy". The disc brightness uses `uCoreAmt` and
  the style's core tint (`material.ts:422-423`), so a Legendary half has a gold ember section on any genome.
* Thickness: `jThick` on a face comes from `aCapD` (the real depth behind the point), so a half-ball's window is darkest at the middle and clear at the rim, like glass.
* Low tier (no transmission, `WH_LOW`): the face is the tinted body with the same ember disc and rim line; alpha is raised by 0.1 on a face (a window cannot refract here, so it must not look empty).

### 5.5 Fresh cut, fade, round-over
* **Fresh sheen.** `partPieces(a, b)` (called right after the swap, `stage.ts:694`) starts `uFresh` on the NEW face (`uFreshIdx` = the face index whose plane id the two views share):
  attack 0.15 s (0.25 s calm) to a peak of 0.22 linear emission, then `tau = 0.45 s` decay; ends by 1.5 s. It is an AREA light, so it is ~10x lower than the thin seam band (`material.ts:259`,
  band peak ~2.4 x 1.3) and is multiplied by `glowK` (the stage's calm / flash-governor factor, `bodyview.ts:215`, `stage.ts:777-779`) so calm gives 0.45x and a recent granted flash holds it at 0.35x.
  Target (probe P6): face luminance rise <= 0.10, frame-mean luma step <= 0.012 per frame, no screen light.
* **No round-over.** The material of the face never fades. If PHYS keeps a plastic "rounds over" goal, nothing in the render has to change (the face normals follow the geometry; as the face bulges the
  crease softens by itself because the two normal sets converge), but I recommend against it (section 8.3 and owner question 1): a half that relaxes into a ball in 2-6 s stops being a real part.
* Dry-down (optional, 0.25 day): face clearcoat 1 -> 0.75 over 10 s for the wet families.

### 5.6 Cost
Vertex: +3 attributes (+24 bytes/vertex static, shared zero buffers for wholes); the fine loop is unchanged plus one branch. CPU per frame: the face normals are accumulated over the cap triangles only and the skin normals over
the rest, so the triangle loops do the same total work as today (~0.45 ms for the whole sim-normal part, S10), plus a normalisation pass over the cap vertices (113-255 of 642). Fragment: ~10 ALU on every jelly fragment
(varyings, step, mixes, inert for wholes) and ~60 ALU extra only on face fragments (cell noise + ember disc), estimated by counting, not measured. I did NOT measure GPU time (no browser allowed in this task):
probe P8 measures it on the existing `perf` section (baseline 6 pieces = x1.32-1.37 of 2 whole bodies, bar 1.5, `RENDER_R.md:34,165`).

---------------------------------------------------------------------------------------------------------------------------------

## 6. Seam glow, strands, bridge, flash governor, calm

### 6.1 Timeline of a cut (render side)
| time | what the stage does |
|---|---|
| neck t in (0,1) over `neckS` (0.25-0.4 s) | `setCutSeam(id, plane, t)` as today: the warm band on the SKIN along the plane (`bodyview.ts:213-221`, `material.ts:256-260`); new optional `sweep` (below) makes the band draw along the swipe. The pinch should be shallow (the SHELL memo's per-family `depth` knob, 0.35 for gel; deeper for the stringing families whose strand hides the swap, `CUT2_SHELL.md` 5.2) for a true cut; render needs the swap Chamfer <= 0.08 R0 (their N10) and my swap luma step (P6); see risk K2. |
| swap | remove the whole's view; add both pieces FLUSH (sim positions = the whole's on each side of the plane, within 1 mm). Pieces inherit the removed view's `clock`. `partPieces(a, b)` starts `uFresh` on the new face and the parting threads. |
| 0 - 1.5 s | pieces drift apart (shell's 0.22 m/s); fresh sheen decays; threads hang between the two FACES (below) and snap. |

### 6.2 `cutfx.ts` changes
* `part(a, b)` (`cutfx.ts:157-199`): the old anchors are `facingVertex` over the whole skin (`cutfx.ts:57-65`). Replace by cap-face anchors: find the face of `a` and of `b` with the same plane id
  (`aCap` index from the views' `piece.cells`), take the cap centroid at the cut moment (from `jelly.caps[k]`), and for thread j choose the nearest CAP sim vertex of each piece to
  `centroid + tilt_j * (in-plane axes) * r_cap` (`r_cap = sqrt(area / pi)`). The threads then run between two faces that were one surface a moment ago. `k = tack * (0.35 + 0.65 stringiness)` and the count (1/2/3),
  `maxLen`, `T` stay as they are; `R` becomes `min(r_cap_a, r_cap_b)` instead of `liveRadius`.
* `carrySeam` (`bodyview.ts:258-262`, `cutfx.ts:158-160`) stays for legacy bodies without `piece`; for pieces it is NOT used (the face sheen replaces it and follows the real face as it moves).
* **`setCutSeam` becomes face-aware** (this reconciles `CUT2_SHELL.md` 5.4 "matching faces glow", which calls `setCutSeam(view, planeWorld, t)` on a plane that lies ON a cut face and expects the face to glow over its whole area).
  `BodyView.setSeam` first asks whether the plane coincides with one of the body's live faces (|dot(n_face, n_plane)| >= 0.97 and the face centroid within 0.03 R0 of the plane). If so it drives THAT face's sheen channel (the same
  `uFresh` path: amplitude `0.22 * t`, attack 0.12 s, release 0.2 s, `glowK`), and the skin band stays off; otherwise it is the skin band of the neck, as today. The skin band is never drawn on a face (`x (1 - jCap)`), because a face lies at
  distance ~0 from its own plane and the Gaussian would light all of it at the band's peak (~10x the sheen's amplitude): the shell's `t` ramps (0.35 -> 0.8) therefore mean sheen amplitude, not band amplitude. One call per body per step, no allocation.
* `bridge(a, b, t)` (`cutfx.ts:202-217`): if the two views share a face id ("knit mode", the normal case now) there is no neck tube: both faces glow (`uFresh` reused in reverse, amplitude `t`, cap area) as they
  approach, tacky families (k >= 0.12) also grow 1-3 thin threads between the faces (the parting machinery run backwards), and the swap to the merged body (or the fresh whole) happens when they touch.
  If they do not share a face (a non-adjacent join before the shell's fusion rule applies) the existing tube is used unchanged.
* `bodyRemoved` / `lastSeam` keep working for the neck-to-pieces handover of the seam band.

### 6.3 Sweep (optional, 0.5 day)
`StageLike.setCutSeam(bodyId, plane, t, opts?: { from?: V3; to?: V3 })`: two points on the plane in world space (where the swipe started and ended, the shell already has them). The band is lit only up to the front
`s <= t * L` along `to - from` (smoothstep edge 0.15 L), so the line DRAWS across the body like a blade. Calm: no sweep (the whole band eases in with the existing 0.45 factor, `bodyview.ts:23,215`). 2 flops per fragment in the existing seam term.

### 6.4 The face is edge-on at the cut, so show it
Both cut paths put the camera IN the plane (section 1.5). From that camera the fresh faces are invisible; they appear when a piece tilts or the player orbits. A render-owned **peek**: ease
`cameraFx.yaw` (the layer the ceremonies already use, `stage.ts:216`) by up to 8 degrees toward the side that shows the larger face, over 0.35 s in and 1.2 s out, only when not calm, not while the
player is orbiting (the user target `tYaw` moved in the last 0.5 s) and only once per cut. Off in calm (same rule as every camera move). 0.5 day; the owner can strike it without touching anything else.

### 6.5 Flash governor and calm
* All cut lights (seam band, fresh sheen, knit glow, strand emission) multiply `glowK` = `(calm ? 0.5 : 1) * (sinceFlash < 1 ? 0.35 : 1)` (`stage.ts:777-779`); the seam keeps its extra calm factor 0.45 (`bodyview.ts:23`);
  the fresh sheen takes 0.45 in calm (attack 0.25 s) on top of `glowK`.
* No cut light has an attack under 0.12 s or a step; the X09 gate (<= 3 luminance transitions in any 1 s at the 0.04 swing, no screen light) is re-run with true halves (P6). The swap itself must not change the
  frame mean by more than 0.012: two half-size pools replace one pool (`decals.ts:143-149`), so if the probe shows a step, the new views start `decals.alphaMul` at 0.6 and ease to 1 over 0.25 s.
* Calm also halves the thread length and removes the snap spring (`cutfx.ts:165-166,268`) as now.

---------------------------------------------------------------------------------------------------------------------------------

## 7. Framing, shadows, continuity, rarity

### 7.1 Framing and shadows for 2-6 pieces of true shape
* `framingFor` (`stage.ts:271-325`) already frames the table extents of all visible views plus a margin; true halves sit flush, so the union extent equals the whole's and the camera does not move at the
  swap (the old chunk case spread to SETTLE_GAP + a shrunken ball). `BodyView.restHalfW` / `restH` (`bodyview.ts:103-106`) read the piece's own positions, so a flat slab reports its true reach.
* `BodyView.scale` (`bodyview.ts:101`) becomes `whole.radius / 0.5` for a piece: eyes, core, glitter size, bubbles, seam width and `bodyScale` (`stage.ts:468`) stay the WHOLE's size. `liveRadius`
  (`bodyview.ts:265`, used by the strands and bridge) becomes the piece's own bounding radius from its centre.
* `growth` (`bodyview.ts:268`) stays 1 for a true piece (no `setFrac` scaling; a merge is a new body, section 8.4). The headroom stopgap (`stage.ts:293-304`) is unchanged and removable when the neck is gone.
* Shadows and pools are per piece from the jelly's min/max extents (`decals.ts:132-149`): a flat face on the table gets a wide shadow, a standing half a narrow one, automatically.
* Sort order is by centre distance far to near (`stage.ts:768-775`); two flush halves are fine. Known limit: three's transmission pass renders OPAQUE objects only (`WebGLRenderer.js:2076`), so a piece does not
  refract another piece behind it. This already holds for any two overlapping bodies; I flag it, not fix it.

### 7.2 Continuity of clock and look
`removeView` stores `{ clock, at }` of the removed view (the way `cut.lastSeam` is kept, `cutfx.ts:129,147-155`); a view with `piece` added within 0.25 s of it with the same genome seed takes that clock. Blink
state restarts per piece (section 4.3), which is intended.

### 7.3 Rarity effects on a piece
* Per piece, unchanged code: rim aura, light pool, shadow, glitter, spark trail (picks one of the piece's specks), constellation stars, aurora, thin film, two-tone, core tint, tier translucency.
* Group, once: the Mythic dome (`rarity.ts:316-319`), the Legendary pillar (`rarity.ts:322-324`), Epic motes and Mythic satellites (`rarity.ts:326-360`) and the table caustic ring (`decals.ts:151-154`). The stage groups views by the identity of
  `piece.whole.restLocal`, computes the union extents each frame (cheap: a loop over the group's jelly extents), picks the anchor = the largest `frac` (ties: the stage's primary view, else the lower view id; the SHELL memo's play-body anchor is also the larger child), and sets every other view's `rarity.strength` target for
  these four to 0 (the field already exists, `rarity.ts:204-205`; ease over 0.3 s so a change of anchor never pops). `RarityFx.update` takes the union `(cx, cz, R)` for the anchor's dome / pillar / orbits.
* The old behaviour hid the whole rarity group on chunks (`bodyview.ts:120`); that line stays for legacy chunks only.

---------------------------------------------------------------------------------------------------------------------------------

## 8. API changes, the merge rule, the launch cause, and what other lanes must change

### 8.1 Contract
* `SoftBodyLike.piece?: PieceInfo` (section 2). `BodyProxy` forwards it (`bodyproxy.ts:12-68` pattern: `readonly piece = inner.piece`).
* `AddBodyOpts.chunk?: boolean` stays, documented "deprecated: honoured only for a body without `piece`". `AddBodyOpts.piece?: boolean` hint (default inferred).
* `addBody(body, ...)` is idempotent per body object: a body that already has a live view returns that view's id (no rebuild). This is the render-side half of D14.
* `StageLike.setCutSeam?(bodyId, plane, t, opts?: { from?: V3; to?: V3 })`: the optional fourth parameter, section 6.3. Existing callers are unchanged.
* `StageLike.setBridge`, `partPieces`: signatures unchanged; semantics extended (knit mode, section 6.2).
* `StageLike.setPrimaryBody?(id: number): void` (asked for by `CUT2_SHELL.md` 5.1 so a cut never needs `setBody`): makes an existing view the primary (the camera follows it, `bodyScale` / `framing` as `host.makePrimary`, `stage.ts:566`), tier-styled,
  and allows `removeBody` of the old primary afterwards. 0.25 day.
* `StageLike.warmPieces?(): void` (optional, 0.25 day): builds and disposes one hidden piece view (JIT, buffers) so the first real cut does not pay it; the shell may call it at the first Cut-tool pick (their `prewarm()`). The shader program is already
  compiled by any visible jelly (one program, section 5.1).
* A view re-reads `inner.piece` by reference every frame (R7) and rebuilds on a change.
* `PieceOpts` (physics input) is PHYS's to extend; the render lane does not read it.

### 8.2 `stubBody.ts` (dev stand-in, not shipped)
It must produce `piece` so the render harness runs without physics: `StubBody` ctor gets `piece.cutPlanes` (whole-rest planes) and builds its rest by a small `clipRest()` (the algorithm of my S2 prototype: radial remesh about an
interior point, rim snapping, 12 in-plane relaxation passes on the cap interior; ~120 lines, dev-only, tree-shaken like the rest of the file). It already fakes `frac`, `measureCut`, `setNeck`, `setFrac` (`stubBody.ts:134-155`). Replace its
chunk code (`stubBody.ts:83-94`) and keep the chunk path behind `piece.chunk` for the legacy probes. When PHYS lands its own builder, the stub switches to it; the probe asserts R1-R7 on BOTH.

### 8.3 Why the old chunk launched, and how this design removes it
Measured with the real `SoftBody` (S6, S7; fields poked only on my own instances):
* `GOAL_i = c + R q_i` with `q = QG` (`softbody.ts:1980-1982`) and `QG = Q + flatK (FLAT - Q)` (`softbody.ts:2394-2396,2409`), where `FLAT = flatPoints(...)` (`softbody.ts:704-710`, `shape.ts:282-294`) pulls every vertex beyond a plane
  at 0.55 R0 onto it and rescales about the ORIGIN. The mass-weighted mean of FLAT is **(-0.073, 0, 0) R0 for a side cut and (0, -0.034, 0) R0 for a vertical one** (rest shape: 0.0000); the goal is not centred, so
  the goal's centroid sits `R mean(q)` away from the body's centroid for as long as `flatK > 0` (decays with `tau = 2 s`, putty `1 + memStiff`, `softbody.ts:2373`, `softbody.ts:703`). At the same time the particles are BUILT on the rounded rest `Q`
  (`softbody.ts:817`) while the goal and the edge rest lengths (`softbody.ts:2425-2431`) already follow `FLAT`: the cap side starts with an initial strain of up to 0.5 R0. Both are inferences from the code; the bisection below is what confirms them.
* Reproduced (peak centre-of-mass speed over 0.6 s, `frac 0.5` chunk): dimpla 11.75 m/s (side) / 14.11 (face down), chunkle 7.70 / 7.10, dollop 2.20 / 0.75, twangle 0.99 / 0.72, matching VERIFY_SHELL4_A F3 (1.5-14 m/s).
  Bisection: `flatK = 0` from t = 0 (goal = rounded rest): **0.00 m/s on dollop, dimpla and chunkle** (twangle keeps 0.68 m/s in this variant: my test places every piece at y = 0.3 and twangle's rest height is lower, so that is its drop, not a launch);
  FLAT with its mean removed (the goal centred, everything else as is): side cuts fall to 0.15-0.56 m/s (dimpla 11.75 -> 0.32, chunkle 7.70 -> 0.24, dollop 2.20 -> 0.15), i.e. the centroid offset is the launch; face-down cuts keep 1.05-1.55 m/s, consistent with the
  strain release of a face built round and aimed flat pushing into the table (peak PARTICLE speeds stay 2-8 m/s in the same variant).
* Design-out: R4 + R1. A true piece's rest mesh IS the flat-faced shape, centred on its own centroid, so particles, goal, edge rest lengths and volume agree at t = 0 (nothing to relax), there is no `FLAT`, no `flatK`, no `ROUND_TAU`. The
  gate (PHYS): a freshly built piece resting on the table moves < 0.05 m/s for 2 s, face down, face up and sideways, on all 12 families.

### 8.4 Merging pieces that were not cut apart (design fact 3), seen from the render lane
Rule (render-compatible, always valid, always ends whole):
1. **Adjacent** pieces (some plane id appears in both with opposite n, and their faces overlap in positive area) merge into the union of their cells (`cells` concatenated; the shared plane drops out; the new rest origin and
   offset are PHYS's). If the union meshes (radially from its centroid) as a star-shaped body, that is the merged piece.
2. **Otherwise** (not adjacent, or the union is not star-shaped about its centroid) the merged piece is the **lowest common ancestor cell** of the two in the cut tree, and every piece under that cell joins (announce "Joined 3 pieces").
   The LCA cell is a single convex cell, so it is always a valid body; its volume is exactly the sum of its pieces' fractions; joining the last two pieces gives the root cell = the whole.
3. The last join is a fresh `createBody(genome)` without `piece` (as `cut.ts:398-408` does), i.e. today's whole-body render path: "bit-for-bit original" is true for the picture because it is literally the same code and genome; the probe compares a post-reconnect frame
   with a never-cut frame at the same clock (P4).
Render consequences: nothing special. Features, glitter, stars and the face are recomputed from `cells` by the same membership code; the removed interface's `aCap` faces disappear because their planes are no longer in `cells`. Between the two approaching pieces the stage
shows the knit glow on the faces that will meet (section 6.2). Alternative the owner may prefer (owner question 2): refuse the join with the "small wobble" and pull the dragged piece toward its true neighbour.

### 8.5 What other lanes must do (render needs, not render work)
* **SHELL**: stop `stage.setBody` for a cut and add/remove bodies instead. Today a cut re-adds every other piece (`bodies.ts:112-115`): with 5 other pieces that is 5 extra `JellyView` builds (~25-80 ms each in the best case, S1) on top of the two new ones. Stop passing `chunk: true`
  (`bodies.ts:108`); there is no face piece, so the play body is "the largest piece" (shell's choice) and the camera follows `primaryBodyId`. Place the pieces flush (section 2.2 R6) and keep the pinch shallow (section 6.1).
* **PHYS**: R1-R7 (section 2.2), the exact numbers above, and `frac`.
* **AUDIO**: none.

---------------------------------------------------------------------------------------------------------------------------------

## 9. Test plan (independent measurements, thresholds stated before measuring, none loosened afterwards)

Existing machinery to extend: `_harness/renderview/view.ts` (`chunkFaceProbe`, `cutProbe` at line 998, `realCutProbe` at line 1173 with `film: true`) and `_harness/browser_render.mjs` section `cut` (line 1244).

| id | probe | independent evidence | threshold |
|---|---|---|---|
| P1 | eyes per piece, centre cut, 6 species (dot / oval / wide / sleepy styles) | dark-ink pixels inside each eye's footprint on each piece rendered alone (the method of `chunkFaceProbe`, `browser_render.mjs:1262-1267`), plus the dev count of visible eye meshes per view (a count the pixels must agree with) | piece A has >= 0.8 x the whole's ink in its eye's footprint and <= 0.02 x in the other eye's; B mirrored; every piece's mesh count equals its pixel-evidence count |
| P2 | straddle sweep: plane at -1.0, -0.8 ... +1.0 rho across an eye, 4 eye styles | ink pixels of A + B vs the whole | sum within +-6%, except at the 12% sliver (sum >= 0.88); never any ink beyond the cut face (columns past the face = 0) |
| P3 | flat face | piece viewed edge-on (camera in the face plane) at 1280x800: fit a line to the cut-side silhouette | RMS <= 0.8 px over the face height; control (measure first): the legacy chunk build must fail it by a clear margin (expected >= 3 px) so the probe can fail; plus face-on luma variance across the face interior per family (matte / glossy / porous / bead bounds set from the first run's table, then frozen) |
| P4 | reassembly | whole vs the two pieces placed flush at rest (stub, clock frozen, pointer fixed, blink off), same camera | mean abs RGB diff outside a 4 px seam band <= 2/255, no 8x8 block over 6/255; post-"Reconnect all" frame vs never-cut frame <= 0.5/255 |
| P5 | continuity data | node: `aRest`, `aCapP` of corresponding points; glitter / stars counts | `|Delta aRest| <= 0.008`; specks and stars conserved EXACTLY (sum over pieces = the whole's, each in exactly one piece); links only with both ends |
| P6 | flash / calm | `cutProbe` + `realCutProbe` with true halves: X09 (10 rapid cuts + Reconnect all) | <= 3 luminance transitions in any 1 s, screen light 0 (as today); swap frame-mean step <= 0.012; fresh face luma rise <= 0.10; attack >= 0.12 s; calm / normal fresh ratio <= 0.5 |
| P7 | rim and mesh | node: for every sim cut face on 50 species x centre / oblique / edge planes (stub `clipRest`, then PHYS's builder) | `rimClean` true (0 mixed triangles), cap min angle >= 15 degrees, planarity <= 1e-6 R0 |
| P8 | perf | fine-vertex totals over all partitions; `JellyView.update` ms (node) and the existing `perf` section for 6 pieces vs 2 whole bodies at low / med / high; draw calls per piece | totals <= 1.95x (med, high), <= 2.5x (low, <= 4 pieces); 6 pieces <= 1.5x of 2 whole (baseline 1.32-1.37); eyeless piece -4 draw calls |
| P9 | cut hitch | `performance.now()` around `stage.addBody` for each piece, cold and warm, at med | warm <= 8 ms per piece; no `setBody` in the cut path |
| P10 | no compile at the first cut | `renderer.info.programs.length` before / after the first cut | delta 0 |
| P11 | determinism | two identical runs: hash of fine position arrays after N frames | equal |
| P12 | garbage | the harness's per-frame allocation sampler on 6 pieces | no worse than 6 x one whole's |
| P13 | whole-body regression | 3 genomes (a plain gel, a speckled Rare, a Mythic) whole, fixed clock, fixed pointer, before and after the change; plus the full existing `browser_render.mjs` | frame difference <= 0.2/255 mean, every existing check unchanged; production bundle grep (A11) still 0 dev members (new dev readouts sit behind `import.meta.env.DEV`) |

### Views to add (filmstrips; every sheet Read and judged, not only measured)
1. `cut2_film_<family>`: the existing 14 stills per cut (neck half / end, apart 0 / 120 ms / 300 ms / 600 ms / 1 s, knit 0.06 ... 0.95 s, whole) for gel, sticky, slime, putty, foam, beads.
2. `cut2_eyes_sweep`: 11 stills per eye style: piece A | piece B | whole, plane stepping across the eye.
3. `cut2_face_turntable_<family>`: a half at camera yaw 0 / 30 / 60 / 90 degrees and edge-on, desktop med and phone low, all 12 families (12 sheets).
4. `cut2_nested6`: six pieces, front / orbit 40 degrees / above, flat faces visible.
5. `cut2_reassemble_ab`: whole | reassembled | |diff| x 8.
6. `cut2_coreless`: a 1/8 slab from the edge (no eye, no ember): does it read finished?
7. `cut2_phone_low`: the same cuts at 390x844 low.
8. `cut2_fresh_curve.csv`: face luma vs time for normal and calm.

---------------------------------------------------------------------------------------------------------------------------------

## 10. Risks

| # | risk | mitigation |
|---|---|---|
| K1 | PHYS delivers a rest mesh with a chamfered rim or slivers (R2, R3). | `degraded` fallback (section 3.5), the P7 probe reports it per species; I would not start the render build before one species has a clean mesh. |
| K2 | If the physics keeps its deep pinch (`NECK_WAIST = 0.3`, a waist of 0.3 of the cross-section at t = 1, `softbody.ts:204`), the swap pops from rounded lobes to flat-faced halves. | the SHELL memo already makes the pinch a per-family `depth` (0.35 gel ... 0.9 sticky / slime) with an acceptance bar N10 (Chamfer <= 0.08 R0); render adds the swap luma step (P6) and asks for depth 0 (seam glow only) where either bar fails. |
| K3 | Eye clipping: `DoubleSide` + `clippingPlanes` + a transparent material is the least-tested path (the half-eye cross-section and its sort against the jelly, which writes no depth: eyes are drawn last, `renderOrder 20`). | keep the dome shader's flat interior; P2 pixels; fallback: hide an eye whose remaining width is under 50% instead of clipping (a one-line threshold). |
| K4 | A first-cut shader compile hitch. | one program for wholes and pieces; eyes created with inert clip planes; P10. |
| K5 | A piece seen through its translucent neighbour is not refracted (three's transmission pass samples opaque objects only). | accepted (section 7.1); eyes of a far piece can show through a near jelly because the jelly writes no depth (existing, `bodyview.ts:66` comment). |
| K6 | The fresh sheen reads as a flash. | amplitude and attack bounds in P6; `glowK`. |
| K7 | Non-star unions (PHYS rule) break `PieceLocator.at`. | `nearest()` fallback (72-87 us per query) is used for non-star bodies; specks / stars use it only then. |
| K8 | Cut-face noise aliasing on a far or small piece. | the existing fade before aliasing (`material.ts:311`: `jFade` from `fwidth`) is reused for the face noise. |
| K9 | Low-tier fill rate / alpha blending of faces. | the face is part of the same mesh and shader; no extra pass; P8 on the phone profile. |
| K10 | Pieces created non-flush, or at rest while the whole was deformed (R6), pop at the swap. | P4 (rest) and a P4 variant that cuts a squeezed body catch it; the SHELL memo's N10 (Chamfer <= 0.08 R0) bounds it; flushness is a SHELL / PHYS obligation (section 8.5). |
| K11 | Per-piece fine resolution makes small pieces polygonal. | floor n = 2; the 2562-vertex mesh at 0.5 R0 is the same angular resolution as a whole at low tier. |
| K12 | Six moving pieces cost about as much CPU as two whole bodies (model x1.0, no margin) because the sim-normal part is size independent. | idle skip (section 3.3 item 4), detail-2 sim meshes for pieces under 0.35 (already the physics rule), P8 measures it in the browser; if still over, the second `relaxNormals` pass is dropped for pieces under 0.25. |
| K13 | The single shader program grows; a whole body must not change by one pixel. | the cap code is inert for wholes (`vCap.x = 0`); P13 compares whole-body frames before and after at a fixed clock (<= 0.2/255). |

---------------------------------------------------------------------------------------------------------------------------------

## 11. Size and order (render lane only)

| phase | content | days |
|---|---|---|
| A | contract + `BodyProxy` pass-through + `stubBody.clipRest` + `PieceBuild` (classification, subdivision, split normals, `aCap*`) + one cut-face look + eye membership / pose / clip + core offset / clip + `aRest` continuity + P1, P3, P4, P5, P7 | 5.0 |
| B | 12 family cut-face looks + ember section + fresh sheen + calm + governor + strands on faces + knit bridge + sweep + glitter / stars membership + rarity anchor + P2, P6 | 3.5 |
| C | per-piece fine resolution, idle skip, geodesic cache, clock inherit, `addBody` idempotent, program stability, framing / shadow checks, camera peek, P8-P13 | 2.5 |
| D | filmstrips, judging, fixes | 2.5 |
| total | | **13.5** (11.5 if the peek and the sweep are struck) |

(`CUT2_SHELL.md` indicates 3-4 days for RENDER: that is the eyes-by-region-and-clip work only. The flat-face mesh, the cut-face looks, the group effects, the performance rules and the probes are the rest of these 13.5; the eyes (4.3) are about 3 of them.)

Phase A alone already gives the owner what they asked for (a real cut with the eye on each side, flat faces, no ball) with one cut-face look; phases B-D make it good.

---------------------------------------------------------------------------------------------------------------------------------

## 12. Evidence: what I ran (scratch `...\scratchpad\truecut\render\`, node 22.20 type stripping, one process at a time, run from the repo root because the scratch path is too long to be a working directory)

| id | script | what | key result |
|---|---|---|---|
| S1 | `s1_mapping_cost.ts`, `s1b.ts`, `s1c.ts` | `JellyView` build and `update()` cost; `RestMapper.locate`; a cube-map nearest-vertex accelerator | locate 7.7-15 us (best of 3 reps, machine shared with other agents: spikes 3-6x); 10242 / 5762 / 2562 locates ~79 / 45 / 23 ms; geodesic build 8-13 ms; `update()` best 1.2 / 2.8 / 3.6 ms; the accelerator agrees with brute force on 99.6-99.8% of vertices (not exact, so not recommended) |
| S2 | `s2_cap_mesh.ts` (`RELAX=12` for the relaxed run) | radial remesh of a clipped piece on the repo's 642-vertex icosphere, 8 cases, plain vs rim-snapped | table in section 2.2: 70-90 straddling triangles, bevel 0.076-0.093 R0 mean, 0 after snapping; min cap angle 8.7-15.7 degrees (2.7 oblique) -> 21-36 after relaxation (oblique stays 2.7) |
| S3 / S3b | `s3_eyes.ts`, `s3b.ts` | eye reach vs random swipe planes, all 50 species x 1500 valid cuts; Split in two clearance | 46.3% clipped (35-54%), 21.0% opposite sides, 79.0% one piece eyeless; Split in two touches an eye in 3 of 50 at rest size, 5 at 1.24x |
| S4 | `s4.ts` | brute-force closest point over 1280 triangles | 72-87 us per query warm (172 queries 12-15 ms) |
| S5 | `s5_chamfer.ts` (`FREQ=24`) | geodesic fine mesh over a snapped piece: fine triangles mixing face and skin | 246 / 11520, chamfer edge 0.07-0.08 R0 mean, up to 0.175 R0 |
| S6 | `s6_chunk_centroid.ts` | mass-weighted mean of the chunk's FLAT goal | (-0.073, 0, 0) R0 side; (0, -0.034, 0) vertical; rest shape 0.0000 |
| S7 | `s7_chunk_launch.ts` | real `SoftBody` chunk: peak COM speed with the goal as is / centred / rounded from t = 0 | dimpla 11.75 -> 0.32 -> 0.00 m/s; chunkle 7.70 -> 0.24 -> 0.00; dollop 2.20 -> 0.15 -> 0.00 (side cut) |
| S8 | `s8_fine_budget.ts` | per-piece fine resolution over every partition | worst total / whole: 1.923 high, 1.890 med, 2.501 low; naive 6.0x |
| S9 | `s9_subdiv.ts` | prototype of the subdivision-native piece mesh with the class split; inward depth rays | vertices `T n^2/2 + 2` plus 40 n crease duplicates, triangles `T n^2`, no edge used 3 times; builds 5.8 / 11.3 / 7.3 ms (n = 2 / 3 / 4, unoptimised); 200 depth rays x 1280 triangles 30 ms (so a thickness map instead) |
| S10 | `s10_simnormals.ts` | `simNormals`, `relaxNormals` on 642 vertices / 1280 triangles | 0.098 / 0.159 ms min each; the three calls 0.41 ms min, 0.53 median, 0.61 max (loaded machine) |

Files the render lane would touch: `src/contracts.ts` (types), `src/render/jelly.ts` (`PieceBuild`, subdivision, split normals, `PieceLocator`), `bodyview.ts`, `face.ts`, `core.ts`, `halo.ts` (scaling only), `material.ts`
(attributes, uniforms, `CAP_STAGE`, `CAP_LOOKS`, program key), `fx.ts` (`Glitter.layout`), `rarity.ts` (stars, group effects), `cutfx.ts`, `stage.ts` (`localClippingEnabled`, anchor groups, clock inherit, idempotent `addBody`, peek, `setCutSeam` opts),
`bodyproxy.ts`, `stubBody.ts`, `_harness/renderview/view.ts`, `_harness/browser_render.mjs`. Outside the lane: `src/shell/bodies.ts` (D14), `src/physics/*` (R1-R7).

Not measured, stated plainly: GPU cost of the cap shader and of 6 pieces (no browser allowed in this task), the look of any face (nothing was rendered), the clipped-eye path (never run), and the CPU numbers above are from a machine shared with other agents, so
treat them as bounds. Everything else in the tables above was computed by the scripts named.
