#!/usr/bin/env bash
# slate + Size I quick look: GE seed 7
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
S=_harness/scratch/civ; TAG=$1; B=${2:-grideast}
timeout 300 python $S/civshot.py "http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=$B&seed=7" screen:slate wait:2 perf:${TAG}_slate shot:$S/${TAG}_slate.png "clip:$S/${TAG}_slate_crop.png:0,0,560,300" dismiss screen:play "eval:window.__BT__.cheat.noSpawns(true)" "eval:window.__BT__.cheat.god(true)" wait:4 toplay wait:3 perf:${TAG}_sizeI shot:$S/${TAG}_sizeI.png 2>&1 | grep -E "^perf|^errors|error|saved"
