#!/usr/bin/env python3
"""
deploy_game.py — Upload a built game to Cloudflare R2 and insert metadata into Supabase.

⚠ LIVE SHARED UPLOADER — NOT Phaser legacy (audit L1, 2026-06-11). Despite its era, this module is
imported by deploy_engine_game.py, deploy_portal.py, engine_game_build.py and engine_game_emit.py.
Do not attic/delete it during legacy cleanups.

Usage:
  python pipeline/deploy_game.py --game-dir games/001-tropical-fury --slug tropical-fury

Flow:
  0. Refuse a SOURCE folder: a root index.html that loads a TypeScript module, or a vite.config.*
     with no root index.html (a Vite game's own folder), is not deployable. Build it (`npm run build`)
     and pass --game-dir <game>/dist.
  1. Upload new/changed files in game-dir to R2 bucket forgeflow-games/{slug}/ — every
     other file first, then the root index.html, then the root game_meta.json LAST. A
     critical failure (for an unhashed game: any runtime/**/*.js) aborts before
     index.html and exits non-zero. `--dry-run` prints this order without uploading.
  2. Purge the CDN cache for the uploaded keys
  3. Insert or update game metadata in Supabase games table (stamps build_version +
     updated_at; never changes an existing game's publish status unless --status)
  4. Refresh the portal prerender
"""
import argparse
import json
import os
import re
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

# Directories inside a game folder that are development-only and must never be
# uploaded to the public CDN. Matched against the FIRST path segment, so a
# legitimate runtime path like "assets/tools_ui.png" is unaffected.
DEV_ONLY_DIRS = {
    "tools", "_src", "__pycache__", ".git", ".grok",
    # Verification/authoring trees added by the hand-built games (ascendant,
    # driftwake, …). `_shots` alone is 352 MB of PNG evidence in ascendant, and
    # `_harness` is our Playwright gate suite — neither belongs on a public CDN,
    # and `_spec` is the internal module contract.
    "_harness", "_shots", "_spec", "_tools", "_wip", "_attic", "_turntable", "_manifest", "_work",
    ".playwright-mcp", ".grokui-inbox",
    # Found shipping publicly 2026-09-14: last-circle was serving AAA_ROADMAP.md,
    # AGENTS.md, AUDIT_16LENS.md and BENCHMARK_SCORECARD.md off the CDN, and two
    # games were uploading their whole node_modules.
    "node_modules", "_reports", "_design", "docs", "tests", ".vscode", ".github",
}
# Individual dev artefacts that can sit at a game's root.
DEV_ONLY_NAMES = {
    ".gitignore", ".DS_Store", "Thumbs.db",
    "package.json", "package-lock.json", "tsconfig.json", "requirements.txt",
    "Makefile", ".npmrc", ".env", ".env.local", ".editorconfig",
}

# Internal prose and scripts. A game is HTML/JS/CSS/assets — none of this is
# fetched at runtime (verified by grepping every game for a fetch/import/src of
# a .md), so publishing it only exposes our notes. `.txt` is deliberately NOT
# here: assets/props/CREDITS.txt and friends are asset ATTRIBUTION and shipping
# them is a licence obligation.
DEV_ONLY_DOC_SUFFIXES = {
    ".md", ".py", ".sh", ".ps1", ".bat", ".sql", ".log",
    ".yml", ".yaml", ".toml", ".ini", ".pyc",
}
# ...but a licence or attribution file keeps its right to ship whatever its
# extension. Matched on the STEM, so LICENSE.md and NOTICE.md still go out.
LEGAL_STEMS = {"license", "licence", "notice", "credits", "attribution", "copyright", "third_party", "third-party"}
# Backup suffixes left by asset-migration passes (e.g. *.pre_draco.bak,
# *.pre_mixamo.bak, *.openhands.bak) — never ship these to the CDN.
DEV_ONLY_SUFFIXES = {".bak"}


def _is_dev_only(relative):
    """True if this game-relative path is a dev artefact, not a shipped file."""
    if relative.suffix.lower() in DEV_ONLY_SUFFIXES:
        return True
    if (relative.suffix.lower() in DEV_ONLY_DOC_SUFFIXES
            and relative.stem.lower() not in LEGAL_STEMS):
        return True
    parts = relative.parts
    if parts and parts[0] in DEV_ONLY_DIRS:
        return True
    if any(p == "__pycache__" for p in parts):
        return True
    # Node selftests (foo.selftest.cjs / .js / .mjs) sit beside the sim modules they test,
    # inside runtime/, so the directory rule above never caught them and every one shipped
    # to the public CDN (14 files across 6 games on 2026-10-01). No game imports one at
    # runtime (checked: no import/require/fetch of a *.selftest.* path in any shipped tree).
    if ".selftest." in relative.name.lower():
        return True
    return relative.name in DEV_ONLY_NAMES


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

# UPLOAD ORDER — fixed 2026-09-30 (Last Circle improve plan, lane L11). The old single
# rglob loop reached the ROOT index.html early (it sorts before runtime/), so for the
# whole upload a live player could load the NEW index.html (new ?v= tags) against OLD
# module bytes, or a missing module if a later upload failed: the "mixed-module window".
# The entry page is now the commit point: every other file goes up first, then the root
# index.html, then the root game_meta.json LAST. Root-level only; a nested index.html is
# an ordinary file (still critical by name, as before).
DEFERRED_ROOT_FILES = ("index.html", "game_meta.json")   # uploaded last, in this order

# Games WITHOUT a hashed build import stable filenames (runtime/3d/foo.js?v=N) and the
# CDN worker ignores query strings, so a failed runtime/**/*.js upload means the new
# index.html would run against a stale or missing module. Those failures are critical:
# the deploy aborts BEFORE index.html (the live game keeps its previous, consistent
# entry page) and exits non-zero. A hashed build (Vite: assets/index-<8-char hash>.js)
# has no runtime/ tree, so the rule does not apply to it.
CRITICAL_UNHASHED_JS_DIRS = ("runtime",)
_CRITICAL_JS_SUFFIXES = (".js", ".mjs")
# Rollup/Vite `[name]-[hash]` — 8 base64url chars, which may themselves contain '-'
# (ironwake ships assets/index-EbddUdy-.js).
_HASHED_JS_NAME = re.compile(r"-([A-Za-z0-9_-]{8})\.m?js$")

# The manifest of what is already on R2 (incremental mode, see upload_to_r2). A module
# constant so tests point it at a scratch dir — a fake uploader must NEVER write the live
# manifest, or the next real deploy would skip files that were never uploaded.
R2_MANIFEST_DIR = Path('C:\\Users\\TestRun\\Claude Claw\\state')
R2_PUT_TIMEOUT_S = 150


def _manifest_path(slug):
    return Path(R2_MANIFEST_DIR) / f"r2_manifest_{slug}.json"


def _load_manifest(slug):
    p = _manifest_path(slug)
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    except Exception:
        return {}


def _md5_file(fp):
    import hashlib
    h = hashlib.md5()
    with open(fp, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _entry_script_refs(game_dir):
    """Local <script src> and <link rel=modulepreload href> refs of the ROOT index.html
    (absolute http(s):, protocol-relative // and data: refs are dropped)."""
    try:
        html = (Path(game_dir) / "index.html").read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []
    refs = re.findall(r"""<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']""", html, re.I)
    refs += re.findall(r"""<link\b(?=[^>]*\brel\s*=\s*["']modulepreload["'])[^>]*?\bhref\s*=\s*["']([^"']+)["']""",
                       html, re.I)
    return [r for r in refs if not re.match(r"^(?:[a-z][a-z0-9+.-]*:|//)", r, re.I)]


# SOURCE-FOLDER GUARD (2026-10-05, WOBBLEHOARD audit). A Vite game's folder (blocktooth, wobblehoard) has a root
# index.html that loads TypeScript straight from src/ (`<script type="module" src="./src/main.ts">`), which only the Vite
# dev server can run. Uploaded as-is, the CDN serves main.ts with no JavaScript MIME type and bare imports ('three')
# cannot resolve, so the page never starts, and every source file under src/ ships publicly. The deployable thing is the
# build output (`npm run build` -> <game>/dist). No browser runs TypeScript, so a root entry that loads a .ts module is
# never deployable: refuse it and print the right command. Same for a Vite project whose web root is a SUBFOLDER
# (dyefield, hit-parade: vite.config.ts at the game root, index.html in runtime/): with no root index.html it is not a
# game at all, and uploading it would publish runtime/src/** and PATCH the live portal row with default metadata
# (its game_meta.json sits in runtime/public/). A folder that HAS a root index.html loading built JS (neon-veil ships
# its prebuilt bundle beside a vite.config.ts) is not affected.
_SOURCE_MODULE_SUFFIXES = (".ts", ".tsx", ".mts", ".cts")
_VITE_CONFIG_NAMES = ("vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts", "vite.config.cjs", "vite.config.cts")


def source_entry_refs(game_dir):
    """Local <script src> / modulepreload refs of the ROOT index.html that point at a TypeScript source module."""
    out = []
    for ref in _entry_script_refs(game_dir):
        path = ref.split("#", 1)[0].split("?", 1)[0]
        if path.lower().endswith(_SOURCE_MODULE_SUFFIXES):
            out.append(ref)
    return out


def source_folder_refusal(game_dir, slug):
    """None if game_dir is deployable; otherwise the message explaining why not and what to run instead."""
    gd = Path(game_dir)
    refs = source_entry_refs(gd)
    vite_cfg = next((n for n in _VITE_CONFIG_NAMES if (gd / n).is_file()), None)
    if refs:
        why = f"index.html loads {refs[0]}, so this is a source folder (Vite), not a build"
    elif vite_cfg and not (gd / "index.html").exists():
        why = f"{vite_cfg} with no index.html at the root, so this is a Vite source project (web root in a subfolder), not a build"
    else:
        return None
    game_dir = gd.resolve()
    try:
        rel = game_dir.relative_to(ROOT).as_posix()
    except ValueError:
        rel = game_dir.as_posix()
    back = "/".join(".." for _ in Path(rel).parts) if not Path(rel).is_absolute() else str(ROOT)
    return (f"REFUSED: {rel}/{why}.\n"
            f"  Uploaded as-is the game would not start (no browser runs TypeScript) and the source tree would be published.\n"
            f"  Build it, then deploy the build output (run from the repo root):\n"
            f"    cd {rel} && npm ci && npm run build && cd {back}\n"
            f"    python pipeline/deploy_game.py --game-dir {rel}/dist --slug {slug} --dry-run   # check the upload plan\n"
            f"    python pipeline/deploy_game.py --game-dir {rel}/dist --slug {slug}")


def detect_hashed_build(game_dir):
    """(hashed, evidence_ref). Hashed = the root index.html loads at least one local script
    whose filename carries a content hash (name-XXXXXXXX.js). An all-lowercase 8-letter
    tail ('my-renderer.js') is a word, not a hash. A missing or unreadable index.html
    counts as UNHASHED, which is the stricter mode."""
    for ref in _entry_script_refs(game_dir):
        name = ref.split("#", 1)[0].split("?", 1)[0].rsplit("/", 1)[-1]
        m = _HASHED_JS_NAME.search(name)
        if m and not m.group(1).islower():
            return True, ref
    return False, ""


def _is_critical(relative, hashed):
    """A failed upload of this file must stop the deploy before the entry page goes up."""
    if relative.name in CRITICAL_FILES:
        return True
    parts = relative.parts
    if hashed or relative.suffix.lower() not in _CRITICAL_JS_SUFFIXES:
        return False
    if len(parts) > 1 and parts[0] in CRITICAL_UNHASHED_JS_DIRS:
        return True
    # A VENDORED library (assets/vendor/three/...) is as load-bearing as runtime/: last-circle
    # serves three r172 from there so a jsdelivr outage cannot stop it, which means a failed
    # three.module.js upload would put up an index.html whose importmap points at nothing.
    return len(parts) > 2 and parts[0] == "assets" and parts[1] == "vendor"


def plan_uploads(game_dir, slug, force=False, manifest=None):
    """Decide WHAT uploads and in WHICH ORDER. No network, no writes. The real upload and
    --dry-run both use it, so a dry-run prints exactly the order a deploy would follow.

    Returns {"items": [{"path", "relative", "key", "md5", "critical", "phase"}, ...],
    "skipped_dev", "unchanged", "hashed", "hashed_evidence"}. phase is "body" (every
    other file, rglob order as before), then "entry" (root index.html), then "meta"
    (root game_meta.json, always LAST)."""
    game_dir = Path(game_dir)
    manifest = {} if manifest is None else manifest
    hashed, evidence = detect_hashed_build(game_dir)
    ALWAYS = {"index.html", "game_meta.json", "content.json"}   # code/metadata: always re-push
    body, deferred = [], {}
    skipped_dev = unchanged = 0
    for file_path in game_dir.rglob("*"):
        if file_path.is_dir():
            continue
        relative = file_path.relative_to(game_dir)
        # Dev-only trees never belong on a public CDN. `tools/` holds build
        # scripts, generator state and screenshot dumps — colosseum's alone is
        # ~40 MB of PNGs, which would more than double its transfer and ship
        # our asset-generation scripts to anyone who guesses the URL.
        if _is_dev_only(relative):
            skipped_dev += 1
            continue
        r2_key = f"{slug}/{relative.as_posix()}"
        # By DEFAULT push only the code/metadata files (they change every deploy) plus
        # new/changed assets per the manifest; static assets rarely change and a full
        # re-upload of a big folder times out. Use --force to re-push everything (first-ever
        # deploy of a game, or when you actually changed assets). We do NOT probe the CDN
        # per-file: the worker returns inconsistent 404/5xx under rapid GETs (and does not
        # answer HEAD), which made the old skip-check re-upload everything anyway.
        _h = None
        if relative.name not in ALWAYS and not force:
            _h = _md5_file(file_path)
            if manifest.get(r2_key) == _h:
                unchanged += 1
                continue                      # unchanged + already uploaded -> skip
            # new or changed asset -> upload (manifest updated on success)
        item = {"path": file_path, "relative": relative, "key": r2_key, "md5": _h,
                "critical": _is_critical(relative, hashed), "phase": "body"}
        if len(relative.parts) == 1 and relative.name in DEFERRED_ROOT_FILES:
            item["phase"] = "entry" if relative.name == "index.html" else "meta"
            deferred[relative.name] = item
        else:
            body.append(item)
    items = body + [deferred[n] for n in DEFERRED_ROOT_FILES if n in deferred]
    return {"items": items, "skipped_dev": skipped_dev, "unchanged": unchanged,
            "hashed": hashed, "hashed_evidence": evidence}


def print_upload_plan(game_dir, slug, force=False):
    """--dry-run: print the upload order a real deploy would use. Reads the manifest,
    writes nothing, calls nothing remote."""
    plan = plan_uploads(game_dir, slug, force=force, manifest=_load_manifest(slug))
    if plan["hashed"]:
        mode = (f"hashed build (entry {plan['hashed_evidence']}): the runtime/**/*.js "
                f"critical rule does not apply")
    else:
        mode = ("unhashed build: a failed runtime/**/*.js upload is CRITICAL and aborts "
                "the deploy before index.html")
    _safe_print(f"[dry-run] Upload order for {slug} ({mode}):")
    items = plan["items"]
    for i, it in enumerate(items, 1):
        tag = "  [critical]" if it["critical"] else ""
        _safe_print(f"  [plan] {i:03d} {it['phase']:<5} {it['key']}{tag}")
    tail = [it["relative"].as_posix() for it in items if it["phase"] != "body"]
    _safe_print(f"[dry-run] {len(items)} file(s) would upload; last: {' then '.join(tail) or '(no root index.html)'}; "
                f"{plan['unchanged']} unchanged vs manifest skipped; {plan['skipped_dev']} dev-only withheld; "
                f"{sum(1 for it in items if it['critical'])} critical")
    return plan


def _r2_put(r2_key, file_path):
    """Upload ONE file to R2 via wrangler. Returns (ok, err). Every upload goes through
    this single seam, so tests monkeypatch it and never touch R2."""
    # 2026-05-05 — wrangler 4.x needs --remote or it writes to a LOCAL sandbox and the worker serves stale content.
    cmd = f'npx wrangler r2 object put "{R2_BUCKET}/{r2_key}" --file="{file_path}" --remote'
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=R2_PUT_TIMEOUT_S
        )
    except subprocess.TimeoutExpired:
        return False, f"timeout after {R2_PUT_TIMEOUT_S}s"
    if result.returncode == 0:
        return True, ""
    return False, (result.stderr or "").strip()


def upload_to_r2(game_dir: Path, slug: str, force: bool = False) -> dict:
    """Upload files in game_dir to R2 under {slug}/.

    Returns {"uploaded": int, "failed": [{"key", "err", "critical"}], "critical_failed": [key, ...],
    "uploaded_keys", "skipped_dev", "withheld": [keys NOT uploaded by the critical gate], "hashed"}.

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
    failures are collected and summarised at the end instead of aborting on the first one.

    2026-09-30 ORDER + CRITICAL GATE (Last Circle improve plan, lane L11): uploads follow
    plan_uploads() — every other file first, then the root index.html, then the root
    game_meta.json LAST. If any CRITICAL file failed before the entry page (for an unhashed
    game that includes every runtime/**/*.js), index.html and game_meta.json are WITHHELD:
    the live game keeps its previous, consistent entry page, and the caller exits non-zero.
    A failed index.html also withholds game_meta.json. Non-critical failures (an asset)
    still never block, exactly as before."""
    count = 0
    failures = []              # [{"key": r2_key, "err": "...", "critical": bool}]
    uploaded_keys = []         # r2 keys actually pushed this run — for a targeted cache purge
    withheld = []              # entry/meta keys deliberately NOT uploaded (critical gate)
    # 2026-07-02 INCREMENTAL MODE: a local manifest (state/r2_manifest_{slug}.json) records what we
    # have successfully uploaded (md5 per key). New/changed assets upload WITHOUT --force (the CDN
    # worker returns 200 "not found" bodies for missing keys, so remote probing is unreliable, and
    # --force re-uploads everything via one npx cold-start per file = 1-2h). --seed-manifest records
    # the current local tree as already-uploaded (baseline after a verified-synced state).
    _man_path = _manifest_path(slug)
    _manifest = _load_manifest(slug)

    def _save_manifest():
        try:
            _man_path.write_text(json.dumps(_manifest, indent=0), encoding="utf-8")
        except Exception as e:
            print(f"  [r2] manifest save failed (non-fatal): {e}")

    plan = plan_uploads(game_dir, slug, force=force, manifest=_manifest)
    skipped_dev = plan["skipped_dev"]   # dev-only files never offered to the CDN (see _is_dev_only)

    def _put(item):
        nonlocal count
        ok, err = _r2_put(item["key"], item["path"])
        err = err or ""
        if ok:
            count += 1
            uploaded_keys.append(item["key"])
            _manifest[item["key"]] = item["md5"] if item["md5"] is not None else _md5_file(item["path"])
            print(f"  [r2] Uploaded: {item['key']}")
            return True
        crit = " (CRITICAL)" if item["critical"] else ""
        if err.startswith("timeout after"):
            _safe_print(f"  [r2] TIMEOUT{crit}: {item['key']} -- {err}")
        else:
            _safe_print(f"  [r2] FAILED{crit}: {item['key']} -- {err[:100]}")
        failures.append({"key": item["key"], "err": err, "critical": bool(item["critical"])})
        return False

    blocked_by = []            # critical keys that failed before the entry page
    for item in plan["items"]:
        if item["phase"] == "body":
            _put(item)
            continue
        # entry (root index.html), then meta (root game_meta.json): the commit point.
        if not blocked_by:
            blocked_by = [f["key"] for f in failures if f["critical"]]
        if blocked_by:
            withheld.append(item["key"])
            continue
        if not _put(item) and item["phase"] == "entry":
            blocked_by = [item["key"]]

    _save_manifest()
    # Say what was withheld. A silent skip reads as "everything shipped".
    if skipped_dev:
        _safe_print(f"  [r2] {skipped_dev} dev-only file(s) withheld from the CDN "
                    f"({'/'.join(sorted(DEV_ONLY_DIRS))})")
    if withheld:
        _safe_print(f"  [r2] ABORTED before the entry page: critical upload failed ({', '.join(blocked_by)}).")
        _safe_print(f"       Withheld, NOT uploaded: {', '.join(withheld)} — the live game keeps its previous entry page.")
    # A non-critical failed file is never fatal here — collect + summarise, and let the caller
    # decide (0 uploaded, or a CRITICAL file failed -> skip Supabase and exit non-zero).
    critical_failed = [f["key"] for f in failures if f["critical"]]
    if failures:
        _safe_print(f"  [r2] {len(failures)} file(s) failed to upload:")
        for f in failures:
            _safe_print(f"        - {f['key']}{' [critical]' if f['critical'] else ''}: {(f['err'] or '')[:120]}")
    return {"uploaded": count, "failed": failures, "critical_failed": critical_failed,
            "uploaded_keys": uploaded_keys, "skipped_dev": skipped_dev, "withheld": withheld,
            "hashed": plan["hashed"]}


def _cf_purge_token():
    """A token with Zone.Cache-Purge permission — SEPARATE from the R2-Edit deploy token,
    which cannot purge. env CF_PURGE_TOKEN → .secrets/cf_purge_token.txt → api_config
    providers.cloudflare.purge_token. Returns None if none configured."""
    import os
    if os.environ.get("CF_PURGE_TOKEN"):
        return os.environ["CF_PURGE_TOKEN"].strip()
    p = Path(__file__).resolve().parent.parent / ".secrets" / "cf_purge_token.txt"
    if p.exists():
        t = p.read_text(encoding="utf-8").strip()
        if t:
            return t
    cf = (_read_api_config().get("providers", {}).get("cloudflare", {}) or {})
    return cf.get("purge_token")


FORGEFLOWGAMES_ZONE_ID = "949db249da898ce7ceb3edb1fbeac2b1"


def purge_cf_cache(uploaded_keys, host="forgeflowgames.com"):
    """Purge the CDN cache for the files just uploaded so a deploy is visible immediately.
    Ashwall (and any unbundled game with stable module filenames) otherwise serves stale JS
    for ~4h — the worker caches by path and ignores query strings, so there is no other bust.
    No-op with a clear note if no purge-capable token exists (the R2-Edit deploy token can't
    purge); the deploy still succeeds, changes just wait for the cache to expire."""
    import os, json as _j, urllib.request as _u, urllib.error as _ue
    token = _cf_purge_token()
    if not token:
        print("  [purge] SKIPPED — no cache-purge token. Drop a token with Zone.Cache-Purge at "
              "forgeflow-games/.secrets/cf_purge_token.txt (or set CF_PURGE_TOKEN) to auto-purge; "
              "until then, changed files serve stale until the ~4h CDN cache expires.")
        return False
    zone = os.environ.get("CF_ZONE_ID") or FORGEFLOWGAMES_ZONE_ID
    urls = [f"https://{host}/games/{k}" for k in uploaded_keys]
    if not urls:
        return True

    def _post(body):
        req = _u.Request(f"https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache",
                         data=_j.dumps(body).encode(), method="POST",
                         headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with _u.urlopen(req, timeout=30) as r:
                return bool(_j.loads(r.read().decode()).get("success"))
        except _ue.HTTPError as e:
            print(f"  [purge] HTTP {e.code}: {e.read().decode()[:160]}")
            return False
        except Exception as e:
            print(f"  [purge] error: {e}")
            return False

    ok = True
    if len(urls) > 200:                       # huge deploy → one zone-wide purge
        ok = _post({"purge_everything": True})
    else:
        for i in range(0, len(urls), 30):     # CF caps files-purge at 30 URLs/call
            if not _post({"files": urls[i:i + 30]}):
                ok = False
    print(f"  [purge] {'OK' if ok else 'FAILED'} — {len(urls)} file(s) purged from {host} cache")
    return ok


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

    # CACHE-BUST STAMP — fixed 2026-09-15. The portal builds its iframe URL as
    #     ?v=<build_version || updated_at || "1">-<per-mount nonce>
    # (src/components/game/GamePlayer.tsx), and its own comment says
    # build_version is the half that "captures intentional deploys". Nothing
    # ever wrote it: build_version was NULL for every game, and updated_at was
    # frozen at row creation because its DEFAULT now() fires on INSERT only and
    # there is no update trigger — last-circle still read 2026-07-05 after a
    # dozen deploys. That left the mount nonce carrying the entire cache-bust
    # alone, so the moment anyone removed it every deploy would serve stale
    # HTML. A deploy is by definition new bytes, so the stamp is per-deploy —
    # unlike the thumbnail above, which hashes its own bytes because a cover
    # image usually does NOT change between deploys.
    # It also repairs updated_at as real data for "recently updated" ordering.
    # 2026-10-01 MOBILE LABEL: the portal's "Desktop only" / touch chips read games.mobile_support
    # (src/lib/mobile.ts, fail-closed: NULL = desktop only), but nothing in the pipeline ever wrote it,
    # so a game that gained real touch controls (DYEFIELD 1.3.0) still showed "Desktop only". A game
    # declares it in game_meta.json ("full" | "partial" | "none"); sent ONLY when declared and valid,
    # so a deploy never clears a value set by hand for games that do not declare it.
    _ms = metadata.get("mobile_support")
    if _ms in ("full", "partial", "none"):
        row["mobile_support"] = _ms

    import datetime as _dt
    _now = _dt.datetime.now(_dt.timezone.utc)
    row["build_version"] = metadata.get("build_version") or _now.strftime("%Y%m%dT%H%M%SZ")
    row["updated_at"] = metadata.get("updated_at") or _now.isoformat().replace("+00:00", "Z")

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


LIVE_CHECK_FILES = ("index.html", "thumbnail.png", "content.json")
# Files a game may legitimately not have. With a game_dir, verify_live checks them only when the game has them locally
# (Vite games such as blocktooth and wobblehoard have no content.json, and a 404 there is not a failed deploy).
LIVE_CHECK_OPTIONAL = ("content.json",)


def verify_live(slug, files=None, game_dir=None):
    """GET key files from the CDN and report their HTTP status. Returns a dict.

    files: an explicit list is checked exactly as given. Default: LIVE_CHECK_FILES; when game_dir (the folder that was
    deployed) is given, an optional file the game does not have locally (content.json) is left out instead of being
    reported as a 404. Without game_dir the default is unchanged (all three)."""
    if files is None:
        files = LIVE_CHECK_FILES
        if game_dir is not None:
            gd = Path(game_dir)
            files = tuple(f for f in files if f not in LIVE_CHECK_OPTIONAL or (gd / f).is_file())
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


def refresh_portal_prerender():
    """Rebuild + redeploy the Pages portal so the just-published slug gets its
    prerendered /games/<slug>/index.html.

    2026-07-07 — Without this, a hard load of a new game's URL fell through the
    Pages catch-all (`/* /index.html 200`) to the HOMEPAGE until someone manually
    ran deploy_portal.py: the portal prerenders game-detail pages at BUILD time
    (pages/games/@slug/+onBeforePrerenderStart.ts), so every publish makes the
    deployed prerender stale. Best-effort: a failure here must NOT fail the game
    deploy — the homepage SPA-fallback redirect still recovers direct links
    client-side; only the static HTML (SEO) is missing until the next portal run.
    """
    portal_script = Path(__file__).resolve().parent / "deploy_portal.py"
    print("[portal] Refreshing portal prerender (deploy_portal.py)...")
    try:
        r = subprocess.run(
            [sys.executable, str(portal_script)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=900,
        )
        if r.returncode == 0:
            print("[portal] Portal redeployed — prerendered game pages are current.")
            return True
        tail = ((r.stdout or "") + (r.stderr or ""))[-800:]
        print(f"[portal] WARN: portal redeploy failed (rc={r.returncode}). Direct links to this")
        print("         game recover client-side via the homepage redirect, but run")
        print("         pipeline/deploy_portal.py manually to get the prerendered page. Tail:")
        print(tail)
    except Exception as e:
        print(f"[portal] WARN: portal redeploy errored: {e}")
    return False


def deploy_one(game_dir, slug, metadata_path=None, dry_run=False, force=False, refresh_portal=True,
               status=None):
    """Deploy a single game: optional cover-gen, R2 upload, Supabase upsert,
    then a portal prerender refresh (pass refresh_portal=False to skip, e.g.
    when batch-deploying — run deploy_portal.py once at the end instead).
    Returns {ok, uploaded, total, url}. Reused by deploy_game.main + upload_game.py."""
    game_dir = Path(game_dir)
    if not game_dir.exists():
        print(f"Error: {game_dir} does not exist")
        return {"ok": False, "uploaded": 0, "total": 0, "url": None, "reason": "missing dir"}

    # ── source-folder guard (see source_folder_refusal): before the cover step, so a refused
    # deploy never spends an image-generation call either. Applies to --dry-run too.
    refusal = source_folder_refusal(game_dir, slug)
    if refusal:
        _safe_print(refusal)
        return {"ok": False, "uploaded": 0, "total": 0, "url": None,
                "reason": "source folder, not a build: `npm run build` it, then deploy its dist/ folder"}

    # ── staged-content guard (owner-deferred releases) ────────────────────
    # Slugs listed in state/staged_slugs.json have unreleased content STAGED on
    # master that must NOT reach the live hub. If this tree still contains the
    # staged marker, abort — deploy that slug from its release branch (e.g. the
    # 'live' worktree) instead. Guards against bulk fleet redeploys from master
    # silently leaking a staged expansion (happened 2026-07-13, arcane-realms).
    # Intentional override (the actual reveal): set ALLOW_STAGED_DEPLOY=1.
    try:
        _pins = json.loads((Path("C:\\Users\\TestRun\\Claude Claw\\state") / "staged_slugs.json").read_text(encoding="utf-8"))
    except Exception:
        _pins = {}
    _pin = _pins.get(slug)
    if _pin and not os.environ.get("ALLOW_STAGED_DEPLOY"):
        _pf = game_dir / _pin.get("file", "")
        try:
            _hit = _pf.exists() and _pin.get("marker", "") in _pf.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            _hit = False
        if _hit:
            _safe_print(f"ABORT: '{slug}' tree contains the staged marker '{_pin.get('marker')}' in {_pin.get('file')}.")
            _safe_print(f"  Reason: {_pin.get('note', 'staged content is not cleared for live')}")
            _safe_print("  Deploy this slug from its release branch/worktree, or set ALLOW_STAGED_DEPLOY=1 to override intentionally.")
            return {"ok": False, "uploaded": 0, "total": 0, "url": None, "reason": "staged-content guard"}

    metadata = {}
    if metadata_path:
        metadata = json.loads(Path(metadata_path).read_text(encoding="utf-8"))
    elif (game_dir / "game_meta.json").exists():
        metadata = json.loads((game_dir / "game_meta.json").read_text(encoding="utf-8"))

    # PUBLISH STATE IS NOT THE FILE'S TO SET (fixed 2026-09-15). game_meta.json
    # ships a "status" field, and insert_game_metadata treats any metadata
    # status as a deliberate override — so a stale file silently reverted the
    # portal toggle on EVERY deploy. last-circle was published by the owner and
    # the next routine deploy pushed it straight back to "draft", which is the
    # precise failure the comment in insert_game_metadata says it prevents.
    # The file is ignored now; --status is the deliberate path.
    if status:
        metadata["status"] = status
    else:
        metadata.pop("status", None)

    total = sum(1 for _ in game_dir.rglob("*") if _.is_file())
    print(f"Deploying game: {slug}\n  Source: {game_dir}\n  Files: {total}")
    if dry_run:
        print("[dry-run] Would upload to R2 and upsert Supabase")
        plan = print_upload_plan(game_dir, slug, force=force)
        return {"ok": True, "uploaded": 0, "total": total, "url": f"{CDN_BASE}/{slug}/index.html", "dry": True,
                "plan": [it["key"] for it in plan["items"]]}

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
    withheld = up.get("withheld", [])
    if uploaded == 0:
        print("  [r2] ERROR: 0 files uploaded — R2 auth/network failed. Skipping Supabase so the")
        print("       portal isn't left pointing at missing files. Fix the R2 token, then re-run.")
        return {"ok": False, "uploaded": 0, "total": total, "url": None, "reason": "r2 upload failed",
                "withheld": withheld}
    if critical_failed:
        # A critical file didn't make it (index.html / game_meta.json, or — for an unhashed
        # game — a runtime/**/*.js module, in which case index.html was never uploaded). The
        # game would be broken. Don't upsert Supabase or purge; surface a non-zero result so
        # the caller (and Task Scheduler) sees the failure.
        joined = ", ".join(critical_failed)
        print(f"  [r2] ERROR: critical file(s) failed to upload: {joined}. Skipping Supabase so the")
        print("       portal isn't left pointing at a broken game. Re-run to retry (failed files are")
        print("       not in the manifest, so a plain re-run re-uploads them; --force re-pushes all).")
        if withheld:
            print(f"       Entry page withheld (live copy unchanged): {', '.join(withheld)}")
        return {"ok": False, "uploaded": uploaded, "total": total, "url": None,
                "reason": f"critical file upload failed: {joined}", "withheld": withheld}

    # Purge the CDN cache for the files just uploaded so the deploy is visible immediately
    # (unbundled, stable-named modules otherwise serve stale ~4h — see purge_cf_cache).
    if uploaded:
        purge_cf_cache(up.get("uploaded_keys", []))

    metadata["game_url"] = f"{CDN_BASE}/{slug}/index.html"
    _tv = ""
    if thumb_path.exists():
        import hashlib as _hl
        _tv = "?v=" + _hl.md5(thumb_path.read_bytes()).hexdigest()[:8]   # cache-bust: the URL changes ONLY when the image bytes change, so browsers fetch a new cover instantly (the CDN sends max-age=86400, which otherwise pins the old cover for 24h)
    if thumb_path.exists() and not metadata.get("thumbnail_url"):
        metadata["thumbnail_url"] = f"{CDN_BASE}/{slug}/thumbnail.png{_tv}"
    if thumb_path.exists() and not metadata.get("hero_image_url"):
        metadata["hero_image_url"] = f"{CDN_BASE}/{slug}/thumbnail.png{_tv}"
    metadata_ok = insert_game_metadata(slug, metadata)
    if not metadata_ok:
        # Not fatal (the files are live; ok keeps its old meaning), but never silent: the portal row was not
        # written, so a new game is not listed and an existing one keeps its old build_version / text.
        print("  [supabase] WARN: the games row was NOT inserted/updated (see the [supabase] line above).")
    print(f"Done! Game available at: {CDN_BASE}/{slug}/index.html")
    if refresh_portal:
        refresh_portal_prerender()
    # ok = the code/metadata files went up (assets are skipped by default now, so uploaded<total is normal & fine).
    return {"ok": uploaded > 0, "uploaded": uploaded, "total": total, "url": f"{CDN_BASE}/{slug}/index.html",
            "metadata_ok": bool(metadata_ok)}


def main():
    parser = argparse.ArgumentParser(description="Deploy a game to R2 + Supabase")
    parser.add_argument("--game-dir", required=True, help="Path to built game directory")
    parser.add_argument("--slug", required=True, help="URL slug for the game")
    parser.add_argument("--metadata", help="Path to game metadata JSON file")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="re-upload ALL files incl. static assets — rarely needed now: default incremental mode uploads new/changed assets via the local manifest")
    parser.add_argument("--seed-manifest", action="store_true", help="record the current local tree as already-uploaded (no uploads) — run once after a verified-synced state")
    parser.add_argument("--status", choices=["draft", "unpublished", "published"],
                        help="deliberately set publish status. Without it a deploy NEVER changes "
                             "the status of an existing game — the portal toggle owns that.")
    parser.add_argument("--no-portal", action="store_true", help="skip the portal prerender refresh after publish (batch deploys: run pipeline/deploy_portal.py once at the end instead)")
    args = parser.parse_args()
    if getattr(args, "seed_manifest", False):
        import hashlib as _shl, json as _sjson
        gd = Path(args.game_dir).resolve()
        man_path = _manifest_path(args.slug)
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
    res = deploy_one(args.game_dir, args.slug, metadata_path=args.metadata, dry_run=args.dry_run,
                     force=args.force, refresh_portal=not args.no_portal,
                     status=args.status)
    sys.exit(0 if res.get("ok") or res.get("dry") else 1)


if __name__ == "__main__":
    main()
