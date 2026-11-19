#!/bin/bash
# PERF s27: churn at 1x/100x/1000x (new trigger, then s26's), then shcache image pair (full picture, landing)
cd /home/user/forgeflow-games/games/genesis
R=_harness/arc-work/s26-run2.sh; E="$(cat _harness/arc-work/s27-churn.js)"
bash _harness/slot.sh bash $R k1 town 480x274 --extra=tcache=1 --settle=40 --max=80 --nolive=1 --eval="$E"
bash _harness/slot.sh bash $R k0 town 480x274 --extra=tcache=1\&tcsun=0 --settle=40 --max=80 --nolive=1 --eval="$E"
bash _harness/slot.sh bash $R s1 y0 480x274 --full=1 --quality=ultra --extra=tcache=1\&shcache=1 --settle=40 --max=60 --nolive=1
bash _harness/slot.sh bash $R s0 y0 480x274 --full=1 --quality=ultra --extra=tcache=1 --settle=40 --max=60 --nolive=1
