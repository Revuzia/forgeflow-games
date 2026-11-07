#!/bin/sh
# T2 attended pacing: 20-year runs with a gentle god answering prayers (_harness/probes/arc.ts attended); RESULT lines only
cd "$(dirname "$0")/../.." && for s in "$@"; do node _harness/probes/arc.ts attended $s 20 2>&1 | grep RESULT; done
