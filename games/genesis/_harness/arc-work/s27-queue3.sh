#!/bin/bash
cd /home/user/forgeflow-games/games/genesis
R=_harness/arc-work/s26-run2.sh; E="$(cat _harness/arc-work/s27-churn.js)"
bash _harness/slot.sh bash $R n0 y0 480x274 --full=1 --quality=ultra --extra=tcache=0 --settle=40 --max=4 --nolive=1
bash _harness/slot.sh bash $R k2 town 480x274 --extra=tcache=1 --settle=40 --max=80 --nolive=1 --eval="$E"
