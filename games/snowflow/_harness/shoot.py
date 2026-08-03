#!/usr/bin/env python
"""
SNOWFLOW comparison harness.

Drives the WebGPU reference and the Three.js port through the identical shot
battery in `shots.js` and writes matched PNGs, so a critic can compare them
frame for frame.

    python shoot.py --url https://snowflow-lilac.vercel.app/ --out shots/ref
    python shoot.py --url http://localhost:8799/games/snowflow/index.html --out shots/port
    python shoot.py ... --shots 01-hero,04-backlit-sss     # subset while iterating

Both targets must expose the same `globalThis.SNOWFLOW` surface (see shots.js).
Exit code is 0 only if every requested shot was captured.
"""
import argparse, json, os, re, sys, time
from playwright.sync_api import sync_playwright

# Windows consoles default to cp1252 and cannot encode this script's output; force
# utf-8 before anything writes, or a print raises and masks the real result.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


HERE = os.path.dirname(os.path.abspath(__file__))

CHROME_FLAGS = [
    "--enable-unsafe-webgpu",
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
    "--use-angle=d3d11",
    "--disable-gpu-sandbox",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
]

# Injected as a classic script, so the ES module syntax has to go.
def load_shots_source() -> str:
    src = open(os.path.join(HERE, "shots.js"), encoding="utf-8").read()
    return re.sub(r"^export\s+const\s+SHOTS", "const SHOTS", src, flags=re.M)


BOOTSTRAP = r"""
(() => {
  // Wait for the demo to have finished its own loading sequence.
  window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const boot = document.getElementById('boot');
    if (boot && !boot.classList.contains('gone')) return false;
    const fail = document.getElementById('nogpu');
    if (fail && fail.classList.contains('show')) throw new Error('target reported no GPU');
    return true;
  };
  // Chrome them out: we are comparing rendered frames, not HUDs.
  window.__sfChrome = () => {
    for (const sel of ['#boot', '#hint', '#overlay', '.overlay', '#perf']) {
      document.querySelectorAll(sel).forEach(e => { e.style.display = 'none'; });
    }
  };
  window.__sfErrors = [];
  addEventListener('error', e => window.__sfErrors.push(String(e.message)));
  addEventListener('unhandledrejection', e => window.__sfErrors.push('reject: ' + e.reason));
})();
"""


def wait_ready(page, timeout_s: float) -> None:
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        try:
            if page.evaluate("window.__sfReady && window.__sfReady()"):
                return
        except Exception as e:
            last = str(e)
            if "no GPU" in last:
                raise RuntimeError("target reported no GPU support")
        page.wait_for_timeout(400)
    phase = ""
    try:
        phase = page.evaluate("(document.getElementById('boot-phase')||{}).textContent || ''")
    except Exception:
        pass
    raise TimeoutError(f"target never became ready (boot phase={phase!r}) {last}")


def run_shot(page, shot: dict, settle_scale: float) -> None:
    name = shot["name"]
    page.evaluate("window.__sfChrome()")
    # pose
    page.evaluate("(n) => { const s = SHOTS.find(x=>x.name===n); s.pose(globalThis.SNOWFLOW); }", name)

    walk = float(shot.get("walk") or 0)
    if walk > 0:
        end = time.time() + walk
        while time.time() < end:
            page.evaluate(
                "(n) => { const s = SHOTS.find(x=>x.name===n); if (s.hold) s.hold(globalThis.SNOWFLOW); }",
                name,
            )
            page.wait_for_timeout(100)

    if shot.get("hasAfter"):
        page.evaluate("(n) => { const s = SHOTS.find(x=>x.name===n); s.after(globalThis.SNOWFLOW); }", name)

    settle = float(shot.get("settle") or 1.0) * settle_scale
    end = time.time() + settle
    while time.time() < end:
        page.evaluate(
            "(n) => { const s = SHOTS.find(x=>x.name===n); if (s.hold) s.hold(globalThis.SNOWFLOW); }",
            name,
        )
        page.wait_for_timeout(100)
    # Re-hide: an overlay can be toggled back on by a stray key.
    page.evaluate("window.__sfChrome()")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--shots", default="", help="comma-separated subset of shot names")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--ready-timeout", type=float, default=120.0)
    ap.add_argument("--settle-scale", type=float, default=1.0)
    ap.add_argument("--no-reload", action="store_true",
                    help="one page load for the whole battery (faster, but deformation carries over)")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    shots_src = load_shots_source()
    want = [s.strip() for s in args.shots.split(",") if s.strip()]

    manifest, console_log, ok, failed = [], [], 0, []

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=False, args=CHROME_FLAGS)
        page = browser.new_page(viewport={"width": args.width, "height": args.height})
        page.on("console", lambda m: console_log.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: console_log.append(f"[pageerror] {e}"))
        page.add_init_script(BOOTSTRAP)

        def fresh():
            page.goto(args.url, wait_until="load", timeout=90_000)
            page.add_script_tag(content=shots_src)
            wait_ready(page, args.ready_timeout)
            # A moment of real frames so the first-frame pipeline warm-up is done.
            page.wait_for_timeout(1200)

        fresh()
        meta = page.evaluate(
            "SHOTS.map(s => ({name:s.name, desc:s.desc, tests:s.tests, settle:s.settle,"
            " walk:s.walk||0, hasAfter:!!s.after, hasHold:!!s.hold}))"
        )
        todo = [m for m in meta if not want or m["name"] in want]
        if want and len(todo) != len(want):
            missing = set(want) - {m["name"] for m in todo}
            print(f"!! unknown shot names: {sorted(missing)}", file=sys.stderr)

        for i, shot in enumerate(todo):
            if i > 0 and not args.no_reload:
                fresh()
            try:
                run_shot(page, shot, args.settle_scale)
                path = os.path.join(args.out, shot["name"] + ".png")
                page.screenshot(path=path)
                errs = page.evaluate("window.__sfErrors || []")
                manifest.append({**shot, "file": os.path.basename(path), "pageErrors": errs})
                ok += 1
                print(f"  [{ok}/{len(todo)}] {shot['name']}"
                      + (f"  !! {len(errs)} page errors" if errs else ""))
            except Exception as e:
                failed.append(shot["name"])
                print(f"  !! {shot['name']} FAILED: {e}", file=sys.stderr)

        browser.close()

    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"url": args.url, "viewport": [args.width, args.height],
                   "shots": manifest, "failed": failed}, f, indent=2)
    with open(os.path.join(args.out, "console.log"), "w", encoding="utf-8") as f:
        f.write("\n".join(console_log))

    print(f"\n{ok}/{len(todo)} shots -> {args.out}")
    if failed:
        print(f"FAILED: {failed}", file=sys.stderr)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
