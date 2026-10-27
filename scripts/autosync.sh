#!/usr/bin/env bash
# Commit and push work in progress every AUTOSYNC_MINUTES (default 20), so a lost container or a session cut off by a
# usage limit loses at most that much work. Started by the SessionStart hook in .claude/settings.json (and by hand:
# `setsid nohup bash scripts/autosync.sh >/dev/null 2>&1 &`); starting it twice is harmless (one loop per clone, flock).
#
# Safety: runs only on claude/* branches; never forces a push or rewrites history; skips a round while git is busy
# (a commit, merge or rebase in progress); leaves files over AUTOSYNC_MAX_MB (default 50) unstaged, since GitHub rejects
# pushes past 100 MB. `AUTOSYNC_ONCE=1` syncs once and exits. The log is .git/autosync.log (never committed).
set -u

ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$ROOT" || exit 0
GIT_DIR=$(git rev-parse --absolute-git-dir) || exit 0
LOG="$GIT_DIR/autosync.log"
MIN=${AUTOSYNC_MINUTES:-20}
MAXMB=${AUTOSYNC_MAX_MB:-50}
SESSION=${CLAUDE_CODE_REMOTE_SESSION_ID:-}

log() { echo "$(date -u +%FT%TZ) $*" >>"$LOG"; }

push() {
  local wait=2
  for _ in 1 2 3 4 5; do
    if git push -q -u origin "HEAD:refs/heads/$1" >>"$LOG" 2>&1; then log "pushed $1 at $(git rev-parse --short HEAD)"; return 0; fi
    sleep "$wait"; wait=$((wait * 2))
  done
  log "push failed for $1 (left for the next round)"
}

sync_once() {
  local branch
  branch=$(git symbolic-ref --short -q HEAD) || return 0
  case "$branch" in claude/*) ;; *) return 0 ;; esac
  if [ -e "$GIT_DIR/index.lock" ] || [ -e "$GIT_DIR/MERGE_HEAD" ] || [ -d "$GIT_DIR/rebase-merge" ] || [ -d "$GIT_DIR/rebase-apply" ]; then
    log "skip: git busy"; return 0
  fi
  git add -A >>"$LOG" 2>&1 || { log "git add failed"; return 0; }
  local f sz
  while IFS= read -r -d '' f; do
    sz=$(stat -c %s -- "$f" 2>/dev/null || echo 0)
    if [ "$sz" -gt $((MAXMB * 1024 * 1024)) ]; then git reset -q -- "$f"; log "left unstaged (too big for GitHub): $f ($sz bytes)"; fi
  done < <(git diff --cached --name-only -z --diff-filter=AM)
  if ! git diff --cached --quiet; then
    local n trailer
    n=$(git diff --cached --name-only | wc -l)
    trailer="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
    [ -n "$SESSION" ] && trailer="$trailer
Claude-Session: https://claude.ai/code/session_${SESSION#cse_}"
    if git commit -q -m "WIP auto-checkpoint: $n files (every $MIN min)" -m "$trailer" >>"$LOG" 2>&1; then
      log "committed $n files on $branch"
    else
      log "commit failed"; return 0
    fi
  fi
  # push when the branch is ahead of its upstream (or has none yet)
  if ! git rev-parse -q --verify '@{u}' >/dev/null 2>&1 || [ -n "$(git rev-list '@{u}..HEAD' 2>/dev/null)" ]; then push "$branch"; fi
}

if [ "${AUTOSYNC_ONCE:-0}" = 1 ]; then sync_once; exit 0; fi

exec 9>"$GIT_DIR/autosync.lock"
flock -n 9 || exit 0
log "autosync started (pid $$, every $MIN min)"
while true; do
  sleep $((MIN * 60))
  sync_once
done
