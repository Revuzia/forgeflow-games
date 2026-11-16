# CUT2_SHELL: the TRUE CUT, SHELL and PRODUCT lens

Design memo, 2026-10-08. Author lens: SHELL (src/shell/cut.ts, bodies.ts, game.ts, src/ui/cutBar.ts, the audio cut/rejoin voices as a consumer).
Designer only: nothing under src/, _harness/, _spec/ or public/ was edited. Every statement about what the code does today comes from a file read this
session and carries path:line (tree as read on 2026-10-08; the SHELL-4 fix round is editing cut.ts and the harness right now, so line numbers may drift
by a few). Feasibility scripts: `_handoff/design/CUT2_SHELL_scripts/` (run `node <script>.ts` from the game folder; they import the repo's pure modules
and the real SoftBody by absolute file URL).

Owner request (2026-10-08): "when I SPLIT, it just takes out a little ball and the squishy itself splits, but I wanted a REAL cut, like if I cut a
squishy in half, one eye is on one side and one is on the other. These are clean cuts, not a little ball/piece."

---------------------------------------------------------------------------------------------------------------------------------------------------

## 0. The design in one page

1. **A piece is a REGION of the original squishy, not a body type.** Every piece is the part of the original silhouette that lies on its side of the
   cut planes, with a flat cut face where each plane went through. There is no "face piece" and no "chunk" any more: no role, no flag, no special draw
   path. A centre cut between the eyes gives one eye on each half because the eyes are part of the region that goes with each side.
2. **The shell owns the cut algebra, exactly.** The shell keeps an explicit cut TREE; a piece is a set of leaf cells (a union of convex cells); a cell is the path of signed plane
   literals from the root (+k = side A of cut k, -k = side B). Cutting a piece splits only the leaves the plane really crosses, joining unions the leaves and collapses
   sibling pairs back into their node. When the set is `{ root }` the squishy is whole: the shell then swaps in a fresh `createBody(genome)`. Bit-for-bit original, by
   construction, for ANY sequence of cuts and joins in ANY order (section 3, with a property test). The planes are floats in the whole's REST frame and are never compared.
3. **The physics builds a body from (genome, region)**: clip the rest silhouette by the cells, re-mesh radially from the piece's own centroid on the
   unchanged icosphere topology (642 vertices, 162 under 0.35), scale to the exact volume share. Same topology, same solver, same shape matching. The
   flat cut face is part of the REST shape, so there is no "rounds over in 2 s" transient (decision: cut faces stay flat).
4. **The play body is the ANCHOR piece**: the larger child of the last cut of the anchor, ties to side A. It has no visible role (identity, HUD, history,
   Hoard, camera framing do not depend on it). It exists only because `BodyManager.body` must be something (section 5.1). A cut NEVER calls `stage.setBody` (that
   rebuilds every other piece's view; CUT2_RENDER measures 25-80 ms per view build): the new `BodyManager.promote` re-points the play body at an extra and the
   stage's primary with a new optional `StageLike.setPrimaryBody(id)`.
5. **Cutting**: swipe -> plane through the camera (unchanged) -> `body.planCut(plane, out, 'at')` (new, physics) -> limits -> neck + seam (kept, shallower
   by family) -> at t = 1 the two pieces are built from the child regions, placed rigidly where the parent's two halves stood, with the lobes' velocities,
   then parted by a short SCRIPTED open-loop `moveTo` (replaces the closed-loop steering stopgap). Measured: it opens the gap to start + G and holds it
   with no drift (section 2, M7).
6. **Split in two = the median plane (exactly half the volume) of the LARGEST piece**, plane chosen among 4 vertical candidates for the most compact
   halves (first press always the camera-vertical plane, as CUT.md says). Measured on the 50 rest shapes: 6 pieces in 5 presses on 50 of 50, smallest
   piece exactly 1/8 (section 2, M3). This kills the F1 stall by construction.
7. **Reconnect**: any two pieces can join, and the merged piece is ALWAYS a true part of the squishy (same rule as CUT2_RENDER D12). Two pieces that touch across a
   cut face and whose union is a sound body fit exactly: their facing cut faces light up when they come near, the cut between them disappears. Two pieces that do
   not touch (piece 1 and piece 4 of six) join through the smallest convex part of the squishy that holds both, and every piece inside that part comes with them
   ("Joined 3 pieces into one."); joining the last two is the root = the original, bit-for-bit. A join needs a deliberate act no other verb produces: a piece
   DRAGGED or CARRIED into another and held for 0.4 s, or a carried piece SET DOWN slowly while touching. A tap, press, squeeze, rub, stretch-and-release,
   toss or a bump never joins (fixes F2 for good, section 5.4). The "lump" alternative I first designed is kept as owner question 1, option B.
8. **The launch (F3, "pushes itself off its cut face at 1.5 to 14 m/s") has a named, reproduced cause** (section 1, M1): `flatPoints` leaves the
   mass-weighted centroid of the flat-face goal 0.072 R0 off the rest centre, and the shape-matching goal `GOAL = c + R*QG` (softbody.ts:1980-1982)
   drags the whole body along -cutNormal every substep while flatK > 0. Re-centring that one goal removes it (peak 4.4-14.4 m/s -> 1.9-2.3 m/s, which is
   the 0.6 m drop of my test rig). The true cut has no FLAT goal at all, and the invariant "every goal term has zero mass-weighted mean" becomes a physics
   probe.
9. **Nothing in the meter, audio, haptics or the leave paths changes** except the numbers they are fed: the meter maps SoftEvents with no body id
   (collection/meterfeed.ts:43-65), so a piece is a squishy; cut and reconnect still make no SoftEvent.
10. **Order**: contract freeze -> prep refactor (strings and cut wiring out of src/ui and hudBinding.ts so the UI overhaul never touches cut files) ->
    PHYS true-cut core in new files first, SHELL rewrite against a mock in parallel, RENDER eyes in parallel -> integration -> independent verification
    -> UI overhaul batch 3 and the LOCK / multi-pull round (both after, because both edit files this round edits). About 9.5 engineer-days for SHELL,
    roughly 35 across lanes (RENDER's own estimate is 13) plus about 4 for verification (section 8).

---------------------------------------------------------------------------------------------------------------------------------------------------

## 1. What the code does today (verified), and what that forces

| # | Fact | Where | Consequence |
|---|------|-------|-------------|
| 1 | A cut is `setNeck(plane, t)` for NECK_S (0.25 s default, 0.3-0.4 by family) + `NECK_HOLD_S` 0.08 s, then the parent is REPLACED by two new bodies built with `createBody(genome, { piece: { frac, chunk, cutNormal, at, vel } })` | cut.ts:43-46, 315-359; softbody.ts:1299-1309 | the neck + swap skeleton survives; only what is built changes |
| 2 | The face piece is the WHOLE species silhouette scaled by cbrt(frac) (`buildRest`), every other piece an eyeless "chunk": a 1.1 x 0.85 x 1.1 ellipsoid with a flat-face GOAL that rounds over (ROUND_TAU 2 s, putty 1 + memStiff = 6 s) | softbody.ts:279-292 (pieceRest), 702-710 (FLAT); shape.ts:239-294 (buildChunkRest, flatPoints) | this is exactly "a shrunken whole squishy plus a ball"; all of it is deleted |
| 3 | The face goes with the side that held `faceAnchor` = (0, 0.08 R, 0.9 R) in the body frame; judged at the START of the neck because the necked peanut can rotate the anchor onto the other lobe | cut.ts:162-167, 304-308, 322-323, 340-345 | role logic and `faceAnchor` are deleted; eye ownership becomes geometry in RENDER |
| 4 | Render hides the face on chunks: `AddBodyOpts.chunk` -> `BodyView.chunk` -> `faceHidden`, `face.update` skipped, rarity group hidden; bodies.ts passes `chunk: true` for every piece extra | bodyview.ts:69-72, 120, 211; bodies.ts:108; contracts.ts:296-303 | `chunk` becomes deprecated; RENDER reads `body.region` instead |
| 5 | The closed-loop "steering" stopgap: after the swap each chunk is `moveTo`-steered to a measured SURFACE gap of SETTLE_GAP 0.16 m from its twin for SETTLE_S 0.8 s, horizontally, because (a) chunks push themselves off their face and (b) pieces are BUILT overlapping by 0.2-0.5 m | cut.ts:63-75, 195-226, 353-354, 558-564 | removed (section 5.5); replaced by an open-loop scripted parting |
| 6 | Touch-to-join after fix round 1: a contact STARTS only when a grab's hand moved >= DRAG_TOWARD_K 0.25 of the piece's radius toward the other piece (`dragsInto`, `driver.touch.dragOf`); kept with hysteresis TOUCH_KEEP_GAP 0.09; joins after JOIN_HOLD_S 0.4 s or on release while touching | cut.ts:81-89, 241-244, 604-631; driver.ts:124-134 | the gating idea survives; two false positives remain (stretch-and-release, toss) and are closed in 5.4 |
| 7 | Split in two = vertical plane through the camera and the LARGEST piece's centre of mass, with a bisection fallback (`halving`) only when the middle plane would leave a part under 1/8; `canSplit` = pieces < max and some piece >= 2 x PIECE_MIN | cut.ts:260-282, 491, 521-538 | replaced by the median plane + candidate selection (5.3) |
| 8 | Reconnect all flows every chunk into piece 0 (the face piece) over JOIN_ALL_S 1.2 s with a held bridge gap, then the face piece glides to the table middle (HOME_MAX_S 1.6) and is REPLACED by `createBody(genome)` | cut.ts:456-469, 539-554, 381-408 | kept; the survivor is the anchor |
| 9 | The meter reads SoftEvents only: poke (a tap, pays 0), release >= 0.4 s (squeeze), snap (pull); bump, land, grab, press are not touches; there is no body id and no size in the mapping | collection/meterfeed.ts:43-65 | nothing to change for pieces (4 in the brief) |
| 10 | Audio: `audio.cut({ phase: 'start', frac: smaller share of the WHOLE, neckS, family, pan, calm, pitch })` at the neck start, `{ phase: 'separate', frac }` at the swap, `audio.rejoin({ frac: merged share, all? })` at the end of a join | cut.ts:310, 356, 372, 593; contracts.ts:271-276 | unchanged contract; the numbers it is fed stay the same kind |
| 11 | A "whole squishy built at its mat spot" uses `PieceOpts { frac: 1, chunk: false, at }` | boot.ts:111-112; mat.ts:9 | `chunk` must stay in `PieceOpts` as an optional legacy field; do not break the mat |

### The cause of the launch (VERIFY_SHELL4_A F3, SHELL_4 "Known issues"), named and reproduced

softbody.ts builds a chunk's flat-face goal `FLAT` with `flatPoints` (shape.ts:282-294): it pulls every point beyond the plane at 0.55 R0 down onto that
plane, then scales about the ORIGIN so the volume is unchanged. It never re-centres. The mass-weighted centroid of `FLAT` is therefore not zero. Each
frame `GB = (Q + flatK (FLAT - Q)) * scale` (softbody.ts:2390-2397) and each substep the shape-matching goal is `GOAL_i = c + R * QG_i`
(softbody.ts:1980-1982), pulled to with `XP += (GOAL - XP) * K * soft`. A goal whose mass-weighted mean is not zero moves the body's centre of mass by
K x mean per substep: a net force with no reaction, along -cutNormal, i.e. AWAY from the cut face, for as long as `flatK` decays (2 s; 6 s putty). The
code base already knows the rule for its other goal terms (the memory arm is re-centred, softbody.ts:2581-2582; the slosh field subtracts its mean,
softbody.ts:1967-1968) but not for this one.

Independent reproduction (M1 below): real `SoftBody`, a chunk built exactly as the shell builds it, no fingers, 1.5 s, then the same chunk with ONLY its
`FLAT` goal re-centred in place, and the face piece as control.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 2. Measurements (feasibility scripts, all in `_handoff/design/CUT2_SHELL_scripts/`)

**M1. Where the launch comes from** (`m1_launch_cause.ts`; real SoftBody, node 22, 1.5 s, piece built at (0, 0.6, 0), no velocity, cut face toward -x).
- Geometry: mass-weighted centroid of `FLAT` = (+0.072, 0, 0) R0 for fractions 0.125, 0.25, 0.5, 0.75 (0.018 m ... 0.033 m); centroid of the rest shape = 0.
- Peak centre speed in 1.5 s, chunk as built / chunk with FLAT re-centred / face piece (control), m/s, and the farthest horizontal drift in m:
  dollop 0.5: 4.43 / 2.05 / 2.04, drift 0.94 / 0.05 / 0.00. kneadle 0.5: 7.67 / 2.09 / 1.98, drift 1.74 / 0.20 / 0.03.
  chunkle 0.5: 9.94 / 1.99 / 1.00. thudge 0.25: 10.05 / 2.22 / 2.03. prismelo 0.25: 12.97 / 2.07 / 1.79.
  diademo 0.5: 14.19 / 1.96 / 1.79. dimpla 0.25: 14.19 / 2.25 / 2.36 (drift 2.50 m = the mat rim).
- Reading: the 1.5 to 14 m/s of the report is reproduced (4.4 to 14.4 here); re-centring ONE goal brings every species to 1.85-2.25 m/s and 0.05-0.26 m of drift, the same order as the
  face-piece control (1.0-2.4 m/s, 0.00-0.04 m): that residue is the landing from the rig's 0.6 m drop, not a launch. **Cause confirmed.** Same defect class elsewhere: the fold sphere QS has
  centroid <= 0.013 R0 (M6, 5x smaller); `neckGoal` is not checked here: the new invariant test covers every goal term.

**M2. A push does not part pieces** (`m2_push_travel.ts`): a centred piece (frac 0.5) given v0 = 0.22 / 0.6 / 1.2 m/s on the table travels 0.01-0.14 m in
0.25 s and is back within 0.06 m of where it was by 1 s, 8 species. Pieces stay where they are PLACED. So the old `vel: n * 0.22` push (cut.ts:327-328)
never separated anything. What closed the pieces up again in F2 (0.12 m at 1 s to 0.03 m at 3 s) is therefore not momentum; M7 shows a gap between centred pieces holds for 4 s, so the
candidate cause is the M1 force (a flung chunk returns off the mat's soft rim, RIM_BOUNCE softbody.ts:222). Not proven here: risk R11 re-runs the F2 repro on the new build.

**M3. The keyboard player's route to six pieces** (`m3_split_sequence.ts`, `m3_d.ts`; exact nested regions on the 50 REST shapes, volumes and covariances
integrated along x over 96 x 96 columns; grid allowance 0.002 on the 1/8 test, normals offset 7 degrees from the grid axes to avoid a staircase artefact).
Split in two repeated on the largest piece, a part under 1/8 or the limit 6 stops it:
| rule | reach 6 pieces | smallest piece | worst "aspect" of the final pieces (sqrt of smallest / largest covariance eigenvalue; 1 = ball, 0.1 = pancake) |
|------|---------------|----------------|-----------------|
| A: plane through the piece's centre of mass, same normal | 50 of 50 (grid allowance) | 0.1237 (under 1/8 on some species: the shell would refuse it) | min 0.06, median 0.11 |
| B: median plane (exact half volume), same normal | 50 of 50 | 0.1250 | min 0.05, median 0.10 (parallel slabs) |
| C: median plane, 4 vertical candidate normals (0, 45, 90, 135 deg), most compact halves | 50 of 50 | 0.1250 | min 0.15, median 0.28 |
| **D: as C but press 1 always the camera-vertical plane (CUT.md)** | **50 of 50** | **0.1250** | **min 0.15, median 0.28, p90-best 0.44** |
The first press through the centre of mass gives a +x share of 0.471 to 0.532 across the 50 species, so the middle plane is not a halving plane; the median plane halves by construction.
(The grid's own volume steps are about 1e-3, which is why the 1/8 test above carries an allowance; the real physics computes exact clipped volumes.)
Repeated parallel cuts make pancakes (aspect 0.05): rule D is the recommendation, and it is what makes "Split in two" worth a button.
Note on rule A: with TRUE parts the centre-of-mass rule almost works (the old stall came from lopsided chunks), but 0.1237 is under 1/8 and would be refused by the shell's own test on some species,
and A is the rule that produces the thinnest slabs. Rule D removes both.

**M4. How thin are real swipes** (`m4_swipes.ts`; 50 species x 120 random player-like swipes = a plane through the camera and a random screen line over
the squishy): 25.0 % are refused as under 1/8 (the existing rule, "Too small to cut there"); of the accepted first cuts the thinner part has aspect
min 0.10, p5 0.23, median 0.41; only 0.4 % are under 0.15. So a first cut never needs a sliver guard; slivers come from repeated PARALLEL cuts (M3 rule B),
hence the shell supports a generic refusal `thin` (ASPECT_MIN 0.08, PHYS may raise it) that fires almost only there.

**M5. Constructor cost today** (`m5_build_cost.ts`; node, median of 15 after warm-up): whole 20-54 ms, face piece 9-23 ms, chunk 3-5 ms (detail 2: 1-3 ms);
maxima 200-300 ms (JIT/GC). The current swap frame builds a face piece AND a chunk in one frame (12-26 ms median, summing the medians) plus two stage views. The true cut adds a
clip + radial re-mesh per piece, so the swap frame is a real budget risk: section 5.2 pre-builds the pieces during the neck and prewarms on tool pick.

**M6. Same defect class** (`m6_qs_centroid.ts`): centroid of the fold sphere goal QS over 50 species: max 0.013 R0 (capnap), median 0.003. Not a launch.

**M7. The scripted parting replaces the steering** (`m7_scripted_parting.ts`; two centred pieces, frac 0.5, skins touching, `collide()` every frame): targets
`base +- 0.5 G smoothstep(t / PART_S)` via `moveTo(..., 3)`, then `moveTo(null)`. G = 0.16, PART_S = 0.45: the surface gap goes from the start gap
(0.033 dollop, 0.003 wrigglo, -0.007 kneadle, 0.041 chunkle, 0.037 diademo) to start + G within 0.6 s (0.184 / 0.143 / 0.137 / 0.191 / 0.186 m), then holds
to 4 s with peak centre speed after the release <= 0.02 m/s and vertical drift <= 8 mm. G = 0.06, PART_S = 0.30: 0.087 / 0.040 / 0.037 / 0.094 / 0.089.
No closing up, no launch, no measuring of the gap: an open-loop script is enough once the pieces carry no goal force and are born flush.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 3. The model: regions, literals and the exact algebra (new pure module `src/shell/cutRegion.ts`)

```ts
export type Literal = number;                 // +id = side A of cut `id`, -id = side B   (ids start at 1, never reused until the squishy is whole again)
export type Cell = readonly Literal[];        // sorted by |literal|, no id twice; the INTERSECTION of those half-spaces (with the species silhouette)
export interface Region { cells: Cell[] }     // a UNION of cells.  [[]] (one cell, no literal) = the whole squishy
export interface RestPlane { id: number; n: V3; d: number }   // unit n; side A is n . p >= d, p in the whole's REST frame (physics-produced, never compared)
```
(These three types are the SERIALIZATION handed to PHYS: a piece is `Region { cells }` plus the planes its literals name. `[[]]` = the whole.)
The truth the shell keeps is an explicit CUT TREE of nodes (not literal sets), because the same plane id can split several cells of one piece and literal coincidences would then lie:
```
Node  = { parent, kids: [A, B] | null, lits: Literal[] /* the path from the root, which is what PHYS gets for a leaf */ }      // root: lits [], a leaf has kids === null
piece = a set of LEAF nodes (its cells);  fracs come from PHYS (body.frac), never from the tree

cutPiece(P, id, cellFa[i] for each leaf i of P)       // PHYS says how much of each leaf lies on side A (plan.cellFa, section 4)
   cellFa ~ 1  -> the leaf lies wholly on A: it goes to piece A unchanged (NO new node: the plane is not a boundary of this cell)
   cellFa ~ 0  -> wholly on B: goes to piece B unchanged
   otherwise   -> the leaf is split: kids = [leaf + [+id], leaf + [-id]]; the A kid goes to A, the B kid to B
joinPieces(S)     -> the union of their leaf sets, then collapse: whenever BOTH kids of a node are in the set, replace them by the node (repeat to a fixpoint)
isWhole(set)      -> set is exactly { root }
group(P, Q)       -> N = the lowest common ancestor node of every leaf of P and Q;  S = every piece with a leaf under N;  N = the LCA of every leaf of S;  repeat until stable
                     (terminates: N only moves up; at worst N = root and S = every piece = the whole squishy).  Result: ONE convex node N whose leaves are exactly the leaves of S.
touches(P, Q)     -> true when a leaf of P and a leaf of Q have exactly one opposing literal (same plane id, opposite sign): a cheap necessary test for "share a cut face"
```
Facts, each with a test in section 7 (N13):
- A cut splits only the cells the plane really crosses, so there are no dead cells and a cell is never empty. The cells of ALL live pieces are exactly the leaves of the tree.
  Joining never creates a cell that is not a union of leaves. Therefore **joining all pieces, in any order, collapses to `{ root }`**: the deepest node with both kids present always exists.
  The shell then calls `createBody(genome)`: the original, bit-for-bit.
- The sibling join of a piece cut apart returns EXACTLY the parent's leaf set, whatever happened in between (tosses, other cuts elsewhere, other joins).
- `group(...)` ends at a single convex node whose volume is the sum of its pieces' fractions (a valid body by construction; the tree node's `lits` are its planes).
- `MAX_LEAVES = 64` is a hard refusal ('limit' text) that cannot be hit with 6 pieces because joins collapse siblings (tested with 100 000 random operations).
- `touches` is a pre-filter only; face contact itself (positive area) and "the union is a sound body" are PHYS' `faceContact` and `joinable` (section 4).
- Region objects handed to PHYS are the leaves' `lits` arrays plus the planes they name (`PieceRegion`, section 4); PHYS never sees the tree.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 4. Contract additions (`src/contracts.ts`, all optional and additive; ONE editor at the freeze: the orchestrator)

**Reconciled with CUT2_RENDER.md (its section 2.1), which I read at the end of this task.** Two ends of one pipe, two types:
- INPUT, shell -> PHYS: `PieceOpts.region` (below): the leaf paths of the cut tree as signed plane ids. The shell owns the algebra.
- OUTPUT, PHYS -> RENDER (and the shell's read-back): RENDER's `SoftBodyLike.piece?: PieceInfo { whole, offset, rayOrigin, cells }`, cells as explicit planes whose normals point OUT of the piece.
  PHYS derives it from the region: literal +id (side A of plane k, n . p >= d) is the outward plane { n: -n_k, d: -d_k, id }; literal -id is { n: n_k, d: d_k, id }. The plane ids are the shell's cut ids,
  stable for the life of the cut, and the two faces of one cut carry the same id (RENDER relies on it).
- The shell needs no `region` echo and no `restOrigin` on the body: `piece.offset` is the body's rest origin in the whole's rest frame (RENDER: restLocal_piece = whole point - offset) and `piece.cells`
  are the live cells. (An earlier draft of this memo had `region`, `restOrigin` and `regionExact` on the body: dropped. Every merged piece is a true part now, so there is no "exact or lump" flag.)

```ts
/* TRUE CUT (_spec/CUT.md, CUT2): a piece is the real part of the squishy on its side of the cut planes. */
/** A plane in the WHOLE squishy's rest frame (origin = the whole's rest centre of mass, axes = its rest axes, metres). Side A: n . p >= d. */
export interface RestPlane { id: number; n: V3; d: number }
/** Which part of the whole a body is, as the shell says it: a union of convex cells; each cell is a list of signed plane ids (+id: side A, -id: side B)
 *  whose intersection, with the species silhouette, is that cell. cells [[]] (or no region) = the whole. `planes` holds every plane the cells name. */
export interface PieceRegion { planes: RestPlane[]; cells: number[][] }

export interface PieceOpts {
  /* existing: frac, chunk, cutNormal, at, vel.  When `region` is given: `chunk` and `cutNormal` are ignored, `frac` is the shell's expectation only (the body measures its own). */
  region?: PieceRegion;
  /** the best-fit rotation the piece starts with (the parent's SoftBodyLike.frame); default identity. Without it a tilted parent pops at the swap. */
  frame?: { x: number; y: number; z: number; w: number };
}

export interface CutPlan {
  /** the plane in the whole's rest frame (the shell gives it its id), normal toward side A */
  rest: { n: V3; d: number };
  /** share of THIS body's volume on side A, 0..1, measured on the REST clip the children are built from (so it is what you get) */
  fa: number;
  /** per cell of THIS body (the order of body.piece.cells; 1 cell for a whole): the share of that cell on side A. ~1: wholly A, ~0: wholly B, between: the plane splits it. Preallocated, 64 entries. */
  cellFa: number[]; cellN: number;
  /** where each child's rest origin lies, in THIS body's rest-local frame (rigid placement: world = this.center + R(frame) . off) */
  offA: V3; offB: V3;
  /** mean world velocity of each half of the current mesh (momentum is conserved across the cut) */
  velA: V3; velB: V3;
  /** how compact each child would be, sqrt(smallest / largest covariance eigenvalue), 0..1 (1 = ball, 0.1 = pancake) */
  aspectA: number; aspectB: number;
}
export interface SoftBodyLike {
  /* existing CUT members stay: frac, measureCut, setNeck, setFrac, collide;  RENDER's: readonly piece?: PieceInfo */
  /** Pure. 'at': the plane as given. 'median': ignore plane.point, find the offset along plane.normal that halves the volume (to 1e-5). Returns false when the
   *  plane misses the body. No allocation (fills `out`). */
  planCut?(plane: CutPlane, out: CutPlan, mode?: 'at' | 'median'): boolean;
  /** Morph the rest shape AND volume to `region` over `seconds` (the receiver of a join). End state = a body built from that region. */
  setRegion?(region: PieceRegion, seconds: number): void;
  /** Put a freshly built piece (before its first step) at world `at` with velocity `vel` and rotation `frame`: lets the shell build during the neck. */
  placeAt?(at: V3, vel: V3, frame?: { x: number; y: number; z: number; w: number }): void;
  /** Pure, on any body of the genome. Do the two regions touch across a cut face (positive area) AND is their union a sound body (face-connected, star-shaped from its centroid)? */
  joinable?(a: PieceRegion, b: PieceRegion): boolean;
  /** setNeck gains an optional depth 0..1 (1 = today's waist 0.3 of the width; 0.4 = a groove). */
  // setNeck?(plane: CutPlane | null, t: number, depth?: number): void;
}
export interface StageLike {
  /** Make an existing view the one the camera follows (the primary), tier-styled; removeBody(primary) is allowed once another is set. Lets a cut change the play body WITHOUT setBody. */
  setPrimaryBody?(id: number): void;
  /* CUT2_RENDER: setCutSeam gains an opts { from, to } (the swipe's two ends on the plane, world space) */
}
export interface AddBodyOpts { /** @deprecated TRUE CUT: honoured only for a body without piece; RENDER reads body.piece */ chunk?: boolean }
```
- **SquishAudio, Settings: no change required.** `setCutSeam` is reused for the matching-face glow (the jelly shader's seam is `exp(-d^2)` of the signed distance to the plane, material.ts:256-260, so a flat face lying on the plane glows over its whole area).
- **Feature detection (the Cut tool exists only when the play body offers)**: `planCut`, `setNeck`, `setRegion`, `joinable`; the stage offers `setPrimaryBody` (without it the shell falls back to `swapTo`, with RENDER's measured cost). An older physics hides the tool, exactly as today.
- **Dev only** (`createStageDev`, out of production): `eyeCentres(viewId)` -> world centres of the visible eye beads and how much of each is clipped.
- **PHYS may shape these differently** (their memo owns the geometry). The SHELL requirements behind each member are: exact region volumes (fractions sum to 1 to 1e-9), a median mode, which cells a plane really
  crosses, rigid offsets, lobe velocities, a morph for joins, a build-time placement hook, a union-soundness predicate, and "never a body we cannot step".

---------------------------------------------------------------------------------------------------------------------------------------------------

## 5. The shell design

### 5.1 The piece manager without roles

State (cut.ts): `pieces: Piece[]` (empty = whole), `Piece = { body, leaves: Node[], frac, built, anchor: boolean }`; `planes: RestPlane[]` (the session's cut table);
`nextId`; `anim` (neck | join | all | home); `parting[]` (scripted partings in flight); `intent` (the join state machine, 5.4). `fracs()` returns `body.frac`
truth, anchor first.

**Which piece is the play body (the identity the HUD, history and Hoard see)?** Identity (genome, itemId, nickname, tier) was never a property of a body: it is
`BodyManager.identity`, and it does not change when pieces are made (swaps use `silent: true`). What `BodyManager.body` decides is only: the stage's primary view
(framing, tier styling), the gravity setting target, and the default target of the keyboard (Space pokes `host.screenCentre()` of the active body). Rule:
1. **The anchor is the body that is `BodyManager.body`.** It changes only when the anchor itself is cut: the LARGER child becomes the new play body (tie: side A), the other child is an extra.
   Cutting any other piece never changes the anchor. It changes through a NEW `BodyManager.promote(body)` (silent, identity untouched): both children are first added as extras
   (`addExtra`), then the old anchor's view is removed (`stage.removeBody`) and the larger child's view is made the primary with the new optional `stage.setPrimaryBody(id)`.
   **It must not use `swapTo`**: `swapTo` -> `commit` -> `stage.setBody` = `clearBodies` + `addBody`, then `showExtra` for every extra (bodies.ts:110-118), i.e. it rebuilds every other piece's view; CUT2_RENDER
   (8.5, D14) measures 25-80 ms per `JellyView` build, so a cut of the anchor with 5 other pieces would stall 125-400 ms and restart every view's clock, blink phase and cut-face sheen.
   Today's code pays this only for the face piece; the true cut would pay it on most cuts. Without `setPrimaryBody` (an old stage) the shell falls back to `swapTo`. `promote` runs the same
   `beforeSwap/afterSwap` hooks as `swapTo` (release fingers, `resetBody`, `resetPull`, gravity, ring reset), `silent: true`.
2. A pairwise join never changes the anchor: the anchor is the RECEIVER whenever it is one of the two (5.4), so it survives every join; both bodies move to the volume-weighted
   meeting point, so which one survives is invisible. Reconnect all gathers into the anchor, which the final `swapWhole` replaces last.
3. No other code may ask "is this the face piece": `Piece.chunk`, `faceAnchor`, `AddBodyOpts.chunk`, `Cutter` doc text, the debug hook's `faceAnchor` and
   `stageViews().faces/chunks` are deleted or renamed (section 7).

Surfaces while the squishy is cut:
| Surface | Behaviour while cut | Change from today |
|---|---|---|
| HUD name tag, tier gem, nickname | the squishy's name and tier; it never says pieces | none (identity-based) |
| Cut bar | "N pieces" count, Split in two / Reconnect all / Done, hint text (5.7) | text only |
| Meter ring | a piece's touches pay exactly like a whole squishy's; cut and reconnect make no SoftEvent | none |
| Hoard button, H, a card's "Play with this one", the quick switcher, a merge | `leaving()` = `reconnectAll(false)` first (instant); on desktop the Hoard asks for the animated one while the stage stays visible; the Hoard never lists a piece | none |
| Meter-full capsule | it drops and lands as normal (the capsule spot avoids all bodies); tapping or holding it runs the ceremony: `beforeStart` -> `leaving()`, `setTool('hand')`, `mat.clear()` | none |
| "Wake it up" (title card) | pieces cannot exist before `phase = play`; leaving play (`setPhase`) drops the tool to Hand and releases everything; a reload is whole (nothing is stored) | none |
| Keyboard Space / Enter | pokes the active body, which defaults to the anchor | none (document it: the anchor is the larger child, so it is usually the big one) |
| Settings gravity / quality change while cut | `settingsCtl.onChange` already loops the extras; a quality drop below the piece count only blocks NEW cuts (`limit`) | none |

### 5.2 Cutting

**Swipe -> plane** is unchanged: the plane through the camera that contains the swipe (cut.ts:493-520), target = the piece the 13 sample rays hit most.
A swipe cuts ONE piece (owner question 3). The plane is handed to physics in WORLD space; physics returns the rest-frame plane.

**Pipeline** (`startCut(p, plane, how)`):
1. `ok = p.body.planCut(plane, plan, 'at')`; false -> `miss` (as today).
2. Share bookkeeping: `fa = plan.fa`; `small = min(fa, 1 - fa) * p.frac`; the two absolute shares are `p.frac * fa` and `p.frac * (1 - fa)`.
3. Refusals, in this order, each with the wobble (`tremble(0.35)` for 0.28 s) and one live-region line, nothing replaced:
   - `small < PIECE_MIN - PIECE_TOL` -> `small` ("Too small to cut there. Try nearer the middle."; "That piece is as small as it gets." when `p.frac < 2 PIECE_MIN`).
     `PIECE_TOL = 1e-4` of the whole (today 1e-6, cut.ts:289): an exact halving of a 1/4 piece is 0.125 +- 2.5e-6 once the median search stops at 1e-5, which a 1e-6 test would refuse;
     PHYS lowers its constructor clamp (softbody.ts:202, 526 `FRAC_MIN` 0.125) to 0.124 so such a piece is built as measured and fA + fB stays exactly the parent's;
   - `list().length + 1 > MAX_PIECES[quality]` -> `limit` ("That's as many pieces as it can make.");
   - `min(plan.aspectA, plan.aspectB) < ASPECT_MIN (0.08)` -> `thin` ("That would make a piece too thin. Try another angle.").
   Why the order: the player fixes `small` by moving the swipe, `limit` by joining, `thin` by turning it.
4. First cut only: `clearMat()` and its line ("The other squishy went back on the shelf." / "The other N went back on the shelf."), `pieces = [wholePiece]`.
5. Allocate the cut: `id = nextId++`, `planes.push({ id, n: plan.rest.n, d: plan.rest.d })`; `cutPiece(p, id, plan.cellFa)` splits only the leaves the plane really crosses (section 3) and gives the
   two children their leaf sets; their regions for PHYS are the leaves' `lits` plus the planes those name.
6. `anim = { kind: 'neck', p, plane, plan, id, t0, neckS, depth, view }`; `audio.cut({ phase: 'start', frac: small, neckS, family, pan, calm, pitch })` exactly as today.
7. The two children are PRE-BUILT during the neck (5.2.2).

**Where a plane may go (the brief's fact 1).** Nothing in the shell special-cases a feature: the region is geometry, so a plane through an eye, an ear, a horn, a tail, a star tip or a petal
just leaves a stub of that feature on each side (the rest points, floppy weights and struts of a piece come from the rest silhouette inside its region, PHYS). The faces have no mouth (face.ts header: "no
mouth"), so only eyes need rules (RENDER, section 6). What the 1/8 rule implies and the owner will meet: a thin feature alone is normally far under 1/8 of the volume (not measured per species; M4 shows 25 % of random swipes already refused for the 1/8 reason),
so an ear or a tail can usually not be cut off BY ITSELF; the line says "Too small to cut there. Try nearer the middle." A feature can be cut through, or split off together with a body part of >= 1/8.
The parent at cut time is normally at rest (the Cut tool pauses every other gesture, fingers are released at the swap), so the children's REST shapes replace a nearly-rest mesh; a parent that is still
wobbling pops by its deformation at that instant (measured by N10).

**Neck** (kept): every step `body.setNeck(plane, smooth(t / neckS), depth)` and `stage.setCutSeam(view, plane, k, { from, to })`; at `neckS + NECK_HOLD_S (0.08)` the swap.
`from` / `to` (CUT2_RENDER 6.3, so the glow runs along the swipe) are the two swipe rays evaluated at the target body's depth (both rays lie in the plane, so both points do); for Split in two they are the
plane's two ends across the piece's width.
`depth` is new and per family (a PHYS knob, shell table, to be tuned with the swap-continuity metric below): gel, gummy, water-fill, firm silicone, pop dome,
bead 0.35 (a groove: the knife presses in); slow-rise, marshmallow 0.5; putty, mochi 0.6; sticky, slime 0.9 (they string; the strand hides the swap).
Rationale: a deep peanut ends in rounded, swollen lobes and the swap replaces them with flat-faced halves, a bigger pop than today's; the known neck swell
(x1.84 putty, SHELL_4 cut-swell) is proportional to the pinch. Fallback if the metric cannot be met: depth 0 (seam glow only, then the parting).
Acceptance (new, N10): at the swap, the Chamfer distance between the necked parent's mesh and the union of the two new pieces' first-frame meshes <= 0.08 R0, and the
render harness' "cut-swap luminance step" is no worse than today's for each of the 11 families.

**5.2.1 The swap (`part`)**, atomic as today (a throw while building changes nothing):
1. `g = genome()`; for each child `c in {A, B}`: `at = parent.center + R(parent.frame) . off_c`; `vel = vel_c` (the lobe's mean velocity); `frame = parent.frame`.
   The pieces are therefore born exactly FLUSH: their cut faces lie on the plane, gap 0, no overlap, no launch, and no fall except the 5 cm plop of the lifted parting of a level cut (the top half
   of a level cut stands on the bottom half, which is the honest picture).
2. `createBody(g, { piece: { frac, chunk: false, region: child.region(+planes), frame, at, vel } })` for both (or the pre-built ones with `placeAt(at, vel, frame)`).
   After the build `piece.frac = body.frac` (the physics' own measure is the truth; fA + fB == parent frac exactly because the physics derives B = parent - A).
3. `d.beforeChange()` (fingers off), then `addExtra(A)`, `addExtra(B)` (both `{ shared: true, piece: true, itemId: null }`); parent is an extra -> `removeExtra(parent)`; parent is the anchor ->
   `promote(larger child)` (5.1; never `swapTo`). `bodies.ts:108` stops passing `chunk: true`. RENDER's `addBody` is idempotent per body object and a view build is budgeted at <= 8 ms warm (its P9);
   if P9 is missed, the fallback is an `AddBodyOpts.hidden` view added during the neck and shown at t = 1 (not planned, listed in risk R1).
4. `stage.partPieces(ia, ib)` (strand) and the seam carry-over, `audio.cut({ phase: 'separate', frac: min(fA, fB), ... })`, `haptics.poke()`,
   `say("Cut into N pieces.")` - all as today.
5. Start the scripted parting (5.5).

**5.2.2 Cost of the swap frame.** M5: today's swap builds two bodies in one frame (12-26 ms median, 300 ms worst). The true cut must not add a visible hitch:
(a) `prewarm()` on the first Cut-tool pick of the session: one `planCut` and one throw-away small piece built across three idle frames (pays the JIT);
(b) pre-build child A at neck progress 0.2 and child B at 0.6 (different frames, hidden, not stepped, not in any list) and `placeAt` them at t = 1;
(c) PHYS caches rest shapes by (species, size, region hash, detail). Budget (acceptance N11): the swap frame costs <= 8 ms of shell + physics work on this PC
and the P95 frame time in the browser harness (SwiftShader) does not exceed 33 ms around the swap. Without `placeAt` the shell builds at t = 1 (today's behaviour).
(d) The plan is REFRESHED at the swap: `planCut(sameWorldPlane, plan2, 'at')` again at t = 1 (the neck's plane is fixed in world space and the body may have wobbled for 0.33 s). If the rest plane moved by
less than 0.002 R0 and 0.2 degrees, the pre-built pieces are kept (velocities and offsets taken from plan2); otherwise they are dropped and rebuilt inside the swap frame. If the fresh plan now violates a limit
(`small`, `thin`), the cut is abandoned cleanly: neck released, seam off, wobble, the refusal line, nothing replaced.

### 5.3 Split in two (fix for VERIFY_SHELL4_A F1)

`splitInTwo()`: target = the LARGEST piece (ties: lowest index, i.e. anchor first, then creation order; deterministic). If `target.frac < 2 PIECE_MIN - 1e-6` ->
the button is disabled (`canSplit` false) and the line is "No piece is big enough to cut again. Join two to make a bigger one." (the old line, "Swipe near an
edge to peel off a small one", is false advice in exactly this state: a piece under 1/4 cannot give two parts of 1/8, whatever the swipe).
Otherwise:
1. `n0` = `cross(view ray to the piece's centre, camera up)` as today (cut.ts:530-536: the plane that looks like a vertical line through the piece on screen), then projected onto the
   horizontal plane and normalised (for a roll-free camera it differs from horizontal only by the small off-axis angle of the view ray).
2. If the squishy is whole: plane = `planCut({ point: centre, normal: n0 }, plan, 'median')`, k = 0 (CUT.md: a vertical cut through the middle as the camera sees it).
3. Else evaluate the four vertical candidates `n_k = rotate(n0, k * 45 deg about +y)`, k = 0..3, each with `'median'`; choose the k that maximises
   `min(aspectA, aspectB)`; prefer the smaller k unless the best beats it by more than 0.03 (stability).
4. `fa` is 0.5 to 1e-5 by construction, so both parts equal `target.frac / 2`: never refused as `small` while `target.frac >= 2 PIECE_MIN`; never `thin` on
   the 50 shapes (M3 rule D: aspect >= 0.15); only the limit applies.
5. The A/B sides and the rest of the pipeline are those of a swipe.

Reaching six: five presses make 6 pieces on 50 of 50 species (M3 D): sizes 1/2,1/2 -> 1/4,1/4,1/2 -> 1/4 x 4 -> 1/8,1/8,1/4 x 3 -> 1/8 x 4, 1/4 x 2, every piece >= 1/8 to
1e-5; the sixth press says "That's as many pieces as it can make." and the button is disabled. At low quality (4) the fourth press ends it. `canSplit` =
`list().length < max() && list().some(p => p.frac >= 2 * PIECE_MIN - 1e-6)`; the bar text for `!canSplit && pieces < max` becomes the "No piece is big enough" line above.
Tolerance: `PIECE_MIN` is tested with `PIECE_TOL` (1e-4, see 5.2 step 3), so the exact halves of a 1/4 piece (0.125 +- 2.5e-6) pass.

### 5.4 Reconnect

**What the player sees and does (the rule, for CUT.md section 1):**
> Drag a piece onto another and hold: as they come close the cut faces that belong together light up, and after about 0.4 s of touching they flow into one piece.
> Carry a piece (pull it past its limit to pick it up) and set it down gently on another and it joins at once. Poking, squeezing, stretching, rubbing, tossing
> and bumping pieces together never joins them. Any two pieces can join. Pieces that were cut apart from each other fit exactly and the cut between them
> disappears. Pieces that did not touch in the original squishy join through the smallest part of it that holds both, and the pieces in between come along
> ("Joined 3 pieces into one."). Whole again is exactly the squishy you started with.

**The intent machine** (one tracked pair; per sim step, only when `pieces >= 2` and no anim; no allocation: scratch vectors, the active piece's previous centre):
```
inputs   P = the piece the finger is on (activeBody), touching() = a finger or grab on it, grab = driver.touch.dragOf(vec) (hand displacement of the real
         finger's grab), carried = P.body.metrics.carried, v = |horizontal speed of P's centre| (finite difference over 3 steps), gap(P, Q) = skin gap along the
         line of centres (cut.ts:197-203, kept)
intent(P -> Q) = carried  OR  ( grab AND  -(drag . u_QP) >= DRAG_TOWARD_K * radius(P) )        // u_QP = unit from Q to P; DRAG_TOWARD_K = 0.25, unchanged
NONE     -> ARMED     when intent and gap < ARM_REACH (0.25 R_small, about 10 cm)       show: setBridge(P, Q, 0.15)  and, if touches(P, Q), the facing cut faces glow 0.35
ARMED    -> HOLDING   when gap < TOUCH_GAP (0.03 m)                                      timer starts; bridge 0.15 -> 0.55 and the glow 0.35 -> 0.8 over JOIN_HOLD_S
HOLDING  -> JOIN      when held >= JOIN_HOLD_S (0.4 s) with the finger still down       (intent is LATCHED while touching() and gap < TOUCH_KEEP_GAP 0.09: soft bodies rebound a few cm)
ARMED/HOLDING -> NONE when the finger lifts (no join), or intent has been false for > 0.25 s, or gap > TOUCH_KEEP_GAP
SET-DOWN: the step where touching() turns false, if P was `carried` within the last 0.1 s, v < CARRY_SETDOWN_V (0.8 m/s) and gap < TOUCH_KEEP_GAP -> JOIN at once
a release of a plain drag (not carried) never joins; a throw (v >= 0.8 m/s) never joins; a bump (physics 'bump') is not an input
```
This closes F2 completely: a tap, press, squeeze, rub inward, pull away, **stretch toward the other piece and let go**, **toss against it**, **bump two
pieces together**, and **a piece resting beside its twin at any distance** all end with no join (N5). The deliberate acts are unchanged in feel (hold 0.4 s,
set down) and the player can still poke, squish, pull, pick up and toss every piece, because none of those is `intent`. Hold-join needs the finger DOWN: a quick
drag-and-let-go is a toss or a bump, not a join. (The old "let go while touching" for any drag is dropped on purpose: stretch-toward-and-release joined pieces.)

**Which pieces can join: any two, and the merged piece is always a true part (the same rule as CUT2_RENDER D12).** Ask `P.body.joinable(regionOf(P), regionOf(Q))`
(PHYS: do they touch across a cut face with positive area AND is their union a sound body, face-connected and star-shaped from its centroid; the shell pre-filters with `touches`):
- **Case 1, they fit (siblings, the usual case; or two neighbours that make an L):** the group is {P, Q}; the merged leaf set is `joinPieces({P, Q})` (siblings collapse back into their node: the
  parent's region, literal-equal). The cut between them is gone.
- **Case 2, they do not fit (piece 1 and piece 4 of six, with 2 and 3 between them; or a union PHYS cannot make sound):** the group is `group(P, Q)` of section 3: the smallest convex part of the
  squishy holding both, and EVERY piece inside it joins ("Joined 3 pieces into one."). The merged body is that convex node, always a valid body; its volume is exactly the sum of the pieces' shares.
- **The last join is the root** (`isWhole`): after the flow, `swapWhole` (below): a fresh `createBody(genome)`; bit-for-bit the original.
- Receiver: the anchor if it is in the group, else the largest piece of the group (ties: lower index). All the others are givers. The bodies meet at the volume-weighted point of the group
  (`follow()` moves each giver as today AND the receiver toward the meeting point by `w = f_givers / f_group` of the distance, `moveTo` stiffness 3): the result stands where the pieces were,
  not where the anchor happened to be.
- Flow: the receiver `setRegion(merged, JOIN_S)` (shape + volume morph; JOIN_ALL_S when the group is the whole), every giver `setFrac(PIECE_MIN, JOIN_S)` and flows in as a ghost (as today, the Reconnect-all
  code path generalised to a subset of pieces). End: givers removed, `recv.frac = body.frac`, `rejoin({ frac: recv.frac, ... })` once, `haptics.release()`, "Joined. N pieces." (N = pieces left).
- Why case 2 swallows pieces: it is the only way the merged piece stays a REAL part of the squishy (no hull-filled blob, no disconnected body). It is also the only surprising part of the rule: the pieces that
  fly in were not touched by the player. Mitigations: while ARMED, every piece of `group(P, Q)` glows its facing cut faces too (same `setCutSeam` call), so the player SEES who will come; the line says how many.
  Owner question 1 offers the alternatives (refuse, or a lump).
- Without `setRegion` / `joinable` (an old physics) there is no Cut tool at all (feature detection), so there is no instant-merge fallback to maintain.

**Matching faces glow.** While ARMED/HOLDING, for P and Q (and for every other piece of the group in case 2), each pair of leaves with an opposing literal on a plane k that names a cut face they
share lights it: both bodies get `stage.setCutSeam(view, planeWorld, t)` where `planeWorld.n = R n_k`, `planeWorld.point = center + R (n_k d_k - piece.offset)` (R = `body.frame`); one call per body per step
(the nearest shared plane when there are several), cleared with `setCutSeam(view, null, 0)`. The seam Gaussian (material.ts:256-260) lights a flat face lying on that plane over its whole area, in the core colour,
calm-halved by the stage; CUT2_RENDER 6.2 draws the same moment as its "knit glow", so this call may be replaced by theirs when it exists. (RENDER check R4.)

**Reconnect all** (button, 1.2 s): unchanged skeleton (cut.ts:539-554): every piece flows to the anchor with the held bridge gap, the anchor `setRegion([[]], JOIN_ALL_S)`
(shape morph to the original silhouette at its detail + volume 1), then the existing glide home (`HOME_NEAR` 0.06, `HOME_MAX_S` 1.6) and `swapWhole`: `createBody(genome)`,
`swapTo({ body, itemId, nickname, silent: true })` (this swap is the one place `swapTo` stays: nothing but the anchor is left to rebuild). `rejoin({ frac: 1, all: true })`, "Whole again.".
With Skip animations (or `animated` false) everything is instant and the button says "Whole again." itself (hudBinding.ts:247).

**Leave paths** (CUT.md rule 2) are untouched: switch, Hoard, capsule, merge, quick switcher, a card preview -> `leaving()` -> `reconnectAll(false)`: no animation, `finishAll(false)` removes
every other piece and `swapWhole`; the tab hidden over 60 s (game.ts:821); a reload (nothing is stored). `abortAnim` still unwinds a neck (`setNeck(null, 0)`, seam off, pre-built
bodies dropped) or a join (ghost off).

**Rejected alternatives** (so nobody re-opens them): (a) refuse joins of pieces that do not fit: a "no" the player cannot reason about (kept as owner question 1, option C); (b) a LUMP for pieces
that do not fit (volume = the sum of just the two, silhouette a hull-filled blob): not a real part, needs a fallback body PHYS would otherwise never build, and breaks "every piece is a real part of the
squishy" (kept as option B); (c) release-join for any drag: reproduces the stretch-and-release false positive; (d) a "drop-in" window after a carried release: joins pieces the player merely set down
beside each other; (e) merging by replacing both bodies with a fresh one: a visible pop at the end of every join.

### 5.5 The steering stopgap is removed; the scripted parting replaces it

Deleted: `SETTLE_S`, `SETTLE_GAP`, `SETTLE_REACH`, `settling[]`, `steer`, `hold`, `unhold`, `unholdAll`, `gapBetween`'s use for steering (the helper stays for joins).
Why it is no longer needed: (1) no goal force (M1) and no overlap at birth (rigid flush placement, M7); (2) pieces stay where they are placed (M2).
What the strands still need is room, a growing gap over about 0.3 s. That is the scripted parting, per piece, for `PART_S` after the swap:

```
G       = PART_GAP[flavour] * (R0 / 0.5) * (calm ? 0.6 : 1)       // sticky/slime 0.16, putty/mochi/foam 0.10, others 0.06 (metres at size 0.5)
PART_S  = sticky/slime/putty/mochi 0.45, others 0.30
s       = unit( n.x, 0, n.z )  if  |n.y| < 0.75  (a steep or vertical plane: the pieces part sideways)
g(t)    = G * smoothstep(t / PART_S)
each step, A: moveTo( base_A + 0.5 g s , 3 ), B: moveTo( base_B - 0.5 g s , 3 )      // y = current y: horizontal only; at PART_S: moveTo(null)
|n.y| >= 0.75  (a near-level cut, the side-to-side swipe): no sliding (stacked flat faces resist it); the UPPER piece is built G_lift = min(G, 0.05) m above flush and drops
               (impact about sqrt(2 g G_lift) = 1.0 m/s, a soft plop): the plop IS the parting
```
Rules kept from the old code: a finger on either piece, a join, the glide home, or a new cut of either piece ends its script at once (`moveTo(null)`).
The script is deterministic (sim time only), allocation-free in steady state, and removable in one line if RENDER decides the strand needs nothing.
Measured with the real physics on 5 species (M7): gap = start + G +- 15 %, no drift after the release, <= 8 mm vertical. Near-level cuts and tilted planes are NOT measured
(need the true-cut physics): acceptance N7/N8 and risk R5.

### 5.6 Meter, audio, haptics

- **Meter**: nothing changes. Touches on pieces reach `collection.feed` from `drain()` (game.ts:545-550) like any body's; `mapSoftEvent` has no body id and no size; the
  freshness rule is global. A piece's size scales nothing, the cut and the join make no SoftEvent (the final `swapWhole` and the `setRegion` morph produce none, checked by N12).
- **Audio** (consumer only): `cut({ phase: 'start', frac: small })`, `cut({ phase: 'separate', frac: min(fA, fB) })`, `rejoin({ frac: merged share })`, `rejoin({ frac: 1, all: true })`
  keep their contract (contracts.ts:271-276) and their meaning: `frac` is a share of the WHOLE, smaller sounds higher, bigger merged sounds lower and rounder. What changes is
  only what the numbers describe (true halves, not a ball). No new audio member; a held-join tone is NOT proposed (every audio change needs its own independent audio
  verification, RESUME 2). Task A0: confirm by ear and by `audio.stats()` that pieces of 1/8 to 1/2 still span the intended pitch range; no code.
- **Haptics**: unchanged: `haptics.poke()` at the swap, `haptics.release()` at a join, physics `bump` -> `haptics.pop`.
- **Calm effects**: seam softer (stage), `G x 0.6`, strands shorter (render), the join glow halved by the stage; no camera move, never a screen flash.

### 5.7 Player-facing text (`src/shell/cutText.ts`, new: every cut string lives here; nothing in src/ui contains copy)

Rule: say pieces, halves, parts. Never "chunk", "ball", "face piece", "role", "region", "cell". A grep of src/ for those words in player text finds none today; the
rewrite is therefore small and targeted:
| State | Live region / bar text | Was |
|---|---|---|
| tool picked | "Cut: swipe across a squishy to cut it. Split in two and Reconnect all are buttons." | same |
| whole, bar hint | "Swipe across a squishy to cut it." | same |
| 2+ pieces, bar hint | "Swipe to cut again. Drag a piece onto another and hold to join them." | "With the Hand, drag a piece into another and hold ..." (the Hand is in the tray, not needed here) |
| cut done | "Cut into N pieces." | same (X10 regex kept) |
| Split in two done | "Cut into N pieces." | same |
| join done, the pieces fit | "Joined. N pieces." (N = pieces left) | same |
| join done, the group swallowed others (case 2) | "Joined 3 pieces into one." (3 = pieces that came together) | - |
| whole | "Whole again." | same |
| nothing to join | "It is in one piece." | same |
| swipe missed | "Swipe across the squishy to cut it." / "Nothing to cut there." | same |
| `small` | "Too small to cut there. Try nearer the middle." / "That piece is as small as it gets." | same |
| `limit` | "That's as many pieces as it can make." | same |
| `thin` (new) | "That would make a piece too thin. Try another angle." | - |
| no piece can be cut | bar: "No piece is big enough to cut again. Join two to make a bigger one."; Split in two line: same | "Every piece is too small to split in two. Swipe near an edge to peel a small one off." (wrong advice: a piece under 1/4 cannot be cut at all) |
| mat cleared | "The other squishy went back on the shelf." / "The other N went back on the shelf." | same |
Toy tray hint "Swipe to slice it into pieces", the Settings keys line ("C cut") and `aria-label`s are unchanged. Calm / reduced-motion / forced-colors behaviour of the bar is the UI
overhaul's. The count text "N pieces" is kept.

### 5.8 Accessibility and keyboard (CUT.md 2.6, X10)

Split in two and Reconnect all remain buttons reachable by Tab with live-region lines. New: five presses of Split in two reach six pieces (N6). A keyboard user cannot join
two pieces (only Reconnect all): acceptable per CUT.md. **Optional extra (not required, 0.5 day, S-extra)**: an "Undo cut" button that joins the two pieces of the most recent cut
if they still exist (`join(a, b)` already exists for tests); it also helps a mis-swipe. Not in the task list unless the owner wants it.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 6. What I need from the other lanes (requirements, not their design)

**PHYS**: (1) a pure clip + radial re-mesh of the rest silhouette by `PieceRegion` on the unchanged icosphere topology, exact volume share, and `joinable(a, b)` (face contact with positive area AND a sound union: face-connected, star-shaped
from its centroid); no lump fallback is needed (every body the shell asks for is a convex cell or a sound union); (2) the SoftBody constructor honours `region`, `frame`, fills RENDER's `piece` (`offset`, `cells`), `frac`; (3) `planCut` with the fields in section 4 (including `cellFa`) and a median mode;
(4) every goal term has zero mass-weighted mean, with a probe (a piece with no fingers drifts < 0.1 m, never exceeds 1.2 m/s after the first 0.1 s unless it is falling from its built height, and is under 0.3 m/s after 1 s, on 50 species x cuts at 5 positions), then delete
`FLAT`, `flatK`, `roundTau`, `buildChunkRest`, `flatPoints` and the `chunk` path; (5) `setRegion` morph, end state equal to a fresh build from the region (RMS < 0.002 R0); (6) `placeAt`;
(7) neck `depth` and the swap-continuity metric (5.2); (8) the flat face is part of the rest shape (fillet from the mesh, no round-over transient); (9) 6 pieces cost <= 2 whole bodies,
pieces under 0.35 use detail 2, swap-frame budget 5.2.2; (10) per-piece fold/hop/tunnel/determinism/allocation gates (X07).
**RENDER**: `StageLike.setPrimaryBody(id)` and `removeBody` of the primary (so a cut never calls `setBody`, section 5.1), `addBody` idempotent per body object (its D14), warm view build <= 8 ms (its P9), `setCutSeam` opts; eyes by region (an eye belongs to the piece whose region contains its centre; an eye within its radius of a cut face is CLIPPED by that plane on both sides, each side draws its half
with a dark flat section; never a full bead hanging over a face; no floating bead); `chunk` removed from the draw path (the rarity/aura/dome FX stay with the anchor); the dev member
`eyeCentres`; the seam on a flat cut face lights the whole face (R4); strands anchored to the cut faces; framing for slabs and stacks; remove the neck-swell `framingFor` stopgap when PHYS lands depth.
**AUDIO**: A0 only.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 7. Debug hook, harness and probes: every check that encodes the old behaviour, and the new acceptance checks

### 7.1 Debug hook (src/shell/debugHook.ts; dev only, out of the production bundle: the prod-build row greps for it)
| Member | Fate | Reason |
|---|---|---|
| `faceAnchor()` (and `import { faceAnchor } from './cut.ts'`) | DELETE | no face piece |
| `stageViews()` -> `{ total, faces, chunks }` | REPLACE by `{ total, eyes }` (visible eye beads over all views, from the stage dev) | no chunk flag exists |
| `pieceGaps(at)` -> `{ chunk: i > 0, ... }` | KEEP, field renamed `anchor` | same data, no role word |
| `tools()` | KEEP | |
| NEW `regions()` | `[{ frac, cells, anchor, x, y, z }]` (cells = the leaves' signed plane ids) | the independent view of the algebra |
| NEW `eyes()` | world centres of the visible beads per view + clipped share (stage dev `eyeCentres`) | N1/N2 |
| NEW `joinState()` | `{ state, held, a, b, touches }` | N5 |
| NEW `cutPlanes()` | world planes of the shared cuts | flatness measure N3 |

### 7.2 Existing checks that encode the face piece / chunk / X03 (grep: chunk, face piece, X03, faceAnchor, SETTLE)
**_harness/shellview/node_checks.ts** (mock: `cutBody`, `CutMock { piece: { frac, chunk, ... } }`, line 574-):
| Check (title) | Fate | Written reason |
|---|---|---|
| CUT: the Cut tool is offered only when the physics can cut | RE-SPEC | the members that matter are now `planCut`, `setNeck`, `setRegion`, `joinable` |
| X01 shell: Split in two necks ..., two pieces whose shares sum to 1; built with PieceOpts of those shares | RE-SPEC | built with `region`; shares from `planCut`; Split in two gives exactly 0.5 / 0.5 |
| **X03 shell: the face piece is the PLAY body ..., the other an eyeless chunk (AddBodyOpts.chunk); partPieces once** | REPLACE | "both pieces are peers: no chunk flag passed to the stage; the play body is the larger child; identity unchanged; partPieces once" |
| CUT audio: cut start / separate carry the smaller share of the WHOLE | KEEP | contract unchanged |
| CUT: says "Cut into 2 pieces.", a tick, Hoard/mat/history see no piece | KEEP | |
| X06 shell: cutting fed nothing; a poke on a chunk pays 0, a squeeze 1.2 s pays | KEEP, rename chunk -> piece | |
| **CUT: a new chunk is held at its spot (moveTo ...) and let go after SETTLE_S; the face piece is not held** | DELETE + ADD | steering is gone; add "scripted parting: both pieces moveTo +-0.5 g s for PART_S, symmetric, released after, none when abs(n.y) >= 0.75, a finger releases it" |
| X02 shell (1/8 refusal with wobble), wobble ends, 24 px short / miss, limits at low quality | KEEP (plan mock) | |
| X01 shell: three cuts, shares sum 1, "one face piece and three chunks" | RE-SPEC | "four peers, one anchor, regions are leaves of one tree (cells check)" |
| A-F2 shell: a finger resting on a touching piece never joins ... | KEEP + EXTEND | add stretch-and-release, toss, bump; N5 |
| CUT reconnect: the piece flowing in is a ghost | KEEP | |
| CUT reconnect: a chunk DRAGGED into the face piece, held 0.4 s, flows in (setFrac up / down) | RE-SPEC | receiver `setRegion(merged)`, giver `setFrac` down; merged leaf set equal to the parent's when siblings |
| CUT reconnect: letting go of a piece DRAGGED into another, while they touch, joins at once | RE-SPEC (inverted for a plain drag) | a plain-drag release no longer joins (stretch-and-release); a CARRIED slow set-down does |
| X04 shell Reconnect all; whole at the middle / glide home; nothing to reconnect when whole | KEEP (+ regions `[[]]`) | |
| **X03 shell: the face piece is the side holding the eyes' anchor (level cut above the eyes makes the top a chunk)** | DELETE | not a rule any more; replaced by N1/N2 (eyes measured by the stage, not by the shell) |
| X05 shell: leaving reconnects first; the Hoard never sees a piece / nothing stored (a regex over the stored text for piece, chunk, frac) | KEEP, regex gains region and cells | |
| tools: with Cut a swipe cuts; with Snap a drag orbits | KEEP | |
| real physics rows: "X01 real physics ... the face piece is the PLAY body ... the other an eyeless chunk (chunkFlags)" | RE-SPEC | no chunk flag; both built with `region` |
| real physics: "parting gap: the new chunk is steered to SETTLE_GAP" | REPLACE | "scripted parting reaches G +- 20 % by PART_S and holds to 4 s (drift < 1 cm)" |
| real physics: X06, second Split in two (3 pieces), X04, bridge-in-view ("some chunk"), X05 switch | KEEP, rename | second Split: 0.25 + 0.25 + 0.5 exactly |

**_harness/browser_shell.mjs** (sections cut-real, cut-touch, cut-x, cut-swell, cut-low, feel-routes; names as in the file):
| Check | Fate | Reason |
|---|---|---|
| cut-real: Split in two to 4 and 6 pieces "all in frame"; neck/separated screenshots | KEEP | add the 50-species node sweep N6 |
| cut-real: drag to reconnect "the chunk carried onto the face piece and held there" | RE-SPEC | piece/piece; holding needs the finger down; plain release must NOT join |
| cut-real: toss a piece (chunk pulled past 1.15 x maxPull, thrown, lands; still two pieces) | KEEP, rename; ADD `rejoin == 0` | a toss never joins |
| cut-real: leave paths, reload (the stored-data regex over piece, pieces, chunk, cutNormal) | KEEP, regex gains region and cells | |
| cut-x: X01 real (2 pieces), X02 real refusals, X04 real, bridge in view | KEEP | |
| **cut-x: X03 real "ONE face and one eyeless chunk (stageViews)" and the 6-piece "faces === 1 && chunks === 5"** | REPLACE | N1 (eyes on each half), N2 (through an eye), N3 (6 pieces: eye count 2 in total) |
| cut-x: reconnect by DRAGGING (join starts by itself after 0.4 s) | KEEP | now also asserts the intent latch |
| cut-x: reconnect by LETTING GO while touching | RE-SPEC | carried slow set-down only (N5c) |
| cut-x: no join for a finger on a piece 0.105 m from its twin | SUPERSEDED | N5 touches pieces at < 3 cm, the real resting state |
| cut-x: X06 real (tap 0; squeeze on a chunk = on the face within 25 %) | KEEP, rename | |
| cut-x: X10 keyboard only | KEEP | + five presses reach 6 |
| cut-swell (KNOWN PHYS: dollop x1.13, thudge x1.84, boingle x1.66) | RE-SPEC when depth lands | becomes gated: <= x1.25 on all families; the reason (neck depth) is written in the row |
| cut-low (4 pieces at low) | KEEP | |
| feel-routes: "a chunk flicked -> lift + toss", "a chunk carried into the face piece -> bump" | KEEP, rename; assert `rejoin == 0` | carried but not set down slowly: a bump, not a join |
| prod-build row (no DebugHook strings, bundle <= 1229 KB) | KEEP | new modules count against the bundle (cutRegion.ts ~3 KB) |

**_harness/probe_cut.ts** (PHYS-owned file; re-specified with PHYS): X01 centre cut (face piece + chunk volumes) -> both halves built with `region`, same 3 % bar; X02 edge cut (chunk 0.125,
constructor clamp) -> region-built, plus "a plane that misses -> planCut false"; X04 cut into 6 -> true parts, then 5 `setRegion` joins; final RMS vs the original < 0.002 R0 and the shell's whole
short-circuit; X07 four pieces of tadpolo -> true parts, flat faces on the table; X08 six pieces <= 2 whole bodies (+ the swap-frame budget); allocation rows (FLAT) -> `setRegion` morph;
B2/B3 rows unchanged (they build the mat with `{ frac: 1, chunk: false, at }`, boot.ts:112). NEW: `planCut` vs a voxel count, `fa` equals the built child's mesh volume share, goal-centroid invariant,
launch probe (M1 as a regression, threshold 1.0 m/s after 0.1 s), determinism, flatness.
**_harness/renderview/view.ts, browser_render.mjs, src/render/stubBody.ts** (43 + 15 + 2 mentions): RENDER-owned; `chunk` stubs become region stubs; eye clip rows added.
**_spec/CUT.md**: replace the "face piece" paragraph (section 1), the flat-face-rounds-over sentence and the "How each family cuts" putty/mochi line (the flat face now stays), rule 4 text, section 4 PHYS/SHELL
items, X03 (below) and add X11 to X16. Replacement text is in 7.4.

### 7.3 New and replaced acceptance checks (with an independent measurement each)
Independent = measured by something other than the code under test: the stage's own eye positions, canvas pixels, physics `positions`, `audio.stats().started`, a stepped sim clock.
| Id | Check | Independent measurement |
|----|-------|-------------------------|
| **X03' / N1** | A centre cut between the eyes leaves one eye on each half | real browser, vertical swipe through the screen centre of the Dollop starter and of 6 species with extreme eye spacing / size: `stageDev.eyeCentres(view)` gives exactly 1 bead per piece view; projected to screen px the left piece's bead is left of the swipe line and the right piece's right of it; PIXEL cross-check: the canvas has exactly one dark blob (ink-dark bead) either side of the swipe line, none on it; 50-species node variant on `eyeCentres` at rest |
| **N2** | A cut through an eye | swipe through the projected centre of the left eye: both views report that bead clipped with share 0.5 +- 0.2; dark-pixel area of that eye on each side within [0.25, 0.75] of its pre-cut area (same camera, screenshot before and after); no full bead lies over the plane |
| **N3** | A nested cut (cut one half again at an angle; 3 then 6 pieces) | fractions sum to 1 (0.5 %), each >= 1/8; each piece's MESH volume (physics `positions`, divergence theorem) / the whole's within 3 % of its `frac`; FLATNESS: particles whose rest position lies within 0.02 R of a cut plane (rest test from `restLocal` + `piece.offset`) fit a world plane with RMS < 0.03 R after 1.5 s; eye count over all views = 2 |
| **N4** | Joins that fit and joins that do not | (a) four quadrant pieces: join two that touch across a cut face and form a sound union: 3 pieces, `frac` = the sum (0.5 %), the shared plane gone from `regions()`; (b) three slabs L, M, R: carry L over M and set it on R (they do not touch): all three come together, "Joined 3 pieces into one.", 1 piece, a fresh `createBody(genome)` (no `piece`, `restLocal` hash equal to the original's); (c) six pieces, join piece 1 with piece 4: the group is exactly `group(P, Q)` (the test recomputes it from the tree), `frac` = the group's sum, `rejoin` count from `audio.stats().started` == 1; the glow list while ARMED names the same pieces |
| **N5** | Touching a resting piece never joins unless the player drags it in | pieces resting at a measured skin gap < 0.03 m (`pieceGaps`): a) tap 60 ms, press 300 ms, squeeze 1.2 s, rub inward 1.0 s, pull away 1.0 s, **stretch toward and release**, **toss against it**: `audio.stats().started.rejoin` stays 0, 2 pieces; b) drag the inner shoulder into the other and hold: join starts at 0.4 +- 0.1 s after the skins touch, finger still down; c) carry (lift) and set down at < 0.8 m/s touching: joins at once; carry and release at > 0.8 m/s: no join; all on the real stack, 5 trials each |
| **N6** | Split in two reaches 6 pieces on every species | node, real physics through the whole game, 50 species, 5 presses: 6 pieces, every frac >= 1/8 - 1e-4, sum 1 (0.5 %), the sixth press says the limit line; measured volumes within 3 % after 1.5 s; also the swipe route: 5 swipes at fixed offsets reach 6 or are refused with a stated line, never stall silently |
| **N7** | No self-propulsion, no launch | node + real stack: for 50 species x 3 cut positions x level and vertical swipes, no fingers: from 0.1 s after the swap every piece centre speed <= 1.2 m/s (the lifted parting falls about 5 cm) and <= 0.3 m/s from 1.0 s, displacement from (flush + parting) <= 0.10 m at 4 s, highest centre <= rest height + 0.15 m; browser: all piece centres stay inside the viewport for 12 s (the F3 repro: kneadle, thudge, prismelo, nuzzo); regression row: the M1 rig (chunk as built) must FAIL this check on the old code (4.4 to 14.4 m/s) |
| **N8** | Near-level cut | side-to-side swipe: the upper piece rests on the lower with no penetration (deepest particle < 0.3 R, probe_cut X07 meter), no launch (N7), `land` fires at most once per piece |
| **N9** | Reconnect all is exact (X04) on all 50 species from 4 to 6 pieces | genome code, `restLocal` hash identical, frac 1, volume +-0.5 %, at the middle (abs x and abs z under 1e-9), 1 body, 0 extras; yaw of the anchor at the final swap reported (risk R6) |
| **N10** | Swap continuity | Chamfer(necked parent mesh at t=1, union of the pieces' first-frame meshes) <= 0.08 R0 on 11 families; the render "cut-swap" luminance step no worse than the current value per family |
| **N11** | Swap frame cost | shell + physics work in the swap frame <= 8 ms on this PC; P95 frame time around the swap <= 33 ms in SwiftShader; first-ever cut (cold) <= 60 ms thanks to the prewarm |
| **N12** | Meter and Hoard | cut, 5 joins, Reconnect all, the `setRegion` morph: `collection.meter().sp` and `fill` unchanged, items unchanged, no `poke/release/snap` SoftEvent from them; a squeeze held 1.2 s on a piece pays within 25 % of the same on the whole |
| **N13** | Region algebra (node, `cutRegion.ts` alone) | 100 000 random sequences of cut(piece) and join(a, b) (6 pieces max, 4 on low): all-joined -> `[[]]` every time; sibling join returns the parent's cells literal-equal; cells <= 64; `touches` symmetric |
| **N14** | Determinism | two runs of the same scripted session (cuts, parting, joins) give identical `stateHash` of every piece at 6 checkpoints, 4 species (as the A-lens did) |
| X01, X02, X05, X06, X09, X10 | as in CUT.md | X01 now also "exact halves for Split in two"; X09 flash gate over 10 rapid cuts + Reconnect all |
| **X03 (CUT.md)** | REPLACED by N1 + N2 | "The face stays on exactly one piece" no longer describes the game |

### 7.4 CUT.md replacement text (for the spec owner)
- Section 1, "The face piece" paragraph -> "**Every piece is a real part.** A cut slices the squishy along a plane; each piece is the part of the squishy that lies on its side, with the same
  silhouette, a flat cut face where the plane went through, and everything that sat on that side: a cut between the eyes leaves one eye on each half; a cut through an eye leaves half an eye
  on each side. There is no special piece. Cut faces stay flat."
- Section 1, Reconnect row -> the box in 5.4.
- Section 3, putty/mochi: "The flat cut face stays" (it always does now); sections 4 and 5: PHYS builds a piece from a region of the squishy; contract members as in CUT2 section 4.
- Rule 6 unchanged. Rule 4 gains: "A cut that would make a piece too thin is refused with a polite line."

---------------------------------------------------------------------------------------------------------------------------------------------------

## 8. Sequencing, file ownership and tasks

**Order** (STATUS.md queue: 1 UI overhaul, 2 independent physics re-verification of checkpoint 47, 3 physics round 3 = ground fix + multi-pull + LOCK + neck swell, 4 preview refresh, ...). My recommendation is to
insert the true cut BEFORE items 2 and 3 on the PHYS side and before UI batch 3 on the shell side, because it fixes F3 (a MAJOR the SHELL-4 verifiers found and the queue does not yet list) and the owner has now asked for it by name:
- **Item 2 must be re-scoped**: do not spend an independent verification on checkpoint 47's `chunk` / `FLAT` / `pieceRest` / `neckGoal` code that this round deletes or rewrites; verify cp 47's grabs, contact, carry and perf, or run it after the true-cut merge.
- **Item 3 splits**: the neck swell (putty x1.84, firm silicone x1.66) is absorbed by the shallower neck (`depth`, section 5.2); the ground fix and LOCK / multi-pull stay a separate PHYS round AFTER this one, because they edit `updateGrabs`, the ctor and `frameUpdate` of the same softbody.ts.
- **The owner's other note today** ("clicking SHIFT does NOT let me lock the hold in place") is exactly LOCK.md, which is specified and not built (STATUS: queued, item 3). It is a second owner-visible gap: with ONE physics engineer, true cut first (the larger user-visible defect, and it unblocks SHELL and RENDER); with TWO, the
  LOCK PHYS work can start at once if both keep their diffs out of each other's regions of softbody.ts (true cut: new `region.ts` + ctor, `frameUpdate`, `neckGoal`, `setFrac`; LOCK: `updateGrabs`, grab slots, `twoHanded`) and merge sequentially on one branch. LOCK's SHELL half (input) does not touch cut files and can start against a mock now.
1. NOW: the SHELL-4 fix round finishes and is committed. Ask it to make **no further edits in cut.ts or the cut rows of the harness** (they are rewritten); its game.ts pointer glue, blade clearing and UI minors survive.
2. Contract freeze (orchestrator, one commit in `src/contracts.ts` merging the four lens memos' additions) + SHELL S0 prep (below).
3. In parallel, different files: PHYS core (new `src/physics/region.ts` first), SHELL rewrite against a mock, RENDER eyes.
4. Integration, then two independent verifiers (physics + shell/render), then the commit.
5. After: UI overhaul batch 3 (tray, Cut bar, Snap bar) and the LOCK / multi-pull + ground-fix PHYS round (both touch files this round touches). UI batches 1 and 2 (title, HUD, Settings, Tasks) may run during step 3
   once S0 is in, because they no longer share a file with the cut work.

**File ownership while this round runs** (one engineer per file at a time):
| Files | Owner this round | Notes |
|---|---|---|
| src/contracts.ts | orchestrator (freeze), then read-only | additive only |
| src/physics/softbody.ts, shape.ts, new region.ts, probes `probe_cut.ts`, new `probe_truecut.ts` | PHYS | **LOCK's PHYS part (grabs, 5 slots, locks) and the ground fix wait for the merge**: they edit `updateGrabs`/ctor of the same file |
| src/render/*, `_harness/renderview/*`, `browser_render.mjs`, `stubBody.ts` | RENDER | |
| src/audio/* | nobody (A0 verification only) | |
| src/shell/cut.ts, cutRegion.ts (new), cutText.ts (new), cutBinding.ts (new), bodies.ts, debugHook.ts, `_harness/shellview/*`, `browser_shell.mjs` cut rows | SHELL | |
| src/shell/game.ts | SHELL for one line (`setTool` -> `cut.prewarm()`) in the S0 commit; LOCK-SHELL owns the input port (lines 613-679) | serialize: S0 first |
| src/shell/hudBinding.ts, src/ui/cutBar.ts, toyTray.ts, snapBar.ts, CSS | UI overhaul; SHELL touches them ONLY in S0 | S0 makes `cutBar` text-agnostic: `setPieces(n, max, busy, canSplit, text)`; the Cut wiring moves to `cutBinding.ts` and every string to `cutText.ts` |
| src/input/*, src/shell/driver.ts | LOCK-SHELL | the true cut does not touch them (`dragOf` is used as is) |

**Tasks per lane, in dependency order**
| Id | Lane | Task | Needs |
|---|---|---|---|
| C0 | orchestrator | freeze the contract (section 4) | memos from the 4 lenses |
| S0 | SHELL | prep refactor: strings -> cutText.ts, cut wiring out of hudBinding.ts -> cutBinding.ts, cutBar.setPieces(text), a no-op `Cutter.prewarm()` and its call in game.ts `setTool`; no behaviour change (harness green) | fix round committed |
| S1 | SHELL | cutRegion.ts (cut tree, `cutPiece`, `joinPieces`, `group`, `touches`, `isWhole`, serialization) + N13 property tests | C0 |
| S2 | SHELL | cut.ts rewrite on a mock physics: pieces/anchor, plan/limits/refusals, neck, pre-build + `placeAt`, swap, scripted parting, Split in two (median + candidates), intent machine, join flow (`setRegion`, meet point, receiver rule), Reconnect all, leave paths, prewarm, text | S0, S1, C0 |
| S3 | SHELL | bodies.ts (no `chunk`), debugHook members (7.1), game.ts event type `thin` | S2 |
| S4 | SHELL | harness: node_checks mock `planCut`/`setRegion` (reusing PHYS' pure region module so the mock does not lie), re-specs and new rows (7.2, 7.3), 50-species sweeps | S2 |
| S5 | SHELL | integration on the real PHYS + RENDER, browser harness, screenshots, bundle gate, report | P3, P5, R2 |
| P1 | PHYS | region clip + radial re-mesh (pure module) + voxel tests; `joinable` (face contact + sound union) | C0 |
| P2 | PHYS | constructor `region/frame`; fill RENDER's `piece` (`offset`, `cells`); `frac` truth | P1 |
| P3 | PHYS | `planCut` (at / median, incl. `cellFa`), `placeAt` | P2 |
| P4 | PHYS | goal-centroid invariant, delete FLAT / chunk path, launch probe | P2 |
| P5 | PHYS | `setRegion` morph; neck `depth` + swap-continuity metric | P2 |
| P6 | PHYS | perf (rest-shape cache, 6 pieces <= 2 bodies, swap frame), per-piece gates, determinism, allocation | P3-P5 |
| R1 | RENDER | eyes by region + clip, drop `chunk` in the draw path, stubs | C0 |
| R2 | RENDER | `setPrimaryBody` + `removeBody(primary)` + idempotent `addBody` (no `setBody` in a cut), stage dev `eyeCentres`, seam on flat faces (R4) with `from/to`, strands on faces, framing; harness rows | R1, P2 for real bodies |
| A0 | AUDIO | listen / `stats()` check on true parts | S5 |
| V1, V2 | verifiers | independent physics and shell/render verification of the commit | S5 |
Critical path: C0 -> P1 -> P2 -> P3/P5 -> S5 -> V. SHELL S1-S4 and RENDER R1 do not wait for PHYS.

**Estimate** (engineer-days): SHELL 9.5 (S0 0.5, S1 1.5, S2 3.5, S3 0.5, S4 2.5, S5 1.0). Indicative for the others: PHYS 10-12 (my guess, their memo decides), RENDER 13 (CUT2_RENDER section 11), AUDIO 0.3. That is about 35 engineer-days
plus about 4 for two independent verifiers; the critical path is PHYS (C0 -> P1 -> P2 -> P3 / P5, about 9 days) then S5 and verification (about 4), or RENDER's 13 days if it runs behind, so about 3 calendar weeks with three engineers.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 9. Risks and unknowns (each with how it will be caught)

- **R1 swap-frame hitch** (M5: 12-26 ms median, 300 ms worst today): pre-build during the neck, prewarm, rest-shape cache; N11. If `placeAt` slips, build at t = 1 and accept today's cost.
- **R2 neck -> flat swap discontinuity**: shallower neck by family, N10; fallback depth 0. Sticky/slime keep a deep neck and rely on the strand.
- **R3 how often does a join fall into case 2 (the group swallows pieces)?** It depends on `joinable` (PHYS) and on the star-shapedness of unions of the 50 species' pieces, which I did not measure. If case 2 is common for plain
  neighbours (e.g. an L of three on a star or crescent species), the player will be surprised too often: PHYS reports the rate on 50 species x random 3-cut trees (target: under 10 % of touching-pair joins); fallback: owner question 1 option B (a lump).
- **R4 pancakes** from repeated parallel cuts (aspect 0.05, M3 B): `thin` refusal at 0.08 (PHYS may raise it after probing fold limits on slabs); Split in two avoids them (M3 D).
- **R5 stacked halves of a near-level cut** and sliding on tilted planes: contact friction between pieces (CONTACT_MU 0.9, softbody.ts:214) resists sliding; the design lifts the upper piece instead of sliding.
  NOT measured (needs true-cut physics): N7/N8; the threshold |n.y| 0.75 is a starting value.
- **R6 final-swap pop when the anchor's yaw is not 0**: the fresh whole is built at yaw 0 (cut.ts:398-408); a tossed, spinning anchor pops. Not measured. Report the yaw in N9; fix if > 5 degrees by a PHYS goal-frame easing
  (`alignTo`) or by gliding with a turn.
- **R7 eye clipping** is the hardest RENDER item (a bead is a dome mesh attached to a surface): worst case, an eye within its radius of the plane goes whole to the side holding its centre and the other side shows nothing; N2 would then be re-specified with a written reason.
- **R8 mock honesty**: the node mock must use PHYS' pure region module for `planCut`, never invented numbers.
- **R9 file contention** with LOCK, UI and the still-running fix round: section 8; S0 first.
- **R10 `promote` / `setPrimaryBody` is new on both sides** (BodyManager and the stage): removing the primary view must not drop the camera framing or the tier styling. Test: a cut of the anchor with 5 other pieces keeps those 5 views alive (same view ids, same clocks) and the frame does not jump (framing delta < 3 %).
- **R11 F2-class regression** on 50 species: re-run the verifier's `holdjoin.ts` method (32 of 50 / 31 of 50 joins before, 0 after fix round 1) on the new build; must stay 0.
- **R12 determinism and allocation** of the algebra and the parting: no `Math.random`, sim time only; zero allocation per step in the idle path (the intent machine early-returns when `pieces < 2`).

## 10. Questions for the owner (genuine product choices; each with my recommendation)

1. **What happens when you join two pieces that did not touch in the original squishy?** (piece 1 and piece 4 of six). A: the pieces in between come along ("Joined 3 pieces into one."), so every piece stays a real part of the squishy (RECOMMENDED; also CUT2_RENDER's D12). B: just those two stick into one lump (their summed volume, a filled-in blob: not a real part, needs a fallback body in the physics). C: refuse with a small wobble and a hint ("These two do not fit").
2. **Do cut faces stay perfectly flat forever?** CUT.md had them round over in about 2 s (6 s putty). A true cut wants them flat. Recommend FLAT, and add a gentle sag for soft families later only if it feels too stiff.
3. **Should one swipe cut every piece it crosses, like a real knife?** Recommend NO (one piece, the one the swipe passes over most): it keeps the 6-piece and 1/8 bookkeeping obvious and the refusals explainable.
4. **Which first when there is one physics engineer: the true cut or LOCK (Shift lock of a stretched hold)?** Both are the owner's notes of today. Recommend the true cut (it clears a MAJOR, and SHELL / RENDER can work in parallel), LOCK right after.

## Appendix A. SHELL change list (files and functions)

**src/shell/cut.ts** (rewrite, about 750 lines; keep the file name and `createCutter`)
- KEEP (as is or nearly): `MAX_PIECES`, `PIECE_MIN`, `NECK_S`, `NECK_DEFAULT_S`, `NECK_HOLD_S`, `JOIN_HOLD_S`, `JOIN_S`, `JOIN_ALL_S`, `BRIDGE_*`, `HOME_*`, `MIN_SWIPE_PX`, `TOUCH_GAP`, `TOUCH_KEEP_GAP`,
  `DRAG_TOWARD_K`, `supportAlong`, `gapBetween`, `flowOf`/`flowD`/`bridgeK`/`follow` (follow gains the receiver's half of the meeting move), `finishAll`, `whole`, `swapWhole`, `abortAnim`, `reconnectAll`, `wobble`, the swipe -> plane code.
- DELETE: `faceAnchor`, `lobeCentres`, `shareOf`, `halving`, `SETTLE_S`, `SETTLE_GAP`, `SETTLE_REACH`, `settling`, `steer`, `hold`, `unhold`, `unholdAll`, `Piece.chunk`, the `faceA` logic in `startCut`/`part`, `extraOf`'s chunk meaning.
- ADD: `Piece.region/anchor`, the session `planes`/`nextId`, `plan` (a reused `CutPlan` scratch + one per candidate), `startCut` over `planCut`, `PIECE_TOL`, `ASPECT_MIN`, `prebuild`/`placeAt`, `part` with rigid placement, `parting[]` + `partStep`
  (PART_S, PART_GAP, G_lift), `splitInTwo` median + 4 candidates, the intent machine (`NONE/ARMED/HOLDING`, `CARRY_SETDOWN_V`, `ARM_REACH`, latch, set-down), `startJoin` with `joinable`/`joinPieces`/`group`/`setRegion`/meet point/receiver rule, `BodyManager.promote` use,
  the matching-face glow (`planeWorld`), `prewarm()`, `join(i, j)` (tests), `regions()` (dev hook), `CutResult` gains `'thin'`.
- Public `Cutter` after the change: `supported`, `pieces`, `fracs()`, `busy`, `canSplit`, `maxPieces`, `swipe`, `splitInTwo`, `reconnectAll`, `update`, `isPiece`, `dispose` (unchanged) + `prewarm()`, `join(i, j)`, `regions()`, `joinState()`.
**src/shell/cutRegion.ts** (new, pure, about 160 lines): the cut tree and `cutPiece`, `joinPieces`, `group`, `isWhole`, `touches`, serialization to `PieceRegion` (section 3). **src/shell/cutText.ts** (new): every string of 5.7. **src/shell/cutBinding.ts** (new, S0): the Cut bar / blade / tool wiring moved out of hudBinding.ts:243-340.
**src/shell/bodies.ts**: `showExtra` stops passing `chunk: true` (line 108); `addExtra`'s option type drops `chunk`; comment on `ExtraBody.piece` (line 34) loses "eyeless chunk"; NEW `promote(body)` (an extra becomes the play body without `stage.setBody`; falls back to `swapTo` when the stage lacks `setPrimaryBody`).
**src/shell/game.ts**: the `createCutter` deps (lines 413-423) stay as they are (the intent machine reads `activeBody().metrics.carried` and `driver.touch.dragOf`, both already wired); `setTool` (lines 429-440) calls `cut.prewarm()` when the tool becomes `cut` (one line);
`ShellEvents.cut` stays `CutResult | 'joined'` (gains `'thin'` through the type). Nothing in the input port (lines 613-679): that is LOCK-SHELL's.
**src/shell/debugHook.ts**: section 7.1. **src/ui/cutBar.ts**: S0 only (`setPieces(n, max, busy, canSplit, text)`). **src/shell/hudBinding.ts**: S0 only.
**src/contracts.ts**: section 4 (orchestrator). **Tests**: `_harness/shellview/node_checks.ts`, `_harness/browser_shell.mjs`, `_harness/mocks.ts` (7.2, 7.3); new `_harness/shellview/cutregion_checks.ts` (N13) wired into run_probes.

## 11. Where everything is
- This memo: `_handoff/design/CUT2_SHELL.md`; scripts: `_handoff/design/CUT2_SHELL_scripts/` (m1 launch cause, m2 push travel, m3 / m3_d split sequences, m4 swipes, m5 build cost, m6 fold centroid, m7 scripted parting).
- Read this session: RESUME.md, CUT.md, LOCK.md, UI.md, STATUS.md, VERIFY_SHELL4_A.md, SHELL_4.md, SHELL_4_FIX1.md, cut.ts, bodies.ts, game.ts, driver.ts, cutBar.ts, contracts.ts, shape.ts, softbody.ts (piece / neck / goal sections), bodyview.ts, cutfx.ts header, face.ts header, audio/cut.ts header, collection/meterfeed.ts, probe_cut.ts header, debugHook.ts, grep of node_checks.ts and browser_shell.mjs.
- Not done by me (designer): any edit of src/ or the harness; no browser run; nobody listened to any sound.
