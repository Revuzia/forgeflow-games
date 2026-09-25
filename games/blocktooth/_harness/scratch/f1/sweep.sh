#!/bin/bash
# sweep.sh tag nudge toward completes
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
export BT_F1_NUDGE=$2 BT_F1_TOWARD=$3 BT_F1_COMPLETES=$4
node _harness/scratch/f1/evo_matrix.ts fresh > _harness/scratch/f1/sw_$1_fresh.txt 2>&1 &
node _harness/scratch/f1/evo_matrix.ts full > _harness/scratch/f1/sw_$1_full.txt 2>&1
wait
echo "$1 n=$2 t=$3 c=$4"; tail -1 _harness/scratch/f1/sw_$1_fresh.txt; tail -1 _harness/scratch/f1/sw_$1_full.txt
