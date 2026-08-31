#!/usr/bin/env python
"""ASCENDANT chain A/B — old post chain vs new, in ONE page session.

Machine load on this box drifts enough between two separate probe runs to swamp
a sub-millisecond difference, so comparing a "before" run to an "after" run is
not evidence. This builds BOTH chains against the same renderer, in the same
session, and measures them INTERLEAVED, so any drift hits both equally.

  OLD  RenderPass, ViewmodelPass, UnrealBloomPass(full), GradePass(no tone map),
       SMAAPass, OutputPass
  NEW  RenderPass, ViewmodelPass, ScaledBloomPass, FinishPass(grade+ACES+sRGB),
       FXAAPass                                        (whatever post.js builds)

The OLD grade pass is reconstructed from the SAME exported GradeShader with no
tone-map defines set -- with SRGB_TRANSFER and *_TONE_MAPPING undefined, those
blocks compile out and the shader is exactly the pre-change grade.

Timing method and its three traps are documented in passcost.py.

    python chainab.py --stage neon-1
"""
import argparse
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, __file__.rsplit("\\", 1)[0] if "\\" in __file__ else ".")
from passcost import boot, FLAGS  # noqa: E402

BUILD = r"""
async () => {
  const A = globalThis.ASCENDANT, E = A.engine, P = E.post, R = E.renderer;
  const base = './assets/vendor/three/examples/jsm/';
  const [THREE, EC, UB, SM, OP, SP, post] = await Promise.all([
    import('./assets/vendor/three/build/three.module.js'),
    import(base + 'postprocessing/EffectComposer.js'),
    import(base + 'postprocessing/UnrealBloomPass.js'),
    import(base + 'postprocessing/SMAAPass.js'),
    import(base + 'postprocessing/OutputPass.js'),
    import(base + 'postprocessing/ShaderPass.js'),
    import('./runtime/fx/post.js'),
  ]);

  // NOTE: the engine is deliberately NOT stopped here. chainab stops it for
  // timing; lookab needs the game loop alive so the camera, the player and the
  // animated grade uniforms keep updating while it screenshots.
  const gl = R.getContext();
  const pr = R.getPixelRatio();
  const w = P.width, h = P.height;
  const dw = Math.round(w * pr), dh = Math.round(h * pr);

  // NEW chain = whatever post.js just built.
  const nu = P.composer;
  nu.renderToScreen = false;

  // OLD chain, rebuilt from the same parts it used before the change.
  const old = new EC.EffectComposer(R);
  old.setPixelRatio(pr);
  old.setSize(w, h);
  old.renderToScreen = false;
  old.addPass(nu.passes[0]);                        // RenderPass   (shared)
  old.addPass(nu.passes[1]);                        // ViewmodelPass (shared)
  const bloom = new UB.UnrealBloomPass(new THREE.Vector2(dw, dh), 0.6, 0.7, 0.7);
  old.addPass(bloom);
  const grade = new SP.ShaderPass({                 // grade WITHOUT tone map
    name: 'OldGrade',
    uniforms: THREE.UniformsUtils.clone(post.GradeShader.uniforms),
    vertexShader: post.GradeShader.vertexShader,
    fragmentShader: post.GradeShader.fragmentShader,
  });
  grade.material.toneMapped = false;
  grade.uniforms.uResolution.value.set(dw, dh);
  old.addPass(grade);
  old.addPass(new SM.SMAAPass(dw, dh));
  old.addPass(new OP.OutputPass());

  const W = (globalThis.__ab = {});
  W.px = new Uint8Array(4);
  W.mk = (comp) => {
    const sync = () => {
      R.setRenderTarget(comp.readBuffer);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, W.px);
      R.setRenderTarget(null);
    };
    return (n) => {
      sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) comp.render(0.016);
      sync();
      return performance.now() - t0;
    };
  };
  W.chains = { old: W.mk(old), new: W.mk(nu) };
  W.comps = { old: old, new: nu };            // lookab.py renders these to screen
  W.warm = (which) => { const b = W.chains[which]; b(10); };

  // The rebuilt OLD grade pass owns its own cloned uniforms, so it knows
  // nothing about the active theme's grade or the animated pulse/damage/heat/
  // time values. Mirror the live ones in before every old-chain frame,
  // otherwise the "before" screenshot is a neutral grade compared against a
  // themed one and the comparison is worthless.
  const mirror = () => {
    const src = P.finishPass && P.finishPass.uniforms;
    if (!src) return;
    const dst = grade.uniforms;
    for (const k in dst) {
      if (k === 'tDiffuse' || !src[k]) continue;
      const a = src[k].value, b = dst[k];
      if (a && a.isVector3) b.value.copy(a);
      else if (a && a.isVector2) b.value.copy(a);
      else b.value = a;
    }
  };
  const oldRender = old.render.bind(old);
  old.render = (dt) => { mirror(); return oldRender(dt); };

  // Point Post.render's composer at whichever chain we want on screen. Post
  // updates finishPass's uniforms and then renders this.composer, so swapping
  // the reference is enough to A/B the whole chain with everything else live.
  W.select = (which) => {
    Object.keys(W.comps).forEach((k) => { W.comps[k].renderToScreen = (k === which); });
    P.composer = W.comps[which];
    return which;
  };

  const names = (c) => c.passes.map(p => p.constructor.name);
  const bloomPx = (c) => {
    const b = c.passes.find(p => /Bloom/.test(p.constructor.name));
    if (!b) return 0;
    let px = 0;
    const add = (rt) => { if (rt) px += rt.width * rt.height; };
    b.renderTargetsHorizontal.forEach(add);
    b.renderTargetsVertical.forEach(add);
    add(b.renderTargetBright);
    return Math.round(px);
  };
  const draws = (c) => { R.info.reset(); c.render(0.016); return R.info.render.calls; };
  return {
    old: { passes: names(old), bloomTargetPx: bloomPx(old), draws: draws(old) },
    new: { passes: names(nu), bloomTargetPx: bloomPx(nu), draws: draws(nu) },
  };
}
"""

MEASURE = r"""
([which, frames]) => {
  const W = globalThis.__ab, b = W.chains[which];
  b(10);
  const t1 = b(frames);
  const t2 = b(frames * 2);
  return [t1, t2];
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="neon-1")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--frames", type=int, default=60)
    ap.add_argument("--repeats", type=int, default=8)
    ap.add_argument("--cooldown", type=int, default=700,
                    help="ms of idle before each batch, to let the GPU recover")
    args = ap.parse_args()

    url = ("http://localhost:8788/games/ascendant/index.html"
           f"?dev=1&stage={args.stage}&quality={args.quality}")

    got = {"old": [], "new": []}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        boot(pg, url)
        info = pg.evaluate(BUILD)
        pg.evaluate("()=>ASCENDANT.engine.stop()")   # timing only: no loop

        print("STAGE:", args.stage, "| QUALITY:", args.quality)
        for k in ("old", "new"):
            d = info[k]
            print(f"  {k.upper():<4} {d['draws']:>4} draws | bloom targets "
                  f"{d['bloomTargetPx']:>9,} px | {d['passes']}")
        print(f"\ninterleaved, {args.frames}/{args.frames*2} frames x {args.repeats} repeats\n")

        # This GPU throttles HARD under a sustained benchmark -- measured drift
        # from 1.0 to 3.3 ms/frame over five repeats of the identical workload.
        # Two consequences, both designed around here:
        #   * order is ALTERNATED each repeat. Measuring old-then-new every time
        #     hands the later slot (always the slower one) to the same chain,
        #     which is a bias larger than the effect being measured.
        #   * each batch gets a cooldown so the part can recover a little.
        # Results are PAIRED within a repeat and reduced by median ratio, since
        # drift scales both chains together and divides out.
        for r in range(args.repeats + 1):
            order = ("old", "new") if r % 2 == 0 else ("new", "old")
            for which in order:
                pg.wait_for_timeout(args.cooldown)
                t = pg.evaluate(MEASURE, [which, args.frames])
                if r:
                    got[which].append(t)
        br.close()

    def per_frame(k):
        return (min(x[1] for x in got[k]) - min(x[0] for x in got[k])) / args.frames

    for k in ("old", "new"):
        print(f"  raw {k}: minT(n)={min(x[0] for x in got[k]):.1f} "
              f"minT(2n)={min(x[1] for x in got[k]):.1f}  "
              f"samples={[[round(a,1), round(b,1)] for a, b in got[k]]}")
    print()

    import statistics
    pf = {k: [(t2 - t1) / args.frames for t1, t2 in got[k]] for k in got}
    pairs = list(zip(pf["old"], pf["new"]))
    ratios = [n / o for o, n in pairs if o > 0]
    print(f"{'repeat':<8}{'OLD ms':>9}{'NEW ms':>9}{'new/old':>9}")
    print("-" * 35)
    for i, (o, n) in enumerate(pairs):
        print(f"{i+1:<8}{o:>9.3f}{n:>9.3f}{(n/o if o else 0):>9.3f}")
    print("-" * 35)
    med = statistics.median(ratios) if ratios else 0
    print(f"median new/old ratio: {med:.3f}  "
          f"({100.0*(1-med):+.1f}% cheaper)" if med else "no ratio")
    print(f"median OLD {statistics.median(pf['old']):.3f} ms/frame, "
          f"median NEW {statistics.median(pf['new']):.3f} ms/frame")
    bo = info["old"]["bloomTargetPx"]
    bn = info["new"]["bloomTargetPx"]
    print(f"bloom target pixels: {bo:,} -> {bn:,} ({100.0*(bo-bn)/max(bo,1):.0f}% fewer)")
    print(f"draw calls per frame: {info['old']['draws']} -> {info['new']['draws']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
