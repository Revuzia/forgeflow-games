#!/bin/sh
# usage: batch.sh name "query" [name "query" ...]  → _harness/scratch/k2a/shots/<name>.png
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
while [ $# -ge 2 ]; do
  python _harness/scratch/snap.py "http://localhost:5273/_harness/scratch/k2a/index.html?$2" _harness/scratch/k2a/shots/$1.png --wait 40 --eval "window.__NOTE__" 2>&1 | grep -v "^GPU" | tail -2
  shift 2
done
