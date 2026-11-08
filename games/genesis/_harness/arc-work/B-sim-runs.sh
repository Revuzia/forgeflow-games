#!/bin/bash
# B-sim §8.3 runs: B-sim-runs.sh unattended|pairs|harsh  -> one RESULT line per seed (run through slot.sh)
cd "$(dirname "$0")/../.."
case "$1" in
  unattended) for s in 1 2 3 4 5 6 7 8; do node _harness/probes/arc.ts unattended $s; done ;;
  pairs) for s in 1 2 3 4; do node _harness/probes/arc.ts dmercy $s; node _harness/probes/arc.ts dwrath $s; done ;;
  harsh) for s in 1 2 3 4 5 6 7 8; do node _harness/probes/arc.ts harsh $s; done ;;
esac
