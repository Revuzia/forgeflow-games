#!/bin/bash
# PERF s26: the proof runs, one after another (each in a slot)
cd /home/user/forgeflow-games/games/genesis
R=_harness/arc-work/s26-run2.sh; E="$(cat _harness/arc-work/s26-tiles.js)"
bash _harness/slot.sh bash $R d graze,peak,floor 480x274 --extra=tcache=1 --settle=24 --max=80
bash _harness/slot.sh bash $R e y0,town 480x274 --full=1 --quality=ultra --extra=tcache=1 --settle=32 --max=80
bash _harness/slot.sh bash $R f town,sun 480x274 --extra=tcache=1 --settle=24 --max=80 --edits=1
bash _harness/slot.sh bash $R u y0 1686x963 --full=1 --quality=ultra --nolive=1 --extra=tcache=1\&tcbudget=500000 --settle=40 --max=120 --eval="$E"
