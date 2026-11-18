#!/bin/bash
cd /home/user/forgeflow-games/games/genesis
R=_harness/arc-work/s26-run2.sh; E="$(cat _harness/arc-work/s26-tiles.js)"
bash _harness/slot.sh bash $R g town,y0 480x274 --extra=tcache=1 --settle=24 --max=60 --eval="$E"
bash _harness/slot.sh bash $R u y0 1686x963 --full=1 --quality=ultra --nolive=1 --extra=tcache=1\&tcbudget=600000 --settle=40 --max=60 --eval="$E"
