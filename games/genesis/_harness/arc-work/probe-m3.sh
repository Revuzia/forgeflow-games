#!/bin/sh
# M3 (§8.1) harsh and kind runs, 8 seeds each, via the verifier's probe; log RESULT lines
cd "$(dirname "$0")/../.." && for s in 1 2 3 4 5 6 7 8; do node _harness/arc-work/verify-A-r1-sim.ts ${1:-harsh} $s 2>&1 | grep RESULT; done
