#!/bin/bash
# sequential batch: one Blender process per piece (a crash in one never takes the others down)
export KEEPKIT_SCRATCH="C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/a992d8a8-ce97-4b9a-af14-d8df83c29dd9/scratchpad/keepkit/bake"
LOG="$KEEPKIT_SCRATCH/../logs"; mkdir -p "$LOG"
cd "C:/Users/TestRun/Claude Claw/forgeflow-games/games/crestbound/_tools/blender/keep"
for pc in "$@"; do
  echo "=== $pc $(date +%H:%M:%S)"
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup --python build_kit.py -- --piece "$pc" > "$LOG/$pc.log" 2>&1
  echo "rc=$? $(grep -h 'MANIFEST\|Error\|Traceback' "$LOG/$pc.log" | head -3)"
done
echo "=== BATCH DONE $(date +%H:%M:%S)"
