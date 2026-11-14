#!/bin/bash
# usage: battery.sh <outdir> [probe names...]   runs probes in parallel, writes <name>.log and <name>.rc
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
OUT=$1; shift; mkdir -p "$OUT"
LIST="$@"; [ -z "$LIST" ] && LIST="g2fresh g2full gatekeepers ai city combat econ titan upgrades ult evolutions boss3 map meta endless icons"
for p in $LIST; do
  (
    s=$(date +%s)
    case $p in
      g2fresh) node _harness/probe_sim.ts --det 2 --meta fresh --json "$OUT/g2fresh.json" > "$OUT/$p.log" 2>&1 ;;
      g2full)  node _harness/probe_sim.ts --det 2 --meta full --json "$OUT/g2full.json" > "$OUT/$p.log" 2>&1 ;;
      *) node _harness/probe_$p.ts > "$OUT/$p.log" 2>&1 ;;
    esac
    echo "rc=$? wall=$(( $(date +%s) - s ))s" > "$OUT/$p.rc"
  ) &
done
wait
for p in $LIST; do echo "$p $(cat $OUT/$p.rc)"; done > "$OUT/summary.txt"
cat "$OUT/summary.txt"
