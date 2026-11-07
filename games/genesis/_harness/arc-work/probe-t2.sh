#!/bin/sh
# T2/T4: unattended 60-year runs for the given seeds (_harness/probes/arc.ts); RESULT lines only
cd "$(dirname "$0")/../.." && for s in "$@"; do node _harness/probes/arc.ts unattended $s 60 2>&1 | grep RESULT; done
