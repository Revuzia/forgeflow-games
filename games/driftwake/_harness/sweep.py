#!/usr/bin/env python
"""
SNOWFLOW parameter sweep.

The 14-shot battery only ever exercised DEFAULT settings. This drives the same
01-hero pose on BOTH targets while moving one setting at a time, so a slider
that is dead / inverted / divergent in the port shows up as a response curve
that does not track the reference's.

    python sweep.py --target port --url http://localhost:8799/games/driftwake/index.html
    python sweep.py --target ref  --url https://snowflow-lilac.vercel.app/

Writes _shots/sweep/<key>_<value>_<target>.png plus <target>_stats.json.
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "_shots", "sweep")

CHROME_FLAGS = [
    "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization",
    "--use-angle=d3d11", "--disable-gpu-sandbox",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
]

BOOTSTRAP = r"""
(() => {
  window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const boot = document.getElementById('boot');
    if (boot && !boot.classList.contains('gone')) return false;
    const fail = document.getElementById('nogpu');
    if (fail && fail.classList.contains('show')) throw new Error('target reported no GPU');
    return true;
  };
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

# 01-hero, transcribed from shots.js so the sweep is comparable to the battery.
POSE = """() => {
  const SF = globalThis.SNOWFLOW;
  const p = SF.character.position;
  p.x = 0; p.z = 0; p.y = SF.terrain.heightAt(0, 0);
  SF.character.velocity.x = 0; SF.character.velocity.y = 0; SF.character.velocity.z = 0;
  SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
  SF.rig.distance = 6.2; SF.rig.distanceTarget = 6.2;
}"""

# An alternate pose for keys the 01-hero framing cannot see. 12-far-range from
# shots.js: the horizon framing the raymarched range actually appears in. A key
# that is inert at 01-hero on BOTH targets is re-shot here before being called
# inert, because "the pose does not show it" and "the setting does nothing" are
# different findings.
POSE_FAR = """() => {
  const SF = globalThis.SNOWFLOW;
  const p = SF.character.position;
  p.x = 0; p.z = 0; p.y = SF.terrain.heightAt(0, 0);
  SF.character.velocity.x = 0; SF.character.velocity.y = 0; SF.character.velocity.z = 0;
  SF.rig.yaw = 2.9; SF.rig.pitch = -0.10;
  SF.rig.distance = 9.5; SF.rig.distanceTarget = 9.5;
}"""

# key -> list of values. Order matters only for the report.
SWEEP = [
    ("sunElevation",         [3, 8, 13, 25, 40]),
    ("sunAzimuth",           [40, 118, 250]),
    ("windDirection",        [0, 42, 150]),
    ("sssStrength",          [0.3, 2.0]),
    ("sssRadius",            [0.3, 2.0]),
    ("detailNormalStrength", [0, 2.0]),
    ("macroHeightScale",     [0.4, 1.8]),
    ("sastrugiStrength",     [0.4, 1.8]),
    ("deformDepth",          [0.3, 2.5]),
    ("deformBerm",           [0.3, 2.5]),
    ("exposure",             [0.05, 0.105, 0.3]),
    ("tonemap",              ["agx", "aces", "none"]),
    ("fogDensity",           [0, 0.02]),
    ("mountainHeight",       [0, 2400]),
]

# These do nothing on a standing character: they scale a trench that has to be
# cut first. Walked 6 m (distance-terminated, per the shots.js note) then framed
# looking back down the trail, exactly like 05-trail-berms.
NEEDS_TRAIL = {"deformDepth", "deformBerm"}


def wait_ready(page, timeout_s=150.0):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if page.evaluate("window.__sfReady && window.__sfReady()"):
                return
        except Exception as e:
            if "no GPU" in str(e):
                raise RuntimeError("target reported no GPU support")
        page.wait_for_timeout(400)
    raise TimeoutError("target never became ready")


def walk_trail(page):
    """Press W until 6 m from spawn, then turn and look back down the trail."""
    page.evaluate("""() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyW', bubbles:true}));
    }""")
    end = time.time() + 30.0
    while time.time() < end:
        done = page.evaluate("""() => {
          const p = globalThis.SNOWFLOW.character.position;
          return Math.hypot(p.x, p.z) >= 6.0;
        }""")
        if done:
            break
        page.wait_for_timeout(25)
    page.evaluate("""() => {
      window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyW', bubbles:true}));
      const SF = globalThis.SNOWFLOW;
      SF.rig.yaw += Math.PI; SF.rig.pitch = 0.46;
      SF.rig.distance = SF.rig.distanceTarget = 5.4;
    }""")


def capture(page, url, key, value, target, settle, use_hook, freeze=False, far=False):
    page.goto(url, wait_until="load", timeout=120_000)
    wait_ready(page)
    page.wait_for_timeout(1500)
    page.evaluate("window.__sfChrome()")

    # STATIC-CONTROL MODE — what makes a pixel diff mean anything.
    #
    # At defaults, two captures of the SAME build at the SAME settings differ by
    # mean|d| 0.009-0.014 across 50-62% of the frame. That is larger than the
    # change a subtle slider makes, so "dead slider" and "live slider" are
    # indistinguishable. Almost all of it is the FILM GRAIN: a per-frame hash on
    # the clock at amplitude 0.022, i.e. +/-2.8/255 on every pixel. TAA's jitter
    # and history blend account for most of the rest. The character's idle, the
    # obvious suspect, turns out to contribute almost nothing at this framing.
    #
    # Zeroing those two drops the identity noise to 0.13-0.52% of pixels on both
    # targets (measured), which is ~100x below what any responding key moves.
    #
    # NOT `freezeTime`, which is the obvious lever and is wrong twice over: it
    # stops the clock wherever the capture happened to reach, so the phase still
    # varies with page-load timing (measured 0.0136 between two frozen captures
    # at identical settings) — AND it renders the REFERENCE black (mean luma
    # 0.006 against the port's 0.520 under the same write). See SWEEP.md.
    if freeze:
        page.evaluate("""() => {
          const S = globalThis.SNOWFLOW.S;
          S.grainStrength = 0;  // per-frame hash on the clock
          S.taa = false;        // per-frame jitter + history blend
        }""")

    err = None
    if key is not None:
        try:
            page.evaluate("([k, v]) => { globalThis.SNOWFLOW.S[k] = v; }", [key, value])
        except Exception as e:
            err = f"set threw: {e}"
        if use_hook:
            # Second-stage probe ONLY: poke the port's own rebake flags, which
            # settings.set() would normally raise. Distinguishes "the value was
            # hardcoded / lost in the port" from "the port gates this behind an
            # onChange listener the harness's direct S write bypasses".
            page.evaluate("""() => {
              const SF = globalThis.SNOWFLOW;
              if (SF.terrain) SF.terrain._rebakeDue = true;
              if (SF.sky && SF.sky._markDirty) { SF.sky._markDirty(); SF.sky._rebakeAt = 0; }
            }""")

    page.evaluate(POSE_FAR if far else POSE)
    if key in NEEDS_TRAIL:
        walk_trail(page)
    end = time.time() + settle
    while time.time() < end:
        page.wait_for_timeout(120)
    page.evaluate("window.__sfChrome()")

    tag = "default" if key is None else f"{key}_{value}"
    suffix = ("_hook" if use_hook else "") + ("_far" if far else "")
    path = os.path.join(OUT, f"{tag}{suffix}_{target}.png")
    page.screenshot(path=path)
    errs = page.evaluate("window.__sfErrors || []")
    return {"key": key, "value": value, "file": os.path.basename(path),
            "pageErrors": errs, "setError": err}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, choices=["port", "ref"])
    ap.add_argument("--url", required=True)
    ap.add_argument("--settle", type=float, default=4.0)
    ap.add_argument("--freeze", action="store_true",
                    help="set S.freezeTime before posing, so frames are deterministic")
    ap.add_argument("--far", action="store_true",
                    help="use the 12-far-range pose instead of 01-hero")
    ap.add_argument("--hook", action="store_true",
                    help="stage-2 probe: also raise the port's internal rebake flags")
    ap.add_argument("--only", default="", help="comma-separated subset of keys")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    plan = [(None, None)] if not only else []
    for k, vals in SWEEP:
        if only and k not in only:
            continue
        for v in vals:
            plan.append((k, v))

    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=False, args=CHROME_FLAGS)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.add_init_script(BOOTSTRAP)
        for i, (k, v) in enumerate(plan):
            try:
                r = capture(page, args.url, k, v, args.target, args.settle, args.hook,
                            args.freeze, args.far)
                rows.append(r)
                print(f"  [{i+1}/{len(plan)}] {r['file']}"
                      + (f"  !! {r['pageErrors']}" if r["pageErrors"] else ""))
            except Exception as e:
                rows.append({"key": k, "value": v, "file": None, "error": str(e)})
                print(f"  !! {k}={v} FAILED: {e}", file=sys.stderr)
            sys.stdout.flush()
        browser.close()

    name = f"{args.target}{'_hook' if args.hook else ''}_stats.json"
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump({"url": args.url, "rows": rows}, f, indent=2)
    print(f"\n{len([r for r in rows if r.get('file')])}/{len(plan)} -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
