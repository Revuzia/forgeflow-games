#!/bin/bash
# seeds.sh tag nudge toward completes seed...
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
tag=$1; export BT_F1_NUDGE=$2 BT_F1_TOWARD=$3 BT_F1_COMPLETES=$4; shift 4
for s in "$@"; do for m in fresh full; do
  node _harness/scratch/f1/evo_matrix.ts $m $s > _harness/scratch/f1/sd_${tag}_${m}_${s}.txt 2>&1 &
done; done; wait
for s in "$@"; do for m in fresh full; do tail -1 _harness/scratch/f1/sd_${tag}_${m}_${s}.txt; done; done
