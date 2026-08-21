#!/usr/bin/env python
"""
LANE E — settings UI probe. Opens the REAL settings overlay through the real
menu path, drives the REAL <input type=range> elements with real `input`
events, and checks that every aim/perf row exists, writes through
settings.set(), persists to localStorage, and reaches the thing it controls
(input._lookScale for sensitivity, renderer pixel ratio for render scale).

Screenshots the panel so the rows can be read, not assumed.

    python settingsprobe.py
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server

URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

CHECK = r"""() => {
  const out = { rows: [], errors: [] };
  const panel = document.querySelector('#settings-overlay .a10-panel');
  if (!panel) { out.errors.push('no settings panel in the DOM'); return out; }
  out.visible = document.getElementById('settings-overlay').style.display !== 'none';
  for (const el of panel.querySelectorAll('.a10-row')) {
    const inp = el.querySelector('input[type=range]');
    const seg = el.querySelector('.a10-seg');
    out.rows.push({
      label: (el.querySelector('.lbl') || {}).textContent || '',
      key: inp ? inp.getAttribute('data-k') : (seg ? seg.getAttribute('data-k') : null),
      value: inp ? inp.value : null,
      min: inp ? inp.min : null, max: inp ? inp.max : null, step: inp ? inp.step : null,
      shown: (el.querySelector('.val') || {}).textContent || '',
      hint: (el.querySelector('.hint') || {}).textContent || '',
    });
  }
  return out;
}"""

DRIVE = r"""(spec) => {
  // A REAL input event on the REAL slider — the same path a drag produces.
  const el = document.querySelector(`#settings-overlay input[data-k="${spec.key}"]`);
  if (!el) return { ok: false, why: 'no slider for ' + spec.key };
  el.value = String(spec.to);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const raw = localStorage.getItem('blackridge.settings.v1');
  return {
    ok: true,
    live: __FPS__.settings[spec.key],
    shown: (document.querySelector(`#settings-overlay .val[data-v="${spec.key}"]`) || {}).textContent,
    hint: (document.querySelector(`#settings-overlay .hint[data-h="${spec.key}"]`) || {}).textContent,
    persisted: raw ? JSON.parse(raw)[spec.key] : null,
  };
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "..", "_shots", "settings_panel.png"))
    ap.add_argument("--json", default=os.path.join(HERE, "..", "_shots", "settingsprobe.json"))
    args = ap.parse_args()
    ensure_server()

    res = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until="load", timeout=60_000)
        t0 = time.time()
        while time.time() - t0 < 150:
            if pg.evaluate("!!(globalThis.__FPS__ && __FPS__.renderer)"):
                break
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)

        # Open through the real overlay api the menu button calls.
        pg.evaluate("() => window.__FFG_SHELL__ ? 0 : 0")
        pg.evaluate("""() => {
            const s = (window.__FFG_SHELL__ || {}).settingsUI;
            if (s) { s.show(); return 'shell'; }
            // shell isn't a documented global; fall back to the menu button.
            const b = Array.from(document.querySelectorAll('button'))
              .find(x => /settings|options/i.test(x.textContent || ''));
            if (b) { b.click(); return 'menu-button'; }
            return 'none';
        }""")
        pg.wait_for_timeout(600)
        res["panel"] = pg.evaluate(CHECK)

        if not res["panel"].get("visible"):
            # last resort: the module stashes itself on the hud shell object
            pg.evaluate("""() => { for (const k of Object.getOwnPropertyNames(window)) {
                 const v = window[k];
                 if (v && v.settingsUI && typeof v.settingsUI.show === 'function') { v.settingsUI.show(); return k; }
               } return null; }""")
            pg.wait_for_timeout(600)
            res["panel"] = pg.evaluate(CHECK)

        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        pg.screenshot(path=args.out)

        res["drive"] = {}
        for key, to in (("sens", 0.45), ("adsSens", 0.80), ("renderScale", 0.75)):
            r = pg.evaluate(DRIVE, {"key": key, "to": to})
            pg.wait_for_timeout(400)
            if key == "sens":
                r["lookScaleNow"] = pg.evaluate("() => window.__INPUT__._lookScale()")
            if key == "renderScale":
                r["rendererPixelRatio"] = pg.evaluate("() => __FPS__.renderer.getPixelRatio()")
                r["dynres"] = pg.evaluate("() => globalThis.__BR_DYNRES__.report()")
            res["drive"][key] = r
            print(f"[drive] {key} -> {json.dumps(r)}", flush=True)

        # reload the page and confirm the values SURVIVED (real persistence)
        pg.goto(URL, wait_until="load", timeout=60_000)
        t0 = time.time()
        while time.time() - t0 < 150:
            if pg.evaluate("!!(globalThis.__FPS__ && __FPS__.renderer)"):
                break
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)
        res["afterReload"] = pg.evaluate("""() => ({
            sens: __FPS__.settings.sens, adsSens: __FPS__.settings.adsSens,
            renderScale: __FPS__.settings.renderScale,
            pixelRatio: __FPS__.renderer.getPixelRatio(),
            buffer: __FPS__.renderer.domElement.width + 'x' + __FPS__.renderer.domElement.height,
        })""")
        print(f"[reload] {json.dumps(res['afterReload'])}", flush=True)
        # leave the box as we found it
        pg.evaluate("() => { localStorage.removeItem('blackridge.settings.v1'); }")
        res["pageErrors"] = errs + pg.evaluate("() => window.__BOOT_ERRORS__ || []")
        br.close()

    with open(args.json, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2)
    print(json.dumps(res, indent=2)[:4000], flush=True)
    print("\nscreenshot " + os.path.abspath(args.out), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
