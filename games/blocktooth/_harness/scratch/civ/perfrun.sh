#!/usr/bin/env bash
# perf protocol: Size I (GE seed 7, no spawns) then cheat.rank(4) Size V; drafts dismissed before sampling
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
S=_harness/scratch/civ; TAG=$1
timeout 500 python $S/civshot.py "http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=grideast&seed=7" screen:slate wait:2 dismiss screen:play "eval:window.__BT__.cheat.noSpawns(true)" "eval:window.__BT__.cheat.god(true)" wait:5 toplay perf:${TAG}_sizeI_1 wait:3 perf:${TAG}_sizeI_2 "eval:window.__BT__.cheat.rank(4)" wait:6 toplay wait:4 perf:${TAG}_sizeV_1 wait:3 perf:${TAG}_sizeV_2 shot:$S/${TAG}_sizeV.png 2>&1 | grep -E "^perf|^toplay|^errors|error"
