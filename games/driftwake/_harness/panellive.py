#!/usr/bin/env python
"""The settings panel must stay a LIVE control across a realm swap.

`enterRealm` now writes seven of the panel's own keys (REALM_CONTRACT §1c fog +
§1f tone). Two ways that can go wrong, and both look fine from `S`:

  DEAD   the realm writes `S` and the widget keeps showing the old number, so
         the readout disagrees with the setting in force -- the "lever that
         lies" `core/settings.js`'s header exists to prevent.
  FIGHT  the realm overwrites what the operator dialled in, so a drag is
         silently discarded by the next swap.

So this drives the actual DOM widget the way a hand does (set `input.value`,
dispatch `input`, which is what `ui/overlay.js`'s `oninput` listens for) and
reads the rendered readout back after every step.

    python _harness/panellive.py
"""
import json
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

URL = "http://localhost:8788/games/driftwake/index.html?v=panellive"

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.enterRealm || !SF.overlay) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

# The widget as the DOM has it, found by its SCHEMA label.
READ = """(label) => {
  for (const row of document.querySelectorAll('.row')) {
    const l = row.querySelector('label');
    if (!l || l.textContent.trim() !== label) continue;
    const r = row.querySelector('input[type=range]');
    const v = row.querySelector('.val');
    return { slider: r ? r.value : null, readout: v ? v.textContent : null };
  }
  return { slider: null, readout: null };
}"""

DRAG = """([label, value]) => {
  for (const row of document.querySelectorAll('.row')) {
    const l = row.querySelector('label');
    if (!l || l.textContent.trim() !== label) continue;
    const r = row.querySelector('input[type=range]');
    r.value = String(value);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  return false;
}"""


def main():
    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto(URL, wait_until="load", timeout=90_000)
        pg.wait_for_function(READY, timeout=240_000)

        def frames(n):
            s = pg.evaluate("() => window.__f")
            pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s, timeout=120_000)

        def snap(tag):
            row = {}
            for lab in ("Exposure", "Fog density", "Height falloff", "Bloom amt"):
                row[lab] = pg.evaluate(READ, lab)
            row["S"] = pg.evaluate("""() => {const S=globalThis.SNOWFLOW.S;
                return {exposure:S.exposure, fogDensity:S.fogDensity,
                        fogHeightFalloff:S.fogHeightFalloff,
                        bloomStrength:S.bloomStrength};}""")
            print(f"\n[{tag}]")
            print(json.dumps(row, indent=1))
            return row

        pg.evaluate("() => globalThis.SNOWFLOW.overlay.setPanel('settings', true)")
        frames(10)
        snap("cold, panel just opened")

        pg.evaluate("() => globalThis.SNOWFLOW.enterRealm('ash')")
        frames(120)
        a = snap("after enterRealm('ash') — widget must READ ASH, not cold")

        pg.evaluate(DRAG, ["Exposure", 0.36])
        frames(10)
        d = snap("after dragging Exposure to 0.36 — the panel must still WRITE")

        pg.evaluate("() => globalThis.SNOWFLOW.enterRealm('cold')")
        frames(120)
        c = snap("back in cold — the +20% drag must survive as a RATIO")

        # 0.105 x 1.2 = 0.126, which is NOT on exposure's 0.005 step grid, so the
        # applied value is the nearest point that is: 0.125. That snap is the
        # whole reason `settings.js` has `snapToWidget` -- an unsnapped 0.126
        # leaves the thumb at 0.125 while S reads 0.126, and a handle that
        # disagrees with its own value is exactly what this probe is here to
        # catch. The RATIO is not snapped, only the value: the offset stays 1.2.
        print("\n--- verdict ---")
        ok_read = abs(float(a["Exposure"]["slider"]) - 0.300) < 1e-6
        ok_write = abs(d["S"]["exposure"] - 0.36) < 1e-6
        ok_rebase = abs(c["S"]["exposure"] - 0.125) < 1e-9
        ok_sync = abs(float(c["Exposure"]["slider"]) - c["S"]["exposure"]) < 1e-9
        print(f"  widget repaints on swap   {ok_read}   (ash slider "
              f"{a['Exposure']['slider']})")
        print(f"  widget still writes S     {ok_write}   (S.exposure "
              f"{d['S']['exposure']})")
        print(f"  drag survives as a ratio  {ok_rebase}   (cold S.exposure "
              f"{c['S']['exposure']}, want 0.105 x 1.2 = 0.126 snapped to 0.125)")
        print(f"  widget agrees with S      {ok_sync}   (slider "
              f"{c['Exposure']['slider']} vs S {c['S']['exposure']})")
        print(f"  errors {len(errors)}")
        for e in errors[:8]:
            print("  ", e)
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
