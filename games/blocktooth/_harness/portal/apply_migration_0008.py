#!/usr/bin/env python3
"""Apply / dry-run / verify supabase/migrations/0008_blocktooth_stats.sql on qkidwgyapmitrdxnavmi.

HOW MIGRATIONS REACH qkid IN THIS REPO (checked 2026-10-01):
  * No Supabase CLI, no migration runner, no schema_migrations table: files are applied BY HAND.
  * 0002 / 0003 / 0004 headers say "Apply via Supabase Dashboard -> SQL Editor"; scripts/apply_forgeflow_0003.py
    (macro repo) automated that dashboard paste with Playwright.
  * Headless path (memory reference_ffg_registry_service_key.md, and verified with read-only SELECTs 2026-10-01):
    Management API  POST https://api.supabase.com/v1/projects/qkidwgyapmitrdxnavmi/database/query  {"query": sql}
    Authorization: Bearer <personal access token in C:/Users/TestRun/Claude Claw/state/.secrets/supabase_pat.txt>,
    with a BROWSER User-Agent (api.supabase.com Cloudflare-1010-blocks Python's default UA). Runs as role postgres.
  This script uses the headless path. The migration carries its own BEGIN/COMMIT and an in-transaction self-test:
  any failed check raises BT_SELFTEST_FAIL and the whole file rolls back (the API answers 400 with that message).

Modes (default = print the plan, no network):
  --dry-run   send the file with its final COMMIT replaced by ROLLBACK: runs every DDL statement and the full
              self-test, then discards everything. Success = HTTP 2xx and no error. (Takes brief locks on
              public.profiles / auth.users for the FKs and the fake users; nothing persists.)
  --apply     send the file as is (owner OK = D1). Then runs --verify.
  --verify    read-only: Management API catalog query (tables, RLS, grants, functions, self-test comment) +
              public-key REST GET of each table (200 + Content-Range).
Only the Ship agent runs --dry-run / --apply. The PAT is never printed.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]                                       # forgeflow-games
SQL = REPO / "supabase" / "migrations" / "0008_blocktooth_stats.sql"
PAT_FILE = REPO.parent / "state" / ".secrets" / "supabase_pat.txt"
ENV_FILE = REPO / ".env"
REF = "qkidwgyapmitrdxnavmi"
MGMT = f"https://api.supabase.com/v1/projects/{REF}/database/query"
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
TABLES = ["bt_runs", "bt_player_stats", "bt_titan_stats", "bt_bests", "bt_vs_matches", "bt_vs_results"]
FUNCS = ["bt__validate_run", "bt__file_run", "bt_submit_run", "bt_report_vs", "bt_leaderboard", "bt_player_card"]


def mgmt_query(sql, timeout=120):
    pat = PAT_FILE.read_text(encoding="utf-8").strip()
    req = urllib.request.Request(MGMT, data=json.dumps({"query": sql}).encode("utf-8"), method="POST",
                                 headers={"Authorization": "Bearer " + pat, "Content-Type": "application/json",
                                          "User-Agent": BROWSER_UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")[:2000]


def public_get(path):
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    url, key = env["VITE_SUPABASE_URL"].rstrip("/"), env["VITE_SUPABASE_PUBLISHABLE_KEY"]
    req = urllib.request.Request(f"{url}/rest/v1/{path}", headers={
        "apikey": key, "Authorization": f"Bearer {key}", "Prefer": "count=exact"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.headers.get("Content-Range"), r.read().decode("utf-8")[:200]
    except urllib.error.HTTPError as e:
        return e.code, None, e.read().decode("utf-8", errors="replace")[:200]


def verify():
    ok = True
    cat = f"""
select
  (select json_agg(json_build_object('t', c.relname, 'rls', c.relrowsecurity,
          'anon_sel', has_table_privilege('anon', c.oid, 'SELECT'),
          'anon_ins', has_table_privilege('anon', c.oid, 'INSERT'),
          'auth_ins', has_table_privilege('authenticated', c.oid, 'INSERT'),
          'auth_upd', has_table_privilege('authenticated', c.oid, 'UPDATE'),
          'auth_del', has_table_privilege('authenticated', c.oid, 'DELETE')) order by c.relname)
     from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and c.relname in ({','.join(repr(t) for t in TABLES)})) as tables,
  (select json_agg(json_build_object('f', p.proname, 'definer', p.prosecdef,
          'anon_x', has_function_privilege('anon', p.oid, 'EXECUTE'),
          'auth_x', has_function_privilege('authenticated', p.oid, 'EXECUTE')) order by p.proname)
     from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ({','.join(repr(f) for f in FUNCS)})) as funcs,
  obj_description('public.bt_runs'::regclass, 'pg_class') as selftest_comment
""".replace("'public.bt_runs'::regclass", "to_regclass('public.bt_runs')")
    st, res = mgmt_query(cat, timeout=30)
    print(f"[verify] catalog query HTTP {st}")
    if st >= 300 or not isinstance(res, list) or not res:
        print(f"[verify] FAIL catalog: {res}")
        return False
    row = res[0]
    tables = row.get("tables") or []
    funcs = row.get("funcs") or []
    print(f"[verify] tables ({len(tables)}/6): {json.dumps(tables)}")
    print(f"[verify] functions ({len(funcs)}/6): {json.dumps(funcs)}")
    print(f"[verify] bt_runs comment: {row.get('selftest_comment')}")
    if len(tables) != 6 or any(not t["rls"] or not t["anon_sel"] or t["anon_ins"] or t["auth_ins"] or t["auth_upd"]
                               or t["auth_del"] for t in tables):
        print("[verify] FAIL: expected 6 tables, RLS on, public SELECT, no anon/authenticated writes"); ok = False
    want_exec = {"bt__validate_run": (False, False), "bt__file_run": (False, False), "bt_submit_run": (False, True),
                 "bt_report_vs": (False, True), "bt_leaderboard": (True, True), "bt_player_card": (True, True)}
    for f in funcs:
        if (f["anon_x"], f["auth_x"]) != want_exec.get(f["f"]):
            print(f"[verify] FAIL: {f['f']} execute grants anon={f['anon_x']} authenticated={f['auth_x']}, "
                  f"want {want_exec.get(f['f'])}"); ok = False
    if len(funcs) != 6:
        print("[verify] FAIL: expected 6 functions"); ok = False
    if "self-test PASS: 10/10" not in (row.get("selftest_comment") or ""):
        print("[verify] FAIL: self-test PASS comment missing on public.bt_runs"); ok = False
    for t in TABLES:
        st, cr, body = public_get(f"{t}?select=*&limit=1")
        print(f"[verify] public GET {t}: HTTP {st} Content-Range {cr}" + ("" if st == 200 else f" {body}"))
        ok = ok and st == 200
    st, cr, body = public_get("rpc/bt_leaderboard?p_board=clear&p_biome=grideast")
    print(f"[verify] public GET rpc/bt_leaderboard: HTTP {st} body {body[:120]}")
    ok = ok and st == 200
    print("[verify] " + ("PASS" if ok else "FAIL"))
    return ok


def main():
    ap = argparse.ArgumentParser(description="0008_blocktooth_stats.sql -> qkid")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    g.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    sql = SQL.read_text(encoding="utf-8")
    tail = sql.rstrip()
    if not tail.endswith("COMMIT;"):
        print("[apply] FAIL: migration must end with COMMIT;")
        return 1
    if a.verify:
        return 0 if verify() else 1
    if not (a.dry_run or a.apply):
        print(f"[apply] {SQL.name}: {len(sql)} chars. Target {REF} via {MGMT}.")
        print("[apply] modes: --dry-run (COMMIT->ROLLBACK), --apply (owner OK D1), --verify (read-only). No network used.")
        return 0
    body = tail[: -len("COMMIT;")] + ("ROLLBACK;\n" if a.dry_run else "COMMIT;\n")
    mode = "DRY-RUN (rolled back)" if a.dry_run else "APPLY"
    print(f"[apply] {mode}: sending {len(body)} chars to {REF} ...")
    st, res = mgmt_query(body, timeout=180)
    print(f"[apply] HTTP {st}: {str(res)[:1500]}")
    if st >= 300:
        print(f"[apply] {mode} FAIL (the transaction rolled back; nothing changed)")
        return 1
    print(f"[apply] {mode} OK")
    if a.apply:
        # Ship 2026-10-01: the in-transaction NOTIFY did not reach PostgREST in time (public GETs answered PGRST205
        # right after a successful apply). Send the reload outside the transaction and give it a moment.
        import time
        mgmt_query("NOTIFY pgrst, 'reload schema';", timeout=30)
        time.sleep(8)
        return 0 if verify() else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
