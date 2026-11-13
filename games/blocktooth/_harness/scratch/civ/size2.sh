#!/usr/bin/env bash
# Size II with androids in frame (GE seed 7) + a crop; then Size III walk through parked cars
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
S=_harness/scratch/civ; TAG=$1; B=${2:-grideast}
timeout 400 python $S/civshot.py "http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=$B&seed=7" screen:slate wait:2 shot:$S/${TAG}_${B}_slate.png dismiss screen:play "eval:window.__BT__.cheat.noSpawns(true)" "eval:window.__BT__.cheat.god(true)" wait:3 toplay \
 "eval:window.__BT__.cheat.rank(1)" wait:5 toplay "eval:window.__BT__.cheat.spawn('android', 4)" "eval:window.__BT__.cheat.spawn('squad', 4)" wait:4 perf:${TAG}_${B}_sizeII shot:$S/${TAG}_${B}_sizeII.png 2>&1 | grep -E "^perf|^errors|error|saved|eval"
