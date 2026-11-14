#!/usr/bin/env python3
"""Seed BLOCKTOOTH's 46 solo goals + 8 VS goals as ForgeFlow Games platform achievements (game 52 on qkidwgyapmitrdxnavmi).

Owner decision D2 (2026-10-01, ONLINE_PLAN.md section 5): bronze 12 / silver 16 / gold 13 / diamond 5 = 990 XP for the 46 solo goals,
tiers from platform.md section 9, points = the pipeline's tier defaults (bronze 5 / silver 15 / gold 30 / diamond 60).
Owner decision D3 (same plan) + O-REPORT: the 8 VS goals of src/data/vsgoals.ts (SYNDICATED, CERTIFIED HEADLINE, CROSSOVER EPISODE,
HOSTILE TAKEOVER, ZONED RESIDENTIAL, NETWORK EXCLUSIVE, ENSEMBLE CAST, RATINGS WAR): bronze 2 / silver 2 / gold 3 / diamond 1 = 190 XP,
tiers read from vsgoals.ts itself (the single source). All 54 rows: bronze 14 / silver 18 / gold 16 / diamond 6 = 1180 XP.

Same path as scripts/run_game_pipeline.py _seed_achievements (macro repo): POST /rest/v1/rpc/seed_game_achievements
{p_game_id, p_rows} with the SERVICE-ROLE key (the RPC is service_role-only since migration 0005). The RPC is
idempotent per (game_id, slug) (ON CONFLICT DO NOTHING) and returns how many rows it inserted. Live definition read
2026-10-01: it skips the whole call once a game already has >= 60 rows (46 now leaves room for the 8 VS rows, D3).

Rows come from games/blocktooth/src/data/goals.ts (46 solo goals) and src/data/vsgoals.ts (8 VS goals): slug = goal id,
name = name, description = desc; secret false. The solo tier table below is the approved one; the script refuses to run if goals.ts
and the table disagree, or if vsgoals.ts no longer holds the 8 approved VS goals with the approved tier counts.

Usage (from anywhere):
  python seed_achievements.py              # dry run: parse + validate + print the rows; NO network
  python seed_achievements.py --verify     # read-only: public-key REST count of game 52's achievement rows
  python seed_achievements.py --apply      # seed (service key), then verify by public read-back
  --scope all|goals|vs                     # which rows (default all = 54); the RPC is ON CONFLICT DO NOTHING, so `--apply` on a game
                                           # that already holds the 46 solo rows inserts only the 8 VS rows

Secrets: the service key is read from api_config.json providers.supabase_forgeflow.service_role_key (the same place
deploy_game.py / run_game_pipeline.py read it) and is never printed. The read-back uses the publishable key from
forgeflow-games/.env. Do NOT send a browser User-Agent with the sb_secret key (Supabase rejects it as
"Forbidden use of secret API key in browser").
"""
import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
GAME_DIR = HERE.parents[1]                       # games/blocktooth
REPO = GAME_DIR.parents[1]                       # forgeflow-games
GOALS_TS = GAME_DIR / "src" / "data" / "goals.ts"
VSGOALS_TS = GAME_DIR / "src" / "data" / "vsgoals.ts"
ENV_FILE = REPO / ".env"
API_CONFIG = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))) / "Nomi" / "api_config.json"

GAME_ID = 52
GAME_SLUG = "blocktooth"
UA = "forgeflow-blocktooth-seed/1.0 (python-urllib)"   # deliberately NOT a browser UA

POINTS = {"bronze": 5, "silver": 15, "gold": 30, "diamond": 60}
EXPECT_COUNTS = {"bronze": 12, "silver": 16, "gold": 13, "diamond": 5}
EXPECT_XP = 990
# D3 (the 8 VS goals; tiers live in src/data/vsgoals.ts)
EXPECT_VS_COUNTS = {"bronze": 2, "silver": 2, "gold": 3, "diamond": 1}
EXPECT_VS_XP = 190
EXPECT_VS_IDS = ["g_vs_syndicated", "g_vs_certified_headline", "g_vs_crossover_episode", "g_vs_hostile_takeover",
                 "g_vs_zoned_residential", "g_vs_network_exclusive", "g_vs_ensemble_cast", "g_vs_ratings_war"]
ROW_CAP = 60          # the live seed_game_achievements stops once a game holds >= 60 rows (54 fits)

# platform.md section 9 (approved as D2)
TIERS = {
    "bronze": ["g_first_broadcast", "g_zoning_change", "g_change_order", "g_paperwork", "g_signal_boost",
               "g_running_errands", "g_molo_speed_bump", "g_bw_green_thumb", "g_hb_full_pressure",
               "g_ge_parking_violation", "g_ws_thaw", "g_lw_port_closed"],
    "silver": ["g_skyline_adjusted", "g_city_got_smaller", "g_crowd_control", "g_live_coverage", "g_urban_renewal",
               "g_still_on_air", "g_gate_tipped_off", "g_gate_line_crossed", "g_molo_bite_sized", "g_vk_grid_down",
               "g_hb_warm_welcome", "g_bw_rewilded", "g_ge_rate_hike", "g_ws_hairline", "g_lw_shipping_delays",
               "g_ge_curb_appeal"],
    "gold": ["g_one_take", "g_double_feature", "g_gate_hang_up", "g_gate_without_a_dent", "g_gate_reissued",
             "g_molo_curbside_pickup", "g_vk_six_way_splice", "g_vk_power_outage", "g_hb_rolling_boil",
             "g_bw_full_bloom", "g_ws_cold_storage", "g_lw_early_closing", "g_full_programming"],
    "diamond": ["g_gate_over_the_limit", "g_molo_three_course", "g_vk_coast_to_coast", "g_hb_continental_drift",
                "g_bw_canopy_cover"],
}

# a TS string literal in single or double quotes, with backslash escapes
_STR = r"""('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")"""
GOAL_RE = re.compile(r"\{\s*id:\s*" + _STR + r",\s*name:\s*" + _STR + r",\s*desc:\s*" + _STR)


def _unquote(lit: str) -> str:
    body = lit[1:-1]
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), body)


VSGOAL_RE = re.compile(r"\{\s*id:\s*" + _STR + r",\s*name:\s*" + _STR + r",\s*desc:\s*" + _STR + r",\s*tier:\s*" + _STR)


def parse_vs_goals():
    """[(id, name, desc, tier)] from src/data/vsgoals.ts VS_GOALS (the single source of the 8 VS goals)."""
    src = VSGOALS_TS.read_text(encoding="utf-8")
    block = src[src.find("export const VS_GOALS"):]
    block = block[:block.find("];")]
    return [(_unquote(a), _unquote(b), _unquote(c), _unquote(d)) for a, b, c, d in VSGOAL_RE.findall(block)]


def parse_goals():
    src = GOALS_TS.read_text(encoding="utf-8")
    goals = [(_unquote(a), _unquote(b), _unquote(c)) for a, b, c in GOAL_RE.findall(src)]
    raw_ids = re.findall(r"\bid:\s*'(g_[a-z0-9_]+)'", src)
    return goals, raw_ids


def build_rows(scope="all"):
    goals, raw_ids = parse_goals()
    vsgoals = parse_vs_goals()
    errors = []
    if len(goals) != 46:
        errors.append(f"parsed {len(goals)} goals from goals.ts, expected 46")
    if sorted(g[0] for g in goals) != sorted(raw_ids):
        errors.append(f"parser missed goal ids: {sorted(set(raw_ids) - {g[0] for g in goals})}")
    tier_of = {}
    for tier, ids in TIERS.items():
        for gid in ids:
            if gid in tier_of:
                errors.append(f"{gid} listed in two tiers ({tier_of[gid]}, {tier})")
            tier_of[gid] = tier
    ids = [g[0] for g in goals]
    if len(set(ids)) != len(ids):
        errors.append("duplicate goal ids in goals.ts")
    missing = sorted(set(ids) - set(tier_of))
    extra = sorted(set(tier_of) - set(ids))
    if missing:
        errors.append(f"goals with no tier: {missing}")
    if extra:
        errors.append(f"tiered ids not in goals.ts: {extra}")
    rows = []
    for gid, name, desc in goals:
        tier = tier_of.get(gid, "bronze")
        if len(gid) > 64 or len(name) > 80 or len(desc) > 240:
            errors.append(f"{gid}: field too long for the RPC's LEFT() caps (slug 64 / name 80 / description 240)")
        if not name.strip() or not desc.strip():
            errors.append(f"{gid}: empty name or description")
        rows.append({"game_id": GAME_ID, "slug": gid, "name": name, "description": desc, "tier": tier,
                     "points": POINTS[tier], "secret": False})
    counts = {t: sum(1 for r in rows if r["tier"] == t) for t in POINTS}
    xp = sum(r["points"] for r in rows)
    if counts != EXPECT_COUNTS:
        errors.append(f"tier counts {counts} != approved {EXPECT_COUNTS}")
    if xp != EXPECT_XP:
        errors.append(f"total XP {xp} != approved {EXPECT_XP}")
    # the 8 VS goals (src/data/vsgoals.ts)
    vrows = []
    if [g[0] for g in vsgoals] != EXPECT_VS_IDS:
        errors.append(f"vsgoals.ts holds {[g[0] for g in vsgoals]}, expected {EXPECT_VS_IDS}")
    for gid, name, desc, tier in vsgoals:
        if tier not in POINTS:
            errors.append(f"{gid}: unknown tier {tier!r}")
            continue
        if gid in tier_of:
            errors.append(f"{gid} also exists as a solo goal")
        if len(gid) > 64 or len(name) > 80 or len(desc) > 240:
            errors.append(f"{gid}: field too long for the RPC's LEFT() caps (slug 64 / name 80 / description 240)")
        if not name.strip() or not desc.strip():
            errors.append(f"{gid}: empty name or description")
        vrows.append({"game_id": GAME_ID, "slug": gid, "name": name, "description": desc, "tier": tier,
                      "points": POINTS[tier], "secret": False})
    vcounts = {t: sum(1 for r in vrows if r["tier"] == t) for t in POINTS}
    vxp = sum(r["points"] for r in vrows)
    if vcounts != EXPECT_VS_COUNTS:
        errors.append(f"VS tier counts {vcounts} != approved {EXPECT_VS_COUNTS}")
    if vxp != EXPECT_VS_XP:
        errors.append(f"VS total XP {vxp} != approved {EXPECT_VS_XP}")
    if len(rows) + len(vrows) > ROW_CAP - 1:
        errors.append(f"{len(rows) + len(vrows)} rows would not fit under the live RPC's {ROW_CAP}-row cap")
    if scope == "goals":
        pass
    elif scope == "vs":
        rows, counts, xp = vrows, vcounts, vxp
    else:
        rows = rows + vrows
        counts = {t: counts[t] + vcounts[t] for t in POINTS}
        xp += vxp
    return rows, counts, xp, errors


def _read_env():
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _service_creds():
    cfg = json.loads(API_CONFIG.read_text(encoding="utf-8"))
    ffg = (cfg.get("providers", {}) or {}).get("supabase_forgeflow", {}) or {}
    url = ffg.get("url") or _read_env().get("VITE_SUPABASE_URL", "")
    key = os.environ.get("FFG_SERVICE_ROLE_KEY") or ffg.get("service_role_key", "")
    if not url or not key:
        raise SystemExit("[seed] FAIL: providers.supabase_forgeflow url/service_role_key missing in api_config.json")
    if "qkidwgyapmitrdxnavmi" not in url:
        raise SystemExit(f"[seed] FAIL: service url is not the qkid project: {url}")
    return url.rstrip("/"), key


def _public_creds():
    env = _read_env()
    url, key = env.get("VITE_SUPABASE_URL", ""), env.get("VITE_SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not key:
        raise SystemExit("[seed] FAIL: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing in forgeflow-games/.env")
    return url.rstrip("/"), key


def _request(method, url, key, body=None, extra_headers=None):
    """error-recovery.md: retry 429/5xx/timeouts with 2s/4s/8s (+jitter); never retry 4xx."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "User-Agent": UA, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    headers.update(extra_headers or {})
    last = None
    for attempt in range(4):
        if attempt:
            delay = 2 ** attempt + (2 ** attempt) * 0.2 * random.random()
            print(f"[seed]   retry {attempt}/3 in {delay:.1f}s ({last})")
            time.sleep(delay)
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, dict(r.headers), r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", errors="replace")[:400]
            if e.code == 429 or e.code >= 500:
                last = f"HTTP {e.code} {txt[:120]}"
                continue
            return e.code, dict(e.headers), txt
        except (urllib.error.URLError, TimeoutError) as e:
            last = f"{type(e).__name__}: {e}"
            continue
    raise SystemExit(f"[seed] FAIL after 3 retries: {last}")


def public_state():
    url, key = _public_creds()
    st, _, body = _request("GET", f"{url}/rest/v1/games?select=id,slug,status&id=eq.{GAME_ID}", key)
    if st != 200:
        raise SystemExit(f"[seed] FAIL: games read HTTP {st}: {body[:200]}")
    game = (json.loads(body) or [None])[0]
    st, hdr, body = _request("GET", f"{url}/rest/v1/achievements?select=slug,tier,points&game_id=eq.{GAME_ID}&limit=1000",
                             key, extra_headers={"Prefer": "count=exact"})
    if st != 200:
        raise SystemExit(f"[seed] FAIL: achievements read HTTP {st}: {body[:200]}")
    return game, json.loads(body), hdr.get("Content-Range") or hdr.get("content-range")


def report_live(rows):
    game, live, crange = public_state()
    print(f"[seed] live game {GAME_ID}: {game}")
    want = {r["slug"]: r for r in rows}
    have = {a["slug"]: a for a in live}
    counts = {t: sum(1 for a in live if a.get("tier") == t) for t in POINTS}
    xp = sum(int(a.get("points") or 0) for a in live if a["slug"] in want)
    mism = [s for s in want if s in have and (have[s].get("tier"), int(have[s].get("points") or 0))
            != (want[s]["tier"], want[s]["points"])]
    print(f"[seed] live achievements for game {GAME_ID}: {len(live)} rows (Content-Range {crange}); tiers {counts}")
    print(f"[seed]   goal slugs present {sum(1 for s in want if s in have)}/{len(want)}, XP over goal rows {xp}, "
          f"tier/points mismatches {mism or 'none'}, extra slugs {sorted(set(have) - set(want)) or 'none'}")
    return game, live, mism


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--apply", action="store_true", help="seed with the service key, then verify")
    g.add_argument("--verify", action="store_true", help="read-only public check of the live rows")
    # Ship 2026-10-01: the LIVE public.achievements_tier_check allows only bronze/silver/gold (it drifted from the
    # repo's 0003 file, which allows diamond), so a 46-row seed fails 23514 on the first diamond row and inserts
    # nothing. --hold-tier diamond seeds every other row now; re-run --apply without it once the owner OKs widening
    # the constraint (ON CONFLICT (game_id, slug) DO NOTHING makes the re-run add only the held rows).
    ap.add_argument("--hold-tier", action="append", default=[], choices=sorted(POINTS),
                    help="leave this tier's rows out of --apply (repeatable)")
    ap.add_argument("--scope", choices=("all", "goals", "vs"), default="all",
                    help="all = 46 solo + 8 VS (default) | goals = the 46 solo | vs = the 8 VS rows only")
    args = ap.parse_args()

    rows, counts, xp, errors = build_rows(args.scope)
    print(f"[seed] goals.ts + vsgoals.ts (scope {args.scope}) -> {len(rows)} rows; tiers {counts}; total XP {xp}")
    if errors:
        for e in errors:
            print(f"[seed] FAIL: {e}")
        return 1

    if not args.apply and not args.verify:
        for r in rows:
            print(f"  {r['tier']:<7} {r['points']:>2}  {r['slug']:<26} {r['name']:<24} {r['description']}")
        print("[seed] dry run OK (no network). --verify = read-only live check, --apply = seed.")
        return 0

    if args.verify:
        _, live, mism = report_live(rows)
        ok = len(live) >= len(rows) and all(r["slug"] in {a["slug"] for a in live} for r in rows) and not mism
        print("[seed] VERIFY " + ("PASS" if ok else "NOT SEEDED / INCOMPLETE"))
        return 0 if ok else 2

    # --apply
    game, live, _ = report_live(rows)
    if not game or game.get("slug") != GAME_SLUG:
        print(f"[seed] FAIL: game {GAME_ID} is not '{GAME_SLUG}' ({game}); refusing to seed")
        return 1
    if len(live) >= ROW_CAP:
        print(f"[seed] FAIL: game already has >= {ROW_CAP} rows; seed_game_achievements would silently insert 0")
        return 1
    if len(live) + len([r for r in rows if r["slug"] not in {a["slug"] for a in live}]) > ROW_CAP - 1:
        print(f"[seed] FAIL: seeding would take game {GAME_ID} past the live RPC's {ROW_CAP}-row cap")
        return 1
    send = [r for r in rows if r["tier"] not in args.hold_tier]
    held = [r["slug"] for r in rows if r["tier"] in args.hold_tier]
    if held:
        print(f"[seed] holding {len(held)} rows of tier(s) {args.hold_tier}: {held}")
    url, key = _service_creds()
    st, _, body = _request("POST", f"{url}/rest/v1/rpc/seed_game_achievements", key,
                           body={"p_game_id": GAME_ID, "p_rows": send})
    if st != 200:
        print(f"[seed] FAIL: seed_game_achievements HTTP {st}: {body[:300]}")
        if "achievements_tier_check" in body:
            print("[seed]   the live tier CHECK rejects a tier in this batch (nothing was inserted: one RPC = one "
                  "transaction). See --hold-tier.")
        return 1
    print(f"[seed] seed_game_achievements -> inserted {body.strip()} new rows (of {len(send)} candidates)")
    _, live, mism = report_live(rows)
    have = {a["slug"] for a in live}
    ok = all(r["slug"] in have for r in send) and not mism
    if ok and held:
        missing = [s for s in held if s not in have]
        print(f"[seed] APPLY PARTIAL: {len(send)}/{len(rows)} goal rows readable with the public key; "
              f"held (not seeded): {missing}")
        return 3
    print("[seed] APPLY " + (f"PASS: all {len(send)} rows readable with the public key" if ok else "FAIL: read-back incomplete"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
