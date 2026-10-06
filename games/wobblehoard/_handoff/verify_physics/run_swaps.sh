#!/bin/bash
S=/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify
for D in $S/swap/*/; do n=$(basename $D); ( cd $D && nice -n 5 node _harness/probe_families.ts > $S/swap_$n.txt 2>&1; echo "exit $?" >> $S/swap_$n.txt ); echo "$n: $(grep -c '^FAIL' $S/swap_$n.txt) FAIL rows, $(tail -2 $S/swap_$n.txt | tr '\n' ' ')"; done
echo SWAPS_DONE
