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
1 = a shot failed (no PNG, near-black frame, unfired `until`, script
give-up, or a per-shot load that kept failing after retries); 2 = FIRST
load failed after retries; 3 = iteration dir already exists; 4 = NOT READY
(game surface missing — expected until A11 wave-2 core/test/* + the game
code land). NOT READY is only ever decided on the FIRST load: once shots
are running, every failure is per-shot, the loop continues, and the
manifest is ALWAYS written (iter01 regression: an aborted mid-run reload
used to eat the manifest and print a false "#nogpu" NOT-READY).

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
from shotserver import ensure_server, SHOTS_ROOT, PORT as SERVER_PORT, _port_open, _is_ours

DEFAULT_URL = "http://localhost:8841/games/blackridge/index.html"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]


class NotReady(RuntimeError):
    """Harness infrastructure is fine; the GAME surface is not there yet."""


class BootFailed(RuntimeError):
    """ONE page load failed to boot (boot error / transient WebGL churn).

    Retryable — a fresh navigation re-runs the capability gate and the boot.
    Distinct from NotReady: boot.js fail() shows #nogpu for ANY boot error,
    so '#nogpu is showing' must never be reported as 'WebGL2 unavailable'
    unless __BR_CAPS__ actually says the capability probe failed AND it keeps
    failing across fresh loads (iter01 lesson: one transient #nogpu on the
    5th reload aborted the whole battery with a false NOT-READY line).
    """


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

# One evaluate per poll: ready state + full #nogpu forensics in the same
# snapshot, so the diagnosis is what the page ACTUALLY showed, not a guess.
BOOT_PROBE = """() => {
    const el = document.getElementById('nogpu');
    const caps = window.__BR_CAPS__ || null;
    return {
        ready: !!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim),
        nogpu: !!(el && el.classList.contains('show')),
        panel: (el && el.classList.contains('show')) ? String(el.innerText || '').slice(0, 300) : '',
        capsOk: caps ? !!caps.ok : null,
        capsFatal: caps ? caps.fatal : null,
        bootErrors: (window.__BOOT_ERRORS__ || []).slice(0, 4).map(String),
        phase: (document.getElementById('boot-phase') || {}).textContent || '',
    };
}"""


def wait_ready(page, timeout_s: float) -> None:
    """Wait for the game surface; raise BootFailed (retryable) on #nogpu.

    #nogpu.show has TWO generators (index.html cap gate + boot.js fail()),
    so it is diagnosed, never assumed: only a capability-gate verdict is
    reported as a GPU problem, and even that is retryable — Chrome's WebGL2
    probe can fail transiently under the context churn of reload-per-shot.
    """
    deadline = time.time() + timeout_s
    st = {}
    while time.time() < deadline:
        try:
            st = page.evaluate(BOOT_PROBE)
        except Exception:
            st = {}
        if st.get("ready"):
            return
        if st.get("nogpu"):
            if st.get("capsOk") is False:
                raise BootFailed(
                    f"capability gate refused this load: missing {st.get('capsFatal')} "
                    f"(healthy GPUs hit this transiently under reload context churn)")
            raise BootFailed(
                f"boot FAILED with #nogpu shown (NOT a GPU verdict) — "
                f"boot errors: {st.get('bootErrors') or 'none recorded'}; "
                f"panel: {st.get('panel')!r}")
        page.wait_for_timeout(400)
    raise NotReady(
        f"no __FPS__ global after {timeout_s:.0f}s (boot phase={st.get('phase')!r}, "
        f"boot errors={st.get('bootErrors')!r}) — A0 skeleton not booting; "
        f"run bootcheck.py first")


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


def sim_ticks(page) -> int:
    # REAL sim ticks (fixed-dt), not rendered frames — stats().frames counts
    # rAF renders, which pace differently when Playwright renders slowly.
    return page.evaluate(
        "(() => { try { return __FPS__.sim.state.tick|0; } "
        "catch(e) { try { return __FPS__.stats().frames|0; } catch(e2) { return 0; } } })()")


def wait_sim_ticks(page, want: int, start: int | None = None) -> bool:
    """Poll until `want` sim ticks elapsed past `start`; False = wall-clock give-up."""
    if start is None:
        start = sim_ticks(page)
    giveup = time.time() + want / 60.0 * 8 + 5.0
    while sim_ticks(page) - start < want:
        if time.time() > giveup:
            return False
        page.wait_for_timeout(25)
    return True


def run_script(page, sid: str) -> dict:
    """Interpret a scenario's `script` (C1) with REAL input events (doctrine §5).

    Holds are real keydown (released with real keyup); trigger is real
    mousedown/mouseup on #view; progress is measured in SIM TICKS
    (__FPS__.sim.state.tick — the fixed-dt clock). Wall clock appears only as
    a give-up timeout, and the manifest records if it fired.
    """
    steps = page.evaluate(
        "(n) => SCENARIOS[n].script.map(s => Object.assign({}, s))", sid)
    captured_at = None
    gave_up = False
    for step in steps:
        want = int(step.get("frames") or 0)
        start = sim_ticks(page)
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
            # A press must SPAN sim ticks: keydown+keyup in one JS task flips
            # input.state before any fixed-dt cmd build samples it, so the sim
            # never sees the key (iter01 root cause: C1's KeyR reload never
            # started and `until reloads > 0` could not fire). Hold the key
            # across >=3 real ticks, then release with a real keyup.
            page.evaluate(
                "(c) => window.dispatchEvent(new KeyboardEvent('keydown', {code: c, bubbles: true}))",
                step["press"])
            if not wait_sim_ticks(page, 3):
                gave_up = True
            page.evaluate(
                "(c) => window.dispatchEvent(new KeyboardEvent('keyup', {code: c, bubbles: true}))",
                step["press"])
        if step.get("fire"):
            page.evaluate("""() => {
                const v = document.getElementById('view');
                v.dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true}));
            }""")
        if want > 0:
            if not wait_sim_ticks(page, want, start):
                gave_up = True
        if step.get("fire"):
            page.evaluate("""() => {
                const v = document.getElementById('view');
                v.dispatchEvent(new MouseEvent('mouseup', {button: 0, bubbles: true}));
            }""")
        if step.get("captureAt"):
            captured_at = step["captureAt"]
            break  # the PNG for this scenario is taken NOW, by the caller
    return {"capturedAt": captured_at, "scriptGaveUp": gave_up}


def wait_until(page, sid: str, timeout_s: float = 15.0) -> bool:
    deadline = time.time() + timeout_s  # give-up timeout ONLY — not a duration
    while time.time() < deadline:
        if page.evaluate(
                "(n) => { const F = globalThis.__FPS__; "
                "return !!(new Function('F', 'return (' + SCENARIOS[n].until + ')'))(F); }",
                sid):
            return True
        page.wait_for_timeout(50)
    return False


def png_mean_luma(path: str):
    """Mean 0-255 luma of a PNG, or None if Pillow is unavailable.

    An all-black/near-black capture is a FAILED capture (a night scene still
    reads well above black); the battery must say so, not hand the critic a
    void frame as if it were the game.
    """
    try:
        from PIL import Image, ImageStat
        with Image.open(path) as im:
            g = im.convert("L")
            g.thumbnail((192, 108))
            return round(ImageStat.Stat(g).mean[0], 2)
    except Exception:
        return None


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

    # HUD state + settle FIRST — for a scripted scenario the capture fires the
    # instant the script hits captureAt; nothing may drift that moment.
    page.evaluate("(h) => { __FPS__.__test.hud(h); window.__bkChrome(h); }",
                  sc["hud"])
    settle_frames(page, sc["settleFrames"])

    script_state = {}
    if sc["hasScript"]:
        script_state = run_script(page, sid)

    # `until` ordering differs by kind. Posed scenario: gate BEFORE capture
    # (the world is held; until re-arms/validates the framed state). Scripted
    # scenario: capture at the captureAt moment, gate AFTER — C1's
    # "reloads > 0" only fires when the reload COMPLETES, ~1.2 s after the
    # reload-mid frame the capture must freeze; waiting first would
    # deliberately outlive the moment being photographed.
    until_reached = True
    if sc["hasUntil"] and not sc["hasScript"]:
        until_reached = wait_until(page, sid)

    # Capture: page renders its own RT and POSTs /__shot/<iterNN>/<sid>.png.
    shot_name = f"{iter_name}/{sid}.png"
    page.evaluate(
        "(a) => __FPS__.__test.capture(a.name, a.w, a.h, {dpr: a.dpr})",
        {"name": shot_name, "w": args.width, "h": args.height, "dpr": args.dpr})

    if sc["hasUntil"] and sc["hasScript"]:
        until_reached = wait_until(page, sid)

    # OBSERVE the effect: the PNG must exist on disk (local sink only).
    out_path = os.path.join(SHOTS_ROOT, iter_name, f"{sid}.png")
    on_disk = False
    deadline = time.time() + 20.0
    while time.time() < deadline:
        if os.path.exists(out_path) and os.path.getsize(out_path) > 1024:
            on_disk = True
            break
        time.sleep(0.25)

    mean_luma = png_mean_luma(out_path) if on_disk else None
    near_black = (mean_luma is not None and mean_luma < 4.0)

    # ---- HUD COMPOSITE (W4, iter04) ------------------------------------------
    # __test.capture() reads the GL DRAWING BUFFER back. The HUD and the pause
    # overlay are DOM, so `hud: true` could never appear in the PNG — S6 shipped
    # through iter03 as a HUD-less plaza frame, which voids the one scenario the
    # scorecard's HUD/UI dimension is graded on (VT battery table: "S6 pause menu
    # + in-mission HUD"). The only way to get DOM into the frame is a compositor
    # screenshot, so hud:true scenarios take one — but ONLY when the scenario is
    # posed/held, never when it is scripted: C1's PNG must be the exact
    # captureAt tick, and a compositor grab is a different, later moment.
    # The GL PNG stays the fallback and the swap is VERIFIED, not assumed: the
    # screenshot must be the right size and non-trivial, or it is discarded.
    # (--use-angle + --disable-features=CalculateNativeWinOcclusion already keep
    # the visible window rendering; a blank grab still cannot slip through.)
    capture_mode = "gl"
    if on_disk and sc["hud"] and not sc["hasScript"]:
        tmp = out_path + ".page.png"
        try:
            page.screenshot(path=tmp, scale="css")
            shot_luma = png_mean_luma(tmp)
            from PIL import Image as _Img
            with _Img.open(tmp) as _im:
                good_size = _im.size == (args.width, args.height)
            if good_size and shot_luma is not None and shot_luma >= 4.0:
                os.replace(tmp, out_path)
                capture_mode = "page"
                mean_luma = shot_luma
                near_black = False
            else:
                os.remove(tmp)
                print(f"     .. {sid}: HUD composite REJECTED "
                      f"(size ok={good_size}, luma={shot_luma}) — keeping the GL frame",
                      file=sys.stderr)
        except Exception as e:
            try:
                os.remove(tmp)
            except OSError:
                pass
            print(f"     .. {sid}: HUD composite failed ({e}) — keeping the GL frame",
                  file=sys.stderr)

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
            "capturedOnDisk": on_disk, "meanLuma": mean_luma,
            "captureMode": capture_mode,
            "nearBlack": near_black, "pageErrors": errs,
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

    todo = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            page = browser.new_page(viewport={"width": args.width, "height": args.height})
            page.on("console", lambda m: console_log.append(f"[{m.type}] {m.text}"))
            page.on("pageerror", lambda e: console_log.append(f"[pageerror] {e}"))
            page.add_init_script(BOOTSTRAP)

            def fresh(attempts: int = 3):
                # BootFailed and navigation errors are RETRYABLE: each attempt
                # is a fresh load that re-runs the capability gate (transient
                # WebGL churn clears on reload — iter01's S5 abort lesson).
                # NotReady (surface genuinely missing) is never retried.
                last = None
                for a in range(1, attempts + 1):
                    try:
                        page.goto(args.url, wait_until="load", timeout=90_000)
                        page.add_script_tag(content=shots_src)
                        # setScenario's seed-table fallback: boot's one-arg
                        # routing lambda drops the second argument, so the
                        # table also rides on a window global scenarios.js
                        # knows to read (R21).
                        page.evaluate("window.__BR_SEEDS__ = SCENARIOS")
                        wait_ready(page, args.ready_timeout)
                        require_surface(page)
                        settle_frames(page, 30)  # prewarm settle — frames, not wall clock
                        return
                    except NotReady:
                        raise
                    except Exception as e:
                        last = e
                        if a < attempts:
                            print(f"  .. load attempt {a}/{attempts} failed "
                                  f"({e}); retrying with a fresh navigation",
                                  file=sys.stderr)
                            page.wait_for_timeout(700 * a)
                raise last

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
            all_ids = page.evaluate("Object.keys(SCENARIOS)")
            if want:
                # Any SCENARIOS id is requestable (menu/bench included) —
                # filtering against BATTERY only silently dropped them.
                todo = [s for s in want if s in all_ids]
                unknown = [s for s in want if s not in all_ids]
                if unknown:
                    print(f"!! unknown scenario ids (counted as failures): "
                          f"{unknown}", file=sys.stderr)
                    failed.extend(unknown)
            else:
                todo = list(battery)

            for i, sid in enumerate(todo):
                # EVERYTHING per-shot lives inside this try — a failed reload
                # for one shot is that shot's failure, never the battery's
                # (iter01: an unguarded fresh() abort ate S5..C1 AND the
                # manifest for the four shots already on disk).
                try:
                    if i > 0 and not args.no_reload:
                        fresh()
                    row = run_shot(page, sid, iter_name, args)
                    manifest_rows.append(row)
                    bad = ((not row["capturedOnDisk"]) or (not row["untilReached"])
                           or row.get("scriptGaveUp", False)
                           or row.get("nearBlack", False))
                    if bad:
                        failed.append(sid)
                    print(f"  [{i + 1}/{len(todo)}] {sid}"
                          + ("" if row["capturedOnDisk"] else "  !! PNG never arrived on disk")
                          + ("  !! NEAR-BLACK frame (mean luma "
                             f"{row.get('meanLuma')}) — capture is void"
                             if row.get("nearBlack") else "")
                          + ("" if row["untilReached"]
                             else "  !! until() NEVER FIRED — frame not comparable")
                          + ("  !! script GAVE UP on wall clock — frame not comparable"
                             if row.get("scriptGaveUp") else "")
                          + (f"  !! {len(row['pageErrors'])} page errors"
                             if row["pageErrors"] else ""))
                except Exception as e:
                    failed.append(sid)
                    manifest_rows.append({
                        "name": sid, "file": f"{sid}.png", "error": str(e),
                        "capturedOnDisk": False, "untilReached": False})
                    print(f"  !! {sid} FAILED: {e}", file=sys.stderr)

            browser.close()
    except NotReady as e:
        # Only reachable BEFORE the first shot (per-shot failures are caught
        # in the loop) — so this can never again mask a half-finished run.
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

    # Leave the sink healthy for the NEXT run — verify, never assume; respawn
    # if this run's load killed it (detached process, so normally it outlives
    # us; the probe is the observation that it actually did).
    try:
        if _port_open(SERVER_PORT) and _is_ours(SERVER_PORT):
            print(f"[shotserver] healthy on port {SERVER_PORT} for the next run")
        else:
            print(f"[shotserver] NOT answering after the run — respawning",
                  file=sys.stderr)
            ensure_server()
    except Exception as e:
        print(f"[shotserver] could not verify/respawn: {e}", file=sys.stderr)

    ok = len([r for r in manifest_rows if r["name"] not in failed])
    print(f"\n{ok}/{len(todo)} shots -> {iter_dir}")
    if failed:
        print(f"FAILED: {failed}", file=sys.stderr)
    return 0 if manifest_rows and not failed else 1


if __name__ == "__main__":
    sys.exit(main())
