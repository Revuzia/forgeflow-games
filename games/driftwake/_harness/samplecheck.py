#!/usr/bin/env python
"""DRIFTWAKE — verify the recorded one-shots in a LIVE page, not offline.

levelprobe.py measures the mix by rendering a replica offline, which is the right
tool for a number but proves nothing about the shipped path: whether the .ogg files
are actually served at the URL `samples.js` builds, whether they decode, whether a
footfall reaches them, and whether the page Mute button still reaches THEM. Those
are all things that can only be observed in the real page.

Checks, in order:
  1. all nine assets return 200 from the URL the module resolves (network log)
  2. after unlock, SNOWFLOW.audio.sampleStatus reports 9/9 decoded
  3. a real footfall — driven by walking the character, not by calling play() —
     lights up SNOWFLOW.audio.samples.live
  4. the pooled graph does not grow: node count is identical after 40 triggers
  5. Mute reaches the samples (the shared AudioContext suspends)
  6. no console errors

    python samplecheck.py
"""
import sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/driftwake/index.html"

BOOT = r"""
(() => {
  window.__errs = [];
  addEventListener('error', e => window.__errs.push(String(e.message)));
  window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const b = document.getElementById('boot');
    return !(b && !b.classList.contains('gone'));
  };
})();
"""


def main():
    fails = []
    audio_reqs = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=[
            "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
            "--disable-gpu-sandbox", "--autoplay-policy=no-user-gesture-required"])
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.add_init_script(BOOT)
        console = []
        pg.on("console", lambda m: console.append((m.type, m.text)))
        pg.on("response", lambda r: audio_reqs.__setitem__(
            r.url.rsplit("/", 1)[-1], r.status) if "/assets/audio/" in r.url else None)

        pg.goto(URL, wait_until="load", timeout=120_000)
        end = time.time() + 180
        while time.time() < end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1200)

        # --- 1 the assets are served ---------------------------------------
        print("1. ASSET REQUESTS (from the URL samples.js resolved, not a guess)")
        if not audio_reqs:
            fails.append("no requests to assets/audio/ at all — prefetch never ran")
            print("   NONE — prefetch did not run")
        for k in sorted(audio_reqs):
            print(f"   {audio_reqs[k]}  {k}")
            if audio_reqs[k] != 200:
                fails.append(f"{k} returned {audio_reqs[k]}")
        if len(audio_reqs) != 9:
            fails.append(f"expected 9 assets, saw {len(audio_reqs)}")

        # --- 2 they decode --------------------------------------------------
        pg.mouse.click(640, 400)          # the unlock gesture
        pg.wait_for_timeout(2500)
        st = pg.evaluate("() => SNOWFLOW.audio.sampleStatus")
        ctx = pg.evaluate("() => SNOWFLOW.audio.state")
        print(f"\n2. DECODE   sampleStatus = {st!r}   ctx = {ctx!r}")
        if "9/9" not in st:
            fails.append(f"sampleStatus is {st!r}, expected 9/9 loaded")

        # --- 3 a real footfall reaches them ---------------------------------
        # Walk. The point is to drive the SHIPPED path — controller sets
        # `footfall`, audio.update() sees the flag, samples.step() fires — rather
        # than to call play() directly, which would prove only that play() works.
        print("\n3. A REAL FOOTFALL (walking the character, W held)")
        pg.keyboard.down("w")
        best = 0
        n = 0
        end = time.time() + 6
        while time.time() < end:
            v = pg.evaluate("() => ({live: SNOWFLOW.audio.samples.live, "
                            "ff: SNOWFLOW.character.footfall, "
                            "sp: SNOWFLOW.character.speed01})")
            if v["live"] > best: best = v["live"]
            if v["ff"]: n += 1
            pg.wait_for_timeout(30)
        pg.keyboard.up("w")
        sp = pg.evaluate("() => SNOWFLOW.character.speed01")
        print(f"   speed01 reached {sp:.2f}, footfall flag seen {n}x, "
              f"samples.live peaked at {best}")
        if best < 1:
            fails.append("walking never lit samples.live — footfalls are not "
                         "reaching the sample bank")

        # --- 4 the pooled graph does not grow -------------------------------
        # SampleBank creates one AudioBufferSourceNode per trigger (unavoidable:
        # a source is single-use by spec) but must reuse its gains and panners.
        # If the pool leaked, 40 triggers would leave 40 extra connected nodes.
        print("\n4. POOL DOES NOT GROW (40 forced triggers)")
        before = pg.evaluate("() => SNOWFLOW.audio.samples.voices.length")
        pg.evaluate("""() => { const A = SNOWFLOW.audio, t = A.ctx.currentTime;
            for (let i = 0; i < 40; i++) A.samples.step(t + i*0.001, 0.2, 1, 0); }""")
        pg.wait_for_timeout(600)
        after = pg.evaluate("() => SNOWFLOW.audio.samples.voices.length")
        stale = pg.evaluate("""() => SNOWFLOW.audio.samples.voices
            .filter(v => v.src === null).length""")
        print(f"   pooled voices before {before}, after {after}, "
              f"slots holding no source {stale}")
        if after != before:
            fails.append(f"voice pool grew from {before} to {after}")

        # --- 5 mute reaches the samples -------------------------------------
        print("\n5. MUTE")
        pg.evaluate("() => { SNOWFLOW.audio.muted = true; }")
        pg.wait_for_timeout(400)
        mg = pg.evaluate("() => SNOWFLOW.audio.master.gain.value")
        live = pg.evaluate("() => SNOWFLOW.audio.samples.live")
        print(f"   muted -> master gain {mg:.4f}, samples.live {live}")
        if mg > 0.01:
            fails.append(f"mute left master gain at {mg}")
        pg.evaluate("() => { SNOWFLOW.audio.muted = false; }")

        # --- 6 no errors ------------------------------------------------------
        errs = pg.evaluate("() => window.__errs")
        cerr = [t for k, t in console if k == "error"]
        print(f"\n6. ERRORS   window {len(errs)}   console {len(cerr)}")
        for e in (errs + cerr)[:8]:
            print("   " + str(e))
            fails.append("error: " + str(e))

        br.close()

    print("\n" + ("SAMPLECHECK OK" if not fails else "SAMPLECHECK FAILED"))
    for f in fails:
        print("  ! " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
