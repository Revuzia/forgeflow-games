#!/bin/bash
# usage: verify-A-r1-tower.sh <answer> seeds...   (run under slot.sh)
cd /home/user/forgeflow-games/games/genesis
a=$1; shift
for s in "$@"; do node _harness/arc-work/verify-A-r1-tower.ts $a $s 2>&1 | grep -E '^RESULT|Error|at ' | head -6; done
