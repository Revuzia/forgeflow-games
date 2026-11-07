#!/bin/bash
# usage: verify-A-r1-sim-run.sh <mode> <years|-> <flavour|-> seeds...   (run under slot.sh)
cd /home/user/forgeflow-games/games/genesis
mode=$1; years=$2; fl=$3; shift 3
for s in "$@"; do
  node _harness/arc-work/verify-A-r1-sim.ts $mode $s $years $fl 2>&1 | grep -E '^RESULT|Error|error' | head -5
done
