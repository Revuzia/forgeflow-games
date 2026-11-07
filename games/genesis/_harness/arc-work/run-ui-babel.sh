#!/bin/bash
# waits for the given PID (a shot run on port 5311) then runs the live babel UI spec on 5311 through slot.sh
cd /home/user/forgeflow-games/games/genesis
while [ -n "$1" ] && kill -0 "$1" 2>/dev/null; do sleep 30; done
exec _harness/slot.sh node _harness/shots.mjs _harness/arc-work/specs/ui-babel.json --port=5311
