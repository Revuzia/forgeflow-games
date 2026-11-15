#!/usr/bin/env bash
# Size III: walk the titan into a crowd near parked cars; 3 frames ~0.15 s apart + prop counters
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
S=_harness/scratch/civ; TAG=$1; K=${2:-KeyW+KeyA}; HOLD=${3:-1.0}
timeout 400 python $S/civshot.py "http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=grideast&seed=7" screen:slate wait:2 dismiss screen:play "eval:window.__BT__.cheat.noSpawns(true)" "eval:window.__BT__.cheat.god(true)" wait:3 toplay \
 "eval:window.__BT__.cheat.rank(2)" wait:5 toplay wait:4 perf:${TAG}_III_mill shot:$S/${TAG}_III_mill.png keys:$K:$HOLD shot:$S/${TAG}_III_a.png wait:0.08 shot:$S/${TAG}_III_b.png wait:0.08 shot:$S/${TAG}_III_c.png \
 "eval:window.__BT__.debugCore.scene.getObjectByName('civilians').userData.civ" wait:0.3 "eval:window.__BT__.debugCore.scene.getObjectByName('civilians').userData.civ" wait:0.5 "eval:window.__BT__.debugCore.scene.getObjectByName('civilians').userData.civ" perf:${TAG}_III_flee 2>&1 | grep -E "^perf|^errors|error|saved|eval" | cut -c1-400
