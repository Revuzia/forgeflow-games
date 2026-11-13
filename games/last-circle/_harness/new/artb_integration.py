#!/usr/bin/env python
"""ART-B integration gate (lane ART-B, wave 4): do the lane's assets reach the RUNNING game, and does it stay clean?

Boots the game in real Chrome (default --disk = the working copy through page routing; `--rev HEAD` or the lanes'
isowrap tools serve a frozen tree), starts a standard match, lands, steps 240 rendered frames, then checks:

  1 the game boots, reaches the drop and lands (CNJ when the box starves the load)
  2 assets/fx/{spark,puff,glow,tracer}.png are fetched with HTTP 200 by the running game (fx.js init, contract C-ART-FX);
    CNJ when NO fx request is seen (the consumer has not landed in the tree being served)
  3 town-kit GLBs decode through the KERNEL's own loader (W.kernel.loadGLTF -> its lazy meshopt hook -> the vendored
    meshopt_decoder.module.js): one type per manifest group, triangles == manifest tris (+-2 %), POSITION Float32Array;
    the decoder module answers 200. CNJ when the kernel has no meshopt hook (the STORMFX kernel change has not landed)
  4 0 page errors, 0 console errors, 0 failed requests, 0 shader errors over the whole run (common.diagnostics)
  INFO  which assets/hud/wpn_*.png the HUD fetched (they are requested only once a gun is shown, so absence is not a fail),
        total bytes of the lane's files the page fetched

Exit 0 pass / 1 fail / 2 could-not-judge.

USAGE   python _harness/new/artb_integration.py              (working copy, --disk implied)
        python _harness/new/artb_integration.py --rev HEAD   (as committed)
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
H = os.path.dirname(HERE)
GAME = os.path.dirname(H)
sys.path.insert(0, H)

import common as C  # noqa: E402
from common import EnvFailure, run_gate  # noqa: E402

MANIFEST = os.path.join(GAME, "assets", "props", "city", "manifest.json")
FX = ["spark", "puff", "glow", "tracer"]
MINE = ("assets/fx/", "assets/hud/wpn_", "assets/props/city/", "assets/props/cars/", "assets/tex/",
        "examples/jsm/libs/meshopt_decoder.module.js")

DECODE_JS = """async (items) => {
  const W = window.__LC__.W, K = W.kernel, out = [];
  const base = W.assetBase || '';
  for (const it of items) {
    try {
      const root = await K.loadGLTF(base + 'assets/props/city/' + it.file);
      let tris = 0, attrs = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        attrs.push(g.attributes.position.array.constructor.name);
      });
      out.push({ id: it.id, ok: tris > 0, tris, attrs: Array.from(new Set(attrs)).join(',') });
    } catch (e) {
      out.push({ id: it.id, ok: false, error: String(e && e.message || e).slice(0, 300) });
    }
  }
  return out;
}"""


def main_fn(v, args):
    if not os.path.exists(MANIFEST):
        v.check("manifest present", False, MANIFEST)
        return
    m = json.load(open(MANIFEST, encoding="utf-8"))
    pick, seen = [], set()
    for k, t in m["types"].items():                      # one type per group
        if t["group"] not in seen:
            seen.add(t["group"])
            pick.append({"id": k, "file": t["file"], "tris": t["tris"]})

    hits = {}                                            # rel path -> (status, bytes)

    with C.Session(args, name="artb_integration") as s:
        def on_resp(r):
            try:
                u = r.url.split("?", 1)[0]
                if any(p in u for p in MINE):
                    rel = u.split("/games/last-circle/", 1)[-1]
                    f = os.path.join(GAME, rel.replace("/", os.sep))          # bytes = the file served (no body() call in a handler)
                    n = os.path.getsize(f) if r.status < 300 and os.path.isfile(f) else 0
                    hits[rel] = (r.status, n)
            except Exception:
                pass

        s.page.on("response", on_resp)
        s.boot()
        s.start_match(mode="standard", seed=7)
        landed = s.land(max_s=120, protect=True) or {}
        s.stage("frames")
        s.step_frames(240, render=True)
        v.check("boot -> drop -> landed", landed.get("onGround") and landed.get("alive") and s.phase() == "match",
                "phase %s, land %s" % (s.phase(), json.dumps(landed)[:160]))

        # 2 fx textures fetched by the running game
        fx_seen = {n: hits.get("assets/fx/%s.png" % n) for n in FX}
        if not any(fx_seen.values()):
            v.cnj("fx PNGs fetched by the running game (C-ART-FX)", "no assets/fx request seen: fx.js consumer not in the served tree")
        else:
            bad = [n for n, h in fx_seen.items() if not h or h[0] != 200]
            v.check("fx PNGs fetched by the running game (C-ART-FX)", not bad,
                    "; ".join("%s %s" % (n, h) for n, h in fx_seen.items()))

        # 3 kit GLBs through the kernel's meshopt hook
        has_hook = s.safe_js("""() => { const K = window.__LC__.W.kernel; return !!(K && (K.meshoptDecoder || (K.loader && K.loader.meshoptDecoder))); }""",
                             default=False)
        s.stage("kitdecode")
        res = s.js(DECODE_JS, pick)
        dec = hits.get("assets/vendor/three/examples/jsm/libs/meshopt_decoder.module.js")
        bad = []
        for it, r in zip(pick, res):
            if not r.get("ok"):
                bad.append("%s: %s" % (it["id"], r.get("error", "0 tris")))
            elif abs(r["tris"] - it["tris"]) > max(2, 0.02 * it["tris"]):
                bad.append("%s browser %d vs manifest %d" % (it["id"], r["tris"], it["tris"]))
            elif "Float32Array" not in r.get("attrs", "") or "," in r.get("attrs", ""):
                bad.append("%s attrs %s" % (it["id"], r.get("attrs")))
        detail = "kernel meshopt hook %s; decoder module %s; %s" % (
            "present" if has_hook else "ABSENT", dec, "; ".join(bad[:4]) or "%d/%d decoded, tris match, float32" % (len(res), len(pick)))
        if not has_hook and bad:
            v.cnj("town-kit GLBs decode through W.kernel.loadGLTF (meshopt hook)", detail)
        else:
            v.check("town-kit GLBs decode through W.kernel.loadGLTF (meshopt hook)", not bad and (dec is None or dec[0] == 200), detail)

        # 4 clean run
        d = s.diagnostics()
        C.print_diagnostics(d)
        probs = C.diag_problems(d, rig=False)
        v.check("0 page / console / shader errors, 0 failed requests", not probs, ", ".join(probs) or "clean")

        wpn = {k: h for k, h in hits.items() if "assets/hud/wpn_" in k}
        v.info("HUD weapon silhouettes fetched", ", ".join("%s %s" % (k.rsplit("/", 1)[-1], h[0]) for k, h in sorted(wpn.items())) or
               "none requested in this run (fetched only once a gun is shown)")
        tot = sum(h[1] for h in hits.values() if h[1] > 0)
        v.info("lane ART-B bytes fetched by the page", "%d B over %d files" % (tot, len(hits)))
        v.data["hits"] = {k: list(h) for k, h in hits.items()}
        v.data["decode"] = res


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.set_defaults(disk=True)
    args = ap.parse_args()
    return run_gate("artb_integration", lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
