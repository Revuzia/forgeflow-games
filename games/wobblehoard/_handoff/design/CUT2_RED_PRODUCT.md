# CUT2 red team: PRODUCT, UX and PROCESS lens

Reviewer: adversarial, read-only, 2026-10-08. Target: `_spec/CUT2.md` (835 lines) and its memos `_handoff/design/CUT2_PHYS.md`, `CUT2_RENDER.md`, `CUT2_SHELL.md`.
Method: read RESUME, CUT.md, CUT2.md in full, the SHELL and RENDER memos in full, the PHYS memo by grep; re-read the code the spec's claims stand on (`src/shell/cut.ts`, `game.ts`, `hudBinding.ts`, `src/ui/cutBar.ts`, `toyTray.ts`, `src/render/bodyview.ts`, `quality.ts`, `src/physics/softbody.ts` pull level and righting torque, `collection/meterfeed.ts`, the harness files); ran four small node scripts (no browser, no repo edit, all exited) in
`scratchpad\truecut\redproduct\`: `eyes_midline.ts`, `eyes_yaw_fine.ts`, `yaw_drift.ts`, `cansplit_tol.mjs`, `first_press_share.mjs`.

**Verdict: needs-changes.** 3 MAJOR, 12 MINOR. The core geometry decision (true parts, region algebra, latch, flush placement, any-pair join through a convex node) is sound and answers the owner's four design facts. What is wrong is at the edges the player touches: how they are told to join, which button the owner's own word "SPLIT" calls, and a render path (the join commit) that the spec depends on and nobody tests.

What I checked and found TRUE (so the author does not re-check): the cut.ts / bodies.ts / boot.ts line references of appendix A.1 that I sampled (310, 356, 372, 593, 81, 197-203, 493-536; bodies.ts:109; boot.ts:111-112); appendix A.4 reproduces exactly (re-run: the two eye centres are on opposite sides of the median plane for 50 of 50 species at yaw 0; the rest-size bead crosses it for granulo, wrigglo, kneadle, marigel, slumbrel, same clearances); the engineer-day rows add up to the stated 46 (16 + 13.5 + 9.5 + 2 + 0.3 + 4.5); CUT.md rules 1, 2, 3, 5, 6 are preserved.

---

## 1. The ten player scenarios, walked against the spec

| # | Scenario | Where the spec decides it | Result |
|---|---|---|---|
| 1 | **Centre cut** (the owner's example; Split in two, default view) | 6.6, 8.3, A.4, X03' | Delivered for 45 of 50 species with a clean bead each side; 5 of 50 clip a bead at rest size (granulo, wrigglo, kneadle, marigel, slumbrel; wrigglo's right eye is cut almost in half); **breaks as soon as the view is turned about 5 degrees** (PR-02). |
| 2 | **Edge cut** (swipe near an edge) | 6.2, 5.2, K3 | Works: a flat-faced big part and a slice. 25 % of random swipes are refused by the existing 1/8 rule (SHELL M4). A thin slice may tip and travel up to 0.30 m (K3, X13 names it). Acceptable, but "a piece never moves on its own" (rule 11, section 1 row "How a piece rests") is then worded stronger than the build. |
| 3 | **Cut through the eyes** | 8.3 clip rule, RP2, K10 | Designed correctly (half a bead each side, fallback ladder), common (46 % of random cuts), and **the clipped path has never run** (A.2). Fine as a plan; it is the right thing to prove first (PR-10). |
| 4 | **Cut a half again** | 4.3, 6.2 | Built from the original silhouette, so nothing compounds. `thin` and `loose` refusals exist. Nested pieces are visibly coarser (detail 2, K14). OK. |
| 5 | **Six pieces** | 6.6, X10, 8.6 | Five presses reach six, **but `canSplit` uses a tighter tolerance than the refusal it guards; about 4 % of runs stall at five** (PR-05). Phone: 4. |
| 6 | **Join a piece to a non-neighbour** | 7.2 SPAN | The rule is right (always a valid body, ends at the root). The player is **told the wrong tool** (PR-01), sees pieces they did not touch fly in with a **visual-only** preview (PR-14), and the render side of the commit has no design (PR-03). |
| 7 | **Poke a resting piece** | 7.3, X15 | Works with the Hand. With the Cut tool in hand nothing pokes (a drag cuts). The join intent machine's thresholds sit on the wrong side of the natural resting gap by the spec's own numbers (PR-06). |
| 8 | **Toss a piece** | 7.3, X15 | The 0.8 m/s release gate is a real improvement; X15 includes toss and bump. OK. |
| 9 | **Leave while cut** | 7.6, X05 | Unchanged paths; nothing new breaks. The baseline the leave-path checks run on is red by design (PR-07). |
| 10 | **Phone one-finger swipe** | game.ts:623, 6.1, rule 14 | The blade works. With six small pieces touching, the blade line visibly crosses several but cuts one (rule 14), which a finger-on-glass player will not predict. The fresh face is edge-on by construction and the peek is optional and off in Calm (PR-13). The cut cost is gated on desktop SwiftShader only (PR-12). |

---

## 2. Findings

### MAJOR

#### PR-01 MAJOR: the join instruction sends the player to the wrong tool; there is no hint anywhere else

**What.** CUT2 section 9.3 (line 448) replaces the Cut bar hint with "Swipe to cut again. Drag a piece onto another and hold to join them." The SHELL memo justifies dropping the words "With the Hand," as "(the Hand is in the tray, not needed here)" (`CUT2_SHELL.md:460`). That is false: with the Cut tool in hand a drag draws a blade and cuts.

**Evidence.**
- `src/shell/game.ts:623`: `if (tool === 'cut') { if (!blade && ...) { blade = {...}; ... } return; }`. The press never reaches `gestures.pointerDown`, so no grab, no `driver.touch.contact()`, no `dragOf`; the whole join intent machine (7.3) is fed only by those, so it cannot run in the Cut tool.
- `src/ui/cutBar.ts:47` today reads "...With the Hand, drag a piece into another and hold to join them." (correct).
- `_harness/browser_shell.mjs:1782`: "(CUT.md 1: pieces are played with, and joined, with the Hand: a drag in the Cut tool is a cut)"; the harness presses `c` to leave the Cut tool before every join gesture.
- CUT2 section 1 row "Play with the pieces: Turn the tool off." says it; the hint contradicts it.
- The Cut bar text is the **only** place the game mentions joining (`grep -i join|reconnect src/ui src/shell/hudBinding.ts`: the bar, the live-region lines, nothing in `toyTray.ts`; the Hand's tray hint is "Poke, squish, stretch"). After Done the Hand has no join hint at all.
- X14 / X15 do not say which tool the gesture runs under, so a harness written to the spec could pass while the shipped hint misleads.

**Fix.**
1. Restore the words: "Swipe to cut again. To join pieces, press Done, then drag one onto another and hold." (or keep "With the Hand,").
2. Add one line to the Hand tool: when `pieces >= 2` and the tool is the Hand, show the transient hint pill once per cut ("Drag a piece onto another and hold to join them.") and put it in `cutText.ts`.
3. State in section 7.1 that joining is a Hand-tool gesture, and in X14 / X15 that every join row starts with `setTool('hand')`; add a row "a drag in the Cut tool never starts a join".

---

#### PR-02 MAJOR: "SPLIT between the eyes" only holds within about 5 degrees of face-on, the acceptance measures exactly 0 degrees, and a cheap fix was rejected on a premise that does not hold

**What.** The owner said "when I SPLIT". Split in two is camera-relative (`cut.ts:529-537`: the plane contains the camera and the piece, normal = camera right projected horizontal) and the spec keeps that (owner question 4 recommendation, line 774). Every eye sits at a rest azimuth of only 9 + 17 x spacing degrees (`face.ts:122-125`, 9 to 26 degrees) around the +z axis, so rotating the plane by `psi` moves it `0.9 sin(psi)` R0 at the eyes' depth, which equals the whole clearance. Measured (`eyes_yaw_fine.ts`, same formulas as the author's `v_eyes2.ts`, median plane of the x-normal family rotated by `psi` about +y, 50 species):

| camera vs face yaw | eyes on opposite sides | AND rest-size bead clear of the plane |
|---|---|---|
| 0 | 50/50 | 45/50 |
| 2.5 | 49 | 43 |
| 5 | 49 | 37 |
| 7.5 | 49 | 19 |
| 10 | 49 | **5** |
| 12.5 | 47 | 1 |
| 15 | 45 | **0** |
| 20 | **2** | 0 |
| 30, 45, 60, 90 | **0** | 0 |

- 10 degrees is 23 px of drag (`feel.ts:38` `orbitRadPerPx 0.0075`), and an empty-space finger drag orbits on touch (`gestures.ts:283-315`); nothing recentres the camera (`stage.ts:512`).
- The squishy itself does not turn much under one-finger play (`yaw_drift.ts`: 0.0 to 2.3 degrees after 4 s on five species, three kinds of pull/nudge), so the dominant error is the camera, not the body.
- X03' (a) is measured "at the default camera" (line 577) and section 1 / rule 1 / section 9 state "A centre cut between the eyes gives one eye on each half" without the condition. The claim is unconditional; the measurement is a single point.
- The rejected alternative (A.4, 17 #15, K16, tuning T6: "an eye-aware plane costs a share of 0.45 to 0.55 for 3 or 4 species") is not a blocker: I computed (`first_press_share.mjs`) that a first press at any share from 0.35 to 0.65 still reaches six pieces in five presses with every piece at least 0.1375; and the exact-half first press leaves the four smallest at exactly 1/8 with **zero margin** (the PR-05 tolerance bug lives there). An eye-midline plane (through the midpoint of the two eye centres, x-normal family, measured with the author's formulas): rest-size bead clear on 48 of 50 (only granulo -0.018 and marigel -0.022 R0 still cross; their eyes touch the centre line by themselves), squeezed-reach clear on 46 of 50 (munchip, granulo, petalop, marigel cross), shares 0.421 (wrigglo) to 0.579.

**Fix.**
1. First press of Split in two on a whole squishy: normal = `R(frame) . (1, 0, 0)` projected horizontal (the squishy's own line between the eyes, the same plane as today at yaw 0), offset = the eye-midline plane when its share is within [0.40, 0.60], else the median. Needs the eye anchors from a pure helper moved out of `face.ts` into `src/core` or `src/data` (the shell must not import `src/render`); 0.5 to 1 day. Later presses keep the four-candidate rule.
2. If the owner wants camera-relative kept (question 4), say so in section 1 ("holds with the camera within about 5 degrees of facing the squishy") and show the line in the Cut bar.
3. X03' gains a camera-yaw sweep (0, +-5, +-10, +-40, 90 degrees) and a body-yaw sweep, on all 50 species, counting clean separations, and **either passes or the section 1 claim is narrowed**. Add the explicit species set that is expected to show a clipped bead at the chosen plane.

---

#### PR-03 MAJOR: the in-place commit of a pairwise join has no render design, no task and no acceptance row, and the render memo's premise for it died with decision 17 #7

**What.** Section 7.4 and 5.7: the receiver morphs its rest shape for 0.8 s (`setRegion`), then commits in place (`adoptRest`) and "RENDER rebuilds that view's piece mesh once (<= 8 ms) keeping its id, clock and face state". Invariant I7 / RENDER R7 says the view re-reads `inner.piece` by reference and "until then the old classification stands, which is right during a join: the cut face about to disappear stays a cut face until the giver has flowed into it" (`CUT2_RENDER.md:141-143`). That sentence was written for RENDER's **knit mode** (faces meet, no tube, swap at touch). The spec rejected knit mode (17 #7) and keeps the 0.8 s receiver morph, so the old classification now stands for the whole morph, not for the instant of contact.

**What the player would see (from the spec's own mechanisms, not run):**
- For 0.8 s the receiver's former cut face is bulging out into a new lobe while still drawn with the cut-face look (`aCap` class, `uCapRough/Coat/Tint/Pore`, rim line, clip planes from `jelly.caps`), and its pattern coordinates `aRest` are the build-time values (8.2), so a swirl or band stretches over the growing lobe.
- The giver carries its own eye, glitter and stars and shrinks by `setFrac(PIECE_MIN)` (7.4) while the render keeps `growth` at 1 and the eye size at `whole.radius` (8.6, 8.3): the bead does not shrink with its host.
- At the commit, in one frame: cap look flips to skin, the second eye appears on the receiver (the giver's vanishes with it), the glitter and star sets re-layout, the pattern coordinates snap. For Reconnect all this is followed by a second change (`swapWhole`, a fresh body and view, `stage.setBody`), 25 to 80 ms per view (RENDER D14).

**Evidence of the gap.**
- No render task covers it: R1 to R4 (lines 669 to 672) list `setPrimaryBody`, clock inherit, `warmPieces`, `addBody` idempotent; nothing says "rebuild on a `piece` identity change".
- No acceptance row: RP4 / X16 compare "whole vs two flush pieces" and a post-Reconnect-all frame after `swapWhole`; X23 (join smooth) is physics only; X09's gate is "10 rapid cuts and a Reconnect all", not a pairwise join; X14 is node-only.
- Decision 18 ("in place ... RENDER keeps the view id, clock and face state") reasons about identity, not about the picture.

**Fix.**
1. Add RENDER task R3b (1 to 1.5 d): expose `SoftBodyLike.morphT?` (0..1, the `e` of 5.7) and let the view cross-fade the old cut-face look to the skin look by `morphT`, fade the new features (second eye, specks, stars) in over the last third of the morph and fade the giver's out as it shrinks, keep eye size tied to the host's linear scale during `setFrac`, and recompute `aRest` for the morph's moving vertices or hold the pattern still.
2. Add rows RP14 (browser, per family): per-frame mean abs RGB difference across the commit frame <= 1/255 and no 8 x 8 block over 6/255, luminance step <= 0.012 (the X09 bar), three joins per family (half + half, quarter + quarter, half + quarter), judged on the film strip too. Add it to X09 as "10 rapid joins".
3. State in 8.1 / I7 that the old classification is **not** acceptable during the morph.

---

### MINOR

#### PR-04 MINOR: X03' as written is partly vacuous, partly self-contradictory, and never measures the built pieces for 44 of the 50 species

- Part (a) (line 577) splits the whole's eye centres (`face.ts` formulas on the detail-3 rest mesh) by the Split-in-two plane. It involves no piece, no builder and no stage, so the **old chunk build passes it 50 of 50**; it cannot discriminate old from new.
- Part (b) asserts "exactly one bead per piece view ... none on the line" on "6 species of extreme eye spacing and size". Extreme spacing is exactly the set (a) says the plane crosses (granulo, wrigglo, marigel: eyes 0.15 R0 from the centre line, reach 0.21). A bead that straddles the plane is a bead on both views, so (b) fails by (a)'s own prediction, or the six are quietly chosen from the safe 45.
- Part (c) (vertices inside own half-spaces, not a scaled copy) is the good one; it discriminates and is independent.
- Of the 50 species, 6 get a stage-level eye count; X12 sums eyes over 100 random trees only.
**Fix.** Name the six (three clean extremes, three from the crossing set with the expected clipped shares), and add a 50-species browser sweep of `debug.eyes()` after Split in two at three camera yaws (PR-02). Replace (a) by "each built piece's eye share by `eyeCentres` and clip planes" so that it can fail.

#### PR-05 MINOR: `canSplit` uses a 1e-6 tolerance, the refusal it guards uses 1e-4, so the keyboard path can stall at five pieces

- Rule 4 and 6.2: `small < PIECE_MIN - PIECE_TOL` with `PIECE_TOL = 1e-4` "so the exact halves of a 1/4 piece pass". Section 6.6 (lines 306): `canSplit` false when `target.frac < 2 PIECE_MIN - 1e-6`. The median search stops at `|fa - 0.5| < 1e-5` (6.6, 5.6). A 1/4 piece built from two such halvings can read 0.249985, below 0.249999.
- Monte Carlo (`cansplit_tol.mjs`, 20 000 runs, uniform stop error inside 1e-5, largest piece first): **3.7 % of runs have `canSplit` false at the fifth press** ("No piece is big enough to cut again"), 96.3 % reach six; with `2 PIECE_MIN - 2 PIECE_TOL` 100 %. At 50 species that is about two species failing X10 (five presses reach six on 50 of 50).
**Fix.** `canSplit` and the 6.6 refusal use `2 PIECE_MIN - 2 PIECE_TOL`; add a unit row "a 0.249985 piece can be split". If PR-02's unequal first press is adopted the margin returns by itself.

#### PR-06 MINOR: the join thresholds are inconsistent with the spec's own numbers, and "the fix-round-1 behaviour" is misdescribed

- 7.3 and 5.5: stacked flush halves rest 39 mm (dollop) to 55 mm (chunkle) apart; contact skin is 32 to 44 mm (PHYS memo:301, 316). `TOUCH_GAP = max(0.03, 1.1 x pairSkin)` is 35 to 48 mm. The natural spacing is 1.22 to 1.25 times the skin, above 1.1, so a pair at rest never counts as touching; the PHYS memo's own advice "treat gap <= 0.07 R0 as touching" is 35 mm at R0 0.5, below its measured 39 to 55 mm. The HOLD path then needs the finger to compress the contact; X15 would show it but the design should not depend on that.
- Section 7.3 labels `'touching'` "DEFAULT = CUT.md and the fix-round-1 behaviour" but defines it as "JOIN at once if ... ARMED with gap < TOUCH_KEEP_GAP". ARMED needs only `intent` and a gap under `ARM_REACH` (about 10 cm); the verified code (`cut.ts:610-631`) starts `contact` only when the skins were under `TOUCH_GAP` during the drag. So the spec widens release-join from "was touching" to "came within about 10 cm after a stretch toward the twin of 0.25 radius", which is exactly the stretch-and-release play (it pays pull SP) that the verified rows A-F2 were meant to protect.
- X15 lists "pull away" and "rub inward" but, unlike the SHELL memo's N5, not "stretch toward the twin and let go without ever touching".
**Fix.** `TOUCH_GAP = max(0.03, 1.3 x pairSkin)`; the 'touching' release branch requires HOLDING or "gap < TOUCH_GAP at some step of this drag" (as the code does now); add the X15 row (stretch toward and release at 6 to 10 cm: no join); fix the label.

#### PR-07 MINOR: the "checks that encode the old behaviour" list is incomplete, and the baseline it protects is red by design

- `_harness/shellview/node_checks.ts:1330-1411` (section 7h, A-F3 / A-F7) builds `{ piece: { chunk: true, cutNormal... } }` directly (line 1349) and drives Split in two and a level swipe through the whole game. `SHELL_4_FIX2.md:36`: "live tree 127/131 ... the 4 red rows are exactly the physics patch pending". P0 applies only the neck half, and the `flatPoints` half only "if a deploy with old chunks is planned" (5.1). So the chunk-alone row stays red until P9, and after P9 deletes `buildChunkRest` / `flatPoints`, `PieceOpts.chunk` is "accepted and ignored" (5.9): the row builds a scaled whole and passes while testing nothing. This block is not in the section 14 list; the SHELL memo's list pre-dates it.
- Other rows asserting text that changes and not named: `node_checks.ts:737-738`, `browser_shell.mjs:2070, 2442-2443, 2824-2825` ("too small to split", "as many pieces").
- S0 is "no behaviour change (harness green)" (line 673) and O0 records "baseline: node_checks" (line 654) without saying 4 rows are red; RESUME 4 requires "no regression against a previously passing check", which needs a per-row baseline.
**Fix.** O0 records the baseline per row (green / red-by-design) and the commit hash as `PRE_CUT2`; S4 starts from a mechanical gate: `grep -n -i "chunk|face piece|faceAnchor|SETTLE_|lobeCentres|halving|too small to split|peel"` over `_harness/` and every hit is dispositioned in the S4 report (re-spec / delete / keep with reason). Name 7h explicitly: "replaced by X13 and L9; the legacy chunk rows are deleted with the chunk build, not left green".

#### PR-08 MINOR: task order and dependencies (section 14)

1. **S2 needs P1.** S2 "on a mock physics that uses PHYS's pure region module (never invented numbers)" (line 675) but its Needs column is S0, S1; the module is P1 (5.5 d). Section 15 step 3 says S2 runs "in parallel". Either P1 delivers `planCut` on S first (about 2 d) or S2's first half uses a declared analytic mock.
2. **S5 needs R3**, not only R2 (line 678). X20 / K13 (no `stage.setBody` in the cut path, same view ids) need `setPrimaryBody`, idempotent `addBody` and `warmPieces`, all R3. The fallback `swapTo` rebuilds every view (25 to 80 ms each).
3. **Dev members are assigned twice**: section 8.7 and R3 list `eyeCentres`, `caps`, `rimClean`, `visibleEyes` under Phase C, but RP1, RP3, RP7 in R1 need them.
4. **`FRAC_MIN` 0.125 -> 0.124 lands in P3** (5.6) while `probe_cut.ts:152` asserts `clamped === 0.125` and is re-specified only in P9; probe_cut is red from P3 to P9.
5. **`S5-a` (milestone A, line 707) is not a task row** and has no estimate.
6. **No task preserves the pre-CUT2 build** that X13, X16, L5 and L7 must FAIL against ("run once against the pre-CUT2 commit, since P9 deletes the chunk build"); O0 records numbers only.
7. **`probe_cut.ts` rows have two owners**: S4 ("re-spec every check", line 677) and P9 (line 668), the file is PHYS-owned (line 691).
**Fix.** Edit the Needs column and add the rows; add task O0b "tag `pre-cut2-<hash>`, `git archive` it to a kept folder, record per-row baseline".

#### PR-09 MINOR: one file, several writers

- `_harness/browser_shell.mjs` (4002 lines), `_harness/shellview/node_checks.ts` (1590 lines) and `_harness/mocks.ts`: S4 rewrites about 125 hits (76 + 47), LOCK-SHELL ("can start NOW", 15.6) adds gesture rows to the same files, UI batches 1 and 2 add title / HUD / Settings rows. The ownership table (lines 688-698) gives SHELL only "the cut rows of `browser_shell.mjs`" and `_harness/shellview/*`; the rest of those files is unowned.
- `src/shell/game.ts`: S0's one line vs LOCK-SHELL's input port (613-679); "serialise, S0 first" contradicts "start NOW".
- `softbody.ts` (2841 lines): the plan puts a second PHYS engineer on P0, P2 and P5 (14 intro) = `frameUpdate`, the constructor refactor of about 40 arrays, and `collide`, with the constructor refactor feeding the other two.
**Fix.** Give each shared harness file a named owner per week or split by section into `_harness/shellview/cut_checks.ts` / `cut_browser.mjs` so S4 owns whole files; S0 lands before LOCK-SHELL's first game.ts edit; P2 lands before P5 starts on the same branch.

#### PR-10 MINOR: process risk: no contingency, and the least-tested visuals are the ones everything else builds on

- Section 14's 46 days contain verification (V1 2, V2 2, V3 0.5) but no fix round and no re-verification. The repo's own history for SHELL-4 is `VERIFY_SHELL4_A/B` -> `SHELL_4_FIX1` -> `VERIFY_SHELL4_A_R1/B_R1` -> `SHELL_4_FIX2` (`_handoff/reports/`), with MAJORs each time. Add about 6 to 8 days.
- A.2 says nobody has measured "the look of any face" or the clipped-eye path; K10 calls it "the least-tested path". Milestone A is "Optional staging; not a gate" (line 707), yet 36 further days (nested cuts, unions, any-pair joins) sit on top of it. Make milestone A a **gate**: an owner eye pass (V3-sized, 0.5 d) on Split in two, a swipe between the eyes and a swipe through an eye before S2's join work and R2's family looks start; if the clip path fails RP2, the ladder (8.3 b/c) is chosen then, not at the end.
- Owner note #1 of the same message ("Shift does NOT lock the hold") is unbuilt (STATUS) and CUT2 puts it after the round (15.6). The spec already budgets a second PHYS engineer; say whether LOCK's PHYS half (`updateGrabs`) can start on that engineer after P2 lands, or tell the owner it waits about 3.5 weeks.

#### PR-11 MINOR: economy rule and acceptance independence

- Rule 6 / X06: "pays a touch on a piece like a touch on a whole". The pull level is hand travel over `maxPull x restRadius` (`softbody.ts:1083-1085`) and a true piece's `restRadius` is `R0 cbrt(frac)` (4.1 step 10), so the same hand travel is twice the level on a 1/8 piece; X06 tests only a 1.2 s squeeze. The render uses `0.45 x whole.radius` for dents (8.2) while the physics level uses the piece radius: two definitions in one feature. Add "a pull at fixed hand travel on 1/8, 1/4, 1/2 pieces, ratio reported, decision recorded".
- X06's "no poke / release / snap SoftEvent from a join" conflicts with a real-gesture join: the join starts with `beforeChange` -> `releaseEverything` -> `grabRelease`, which emits `snap` with the hold time (`softbody.ts:1117-1124`). Run the X06 join leg programmatically (`join(i, j)`) and let X15 own the gesture.
- X01's first measurement `restVolume / (frac V3)` is a tautology since `frac` is defined as `restVolume / V3` (3.2, 5.6). X02 pins "EXACTLY the three known single planes" (prototype output, line 576) so a change of the 0.95 threshold fails it without a defect. X04's "bit-for-bit" is satisfied by construction (a fresh `createBody(genome)`); what it really bounds is the swap pop. X14 (d) recomputes `group(P, Q)` with the same module that produced it. Keep them as regression pins but label them so, and add one independent geometric row for joins: voxel IoU (R0/32) of the merged body against the union of its source pieces' regions on the original detail-3 mesh.

#### PR-12 MINOR: performance gates miss the phone and the join frames

- X20 (line 594) is desktop SwiftShader. Cut build budget is 3 ms x 15 to 24 neck steps = 45 to 72 ms for two children whose p95 is 40 ms each on this PC; a phone CPU 3 to 6 times slower misses it on almost every cut and falls to "build in the swap frame (a one-off hitch)" (6.3) on the player's most common device. Add a CDP CPU-throttle 4x run of X20 and RP9, and a rule: lengthen the hold up to 0.15 s only on a miss, report the rate.
- Joins: `prepareRegion` has lead time only while ARMED; a release-join or a slow set-down joins "at once" (7.3), and the prototype union builds ran up to 412 ms (5.7); `adoptRest` re-allocates about 40 arrays, "40 ms is fine, it is an event" (5.7), against the 8 ms standard for a cut. No row gates the first join frame or the commit frame. Add X20b: `setRegion` first frame <= 8 ms, `adoptRest` <= 16 ms (slice it if not), and let a set-down join wait up to 0.25 s for `prepareRegion`.
- The auto governor (`quality.ts:67`, drops tier when the 1 s average is over 24 ms) can drop med -> low after six pieces exist; "a quality drop below the piece count only blocks new cuts" (SHELL 5.1), so six pieces can render at low. The fine-vertex bound for low (2.501) is computed for at most four pieces (8.2). Compute the 5 and 6 piece total at low or force `n = 2` merging of the smallest views.
- 13.3 / X08 split "6 pieces <= 2 whole bodies" into physics <= 1.0 and render <= 1.5 with no combined number; the prototype's kneadle was already 1.10 without the new contact (K8) and the render baseline is 1.32 to 1.45 (STATUS). Give the combined bar a decision rule (what the owner gets if kneadle is 1.2).

#### PR-13 MINOR: the cut face is edge-on at the moment of the cut, and 43 % of swipes part without a visible parting

- The cut plane contains the camera, so the fresh face is seen exactly edge-on (8.5 "Peek", line 418). The only default remedy is the 8 degree peek, which is **optional, owner question 3, and off in Calm** (rule 8). The 12 cut-face looks (8.4, 2.5 days of filmstrips) are seen only after the player orbits.
- Near-level planes (`|n.y| >= 0.75`) do not slide (6.5): the upper piece is lifted 0.05 m and dropped. At the default pitch 0.27, `|n.y| = cos(alpha) cos(0.27)` for a swipe at screen angle alpha, so alpha within +-38.9 degrees of horizontal (43 % of orientations, including the most natural left-to-right slice) gives a stacked pair with a seam. R5 / line 302: "not measured".
**Fix.** Give each piece a small outward yaw during PART_S (a "door opening", +-6 to 8 degrees about the vertical, physics-side so it works in Calm), and test the near-level case with X13's stacked row on real families before milestone B. Or make the peek default-on with a smaller, calm-safe amplitude.

#### PR-14 MINOR: accessibility gaps the spec accepts without saying so

- Join has no non-visual preview. While ARMED the group's faces glow (7.3) and "the line says how many" only afterwards (9.3); a low-vision player cannot learn that a drag will swallow three pieces. Announce on ARM: "Joining 3 pieces." (polite live region, once per arm).
- The anchor is the only piece the keyboard can poke ("document it", SHELL 5.1; no task documents it) and the play-target ring sits on it; a keyboard user cannot reach the other five.
- "Undo cut" is not built (7.6, 17 #22): a keyboard player at six pieces can only go to whole. 0.5 d; announce "Joined." on press.
- The line "No piece is big enough to cut again. Join two to make a bigger one." (9.3) advises a gesture a keyboard player does not have; add "or Reconnect all".

#### PR-15 MINOR: wording and leftover vocabulary

- Rule 4 (line 70) ends "A swipe that misses says 'Nothing to cut there.'"; the code does the reverse: swipe miss -> "Swipe across the squishy to cut it." (`hudBinding.ts:331`), Split-in-two miss -> "Nothing to cut there." (`hudBinding.ts:245`). 9.3's table lists both without saying which is which.
- `loose`: "That cut would leave loose crumbs." For the one case measured (Munchip and Selenuff, a level plane that takes both big ears off) the player sees two large ears, not crumbs; try "That cut would split off two separate parts. Try another angle."
- Vocabulary the spec leaves alive: `contracts.ts:98-100, 301` doc `PieceOpts.chunk` as "the face piece" and `AddBodyOpts.chunk` as "an eyeless chunk", `chunk: boolean` stays **required** (10); `boot.ts:109`, `mat.ts:9`, `bodies.ts:34`, `debugHook.ts:83-87`; the mat keeps building through the legacy "scaled whole" path (`{ frac: 1, chunk: false, at }`), and any `{ frac < 1 }` without `region` still builds the shrunken copy the owner objected to. `_spec/CUT.md` keeps the old paragraph and X03 with only a pointer line (O2); `SOUND.md:982` says "a small chunk". Add a task row "reword the comments and docs, make `chunk` optional in the type, give the mat `{ at }` only".
- Joined text: "Joined. 3 pieces." reads as two sentences; "Now 3 pieces." Optional.

---

## 3. Per-lens checklist, answered

- **Does it deliver "a REAL cut, one eye each side, clean cuts, not a little ball"?** Yes by construction for the swipe route and for Split in two at face-on; no ball, no shrunken copy, no role (the code deletions in 5.9 and 14 are complete). Not for Split in two once the view is turned (PR-02).
- **Rendering and wording, no more face piece / chunk language?** Player text: clean (9.3 rule). Code and docs: not clean (PR-15). The one wording defect with a behaviour consequence is PR-01.
- **Accessibility.** Keyboard route reaches six (except the 4 % stall, PR-05); live-region lines exist; gaps in PR-14.
- **Economy rule.** Preserved structurally; test coverage thin (PR-11).
- **Regression against the 473 / probe_cut.** List incomplete, baseline red by design, probe_cut red from P3 (PR-07, PR-08.4).
- **Lane tasks complete and ordered?** No: PR-08.
- **Two lanes, one file?** Yes: PR-09.
- **Acceptance independent and discriminating?** Partly: PR-04, PR-11; the regression rows that run against the pre-CUT2 build (X13, X16, L5, L7) are the best-designed part, but nothing keeps that build (PR-08.6).

## 4. Not checked

No browser, no sound, no GPU. The clipped-eye render path, the cut-face looks and the join visuals described in PR-03 and PR-13 are inferred from the spec's mechanisms and the current `bodyview.ts`, not rendered. The Monte Carlo of PR-05 assumes a uniform stop error inside the 1e-5 window; the real distribution is per species and deterministic. The yaw table in PR-02 uses the author's own eye formulas (`face.ts` 105, 122-125, 161-163) against the detail-3 rest mesh and `SoftBody.measureCut`; it does not use the future `planCut`. Body-yaw drift was sampled with three actions on five species, not a play session.
