#!/usr/bin/env bash
# L10 scratch: stop whatever listens on :5260 (our own BT_FROZEN vite + its node child), start it again.
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth" || exit 1
for pid in $(netstat -ano | grep -E "[:.]5260\s+.*LISTENING" | awk '{print $NF}' | sort -u); do
  taskkill //PID "$pid" //T //F > /dev/null 2>&1
done
sleep 1
LOG="C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/90494ede-f2e5-4eca-90f6-c7876a4b3b71/scratchpad/vite5260.log"
BT_FROZEN=1 nohup npx vite --port 5260 --strictPort > "$LOG" 2>&1 &
for i in $(seq 1 40); do
  if curl -s -o /dev/null http://localhost:5260/; then echo "vite :5260 up"; exit 0; fi
  sleep 0.5
done
echo "vite :5260 did not come up"; cat "$LOG"; exit 1
