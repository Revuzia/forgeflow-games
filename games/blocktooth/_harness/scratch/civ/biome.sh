#!/usr/bin/env bash
# biome crowd look: slate + Size I play + Size II (seed 7)
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
S=_harness/scratch/civ; TAG=$1; B=$2
timeout 400 python $S/civshot.py "http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=$B&seed=7" screen:slate wait:2 perf:${TAG}_${B}_slate shot:$S/${TAG}_${B}_slate.png dismiss screen:play "eval:window.__BT__.cheat.noSpawns(true)" "eval:window.__BT__.cheat.god(true)" wait:3 toplay wait:3 perf:${TAG}_${B}_sizeI shot:$S/${TAG}_${B}_play.png \
 "eval:window.__BT__.cheat.rank(1)" wait:5 toplay wait:3 perf:${TAG}_${B}_sizeII shot:$S/${TAG}_${B}_sizeII.png 2>&1 | grep -E "^perf|^errors|error|saved" | cut -c1-260
