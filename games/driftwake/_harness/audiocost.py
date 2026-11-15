#!/usr/bin/env python
"""DRIFTWAKE — what does the audio subsystem cost the frame?

WHY perfprobe.py CANNOT ANSWER THIS. Every harness script drives the page with
Playwright, `navigator.webdriver` is therefore true, and main.js line 827 takes the
AUTOPLAY branch — no shell, no music element. Worse, no script dispatches a click,
and `audio.js` only builds its graph on a real gesture. So every perfprobe number
ever recorded for this build, the ~122 ms ultra baseline included, was measured with
the audio subsystem DORMANT: no context, no oscillators, no decoded samples, no
`<audio>` element. Comparing a new perfprobe run against that baseline compares
silence with silence and confirms nothing.

This probe runs the same rAF sampler (copied from perfprobe.py) over two pages that
differ in exactly one thing:

  OFF  ?autoplay=1        game running, no gesture -> audio.js never builds
  ON   ?menu=1 + a real click on PLAY   full graph, 9 decoded samples, mp3 looping

Same preset, same viewport, same flags, same duration. The difference between the
two medians is what the audio actually costs the frame.

    python audiocost.py --seconds 10
"""
import argparse, json, statistics, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

BASE = "http://localhost:8799/games/driftwake/index.html"

FLAGS = ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
         "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

SAMPLER = """
window.__ft = [];
(function () {
  let prev = performance.now();
  function tick(t) {
    const now = performance.now();
    window.__ft.push(now - prev);
    prev = now;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
window.__sfReady = () => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
};
"""

FIND_BTN = r"""
(re) => {
  const rx = new RegExp(re);
  for (const b of Array.from(document.querySelectorAll('button'))) {
    const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
    if (!rx.test(t)) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return null;
}
"""


def run(pw, label, url, secs, play):
    br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.add_init_script(SAMPLER)
    pg.goto(url, wait_until="load", timeout=120_000)
    end = time.time() + 180
    while time.time() < end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(1500)

    audio = None
    if play:
        hit = pg.evaluate(FIND_BTN, r"^\s*(▶\s*)?PLAY\s*$")
        if not hit:
            br.close()
            raise SystemExit("no PLAY button — is ?menu=1 set?")
        pg.mouse.click(hit["x"], hit["y"])
        # Let the context unlock, the nine .ogg files decode and the mp3 buffer.
        pg.wait_for_timeout(6000)
        audio = pg.evaluate("""() => ({
            ctx: SNOWFLOW.audio.ctx ? SNOWFLOW.audio.ctx.state : null,
            samples: SNOWFLOW.audio.sampleStatus,
            voices: SNOWFLOW.audio.live,
            music: FFG.musicStatus ? FFG.musicStatus().element : null,
        })""")
    else:
        pg.wait_for_timeout(6000)
        audio = pg.evaluate("""() => ({
            ctx: SNOWFLOW.audio && SNOWFLOW.audio.ctx ? SNOWFLOW.audio.ctx.state : null,
            samples: SNOWFLOW.audio ? SNOWFLOW.audio.sampleStatus : null,
            music: (globalThis.FFG && FFG.musicStatus) ? FFG.musicStatus().element : null,
        })""")

    pg.evaluate("window.__ft = []")
    pg.wait_for_timeout(int(secs * 1000))
    ft = pg.evaluate("window.__ft")
    ft = [f for f in ft if f > 0]
    # The GPU half, from the page's own timer query. This is the number the
    # "audio costs nothing on the GPU" claim is actually about: no path in
    # src/audio/ or runtime/music.js issues a draw, binds a texture or touches a
    # shader, so if this moves between the two conditions something is wrong with
    # the experiment rather than with the audio.
    gst = pg.evaluate("""() => { const s = globalThis.SNOWFLOW && SNOWFLOW.perfStats;
        return s ? {gpuMs: s.gpuMs, draws: s.drawCalls, tris: s.triangles} : {}; }""")
    br.close()
    if not ft:
        return {"label": label, "n": 0}
    s = sorted(ft)
    return {
        "label": label, "n": len(ft),
        "median_ms": round(statistics.median(ft), 2),
        "p95_ms": round(s[int(len(s) * 0.95) - 1], 2),
        "mean_ms": round(statistics.fmean(ft), 2),
        "fps": round(1000.0 / statistics.median(ft), 1),
        "gpu_ms": round(gst.get("gpuMs") or 0, 2),
        "draws": gst.get("draws"),
        "tris": gst.get("tris"),
        "audio": audio,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--repeat", type=int, default=3)
    ap.add_argument("--out", default="audiocost.json")
    args = ap.parse_args()

    # ONE run of each proves nothing: perfprobe's own spread between consecutive
    # runs of an IDENTICAL config on this machine is 4-6.5 ms (8-10%), which is
    # the same size as any plausible audio cost. So: repeat, and ALTERNATE the
    # order, because this laptop throttles and a fixed order would bake the
    # thermal drift into whichever condition always ran second.
    off, on = [], []
    with sync_playwright() as pw:
        for i in range(args.repeat):
            order = [("off", False), ("on", True)] if i % 2 == 0 else \
                    [("on", True), ("off", False)]
            for tag, play in order:
                url = BASE + ("?menu=1" if play else "?autoplay=1")
                lbl = ("audio ON  (?menu=1 + PLAY)" if play
                       else "audio OFF (?autoplay=1)")
                r = run(pw, lbl, url, args.seconds, play)
                r["rep"] = i
                (on if play else off).append(r)
                print(f"  rep{i} {tag:3}  median {r.get('median_ms', 0):7.2f} ms"
                      f"   p95 {r.get('p95_ms', 0):7.2f}   gpu {r.get('gpu_ms', 0):6.2f}"
                      f"   draws {r.get('draws')}   n={r.get('n', 0)}")

    mo = [r["median_ms"] for r in off if r.get("n")]
    mn = [r["median_ms"] for r in on if r.get("n")]
    print()
    print(f"  audio OFF medians: {['%.2f' % v for v in mo]}   -> median {statistics.median(mo):.2f} ms")
    print(f"  audio ON  medians: {['%.2f' % v for v in mn]}   -> median {statistics.median(mn):.2f} ms")
    print(f"  OFF spread {max(mo) - min(mo):.2f} ms · ON spread {max(mn) - min(mn):.2f} ms")
    d = statistics.median(mn) - statistics.median(mo)
    noise = max(max(mo) - min(mo), max(mn) - min(mn))
    print(f"\n  DELTA (on - off): {d:+.2f} ms median-of-medians "
          f"({d / statistics.median(mo) * 100:+.1f} %)")
    print(f"  within-condition spread: {noise:.2f} ms  ->  "
          f"{'NOT RESOLVABLE above run-to-run noise' if abs(d) <= noise else 'LARGER than run-to-run noise'}")
    go = [r["gpu_ms"] for r in off if r.get("n")]
    gn = [r["gpu_ms"] for r in on if r.get("n")]
    print(f"\n  GPU  off {['%.2f' % v for v in go]} -> {statistics.median(go):.2f} ms"
          f"  |  on {['%.2f' % v for v in gn]} -> {statistics.median(gn):.2f} ms"
          f"  |  delta {statistics.median(gn) - statistics.median(go):+.2f} ms")
    print(f"  last ON audio state: {json.dumps(on[-1].get('audio'))}")
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"off": off, "on": on, "delta_ms": d, "noise_ms": noise}, f, indent=1)
    print("  wrote", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
