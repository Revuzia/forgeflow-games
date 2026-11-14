# F3 camera — boss-frame hysteresis (resume notes)
- Round 2 (interrupted attempt) already in the working tree: config.ts stepFrameHold + BOSS_FRAME hold constants,
  director.ts stepBossFrame uses it, camera.ts header comment. Before logs (OLD code, frozen server): _shots/framepump/before/
  - parkade6 p1: 8 legs, 2 pumps, tv/range 5.34, D 617–694, 0 tell pts out
  - irongully p1: 9 legs, 3 pumps, tv/range 4.04, D 617–840, 20 tell pts out in 5 frames (pawSlamOuter ndc 1.494 at the
    first frames of a big widen: the rig's ω=4 spring lags the director's instant widen)
- Round 3 plan: rig widens faster (asymmetric spring) + exact hard floor (every boss framed point inside ndc ~0.98 around
  the rig's ACTUAL target) so a live tell never leaves the frame even on the frame it spawns. Director replica mirrors it.
- Tools: _harness/scratch/view/framepump.py (headed Chrome, D per 100 ms game time, ndc of every tell point per frame),
  _harness/scratch/view/framehold_sim.ts (node, director-level pumps).
- 12:10 DONE in tree: config.ts CAMERA.widenOmega 9 / floorNdc 0.95, bossFrameFloorAt (+ bfNdcRaw), BOSS_FRAME tuned
  (holdS 3.5, holdStepS 4, holdMaxS 20, keepFrac 0.8, releaseRate 0.025); camera.ts target-before-distance, widen spring,
  hard floor (also on dRender at zoom>=1); director replica mirrors widen + floor. tsc clean (only f1 scratch error).
- node sims: _harness/scratch/f3/sim_cur.txt (33 pumps) sim_a (22) sim_b (14 = chosen) vs round-1 replay 218-239.
- headed Chrome (framepump, 30 s game time, LV37 molo seed 4242, phase 1):
  HEAD rerun (port 5392, $SP/f3head, same GPU window): parkade6 8 legs 2 pumps boss ndc 1.053 · irongully 11 legs 4 pumps
    25 tell pts out / 5 frames (worst pawSlamOuter 1.609)
  AFTER (port 5391): parkade6 1 leg 0 pumps 0 out (boss 0.95, tell 0.621) · irongully 1 leg 0 pumps 0 out (tell 0.902)
- GATE 2 isolated tree $SP/f3iso (HEAD + my 3 files): $SP/f3_g2_fresh.txt / f3_g2_full.txt
- 12:45 GATE 2 (isolated, seed 1337): fresh PASS 10/12 clears 2 deaths; full FAIL 12/12 clears 0 deaths (HEAD full: 11/12, 1 death
  voltkite/whitestacks @525, boss hp 2% left). Death is chaotic: round-2 constants die @482, mine clears @548.
  full-meta deaths HEAD vs mine by seed: 1337 1/0 · 7 1/0 · 99 0/0 · 1 1/1 · 2 0/0 · 3 0/1 · 4 1/0 (running 5,6,8,11)
- after2 (irongully seed 777 p1+p2, 60 s): 0 tell pts out (max 0.95 = floor binding), 1 slow reversal per 30 s window
  (shrink over ~4 s after hold, re-widen 15+ s later); floor pop 731->829 m on the frame a paw slam spawned.
- 13:30 FINAL. full-meta deaths over 11 seeds (132 runs each): HEAD 7 · mine 5 (seeds 1337 1/0, 7 1/0, 99 0/0, 1 1/1, 2 0/0,
  3 0/1, 4 1/0, 5 2/1, 6 0/1, 8 1/0, 11 0/1) -> no systematic easing; seed-1337 flip is chaos.
  probe_meta (seed 1337) FAIL on mine: "(a) g_signal_boost voltkite/lockwater: supply 7 ≥ target 8" (HEAD 9; HEAD min 8 = target).
  power-ups total HEAD/mine: s1337 119/116 · s7 136/139 · s99 115/113 · s3 131/132 (501/500). HEAD probe_meta FAILS on seeds 7 and 3.
  other 11 probes PASS on the isolated tree (ai city combat econ(exit 0) titan upgrades ult evolutions boss3 map endless icons).
  final node sim: 11 pumps vs 245 round-1 replay (sim_final.txt). floor cost 27.6 µs mean / 195 µs worst per frame (floorcost.ts).
  servers 5391/5392 stopped; f3head junction removed.
