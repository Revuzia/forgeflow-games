#!/usr/bin/env bash
# civ perf protocol: GE seed 7, no spawns, god; Size I, II, III, V renderBreakdown (civilian groups)
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
S=_harness/scratch/civ; TAG=$1
timeout 600 python $S/civshot.py "http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=grideast&seed=7" screen:slate wait:2 shot:$S/${TAG}_slate.png dismiss screen:play "eval:window.__BT__.cheat.noSpawns(true)" "eval:window.__BT__.cheat.god(true)" wait:4 toplay wait:2 perf:${TAG}_sizeI shot:$S/${TAG}_sizeI.png \
 "eval:window.__BT__.cheat.rank(1)" wait:5 toplay wait:4 perf:${TAG}_sizeII shot:$S/${TAG}_sizeII.png \
 "eval:window.__BT__.cheat.rank(2)" wait:5 toplay wait:4 perf:${TAG}_sizeIII shot:$S/${TAG}_sizeIII.png \
 "eval:window.__BT__.cheat.rank(4)" wait:6 toplay wait:4 perf:${TAG}_sizeV 2>&1 | grep -E "^perf|^toplay|^errors|error|saved"
