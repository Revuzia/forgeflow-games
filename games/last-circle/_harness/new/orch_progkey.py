#!/usr/bin/env python
"""orch_progkey - ORCH lane (Wave 4): the canvas-output compile hook must not leak between materials that share a program.

    python _harness/new/orch_progkey.py --disk                 # whole working tree
    python _harness/new/orch_progkey.py --disk --isolate       # git HEAD for every file except ffg_royale3d.js

Why: three keys a program on the material's parameters (map, fog, side, premultipliedAlpha, opaque ...) and on its
customProgramCacheKey, but NOT on its blending mode. An AdditiveBlending material and a Normal-blend transparent one that are
otherwise identical therefore resolve to ONE program, and whichever compiled first decides the source for both. The ORCH hook
(installCanvasOutput in ffg_royale3d.js) patches the source by blending, so on the direct (low) route it must also key the program
by blending (customProgramCacheKey) or one of the pair draws with the other's output maths.

Each pair below is built from identical parameters and drawn in a fresh frame, the additive one FIRST in some pairs and the normal
one first in the others, then every material's COMPILED fragment source is read back (gl.getShaderSource):
  built-in MeshBasicMaterial pair (a), (b)   additive -> 'additive' fix, normal -> none, in both orders
  SpriteMaterial pair (c)                    same
  ShaderMaterial pair carrying the output chunks (d)   same source, additive vs normal
  after low -> medium: every one of them compiles its untouched render-target variant (no 'lcCanvasOut' anywhere), medium programs
  are keyed exactly as before (the extra key part only exists on the direct route).
Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common as C  # noqa: E402
import orch_lowpost as L  # noqa: E402

BUILD_JS = r"""(spec) => {
  const W = window.__LC__.W, T = W.THREE, cam = W.camera;
  const tex = new T.DataTexture(new Uint8Array([255,255,255,255, 160,160,160,255, 160,160,160,255, 255,255,255,255]), 2, 2);
  tex.colorSpace = T.SRGBColorSpace; tex.needsUpdate = true;
  const fwd = new T.Vector3(); cam.getWorldDirection(fwd);
  const right = new T.Vector3().crossVectors(fwd, cam.up).normalize();
  const FS = 'void main() { gl_FragColor = vec4(0.30, 0.50, 0.80, 0.5);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}';
  const VS = 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  // a premultiplied-blend shader that writes STRAIGHT HDR colour and premultiplies after the chunks itself (the loot ring's pattern)
  const FSS = 'void main() { gl_FragColor = vec4(2.5, 0.6, 0.3, 0.5);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n#include <premultiplied_alpha_fragment>\n}';
  const mk = (kind, additive, opt) => {
    const b = additive ? T.AdditiveBlending : T.NormalBlending;
    if (kind === 'basic') return new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: b, fog: opt.fog, side: opt.side });
    if (kind === 'straight') return new T.ShaderMaterial({ vertexShader: VS, fragmentShader: FSS, transparent: true, depthWrite: false, blending: T.NormalBlending, premultipliedAlpha: true });
    if (kind === 'sprite') return new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: b, fog: opt.fog });
    return new T.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: b });
  };
  const made = [];
  let slot = 0;
  for (const g of spec) {
    const m = mk(g.kind, g.additive, g.opt || {});
    const geo = g.kind === 'sprite' ? null : new T.PlaneGeometry(1.2, 1.2);
    const o = g.kind === 'sprite' ? new T.Sprite(m) : new T.Mesh(geo, m);
    o.position.copy(cam.position).addScaledVector(fwd, 7).addScaledVector(right, (slot++ - 3.5) * 1.5);
    o.frustumCulled = false; o.renderOrder = 7; o.name = 'orchprogkey';
    if (g.kind !== 'sprite') o.lookAt(cam.position);
    W.scene.add(o);
    made.push({ pair: g.pair, kind: g.kind, additive: g.additive, uuid: m.uuid });
  }
  return made;
}"""

READ_JS = r"""(uuids) => {
  const W = window.__LC__.W, r = W.kernel.renderer, gl = r.getContext(), out = [], progs = {};
  W.scene.traverse((o) => {
    if (o.name !== 'orchprogkey') return;
    const m = o.material, p = r.properties.get(m).currentProgram;
    let fs = null;
    if (p && p.program) for (const x of (gl.getAttachedShaders(p.program) || [])) if (gl.getShaderParameter(x, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER) fs = gl.getShaderSource(x);
    const fix = fs === null ? null : fs.indexOf('additive light stays linear') >= 0 ? 'additive' : fs.indexOf('premultiplied -> straight') >= 0 ? 'premul'
      : fs.indexOf('lcCanvasOut: chunks') >= 0 ? 'chunks' : 'none';
    out.push({ uuid: m.uuid, program: p ? p.id : null, fix, patchedAny: fs ? fs.indexOf('lcCanvasOut') >= 0 : null, key: m.customProgramCacheKey().slice(-12) });
  });
  return { rows: out, programs: r.info.programs ? r.info.programs.length : -1, post: W._gfx && W._gfx.post };
}"""

# pairs: (pair id, kind, additive first?, options). Distinct options per pair so two pairs never share a key with each other.
PAIRS = [
    ("a-basic-add-first", "basic", True, {"fog": False, "side": 2}),
    ("b-basic-normal-first", "basic", False, {"fog": True, "side": 0}),
    ("c-sprite-add-first", "sprite", True, {"fog": False}),
    ("d-shader-normal-first", "shader", False, {}),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--isolate", action="store_true", help="serve git HEAD for every file except the working-copy ffg_royale3d.js")
    ap.add_argument("--map", default="isla_viva")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    if args.isolate and not args.rev:
        args.rev = "HEAD"

    def body(v):
        with C.Session(args, "orch_progkey", init_scripts=[L.TIER_INIT]) as s:
            if getattr(args, "isolate", False):
                L.head_override(s)
            s.boot(L.url_for(args.base, "low", False, 21))
            s.start_match("standard", args.seed, args.map, enter=False)
            s.freeze_loop()
            s.step_frames(6, 1 / 60, render=True)
            post = s.js("() => window.__LC__.W._gfx.post")
            v.check("low match runs on the direct route", post == "direct", {"post": post})
            made = []
            # each pair: first material in one frame, the second material in the NEXT frame (compile order is the point)
            for pair, kind, add_first, opt in PAIRS:
                a = s.js(BUILD_JS, [{"pair": pair, "kind": kind, "additive": add_first, "opt": opt}])
                s.step_frames(2, 1 / 60, render=True)
                b = s.js(BUILD_JS, [{"pair": pair, "kind": kind, "additive": not add_first, "opt": opt}])
                s.step_frames(2, 1 / 60, render=True)
                made += a + b
            # a straight-colour premultiplied shader (loot ring pattern) must be left alone by the hook: HDR colour is not clamped
            made_e = s.js(BUILD_JS, [{"pair": "e-straight-premul", "kind": "straight", "additive": False, "opt": {}}])
            s.step_frames(2, 1 / 60, render=True)
            low = s.js(READ_JS, [m["uuid"] for m in made])
            by = {m["uuid"]: m for m in made}
            rows = [dict(r, **{k: by[r["uuid"]][k] for k in ("pair", "kind", "additive")}) for r in low["rows"] if r["uuid"] in by]
            row_e = [r for r in low["rows"] if r["uuid"] == made_e[0]["uuid"]]
            v.check("direct route: a premultiplied shader that includes premultiplied_alpha_fragment (straight HDR colour) is NOT rewritten by the hook",
                    len(row_e) == 1 and row_e[0]["patchedAny"] is False and row_e[0]["program"] is not None, row_e, expect="compiled, no lcCanvasOut marker")
            v.data["low"] = rows
            bad = []
            for r in rows:
                want = "additive" if r["additive"] else "none"
                if r["fix"] != want:
                    bad.append({"pair": r["pair"], "kind": r["kind"], "additive": r["additive"], "got": r["fix"], "want": want, "program": r["program"]})
            v.check("direct route: %d materials in %d pairs compiled the source their OWN blending needs (additive -> linear light, normal -> untouched)"
                    % (len(rows), len(PAIRS)), len(rows) == 2 * len(PAIRS) and not bad, {"bad": bad, "rows": rows},
                    expect="0 wrong; an additive and a normal material never share a program")
            share = []
            for pair, *_ in PAIRS:
                ps = {r["program"] for r in rows if r["pair"] == pair}
                if len(ps) != 2:
                    share.append(pair)
            v.info("pairs that resolved to ONE shared program on the direct route (should be none)", share)
            # low -> medium: the render-target variants must be the untouched source
            s.js(L.APPLY_JS, "medium")
            s.step_frames(8, 1 / 60, render=True)
            med = s.js(READ_JS, [m["uuid"] for m in made])
            med["rows"] = [r for r in med["rows"] if r["uuid"] in by]
            v.data["medium"] = med
            v.check("medium: composer is real and no test material compiled the canvas fix (render-target programs untouched)",
                    med["post"] == "composer" and all(r["patchedAny"] is False for r in med["rows"]) and len(med["rows"]) == 2 * len(PAIRS),
                    {"post": med["post"], "rows": med["rows"]})
            d = s.diagnostics()
            probs = C.diag_problems(d)
            v.check("0 console / page / window errors, 0 failed requests, 0 shader errors", not probs, probs or "clean")

    return C.run_gate("orch_progkey", body, args)


if __name__ == "__main__":
    sys.exit(main())
