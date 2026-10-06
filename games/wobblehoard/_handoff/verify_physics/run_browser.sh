#!/bin/bash
# lens 4: filmstrips from the HEAD snapshot, vite + one browser on port 5372, output in $S/shots. Sequential: one browser at a time.
S=/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify; cd $S/head/games/wobblehoard
run() { nice -n 5 node _harness/browser_physics.mjs "$@" --port 5372 --out $S/shots 2>&1 | grep -v "^filmstrips in" ; }
for f in slowrise marshmallow mochidough jellygel waterfill putty stickystretch slimegoo firmsilicone popdome gummy beadsqueeze; do run family_demo --family $f --tag $f --q mark=1; done
for sp in dollop cushlet burrbin marigel skeinara constello prismelo; do run family_demo --species $sp --tag sp_$sp --q mark=1; done
run --sheet
echo BROWSER_DONE
