#!/usr/bin/env python
"""
BLACKRIDGE shot battery — drives shots.js -> _shots/iterNN/<scenario>.png.

    python shotbattery.py --iter 3                    # -> _shots/iter03/*.png
    python shotbattery.py --iter 3 --shots S2         # subset while fixing
    python shotbattery.py --iter 3 --url <cdn url>    # same battery vs deployed

One iteration dir per critic round, NEVER overwritten (exit 3) — history must
stay diffable; a re-run of the same iteration goes to iterNN only after the
caller deletes it deliberately. Captures land at 1920x1080 DPR 1.5 (R10/R21)
via `__FPS__.__test.capture()` -> POST /__shot/iterNN/<name>.png into the
shotserver sink (R20) — hidden-tab-proof: the page reads its own render
target back, never a compositor screenshot.

Exit codes: 0 = every requested shot captured AND every `until` fired;
1 = a shot failed or an `until` never fired; 2 = navigation failure;
3 = iteration dir already exists; 4 = NOT READY (game surface missing —
expected until A11 wave-2 core/test/* + the game code land).

Driftwake `shoot.py` lineage minus the two-target A/B comparison, plus
iteration management. Frames, never wall clock, for anything the sim drives.
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
sys.path.insert(0, HERE)
from shotserver import ensure_server, SHOTS_ROOT

DEFAULT_URL = "http://localhost:8841/games/blackridge/index.html"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]


class NotReady(RuntimeError):
    """Harness infrastructure is fine; the GAME surface is not there yet."""


def load_shots_source() -> str:
    # Injected as a classic script, so the ES module syntax has to go.
    src = open(os.path.join(HERE, "shots.js"), encoding="utf-8").read()
    return re.sub(r"^export\s+", "", src, flags=re.M)


BOOTSTRAP = r"""
(() => {
  window.__err = [];
  addEventListener('error', e => window.__err.push(String(e.message)));
  addEventListener('unhandledrejection', e => window.__err.push('reject: ' + e.reason));
  // rAF frame counter for settle waits (frames, not wall clock).
  window.__bkFrames = 0;
  (function tick() { window.__bkFrames++; requestAnimationFrame(tick); })();
  // Belt-and-braces chrome hide on top of __test.hud(false); HUD_SELECTORS
  // comes from the injected shots.js.
  window.__bkChrome = (show) => {
    const sels = (typeof HUD_SELECTORS !== 'undefined') ? HUD_SELECTORS : [];
    for (const sel of sels)
      document.querySelectorAll(sel).forEach(e => { e.style.display = show ? '' : 'none'; });
  };
})();
"""

READY_EXPR = "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"  # R11


def wait_ready(page, timeout_s: float) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            nogpu = page.evaluate(
                "!!(document.getElementById('nogpu') && "
                "document.getElementById('nogpu').classList.contains('show'))")
            if nogpu:
                raise NotReady("page shows #nogpu — WebGL2 unavailable in this Chrome")
            if page.evaluate(READY_EXPR):
                return
        except NotReady:
            raise
        except Exception:
            pass
        page.wait_for_timeout(400)
    phase = ""
    try:
        phase = page.evaluate(
            "(document.getElementById('boot-phase')||{}).textContent || ''")
    except Exception:
        pass
    raise NotReady(
        f"no __FPS__ global after {timeout_s:.0f}s (boot phase={phase!r}) — "
        f"A0 skeleton not booting; run bootcheck.py first")


def require_surface(page) -> None:
    missing = page.evaluate("""() => {
        const t = globalThis.__FPS__ && __FPS__.__test;
        if (!t) return '__FPS__.__test';
        const need = ['setScenario', 'capture', 'hud', 'state', 'counters'];
        const m = need.filter(k => typeof t[k] !== 'function');
        return m.length ? '__FPS__.__test.' + m.join(', __FPS__.__test.') : '';
    }""")
    if missing:
        raise NotReady(
            f"{missing} not implemented yet — core/test/testsurface.js + "
            f"scenarios.js (A11 wave 2) must land before the battery can run")


def settle_frames(page, n: int, giveup_s: float = 30.0) -> None:
    """Let n real rAF frames run — frames, never wall clock."""
    page.evaluate("window.__bkFrames = 0")
    deadline = time.time() + giveup_s
    while time.time() < deadline:
        if page.evaluate("window.__bkFrames") >= n:
            return
        page.wait_for_timeout(25)


def sim_frames(page) -> int:
    return page.evaluate(
        "(() => { try { return __FPS__.stats().frames|0; } catch(e) { return 0; } })()")


def run_script(page, sid: str) -> dict:
    """Interpret a scenario's `script` (C1) with REAL input events (doctrine §5).

    Holds are real keydown (released with real keyup); trigger is real
    mousedown/mouseup on #view; progress is measured in SIM frames via
    __FPS__.stats().frames — the fixed-dt accumulator makes sim frames track
    real time even when Playwright renders slowly. Wall clock appears only as
    a give-up timeout, and the manifest records if it fired.
    """
    steps = page.evaluate(
        "(n) => SCENARIOS[n].script.map(s => Object.assign({}, s))", sid)
    captured_at = None
    gave_up = False
    for step in steps:
        want = int(step.get("frames") or 0)
        start = sim_frames(page)
        if step.get("hold"):
            for code in step["hold"]:
                page.evaluate(
                    "(c) => window.dispatchEvent(new KeyboardEvent('keydown', {code: c, bubbles: true}))",
                    code)
        if step.get("release") == "all":
            for code in ("ShiftLeft", "KeyW", "KeyA", "KeyS", "KeyD"):
                page.evaluate(
                    "(c) => window.dispatchEvent(new KeyboardEvent('keyup', {code: c, bubbles: true}))",
                    code)
        if step.get("press"):
            page.evaluate("""(c) => {
                window.dispatchEvent(new KeyboardEvent('keydown', {code: c, bubbles: true}));
                window.dispatchEvent(new KeyboardEvent('keyup',   {code: c, bubbles: true}));
            }""", step["press"])
        if step.get("fire"):
            page.evaluate("""() => {
                const v = document.getElementById('view');
                v.dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true}));
            }""")
        if want > 0:
            giveup = time.time() + want / 60.0 * 8 + 5.0
            while sim_frames(page) - start < want:
                if time.time() > giveup:
                    gave_up = True
                    break
                page.wait_for_timeout(25)
        if step.get("fire"):
            page.evaluate("""() => {
                const v = document.getElementById('view');
                v.dispatchEvent(new MouseEvent('mouseup', {button: 0, bubbles: true}));
            }""")
        if step.get("captureAt"):
            captured_at = step["captureAt"]
            break  # the PNG for this scenario is taken NOW, by the caller
    return {"capturedAt": captured_at, "scriptGaveUp": gave_up}


def run_shot(page, sid: str, iter_name: str, args) -> dict:
    sc = page.evaluate("(n) => { const s = SCENARIOS[n]; "
                       "return {hud: !!s.hud, settleFrames: s.settleFrames|0, "
                       "seed: s.seed, botSeed: s.botSeed, rainPhase: s.rainPhase, "
                       "hasUntil: !!s.until, hasScript: !!s.script}; }", sid)

    # setScenario consumes the SCENARIOS entry atomically (R21): re-seed every
    # stream, freeze sky/rain phase, zero transient state. The harness passes
    # the object in; the game stores nothing scenario-shaped. Its report
    # (incl. honest warnings about missing freeze hooks) goes in the manifest.
    scen_report = page.evaluate(
        "(n) => __FPS__.__test.setScenario(n, SCENARIOS[n])", sid)

    script_state = {}
    if sc["hasScript"]:
        script_state = run_script(page, sid)

    page.evaluate("(h) => { __FPS__.__test.hud(h); window.__bkChrome(h); }",
                  sc["hud"])
    settle_frames(page, sc["settleFrames"])

    until_reached = True
    if sc["hasUntil"]:
        until_reached = False
        deadline = time.time() + 15.0  # give-up timeout ONLY — not a duration
        while time.time() < deadline:
            if page.evaluate(
                    "(n) => { const F = globalThis.__FPS__; "
                    "return !!(new Function('F', 'return (' + SCENARIOS[n].until + ')'))(F); }",
                    sid):
                until_reached = True
                break
            page.wait_for_timeout(50)

    # Capture: page renders its own RT and POSTs /__shot/<iterNN>/<sid>.png.
    shot_name = f"{iter_name}/{sid}.png"
    page.evaluate(
        "(a) => __FPS__.__test.capture(a.name, a.w, a.h, {dpr: a.dpr})",
        {"name": shot_name, "w": args.width, "h": args.height, "dpr": args.dpr})

    # OBSERVE the effect: the PNG must exist on disk (local sink only).
    out_path = os.path.join(SHOTS_ROOT, iter_name, f"{sid}.png")
    on_disk = False
    deadline = time.time() + 20.0
    while time.time() < deadline:
        if os.path.exists(out_path) and os.path.getsize(out_path) > 1024:
            on_disk = True
            break
        time.sleep(0.25)

    state = page.evaluate("""() => {
        try {
            const s = __FPS__.__test.state();
            const p = (s.player && s.player.pos) || s.playerPos || null;
            return {endPos: p ? p.map(v => +(+v).toFixed(3)) : null,
                    yaw: s.player ? +(+s.player.yaw).toFixed(4) : null,
                    pitch: s.player ? +(+s.player.pitch).toFixed(4) : null,
                    simFrames: (s.frames|0) || null};
        } catch (e) { return {stateError: String(e)}; }
    }""")
    errs = page.evaluate("window.__err || []")
    return {"name": sid, "file": f"{sid}.png", "seed": sc["seed"],
            "botSeed": sc["botSeed"], "rainPhase": sc["rainPhase"],
            "hud": sc["hud"], "untilReached": until_reached,
            "capturedOnDisk": on_disk, "pageErrors": errs,
            "scenario": scen_report,
            **script_state, **state}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iter", type=int, required=True, help="iteration number N -> _shots/iterNN/")
    ap.add_argument("--shots", default="", help="comma-separated subset of scenario ids")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--dpr", type=float, default=1.5)
    ap.add_argument("--ready-timeout", type=float, default=120.0)
    ap.add_argument("--no-reload", action="store_true",
                    help="one page load for the whole battery (fx/decal state carries over)")
    args = ap.parse_args()

    iter_name = f"iter{args.iter:02d}"
    iter_dir = os.path.join(SHOTS_ROOT, iter_name)
    if os.path.exists(iter_dir):
        # History must stay diffable — a re-run overwriting iterNN silently
        # would poison the critic trend table (R21 / harness_plan §2.3).
        print(f"REFUSED: {iter_dir} already exists. Delete it deliberately or "
              f"use --iter {args.iter + 1}.", file=sys.stderr)
        return 3

    ensure_server()  # the /__shot/ sink; also the local page server
    os.makedirs(iter_dir, exist_ok=True)

    shots_src = load_shots_source()
    want = [s.strip() for s in args.shots.split(",") if s.strip()]

    manifest_rows, console_log, failed = [], [], []
    version = None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            page = browser.new_page(viewport={"width": args.width, "height": args.height})
            page.on("console", lambda m: console_log.append(f"[{m.type}] {m.text}"))
            page.on("pageerror", lambda e: console_log.append(f"[pageerror] {e}"))
            page.add_init_script(BOOTSTRAP)

            def fresh():
                page.goto(args.url, wait_until="load", timeout=90_000)
                page.add_script_tag(content=shots_src)
                # setScenario's seed-table fallback: boot's one-arg routing
                # lambda drops the second argument, so the table also rides
                # on a window global scenarios.js knows to read (R21).
                page.evaluate("window.__BR_SEEDS__ = SCENARIOS")
                wait_ready(page, args.ready_timeout)
                require_surface(page)
                settle_frames(page, 30)  # prewarm settle — frames, not wall clock

            try:
                fresh()
            except NotReady:
                raise
            except Exception as e:
                print(f"NAVIGATION FAILED: {e}", file=sys.stderr)
                browser.close()
                return 2

            version = page.evaluate("__FPS__.version || null")
            battery = page.evaluate("BATTERY")
            todo = [s for s in battery if not want or s in want]
            unknown = set(want) - set(battery) - set(
                page.evaluate("Object.keys(SCENARIOS)"))
            if unknown:
                print(f"!! unknown scenario ids: {sorted(unknown)}", file=sys.stderr)

            for i, sid in enumerate(todo):
                if i > 0 and not args.no_reload:
                    fresh()
                try:
                    row = run_shot(page, sid, iter_name, args)
                    manifest_rows.append(row)
                    bad = ((not row["capturedOnDisk"]) or (not row["untilReached"])
                           or row.get("scriptGaveUp", False))
                    if bad:
                        failed.append(sid)
                    print(f"  [{i + 1}/{len(todo)}] {sid}"
                          + ("" if row["capturedOnDisk"] else "  !! PNG never arrived on disk")
                          + ("" if row["untilReached"]
                             else "  !! until() NEVER FIRED — frame not comparable")
                          + ("  !! script GAVE UP on wall clock — frame not comparable"
                             if row.get("scriptGaveUp") else "")
                          + (f"  !! {len(row['pageErrors'])} page errors"
                             if row["pageErrors"] else ""))
                except Exception as e:
                    failed.append(sid)
                    print(f"  !! {sid} FAILED: {e}", file=sys.stderr)

            browser.close()
    except NotReady as e:
        print(f"NOT READY: {e}", file=sys.stderr)
        # Leave no half-claimed iteration dir behind if nothing was captured.
        try:
            if not os.listdir(iter_dir):
                os.rmdir(iter_dir)
        except OSError:
            pass
        return 4

    with open(os.path.join(iter_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"url": args.url, "iter": args.iter, "version": version,
                   "viewport": [args.width, args.height], "dpr": args.dpr,
                   "shots": manifest_rows, "failed": failed}, f, indent=2)
    with open(os.path.join(iter_dir, "console.log"), "w", encoding="utf-8") as f:
        f.write("\n".join(console_log))

    ok = len(manifest_rows) - len([r for r in manifest_rows
                                   if r["name"] in failed])
    print(f"\n{ok}/{len(manifest_rows) if manifest_rows else 0} shots -> {iter_dir}")
    if failed:
        print(f"FAILED: {failed}", file=sys.stderr)
    return 0 if manifest_rows and not failed else 1


if __name__ == "__main__":
    sys.exit(main())
