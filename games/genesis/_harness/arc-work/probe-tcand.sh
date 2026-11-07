#!/bin/sh
# T2 tuning data: probe-tcand.ts for the given seeds (60 y each), C lines to stdout
cd "$(dirname "$0")/../.." && for s in "$@"; do node _harness/arc-work/probe-tcand.ts $s 60 2>&1 | grep -E '^(C|DONE) '; done
