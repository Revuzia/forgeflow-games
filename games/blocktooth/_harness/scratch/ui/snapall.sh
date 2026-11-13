#!/bin/sh
# usage: sh _harness/scratch/ui/snapall.sh "hud slate ..." [suffix]
cd "$(dirname "$0")/../../.."
for s in $1; do
  for sz in "1280 720" "1920 1080"; do
    set -- $sz
    python _harness/scratch/snap.py "http://localhost:5187/_harness/scratch/ui/index.html?screen=$s&titan=${TITAN:-molo}&biome=${BIOME:-grideast}" "_shots/scratch_ui_${s}${SUF}_$2.png" --wait 12 --w $1 --h $2 2>&1 | grep -v "^GPU" | tail -3
  done
done
