#!/usr/bin/env python3
"""
git_versioning.py — Per-game Git version control.

Every generated game gets its own mini git repo inside `forgeflow-games/games/<slug>/`.
Each build phase commits. Deploy tags the commit as `v{version}`.

Lets us:
  - See exactly what Claude changed between builds (git diff)
  - Roll back to any prior version (git checkout)
  - Track which commits passed QA (tag `qa-passed-{timestamp}`)
  - Never lose a working version if a later build breaks things

API:
  from git_versioning import init, commit, tag, rollback
  init(game_dir)
  commit(game_dir, "scaffold: initial template + juice + analytics", author="ForgeFlow Pipeline <pipeline@forgeflowlabs.com>")
  tag(game_dir, "v1.0-published")
  rollback(game_dir, "qa-passed-2026-04-17")
"""
import subprocess
import os
from pathlib import Path


def _run(cmd, cwd, check=True):
    """Run a git command silently."""
    try:
        return subprocess.run(
            cmd, cwd=str(cwd), capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=30, check=False,
        )
    except Exception as e:
        return None


def init(game_dir: Path, initial_commit: bool = True) -> bool:
    """Initialize a git repo in the game directory. Idempotent."""
    game_dir = Path(game_dir)
    if (game_dir / ".git").exists():
        return True  # already initialized
    game_dir.mkdir(parents=True, exist_ok=True)
    r = _run(["git", "init", "--initial-branch=main"], game_dir)
    if not r or r.returncode != 0:
        return False
    # Configure local user so commits don't require global config
    _run(["git", "config", "user.email", "pipeline@forgeflowlabs.com"], game_dir)
    _run(["git", "config", "user.name", "ForgeFlow Pipeline"], game_dir)
    # .gitignore — exclude temp files + giant binaries
    gitignore = game_dir / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text(
            "\n".join([
                "# ForgeFlow pipeline — auto-generated .gitignore",
                "*.log", "*.tmp", ".DS_Store", "Thumbs.db",
                "node_modules/", "dist/", "build/",
                "# Big asset source files — regenerate-able from design.json",
                "music_prompts/",
            ]) + "\n",
            encoding="utf-8"
        )
    if initial_commit:
        commit(game_dir, "init: empty repo for new game")
    return True


def commit(game_dir: Path, message: str) -> str | None:
    """Stage all changes + commit. Returns commit SHA or None."""
    game_dir = Path(game_dir)
    if not (game_dir / ".git").exists():
        init(game_dir, initial_commit=False)
    _run(["git", "add", "-A"], game_dir)
    # Check if there's anything to commit
    status = _run(["git", "status", "--porcelain"], game_dir)
    if status and not status.stdout.strip():
        return None  # nothing to commit
    r = _run(["git", "commit", "-m", message, "--allow-empty"], game_dir)
    if not r or r.returncode != 0:
        return None
    sha = _run(["git", "rev-parse", "--short", "HEAD"], game_dir)
    return sha.stdout.strip() if sha and sha.returncode == 0 else None


def tag(game_dir: Path, tag_name: str, message: str = "") -> bool:
    """Tag the current HEAD."""
    game_dir = Path(game_dir)
    r = _run(["git", "tag", "-a", tag_name, "-m", message or tag_name], game_dir)
    return r is not None and r.returncode == 0


def get_current_sha(game_dir: Path) -> str | None:
    game_dir = Path(game_dir)
    r = _run(["git", "rev-parse", "--short", "HEAD"], game_dir)
    return r.stdout.strip() if r and r.returncode == 0 else None


def get_log(game_dir: Path, limit: int = 20) -> list:
    """Return list of recent commits: [{sha, message, ts}, ...]."""
    game_dir = Path(game_dir)
    r = _run(["git", "log", "--pretty=format:%h|%s|%ci", f"--max-count={limit}"], game_dir)
    if not r or r.returncode != 0:
        return []
    commits = []
    for line in r.stdout.strip().split("\n"):
        parts = line.split("|", 2)
        if len(parts) == 3:
            commits.append({"sha": parts[0], "message": parts[1], "ts": parts[2]})
    return commits


def rollback(game_dir: Path, ref: str) -> bool:
    """Hard reset to a tag / sha / branch. DESTRUCTIVE — use for emergency recovery only."""
    game_dir = Path(game_dir)
    r = _run(["git", "reset", "--hard", ref], game_dir)
    return r is not None and r.returncode == 0


def diff_against(game_dir: Path, ref: str = "HEAD~1") -> str:
    """Return a diff between current working tree and a prior ref."""
    game_dir = Path(game_dir)
    r = _run(["git", "diff", "--stat", ref], game_dir)
    return r.stdout if r else ""


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("game_dir")
    ap.add_argument("--log", action="store_true")
    ap.add_argument("--commit", help="commit message")
    ap.add_argument("--tag", help="tag name")
    ap.add_argument("--rollback", help="rollback to ref")
    args = ap.parse_args()

    gd = Path(args.game_dir)
    init(gd, initial_commit=False)

    if args.commit:
        sha = commit(gd, args.commit)
        print(f"commit: {sha}")
    if args.tag:
        print(f"tag: {tag(gd, args.tag)}")
    if args.rollback:
        print(f"rollback: {rollback(gd, args.rollback)}")
    if args.log:
        for c in get_log(gd):
            print(f"{c['sha']} {c['ts']}  {c['message']}")


if __name__ == "__main__":
    main()
