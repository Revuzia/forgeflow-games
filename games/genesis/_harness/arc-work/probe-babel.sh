#!/bin/sh
# 4 seeds of the babel probe (T3/T5); log to _harness/scratch/arc/babel.log
cd "$(dirname "$0")/../.." && for s in 1 2 3 4; do echo "== seed $s"; node _harness/arc-work/probe-babel.ts $s 20 2.2; done
