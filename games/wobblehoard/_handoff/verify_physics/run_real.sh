#!/bin/bash
# old verifier's realistic set (5 genomes x 20000 frames) and drag set on HEAD, sequential in ONE process slot
S=/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify; V=/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/verify_repair_a; R=$S/head/games/wobblehoard
for g in starter f0b0s0z0 f0b0s1z1 f1b1s1z1 f0b1s0z0; do nice -n 5 node $V/realistic.ts --root $R --g $g --frames 20000 > $S/out/real_head_$g.json 2>&1; echo "real $g: $(tail -1 $S/out/real_head_$g.json | cut -c1-400)"; done
for k in 0 1; do nice -n 5 node $V/dense.ts --root $R --set drag --shard $k/2 > $S/out/drag_head_$k.jsonl 2> $S/out/drag_head_$k.err; done
python3 $S/sumdrag.py $S/out/drag_head_0.jsonl $S/out/drag_head_1.jsonl
echo REAL_DONE
