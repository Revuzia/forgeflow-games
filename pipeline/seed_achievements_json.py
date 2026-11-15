#!/usr/bin/env python
"""seed_achievements_json - seed a game's portal achievement rows from the game's own achievements.json.

    python pipeline/seed_achievements_json.py --game blackridge              # DRY RUN (default): validate, back up, plan
    python pipeline/seed_achievements_json.py --game blackridge --apply      # + insert the missing rows, then verify

Generalises seed_dyefield_achievements.py (same credentials, retry taxonomy, backup, plan and verify; its helpers are
imported, not copied) to any game whose JSON lives at games/<slug>/achievements.json (override with --json) and adds the
diamond tier from migration 0003 (bronze 5 / silver 15 / gold 30 / diamond 60).

Safety, unchanged from the DYEFIELD seeder:
  * validation runs before any network call; a bad row stops everything (exit 2)
  * the existing rows for the game are ALWAYS backed up first to state/backups/<slug>_achievements_<UTC>.json
  * --apply only INSERTs missing slugs (on_conflict=game_id,slug + ignore-duplicates). Never UPDATE, never DELETE.
    A slug already present with different text/tier/points is reported and left alone (exit 3).
  * ORDER: seed BEFORE the game build that posts the slugs goes live - the portal drops unknown slugs silently.

Exit codes: 0 ok - 1 setup / network - 2 validation - 3 differs rows present - 4 verify failed.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_dyefield_achievements as base  # noqa: E402  (load_creds, request, plan_rows, SetupError)

ROOT = base.ROOT
BACKUP_DIR = base.BACKUP_DIR
TIER_POINTS = {"bronze": 5, "silver": 15, "gold": 30, "diamond": 60}
FIELDS = base.FIELDS


def validate(rows):
    errs = []
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
            errs.append("%s: tier %r not one of %s" % (s, r["tier"], "/".join(TIER_POINTS)))
        elif r["points"] != TIER_POINTS[r["tier"]]:
            errs.append("%s: points %r != %d for %s" % (s, r["points"], TIER_POINTS[r["tier"]], r["tier"]))
        if not isinstance(r["name"], str) or not r["name"] or len(r["name"]) > 80:
            errs.append("%s: name length %d (1..80)" % (s, len(str(r["name"]))))
        if not isinstance(r["description"], str) or not r["description"] or len(r["description"]) > 240:
            errs.append("%s: description length %d (1..240)" % (s, len(str(r["description"]))))
        if r["secret"] not in (True, False):
            errs.append("%s: secret must be a boolean" % s)
    return errs


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--game", required=True, help="games.slug, e.g. blackridge")
    ap.add_argument("--json", help="path to the achievements JSON (default games/<slug>/achievements.json)")
    ap.add_argument("--expect-id", type=int, help="refuse unless the resolved games.id equals this")
    ap.add_argument("--apply", action="store_true", help="insert the missing rows (default: dry run)")
    args = ap.parse_args()
    slug = args.game
    src = Path(args.json) if args.json else ROOT / "games" / slug / "achievements.json"
    mode = "APPLY" if args.apply else "DRY RUN"
    print("seed_achievements_json - %s - %s - source %s" % (slug, mode, src.relative_to(ROOT) if src.is_absolute() else src))

    try:
        raw = json.loads(src.read_text(encoding="utf-8"))
        rows = raw.get("achievements") if isinstance(raw, dict) else raw
        if not isinstance(rows, list) or not rows:
            raise ValueError("no 'achievements' list")
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
        url, key = base.load_creds()
        st, games = base.request(url, key, "/rest/v1/games?slug=eq.%s&select=id,slug,status" % slug)
        if not isinstance(games, list) or len(games) != 1:
            print("SETUP FAILED: expected exactly one games row for slug %r" % slug)
            return 1
        game = games[0]
        gid = game.get("id")
        print("game: id %s slug %s status %s" % (gid, game.get("slug"), game.get("status")))
        if args.expect_id is not None and gid != args.expect_id:
            print("SETUP FAILED: games.id is %s, --expect-id %s" % (gid, args.expect_id))
            return 1
        st, existing = base.request(url, key, "/rest/v1/achievements?game_id=eq.%s&select=*&order=id.asc" % gid)
        if not isinstance(existing, list):
            print("SETUP FAILED: achievements read returned %s" % type(existing).__name__)
            return 1
    except base.SetupError as e:
        print("SETUP FAILED: %s" % e)
        return 1

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    backup = BACKUP_DIR / ("%s_achievements_%s.json" % (slug, stamp))
    backup.write_text(json.dumps({"taken_at_utc": stamp, "game_id": gid, "game_slug": slug, "rows": existing},
                                 indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("backup: %s (%d existing rows)" % (backup.relative_to(ROOT), len(existing)))

    plan, foreign = base.plan_rows(rows, existing)
    n_ins = sum(1 for p in plan if p[0] == "insert")
    n_same = sum(1 for p in plan if p[0] == "same")
    n_diff = sum(1 for p in plan if p[0] == "differs")
    print("\n%-8s %-18s %-8s %4s  %s" % ("action", "slug", "tier", "xp", "name"))
    for action, r, diffs in plan:
        print("%-8s %-18s %-8s %4d  %s%s" % (action, r["slug"], r["tier"], r["points"], r["name"],
                                            "  [differs: %s]" % ", ".join(diffs) if diffs else ""))
    if foreign:
        print("note: %d existing row(s) not in the JSON (left alone): %s" % (len(foreign), ", ".join(map(str, foreign))))
    print("\nplan: %d insert - %d same - %d differs (JSON total %d XP)" % (n_ins, n_same, n_diff, total))

    if not args.apply:
        print("DRY RUN: nothing written to the database. Re-run with --apply to insert the %d missing row(s)." % n_ins)
        return 3 if n_diff else 0

    to_insert = [{"game_id": gid, "slug": r["slug"], "name": r["name"], "description": r["description"],
                  "tier": r["tier"], "points": r["points"], "secret": r["secret"]} for a, r, _ in plan if a == "insert"]
    try:
        if to_insert:
            st, rep = base.request(url, key, "/rest/v1/achievements?on_conflict=game_id,slug", method="POST", body=to_insert,
                                   prefer="resolution=ignore-duplicates,return=representation")
            print("insert: HTTP %s, %d row(s) returned" % (st, len(rep) if isinstance(rep, list) else 0))
        else:
            print("insert: nothing to insert")
        st, after = base.request(url, key, "/rest/v1/achievements?game_id=eq.%s&select=slug,tier,points&order=id.asc" % gid)
    except base.SetupError as e:
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
