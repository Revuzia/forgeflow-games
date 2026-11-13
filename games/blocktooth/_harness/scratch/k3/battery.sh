#!/bin/bash
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
O=_harness/scratch/k3/final
mkdir -p $O
S=$O/summary.txt
: > $S
npx tsc --noEmit -p tsconfig.json > $O/tsc.log 2>&1; echo "tsc exit $? ($(wc -l < $O/tsc.log) lines)" >> $S
for t in molo voltkite hearthback briarwick; do for b in grideast whitestacks lockwater; do
  python _harness/bootcheck.py --no-serve --titan $t --biome $b > $O/boot_${t}_${b}.log 2>&1; echo "bootcheck $t/$b exit $?" >> $S
done; done
s=$(date +%s); python _harness/playtest.py --no-serve --matrix > $O/playtest_matrix.log 2>&1; echo "playtest --matrix exit $? ($(( $(date +%s)-s )) s)" >> $S
s=$(date +%s); python _harness/playtest_v2.py --no-serve --require-all > $O/playtest_v2.log 2>&1; echo "playtest_v2 --require-all exit $? ($(( $(date +%s)-s )) s)" >> $S
s=$(date +%s); python _harness/playtest_gate.py --no-serve > $O/playtest_gate.log 2>&1; echo "playtest_gate exit $? ($(( $(date +%s)-s )) s)" >> $S
s=$(date +%s); python _harness/shots.py --no-serve --groups gates > $O/shots_gates.log 2>&1; echo "shots gates exit $? ($(( $(date +%s)-s )) s)" >> $S
echo DONE >> $S
