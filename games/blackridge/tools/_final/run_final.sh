#!/bin/bash
cd "C:/Users/TestRun/Claude Claw/forgeflow-games/games/blackridge"
O=tools/_final
node tools/nav_probe.mjs --pairs 300 > $O/nav_walk.txt 2>&1
node tools/nav_probe.mjs --pairs 150 --sprint > $O/nav_sprint.txt 2>&1
node tools/nav_probe.mjs --pairs 150 --squad > $O/nav_squad.txt 2>&1
node tools/nav_probe.mjs --pairs 150 --diversity > $O/nav_diversity.txt 2>&1
node tools/duel_probe.mjs --n 40 > $O/duel.txt 2>&1
node tools/persona_duel_probe.mjs --n 100 > $O/persona_duel.txt 2>&1
node tools/campaign_probe.mjs --secs 240 > $O/campaign.txt 2>&1
node tools/expert_probe.mjs --modes tdm,ffa --seeds 4 --secs 240 --det --json $O/expert_tdm_ffa.json > $O/expert_tdm_ffa.txt 2>&1
node tools/expert_probe.mjs --modes ctf --seeds 5 --secs 480 --json $O/expert_ctf.json > $O/expert_ctf.txt 2>&1
node tools/skill_probe.mjs --seeds 4 --secs 150 --quiet --json $O/ladder.json > $O/ladder.txt 2>&1
node _harness/matchprobe_runner.mjs --seeds 3 --skip-scenarios > $O/matchprobe3.txt 2>&1
echo done > $O/done.txt
