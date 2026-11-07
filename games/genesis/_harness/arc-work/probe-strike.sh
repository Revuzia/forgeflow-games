#!/bin/sh
# T7: strike on babel seeds (_harness/arc-work/probe-strike.ts <seed> 0.6 5); RESULT lines only
cd "$(dirname "$0")/../.." && for s in "$@"; do node _harness/arc-work/probe-strike.ts $s 0.6 5 2>&1 | grep RESULT; done
