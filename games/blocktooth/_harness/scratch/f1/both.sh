#!/bin/bash
# usage: both.sh <tag>   (env BT_F1_* pass through)
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
node _harness/scratch/f1/evo_matrix.ts fresh > _harness/scratch/f1/evo_$1_fresh.txt 2>&1 &
node _harness/scratch/f1/evo_matrix.ts full > _harness/scratch/f1/evo_$1_full.txt 2>&1
wait
tail -1 _harness/scratch/f1/evo_$1_fresh.txt; tail -1 _harness/scratch/f1/evo_$1_full.txt
