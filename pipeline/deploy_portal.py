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

ALSO required after publishing a game (2026-07-07): game-detail pages
/games/<slug> are prerendered at build time from the Supabase slug list, so a
new publish makes the deployed prerender stale — a hard load of the new URL
would only recover via the homepage SPA-fallback redirect until this runs.
deploy_game.py now invokes this script automatically after each publish
(opt out with --no-portal). Listings (homepage/category carousels) still pick
up new games instantly via client-side Supabase queries.

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

# Windows consoles default to cp1252 and choke on wrangler / vite box-drawing glyphs
# (e.g. ▲ U+25B2). Printing a captured stderr on such a console raises UnicodeEncodeError,
# which would crash the deploy report (e.g. the BUILD FAILED dump below) instead of exiting
# cleanly. Reconfigure stdio to utf-8 with replacement so no log line is ever fatal.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path("C:/Users/TestRun/Claude Claw/forgeflow-games")
TOKEN_PATH = Path("C:/Users/TestRun/Claude Claw/.claude/settings.local.json")


def _load_pages_creds():
    """The api_config `cloudflare.tokens.isimcha85` token carries Pages:Edit (verified
    2026-07-20 — it lists/deploys forgeflow-games + forgeflow-portal). Returns
    (token, account_id) or (None, None). Preferred over wrangler OAuth, which expires
    every ~90 days and then needs an interactive `wrangler login`."""
    try:
        cfg = json.loads((Path(os.path.expanduser("~")) / "AppData" / "Roaming" / "Nomi" / "api_config.json").read_text(encoding="utf-8"))
    except Exception:
        return (None, None)
    prov = (cfg.get("providers", {}) or {}).get("cloudflare", {}) or {}
    acct = prov.get("account_id_isimcha85") or prov.get("account_id")
    tok = (((cfg.get("cloudflare", {}) or {}).get("tokens", {}) or {}).get("isimcha85", {}) or {}).get("token")
    return (tok, acct) if tok and acct else (None, None)


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
    # Find pre-render summary (sanitize unicode for Windows cp1252 stdout)
    last_lines = (r.stdout or "").splitlines()[-12:]
    for line in last_lines:
        if line.strip():
            try:
                print(f"  {line}")
            except UnicodeEncodeError:
                print(f"  {line.encode('ascii', 'replace').decode('ascii')}")

    # Step 2: wrangler pages deploy.
    # 2026-07-20 — supersedes the 2026-05-05 note below. The api_config
    # `cloudflare.tokens.isimcha85` token NOW carries Pages:Edit (verified against
    # /accounts/{id}/pages/projects), so prefer it: wrangler's OAuth token expires
    # (~90d) and then this step dies with "Failed to fetch auth token: 400 / Not
    # logged in", needing an interactive `wrangler login`. Only fall back to OAuth
    # when no Pages-capable API token is available.
    #   (old note: cfut_* tokens are Workers/R2-scoped and lack Pages write — still
    #    true, which is why we read the isimcha85 token, not _load_cf_token().)
    print("\n[2/2] Uploading to Cloudflare Pages (master branch)...")
    env = os.environ.copy()
    _pg_tok, _pg_acct = _load_pages_creds()
    if _pg_tok:
        env["CLOUDFLARE_API_TOKEN"] = _pg_tok
        env["CLOUDFLARE_ACCOUNT_ID"] = _pg_acct
        print("  [cf] using api_config isimcha85 token (Pages:Edit)")
    else:
        env.pop("CLOUDFLARE_API_TOKEN", None)
        print("  [cf] no Pages API token found — falling back to wrangler OAuth")
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
    safe_out = out[-2000:].encode("ascii", "replace").decode("ascii")
    print(safe_out)
    if r.returncode != 0 or "Deployment complete" not in out:
        print("\nDEPLOY FAILED")
        sys.exit(1)

    print("\n" + "=" * 64)
    print("Portal live: https://forgeflowgames.com")
    print("=" * 64)


if __name__ == "__main__":
    main()
