#!/bin/bash
cd /home/user/forgeflow-games/games/genesis
C='{"y0":{"mode":"surface","lat":17.87588,"lon":-35.0,"alt":60,"yaw":0,"pitch":-12,"hour":7.75,"blend":0}}'
i=0
for x in "$@"; do
  node _harness/arc-work/probe-s21.mjs --dist=_harness/scratch/arc/perf/s23/dist --out=_harness/scratch/arc/perf/s23/shots --size=480x274 --tag=z$i --views=y0 --full=1 --settle=24 --cams="$C" --extra="$x" > _harness/scratch/arc/perf/s23/z$i.log 2>&1
  echo "z$i [$x] $(grep -c 'shot y0' _harness/scratch/arc/perf/s23/z$i.log) $(grep 'page errors' _harness/scratch/arc/perf/s23/z$i.log)"
  i=$((i+1))
done
