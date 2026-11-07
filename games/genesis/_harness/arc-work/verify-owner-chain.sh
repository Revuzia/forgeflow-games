#!/bin/bash
# verify-A-r1-owner: wait for the given PID (a shot run on 5351), then run the given spec on 5351 through slot.sh
cd /home/user/forgeflow-games/games/genesis
pid=$1; shift
while [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; do sleep 30; done
exec _harness/slot.sh node _harness/shots.mjs "$1" --port=5351
