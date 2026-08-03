#!/usr/bin/env python
"""
Fast boot check for the SNOWFLOW port — the tight feedback loop.

Loads the page once, reports every console message, every shader compile/link
failure and every unhandled rejection, says how far the boot sequence got, and
saves one screenshot. Seconds, not minutes; use this while iterating and save
`shoot.py` for when it actually renders.

    python bootcheck.py
    python bootcheck.py --wait 90 --out boot.png
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8788/games/snowflow/index.html"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

# Three logs shader compile errors through console.error with the source inline;
# these substrings are how we tell a real GLSL failure from ordinary chatter.
SHADER_MARKERS = ("THREE.WebGLProgram", "THREE.WebGLShader", "ERROR:", "gl.getShaderInfoLog",
                  "Program Info Log", "VALIDATE_STATUS", "shader")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--wait", type=float, default=120.0, help="seconds to wait for boot")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "_shots", "bootcheck.png"))
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    msgs, errors = [], []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("console", lambda m: msgs.append((m.type, m.text)))
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.add_init_script(
            "window.__err=[];addEventListener('error',e=>window.__err.push(String(e.message)));"
            "addEventListener('unhandledrejection',e=>window.__err.push('reject: '+e.reason));"
        )
        try:
            pg.goto(args.url, wait_until="load", timeout=60_000)
        except Exception as e:
            print(f"NAVIGATION FAILED: {e}", file=sys.stderr)
            br.close()
            return 2

        ready, deadline = False, time.time() + args.wait
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                    ready = True
                    break
            except Exception:
                pass
            pg.wait_for_timeout(500)

        pg.wait_for_timeout(2500)  # let a few real frames run
        state = pg.evaluate("""() => {
            const boot = document.getElementById('boot');
            const nogpu = document.getElementById('nogpu');
            const SF = globalThis.SNOWFLOW;
            return {
              hasGlobal: !!SF,
              members: SF ? Object.keys(SF) : [],
              bootGone: !!(boot && boot.classList.contains('gone')),
              bootPhase: (document.getElementById('boot-phase')||{}).textContent || '',
              nogpu: !!(nogpu && nogpu.classList.contains('show')),
              pageErrors: window.__err || [],
              drawCalls: SF && SF.perfStats ? SF.perfStats.drawCalls : null,
              triangles: SF && SF.perfStats ? SF.perfStats.triangles : null,
            };
        }""")
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        pg.screenshot(path=args.out)

        # Is anything actually being drawn, or is it a flat fill?
        drawn = pg.evaluate("""() => {
            const c = document.getElementById('view');
            if (!c) return 'no #view canvas';
            return {w: c.width, h: c.height,
                    css: c.clientWidth + 'x' + c.clientHeight};
        }""")
        br.close()

    shader_errs = [t for ty, t in msgs
                   if ty == "error" and any(m in t for m in SHADER_MARKERS)]
    other_errs = [t for ty, t in msgs if ty == "error" and t not in shader_errs]
    warns = [t for ty, t in msgs if ty == "warning"]

    print(f"URL          {args.url}")
    print(f"SNOWFLOW     {'yes' if state['hasGlobal'] else 'NO'}"
          f"  members={len(state['members'])}")
    print(f"boot         gone={state['bootGone']}  phase={state['bootPhase']!r}"
          f"  nogpu={state['nogpu']}")
    print(f"canvas       {drawn}")
    print(f"draws/tris   {state['drawCalls']} / {state['triangles']}")
    print(f"screenshot   {args.out}")

    def dump(title, items, limit=25):
        print(f"\n--- {title} ({len(items)}) ---")
        for t in items[:limit]:
            print("  " + t.replace("\n", "\n    ")[:2000])
        if len(items) > limit:
            print(f"  ... {len(items)-limit} more")

    if shader_errs:
        dump("SHADER COMPILE / LINK FAILURES", shader_errs)
    if state["pageErrors"]:
        dump("UNCAUGHT PAGE ERRORS", state["pageErrors"])
    if errors:
        dump("PAGE ERROR EVENTS", errors)
    if other_errs:
        dump("CONSOLE ERRORS", other_errs)
    if warns:
        dump("WARNINGS", warns, limit=12)

    ok = (ready and state["bootGone"] and not state["nogpu"]
          and not shader_errs and not state["pageErrors"] and not errors)
    print(f"\nRESULT: {'OK' if ok else 'NOT BOOTING CLEAN'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
