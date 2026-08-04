#!/usr/bin/env python
"""
Resolution-scale / preset probe — does the lever actually move the buffer?

Two jobs, deliberately separated because they fail differently:

  --verify   State readback only. For each config, apply it, then read back
             `renderer.domElement.width/height`, `renderer.getPixelRatio()` and
             the post chain's own target width. Instant, contention-proof, and
             the ONLY honest way to answer "did the drawing buffer shrink?".
             A lever that reports 0.5 while the buffer stays 1280 is dead, and
             no amount of frame timing tells you that.

  --time     Frame timing. Every config is measured `--rounds` times, INTERLEAVED
             (A B C A B C ...) rather than in blocks, and the reported number is
             the best round per config. This machine's GPU is shared and drifts
             upward under sustained load, so contention only ever ADDS time:
             across an interleaved schedule the cheapest round is the least
             contended estimate, while a median is biased by whatever else the
             machine was doing. Blocked schedules attribute drift to whichever
             config ran last, which is exactly the error to avoid when the thing
             being compared is a ladder of presets.

Configs are driven through `SNOWFLOW.set` / `SNOWFLOW.applyPreset` when the page
exposes them and fall back to a raw `S.x = v` write when it does not — so the
same script measures the build before and after the fix and shows the difference.

    python scaleprobe.py --verify
    python scaleprobe.py --time --rounds 3 --seconds 6
"""
import argparse, json, statistics, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

DEFAULT_URL = "http://localhost:8799/games/snowflow/index.html"

# Raw inter-frame deltas off rAF. The page's own loop is the thing under test,
# so nothing heavier than a push may run inside it.
SAMPLER = """
window.__ft = [];
(function () {
  let prev = performance.now();
  function tick() {
    const now = performance.now();
    window.__ft.push(now - prev);
    prev = now;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
"""

# Pinned pose. Every config must rasterise the SAME view or the comparison is
# between two framings, not two settings.
POSE = """(cfg) => {
    const SF = globalThis.SNOWFLOW;
    SF.character.position.x = 0; SF.character.position.z = 0;
    SF.character.position.y = SF.terrain.heightAt(0, 0);
    SF.rig.yaw = 2.4; SF.rig.pitch = 0.17;
    SF.rig.distance = SF.rig.distanceTarget = 6.2;
    for (const s of ['#boot','#hint','#overlay'])
        document.querySelectorAll(s).forEach(e => e.style.display = 'none');

    // Preset first, then any explicit override: a config that names both means
    // "this preset, but with that one key forced".
    if (cfg.preset != null) {
        if (SF.applyPreset) SF.applyPreset(cfg.preset);
        else SF.S.preset = cfg.preset;          // the dead path, on purpose
    }
    if (cfg.scale != null) {
        if (SF.set) SF.set('resolutionScale', cfg.scale);
        else SF.S.resolutionScale = cfg.scale;  // the dead path, on purpose
    }
}"""

READBACK = """() => {
    const SF = globalThis.SNOWFLOW;
    const c = SF.renderer.domElement;
    const p = SF.post;
    const dp = SF.depthPass;
    return {
        preset: SF.S.preset,
        scale: SF.S.resolutionScale,
        canvasW: c.width, canvasH: c.height,
        cssW: c.clientWidth, cssH: c.clientHeight,
        pixelRatio: SF.renderer.getPixelRatio(),
        sceneRTW: p && p.sceneTarget ? p.sceneTarget.width : null,
        sceneRTH: p && p.sceneTarget ? p.sceneTarget.height : null,
        historyW: p && p.history ? p.history[0].width : null,
        dofW: p && p.rtDof ? p.rtDof.width : null,
        compositeW: p && p.rtComposite ? p.rtComposite.width : null,
        ssrW: p && p.rtSsr ? p.rtSsr.width : null,
        prepassW: dp ? dp.size.x : null,
        deformRes: SF.S.deformResolution,
        hasSet: !!SF.set, hasApplyPreset: !!SF.applyPreset,
    };
}"""


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))]


def open_page(br, url, width, height):
    pg = br.new_page(viewport={"width": width, "height": height})
    pg.add_init_script(SAMPLER)
    pg.goto(url, wait_until="load", timeout=90_000)
    for _ in range(200):
        if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.post)"):
            return pg
        pg.wait_for_timeout(500)
    raise RuntimeError("page never exposed SNOWFLOW")


def apply(pg, cfg):
    pg.evaluate(POSE, cfg)
    pg.wait_for_timeout(1200)      # let the resize and any RT rebuild settle


def measure(pg, seconds):
    pg.evaluate("window.__ft = []")
    pg.wait_for_timeout(int(seconds * 1000))
    ft = [f for f in pg.evaluate("window.__ft") if 0.5 < f < 900][8:]
    if not ft:
        return None
    return {"n": len(ft), "median_ms": round(statistics.median(ft), 2),
            "p95_ms": round(pct(ft, 0.95), 2)}


def profile(pg, cfg, seconds):
    """Per-pass GPU breakdown for one config, via the port's own `S.debugProfile`.

    The question this exists to answer is not "how slow" but "what is left when
    the resolution knob has done all it can". A 2048² shadow cascade costs the
    same at 640x360 as at 1280x720, so the fixed-cost rows ARE the floor: no
    preset built out of resolution and post toggles can get under their sum, and
    a preset named for a frame rate it cannot reach is worse than no preset.
    """
    pg.evaluate("""() => {
        const SF = globalThis.SNOWFLOW;
        (SF.set ? (k, v) => SF.set(k, v) : (k, v) => { SF.S[k] = v; })
            ('debugProfile', true);
        SF.perfProfileReset();
    }""")
    pg.wait_for_timeout(int(seconds * 1000))
    prof = pg.evaluate("() => SNOWFLOW.perfProfile()")
    pg.evaluate("""() => {
        const SF = globalThis.SNOWFLOW;
        (SF.set ? (k, v) => SF.set(k, v) : (k, v) => { SF.S[k] = v; })
            ('debugProfile', false);
    }""")
    return prof


def parse_configs(spec):
    """`name:preset:scale` per entry; empty field = leave alone."""
    out = []
    for entry in spec.split(","):
        parts = (entry.split(":") + ["", ""])[:3]
        name, preset, scale = parts[0].strip(), parts[1].strip(), parts[2].strip()
        out.append({"name": name or entry, "preset": preset or None,
                    "scale": float(scale) if scale else None})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--verify", action="store_true", help="state readback only")
    ap.add_argument("--time", action="store_true", help="interleaved frame timing")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--seconds", type=float, default=6.0)
    ap.add_argument("--configs",
                    default="ultra:ultra:,scale0.75::0.75,scale0.5::0.5")
    ap.add_argument("--profile", action="store_true",
                    help="per-pass GPU breakdown per config")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    if not args.verify and not args.time and not args.profile:
        args.verify = True

    cfgs = parse_configs(args.configs)
    result = {"width": args.width, "height": args.height, "configs": cfgs}

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = open_page(br, args.url, args.width, args.height)

        if args.verify:
            rows = []
            for c in cfgs:
                apply(pg, c)
                rb = pg.evaluate(READBACK)
                rb["config"] = c["name"]
                rows.append(rb)
                print(f"  {c['name']:16} scale={rb['scale']:<5} preset={rb['preset']:<12} "
                      f"canvas={rb['canvasW']}x{rb['canvasH']} ratio={rb['pixelRatio']} "
                      f"sceneRT={rb['sceneRTW']}x{rb['sceneRTH']} hist={rb['historyW']} "
                      f"dof={rb['dofW']} comp={rb['compositeW']} ssr={rb['ssrW']} "
                      f"prepass={rb['prepassW']} deform={rb['deformRes']}")
            print(f"  SNOWFLOW.set exposed: {rows[0]['hasSet']}   "
                  f"applyPreset exposed: {rows[0]['hasApplyPreset']}")
            result["verify"] = rows

        if args.time:
            # Interleaved: one pass over every config per round. See the module
            # docstring for why this is not blocked and why the estimator is
            # best-of rather than median-of.
            per = {c["name"]: [] for c in cfgs}
            for r in range(args.rounds):
                for c in cfgs:
                    apply(pg, c)
                    m = measure(pg, args.seconds)
                    if m:
                        per[c["name"]].append(m)
                        print(f"  round {r+1}  {c['name']:16} "
                              f"median {m['median_ms']:6.2f} ms  "
                              f"({1000/m['median_ms']:5.1f} fps)")
            print()
            rows = []
            for name, ms in per.items():
                if not ms: continue
                best = min(m["median_ms"] for m in ms)
                row = {"config": name, "best_median_ms": round(best, 2),
                       "best_fps": round(1000 / best, 1),
                       "all_medians": [m["median_ms"] for m in ms]}
                rows.append(row)
                print(f"  {name:16} BEST {best:6.2f} ms  {1000/best:5.1f} fps   "
                      f"rounds {row['all_medians']}")
            result["timing"] = rows

        if args.profile:
            profs = {}
            for c in cfgs:
                apply(pg, c)
                p = profile(pg, c, args.seconds)
                profs[c["name"]] = p
                print(f"\n  --- {c['name']}   (dropped {p.get('dropped')} "
                      f"bogus {p.get('bogus')}) ---")
                rows = sorted(p.get("passes", []), key=lambda r: -r["ms"])
                # The FRAME row is one query spanning everything below it, so it
                # is a CHECK on the sum, not a member of it.
                total = sum(r["ms"] for r in rows
                            if not r["name"].startswith("FRAME"))
                for r in rows:
                    print(f"    {r['name']:44} {r['ms']:7.3f} ms  n={r['n']}")
                print(f"    {'SUM (excl. FRAME row)':44} {total:7.3f} ms")
            result["profile"] = profs

        pg.close()
        br.close()

    if args.out:
        open(args.out, "w", encoding="utf-8").write(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
