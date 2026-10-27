#!/bin/zsh
# List (default) or kill (--kill) the heavy processes agents leave behind when a usage limit or a crash
# kills them mid-task: headless Blender builds, harness/snapshot Chrome, extra vite servers and harness
# node scripts. Run it after a workflow dies, before relaunching (live agents also background jobs, so do
# not reap while a workflow is running unless --older-than says which ones are stuck).
#
#   zsh tools/reap_orphans.sh                     # list
#   zsh tools/reap_orphans.sh --kill              # kill all candidates
#   zsh tools/reap_orphans.sh --kill --older-than 90   # only ones running longer than 90 minutes
#
# Never touched: the GUI Blender (no -b), the owner's own Chrome (no automation flags), the dev server
# on :5190, the wip sync loop, and anything that is not this project's.

KILL=0; MIN_AGE=0
while (( $# )); do
  case $1 in
    --kill) KILL=1 ;;
    --older-than) shift; MIN_AGE=$1 ;;
  esac
  shift
done

secs() {   # ps etime [[dd-]hh:]mm:ss -> seconds
  local e=$1 d=0 h=0 m=0 s=0
  [[ $e == *-* ]] && { d=${e%%-*}; e=${e#*-}; }
  local parts=(${(s/:/)e})
  case ${#parts} in
    3) h=$parts[1]; m=$parts[2]; s=$parts[3] ;;
    2) m=$parts[1]; s=$parts[2] ;;
    1) s=$parts[1] ;;
  esac
  print $(( 10#$d * 86400 + 10#$h * 3600 + 10#$m * 60 + 10#$s ))
}

typeset -a victims
ps -Ao pid=,etime=,command= | while read -r pid et cmd; do
  local why=""
  if [[ $cmd == /Applications/Blender.app/Contents/MacOS/Blender* && ( $cmd == *" -b "* || $cmd == *--background* ) ]]; then why="headless Blender"
  elif [[ $cmd == "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome "* && ( $cmd == *--remote-debugging-pipe* || $cmd == *vale-snap-* || $cmd == *playwright* || $cmd == *--remote-debugging-port=0* ) ]]; then why="harness Chrome"
  elif [[ $cmd == node\ *node_modules/.bin/vite* && $cmd != *"--port 5190"* && $cmd == *forgeflow-games* ]]; then why="extra vite"
  elif [[ $cmd == node\ * && ( $cmd == *_harness/* || $cmd == *scratchpad/* || $cmd == *three_snapshot* ) && $cmd != *wip_sync* ]]; then why="harness node"
  fi
  [[ -z $why ]] && continue
  local age=$(secs $et)
  (( age < MIN_AGE * 60 )) && continue
  print -r -- "$pid  $(( age / 60 ))min  $why  ${cmd[1,150]}"
  victims+=$pid
done

if (( KILL && ${#victims} )); then
  kill -TERM $victims 2>/dev/null; sleep 3; kill -KILL $victims 2>/dev/null
  print "killed ${#victims} process(es)"
fi
# slots whose owners are gone are reclaimed on the next acquire; show what is held now
python3 ${0:A:h:h}/art/blender/common/heavy.py status
