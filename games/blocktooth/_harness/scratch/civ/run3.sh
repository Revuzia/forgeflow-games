#!/usr/bin/env bash
# Size II/III flee audit (facades + umbrellas): walk the titan with real keys, shoot + audit between holds
# usage: run3.sh TAG BIOME RANK KEYS
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
S=_harness/scratch/civ; TAG=$1; B=${2:-grideast}; RK=${3:-2}; K=${4:-KeyW+KeyA}
timeout 500 python $S/civshot2.py "http://localhost:5202/?autostart=1&dev=1&titan=molo&biome=$B&seed=7" screen:slate wait:2 dismiss screen:play "eval:window.__BT__.cheat.noSpawns(true)" "eval:window.__BT__.cheat.god(true)" wait:3 toplay \
 "eval:window.__BT__.cheat.rank($RK)" wait:5 toplay wait:4 fac:${TAG}_mill umb:${TAG}_mill shot:$S/${TAG}_mill.png \
 keys:$K:1.2 shot:$S/${TAG}_run_a.png fac:${TAG}_a bld:${TAG}_a umb:${TAG}_a \
 keys:$K:1.2 shot:$S/${TAG}_run_b.png fac:${TAG}_b bld:${TAG}_b umb:${TAG}_b props:${TAG}_b \
 keys:$K:1.2 shot:$S/${TAG}_run_c.png fac:${TAG}_c bld:${TAG}_c umb:${TAG}_c \
 wait:0.6 shot:$S/${TAG}_run_d.png fac:${TAG}_d bld:${TAG}_d perf:${TAG}_perf 2>&1 | grep -E "^perf|^fac|^bld|^umb|^errors|error|saved|pageerror" | cut -c1-900
