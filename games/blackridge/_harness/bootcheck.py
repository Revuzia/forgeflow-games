#!/usr/bin/env python
"""
Fast boot check for BLACKRIDGE — the tight feedback loop.

Loads the page once, reports every console message, every shader compile/link
failure and every unhandled rejection, says how far the boot sequence got, and
saves one screenshot. Seconds, not minutes; use this while iterating and save
`shotbattery.py` for when it actually renders.

    python bootcheck.py
    python bootcheck.py --wait 90 --out boot.png

Driftwake `_harness/bootcheck.py` lineage (BUILD_PLAN R20/§A11): URL -> port
8841 blackridge path (R12), ready expression -> the R11 __FPS__ surface, plus
the ensure_server() call; flags / utf-8 preamble / output format kept.
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

# Windows consoles default to cp1252 and cannot encode this script's output; force
# utf-8 before anything writes, or a print raises and masks the real result.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server  # probes 8841, spawns detached if closed

DEFAULT_URL = "http://localhost:8841/games/blackridge/index.html"

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

    if "localhost:8841" in args.url or "127.0.0.1:8841" in args.url:
        ensure_server()  # no harness run depends on a manually-started server

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
                # R11 ready expression (architecture §6, frozen):
                if pg.evaluate("!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"):
                    ready = True
                    break
            except Exception:
                pass
            pg.wait_for_timeout(500)

        pg.wait_for_timeout(2500)  # let a few real frames run
        state = pg.evaluate("""() => {
            const boot = document.getElementById('boot');
            const nogpu = document.getElementById('nogpu');
            const F = globalThis.__FPS__;
            return {
              hasGlobal: !!F,
              members: F ? Object.keys(F) : [],
              // `#boot` ABSENT counts as gone. The loader's `done()` adds the
              // class, then REMOVES the node ~6 seconds later (driftwake
              // core/loading.js:54-57 convention, kept by architecture §7) —
              // so on any run where boot-to-sample took longer than that, a
              // perfectly clean boot would score `bootGone: false` and the
              // whole check would report NOT BOOTING CLEAN (this exact gotcha
              // cost driftwake a false verdict; measured on its port 8875:
              // gone=true at t+500 ms, element absent by t+8000 ms, zero page
              // errors throughout). The other remover is `loading.fail()` —
              // but that one also shows `#nogpu`, which is checked on its own
              // line below, so absence can never hide a hard failure.
              bootGone: !boot || boot.classList.contains('gone'),
              bootPhase: (document.getElementById('boot-phase')||{}).textContent || '',
              nogpu: !!(nogpu && nogpu.classList.contains('show')),
              pageErrors: window.__err || [],
              drawCalls: F && F.perfStats ? F.perfStats.drawCalls : null,
              triangles: F && F.perfStats ? F.perfStats.triangles : null,
              // Ship-blocker registry (doctrine §7 / BUILD_PLAN 5.8): report
              // its CONTENTS every run — an empty list is a positive claim.
              fallbacks: window.__FFG_FALLBACKS__ || null,
              // Pre-warm baseline: perfprobe compares combat-phase `programs`
              // against this number (programs delta == 0 is a FAIL gate).
              programs: F && F.perfStats ? F.perfStats.programs : null,
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
    print(f"__FPS__      {'yes' if state['hasGlobal'] else 'NO'}"
          f"  members={len(state['members'])}")
    print(f"boot         gone={state['bootGone']}  phase={state['bootPhase']!r}"
          f"  nogpu={state['nogpu']}")
    print(f"canvas       {drawn}")
    print(f"draws/tris   {state['drawCalls']} / {state['triangles']}")
    print(f"programs     {state['programs']}  (pre-warm baseline for perfprobe)")
    fb = state.get("fallbacks")
    print(f"fallbacks    {'EMPTY (ship-clean)' if fb == [] else fb!r}"
          f"  (__FFG_FALLBACKS__ — non-empty = ship blocker, BUILD_PLAN 5.8)")
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
