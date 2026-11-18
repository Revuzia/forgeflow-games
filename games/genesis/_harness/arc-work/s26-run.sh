#!/bin/bash
# PERF s26 lean tcache: one probe-s22 run (in-page A/B). usage: s26-run.sh TAG VIEWS SIZE [extra probe args...]
cd /home/user/forgeflow-games/games/genesis
C='{"y0":{"mode":"surface","lat":17.87588,"lon":-35.0,"alt":60,"yaw":0,"pitch":-12,"hour":7.75,"blend":0}}'
T=$1; V=$2; SZ=$3; shift 3
node _harness/arc-work/probe-s22.mjs --dist=_harness/scratch/arc/perf/s26/dist --out=_harness/scratch/arc/perf/s26/shots --size=$SZ --tag=$T --views=$V --cams="$C" "$@" > _harness/scratch/arc/perf/s26/$T.log 2>&1
