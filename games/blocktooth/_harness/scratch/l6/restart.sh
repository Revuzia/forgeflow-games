#!/bin/bash
# restart the L6 dev server on :5257 (BT_FROZEN=1 serves a frozen module graph: restart after edits)
LOG="/c/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/90494ede-f2e5-4eca-90f6-c7876a4b3b71/scratchpad/vite5257.log"
for pid in $(netstat -ano | grep ':5257 ' | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //F //T //PID $pid > /dev/null 2>&1; done
sleep 1
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
(BT_FROZEN=1 nohup npx vite --port 5257 --strictPort > "$LOG" 2>&1 &)
for i in $(seq 1 30); do sleep 1; if curl -s -o /dev/null http://localhost:5257/; then echo "up after ${i}s"; exit 0; fi; done
echo "server did not come up"; tail -5 "$LOG"; exit 1
