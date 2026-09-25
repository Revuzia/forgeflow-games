#!/bin/sh
# L8 gate battery on the own frozen server (port 5258): bootcheck ×12, playtest --matrix, shots v2hud, scratch checks
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
B=http://localhost:5258/
L=_harness/scratch/l8
for t in molo voltkite hearthback briarwick; do for b in grideast whitestacks lockwater; do
  echo "=== bootcheck $t $b"
  timeout 400 python _harness/bootcheck.py --base $B --no-serve --titan $t --biome $b --report-dir $L/reports --out-dir $L/boot > "$L/boot_${t}_${b}.txt" 2>&1; echo "rc=$?"
  tail -3 "$L/boot_${t}_${b}.txt"
done; done
echo "=== playtest --matrix"
timeout 1800 python _harness/playtest.py --base $B --no-serve --matrix --report-dir $L/reports --out-dir $L/play > $L/playtest.txt 2>&1; echo "rc=$?"
tail -25 $L/playtest.txt
echo "=== shots v2hud"
timeout 600 python _harness/shots.py --base $B --no-serve --groups v2hud --report-dir $L/reports > $L/shots.txt 2>&1; echo "rc=$?"
tail -12 $L/shots.txt
echo "=== ultseq"
timeout 300 python $L/ultseq.py --base $B --no-serve --headless > $L/ultseq.txt 2>&1; echo "rc=$?"
tail -3 $L/ultseq.txt
echo "=== ALL DONE"
