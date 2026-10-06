# PHYS lane brief: finish the round-2 fix round, then body contact, toss and the cut primitives

**You own:**
- `src/physics/**`
- `src/data/shapes.ts`, and the `shape` fields of species in `src/data/catalog.ts` (silhouettes only; regenerate `_spec/CATALOG.md`
  with `node _harness/gen_catalog_doc.ts` and keep `probe_catalog` green)
- `_harness/probe_softbody.ts`, `probe_species.ts`, `probe_families.ts`, `_harness/physview/**`, `_harness/browser_physics.mjs`
- new `_harness/probe_cut.ts`
- additive physics members in `src/contracts.ts`

Your port is 5368. Your scratch folder is `scratchpad/phys3/`.

**Specs:** `_spec/SQUISHY_SCIENCE.md` (sections 3, 4, 6), `src/data/materials.ts` (header recipe), `_spec/CUT.md` (all),
`_spec/FUN.md`, `_spec/NEXT_STEPS.md` stage B items B2-B4.

## Phase 1: finish the round-2 FIX ROUND

An independent verifier FAILED physics round 2 at commit 2e586e0. Its verdict, with repro commands and scripts, is in
`scratchpad/phys_verify/` (VERDICT.md, plus rubset.ts, pullset.ts, hop.ts, hoptrace.ts, repro.ts, perf.ts, attack.ts, cer_iso.ts and
the fixtest copy). The previous engineer started the fix round and was stopped mid-experiment. Its work is in
`git diff 2e586e0..HEAD -- src/physics` (about 100 lines in softbody.ts, including a "gravity only when rising above rest" hop
experiment).

**That work in progress currently BREAKS gates that passed at 2e586e0.** `node _harness/probe_softbody.ts --quick` gives 110/114,
failing:
- G1 starter wobble (oscillations; tau);
- G1 wobble n_osc and tau for all 14 shoulder and peak releases;
- the hard side shove at the swirl peak.

At 2e586e0 the verifier measured 114/114. Start by understanding that diff. Keep what is sound, revert what is not, and restore those
gates first.

Then fix, in this priority order, at the root, never loosening a threshold:
1. **MAJOR-3 hop after release.** 12 of 50 template species leave the table, for example ambrosel by 211 mm.
   - Add a hop-after-release row to `probe_species` for all 50 species x 3 genomes (no particle may rise more than 10 mm above the
     table after release).
2. **MAJOR-2 full pulls crease the foot rim at release.** 111 of 608 pulls.
   - The verifier's fixtest kept the table-edge fold limit on while the feet are pinned. Extend it through the release transient.
   - Add a per-family full-pull-and-release row.
3. **MAJOR-1 rubs crease 6 families on catalog bodies** (slime, putty, sticky, beads, mochi, waterfill).
   - Add per-family rub and slide rows on real catalog species, for template and soft-corner genomes.
4. **MAJOR-4 perf.** Every family must be at least 10 percent under the 2.0 ms per frame bar on the verifier's `perf.ts` workloads
   A and B, measured solo.
5. **Contract items for the shell:**
   - fire `release` on max(compression, press);
   - add a live optional `SoftMetrics.pull` that is translation-free, and make the snap intensity translation-free the same way;
   - document both in `contracts.ts`.
6. **Minors 5, 6/13, 9, 10, 11, 12, 14 and 15** of the verdict, as far as they are cheap and safe.
7. **Silhouettes.** These must read as their `CATALOG.md` silhouette from the default 3/4 camera:
   - crumbit: a pear, not an egg;
   - tadpolo: its tail visible;
   - wrigglo: its head raised;
   - capnap: a stalk;
   - zingle, taffelin, skeinara and constello: recognisable, not lumps;
   - pastrel: a croissant;
   - crimpo, thumbly and boingle: stronger.

   Re-render the 50-species contact sheet and Read it.

## Phase 2: body-to-body contact, toss and the cut primitives (`_spec/CUT.md` section 4, `_spec/FUN.md`)

The contract members are already declared in `src/contracts.ts`, marked `CUT`:
- types: `CutPlane`, `PieceOpts`, the `SoftBodyCtor` option `piece`;
- `SoftBodyLike` members: `frac`, `measureCut`, `setNeck`, `setFrac`, `collide`;
- the `bump` event kind (`KIND_INDEX` and `lastEvent` already sized for it).

Implement them:
1. **B2 `collide(others)`.**
   - A bounding-sphere broad phase, a particle-against-surface narrow phase, friction, and both sides pushed (positions only).
   - `bump` events, rate-limited, with the contact point and the relative impact speed.
   - Determinism and zero allocation.
   - Tested in a new or extended probe with 2-6 bodies: stacking 3 holds for 5 s (it may sag but not sink through); no tunnelling
     at 3 m/s; no fold beyond the probe limits at contacts.
2. **B3 pick up and toss.** Pulling beyond `maxPull` unsticks the body from the mat and carries it kinematically. Releasing it
   throws it with the finger's velocity: it flies, lands with a 'land' event, squashes and wobbles. The mat's soft rim bounces it
   back. Report the API you chose (additive) for the shell.
3. **Cut primitives:**
   - `measureCut` must be exact to 1% against a voxel volume.
   - `setNeck`: eased, volume held, a waist about 0.15 of the body's width at t = 1, no fold.
   - `new SoftBody(g, { piece })` builds the face piece (the species shape scaled by cbrt(frac)) or a chunk (a rounded blob with a
     flat face toward `cutNormal` that rounds over by the family's memory). Pieces under 0.35 of the whole use detail 2.
   - `setFrac(frac, seconds)`: smooth growth or shrink of the rest volume.
   - The face piece reconnected from 6 pieces must equal the original (rest shape RMS under 0.002 R0; same volume).
   - **Perf: 6 pieces must cost no more per frame than 2 whole bodies.**
   - New `_harness/probe_cut.ts` covering `CUT.md` checks X01, X02, X04, X07 and X08 at the physics level.
4. **B4 long taffy pulls** for stickystretch and slimegoo up to their `maxPull` (2.1-2.9x), with no fold at the neck. Only if time allows.

## Report
- For phase 1: before and after for each finding, using the verifier's repro numbers; full probe counts; perf per family, solo,
  with the load.
- For phase 2: the APIs exactly as built; the probe results; perf with 2, 4 and 6 bodies and pieces.
- Known issues.

Time box: about 7 hours in total (phase 1 about 3 hours). If time runs out, phase 1 must be complete and honest; report phase 2 as
partial.
