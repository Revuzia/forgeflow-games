#!/bin/zsh
# WIP sync: commit and push everything under games/vale every N seconds so a usage limit, a crash or a
# killed agent never loses work. Commits only to the current branch (never master), never force-pushes,
# never touches the working tree (no stash/reset/checkout), and leaves scratch renders out.
#
#   zsh tools/wip_sync.sh [interval_s=1200] [log=/tmp/vale_wip_sync.log]
#   zsh tools/wip_sync.sh --once
#
# Included: tracked changes under games/vale, plus untracked files there except scratch images under
# art/renders/ (only build_report_*.json, three_*.png, turntable.png and *_progress.md go in), temp
# scripts (*_tmp*, *.tmp, *.log) and anything over 15 MB. Agents committing their own lanes in between
# is fine: whatever they commit first is simply not in the next sync.

ONCE=0
if [[ "$1" == "--once" ]]; then ONCE=1; shift; fi
INTERVAL=${1:-1200}
LOG=${2:-/tmp/vale_wip_sync.log}
VALE=${0:A:h:h}
ROOT=$(git -C "$VALE" rev-parse --show-toplevel) || exit 1
REL=${VALE#$ROOT/}
GITDIR=$(git -C "$ROOT" rev-parse --absolute-git-dir)

log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

keep() {   # $1 = repo-relative path of an untracked file
  local p=$1 b=${1:t}
  [[ $b == *_tmp* || $b == *.tmp || $b == *.log ]] && return 1
  if [[ $p == $REL/art/renders/* ]]; then
    [[ $b == build_report_*.json || $b == three_*.png || $b == turntable.png || $b == *_progress.md ]] || return 1
  fi
  local sz=$(stat -f %z "$ROOT/$p" 2>/dev/null || echo 0)
  (( sz <= 15 * 1024 * 1024 )) || { log "skip (>15MB): $p"; return 1; }
  return 0
}

sync_once() {
  cd "$ROOT" || return 1
  local branch=$(git rev-parse --abbrev-ref HEAD)
  if [[ $branch == master || $branch == main || $branch == HEAD ]]; then log "refusing to sync on '$branch'"; return 1; fi
  # wait (up to 5 min) for a moment when no other git process holds the index and nothing is staged
  local tries=0
  while (( tries < 30 )); do
    if [[ ! -e $GITDIR/index.lock ]] && git diff --cached --quiet; then break; fi
    (( tries++ )); sleep 10
  done
  [[ -e $GITDIR/index.lock ]] && { log "index.lock held for 5 min; skipped this round"; return 1; }

  git add -u -- "$REL" 2>>"$LOG"
  local f n=0
  git ls-files --others --exclude-standard -z -- "$REL" | while IFS= read -r -d '' f; do
    if keep "$f"; then git add -- "$f" 2>>"$LOG" && (( n++ )); fi
  done
  if git diff --cached --quiet; then log "nothing to sync"; return 0; fi
  local count=$(git diff --cached --name-only | wc -l | tr -d ' ')
  local areas=$(git diff --cached --name-only | sed -E "s#^$REL/##; s#^([^/]+/[^/]+).*#\\1#" | sort -u | head -8 | paste -sd, -)
  git commit -q -m "vale wip sync: $count files ($areas)" -m "Automatic 20-minute safety sync of work in progress (tools/wip_sync.sh); reviewed commits land on top." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" 2>>"$LOG" \
    || { log "commit failed"; return 1; }
  log "committed $(git rev-parse --short HEAD): $count files ($areas)"
  if git push -q origin "$branch" 2>>"$LOG"; then log "pushed $branch"; else log "push failed (will retry next round)"; fi
}

if (( ONCE )); then sync_once; exit $?; fi
log "wip sync started: every ${INTERVAL}s on $(git -C "$ROOT" rev-parse --abbrev-ref HEAD), pid $$"
while true; do
  sync_once
  sleep "$INTERVAL"
done
