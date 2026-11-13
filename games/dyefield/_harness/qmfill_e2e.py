#!/usr/bin/env python
"""DYEFIELD Quick Match fill, end to end in the REAL game (not the mock): PLAY ONLINE → QUICK MATCH with the fill pinned
to a few seconds → the waiting count climbs → MATCH FOUND lists 8 → the match loads and its runners carry exactly the
names the card showed (the seed hand-off). Works whether or not the relay answers (its errors must not interrupt the fill).
Run:  python _harness/qmfill_e2e.py [--base http://localhost:5223/] [--mode teams|ffa]
"""
from __future__ import annotations
import argparse, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from common import ensure_server, stop_server  # noqa: E402
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument("--base", default="http://localhost:5223/"); ap.add_argument("--mode", default="teams")
ap.add_argument("--fill", type=float, default=12); a = ap.parse_args()
srv = ensure_server(a.base) if "localhost" in a.base else None
fails, errors = [], []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail != "" else ""), flush=True)
    if not cond: fails.append(name)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"])
        p = b.new_page(viewport={"width": 1280, "height": 720})
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto((a.base if a.base.endswith(".html") else a.base.rstrip("/") + "/") + "?dev=1&net=1"); p.wait_for_function("window.__DF__ && document.getElementById('dfo-door-qm')", timeout=120000)
        p.evaluate(f"window.__DF_QM_FILL_S = {a.fill}")
        p.click(f"#dfo-mode-{a.mode}")
        p.click("#dfo-door-qm")
        counts, people, t0 = set(), None, time.time()
        while time.time() - t0 < a.fill + 25:
            st = p.evaluate("(() => { const c = document.querySelector('[data-state]'); const s = document.querySelector('.dfo-s-search, #dfo-search'); return null; })()")
            snap = p.evaluate("(() => ({ state: (document.querySelector('.dfo-search-card, [data-state]')||{}).dataset?.state, stats: [...document.querySelectorAll('.stat')].map(e=>e.textContent).join('|'), people: [...document.querySelectorAll('.dfo-person b')].map(b=>b.textContent), bots: /VS BOTS|NO ONE ELSE/i.test(document.body.innerText) }))()")
            if snap["bots"]: check("never shows PLAY VS BOTS / NO ONE ELSE YET", False, snap); break
            if "waiting" in snap["stats"]: counts.add(snap["stats"].split("waiting")[0])
            if len(snap["people"]) == 8: people = snap["people"]; break
            time.sleep(0.2)
        check("waiting count climbs as players join", len(counts) >= 3, sorted(counts))
        check("MATCH FOUND lists 8 players", bool(people), people)
        ok = False; t1 = time.time()
        while time.time() - t1 < 90:
            try:
                m = p.evaluate("(() => { try { return window.__DF__.match(); } catch (e) { return null; } })()")
            except Exception: m = None
            if m and m.get("runners") and len(m["runners"]) == 8: ok = True; break
            time.sleep(0.5)
        check("the match loads with 8 runners", ok)
        if ok and people:
            names = [r["name"] for r in m["runners"]]
            others = set(people[1:]); in_match = set(r["name"] for r in m["runners"] if r["id"] != 0)
            check("the runners carry exactly the names the card showed", others == in_match, f"card {sorted(others)} | match {sorted(in_match)}")
            if a.mode == "teams":
                mine = [r for r in m["runners"] if r["id"] == 0][0]["team"]
                mates = sorted(r["name"] for r in m["runners"] if r["team"] == mine and r["id"] != 0)
                check("crewmates match the card's first row", mates == sorted(people[1:4]), f"{mates} vs {people[1:4]}")
        p.screenshot(path=os.path.join(HERE, "_reports", f"qmfill_{a.mode}.png"))
        check("no page errors", not errors, errors[:3])
        b.close()
finally:
    if srv: stop_server(srv)
print("QMFILL OK" if not fails else f"QMFILL FAIL: {fails}"); sys.exit(1 if fails else 0)
