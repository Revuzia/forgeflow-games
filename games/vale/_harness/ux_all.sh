#!/bin/zsh
# orch1 UX evidence: every part in sequence under ONE heavy slot (run via heavy.py run -- zsh _harness/ux_all.sh)
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH
export VALE_URL_PROD=http://localhost:5231 VALE_URL_DEV=http://localhost:5232
cd /Users/sitskovich/Developer/forgeflow-games/games/vale
L=/private/tmp/claude-501/ux_logs; mkdir -p $L
for spec in "cold --vp 1920x1080" "cold --vp 1366x768" "menus" "draft" "hud" "hud2" "practice" "post"; do
  n=${spec// /_}; echo "[ux_all] start $spec $(date +%T)"
  node _harness/ux_run.mjs ${=spec} > $L/$n.log 2>&1; echo "[ux_all] done $spec exit $? $(date +%T)"
done
