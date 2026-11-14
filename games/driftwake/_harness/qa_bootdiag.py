"""Boot diagnosis without screenshots: is the tree booting, erroring, or just
starved of frames by machine load?

Prints: time to SNOWFLOW ready, page errors, console errors, rAF frames
delivered over 5 s of wall time, registry game-time advance, perfStats.

    python -u _harness/qa_bootdiag.py --url http://localhost:8871/games/driftwake/index.html
"""
import argparse
import sys
import time

from playwright.sync_api import sync_playwright

FLAGS = ["--use-angle=d3d11", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
         "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
         "--disable-backgrounding-occluded-windows"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8871/games/driftwake/index.html")
    ap.add_argument("--wait", type=float, default=180.0)
    a = ap.parse_args()
    errs, cons = [], []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: cons.append(m.text) if m.type == "error" else None)
        t0 = time.time()
        pg.goto(a.url, wait_until="commit", timeout=120_000)
        print(f"commit at {time.time() - t0:.1f}s", flush=True)
        ready = False
        pg.evaluate("window.__rafN=0;(function f(){window.__rafN++;requestAnimationFrame(f)})()")
        last = 0.0
        while time.time() - t0 < a.wait:
            try:
                ready = pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)")
            except Exception:
                ready = False
            if ready:
                break
            if time.time() - last > 15:
                last = time.time()
                try:
                    s = pg.evaluate("[window.__rafN,(document.getElementById('boot-phase')||{}).textContent,"
                                    "document.readyState,performance.getEntriesByType('resource').length]")
                except Exception as e:
                    s = "eval failed: " + str(e)[:120]
                print(f"  t={time.time() - t0:.0f}s rAF/phase/ready/resources = {s}", flush=True)
            time.sleep(1.0)
        print(f"ready={ready} at {time.time() - t0:.1f}s", flush=True)
        phase = pg.evaluate("(document.getElementById('boot-phase')||{}).textContent||'(boot gone)'")
        print("boot phase:", phase)
        st = pg.evaluate("""() => new Promise(res => {
            let n = 0; const t = performance.now();
            const g0 = globalThis.SNOWFLOW && SNOWFLOW.combat && SNOWFLOW.combat.registry
                ? SNOWFLOW.combat.registry.time : null;
            function f() { n++; if (performance.now() - t < 5000) requestAnimationFrame(f);
                else res({frames: n, g0, g1: globalThis.SNOWFLOW && SNOWFLOW.combat
                    && SNOWFLOW.combat.registry ? SNOWFLOW.combat.registry.time : null,
                    perf: globalThis.SNOWFLOW && SNOWFLOW.perfStats
                    ? {d: SNOWFLOW.perfStats.drawCalls, t: SNOWFLOW.perfStats.triangles} : null,
                    keys: globalThis.SNOWFLOW ? Object.keys(SNOWFLOW).length : 0}); }
            requestAnimationFrame(f);
            setTimeout(() => res({frames: n, timeout: true}), 20000);
        })""")
        print("rAF 5s:", st, flush=True)
        print(f"page errors ({len(errs)}):")
        for e in errs[:10]:
            print("  ", e[:300])
        print(f"console errors ({len(cons)}):")
        for e in cons[:10]:
            print("  ", e[:300])
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
