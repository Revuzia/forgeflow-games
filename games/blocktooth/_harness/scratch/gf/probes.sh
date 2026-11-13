#!/bin/bash
# usage: probes.sh <tag> <probe...>
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
G=_harness/scratch/gf; tag=$1; shift
for p in "$@"; do
  ( s=$(date +%s); node _harness/probe_$p.ts > $G/${tag}_$p.txt 2>&1; rc=$?; echo "rc=$rc wall=$(( $(date +%s)-s ))s" >> $G/${tag}_$p.txt ) &
done
wait
for p in "$@"; do echo "== $p: $(tail -n 1 $G/${tag}_$p.txt) | $(grep -E 'probe_[a-z0-9]+: (PASS|FAIL)|^(PASS|FAIL)' $G/${tag}_$p.txt | tail -n 1)"; done
