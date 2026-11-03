#!/usr/bin/env python3
"""
upload_game.py — the easy, portable game uploader for ForgeFlow Games.

Works the same on any PC (yours or a friend's): it authenticates with a
Cloudflare **R2-Edit API token** (Option B — no interactive `wrangler login`,
which lacks R2 scope), uploads a game's files to the R2 bucket, upserts its
Supabase row, and verifies the live URL. One-click via `upload-game.bat`.

Usage:
    python upload_game.py                 # interactive: pick a game (or "all")
    python upload_game.py <slug>          # upload games/<slug>
    python upload_game.py --all           # upload every game under games/
    python upload_game.py --check         # verify setup (token/account/wrangler), list games
    python upload_game.py --setup         # (re)enter the Cloudflare API token + account id

First run with no token: it walks you through creating one and saves it to
.secrets/ (gitignored), so you never have to do it again on this machine.
"""
import sys
import os
import re
import subprocess
from pathlib import Path

# Windows consoles default to cp1252 and choke on ✓/box-drawing glyphs — make
# stdout/stderr utf-8 so the friendly output never crashes the tool.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
SECRETS = ROOT / ".secrets"
sys.path.insert(0, str(ROOT / "pipeline"))

TOKEN_HELP = """
────────────────────────────────────────────────────────────────────────
  ONE-TIME SETUP — create a Cloudflare R2 API token (works forever after)
────────────────────────────────────────────────────────────────────────
 1. Open:  https://dash.cloudflare.com/profile/api-tokens
 2. Click  "Create Token"  ->  "Create Custom Token".
 3. Permissions:  Account  ->  "Workers R2 Storage"  ->  Edit
 4. Account Resources:  Include  ->  your account (isimcha85).
 5. Continue -> Create Token -> COPY the token (starts with letters/numbers).
 6. Paste it below. It's saved to .secrets/cf_api_token.txt (gitignored) so
    you won't be asked again on this PC.
────────────────────────────────────────────────────────────────────────
"""


def save_secret(name, value):
    SECRETS.mkdir(exist_ok=True)
    (SECRETS / name).write_text(value.strip(), encoding="utf-8")
    # best-effort .gitignore safety
    gi = ROOT / ".gitignore"
    try:
        cur = gi.read_text(encoding="utf-8") if gi.exists() else ""
        if ".secrets/" not in cur:
            gi.write_text(cur.rstrip() + "\n.secrets/\n", encoding="utf-8")
    except Exception:
        pass


def interactive_setup(dg):
    """Prompt for the API token + account id and save them."""
    print(TOKEN_HELP)
    tok = input("Paste your Cloudflare R2 API token: ").strip()
    if not tok:
        print("No token entered — aborting setup.")
        return False
    save_secret("cf_api_token.txt", tok)
    acct = dg.resolve_cf_account_id()
    if not acct:
        acct = input("Cloudflare Account ID (find it on the R2 page / dashboard URL): ").strip()
        if acct:
            save_secret("cf_account_id.txt", acct)
    print("\n✓ Saved. You're set up on this PC.\n")
    return True


def have_wrangler():
    for cmd in (["npx", "wrangler", "--version"], ["wrangler", "--version"]):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, shell=True, timeout=60)
            if r.returncode == 0:
                return (r.stdout or r.stderr).strip().splitlines()[-1]
        except Exception:
            continue
    return None


def discover_games():
    gdir = ROOT / "games"
    out = []
    if not gdir.exists():
        return out
    for d in sorted(gdir.iterdir()):
        if d.is_dir() and (d / "index.html").exists() and not d.name.startswith("_"):
            out.append(d.name)
    return out


# ── Vite/TypeScript source games (2026-11-03) ─────────────────────────────
# Some games (genesis, blocktooth) keep a Vite DEV tree in games/<slug>/: its
# root index.html loads /src/main.ts, which only a dev server can run. Their
# shippable build is games/<slug>/dist/ (`npm run build`, gitignored, so a fresh
# clone has none). Uploading games/<slug>/ itself would put the TypeScript
# source on the live site and the game would never boot. So: deploy dist/ when
# the root is a dev entry, refuse when dist/ is missing or older than the source.
_DEV_ENTRY = re.compile(
    r"<script\b[^>]*\btype\s*=\s*[\"']module[\"'][^>]*\bsrc\s*=\s*[\"'](?:\.?/)?src/"
    r"|<script\b[^>]*\bsrc\s*=\s*[\"'][^\"']+\.tsx?(?:\?[^\"']*)?[\"']",
    re.IGNORECASE,
)


def is_dev_entry(folder):
    """True when folder/index.html is a Vite dev entry (loads /src/... or a .ts module)."""
    fp = Path(folder) / "index.html"
    try:
        return bool(_DEV_ENTRY.search(fp.read_text(encoding="utf-8", errors="ignore")))
    except OSError:
        return False


def _newest_source_mtime(game):
    newest = 0.0
    for name in ("src", "public", "index.html", "vite.config.ts", "package.json"):
        p = game / name
        files = [p] if p.is_file() else (f for f in p.rglob("*") if f.is_file()) if p.is_dir() else []
        for f in files:
            newest = max(newest, f.stat().st_mtime)
    return newest


def resolve_deploy_dir(slug, games_root=None):
    """(folder_to_upload, note) for games/<slug>; folder is None when it must not be uploaded.
    A plain game uploads its own folder. A Vite dev tree uploads its built dist/, and is refused
    when dist/ is missing, is itself a dev entry, or is older than the source (override the last
    with ALLOW_STALE_DIST=1)."""
    game = Path(games_root or (ROOT / "games")) / slug
    if not is_dev_entry(game):
        return game, None
    dist = game / "dist"
    rebuild = f"build it first: cd games/{slug} && npm run build"
    if not (dist / "index.html").exists():
        return None, f"games/{slug} is a Vite dev tree (index.html loads /src/) and has no dist/ build; {rebuild}"
    if is_dev_entry(dist):
        return None, f"games/{slug}/dist/index.html still loads /src/ (not a production build); {rebuild}"
    if _newest_source_mtime(game) > (dist / "index.html").stat().st_mtime and not os.environ.get("ALLOW_STALE_DIST"):
        return None, (f"games/{slug}/dist/ is older than its source (src/, public/ or index.html changed after the "
                      f"last build); {rebuild}  (override: ALLOW_STALE_DIST=1)")
    return dist, f"uploading the built games/{slug}/dist/ (the folder itself is a Vite dev tree)"


def main():
    import deploy_game as dg  # noqa: E402  (after sys.path insert)

    args = [a for a in sys.argv[1:]]
    flag = args[0] if args else None

    # --- setup / preflight ---
    if flag == "--setup":
        return 0 if interactive_setup(dg) else 1

    wv = have_wrangler()
    games = discover_games()

    if flag == "--check":
        print("ForgeFlow Games — uploader check\n")
        print(f"  wrangler:    {wv or 'NOT FOUND — install Node.js, then `npm i -g wrangler` (or npx works)'}")
        acct = dg.resolve_cf_account_id()
        tok = dg.resolve_cf_api_token()
        print(f"  account id:  {('…' + acct[-4:]) if acct else 'MISSING — run: python upload_game.py --setup'}")
        print(f"  API token:   {'present (R2 Edit)' if tok else 'MISSING — run: python upload_game.py --setup'}")
        print(f"  games found: {len(games)} -> {', '.join(games) if games else '(none)'}")
        for g in games:
            folder, note = resolve_deploy_dir(g)
            if note:
                print(f"  {g}: {'OK, ' + note if folder else 'WILL BE SKIPPED: ' + note}")
        ok = bool(wv and acct and tok and games)
        print("\n" + ("✓ Ready to upload." if ok else "✗ Fix the items marked MISSING/NOT FOUND above."))
        return 0 if ok else 1

    # Need a token to upload — offer setup if missing.
    if not dg.resolve_cf_api_token():
        print("No Cloudflare R2 API token found yet — let's set it up (one time).")
        if not interactive_setup(dg):
            return 1
    if not have_wrangler():
        print("ERROR: wrangler/npx not found. Install Node.js (https://nodejs.org), then re-run.")
        return 1
    dg.ensure_cf_env()

    # --- choose what to upload ---
    if flag == "--all":
        targets = games
    elif flag and not flag.startswith("-"):
        targets = [flag]
    else:
        if not games:
            print("No games found under games/.")
            return 1
        print("\nWhich game do you want to upload to forgeflowgames.com?\n")
        for i, g in enumerate(games, 1):
            print(f"  {i}. {g}")
        print(f"  a. ALL ({len(games)})")
        sel = input("\nEnter a number (or 'a' for all): ").strip().lower()
        if sel == "a":
            targets = games
        elif sel.isdigit() and 1 <= int(sel) <= len(games):
            targets = [games[int(sel) - 1]]
        else:
            print("Invalid selection.")
            return 1

    # --- deploy + verify ---
    results = []
    for slug in targets:
        print("\n" + "=" * 60)
        folder, note = resolve_deploy_dir(slug)
        if folder is None:
            print(f"  ✗ {slug}: NOT uploaded. {note}")
            results.append((slug, {"ok": False, "reason": note}))
            continue
        if note:
            print(f"  {slug}: {note}")
        res = dg.deploy_one(folder, slug)
        if res.get("ok"):
            live = dg.verify_live(slug)
            print("  live check: " + "  ".join(f"{k}={v}" for k, v in live.items()))
            res["live"] = live
        results.append((slug, res))

    print("\n" + "=" * 60 + "\nSUMMARY")
    allok = True
    for slug, res in results:
        if res.get("ok") and all(v == 200 for v in (res.get("live") or {}).values()):
            print(f"  ✓ {slug}  →  {res['url']}")
        else:
            allok = False
            why = res.get("reason") or ("live check not all 200: " + str(res.get("live")))
            print(f"  ✗ {slug}  — {why}")
    print("\nThey appear on https://forgeflowgames.com automatically (the portal reads Supabase).")
    return 0 if allok else 1


if __name__ == "__main__":
    sys.exit(main())
