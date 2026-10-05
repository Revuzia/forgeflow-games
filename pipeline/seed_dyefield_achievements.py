#!/usr/bin/env python
"""seed_dyefield_achievements - the DYEFIELD achievement rows for the portal DB (games/dyefield/_spec/CONTRACT_STATS.md S7).

    python pipeline/seed_dyefield_achievements.py            # DRY RUN (default): resolve, validate, back up, plan, exit 0
    python pipeline/seed_dyefield_achievements.py --apply    # + insert the missing rows (additive, idempotent), then verify

Input: games/dyefield/runtime/src/stats/achievements.json - the SAME file the game imports (single source of truth).

Steps
  1. resolve the game: GET /rest/v1/games?slug=eq.dyefield&select=id,slug,status -> exactly one row (expect id 53;
     refuses on 0 or > 1)
  2. validate the JSON: 29 rows, unique slugs, tier in {bronze, silver, gold}, points 5 / 15 / 30 by tier, slug <= 64,
     name <= 80, description <= 240 chars, secret false
  3. read the existing rows for that game (select=*) and ALWAYS write a backup first:
     forgeflow-games/state/backups/dyefield_achievements_<UTC yyyymmddThhmmss>.json (all existing dyefield rows, even [])
  4. plan per slug: insert (missing) / same (present + identical) / differs (present, any of name / description / tier /
     points / secret different). Print the plan. Default = dry run: stop here.
  5. --apply: POST /rest/v1/achievements?on_conflict=game_id,slug with Prefer: resolution=ignore-duplicates,
     return=representation, body = the insert rows only (game_id, slug, name, description, tier, points, secret; icon
     left null like every other row). Never UPDATE, never DELETE. A differs row is reported, left alone, exit 3.
  6. verify (after --apply): re-read; every slug present with the JSON's tier and points.

Why not the seed_game_achievements RPC the game pipeline uses: its body is not in this repo and the pipeline's comment says
it caps insertions per game at an unknown cap; a silent cap below 29 would be invisible. The direct upsert-ignore is
transparent and verifiable (service_role keeps write rights after migration 0005).

ORDER: seed (--apply + its verify) BEFORE the game build that posts achievements goes live - the portal silently drops an
achievement post whose slug has no row (gameBridge.ts unlockAchievementBySlug).

Credentials, as pipeline/deploy_game.py: URL = forgeflow-games/.env VITE_SUPABASE_URL (else api_config.json
providers.supabase_forgeflow.url); key = env FFG_SERVICE_ROLE_KEY, else api_config.json
providers.supabase_forgeflow.service_role_key. Never prints a key, the project URL, or a user id.

Exit codes: 0 ok - 1 setup / network - 2 validation - 3 differs rows present - 4 verify failed.
Transient HTTP errors (429 / 5xx / network) retry with 1 s -> 2 s -> 4 s backoff; 400 / 401 / 403 never retry.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent                      # forgeflow-games/
NOMI = Path(os.path.expandvars("%APPDATA%")) / "Nomi"
ACH_JSON = ROOT / "games" / "dyefield" / "runtime" / "src" / "stats" / "achievements.json"
BACKUP_DIR = ROOT / "state" / "backups"
GAME_SLUG = "dyefield"
EXPECT_GAME_ID = 53
EXPECT_ROWS = 29
TIER_POINTS = {"bronze": 5, "silver": 15, "gold": 30}
FIELDS = ("slug", "name", "description", "tier", "points", "secret")
COMPARE = ("name", "description", "tier", "points", "secret")


class SetupError(RuntimeError):
    pass


def load_creds():
    env = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    try:
        cfg = json.loads((NOMI / "api_config.json").read_text(encoding="utf-8"))
    except Exception:
        cfg = {}
    ffg = ((cfg.get("providers", {}) or {}).get("supabase_forgeflow", {}) or {})
    url = (env.get("VITE_SUPABASE_URL", "") or ffg.get("url", "")).rstrip("/")
    key = os.environ.get("FFG_SERVICE_ROLE_KEY") or ffg.get("service_role_key", "")
    if not url or not key:
        raise SetupError("missing FFG service credentials (FFG_SERVICE_ROLE_KEY env or api_config.json "
                         "providers.supabase_forgeflow.service_role_key, and VITE_SUPABASE_URL)")
    return url, key


def request(url, key, path, method="GET", body=None, prefer=None, attempts=4):
    """One REST call with the retry taxonomy (429 / 5xx / network: 1 s, 2 s, 4 s; anything else: no retry).
    Returns (status, parsed JSON). Error messages never carry the URL host or the key."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"apikey": key, "Authorization": "Bearer " + key, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    delay = 1.0
    last = ""
    for i in range(attempts):
        req = urllib.request.Request(url + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read().decode("utf-8") or "null"
                return r.status, json.loads(raw)
        except urllib.error.HTTPError as e:
            msg = ""
            try:
                msg = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                pass
            last = "HTTP %d on %s %s: %s" % (e.code, method, path.split("?")[0], msg)
            if e.code == 429 or e.code >= 500:
                if i + 1 < attempts:
                    time.sleep(delay)
                    delay *= 2
                    continue
            raise SetupError(last)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = "network error on %s %s: %s" % (method, path.split("?")[0], type(e).__name__)
            if i + 1 < attempts:
                time.sleep(delay)
                delay *= 2
                continue
            raise SetupError(last)
    raise SetupError(last or "request failed")


def load_rows():
    raw = json.loads(ACH_JSON.read_text(encoding="utf-8"))
    rows = raw.get("achievements") if isinstance(raw, dict) else raw
    if not isinstance(rows, list):
        raise ValueError("achievements.json: no 'achievements' list")
    return rows


def validate(rows):
    errs = []
    if len(rows) != EXPECT_ROWS:
        errs.append("expected %d rows, found %d" % (EXPECT_ROWS, len(rows)))
    seen = set()
    for i, r in enumerate(rows):
        if not isinstance(r, dict):
            errs.append("row %d is not an object" % i)
            continue
        missing = [f for f in FIELDS if f not in r]
        if missing:
            errs.append("row %d missing %s" % (i, missing))
            continue
        extra = [k for k in r.keys() if k not in FIELDS]
        if extra:
            errs.append("row %d (%s) has unknown fields %s" % (i, r.get("slug"), extra))
        s = r["slug"]
        if not isinstance(s, str) or not s or len(s) > 64:
            errs.append("row %d: bad slug %r" % (i, s))
        if s in seen:
            errs.append("duplicate slug %r" % s)
        seen.add(s)
        if r["tier"] not in TIER_POINTS:
            errs.append("%s: tier %r not bronze / silver / gold" % (s, r["tier"]))
        elif r["points"] != TIER_POINTS[r["tier"]]:
            errs.append("%s: points %r != %d for %s" % (s, r["points"], TIER_POINTS[r["tier"]], r["tier"]))
        if not isinstance(r["name"], str) or not r["name"] or len(r["name"]) > 80:
            errs.append("%s: name length %d (1..80)" % (s, len(str(r["name"]))))
        if not isinstance(r["description"], str) or not r["description"] or len(r["description"]) > 240:
            errs.append("%s: description length %d (1..240)" % (s, len(str(r["description"]))))
        if r["secret"] is not False:
            errs.append("%s: secret must be false" % s)
    return errs


def plan_rows(rows, existing):
    by_slug = {e.get("slug"): e for e in existing if isinstance(e, dict)}
    plan = []
    for r in rows:
        e = by_slug.get(r["slug"])
        if e is None:
            plan.append(("insert", r, None))
            continue
        diffs = [f for f in COMPARE if e.get(f) != r[f]]
        plan.append(("differs" if diffs else "same", r, diffs))
    foreign = [s for s in by_slug if s not in {r["slug"] for r in rows}]
    return plan, foreign


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="insert the missing rows (default: dry run)")
    args = ap.parse_args()
    mode = "APPLY" if args.apply else "DRY RUN"
    print("seed_dyefield_achievements - %s - source %s" % (mode, ACH_JSON.relative_to(ROOT)))

    # 2. validate first (no network needed)
    try:
        rows = load_rows()
    except Exception as e:
        print("VALIDATION FAILED: %s" % e)
        return 2
    errs = validate(rows)
    total = sum(r.get("points", 0) for r in rows if isinstance(r, dict))
    tiers = {}
    for r in rows:
        if isinstance(r, dict):
            tiers[r.get("tier")] = tiers.get(r.get("tier"), 0) + 1
    print("json: %d rows, %d XP, tiers %s" % (len(rows), total, json.dumps(tiers, sort_keys=True)))
    if errs:
        for e in errs:
            print("  VALIDATION: " + e)
        return 2

    try:
        url, key = load_creds()
        # 1. resolve the game
        st, games = request(url, key, "/rest/v1/games?slug=eq.%s&select=id,slug,status" % GAME_SLUG)
        if not isinstance(games, list) or len(games) != 1:
            print("SETUP FAILED: expected exactly one games row for slug %r, got %s" % (GAME_SLUG, len(games) if isinstance(games, list) else type(games).__name__))
            return 1
        game = games[0]
        gid = game.get("id")
        print("game: id %s slug %s status %s%s" % (gid, game.get("slug"), game.get("status"),
                                                   "" if gid == EXPECT_GAME_ID else "  (NOTE: expected id %d)" % EXPECT_GAME_ID))
        # 3. existing rows + the backup (always, even when empty)
        st, existing = request(url, key, "/rest/v1/achievements?game_id=eq.%s&select=*&order=id.asc" % gid)
        if not isinstance(existing, list):
            print("SETUP FAILED: achievements read returned %s" % type(existing).__name__)
            return 1
    except SetupError as e:
        print("SETUP FAILED: %s" % e)
        return 1

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    backup = BACKUP_DIR / ("dyefield_achievements_%s.json" % stamp)
    backup.write_text(json.dumps({"taken_at_utc": stamp, "game_id": gid, "game_slug": GAME_SLUG, "rows": existing},
                                 indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("backup: %s (%d existing dyefield rows)" % (backup.relative_to(ROOT), len(existing)))

    # 4. plan
    plan, foreign = plan_rows(rows, existing)
    n_ins = sum(1 for p in plan if p[0] == "insert")
    n_same = sum(1 for p in plan if p[0] == "same")
    n_diff = sum(1 for p in plan if p[0] == "differs")
    print("\n%-8s %-20s %-7s %4s  %s" % ("action", "slug", "tier", "xp", "name"))
    for action, r, diffs in plan:
        print("%-8s %-20s %-7s %4d  %s%s" % (action, r["slug"], r["tier"], r["points"], r["name"],
                                            "  [differs: %s]" % ", ".join(diffs) if diffs else ""))
    if foreign:
        print("note: %d existing dyefield row(s) not in the JSON (left alone): %s" % (len(foreign), ", ".join(map(str, foreign))))
    print("\nplan: %d insert - %d same - %d differs (JSON total %d XP)" % (n_ins, n_same, n_diff, total))

    if not args.apply:
        print("DRY RUN: nothing written to the database. Re-run with --apply to insert the %d missing row(s)." % n_ins)
        return 3 if n_diff else 0

    # 5. apply: additive insert of the missing rows only
    to_insert = [{"game_id": gid, "slug": r["slug"], "name": r["name"], "description": r["description"],
                  "tier": r["tier"], "points": r["points"], "secret": r["secret"]} for a, r, _ in plan if a == "insert"]
    try:
        if to_insert:
            st, rep = request(url, key, "/rest/v1/achievements?on_conflict=game_id,slug", method="POST", body=to_insert,
                              prefer="resolution=ignore-duplicates,return=representation")
            print("insert: HTTP %s, %d row(s) returned" % (st, len(rep) if isinstance(rep, list) else 0))
        else:
            print("insert: nothing to insert")
        # 6. verify
        st, after = request(url, key, "/rest/v1/achievements?game_id=eq.%s&select=slug,tier,points&order=id.asc" % gid)
    except SetupError as e:
        print("APPLY FAILED: %s" % e)
        return 1
    got = {a.get("slug"): a for a in after if isinstance(a, dict)}
    bad = []
    for r in rows:
        a = got.get(r["slug"])
        if not a:
            bad.append("%s missing" % r["slug"])
        elif a.get("tier") != r["tier"] or a.get("points") != r["points"]:
            bad.append("%s is %s/%s, want %s/%s" % (r["slug"], a.get("tier"), a.get("points"), r["tier"], r["points"]))
    pts = sum(int(a.get("points") or 0) for s, a in got.items() if s in {r["slug"] for r in rows})
    print("verify: %d / %d slugs present, %d XP over them" % (len([r for r in rows if r["slug"] in got]), len(rows), pts))
    if bad:
        for b in bad:
            print("  VERIFY: " + b)
        return 4
    if n_diff:
        print("DIFFERS rows were left alone (owner decides): exit 3")
        return 3
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
