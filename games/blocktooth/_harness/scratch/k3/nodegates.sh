#!/bin/bash
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
O=_harness/scratch/k3
: > $O/nodegates_summary.txt
s=$(date +%s); node _harness/probe_sim.ts --det 2 --meta fresh > $O/g2_fresh.log 2>&1; echo "g2 fresh exit $? ($(( $(date +%s)-s )) s)" >> $O/nodegates_summary.txt
s=$(date +%s); node _harness/probe_sim.ts --det 2 --meta full > $O/g2_full.log 2>&1; echo "g2 full exit $? ($(( $(date +%s)-s )) s)" >> $O/nodegates_summary.txt
for n in gatekeepers ai city combat econ titan upgrades ult evolutions boss3 map meta endless icons; do
  s=$(date +%s); node _harness/probe_$n.ts > $O/p_$n.txt 2>&1; echo "probe_$n exit $? ($(( $(date +%s)-s )) s)" >> $O/nodegates_summary.txt
done
echo DONE >> $O/nodegates_summary.txt
