#!/usr/bin/env python3
"""deploy_portal.py — Build + deploy the forgeflowgames.com portal to Cloudflare
Pages. Use whenever the React frontend changes (src/, pages/, public/).

WHY THIS EXISTS: Cloudflare Pages' GitHub auto-deploy was broken on 2026-04-21
(last successful auto-build). Pushes to master since then have been silently
ignored. Until the GitHub integration is re-linked in the CF dashboard, this
script is the canonical "make the portal live" step.

Use after every commit that touches:
  - forgeflow-games/src/**       (React components)
  - forgeflow-games/pages/**     (Vike route pages)
  - forgeflow-games/public/**    (static assets, _redirects, robots.txt)
  - forgeflow-games/vite.config.ts, tailwind.config.ts, etc.

Does NOT need to run when only games/ R2 content changes (those go straight
to R2 via deploy_game.py / phase_deploy + the games-cdn worker — the portal
queries Supabase client-side and picks up new games instantly).

Usage:
    python pipeline/deploy_portal.py

Or as a one-liner from anywhere:
    python "C:/Users/TestRun/Claude Claw/forgeflow-games/pipeline/deploy_portal.py"
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path("C:/Users/TestRun/Claude Claw/forgeflow-games")
TOKEN_PATH = Path("C:/Users/TestRun/Claude Claw/.claude/settings.local.json")


def _load_cf_token() -> str:
    """Find a CF token in known locations. Falls back to env var."""
    if os.environ.get("CLOUDFLARE_API_TOKEN"):
        return os.environ["CLOUDFLARE_API_TOKEN"]
    if TOKEN_PATH.exists():
        try:
            content = TOKEN_PATH.read_text(encoding="utf-8")
            import re
            m = re.search(r"cfut_[A-Za-z0-9_-]+", content)
            if m:
                return m.group(0)
        except Exception:
            pass
    raise RuntimeError(
        "No Cloudflare API token found. Set CLOUDFLARE_API_TOKEN env var or run "
        "`npx wrangler login` to authenticate."
    )


def main():
    if not (ROOT / "package.json").exists():
        print(f"ERROR: {ROOT / 'package.json'} not found")
        sys.exit(1)

    print("=" * 64)
    print("ForgeFlow Games portal deploy")
    print("=" * 64)

    # Step 1: Vite SSG build
    print("\n[1/2] Building site (npm run build)...")
    r = subprocess.run(
        ["npm", "run", "build"],
        cwd=str(ROOT),
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        shell=True, timeout=300,
    )
    if r.returncode != 0:
        print("BUILD FAILED:")
        print(r.stdout[-2000:])
        print(r.stderr[-2000:])
        sys.exit(1)
    # Find pre-render summary
    last_lines = (r.stdout or "").splitlines()[-12:]
    for line in last_lines:
        if line.strip():
            print(f"  {line}")

    # Step 2: wrangler pages deploy
    print("\n[2/2] Uploading to Cloudflare Pages (master branch)...")
    token = _load_cf_token()
    env = os.environ.copy()
    env["CLOUDFLARE_API_TOKEN"] = token
    cmd = [
        "npx", "wrangler", "pages", "deploy", "dist/client",
        "--project-name", "forgeflow-games",
        "--branch", "master",
        "--commit-dirty=true",
    ]
    r = subprocess.run(
        cmd, cwd=str(ROOT), env=env,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        shell=True, timeout=300,
    )
    out = (r.stdout or "") + (r.stderr or "")
    print(out[-2000:])
    if r.returncode != 0 or "Deployment complete" not in out:
        print("\nDEPLOY FAILED")
        sys.exit(1)

    print("\n" + "=" * 64)
    print("Portal live: https://forgeflowgames.com")
    print("=" * 64)


if __name__ == "__main__":
    main()
