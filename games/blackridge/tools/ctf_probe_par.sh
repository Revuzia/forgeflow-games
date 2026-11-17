#!/usr/bin/env bash
# tools/ctf_probe_par.sh — ctf_probe.mjs with one process per map (same seeds,
# same output lines, just in parallel). Extra args go to every process.
#   bash tools/ctf_probe_par.sh --seeds 16 [--even]
cd "$(dirname "$0")/.." || exit 1
tmp=$(mktemp -d)
for m in lanternwalk switchyard saltmarket; do
  node tools/ctf_probe.mjs --maps "$m" "$@" > "$tmp/$m.txt" 2>&1 &
done
wait
for m in lanternwalk switchyard saltmarket; do grep -v "^\[ctf\]\|^DBG\|^ST \|^$" "$tmp/$m.txt" | grep -v "^ctf_probe"; done
grep "^ctf_probe" "$tmp/lanternwalk.txt"
rm -rf "$tmp"
