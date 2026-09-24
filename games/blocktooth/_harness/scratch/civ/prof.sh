#!/usr/bin/env bash
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
S=_harness/scratch/civ; D="eval:window.__BT__.debugCore.scene.getObjectByName('civilians').userData.civ"
timeout 300 python $S/civshot.py "http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=grideast&seed=7" screen:slate wait:2 dismiss screen:play "eval:window.__BT__.cheat.noSpawns(true)" "eval:window.__BT__.cheat.god(true)" wait:3 toplay wait:2 "$D" "eval:window.__BT__.cheat.rank(1)" wait:5 toplay wait:3 "$D" "eval:window.__BT__.cheat.rank(2)" wait:5 toplay wait:3 "$D" "eval:window.__BT__.cheat.rank(4)" wait:6 toplay wait:3 "$D" "eval:window.__BT__.state().screen" keys:KeyW:1.5 "$D" wait:1 "$D" 2>&1 | grep -E "eval|error" | cut -c1-330
