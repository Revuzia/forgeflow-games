#!/bin/bash
# usage: A-sim-r1-warn.sh seeds...   (run under slot.sh)
cd /home/user/forgeflow-games/games/genesis
for s in "$@"; do node _harness/arc-work/A-sim-r1-warn.ts $s 2>&1 | grep -E '^RESULT|Error|at ' | head -4; done
