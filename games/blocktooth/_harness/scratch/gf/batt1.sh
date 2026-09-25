#!/bin/bash
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
G=_harness/scratch/gf
(node _harness/probe_boss3.ts > $G/probe_boss3.txt 2>&1; echo "rc=$?" >> $G/probe_boss3.txt) &
(node _harness/probe_sim.ts --det 2 --meta fresh > $G/g2_fresh.txt 2>&1; echo "rc=$?" >> $G/g2_fresh.txt) &
(node _harness/probe_sim.ts --det 2 --meta full > $G/g2_full.txt 2>&1; echo "rc=$?" >> $G/g2_full.txt) &
(node $G/jam_duel.ts 160 18 > $G/jam_new_lv18.txt 2>&1) &
wait
for f in g2_fresh g2_full probe_boss3; do echo "== $f"; tail -n 3 $G/$f.txt; done
grep TOTAL $G/jam_new_lv18.txt
