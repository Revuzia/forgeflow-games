#!/usr/bin/env bash
# PERF s25 (water wfast=3): A = default water, B = wfast=3, both with the water clock pinned, FULL scene (trees, shadows,
# clouds on). One probe at a time through slot.sh. Usage: bash _harness/arc-work/s25-run.sh <tag-prefix> [views] [size]
#   then: python3 _harness/arc-work/s25-sheet.py <shots dir> <prefix>
cd "$(dirname "$0")/../.."
P=${1:-r}; V=${2:-land,lake,lakeT,shoreC,dusk,night,orbit,river}; S=${3:-480x270}
D=_harness/scratch/arc/perf/s25
CAMS='{"shoreC":{"mode":"orbit","lat":17.87588,"lon":-35.0,"dist":28,"tilt":58,"hour":10,"blend":0},"lakeT":{"mode":"orbit","target":{"kind":"settlement","id":1},"dist":60,"tilt":78,"hour":9,"blend":0}}'
run() { bash _harness/slot.sh node _harness/arc-work/probe-s21.mjs --dist=$D/dist --out=$D/shots --full=1 --size=$S --settle=16 --cams="$CAMS" "$@" > $D/log-$(date +%s%N).txt 2>&1; echo "$@ exit $?"; }
run --tag=$P-A --views=$V --extra='wclock=100'
run --tag=$P-B --views=$V --extra='wclock=100&wfast=3'
run --tag=${P}s-A --views=land --extra='wclock=100&wwind=2.2'
run --tag=${P}s-B --views=land --extra='wclock=100&wwind=2.2&wfast=3'
