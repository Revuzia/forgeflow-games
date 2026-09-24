#!/usr/bin/env bash
# Run all 12 titan x biome balance_run.ts in parallel, then summarize. Usage: balance_matrix.sh [seed] [outdir]
cd "$(dirname "$0")/../.."
SEED=${1:-1337}
OUT=${2:-_harness/scratch/bal_out}
mkdir -p "$OUT"
for t in molo voltkite hearthback briarwick; do
  for b in grideast whitestacks lockwater; do
    node _harness/scratch/balance_run.ts $t $b $SEED 13 > "$OUT/$t.$b.json" 2> "$OUT/$t.$b.err" &
  done
done
wait
node _harness/scratch/balance_sum.ts "$OUT" ${3:-}
