#!/usr/bin/env bash
# Run a heavy job (a multi-year sim run, a Playwright/SwiftShader shot run, the full test suite) in one of GENESIS_SLOTS
# machine-wide slots (default 3), first come first served. Agents share a 4-CPU machine: with no cap, a dozen software
# renderers and sim runs ran at once (load ~22), every job took several times longer, and agents polled them for hours.
#   _harness/slot.sh node _harness/scratch/.../alone.ts 1 50 3000 live
#   setsid nohup _harness/slot.sh node _harness/shots.mjs spec.json --port=5199 > out.log 2>&1 &
# Fairness: each job takes a numbered ticket and only the oldest live ticket may take a free slot (a retry-every-5-s
# scramble let a chain that started its next job the moment one ended win slot after slot over jobs waiting for 15 min).
# Tickets and slot records of dead processes are swept. The job cannot raise its own priority (setpriv drops
# CAP_SYS_NICE: renicing to a negative niceness starves everyone else); `slot.sh --status` prints who holds and who waits. Returns the job's exit status.
set -u
N=${GENESIS_SLOTS:-3}
DIR=${GENESIS_SLOT_DIR:-/tmp/genesis-slots}
mkdir -p "$DIR/wait"

if [ "${1:-}" = "--status" ]; then
  echo "slots ($N):"; for i in $(seq 1 "$N"); do printf '  %s: %s\n' "$i" "$(cut -c1-140 "$DIR/slot.$i.who" 2>/dev/null)"; done
  echo "waiting:"; for t in $(ls "$DIR/wait" 2>/dev/null | sort -n); do printf '  #%s %s\n' "$t" "$(cut -c1-140 "$DIR/wait/$t")"; done
  exit 0
fi
[ $# -gt 0 ] || { echo "usage: slot.sh <command...> | --status" >&2; exit 2; }

# a ticket: the next number under a lock
ticket=$( { flock 8; n=$(cat "$DIR/counter" 2>/dev/null || echo 0); echo $((n + 1)) >"$DIR/counter"; echo $((n + 1)); } 8>"$DIR/counter.lock" )
echo "$$ $(date -u +%FT%TZ) $*" >"$DIR/wait/$ticket"
trap 'rm -f "$DIR/wait/$ticket"' EXIT

alive() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }
said=0
while true; do
  # sweep tickets of processes that died while waiting
  head=""
  for t in $(ls "$DIR/wait" | sort -n); do
    pid=$(cut -d' ' -f1 "$DIR/wait/$t" 2>/dev/null)
    if alive "$pid"; then head=$t; break; else rm -f "$DIR/wait/$t"; fi
  done
  if [ "$head" = "$ticket" ]; then
    for i in $(seq 1 "$N"); do
      exec {fd}>"$DIR/slot.$i"
      if flock -n "$fd"; then
        rm -f "$DIR/wait/$ticket"
        echo "$$ $(date -u +%FT%TZ) $*" >"$DIR/slot.$i.who"
        # (Chromium, running as root, raises its GPU and renderer threads to nice -8 and starves the sim runs: take that right away)
        if command -v setpriv >/dev/null 2>&1; then setpriv --bounding-set=-sys_nice -- "$@"; else "$@"; fi
        rc=$?
        : >"$DIR/slot.$i.who"
        exit "$rc"
      fi
      exec {fd}>&-
    done
  fi
  if [ "$said" = 0 ]; then echo "slot.sh: ticket #$ticket waiting for one of $N slots (slot.sh --status to see the queue)" >&2; said=1; fi
  sleep 2
done
