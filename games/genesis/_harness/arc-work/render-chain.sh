#!/bin/bash
# A-render: run shot specs one after another through slot.sh on port 5312 (wait for a given PID first).
# usage: render-chain.sh <pid-to-wait-or-0> spec1 spec2 ...   (run from the genesis root; logs in _harness/scratch/arc/render/)
cd "$(dirname "$0")/../.."
w=$1; shift
while [ "$w" != 0 ] && kill -0 "$w" 2>/dev/null; do sleep 15; done
for s in "$@"; do
  n=$(basename "$s" .json)
  _harness/slot.sh node _harness/shots.mjs "_harness/arc-work/specs/$s" --port=5312 > "_harness/scratch/arc/render/shots-$n.log" 2>&1
done
