#!/usr/bin/env python
"""ASCENDANT pass-cost probe — TRUE render cost per post pass, in milliseconds.

WHY THIS EXISTS (and why frameprobe.py's fps rows must not be trusted alone):

  * Counting requestAnimationFrame callbacks measures the browser's rAF
    schedule, not the renderer. On a loaded machine rAF throttles and every row
    collapses toward the same number -- which is how frameprobe can report the
    chain getting FASTER when you remove a pass. Measured on this box: an EMPTY
    rAF chain, doing no work at all, had a 33.4 ms median interval (~30 Hz).
    No render optimisation can move fps while that is the limit.
  * engine.stats.fps is 1/dt with dt clamped to engine.maxDt, so it saturates at
    the clamp (30) no matter how slow the frame really is. It read 30 while
    engine.stats.frameMs simultaneously read 179 ms.

METHOD

  Stop the game loop, render the composer OFFSCREEN, and time a batch bracketed
  by a 1-pixel gl.readPixels() to force a real GPU round trip.

  Three failure modes are designed out, each after being observed:

  1. renderToScreen. With it on, whichever pass is last draws into the canvas
     backbuffer, so toggling a pass silently moves compositor/present cost onto a
     different row. Everything here renders offscreen instead.
  2. gl.finish() does NOT reliably block across Chrome's command buffer: it timed
     a frame at 0.9 ms that provably takes ~2 ms. readPixels does block.
  3. A synchronous readback costs a large FIXED amount per batch (~57 ms here),
     which swamps a 2 ms frame if you just divide one timing by N. So we time N
     and 2N frames and subtract:
         T(n) = C + n*m,  T(2n) = C + 2n*m   =>   m = (T(2n) - T(n)) / n
     which cancels C exactly.

  Configurations are measured INTERLEAVED and reduced with the MINIMUM, because
  contention only ever adds time, never removes it. A self-test runs first and
  ABORTS rather than printing numbers if the sync is not measuring real work.

    python passcost.py --stage neon-1
    python passcost.py --stage temple-3 --quality medium
"""
import argparse
import json
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

# ---------------------------------------------------------------- page-side --

SETUP = r"""
() => {
  const A = globalThis.ASCENDANT;
  const E = A.engine, P = E.post, R = E.renderer;
  const gl = R.getContext();
  E.stop();                                   // no rAF loop competing for the GPU
  const W = (globalThis.__pc = {});
  W.gl = gl; W.E = E; W.P = P; W.R = R;
  W.saved = P.composer.passes.map(p => p.enabled);
  W.rts = P.composer.renderToScreen;
  P.composer.renderToScreen = false;           // never touch the canvas: see (1)
  W.px = new Uint8Array(4);
  W.sync = () => {
    const rt = P.composer.readBuffer;
    R.setRenderTarget(rt);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, W.px);
    R.setRenderTarget(null);
  };
  W.batch = (n) => {
    W.sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) P.composer.render(0.016);
    W.sync();
    return performance.now() - t0;
  };
  return {
    passes: P.composer.passes.map(p => p.constructor.name),
    drawCalls: (() => { R.info.reset(); P.composer.render(0.016);
                        return { calls: R.info.render.calls, tris: R.info.render.triangles }; })(),
  };
}
"""

MEASURE = r"""
([frames, warm]) => {
  const W = globalThis.__pc;
  for (let i = 0; i < warm; i++) W.P.composer.render(0.016);
  return [W.batch(frames), W.batch(frames * 2)];
}
"""
# NOTE ON REDUCTION: the two timings are reduced to their own minima ACROSS
# repeats and only then subtracted. Taking min((t2-t1)/n) per repeat instead is
# badly biased -- the minimum of a noisy difference selects the repeat where t1
# happened to be contended and t2 did not, which on this machine produced
# NEGATIVE milliseconds. min(t2) - min(t1) subtracts two independently-estimated
# floors, each of which is the least-contended estimate of C + k*m.

SELFTEST = r"""
() => {
  const W = globalThis.__pc;
  for (let i = 0; i < 12; i++) W.P.composer.render(0.016);
  const a = Math.min(W.batch(40), W.batch(40), W.batch(40));
  const b = Math.min(W.batch(80), W.batch(80), W.batch(80));
  return { small: +a.toFixed(1), large: +b.toFixed(1),
           marginal: +((b - a) / 40).toFixed(3),
           fixedOverhead: +(a - (b - a)).toFixed(1) };
}
"""

APPLY = r"""
(off) => {
  const W = globalThis.__pc;
  W.P.composer.passes.forEach((p, i) => {
    p.enabled = W.saved[i] && !off.includes(p.constructor.name);
  });
}
"""

RESTORE = ("() => { const W = globalThis.__pc;"
           " W.P.composer.passes.forEach((p,i)=>p.enabled=W.saved[i]);"
           " W.P.composer.renderToScreen = W.rts; }")

RAF_FLOOR = r"""
async () => {
  const f = () => new Promise(r => requestAnimationFrame(r));
  const t = [];
  for (let i = 0; i < 70; i++) { await f(); t.push(performance.now()); }
  const d = [];
  for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
  d.sort((a, b) => a - b);
  return +d[Math.floor(d.length / 2)].toFixed(2);
}
"""

# ------------------------------------------------------------------- driver --

# Every alias the AA / grade / output passes have gone by, so this probe keeps
# working across the chain rewrite instead of silently reporting a missing row.
GRADE = ["GradePass", "FinishPass"]
AA = ["SMAAPass", "FXAAPass"]
OUT = ["OutputPass"]
BLOOM = ["UnrealBloomPass", "ScaledBloomPass"]

CONFIGS = [
    ("full chain", []),
    ("-bloom", BLOOM),
    ("-grade/finish", GRADE),
    ("-viewmodel", ["ViewmodelPass"]),
    ("-AA", AA),
    ("-output", OUT),
    ("scene only", BLOOM + ["ViewmodelPass"] + GRADE + AA + OUT),
]


def boot(pg, url):
    pg.goto(url, wait_until="load", timeout=60_000)
    for _ in range(150):
        if pg.evaluate("!!(globalThis.ASCENDANT&&ASCENDANT.game&&ASCENDANT.game.stage)"):
            break
        pg.wait_for_timeout(400)
    else:
        raise RuntimeError("stage never loaded")
    pg.bring_to_front()
    # The title button is intermittently missed on a loaded machine, and a probe
    # that silently measures the MENU is worse than one that fails loudly.
    for _ in range(8):
        if pg.evaluate("()=>ASCENDANT.state") != "title":
            break
        clicked = False
        for sel in ("#ui button.asc-btn:visible:has-text('NEW RUN')",
                    "#ui button.asc-btn:visible:has-text('CONTINUE')"):
            try:
                pg.click(sel, timeout=2500)
                clicked = True
                break
            except Exception:
                pass
        if not clicked:
            try:
                pg.keyboard.press("Enter")
            except Exception:
                pass
        pg.wait_for_timeout(1200)
    pg.wait_for_timeout(2500)
    st = pg.evaluate("()=>ASCENDANT.state")
    if st == "title":
        raise RuntimeError("never left the title screen -- would have measured the menu")
    vm = pg.evaluate("()=>{let m=0;ASCENDANT.engine.overlayScene.traverse("
                     "o=>{if(o.isMesh||o.isInstancedMesh)m++;});return m;}")
    return st, vm


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="neon-1")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--frames", type=int, default=60)
    ap.add_argument("--repeats", type=int, default=5)
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    url = ("http://localhost:8788/games/ascendant/index.html"
           f"?dev=1&stage={args.stage}&quality={args.quality}")

    samples = {name: [] for name, _ in CONFIGS}

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        state, vm_meshes = boot(pg, url)
        raf = pg.evaluate(RAF_FLOOR)
        info = pg.evaluate(SETUP)
        gpu = pg.evaluate("""()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');
          const d=g.getExtension('WEBGL_debug_renderer_info');
          return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'?';}""")

        print("GPU:  ", gpu)
        print("STAGE:", args.stage, "| QUALITY:", args.quality, "| state:", state,
              "| viewmodel meshes:", vm_meshes)
        print("PASSES:", info["passes"])
        print("PER FRAME:", info["drawCalls"]["calls"], "draws,",
              info["drawCalls"]["tris"], "tris")
        print(f"rAF floor on this machine: {raf} ms median interval "
              f"({1000.0/raf:.0f} Hz ceiling regardless of render cost)")

        st = pg.evaluate(SELFTEST)
        print(f"self-test: 40f={st['small']} ms, 80f={st['large']} ms -> "
              f"marginal {st['marginal']} ms/frame, fixed sync {st['fixedOverhead']} ms/batch")
        if st["marginal"] < 0.05:
            print("ABORT: the GPU sync is not blocking on real work; timings would be fiction.")
            br.close()
            return 2
        print(f"method: readPixels-synced two-point, {args.frames}/{args.frames*2} frames "
              f"x {args.repeats} interleaved repeats, MINIMUM\n")

        present = set(info["passes"])
        live = [(n, off) for n, off in CONFIGS
                if not off or n == "scene only" or any(o in present for o in off)]

        for r in range(args.repeats + 1):
            for name, off in live:            # interleaved: drift hits every row equally
                pg.evaluate(APPLY, off)
                t1t2 = pg.evaluate(MEASURE, [args.frames, 10])
                if r:                          # discard repeat 0 (warm / shader compile)
                    samples[name].append(t1t2)
            pg.evaluate(RESTORE)
        br.close()

    def per_frame(name):
        v = samples[name]
        t1 = min(x[0] for x in v)
        t2 = min(x[1] for x in v)
        return (t2 - t1) / args.frames, t1, t2

    base = per_frame("full chain")[0]
    print(f"{'config':<18}{'ms/frame':>10}{'delta ms':>10}{'minT(n)':>10}{'minT(2n)':>10}")
    print("-" * 58)
    out = {}
    for name, _ in live:
        ms, t1, t2 = per_frame(name)
        out[name] = {"ms": round(ms, 3), "minT1": round(t1, 2), "minT2": round(t2, 2),
                     "samples": [[round(a, 2), round(b, 2)] for a, b in samples[name]]}
        print(f"{name:<18}{ms:>10.3f}{ms - base:>+10.3f}{t1:>10.1f}{t2:>10.1f}")
    print("-" * 58)
    print(f"full chain = {base:.3f} ms/frame of render work.")
    print("delta ms = what removing that pass saves (negative = cheaper without it).")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"stage": args.stage, "quality": args.quality, "rafFloorMs": raf,
                       "fullChainMs": round(base, 3), "rows": out}, f, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
