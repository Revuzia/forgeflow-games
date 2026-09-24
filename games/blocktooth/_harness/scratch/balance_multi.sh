#!/usr/bin/env bash
# Run the 12-config matrix for several seeds in parallel; print each seed's summary lines (short form).
cd "$(dirname "$0")/../.."
SEEDS=${SEEDS:-"1337 7 99"}
for s in $SEEDS; do
  mkdir -p _harness/scratch/bal_$s
  for t in molo voltkite hearthback briarwick; do
    for b in grideast whitestacks lockwater; do
      node _harness/scratch/balance_run.ts $t $b $s 13 > "_harness/scratch/bal_$s/$t.$b.json" 2> "_harness/scratch/bal_$s/$t.$b.err" &
    done
  done
done
wait
for s in $SEEDS; do
  echo "=== seed $s"
  node _harness/scratch/balance_sum.ts _harness/scratch/bal_$s | sed -E 's/ \| III .* dps/ dps/'
done
