#!/usr/bin/env bash
# usage: powers-stage0.sh <out.jsonl> <scenario>...   (6 seeds x 4 behaviours each, 10 years, n=20)
out=$1; shift
for sc in "$@"; do for b in none help severe mixed; do for s in 1 2 3 4 5 6; do
  node _harness/probes/powers-stage0.ts $sc $b $s 10 20 2>&1 | grep '^RESULT' | sed 's/^RESULT //' >> "$out"
done; done; done
