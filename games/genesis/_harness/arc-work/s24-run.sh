#!/bin/bash
# SESSION 24: the owner's landing camera (y0), one boot: s24-run.sh TAG 'extra switches' [step ticks] [eval file]
cd /home/user/forgeflow-games/games/genesis
C='{"y0":{"mode":"surface","lat":17.87588,"lon":-35.0,"alt":60,"yaw":0,"pitch":-12,"hour":7.75,"blend":0}}'
O=_harness/scratch/arc/perf/s24
node _harness/arc-work/probe-s21.mjs --dist=$O/dist --out=$O/shots --size=480x274 --tag="$1" --views=y0 --full=1 --settle=24 --cams="$C" --extra="$2" ${3:+--step=$3} --eval="${4:-_harness/arc-work/s24-sheet.js}" > $O/$1.log 2>&1
echo "$1 [$2] $(grep 'page errors' $O/$1.log)"
