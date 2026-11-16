#!/usr/bin/env bash
# usage: powers-stage0.sh <out.jsonl> <seeds> <scenario>...   (4 behaviours each, 10 years, n=20)
out=$1; seeds=$2; shift 2
for sc in "$@"; do for b in none help severe mixed; do for s in $seeds; do
  node _harness/probes/powers-stage0.ts $sc $b $s 10 20 2>&1 | grep '^RESULT' | sed 's/^RESULT //' >> "$out"
done; done; done
