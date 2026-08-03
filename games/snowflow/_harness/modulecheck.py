#!/usr/bin/env python
"""
Run modulecheck.html and print its report.

Seconds, no WebGL context. Use this before bootcheck.py while wiring things up:
it names the broken import, the duplicate chunk registration or the `#include`
pointing at a chunk nobody wrote, instead of leaving you to infer it from a
blank canvas.

    python modulecheck.py
"""
import sys
from playwright.sync_api import sync_playwright

# Windows consoles default to cp1252, which cannot encode the report's box-drawing
# characters — the traceback lands on the print, not on the check, and reads like
# the check itself failed. Force utf-8 before anything writes.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

URL = "http://localhost:8799/games/snowflow/_harness/modulecheck.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox"]


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else URL
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url, wait_until="load", timeout=60_000)
        try:
            pg.wait_for_function("!!globalThis.__MODULECHECK__", timeout=60_000)
        except Exception:
            print(pg.evaluate("document.body.innerText"))
            for e in errs:
                print(f"  pageerror: {e}", file=sys.stderr)
            br.close()
            return 2
        r = pg.evaluate("globalThis.__MODULECHECK__")
        br.close()

    print(r["text"])
    for e in errs:
        print(f"  pageerror: {e}", file=sys.stderr)
    return 0 if not (r["failed"] or r["chunkErr"]) else 1


if __name__ == "__main__":
    sys.exit(main())
