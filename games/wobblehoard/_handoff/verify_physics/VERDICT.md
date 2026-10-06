## Physics verification of WOBBLEHOARD round 2 (HEAD 2e586e0 against 6dff62e)

### VERDICT: FAIL
There are four majors:
- Rubs crease 6 of the 12 families on real catalog bodies.
- Full pulls crease the foot rim at the release.
- A normal squeeze and release launches 12 of the 50 species off the table.
- Perf for slowrise is borderline over the 2.0 ms bar.

The gates were not loosened, the restored DOLLOP is exact, and the solver is solid: no NaN, inversion, penetration, failure to settle or nondeterminism in 7,128 attack scenarios.

S = `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify`. Everything ran on snapshots made with `git archive` (`S/head`, `S/old`). No repo file was touched. All my processes are stopped and ports 5372/5373 are free.

### FAILURES

**MAJOR-1: rubs crease 6 families on catalog bodies.**
- **Method.** The probe's own camera-plane rub (`slidePress` method, shell pressure capped at 0.7, straight 2.5 m/s, outward drags skipped) on all 50 species × {template, soft corner}.
- **Template genomes:** 35 of 445 rubs go over 120°.
  - slime 14/37 (89 frames)
  - putty 8/24
  - sticky 6/43
  - beads 3/50
  - mochi 2/34
  - waterfill 2/41
  - gel, gummy, firm silicone, pop dome, marshmallow, slowrise: 0
- **Worst cases:**
  - wrigglo (template), front-mid at 0°: 178°, 22 frames (longest run 13).
  - tidelume, front-right-low at 180°: 158°, 19 frames.
  - wrigglo (soft corner): 179°, 136 frames, longest run 95. Its rest fold is still 69° 2.3 s later.
  - cushlet (template, marshmallow), straight 2 m/s rub over a top corner: 179°, 18 frames.
- **Coverage gap.** The round-5 sliding rows only run on starter (gel) genomes, and probe_species has no rub.
- **Partial cause.** Setting fingerFriction back to the gel's 0.9 drops slime from 57 to 4 frames over 120 on 6 species. Putty, waterfill and beads remain, so the gel-tuned kinetic friction (muK scales with each family's tack) is only part of it.
- **Repro:**
  - `cd S; node rubset.ts --only wrigglo,tidelume,fossilo --genomes tmpl > x.jsonl; python3 sum_rub.py x.jsonl`
  - `node repro.ts --id cushlet --g tmpl --pt "f0' tip" --mode rub --lin 2`

**MAJOR-2: full pulls crease the foot rim at the release.** Players are told to stretch "as far as it will go".
- **Method.** Grab, pull straight out to 1.1 × maxPull over 0.8 s, hold, release.
- **Result:** 111 of 608 pulls go over 120°; on template genomes 52 of 304, across 17 species.
  - sticky 38/64
  - slime 31/60
  - mochi 20/42
  - putty 11/32
  - slowrise 4/32
  - beads 4/78
  - waterfill 2/48
  - gel 1/54
- **Location.** 101 of the 111 sharpest creases come right after `grabRelease`, on the table, 3–4 R from the grab. The table-edge fold limit switches off at the release (the implementer's known issue 3).
- **Fix test (scratch copy `S/fixtest`).** Keeping the limit on while the pinned feet hold (`tfold ||= this.pinCount > 0`) cuts 10 bad species from 73/132 failing pulls to 11/132. Frames over 120 go from 387 to 116.
- **The implementer's own harness FAILs on putty.** `S/shots/family_demo_putty.png`: magenta at the trailing foot at 4.60 and 5.15 s; at 6.40 s the fold is 144° with 3 edges over 90 and 2 inward triangles; harness reports fold end 141.
- **Repro:** `node pullset.ts --only skeinara,twangle,cindergoo > p.jsonl; python3 sum_pull.py p.jsonl`

**MAJOR-3: squeeze-and-release hops.**
- **Method.** Top press with the shell's pressure ramp, held 1.2 s, then released.
- **Result:** 12 of 50 template species leave the table (lowest particle more than 10 mm up). DOLLOP stays down (0 mm).
  - ambrosel 211 mm, airborne 1.45–1.8 s, with a 'land' event
  - caromel 133, prismelo 133, marigel 126, nuzzo 115, chunkle 112, munchip 104
  - flipdome 83, fossilo 60, thudge 45, kneadle 38, twangle
- **Across genomes and pressure profiles:** 64 of 300 presses hop.
- **Filmstrips:** `S/shots/family_demo_sp_marigel.png` (foot up 104 mm at 1.67–1.88 s) and `S/shots/family_demo_sp_prismelo.png` (AIR, foot up 109 mm at 0.80 s while still pressed).
- **No gate.** probe_species only checks hops at rest.
- **Repro:** `node hop.ts`; `node hoptrace.ts ambrosel`

**MAJOR-4 (borderline, confounded by load): perf.**
- Measured with none of my processes running, at load 3.0–4.2 from the other lanes.
- slowrise's heaviest species (somnuff), workload A (one finger held): 2.18 and 1.91 ms mean. Workload B (two fingers, one rubbing): 1.84 and 2.07 ms.
- In run 2, beads B is 2.01 ms and sticky B is 2.01 ms.
- The starter measures 1.53–1.63 ms in the same runs, so slowrise costs 1.22–1.34× the starter.
- probe_species' own perf row FAILs (slowrise 2.33 ms at load ~10).
- It may pass on an idle machine, but no family has margin. A quiet re-measure is needed (`node S/perf.ts`).

**Minors:**
- **MINOR-5, gate integrity.** probe_families cannot tell firm silicone from gummy: swapping their physics passes 19/19, and the gel-vs-silicone ≥ 0.12 row lands at exactly 0.120. The other 8 swaps fail as they should. Behind it:
  - the wobble axis saturates (gel and silicone both 1.0);
  - push-back is 0.607 vs 0.630;
  - firm silicone, gummy and pop dome have no signature rows of their own.
- **MINOR-6, plastic memory captures ceremony deformation.**
  - fossilo (template), repeated bursts with fingers down: 153° after release, over 120° for 9 s, over 90° for 22 s, back to normal only after about 45 s.
  - kneadle, one `burstOpen(1)` while two fingers press: 82 frames over 120 after the release.
  - After the full ceremony + hostile script, putty rest fold is 170–180° 12 s later.
  - The game flow (one burst, no fingers) is fine: 18°.
  - Fix idea: run memoryStep relative to the ceremony goal (divide out 1 + burstO, remove fold), or freeze it while fold/burst is active.
- **MINOR-7.** An instant pressure-1 shove on a feature base of a firm genome creases: chunkle (hard) 163° for 1 frame, capnap (hard) 170° for 3 frames. This is a stress case the shell never sends.
- **MINOR-8, contract.** The meaning of 'snap' intensity changed; the type did not. The change was requested, but it is not additive.
  - The shell's `src/shell/feel.ts` still multiplies it by 1/0.35 (`rescaleStretchWithPress: true`), so any pull over 35% of maxPull saturates.
  - The pull level also counts body translation: boingle pulled 2 R moves 0.5 R, stretch reads 0.136, snap reads 1.0.
- **MINOR-9.** `SolverScale.groundDamp` has no matching SoftParams field, so `applyMaterial` drops it silently. SQUISHY_SCIENCE 3.0/3.7 claims it is in the solver.
- **MINOR-10.** The CONTRACT 4.2 volume band uses each family's base bleed, but firmness 0 raises bleed ×1.15:
  - slowrise floor 0.3675 is below its band of 0.40;
  - marshmallow floor 0.5975 is below its band of 0.60;
  - in practice finger depth caps first: worst seen 0.69 and 0.70.
- **MINOR-11.** For plastic families, the edge rest lengths follow the 17 Hz tremble, despite the frameUpdate comment saying tremble leaves them alone.
- **MINOR-12, starter drift that was not disclosed.**
  - Beyond smOmega (22.08→24.03): intDamp +28% (2.65→3.39), drag +19%, volKappa 0.5→0.607, maxPull 1.87→1.79.
  - The corner genomes got much tamer: f0b0s0z0 smOmega 15→26 and squashDepth 0.66→0.50; f0b0s1z1 smOmega 9.6→16.6.
  - So the "soft corner" fold rows stress much less than at 6dff62e. Thresholds are unchanged and still cover the gel's real extremes, but nothing covers the softest bodies in the game, which are now other families (MAJOR-1/2).
- **MINOR-13.** Ceremony drivers with fingers at full pressure (fold toggling plus bursts): 46 of 100 bodies show frames over 120; slime shows 244–344 frames. The drivers alone are fine.
- **MINOR-14.** probe_species gives slow or plastic families a 90° rest limit. The rule is documented and conservative in most cases, but the 3 s cutoff and the 90° value are not derived from anything.
- **MINOR-15.** families-hostile is not in the default run and has no determinism replay.

### NUMBERS
**Probes and gates**
- `tsc --noEmit`: exit 0.
- `run_probes`: 11/12. probe_species FAILs only its perf row.
- probe_softbody: 114/114, including absolute perf (1.681 ms mean, p99 2.67), relative 0.86, and round-5 rows at 0 frames / 110° with sane fuzz 1 in 30,000 at 149°.
- probe_families: 19/19.
- probe_species: 5/6. Settle passes; the 704-press matrix peaks at 112° with 0 frames over 120; rest worst is 60°; all volumes are in band; fuzz has 0 failures.
- families-hostile: 24/24 (slowest settle 3.83 s, worst elastic shape 1.20%), matching the implementer.

**Gate diff:** no existing threshold or sample was loosened.
- The aims are back at 0.9/0.96 and x 0.22, identical to 6dff62e.
- Rows were only added.
- The corral rule change and the family-only shape exemption are disclosed.
- Volume bands follow min(0.85, 1 − bleed − 0.05) correctly: 0.40, 0.60, 0.85×8, 0.65, 0.77.

**Give axis: legitimate, but not much independent evidence.**
- FEEL_MIN still passes on the old 10 axes (closest pair 0.065).
- The new ≥ 0.12 gel/silicone row only passes because of the give axis (0.101 without it), and give is a near-direct readout of the squashDepth law.
- Closest pairs are firmsilicone/popdome at 0.062 and slowrise/beadsqueeze at 0.080.

**DOLLOP match against 6dff62e (own script):**
- restPoint over 20,000 directions: max 2.2e-16 R0.
- Floppy weights and softW: identical.
- Struts: 169/169 (detail 3) and 733/733 (detail 4), with identical endpoints, on 5 genomes.

**Discrimination:** 8 of 9 swaps fail; firmsilicone↔gummy passes.

**Old verifier's sets on HEAD**

| Set | HEAD | Implementer (fold fix round) |
|---|---|---|
| Realistic (5 × 20,000 frames) | 3 frames over 120 in 3 episodes, worst 127° (starter 0, f0b0s0z0 2, f0b0s1z1 1) | 4 frames in 4 episodes, worst 173.5° |
| Drag (288) | 0 frames, worst 110.6° | 2 frames, 142.7° |

**Attack (100 bodies, 7,128 scenarios)**

| Mode | Over the limit |
|---|---|
| Hold | 0 / 2,474 |
| Tap | 0 / 408 |
| Pinch | 1 / 608 |
| Shove | 9 / 2,074 (all on hard genomes) |
| Rub (my oscillating rub, up to 3.2 m/s) | 92 / 1,056 |
| Grab (3 R out, then 1 R sideways) | 79 / 508 |

All bodies settle within 1.95 s. After 3 squeezes and 15 s, every family is back to a sane rest; putty keeps about 0.03 R by design.

**Perf solo (load ~3–4, two runs)**

| Family | A (ms) | B (ms) |
|---|---|---|
| slowrise | 2.18 / 1.91 | 1.84 / 2.07 |
| marshmallow | 1.74 / 1.71 | 1.88 / 1.81 |
| mochidough | 1.61 / 1.59 | 1.76 / 1.85 |
| jellygel | 1.49 / 1.65 | 1.83 / 1.75 |
| waterfill | 1.55 / 1.66 | 1.77 / 1.77 |
| putty | 1.63 / 1.71 | 1.83 / 1.79 |
| stickystretch | 1.63 / 1.68 | 1.81 / 2.01 |
| slimegoo | 1.78 / 1.63 | 1.78 / 1.85 |
| firmsilicone | 1.52 / 1.56 | 1.74 / 1.77 |
| popdome | 1.50 / 1.51 | 1.64 / 1.70 |
| gummy | 1.61 / 1.84 | 1.84 / 1.84 |
| beadsqueeze | 1.71 / 1.68 | 1.95 / 2.01 |
| starter | 1.53–1.63 | — |

### FEEL (`S/shots/family_demo_*.png`)
- **slowrise:** good. It sinks to volume 0.90, wrinkles, and creeps back between 1.6 and 6.4 s. The shape returns in 1.3 s against a designed 4.5 s.
- **marshmallow:** squashes with accordion wrinkles, but puffs back in about 0.4 s with an overshoot (top 1.055 at 1.9 s). It reads springy rather than "almost no push-back".
- **mochidough:** good. It keeps a flat thumbprint and is smooth by about 4 s.
- **jellygel:** good. It bulges and wobbles.
- **waterfill:** looks almost the same as the gel. No slosh is visible on a top press.
- **putty:** keeps its dent, but the harness FAILs at the pull (see MAJOR-2).
- **stickystretch:** the top press creases under the finger (102°, 3–4 edges over 90 at 0.80 and 1.45 s). It shows no strings; strings are a renderer feature only. Otherwise it looks like the gel.
- **slimegoo:** oozes back, but a magenta crease patch (7–8 edges over 90) sits under the finger, and the fold stays at 71–77° for 5 s.
- **firmsilicone:** at 1.45 s the peak escapes sideways from the held press (compression 0.38→0.16). Its reaction metric is 0.99, the same as slime at 0.98, so audio and haptics cannot tell "firm" apart.
- **popdome:** good. It is stiff, dips in volume and springs straight back.
- **gummy:** good, but close to the gel.
- **beadsqueeze:** yields and recovers in about 2.5 s; the "lumpy" character is not visible.

The elastic group (gel, waterfill, gummy, silicone, dome, sticky) is hard to tell apart by eye.

**Species strips:**
- marigel: concertina wrinkles, a crease at the top petal at 0.80 s, and a 10 cm hop.
- cushlet: 31 inward triangles at 0.80 s.
- The strip camera crops tall species (prismelo, skeinara, constello).

**Contact sheet (`S/shots/species_sheet.png`):** rest folds are all 55° or less.
- **Recognisable:** dollop, plumpet, twangle, puddlo, chunkle, munchip, cushlet, dimpla, nuzzo, swishel, granulo, sproutle, knubby, hooplet, spirelo, marigel, cindergoo, selenuff, fossilo.
- **Not recognisable from the game view:**
  - crumbit reads as an egg, not a pear;
  - tadpolo's tail is hidden;
  - wrigglo has no raised head;
  - capnap has no stalk;
  - zingle, taffelin, skeinara and constello read as lumps;
  - pastrel is a flat oval, not a croissant.
- **Weak:** crimpo, thumbly, boingle.

### NOTES for the integrator
- MAJOR-1/2 come from the round-5 sliding and release fixes being tuned on the gel only. The probes need rub, slide, full-pull and release rows for every family.
- MAJOR-3 needs a hop-after-release row in probe_species.
- The shell lane must stop rescaling snap intensity (MINOR-8).
- Re-measure perf on a quiet machine.
- `CATALOG.md`'s regeneration only changed DOLLOP's row and Flipdome's nearest-silhouette entry (which now names Dollop); both are correct.

All files are in S:
- scripts: `attack.ts`, `attack_lib.ts`, `rubset.ts`, `pullset.ts`, `hop.ts`, `hoptrace.ts`, `cer_iso.ts`, `repro.ts`, `perf.ts`, `dollop_match.ts`
- outputs: `attack_*.jsonl`, `rubset_*.jsonl`, `pullset_*.jsonl`, `hop.txt`, `run_probes.txt`, `famhostile.txt`, `swap_*.txt`, `out/real_head_*`, `perf_run*.txt`
- images: `shots/`