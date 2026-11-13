#!/usr/bin/env python
"""orch_lowpost - ORCH lane (Wave 4): the LOW tier draws straight to the canvas, and the post route survives tier changes.

    python _harness/new/orch_lowpost.py --disk                 # whole working tree
    python _harness/new/orch_lowpost.py --disk --isolate       # git HEAD for every file except ffg_royale3d.js (other lanes' edits out)
    python _harness/new/orch_lowpost.py --disk --leak          # + 3 back-to-back matches on low, textures/geometries flat

What it proves (exit 0 pass / 1 fail / 2 could-not-judge; same convention as every other gate):
  low from boot       a stored tier of 'low' boots to kernel.composer.isDirectPost (hud.js:823 must NOT rebuild one), W._gfx.post
                      === 'direct', no UnrealBloomPass was ever allocated (kernel.bloom undefined)
  canvas output       read from each drawn material's COMPILED program (gl.getShaderSource): on the canvas every ShaderMaterial
                      encodes its output (both sky domes get the chunks), premultiplied ones (storm wall/bolts, fx quads, loot
                      beams/rings) premultiply AFTER the encode, additive ones add linear light; menu, match and the menu rebuilt
                      after a match. The render-target programs (medium after a switch, the ?lowpost=1 control) carry NO fix
  warm-up             W._warm.post === 'direct' (the warm frame was drawn to the canvas), W._warm.by lists every provider; drop
                      frame 1 links 0 new programs on the direct route
  looks like composer the same stepped frame drawn through the composer (?lowpost=1, the pre-change behaviour) and straight to the
                      canvas: the SKY band and the whole frame stay within tolerance (the sky shader was the known risk)
  tier switches       low -> medium brings a REAL composer back (RenderPass, bloom, output pass), renders a non-black frame, and
                      medium -> low drops to direct again, 0 page errors
  0 console / page / window errors, 0 failed requests, 0 shader errors across all of it
The control (`?lowpost=1`) must report composer 'real' with the bloom pass off: that is the old low-tier behaviour, kept as the A/B arm.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common as C  # noqa: E402

TIER_INIT = r"""(() => { try { const m = /[#&]h_tier=(low|medium|high)/.exec(location.hash || '');
  if (m) localStorage.setItem('lc_settings', JSON.stringify({ graphics: m[1] })); } catch (_) {} })();"""

PROBE_JS = r"""() => { const W = window.__LC__.W, k = W.kernel, r = k.renderer, c = k.composer;
  // exact bytes of the post-processing render targets the ACTIVE route keeps (colour: w*h*4 channels*bytes per channel by
  // texture.type - 1009 UnsignedByte 1, 1016 HalfFloat 2, 1015 Float 4; + a 4-byte depth/stencil buffer where depthBuffer)
  const rtB = (t) => { if (!t || !t.isRenderTarget) return 0; const ty = t.texture && t.texture.type;
    const bpc = ty === 1016 ? 2 : ty === 1015 ? 4 : 1; return t.width * t.height * 4 * bpc + (t.depthBuffer ? t.width * t.height * 4 : 0); };
  let rtBytes = 0, rtCount = 0;
  if (c && !c.isDirectPost) {
    const seen = new Set(), add = (t) => { if (t && t.isRenderTarget && !seen.has(t)) { seen.add(t); rtBytes += rtB(t); rtCount++; } };
    add(c.renderTarget1); add(c.renderTarget2);
    for (const p of c.passes || []) for (const key in p) { const v = p[key]; if (Array.isArray(v)) v.forEach(add); else add(v); }
  }
  return { composer: c ? (c.isDirectPost ? 'direct' : 'real') : null, postRtBytes: rtBytes, postRtCount: rtCount,
           passes: c && c.passes ? c.passes.map((p) => p.constructor.name + (p.enabled === false ? '(off)' : '')) : null,
           bloomObject: !!k.bloom, bloomEnabled: k.bloom ? !!k.bloom.enabled : null, bloomStrength: k.bloom ? +k.bloom.strength.toFixed(3) : null,
           post: W._gfx ? W._gfx.post : null, tier: W._gfx ? W._gfx.tier : null, phase: W.phase,
           textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs ? r.info.programs.length : -1,
           toneMapping: r.toneMapping, exposure: r.toneMappingExposure, pr: r.getPixelRatio() }; }"""

SHADERS_JS = r"""() => { const W = window.__LC__.W, r = W.kernel.renderer, gl = r.getContext(), out = [], seen = new Set();
  // the COMPILED fragment source of each material's CURRENT program (the canvas variant on the direct route, the
  // render-target variant on the composer route): proves what actually runs, not what the material's source says
  const fsOf = (mm) => { const p = r.properties.get(mm).currentProgram; if (!p || !p.program) return null;
    for (const x of (gl.getAttachedShaders(p.program) || [])) if (gl.getShaderParameter(x, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER) return gl.getShaderSource(x);
    return null; };
  W.scene.traverse((o) => { const m = o.material; if (!m) return;
    for (const mm of (Array.isArray(m) ? m : [m])) { if (!mm || seen.has(mm)) continue; seen.add(mm);
      const shader = !!mm.isShaderMaterial, additive = mm.blending === 2, premul = !!mm.premultipliedAlpha && mm.blending === 1;
      if (!shader && !additive) continue;
      const fs = fsOf(mm);
      out.push({ obj: o.name || o.type, type: mm.type, raw: !!mm.isRawShaderMaterial, shader, additive, premul, compiled: fs !== null,
                 encodes: fs ? /gl_FragColor\s*=\s*linearToOutputTexel/.test(fs) : null,
                 fix: fs ? (fs.indexOf('premultiplied -> straight') >= 0 ? 'premul' : fs.indexOf('additive light stays linear') >= 0 ? 'additive'
                          : fs.indexOf('lcCanvasOut: chunks') >= 0 ? 'chunks' : 'none') : null,
                 own: fs ? fs.indexOf('#define LC_CANVAS') >= 0 : null,                          // the module's own onBeforeCompile wrote the canvas variant
                 premulChunk: fs ? /gl_FragColor\.rgb\s*\*=\s*gl_FragColor\.a/.test(fs) : null }); } });   // premultiplies after the chunks itself
  return out; }"""

# EVERY live program (renderer.info.programs), classified by the output transfer three compiled into its prefix
# (linearToOutputTexel -> sRGBTransferOETF = drawn to the canvas, LinearTransferOETF = into a render target) and whether
# it carries the ORCH canvas fix. The invariant: no render-target program is ever patched (medium/high untouched).
ALLPROGS_JS = r"""() => { const r = window.__LC__.W.kernel.renderer, gl = r.getContext(), out = { srgb: 0, srgbPatched: 0, linear: 0, linearPatched: 0, other: 0, names: [] };
  for (const p of (r.info.programs || [])) { let fs = null;
    for (const x of (gl.getAttachedShaders(p.program) || [])) if (gl.getShaderParameter(x, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER) fs = gl.getShaderSource(x);
    if (!fs) { out.other++; continue; }
    const patched = fs.indexOf('lcCanvasOut') !== -1;
    const kind = /linearToOutputTexel\( vec4 value \) \{\s*return sRGBTransferOETF/.test(fs) ? 'srgb' : /linearToOutputTexel\( vec4 value \) \{\s*return LinearTransferOETF/.test(fs) ? 'linear' : 'other';
    out[kind]++; if (patched && kind !== 'other') out[kind + 'Patched']++;
    if (patched && kind === 'linear') out.names.push(p.name); }
  return out; }"""

WARM_JS = r"""() => { const W = window.__LC__.W; return W._warm || null; }"""
# level the view (input.pitch > 0 = looking up) so the upper half of the frame is SKY, whatever the drop pose was
HORIZON_JS = r"""(pitch) => { const W = window.__LC__.W, p = W.player; p.input.pitch = pitch; p.pitch = pitch; return { pitch: p.input.pitch, gliding: !!p.gliding, y: +p.pos.y.toFixed(1) }; }"""
PROGRAMS_JS = r"""() => { const i = window.__LC__.W.kernel.renderer.info; return i.programs ? i.programs.length : -1; }"""
MENU_BTN_JS = r"""() => { const bs = [...document.querySelectorAll('[data-lc=mainmenu]'), ...document.querySelectorAll('button')];
  for (const b of bs) { if (b.matches('[data-lc=mainmenu]') || /^\s*MAIN MENU\s*$/.test(b.textContent || '')) {
    const q = b.getBoundingClientRect(); if (q.width > 0 && q.height > 0) return { x: q.left + q.width / 2, y: q.top + q.height / 2, text: (b.textContent || '').trim() }; } }
  return null; }"""
APPLY_JS = r"""(tier) => { const W = window.__LC__.W; W.settings.graphics = tier; W.applyGraphics(tier); return W._gfx; }"""
TEX_JS = r"""() => { const W = window.__LC__.W, i = W.kernel.renderer.info;
  // live = distinct geometries reachable from the scene right now; info.memory.geometries also counts every geometry ever
  // DRAWN and not yet disposed, so (info - live) growing match over match is a real leak, while live moving is content
  const live = new Set(); W.scene.traverse((o) => { if (o.geometry && o.geometry.isBufferGeometry) live.add(o.geometry); });
  return { textures: i.memory.textures, geometries: i.memory.geometries, liveGeometries: live.size, programs: i.programs ? i.programs.length : -1 }; }"""


def head_override(session, rel_suffix="/runtime/3d/ffg_royale3d.js"):
    """--isolate: the session serves git HEAD (args.rev) for everything; route ONLY the orchestrator to the working copy."""
    path = os.path.join(C.ROOT, "runtime", "3d", "ffg_royale3d.js")
    with open(path, "rb") as f:
        body = f.read()

    def pred(url):
        return url.split("?")[0].endswith(rel_suffix)

    def handler(route):
        route.fulfill(status=200, body=body, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store",
                                                      "Access-Control-Allow-Origin": "*"})
    session.disk.overrides.append((pred, handler))


def url_for(base, tier, lowpost=False, n=0):
    q = "?" if "?" not in base else "&"
    return "%s%slc=%d%s#h_tier=%s" % (base, q, n, "&lowpost=1" if lowpost else "", tier)


def img_stats(path):
    import numpy as np
    from PIL import Image
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w = im.shape[:2]
    lum = float(im.mean())
    return im, {"w": w, "h": h, "meanRGB": [round(float(x), 2) for x in im.reshape(-1, 3).mean(0)], "meanLum": round(lum, 2)}


def compare(a_path, b_path):
    import numpy as np
    a, sa = img_stats(a_path)
    b, sb = img_stats(b_path)
    if a.shape != b.shape:
        return {"error": "shape %s vs %s" % (a.shape, b.shape), "a": sa, "b": sb}
    d = np.abs(a - b)
    h, w = a.shape[:2]
    # 8 x 6 grid of mean colour differences; row 0 is the top strip (the sky wherever the horizon is below it)
    gx, gy = 8, 6
    cells = []
    for j in range(gy):
        row = []
        for i in range(gx):
            ca = a[j * h // gy:(j + 1) * h // gy, i * w // gx:(i + 1) * w // gx].reshape(-1, 3).mean(0)
            cb = b[j * h // gy:(j + 1) * h // gy, i * w // gx:(i + 1) * w // gx].reshape(-1, 3).mean(0)
            row.append(round(float(np.abs(ca - cb).max()), 1))
        cells.append(row)
    top = a[: h // 8]
    topb = b[: h // 8]
    return {"a": sa, "b": sb, "meanAbsDiff": round(float(d.mean()), 2), "p99AbsDiff": round(float(np.percentile(d, 99)), 1),
            "topStripMeanDiff": [round(float(x), 2) for x in np.abs(top.reshape(-1, 3).mean(0) - topb.reshape(-1, 3).mean(0))],
            "gridMaxChannelDiff": cells, "gridMax": max(max(r) for r in cells)}


def canvas_ok(shaders):
    """On the canvas: a ShaderMaterial with no blending fix must ENCODE its output (the sky domes: chunks appended); a premultiplied
    one must carry the 'premul' split; an additive one the linear 'additive' fix. Returns (ok, bad, compiled count)."""
    comp = [x for x in (shaders or []) if x.get("compiled") and not x.get("raw")]
    bad = []
    for x in comp:
        want = "additive" if x["additive"] else "premul" if (x["premul"] and x["shader"]) else None
        # a shader is also fine when the MODULE handled the canvas itself: x["own"] = its own onBeforeCompile defined LC_CANVAS and
        # wrote the canvas variant (loot beams / rings); a premultiplied ShaderMaterial with x["premulChunk"] writes STRAIGHT colour and
        # premultiplies after the chunks (three's order), which the hook leaves alone - it must still ENCODE its output
        handled = x.get("own") or (want == "premul" and x.get("premulChunk") and x["shader"] and x["encodes"])
        if want and x["fix"] != want and not handled:
            bad.append({"obj": x["obj"], "type": x["type"], "want": want, "fix": x["fix"], "own": x.get("own"), "premulChunk": x.get("premulChunk")})
        elif not want and x["shader"] and not x["encodes"]:
            bad.append({"obj": x["obj"], "type": x["type"], "want": "encodes", "fix": x["fix"]})
    return (bool(comp) and not bad), bad, len(comp)


def drop_frame_one(s, v, label):
    """Freeze the loop, press Enter into the drop, count programs around ONE stepped rendered frame (framecheck's method)."""
    s.freeze_loop()
    before = s.js(PROGRAMS_JS)
    s.page.keyboard.press("Enter")
    ok = s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 8, 0.1)
    if ok is None:
        s.page.keyboard.press("Enter")
        ok = s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 8, 0.1)
    mid = s.js(PROGRAMS_JS)
    s.step_frames(1, 1 / 60, render=True)
    after = s.js(PROGRAMS_JS)
    return {"phaseReached": ok is not None, "programsBeforeEnter": before, "programsAtDropStart": mid, "programsAfterFrame1": after,
            "newOnDropFrame1": after - mid}


def one_match_load(s, seed, map_id):
    return s.start_match("standard", seed, map_id, enter=False)


def run_arm(args, v, tier, lowpost, shot, tag):
    """Boot at a stored tier, record the menu, load a standard match, take drop frame 1 and a fixed-pose capture."""
    out = {"tag": tag}
    with C.Session(args, "orch_lowpost_" + tag, init_scripts=[TIER_INIT]) as s:
        if getattr(args, "isolate", False):
            head_override(s)
        s.boot(url_for(args.base, tier, lowpost, 1))
        s.freeze_loop()
        out["menu"] = s.js(PROBE_JS)
        s.step_frames(5, 1 / 60, render=True)
        out["menuAfterFrames"] = s.js(PROBE_JS)
        out["menuShaders"] = s.js(SHADERS_JS)        # after rendered frames: every drawn material has a current program
        s.thaw_loop()
        out["load"] = one_match_load(s, args.seed, args.map)
        out["lobby"] = s.js(PROBE_JS)
        out["warm"] = s.js(WARM_JS)
        out["matchShaders"] = s.js(SHADERS_JS)
        out["drop1"] = drop_frame_one(s, v, tag)
        s.step_frames(args.frames, 1 / 60, render=True)
        out["atCapture"] = s.js(PROBE_JS)
        out["captureShaders"] = s.js(SHADERS_JS)
        out["capturePrograms"] = s.js(ALLPROGS_JS)
        s.canvas_png(shot)
        out["shot"] = shot
        out["horizonPose"] = s.js(HORIZON_JS, args.horizon_pitch)
        s.step_frames(6, 1 / 60, render=True)
        hshot = shot.replace(".png", "_horizon.png")
        s.canvas_png(hshot)
        out["horizonShot"] = hshot
        if tag == "direct":
            # tier switches in the live session: low -> medium (real composer) -> low (direct again)
            sw = {}
            sw["toMedium"] = s.js(APPLY_JS, "medium")
            s.step_frames(8, 1 / 60, render=True)
            sw["medium"] = s.js(PROBE_JS)
            sw["mediumShaders"] = s.js(SHADERS_JS)
            sw["mediumPrograms"] = s.js(ALLPROGS_JS)
            medium_png = shot.replace(".png", "_medium.png")
            s.canvas_png(medium_png)
            sw["mediumShot"] = img_stats(medium_png)[1]
            sw["toLow"] = s.js(APPLY_JS, "low")
            s.step_frames(8, 1 / 60, render=True)
            sw["lowAgain"] = s.js(PROBE_JS)
            low_png = shot.replace(".png", "_lowagain.png")
            s.canvas_png(low_png)
            sw["lowAgainShot"] = img_stats(low_png)[1]
            out["switch"] = sw
            out["sw_mediumShaders"] = sw["mediumShaders"]
            # back to the menu after a match on low: QUIT TO MENU's call (W.endMatch(false)) -> the post-match panel -> a REAL
            # click on MAIN MENU. hud.js rebuilds the menu diorama (a new sky ShaderMaterial) and the frame loop must patch it
            # (the W._menuWorld identity check), and hud.js:823 must not build a composer on the way.
            back = {}
            s.thaw_loop()
            back["endMatch"] = s.js("() => { const W = window.__LC__.W; W.endMatch(false); return W.phase; }")
            btn = None
            for _ in range(90):              # the post-match panel is a 2.6 s setTimeout; HEAD's hud.js has no data-lc on the button
                btn = s.js(MENU_BTN_JS)
                if btn:
                    break
                s.sleep(0.5)
            back["button"] = btn
            if btn:
                s.page.mouse.click(btn["x"], btn["y"])    # a REAL click at the button's centre
                back["click"] = "real"
                back["inMenu"] = s.wait_js("() => window.__LC__.W.phase === 'menu' && !!window.__LC__.W._menuWorld", 30, 0.25) is not None
                s.freeze_loop()
                s.step_frames(4, 1 / 60, render=True)
                back["probe"] = s.js(PROBE_JS)
                back["shaders"] = s.js(SHADERS_JS)
                mpng = shot.replace(".png", "_menuback.png")
                s.canvas_png(mpng)
                back["shot"] = img_stats(mpng)[1]
                back["shotPath"] = mpng
            out["menuBack"] = back
        out["diag"] = s.diagnostics()
    return out


def leak_part(args, v, lowpost=False):
    """3 back-to-back matches on low: lobby textures/geometries of matches 2 and 3 within +-5 of match 1 (leaktest's bar).
    lowpost=True runs the same 3 matches on the composer route (the pre-change behaviour) as the control."""
    rows = []
    with C.Session(args, "orch_lowpost_leak" + ("_ctl" if lowpost else ""), init_scripts=[TIER_INIT]) as s:
        if getattr(args, "isolate", False):
            head_override(s)
        s.boot(url_for(args.base, "low", lowpost, 9))
        for i in range(args.leak_matches):
            s.thaw_loop() if i else None
            s.start_match("standard", 4242, "ashgrid", enter=False)
            s.freeze_loop()
            s.step_frames(3, 1 / 60, render=True)
            rows.append(s.js(TEX_JS))
            s.thaw_loop()
        d = s.diagnostics()
    return rows, d


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--isolate", action="store_true", help="serve git HEAD for every file except the working-copy ffg_royale3d.js")
    ap.add_argument("--leak", action="store_true", help="also run 3 back-to-back matches on low, direct + composer control (textures flat, geometry growth vs control)")
    ap.add_argument("--leak-only", action="store_true", help="ONLY the --leak part (skip the boot / look / tier-switch arms)")
    ap.add_argument("--leak-matches", type=int, default=3, help="back-to-back matches per leak arm (default 3)")
    ap.add_argument("--map", default="isla_viva")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--frames", type=int, default=24, help="stepped rendered frames before the fixed-pose capture")
    ap.add_argument("--horizon-pitch", type=float, default=0.12, help="input.pitch (radians, >0 = up) of the horizon capture")
    ap.add_argument("--sky-tol", type=float, default=14.0, help="max mean abs colour difference (0-255) of the top strip, direct vs composer")
    ap.add_argument("--frame-tol", type=float, default=14.0, help="max mean abs difference (0-255) of the whole frame, direct vs composer")
    args = ap.parse_args()
    if args.isolate and not args.rev:
        args.rev = "HEAD"

    shots = os.path.join(C.HERE, "_shots", "orch")
    os.makedirs(shots, exist_ok=True)

    def body(v):
        if args.leak_only:
            return leak_section(v)
        main_section(v)
        if args.leak:
            leak_section(v)

    def main_section(v):
        direct = run_arm(args, v, "low", False, os.path.join(shots, "low_direct.png"), "direct")
        v.data["direct"] = direct
        # ---- low from boot
        m = direct["menu"]
        v.check("low from boot: kernel.composer is the direct route (hud.js did not rebuild a composer)", m["composer"] == "direct" and m["post"] == "direct", m,
                expect="composer 'direct', W._gfx.post 'direct'")
        v.check("low from boot: no bloom pass was ever allocated", not m["bloomObject"], {"bloomObject": m["bloomObject"], "textures": m["textures"]},
                expect="kernel.bloom undefined (no composer, no half-float targets)")
        mf = direct["menuAfterFrames"]
        v.check("menu frames render on the direct route without a throw", mf["composer"] == "direct" and mf["tier"] == "low", mf)
        ok_m, bad_m, n_m = canvas_ok(direct["menuShaders"])
        v.check("menu (canvas): every drawn ShaderMaterial encodes its output (the sky dome included), premultiplied / additive ones fixed",
                ok_m, {"compiled": n_m, "bad": bad_m, "shaders": direct["menuShaders"]}, expect=">= 1 compiled, 0 bad")
        # ---- match
        w = direct["warm"] or {}
        v.check("warm-up frame drawn on the direct route (W._warm.post)", w.get("post") == "direct", {"warm": w}, expect="'direct'")
        v.info("warm-up providers (W._warm.by) and program counts", {"by": w.get("by"), "programs": w.get("programs"), "extrasIn": w.get("extrasIn"), "ms": w.get("ms")})
        ok_c, bad_c, n_c = canvas_ok(direct["captureShaders"])
        v.check("match (canvas): every drawn ShaderMaterial encodes (sky), premultiplied ones split + premultiplied AFTER the encode, additive ones linear",
                ok_c, {"compiled": n_c, "bad": bad_c, "shaders": direct["captureShaders"]}, expect=">= 1 compiled, 0 bad")
        v.info("canvas fix per material at the capture frame", [(x["obj"], x["type"], x["fix"]) for x in direct["captureShaders"] if x["compiled"]])
        mp = (direct.get("switch") or {}).get("mediumPrograms") or {}
        v.check("medium after the switch: no RENDER-TARGET program carries the canvas fix (medium/high compile from the untouched source)",
                mp.get("linear", 0) > 0 and mp.get("linearPatched", 1) == 0, mp,
                expect=">= 1 render-target program, 0 of them patched (canvas programs from the low frames may stay alive: information)")
        mt = [x for x in direct.get("sw_mediumShaders") or [] if x["compiled"]]
        v.info("medium after the switch: per drawn material, the fix on its CURRENT program ('none' = its render-target variant; a material not drawn in the 8 medium frames keeps its last, canvas, program)",
               [(x["obj"], x["type"], x["fix"]) for x in mt])
        cp = direct.get("capturePrograms") or {}
        v.info("all live programs at the low capture frame", cp)
        d1 = direct["drop1"]
        if not d1["phaseReached"]:
            v.cnj("drop frame 1 on low: 0 new programs", "a real Enter did not reach the drop (%s)" % d1)
        else:
            v.check("drop frame 1 on low: 0 new programs", d1["newOnDropFrame1"] == 0, d1, expect="0 (the warm-up covered the canvas variant)")
        cap = direct["atCapture"]
        v.check("capture frame drawn on the direct route", cap["composer"] == "direct" and cap["tier"] == "low", cap)
        # ---- tier switches
        sw = direct["switch"]
        med = sw["medium"]
        v.check("low -> medium brings a REAL composer back (RenderPass, bloom, output pass)",
                med["composer"] == "real" and med["passes"] and len(med["passes"]) >= 3 and "UnrealBloomPass" in med["passes"] and med["bloomEnabled"] is True,
                {"switch": sw["toMedium"], "probe": med}, expect="composer 'real', passes [RenderPass, UnrealBloomPass, *OutputPass], bloom enabled")
        v.check("low -> medium renders a non-black frame", sw["mediumShot"]["meanLum"] > 20, sw["mediumShot"], expect="mean luminance > 20/255")
        la = sw["lowAgain"]
        v.check("medium -> low drops to the direct route again and renders a non-black frame",
                la["composer"] == "direct" and sw["lowAgainShot"]["meanLum"] > 20, {"probe": la, "shot": sw["lowAgainShot"]})
        v.info("bloom strength after the low -> medium switch (match look is 0.14)", med.get("bloomStrength"))
        mb = direct.get("menuBack") or {}
        if not mb.get("button") or not mb.get("inMenu"):
            v.cnj("back to the menu after a low match (QUIT -> MAIN MENU): reached", {k: mb.get(k) for k in ("endMatch", "button", "click", "inMenu")})
        else:
            pb = mb["probe"]
            okb, bad, nb = canvas_ok(mb["shaders"])
            v.check("back to the menu after a low match: still the direct route (hud.js:823 built no composer)",
                    pb["composer"] == "direct" and pb["post"] == "direct" and pb["postRtBytes"] == 0, {k: pb.get(k) for k in ("composer", "post", "postRtBytes", "phase", "textures", "programs")},
                    expect="composer 'direct', 0 B of post render targets")
            v.check("back to the menu after a low match: the REBUILT menu sky encodes its output on the canvas",
                    okb, {"compiled": nb, "bad": bad, "shaders": mb["shaders"], "click": mb.get("click")})
            v.check("back to the menu after a low match: the menu frame is not dark", mb["shot"]["meanLum"] > 40, mb["shot"],
                    expect="mean luminance > 40/255 (a raw-linear sky dome reads far darker)")
        # ---- control arm
        comp = run_arm(args, v, "low", True, os.path.join(shots, "low_composer.png"), "composer")
        v.data["composer"] = comp
        cm = comp["atCapture"]
        v.check("control (?lowpost=1): low keeps the REAL composer with the bloom pass off (the old behaviour)",
                cm["composer"] == "real" and cm["bloomEnabled"] is False and cm["post"] == "composer", cm,
                expect="composer 'real', bloom pass disabled")
        ct = [x for x in comp.get("captureShaders") or [] if x["compiled"]]
        cpp = comp.get("capturePrograms") or {}
        v.check("control (?lowpost=1): the render-target programs carry NO canvas fix (the composer route is untouched)",
                bool(ct) and all(x["fix"] == "none" for x in ct) and cpp.get("linearPatched", 1) == 0,
                {"compiled": len(ct), "patched": [(x["obj"], x["fix"]) for x in ct if x["fix"] != "none"], "programs": cpp},
                expect=">= 1 compiled, all 'none', 0 patched render-target programs")
        rt = {"direct": {"bytes": cap.get("postRtBytes"), "targets": cap.get("postRtCount"), "textures": cap.get("textures"), "programs": cap.get("programs")},
              "composer": {"bytes": cm.get("postRtBytes"), "targets": cm.get("postRtCount"), "textures": cm.get("textures"), "programs": cm.get("programs")}}
        v.data["postRt"] = rt
        v.check("exact: the direct route keeps 0 bytes of post-processing render targets; the old low route kept > 0",
                rt["direct"]["bytes"] == 0 and (rt["composer"]["bytes"] or 0) > 0,
                {"directBytes": rt["direct"]["bytes"], "composerBytes": rt["composer"]["bytes"], "composerMB": round((rt["composer"]["bytes"] or 0) / 1048576, 2),
                 "composerTargets": rt["composer"]["targets"]},
                expect="direct 0, composer > 0 (colour + depth of every composer / bloom target at the capture size)")
        v.info("exact counts at the capture frame, direct vs composer (textures / programs alive)", rt)
        cmp_ = compare(direct["shot"], comp["shot"])
        v.data["compare"] = cmp_
        if "error" in cmp_:
            v.cnj("direct vs composer: same-pose frames comparable", cmp_["error"])
        else:
            v.info("direct vs composer, same stepped frame (information; see the PNGs in _shots/orch)", cmp_)
            v.check("direct vs composer: the sky band (top strip) matches within tolerance",
                    max(cmp_["topStripMeanDiff"]) <= args.sky_tol, {"topStripMeanDiff": cmp_["topStripMeanDiff"], "tol": args.sky_tol},
                    expect="<= %.0f / 255 per channel (raw-linear sky would be ~100+ darker)" % args.sky_tol)
            v.check("direct vs composer: whole-frame mean difference within tolerance",
                    cmp_["meanAbsDiff"] <= args.frame_tol, {"meanAbsDiff": cmp_["meanAbsDiff"], "p99": cmp_["p99AbsDiff"], "tol": args.frame_tol})
        hcmp = compare(direct["horizonShot"], comp["horizonShot"])
        v.data["compareHorizon"] = hcmp
        if "error" in hcmp:
            v.cnj("direct vs composer at the horizon: comparable", hcmp["error"])
        else:
            v.info("direct vs composer, horizon pose (information)", hcmp)
            v.check("horizon pose: the sky band (top strip) matches within tolerance",
                    max(hcmp["topStripMeanDiff"]) <= args.sky_tol, {"topStripMeanDiff": hcmp["topStripMeanDiff"], "tol": args.sky_tol,
                                                                   "a": hcmp["a"]["meanRGB"], "b": hcmp["b"]["meanRGB"]},
                    expect="<= %.0f / 255 per channel (a raw-linear sky is ~100+ darker)" % args.sky_tol)
            v.check("horizon pose: whole-frame mean difference within tolerance", hcmp["meanAbsDiff"] <= args.frame_tol,
                    {"meanAbsDiff": hcmp["meanAbsDiff"], "p99": hcmp["p99AbsDiff"], "tol": args.frame_tol})
        # ---- diagnostics for both sessions
        for name, arm in (("direct", direct), ("composer", comp)):
            probs = C.diag_problems(arm["diag"])
            v.check("%s arm: 0 console / page / window errors, 0 failed requests, 0 shader errors" % name, not probs, probs or "clean")

    def leak_section(v):
        rows, d = leak_part(args, v)
        v.data["leak"] = rows
        t0 = rows[0]
        # leaktest.py's bar is TEXTURES within +-5; geometries are judged by drawn-minus-live below
        v.check("%d matches on low (direct): textures of every later match within +-5 of match 1 (leaktest's bar)" % len(rows),
                all(abs(r["textures"] - t0["textures"]) <= 5 for r in rows[1:]), rows, expect="flat")
        probs = C.diag_problems(d)
        v.check("leak part: 0 errors", not probs, probs or "clean")
        crows, cd = leak_part(args, v, lowpost=True)
        v.data["leakControl"] = crows
        # a geometry LEAK = drawn-and-never-disposed geometries piling up = (info.memory.geometries - live in scene) growing match
        # over match. The raw count also moves with match CONTENT (live: 230 / 236 / 237 / 235 / 235 on HEAD, 5 matches), so the
        # raw +-5 bar of the first run of this row was judging content, not leaks.
        dd = [r["geometries"] - r.get("liveGeometries", r["geometries"]) for r in rows]
        dc = [r["geometries"] - r.get("liveGeometries", r["geometries"]) for r in crows]
        v.check("no geometry leak on the direct route: (drawn-not-disposed - live in scene) of every later match within +-5 of match 1",
                all(abs(x - dd[0]) <= 5 for x in dd[1:]),
                {"directNotLive": dd, "composerNotLive": dc, "direct": [r["geometries"] for r in rows], "directLive": [r.get("liveGeometries") for r in rows],
                 "composer": [r["geometries"] for r in crows], "composerLive": [r.get("liveGeometries") for r in crows]},
                expect="flat (a leak grows every match)")
        v.info("textures per match, direct vs composer control", {"direct": [r["textures"] for r in rows], "composer": [r["textures"] for r in crows]})
        probs = C.diag_problems(cd)
        v.check("leak control part: 0 errors", not probs, probs or "clean")

    return C.run_gate("orch_lowpost", body, args)


if __name__ == "__main__":
    sys.exit(main())
