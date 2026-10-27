#!/usr/bin/env bash
# Run a heavy job (a multi-year sim run, a Playwright/SwiftShader shot run, the full test suite) in one of GENESIS_SLOTS
# machine-wide slots (default 3), waiting for a free one. Agents share a 4-CPU machine: with no cap, a dozen software
# renderers and sim runs ran at once (load ~22), every job took several times longer, and agents polled them for hours.
#   _harness/slot.sh node _harness/scratch/.../alone.ts 1 50 3000 live
#   setsid nohup _harness/slot.sh node _harness/shots.mjs spec.json --port=5199 > out.log 2>&1 &
# The wait is printed once to stderr; the job's exit status is returned.
set -u
N=${GENESIS_SLOTS:-3}
DIR=${GENESIS_SLOT_DIR:-/tmp/genesis-slots}
mkdir -p "$DIR"
said=0
while true; do
  for i in $(seq 1 "$N"); do
    exec {fd}>"$DIR/slot.$i"
    if flock -n "$fd"; then
      echo "$$ $(date -u +%FT%TZ) $*" >"$DIR/slot.$i.who"
      "$@"
      rc=$?
      : >"$DIR/slot.$i.who"
      exit "$rc"
    fi
    exec {fd}>&-
  done
  if [ "$said" = 0 ]; then echo "slot.sh: all $N slots busy, waiting ($(cat "$DIR"/slot.*.who 2>/dev/null | cut -c1-80 | tr '\n' ';'))" >&2; said=1; fi
  sleep 5
done
