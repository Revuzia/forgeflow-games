#!/bin/bash
# before / after of the s27 cuts: same view, ?lazyacc=0 (before) then default (after); prints the heap lines
cd /home/user/forgeflow-games/games/genesis
C='{"y0":{"mode":"surface","lat":17.87588,"lon":-35.0,"alt":60,"yaw":0,"pitch":-12,"hour":7.75,"blend":0}}'
for x in lazyacc=0 lazyacc=1; do
  bash _harness/slot.sh node _harness/arc-work/probe-s21.mjs --dist=_harness/scratch/arc/perf/s27/dist2 --out=_harness/scratch/arc/perf/s27/shots --size=480x274 --tag=ab-$x --views=y0 --full=1 --settle=8 --cams="$C" --extra="$x" --eval=_harness/arc-work/s27-mem.js --heapsnap=_harness/scratch/arc/perf/s27/ab-$x.snap > _harness/scratch/arc/perf/s27/ab-$x.log 2>&1
done
