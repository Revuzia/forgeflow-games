#!/usr/bin/env python3
"""
deploy_game.py — Upload a built game to Cloudflare R2 and insert metadata into Supabase.

⚠ LIVE SHARED UPLOADER — NOT Phaser legacy (audit L1, 2026-06-11). Despite its era, this module is
imported by deploy_engine_game.py, deploy_portal.py, engine_game_build.py and engine_game_emit.py.
Do not attic/delete it during legacy cleanups.

Usage:
  python pipeline/deploy_game.py --game-dir games/001-tropical-fury --slug tropical-fury

Flow:
  1. Upload all files in game-dir to R2 bucket forgeflow-games/{slug}/
  2. Insert or update game metadata in Supabase games table
  3. Set status to 'published'
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Windows consoles default to cp1252 and choke on wrangler's box-drawing / progress
# glyphs (e.g. ▲ U+25B2). Without this, printing a captured wrangler stderr raised
# UnicodeEncodeError and ABORTED the whole deploy mid-upload (~5 of ~890 files pushed).
# Reconfigure stdio to utf-8 with replacement so no log line is ever fatal. Setting
# PYTHONIOENCODING=utf-8 also works, but only when set BEFORE the interpreter starts;
# this fixes an already-running process too — incl. a bare `python pipeline/deploy_game.py`,
# which is exactly the path that used to crash. (Same idiom as upload_game.py.)
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def _safe_print(msg):
    """print() that never dies on un-encodable console output — belt-and-suspenders for
    the utf-8 reconfigure above (a caller may have swapped in a raw cp1252 stream after
    import). Used for any line that embeds captured subprocess stderr."""
    try:
        print(msg)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        print(msg.encode(enc, "replace").decode(enc, "replace"))


ROOT = Path(__file__).resolve().parent.parent
PIPELINE_DIR = ROOT / "pipeline"
NOMI = Path(os.path.expandvars("%APPDATA%")) / "Nomi"

R2_BUCKET = "forgeflow-games"
R2_PUBLIC_URL = "https://forgeflow-games.pages.dev"  # Will be updated once R2 custom domain is set


SECRETS_DIR = ROOT / ".secrets"


def _read_secret_file(name):
    p = SECRETS_DIR / name
    try:
        return p.read_text(encoding="utf-8").strip() if p.exists() else None
    except Exception:
        return None


def _read_api_config():
    try:
        return json.loads((NOMI / "api_config.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def resolve_cf_account_id():
    """env → repo .secrets/cf_account_id.txt → api_config (isimcha85)."""
    return (os.environ.get("CLOUDFLARE_ACCOUNT_ID")
            or _read_secret_file("cf_account_id.txt")
            or ((_read_api_config().get("providers", {}).get("cloudflare", {}) or {}).get("account_id_isimcha85")))


def resolve_cf_api_token():
    """env → repo .secrets/cf_api_token.txt → api_config providers.cloudflare.api_token.
    An R2-Edit API token (Option B) is the portable, no-interactive-OAuth path that
    works the same on any PC."""
    cfg = _read_api_config()
    return (os.environ.get("CLOUDFLARE_API_TOKEN")
            or _read_secret_file("cf_api_token.txt")
            or ((cfg.get("providers", {}).get("cloudflare", {}) or {}).get("api_token"))
            # existing config slot (a wrangler/user token granted R2 Edit works here too)
            or ((((cfg.get("cloudflare", {}) or {}).get("tokens", {}) or {}).get("isimcha85", {}) or {}).get("token")))


def ensure_cf_env():
    """Populate the env wrangler needs so a bare deploy 'just works' on any machine:
    utf-8 output (colored wrangler errors don't crash the print path on Windows),
    CLOUDFLARE_ACCOUNT_ID, and — if available — a CLOUDFLARE_API_TOKEN with R2 Edit
    (preferred over interactive `wrangler login`, which lacks R2 scope here)."""
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    acct = resolve_cf_account_id()
    if acct and not os.environ.get("CLOUDFLARE_ACCOUNT_ID"):
        os.environ["CLOUDFLARE_ACCOUNT_ID"] = acct
        print(f"[cf] CLOUDFLARE_ACCOUNT_ID set (…{acct[-4:]})")
    token = resolve_cf_api_token()
    if token and not os.environ.get("CLOUDFLARE_API_TOKEN"):
        os.environ["CLOUDFLARE_API_TOKEN"] = token
        print("[cf] CLOUDFLARE_API_TOKEN loaded (R2 Edit) — using API token auth")
    elif not token:
        print("[cf] No API token found — wrangler will use its OAuth login (may lack R2 scope).")

# Load Supabase credentials for the forgeflow-games project
def load_supabase_creds():
    env_path = ROOT / ".env"
    creds = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                creds[k.strip()] = v.strip()
    return creds


# If any of these fail to upload the game is broken — the deploy must exit non-zero and
# NOT touch Supabase (else the portal points at a half-uploaded/broken game).
CRITICAL_FILES = {"index.html", "game_meta.json"}


def upload_to_r2(game_dir: Path, slug: str, force: bool = False) -> dict:
    """Upload files in game_dir to R2 under {slug}/.

    Returns {"uploaded": int, "failed": [{"key", "err"}], "critical_failed": [key, ...]}.

    2026-06-22 ROBUSTNESS FIX (forgeflowgames.com was stale all session): a single
    `npx wrangler r2 object put` can exceed 30s (npx cold-start + a multi-MB GLB), and
    the old code passed timeout=30 with NO try/except — so the FIRST slow file raised
    TimeoutExpired and crashed the whole deploy after ~2 files. Now: timeout=150 + the
    call is wrapped (a slow/failed file is skipped, never fatal). Plus a HEAD skip so big
    static assets that already live on the CDN aren't re-uploaded every deploy (only the
    code files change) — that keeps deploys to a handful of seconds. `force` re-uploads all.

    2026-06-30 ROBUSTNESS FIX: a failed upload's captured wrangler stderr can contain a
    non-cp1252 glyph (e.g. ▲), and printing it on a Windows cp1252 console raised
    UnicodeEncodeError — which used to ABORT the whole deploy mid-loop (~5 of ~890 files up).
    The module-level utf-8 reconfigure + _safe_print now make that print un-crashable, and
    failures are collected and summarised at the end instead of aborting on the first one."""
    count = 0
    failures = []              # [{"key": r2_key, "err": "..."}]
    ALWAYS = {"index.html", "game_meta.json", "content.json"}   # code/metadata: always re-push
    # 2026-07-02 INCREMENTAL MODE: a local manifest (state/r2_manifest_{slug}.json) records what we
    # have successfully uploaded (md5 per key). New/changed assets upload WITHOUT --force (the CDN
    # worker returns 200 "not found" bodies for missing keys, so remote probing is unreliable, and
    # --force re-uploads everything via one npx cold-start per file = 1-2h). --seed-manifest records
    # the current local tree as already-uploaded (baseline after a verified-synced state).
    import hashlib as _hl2, json as _json2
    _man_path = Path('C:\\Users\\TestRun\\Claude Claw\\state') / f"r2_manifest_{slug}.json"
    try:
        _manifest = _json2.loads(_man_path.read_text(encoding="utf-8")) if _man_path.exists() else {}
    except Exception:
        _manifest = {}
    def _md5(fp):
        h = _hl2.md5()
        with open(fp, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    def _save_manifest():
        try:
            _man_path.write_text(_json2.dumps(_manifest, indent=0), encoding="utf-8")
        except Exception as e:
            print(f"  [r2] manifest save failed (non-fatal): {e}")
    for file_path in game_dir.rglob("*"):
        if file_path.is_dir():
            continue
        relative = file_path.relative_to(game_dir)
        r2_key = f"{slug}/{relative.as_posix()}"
        # skip immutable assets already on the CDN unless forced. NOTE: the CDN worker
        # does NOT answer HEAD (returns non-200) -> use a GET and read only the status
        # line (the body never streams since we don't .read()), which is what actually works.
        # By DEFAULT push only the code/metadata files (they change every deploy); static assets
        # rarely change and a full re-upload of a big folder times out. Use --force to re-push
        # everything (first-ever deploy of a game, or when you actually changed assets). We do NOT
        # probe the CDN per-file: the worker returns inconsistent 404/5xx under rapid GETs, which
        # made the old skip-check re-upload everything anyway.
        _h = None
        if relative.name not in ALWAYS and not force:
            _h = _md5(file_path)
            if _manifest.get(r2_key) == _h:
                continue                      # unchanged + already uploaded -> skip
            # new or changed asset -> fall through and upload (manifest updated on success)
        # 2026-05-05 — wrangler 4.x needs --remote or it writes to a LOCAL sandbox and the worker serves stale content.
        cmd = f'npx wrangler r2 object put "{R2_BUCKET}/{r2_key}" --file="{file_path}" --remote'
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=150
            )
        except subprocess.TimeoutExpired:
            print(f"  [r2] TIMEOUT (skipped, not fatal): {r2_key}")
            failures.append({"key": r2_key, "err": "timeout after 150s"})
            continue
        if result.returncode == 0:
            count += 1
            _manifest[r2_key] = _h if _h is not None else _md5(file_path)
            print(f"  [r2] Uploaded: {r2_key}")
        else:
            err = (result.stderr or "").strip()
            _safe_print(f"  [r2] FAILED: {r2_key} -- {err[:100]}")
            failures.append({"key": r2_key, "err": err})

    _save_manifest()
    # A single failed file is never fatal here — collect + summarise, and let the caller
    # decide (0 uploaded, or a CRITICAL file failed -> skip Supabase and exit non-zero).
    critical_failed = [f["key"] for f in failures if Path(f["key"]).name in CRITICAL_FILES]
    if failures:
        _safe_print(f"  [r2] {len(failures)} file(s) failed to upload:")
        for f in failures:
            _safe_print(f"        - {f['key']}: {(f['err'] or '')[:120]}")
    return {"uploaded": count, "failed": failures, "critical_failed": critical_failed}


def insert_game_metadata(slug: str, metadata: dict):
    """Insert or upsert game metadata into Supabase games table.

    Publish state (games.status) is owned by the portal toggle
    (admin-game-publish), NOT by deploys — so this never flips a game's
    published state: an existing game keeps whatever status the toggle set,
    and a brand-new game lands as 'unpublished' for the owner to publish
    manually. Pass metadata['status'] to force a specific status."""
    creds = load_supabase_creds()
    # 2026-07-07 RLS lockdown (supabase/migrations/0005_registry_service_writes.sql):
    # public.games only accepts writes from service_role — the anon write
    # policies were a public defacement hole. The service key is a SECRET:
    # never a VITE_ var (Vite bakes those into the public bundle). Resolution:
    # FFG_SERVICE_ROLE_KEY env -> api_config.json providers.supabase_forgeflow.
    ffg = ((_read_api_config().get("providers", {}) or {}).get("supabase_forgeflow", {}) or {})
    supa_url = creds.get("VITE_SUPABASE_URL", "") or ffg.get("url", "")
    supa_key = os.environ.get("FFG_SERVICE_ROLE_KEY") or ffg.get("service_role_key", "")

    if not supa_url or not supa_key:
        print("[supabase] Missing FFG service credentials — set providers.supabase_forgeflow"
              ".service_role_key in api_config.json (games-table writes are service_role-only"
              " since the 2026-07-07 RLS lockdown)")
        return False

    # Check if game already exists
    check_url = f"{supa_url}/rest/v1/games?slug=eq.{slug}&select=id"
    req = urllib.request.Request(check_url, headers={
        "apikey": supa_key,
        "Authorization": f"Bearer {supa_key}",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        existing = json.loads(resp.read())
    except Exception as e:
        print(f"[supabase] Check failed: {e}")
        existing = []

    # Build the row. 2026-05-05: hero_image_url added so the game-detail page
    # gets a key-art image too (was previously null → empty banner).
    row = {
        "slug": slug,
        "title": metadata.get("title", slug.replace("-", " ").title()),
        "description": metadata.get("description", ""),
        "short_description": metadata.get("short_description", ""),
        "genre": metadata.get("genre", "platformer"),
        "sub_genre": metadata.get("sub_genre", ""),
        "thumbnail_url": metadata.get("thumbnail_url", ""),
        "hero_image_url": metadata.get("hero_image_url", metadata.get("thumbnail_url", "")),
        "game_url": metadata.get("game_url", f"https://forgeflow-games-cdn.isimcha85.workers.dev/{slug}/index.html"),
        "controls_keyboard": metadata.get("controls_keyboard", ""),
        "controls_gamepad": metadata.get("controls_gamepad", ""),
        "difficulty": metadata.get("difficulty", "medium"),
        "tags": metadata.get("tags", []),
    }

    # Publish control = the portal toggle, not the deploy. Preserve published
    # state across deploys so a bug-fix re-deploy never silently re-publishes a
    # game the owner toggled off:
    #   • existing game  -> omit `status` from the PATCH (keep the toggle's value)
    #   • brand-new game -> 'unpublished' (owner publishes manually via toggle)
    # An explicit metadata['status'] still wins for callers that mean it.
    explicit_status = metadata.get("status")
    if explicit_status:
        row["status"] = explicit_status
    elif not existing:
        row["status"] = "unpublished"

    if existing:
        # Update existing
        url = f"{supa_url}/rest/v1/games?slug=eq.{slug}"
        data = json.dumps(row).encode()
        req = urllib.request.Request(url, data=data, method="PATCH", headers={
            "apikey": supa_key,
            "Authorization": f"Bearer {supa_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        })
    else:
        # Insert new
        url = f"{supa_url}/rest/v1/games"
        data = json.dumps(row).encode()
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "apikey": supa_key,
            "Authorization": f"Bearer {supa_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        })

    try:
        urllib.request.urlopen(req, timeout=10)
        action = "Updated" if existing else "Inserted"
        print(f"[supabase] {action} game: {row['title']} ({slug})")
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[supabase] Error {e.code}: {body[:200]}")
        return False


CDN_BASE = "https://forgeflow-games-cdn.isimcha85.workers.dev"


def verify_live(slug, files=("index.html", "thumbnail.png", "content.json")):
    """GET key files from the CDN and report their HTTP status. Returns a dict."""
    out = {}
    for f in files:
        url = f"{CDN_BASE}/{slug}/{f}"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=15) as r:
                out[f] = r.status
        except urllib.error.HTTPError as e:
            out[f] = e.code
        except Exception as e:
            out[f] = f"ERR {e}"
    return out


def deploy_one(game_dir, slug, metadata_path=None, dry_run=False, force=False):
    """Deploy a single game: optional cover-gen, R2 upload, Supabase upsert.
    Returns {ok, uploaded, total, url}. Reused by deploy_game.main + upload_game.py."""
    game_dir = Path(game_dir)
    if not game_dir.exists():
        print(f"Error: {game_dir} does not exist")
        return {"ok": False, "uploaded": 0, "total": 0, "url": None, "reason": "missing dir"}

    metadata = {}
    if metadata_path:
        metadata = json.loads(Path(metadata_path).read_text(encoding="utf-8"))
    elif (game_dir / "game_meta.json").exists():
        metadata = json.loads((game_dir / "game_meta.json").read_text(encoding="utf-8"))

    total = sum(1 for _ in game_dir.rglob("*") if _.is_file())
    print(f"Deploying game: {slug}\n  Source: {game_dir}\n  Files: {total}")
    if dry_run:
        print("[dry-run] Would upload to R2 and upsert Supabase")
        return {"ok": True, "uploaded": 0, "total": total, "url": f"{CDN_BASE}/{slug}/index.html", "dry": True}

    # Cover: keep an existing thumbnail.png; otherwise try to generate one (xAI).
    thumb_path = game_dir / "thumbnail.png"
    if not thumb_path.exists():
        try:
            from generate_cover import generate_cover  # type: ignore
            description = metadata.get("description") or metadata.get("short_description") or slug
            art_direction = metadata.get("art_direction", "")
            if not art_direction:
                design_path = game_dir / "design.json"
                if design_path.exists():
                    try:
                        design = json.loads(design_path.read_text(encoding="utf-8"))
                        art_direction = design.get("art_direction", "") or design.get("art_style", "")
                    except Exception:
                        pass
            if not art_direction:
                art_direction = "Polished, vibrant indie game art with strong silhouette and dramatic lighting."
            title = metadata.get("title", slug.replace("-", " ").title())
            generate_cover(slug=slug, title=title, description=description, art_direction=art_direction, out_dir=game_dir)
        except Exception as e:
            print(f"[cover] WARN: cover generation failed ({e}); proceeding without cover")

    up = upload_to_r2(game_dir, slug, force=force)
    uploaded = up["uploaded"]
    critical_failed = up["critical_failed"]
    print(f"  [r2] {uploaded}/{total} files uploaded to {R2_BUCKET}/{slug}/")
    if uploaded == 0:
        print("  [r2] ERROR: 0 files uploaded — R2 auth/network failed. Skipping Supabase so the")
        print("       portal isn't left pointing at missing files. Fix the R2 token, then re-run.")
        return {"ok": False, "uploaded": 0, "total": total, "url": None, "reason": "r2 upload failed"}
    if critical_failed:
        # index.html / game_meta.json didn't make it — the game would be broken. Don't upsert
        # Supabase; surface a non-zero result so the caller (and Task Scheduler) sees the failure.
        joined = ", ".join(critical_failed)
        print(f"  [r2] ERROR: critical file(s) failed to upload: {joined}. Skipping Supabase so the")
        print("       portal isn't left pointing at a broken game. Re-run (add --force) to retry.")
        return {"ok": False, "uploaded": uploaded, "total": total, "url": None,
                "reason": f"critical file upload failed: {joined}"}

    metadata["game_url"] = f"{CDN_BASE}/{slug}/index.html"
    _tv = ""
    if thumb_path.exists():
        import hashlib as _hl
        _tv = "?v=" + _hl.md5(thumb_path.read_bytes()).hexdigest()[:8]   # cache-bust: the URL changes ONLY when the image bytes change, so browsers fetch a new cover instantly (the CDN sends max-age=86400, which otherwise pins the old cover for 24h)
    if thumb_path.exists() and not metadata.get("thumbnail_url"):
        metadata["thumbnail_url"] = f"{CDN_BASE}/{slug}/thumbnail.png{_tv}"
    if thumb_path.exists() and not metadata.get("hero_image_url"):
        metadata["hero_image_url"] = f"{CDN_BASE}/{slug}/thumbnail.png{_tv}"
    insert_game_metadata(slug, metadata)
    print(f"Done! Game available at: {CDN_BASE}/{slug}/index.html")
    # ok = the code/metadata files went up (assets are skipped by default now, so uploaded<total is normal & fine).
    return {"ok": uploaded > 0, "uploaded": uploaded, "total": total, "url": f"{CDN_BASE}/{slug}/index.html"}


def main():
    parser = argparse.ArgumentParser(description="Deploy a game to R2 + Supabase")
    parser.add_argument("--game-dir", required=True, help="Path to built game directory")
    parser.add_argument("--slug", required=True, help="URL slug for the game")
    parser.add_argument("--metadata", help="Path to game metadata JSON file")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="re-upload ALL files incl. static assets — rarely needed now: default incremental mode uploads new/changed assets via the local manifest")
    parser.add_argument("--seed-manifest", action="store_true", help="record the current local tree as already-uploaded (no uploads) — run once after a verified-synced state")
    args = parser.parse_args()
    if getattr(args, "seed_manifest", False):
        import hashlib as _shl, json as _sjson
        gd = Path(args.game_dir).resolve()
        man_path = Path('C:\\Users\\TestRun\\Claude Claw\\state') / f"r2_manifest_{args.slug}.json"
        man = {}
        for fp in gd.rglob("*"):
            if fp.is_dir():
                continue
            h = _shl.md5()
            with open(fp, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            man[f"{args.slug}/{fp.relative_to(gd).as_posix()}"] = h.hexdigest()
        man_path.write_text(_sjson.dumps(man, indent=0), encoding="utf-8")
        print(f"[seed] recorded {len(man)} files into {man_path}")
        raise SystemExit(0)
    ensure_cf_env()
    res = deploy_one(args.game_dir, args.slug, metadata_path=args.metadata, dry_run=args.dry_run, force=args.force)
    sys.exit(0 if res.get("ok") or res.get("dry") else 1)


if __name__ == "__main__":
    main()
