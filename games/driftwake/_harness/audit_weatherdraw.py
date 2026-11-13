#!/usr/bin/env python
"""Focused weather draw-call delta: frozen clock, enemies cleared, 8 samples
per state per realm. Claim: showWeather on/off = +1 draw call.

    python _harness/audit_weatherdraw.py
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding",
         "--disable-background-timer-throttling"]

URL = "http://localhost:8799/games/driftwake/index.html?v=auditweather"

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.combat || !SF.enterRealm) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

CLEAR = """() => {
  const en = globalThis.SNOWFLOW.combat.enemies;
  const n = en.aliveCount;
  let err = null;
  try { en.clear(); } catch (e) { err = String(e); }
  if (en.aliveCount > 0) {
    for (let i = 0; i < en.alive.length; i++) {
      if (!en.alive[i]) continue;
      try { en.despawn(en.id[i]); } catch (e) {
        en.alive[i] = 0;
        try { en.registry.remove(en.id[i]); } catch (e2) {}
        try { if (en.vis) en.vis.free(i); } catch (e3) {}
      }
    }
  }
  return { cleared: n, now: en.aliveCount, clearError: err };
}"""


def main():
    errors = []
    out = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto(URL, wait_until="load", timeout=90_000)
        pg.bring_to_front()
        pg.wait_for_function(READY, timeout=240_000)

        def frames(n):
            s = pg.evaluate("() => window.__f")
            try:
                pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s,
                                     timeout=90_000)
            except Exception:
                pg.bring_to_front()
                pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s,
                                     timeout=90_000)

        def sample(k=8):
            v = []
            for _ in range(k):
                frames(2)
                v.append(pg.evaluate(
                    "() => globalThis.SNOWFLOW.perfStats.drawCalls"))
            return v

        time.sleep(3.0)
        frames(60)

        for realm in ("cold", "sand", "ash"):
            if realm != "cold":
                pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
                pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", realm)
                time.sleep(4.0)
                frames(60)
            cl = pg.evaluate(CLEAR)
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
            frames(4)
            on = sample()
            pg.evaluate("() => globalThis.SNOWFLOW.set('showWeather', false)")
            frames(6)
            off = sample()
            pg.evaluate("() => globalThis.SNOWFLOW.set('showWeather', true)")
            frames(4)
            on2 = sample(4)
            out[realm] = {"clear": cl, "on": on, "off": off, "onAgain": on2}
            print(f"{realm:<5} on={on} off={off} onAgain={on2} clear={cl}")

        print(f"errors {len(errors)}")
        for e in errors[:6]:
            print("  ", e)
        br.close()
    with open("_shots/audit_weatherdraw.json", "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
