#!/bin/bash
# usage: probes.sh name... ; writes _harness/scratch/k2c/p_<name>.txt and a summary line each
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
for n in "$@"; do
  s=$(date +%s)
  node _harness/probe_$n.ts > _harness/scratch/k2c/p_$n.txt 2>&1
  rc=$?
  echo "probe_$n exit $rc ($(( $(date +%s) - s )) s)" | tee -a _harness/scratch/k2c/summary.txt
done
