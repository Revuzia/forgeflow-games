#!/usr/bin/env bash
# biome crowd look + audits: slate, Size I milling (umbrella / arms audits) + flee with real keys (3 frames),
# then Size II milling + walk (facade audit). usage: biome2.sh TAG BIOME KEYS
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
S=_harness/scratch/civ; TAG=$1; B=$2; K=${3:-KeyW+KeyA}
timeout 600 python $S/civshot2.py "http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=$B&seed=7" screen:slate wait:2 shot:$S/${TAG}_${B}_slate.png dismiss screen:play "eval:window.__BT__.cheat.noSpawns(true)" "eval:window.__BT__.cheat.god(true)" wait:3 toplay wait:4 \
 umb:${TAG}_I_mill fac:${TAG}_I_mill shot:$S/${TAG}_${B}_I_mill.png perf:${TAG}_I \
 keys:$K:1.3 shot:$S/${TAG}_${B}_I_flee_a.png wait:0.1 shot:$S/${TAG}_${B}_I_flee_b.png wait:0.1 shot:$S/${TAG}_${B}_I_flee_c.png umb:${TAG}_I_flee \
 wait:2.5 umb:${TAG}_I_after shot:$S/${TAG}_${B}_I_after.png \
 "eval:window.__BT__.cheat.rank(1)" wait:5 toplay wait:4 fac:${TAG}_II_mill umb:${TAG}_II_mill shot:$S/${TAG}_${B}_II_mill.png perf:${TAG}_II \
 keys:$K:1.2 shot:$S/${TAG}_${B}_II_run_a.png fac:${TAG}_II_a umb:${TAG}_II_a keys:$K:1.0 shot:$S/${TAG}_${B}_II_run_b.png fac:${TAG}_II_b bld:${TAG}_II_b umb:${TAG}_II_b 2>&1 | grep -E "^perf|^fac|^bld|^umb|^errors|error|saved|pageerror" | cut -c1-700
