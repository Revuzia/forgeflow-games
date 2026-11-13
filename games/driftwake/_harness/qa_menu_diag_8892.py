# -*- coding: utf-8 -*-
"""qa_menu_diag_8892.py -- what the title screen actually is, in the DOM."""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8892
BASE = "http://localhost:%d/games/driftwake/index.html" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

DUMP = r"""() => {
    const out = [];
    const walk = (n, d) => {
        if (d > 4) return;
        for (const c of n.children) {
            out.push({ d, tag: c.tagName, id: c.id, cls: c.className,
                       disp: getComputedStyle(c).display,
                       txt: (c.textContent || '').trim().slice(0, 46) });
            walk(c, d + 1);
        }
    };
    walk(document.body, 0);
    return { freeze: SNOWFLOW.S.freezeTime,
             btns: Array.from(document.querySelectorAll('button'))
                 .map((b) => ({ t: (b.textContent || '').trim(),
                                vis: !!b.offsetParent })),
             tree: out.slice(0, 40) };
}"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(BASE, wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW", timeout=180000)
            for t in (1000, 4000, 9000):
                pg.wait_for_timeout(t if t == 1000 else t - 1000)
                d = pg.evaluate(DUMP)
                print("\n=== t~%dms  freezeTime=%s" % (t, d["freeze"]))
                print("BUTTONS:", json.dumps(d["btns"]))
                for r in d["tree"]:
                    print("   " + "  " * r["d"] +
                          "%s#%s.%s [%s] %r" % (r["tag"], r["id"],
                                                str(r["cls"])[:20], r["disp"],
                                                r["txt"]))
            pg.screenshot(path=str(Path(__file__).with_name(
                "qa_menu_diag_8892.png")))
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
