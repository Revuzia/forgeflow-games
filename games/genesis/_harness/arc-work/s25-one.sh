#!/usr/bin/env bash
# PERF s25: one probe run (full scene, water clock pinned). Usage: s25-one.sh <tag> <views> <extra>
cd "$(dirname "$0")/../.."
D=_harness/scratch/arc/perf/s25
CAMS='{"shoreC":{"mode":"orbit","lat":17.87588,"lon":-35.0,"dist":28,"tilt":58,"hour":10,"blend":0}}'
bash _harness/slot.sh node _harness/arc-work/probe-s21.mjs --dist=$D/${DIST:-dist} --out=$D/shots --full=1 --size=480x270 --settle=16 --cams="$CAMS" --tag="$1" --views="$2" --extra="$3" > $D/log-$1.txt 2>&1
echo "$1 exit $?"; grep -v '^url' $D/log-$1.txt | tail -3 | cut -c1-300
