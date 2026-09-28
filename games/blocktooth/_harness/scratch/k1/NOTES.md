# Gate K1 (orchestrator) — progress notes
- 01:10 start. HEAD fdefbbfb (forgeflow-games repo). K0+K1a+K1b all in working tree already (same tree).
- tsc on merged tree: rc 0 (tsc0.txt empty).
- b0 = baseline battery on merged tree as-is (before cross-lane fixes).
- K1a patch: scratchpad/k1a/cross_lane_fixes.patch (world.ts flush-before-processTriggers, director elite gate, probe fixture dev bypasses).
- 01:25 b0 done: G2 fresh PASS (deaths 1, clears 11), full PASS (deaths 1, clears 11); fails: gatekeepers 15, boss3, map, meta, titan, ult(L), city (timing under load). Applied K1a patch.
- 01:50 b1 (K1a patch): G2 fresh PASS (d1), full FAIL deaths 0 (12/12 clears). titan/boss3/endless OK. ult H 26.7 s (<30). map ANNEX 2/3/3 grideast.
  gatekeepers 14 fails: case10 frame sat (voltkite/grideast/7), 6 tells x4, 7 x9, 12 (4.95 H).
- FIX A (world.ts + engine.ts processTriggersFrom): settleGateBreach after processTriggers — SB5 kill by a trigger proc at 441.37
  (molo/grideast/1337) breached in the end flush → ANNEX never owed. Now placed (diag_annex.ts).
- FIX B: BOSS_FRAME.maxMulAtRank [2,2,2,2.5,2] + bossFrameMaxMul(rank) (config.ts, used in bossFrameNeed), probe case 10 reads it. Measured max need 2.36x at Size IV.
- 02:10 b2 (A+B): G2 fresh PASS d1 clears 11; full PASS d1 clears 11. map PASS, titan/boss3/endless/ai/econ/upgrades/evo/combat/icons PASS.
  FAIL: gatekeepers 13 (6 x4, 7 x8, 12 x1), ult H 26.7 s, meta (60 perk-band rank-time, supply g_signal_boost, (b) 9 goals).
- FIX C: probe_meta RANK_BANDS → GATE2_V3.breachBand + Size V = clear window [480,720]; BOSS_BY_S = mainSpawn[1]. b3: perk-band violations 0.
  meta still FAIL: (a) g_signal_boost supply 5–7 < 8 in 6 runs; (b) 9 < 10 goals met (K2c-owned retune).
- city alone: 344343 checks 0 failures (b3c). The b0 failure was generateCity timing under 16x parallel load.
- 02:40 bootcheck molo/grideast (5178): BOOTS CLEAN. gate_boot.py: LV7 lock (pending 1, rank 0), STENCIL-1 slot 1 spawn,
  live real-key fight 1000→724 HP, kill tick 807: bossHit gateDefeated:1 rankUp:1 ultCharged; rank 1 unlocked 1; RESULT OK.
- FIX D (tuning, FEATURES_V2 §3.2 knob 1): ultimate.ts ULT_CHARGE.cityRankMul[2] 0.1 → 0.05 (config ULT_CITY_RANK_MUL is superseded, no effect —
  A/B v32/v35 identical). A/B probe_ult Size III: 0.05 → 32.3 s PASS; +kill .32 → 33.5; kill .3 alone → 28.8 FAIL.
- 03:05 launching b4 = full final battery on the candidate tree.
- (clock note: wall clock jumped; b4 finished 10:15 CDT)
- b4 (A+B+C+D): G2 fresh PASS (clears 11, deaths 1); full FAIL deaths 0 (12/12). ult PASS. map/boss3/endless/titan/... PASS. meta: (b) now passes; (a) signal_boost 4 runs.
  gatekeepers 13 (6 x4, 7 x8, 12). city FAIL timing under parallel load only.
- A/B vD (gateHit base x1.15, §5.1 risk-1 knob) and vE (x1.3225) on G2 fresh/full --det 0.
- FIX E: GATES.dmgBaseMul 1.3225 (2 x 1.15 steps, §5.1 risk-1) in gateHit. A/B vE: fresh PASS 9/12 d3, full PASS 10/12 d2; vD (1 step) full d0 FAIL. Launch b5 final.
- b5: G2 fresh PASS 9/12 d3, full PASS 10/12 d2; ult PASS (III 33.2); case 10 back (voltkite/grideast/99 sat 2.5; true need 2.57 via vG instrument). FIX B2: rank-3 maxMul 2.75. Launch b6.
- b6 (final tree): G2 fresh PASS 8/12 d4 (AT the ≥8 floor), full PASS 10/12 d2; case 10 PASS (max 2.16x); gatekeepers 13 fails (6x4,7x8,12); meta (a) 5 runs + (b) 9; all other probes PASS.
- FINAL: city alone PASS; bootcheck molo/grideast BOOTS CLEAN; gate_boot RESULT OK (kill tick 854: gateDefeated:1 + rankUp:1). tsc 0.
  NO COMMIT: probe_gatekeepers (13) and probe_meta fail. Dev server 5178 stopped.
