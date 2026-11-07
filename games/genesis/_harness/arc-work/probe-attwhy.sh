#!/bin/sh
# runs probe-attwhy.ts for the given seeds (attended), Y lines only
cd "$(dirname "$0")/../.." && for s in "$@"; do node _harness/arc-work/probe-attwhy.ts $s 14 $MODE 2>&1 | grep '^Y'; done
