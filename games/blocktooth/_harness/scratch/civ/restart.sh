#!/usr/bin/env bash
# restart the civ lane's frozen dev server on :5202 (kills only the process tree listening there)
cd "/c/Users/TestRun/Claude Claw/forgeflow-games/games/blocktooth"
PID=$(powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5202 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess")
PID=$(echo "$PID" | tr -d '\r ')
if [ -n "$PID" ]; then
  PP=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=$PID').ParentProcessId" | tr -d '\r ')
  PPP=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=$PP').ParentProcessId" | tr -d '\r ')
  taskkill //PID "$PPP" //T //F >/dev/null 2>&1
  taskkill //PID "$PP" //T //F >/dev/null 2>&1
  taskkill //PID "$PID" //T //F >/dev/null 2>&1
fi
sleep 1
(BT_FROZEN=1 npx vite --port 5202 --strictPort > _harness/scratch/civ/vite.log 2>&1 &)
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://localhost:5202/; then echo "vite up"; exit 0; fi
  sleep 1
done
echo "vite failed"; cat _harness/scratch/civ/vite.log; exit 1
