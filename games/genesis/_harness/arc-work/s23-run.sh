#!/bin/bash
# one probe-s21 boot per switch set (landing view land2), tag = index
cd /home/user/forgeflow-games/games/genesis
i=0
for x in "$@"; do
  node _harness/arc-work/probe-s21.mjs --dist=_harness/scratch/arc/perf/s23/dist --out=_harness/scratch/arc/perf/s23/shots --size=320x180 --tag=d$i --views=land2 --extra="$x" > _harness/scratch/arc/perf/s23/d$i.log 2>&1
  echo "d$i [$x] $(grep -c . _harness/scratch/arc/perf/s23/d$i.log) $(grep 'page errors' _harness/scratch/arc/perf/s23/d$i.log) $(grep -A1 'gl messages' _harness/scratch/arc/perf/s23/d$i.log | tr '\n' ' ' | cut -c1-160)"
  i=$((i+1))
done
