#!/usr/bin/env bash
# Size I: crowd milling, then walk the titan at them with real keys; 3 frames ~0.15 s apart
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
S=_harness/scratch/civ; TAG=$1; K=${2:-KeyW+KeyA}; HOLD=${3:-1.4}
timeout 300 python $S/civshot.py "http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=grideast&seed=7" screen:slate wait:2 dismiss screen:play "eval:window.__BT__.cheat.noSpawns(true)" "eval:window.__BT__.cheat.god(true)" wait:4 toplay wait:4 perf:${TAG}_mill shot:$S/${TAG}_mill.png keys:$K:$HOLD shot:$S/${TAG}_flee_a.png wait:0.08 shot:$S/${TAG}_flee_b.png wait:0.08 shot:$S/${TAG}_flee_c.png perf:${TAG}_flee wait:2.5 shot:$S/${TAG}_after.png perf:${TAG}_after 2>&1 | grep -E "^perf|^errors|error|saved"
