#!/bin/sh
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
for t in molo voltkite hearthback briarwick; do for b in grideast whitestacks lockwater; do
  echo "=== bootcheck $t $b"
  timeout 400 python _harness/bootcheck.py --base http://localhost:5258/ --no-serve --titan $t --biome $b --report-dir _harness/scratch/l8/reports --out-dir _harness/scratch/l8/boot 2>&1 | tail -4
  echo "rc=$?"
done; done
