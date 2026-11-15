#!/bin/bash
# Lane B task 1 proof run: 3 babel seeds, 3 years each. bash _harness/slot.sh bash _harness/arc-work/probe-dryland.sh
cd "$(dirname "$0")/../.." || exit 1
for s in 307987276 7 20261008; do echo "== babel seed $s"; node _harness/arc-work/probe-dryland.ts $s 3 | grep -v "^   [a-z-]*#"; done
