#!/bin/bash
# Build the per-realm prop kits, N at a time (one Blender process per realm).
#   ./run_all.sh [-j N] [realm...]        (no realms = all four)
J=2
if [ "$1" = "-j" ]; then J=$2; shift 2; fi
HERE="C:/Users/TestRun/Claude Claw/forgeflow-games/games/crestbound/_tools/blender/props"
OUT="C:/Users/TestRun/Claude Claw/forgeflow-games/games/crestbound/assets/models/props"
LOG="${PROPKIT_LOGS:-$TEMP/propkit_logs}"; mkdir -p "$LOG" "$OUT"
BL="C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
cd "$HERE"
for r in ${@:-verdant ember rime azure}; do
  while [ "$(jobs -rp | wc -l)" -ge "$J" ]; do wait -n; done
  ( "$BL" --background --factory-startup --python build_realm.py -- "$r" "$OUT" > "$LOG/props_$r.log" 2>&1
    echo "$r rc=$? $(grep -h 'DONE' "$LOG/props_$r.log" | tail -1)" ) &
done
wait
echo "=== PROPS BATCH DONE $(date +%H:%M:%S)"
