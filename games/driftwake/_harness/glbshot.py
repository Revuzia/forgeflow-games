"""Headless canvas screenshot of glbview.html for asset checks.

  python _harness/glbshot.py --qs "glb=_tmp_rigged.glb&yaw=0" --out _shots/x.png
"""
import argparse, os
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8799/games/driftwake/_harness/glbview.html"

ap = argparse.ArgumentParser()
ap.add_argument("--qs", required=True, help="query string for glbview.html")
ap.add_argument("--out", required=True)
ap.add_argument("--wait", type=float, default=20.0)
a = ap.parse_args()

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-angle=gl"])
    pg = b.new_page(viewport={"width": 760, "height": 760})
    pg.goto(f"{BASE}?{a.qs}")
    pg.wait_for_function(
        "document.title.startsWith('RENDERED') || document.title.startsWith('CLIP:')",
        timeout=a.wait * 1000)
    pg.wait_for_timeout(300)
    out = os.path.abspath(os.path.join(os.getcwd(), a.out))
    pg.locator("#c").screenshot(path=out)
    print("shot:", out, "title:", pg.title())
    b.close()
