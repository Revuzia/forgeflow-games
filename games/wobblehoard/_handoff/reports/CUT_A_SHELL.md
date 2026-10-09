# CUT_A_SHELL: running report of the SHELL lane, CUT-A slice (keep under 10 KB)

Brief: `_handoff/briefs/CUT_A.md`. Tasks: S0, S1 (Leg 1: shell-1) DONE; S2 first half + Minis (Leg 3: shell-2, this file's second part) DONE; S3 vocabulary, S4, S5a later. Nothing committed by this lane.

## Leg 1 (shell-1): S0 and S1 DONE (short)
- S0: `cutText.ts` (every cut string), `cutBinding.ts` (Cut bar wiring, Hand hint), `cutBar.setPieces(n, max, busy, canSplit, text, style, canChangeStyle, canUndo?)`, `Cutter.style/canChangeStyle/setStyle/prewarm`, one `game.ts` line.
- S1: `cutRegion.ts` (pure cut tree: `cutPiece, group, joinGroup, undoCut, rollbackCut, regionOf, ...`) + `_harness/shellview/cut_checks.ts` (X18: 100 000 sequences, 2.2 M operations, 0 failures; 23 mutants, 20 killed, 3 equivalent).
- Baseline before leg 3 (this PC): `tsc` clean; `node_checks` 128/131 (reds: A-F3 x2, A-F7); `probe_app` 183/183.

## Leg 3 (shell-2): S2 first half + Minis DONE
### What changed (all my files; `game.ts`, `contracts.ts`, `hudBinding`, `cutBar` untouched)
- `src/shell/cut.ts` REWRITTEN (1050 lines, CRLF). `Piece = { body, leaf, frac, built }`; pieces are peers, `pieces[0]` is the anchor = the play body = the larger child (ties: side A).
  **Clean engine** (used when the play body offers `planCut/prepareCut/placeAt`): `planCut` ('at' for swipes, 'median' for Split in two) -> refusals in spec order (`small` 1/8 - 1e-4, `limit` incl. the particle rule, `thin` aspect < 0.08, `loose` !sound; each wobble + one line) -> `cutPiece` in the tree (rolled back on any later refusal) -> neck: every step the world plane is recomputed from the LATCHED rest plane (`restPlaneToWorld`, exported), `setNeck(plane, k, depth)` (depth per family, CUT2 11), `setCutSeam(view, plane, k, {from, to})`, `prepareCut(3)` until built (node: Infinity budget, fixed stages); once built, ONE body is constructed per neck step so the swap frame only places them; hold 0.08 s, +0.15 s at most while unbuilt -> swap: exact `at` from the built bodies' `piece.offset`, parent frame, `vel_c - (v1 - v0)` (the neck's own velocity removed), `placeAt`, ONE common lift, `clearMat` here (first cut only), `addExtra` x2 / `promote` (new stage) or `swapTo` (old stage: this build's stage has no `setPrimaryBody`), `partPieces`, audio, haptics, "Cut into N pieces." -> scripted parting (open loop: `moveTo(base +- 0.5 g s)`, G by family x R0/0.5 x calm 0.6, PART_S 0.30/0.45; a near-level plane (|n.y| >= 0.75) drops the upper piece min(G, 5 cm) instead; floating: along the normal). A finger / join / new cut ends it.
  Split in two: first press on a whole = the squishy's own line between the eyes (normal = R(frame)(1,0,0); through the eye midpoint when `stage.eyeAnchors` exists and the share is in [0.40, 0.60], else the median plane); later presses = 4 candidates at 45 degrees, best aspect (prefer small turn within 0.03). `canSplit` uses 2/8 - 2e-4. Prewarm: plans the likely first Split in two, builds it over idle frames, constructs the two bodies once to pay the constructor, `stage.warmPieces?.()`.
  Joins: twin join by drag/release (old, verified gesture logic kept); the twins meet MATED (giver `moveTo` to `recv.center + R(frame)(off_g - off_r)`, bridge glow), then the pair glides home together and `createBody(genome)` replaces both (fresh whole; ids/tree reset; `clearPieceCache` best effort). Reconnect all: same machine for all pieces. Leave paths: `reconnectAll(false)`, neck unwound (`setNeck(null,0)`, seam off, tree rolled back).
  **MAX_PIECES_CLEAN = 2** (export); `CutDeps.maxClean?` and `CutDeps.deterministic?` are test-only optional deps.
  **Minis engine** (style 'minis', or a physics/mock without `planCut`): the old scaled-whole path: share from `measureCut` (deformed mesh), pieces `{ frac, chunk: false, at: lobe centre, vel }` (own face, no region), old limits 6/4, receiver of a join = the LARGER piece (ties anchor), `setFrac` growth + ghost as before; "Cut into N minis."; Reconnect all ends in a fresh whole. Bug found and fixed: the merged share must come from the shares recorded at the join start (the giver's body frac shrinks to 1/8 during the flow).
- `src/shell/bodies.ts`: `BodyManager.promote(body)` (stage `setPrimaryBody` + `removeBody` of the old play body, identity unchanged, false on an old stage); `showExtra` no longer passes `chunk: true` (passes `piece: true`, a hint).
- Kept only for the harness (documented `@deprecated`): exports `SETTLE_S`, `SETTLE_GAP` (node_checks imports them; S4 deletes), `faceAnchor` (debugHook.ts imports it; S3 deletes), `supportAlong`, `lobeCentres`.
- NEW `_harness/shellview/cutter_checks.ts` (real SoftBody through `createApp`; sections first, level, refuse, abort, minis, twin, primary).

### Measured (this PC, shared and busy)
- `tsc` clean. `probe_app` 183/183 (three runs, the last after the final edit). `node_checks` 123/131 (below). NEW `cutter_checks.ts` (`--only=first,level,refuse,abort,minis,twin,primary`, about 2 min): **46/48**; the 2 reds are kneadle (putty) rows that wait for PHYS P4/P5 (below). Bundle (`vite build` to scratch): G0 1294 of 3072 KB, G0b 391 of 600 KB gzip.
- Split in two (first press, no eyeAnchors) + Reconnect all on the 12 family species: 12/12 two pieces, shares 0.500+0.500 (+-0.001), mesh volume error <= 0.23 % (max, kneadle), Reconnect all -> fresh whole in 93 to 166 steps, every time at the middle with the original genome object. Eye plane path (fake `eyeAnchors`): 0.501/0.499.
- Putty (kneadle) is the worst family: first-press Split in two opens the centres by 0.61 m at 1 s (G is 0.10), hi 1.248 (rest 0.422), peak upward 2.36 m/s; with `collide` off hi 0.635 / 0.85 m/s, with `moveTo` off 1.16. So the shipped collide, not the script. These are the two red `cutter_checks` rows.
- A horizontal swipe (the gate): cuts on gel (dollop), putty (kneadle), sticky (twangle), foam (capnap): 0.519/0.481, 0.516/0.484, 0.549/0.451, 0.551/0.449. The upper piece rests on / near the lower in 3 of 4; **kneadle's upper piece ends 1.31 m away** (tilted 15 degrees cap, tipped on its side; the shipped collide). Not a shell cause: PLOP_MAX 0 gives the same.
- Cost (node, busy machine; browser numbers are for the orchestrator's X20): `splitInTwo()` call cold 77 to 97 ms, prewarmed 6 to 11 ms; with prewarm the neck steps cost 0.1 to 0.3 ms, the two constructors 8.5 and 9.1 ms in neck steps 1 and 2 (cold: 32 ms each, in the prewarm frames), the swap frame `update()` 6.6 ms (before the pre-constructed bodies: 80 to 117 ms).
- Nested true cuts with `maxClean: 6` (code path for the next leg): 5 Split in two presses -> six pieces 0.125 x4 + 0.25 x2, cells consistent, anchor = play body, Reconnect all of six -> fresh whole (138 steps).
- Minis: 5 presses -> 6 minis (0.125 0.125 0.250 0.249 0.125 0.125), sixth refused, volumes within 0.5 %, Reconnect all -> fresh whole.

### node_checks (128/131 -> 123/131 at the last full run; red rows encode the old chunk build or are physics-owned)
Fixed by the true cut: A-F3 level swipe, A-F7 (volumes). Red now (8), all to be re-specced by S4 or owned by PHYS:
1. `X03 shell: the face piece is the PLAY body ... eyeless chunk (AddBodyOpts.chunk)` (chunk flag on the stage).
2. `CUT: a new chunk is held at its spot ... SETTLE_S` (steering deleted, 6.5).
3. `X03 shell: the face piece is the side holding the eyes' anchor` (spec: DELETE).
4. `X01 real physics: Split in two ... the other an eyeless chunk (AddBodyOpts.chunk)`.
5. `parting gap: ... steered to a surface gap of 0.16 m (SETTLE_GAP)`.
6. `X01 real physics: a second Split in two makes 3 pieces` (MAX_PIECES_CLEAN = 2 in this slice).
7. `A-F3 ... a chunk alone with its flat cut face ... stays on the table` (the legacy chunk build; red at baseline; deleted with it, P9).
8. `A-F3 ... after Split in two nothing rises above 1.0 m`: only **capnap 1.04** (rest height 0.64). Cause measured: the shipped `collide` shoves the flush pair apart (peak upward centre speed 2.7 m/s; with `collide` off the highest centre is 0.645, with `moveTo` off 0.99). PHYS P5. A shell-side "no contact for 1 s" (ghost) was tried and made it worse (3.6 m/s when contact resumed): removed.
Green because the mock engine degrades to Minis (a body without `planCut` cuts scaled copies): X05 leave paths, N1 blade, refusals X02, limits 4/6, the join gesture rows, tool routing.

## Notes
- The RENDER lane's working tree now has `stage.setPrimaryBody` and `stage.eyeAnchors`: `bodies.promote` and the eye-midline plane are live in the real app (my rows use fakes for both; the browser harness has not run them).
- `swapWhole`'s failure branch (createBody throws) leaves the squishy cut and tries again at the next leave; it no longer scales the half up.

## Next
S3 (promote exists; `debugHook` / vocabulary), S4 (re-spec the 8 rows; `cutter_checks` is the seed), S5a with the owner's eye pass. Needs from other lanes: P5 (collide) for the near-level and capnap/kneadle hops; R3 `setPrimaryBody` / `eyeAnchors` / `warmPieces` / framing of two flush halves (RENDER finding 1).
