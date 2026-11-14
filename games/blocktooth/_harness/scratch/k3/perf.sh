#!/bin/bash
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
O=_harness/scratch/k3/perf
mkdir -p $O
Q="python _harness/scratch/g3/perfquiet.py --out $O --max-tries 4"
$Q --n 2 --budget 300 --extra "--v2 --enemies 250" > $O/pq_a.log 2>&1
$Q --n 2 --budget 300 --extra "--boss parkade6 --enemies 150" > $O/pq_b.log 2>&1
$Q --n 2 --budget 300 --extra "--gate c --enemies 150" > $O/pq_c.log 2>&1
$Q --n 2 --budget 300 --extra "--gate d --enemies 150" > $O/pq_d.log 2>&1
$Q --n 2 --budget 300 --extra "--gate e --enemies 150" > $O/pq_e.log 2>&1
$Q --n 1 --budget 240 --extra "--gate c --enemies 150 --prof" > $O/pq_c_prof.log 2>&1
$Q --n 1 --budget 240 --extra "--gate d --enemies 150 --prof" > $O/pq_d_prof.log 2>&1
echo DONE > $O/DONE
