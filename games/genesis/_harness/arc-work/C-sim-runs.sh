#!/bin/bash
# C-sim §8.4/§8.5 runs: C-sim-runs.sh unattended|scripted [seeds...] -> one RESULT line per seed (run through slot.sh)
cd "$(dirname "$0")/../.."
m=$1; shift
seeds=${@:-1 2 3 4 5 6 7 8}
for s in $seeds; do node _harness/probes/arc-book.ts $m $s; done
