#!/bin/bash
# Rebuild keep-kit pieces, N at a time (one Blender process per piece: a crash in one never
# takes the others down).  usage: ./run_all.sh [-j N] piece...     (no pieces = all 20)
J=3
if [ "$1" = "-j" ]; then J=$2; shift 2; fi
: "${KEEPKIT_SCRATCH:=$TEMP/keepkit/bake}"
export KEEPKIT_SCRATCH
LOG="${KEEPKIT_LOGS:-$KEEPKIT_SCRATCH/../logs}"; mkdir -p "$LOG" "$KEEPKIT_SCRATCH"
cd "C:/Users/TestRun/Claude Claw/forgeflow-games/games/crestbound/_tools/blender/keep"
BL="C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
ALL="wall_panel corner_pier arch_door arch_window column balustrade newel stair_module gallery_beam
     hammer_beam_truss frame_painting_s frame_painting_m frame_painting_l gate_door pedestal brazier
     banner_pole torch_sconce bench bookcase"
PCS="${@:-$ALL}"
for pc in $PCS; do
  while [ "$(jobs -rp | wc -l)" -ge "$J" ]; do wait -n; done
  ( "$BL" --background --factory-startup --python build_kit.py -- --piece "$pc" > "$LOG/$pc.log" 2>&1
    echo "$pc rc=$? $(grep -h 'MANIFEST' "$LOG/$pc.log" | head -1)" ) &
done
wait
echo "=== BATCH DONE $(date +%H:%M:%S)"
