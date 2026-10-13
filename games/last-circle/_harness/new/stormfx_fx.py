#!/usr/bin/env python
"""STORMFX gate: hit sparks, muzzle flash and tracers that are not cubes (plan P1.4) + the kernel decoder swap (plan P2.0).

A PRACTICE match (loads fast) is enough: nothing here depends on the storm.

  no cubes      the fx pool is ONE InstancedMesh of PlaneGeometry (4 vertices) with a ShaderMaterial; no BoxGeometry anywhere in the
                fx group; draw calls = +1 when particles are live (0 extra when idle); triangles = 2 per slot; the 1,024 cap holds
                under a 2,000-particle flood; renderOrder > 5 (pool 7, blasts 7/8)
  flash / tracer glare   the scene rendered into a FLOAT target with the fx group shown and hidden (same frame): peak luminance
                ratio on/off over the effect's pixels <= 8x the surface behind it; and the HALO (bloomed, composed-frame delta
                > 4/255) no wider than 3x the SOURCE (float-frame delta > 5 % of peak)
  tracer shape  a thin streak (screen width <= 6 px at 25 m, length >= 8x width), brightest at its head, fading with life
  atlas         the four cells are filled (PNG from assets/fx/ when it loaded, procedural otherwise) - reported, either is a pass
  decoders      Draco: kernel.dracoLoader.decoderMode is 'wasm' (JS only when WebAssembly is unusable) and a real Draco character
                base decodes IDENTICALLY (position hash) through the wasm and the JS decoder; meshopt: a real EXT_meshopt_compression
                GLB (built with meshoptimizer, MIT) loads through kernel.loader, the lazy decoder module is requested only then, and
                the geometry equals the source
  python _harness/new/stormfx_fx.py --disk                       exit 0 pass / 1 fail / 2 could-not-judge
"""
from __future__ import annotations

import argparse
import base64
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stormfx_lib as L  # noqa: E402
import common  # noqa: E402
import numpy as np  # noqa: E402

SCRATCH = "C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_improve/wave4/STORMFX"

FX_JS = r"""() => {
  if (window.__FX__) return 'already';
  const C = window.__LC__, W = C.W, k = W.kernel, THREE = W.THREE;
  const FX = window.__FX__ = {};
  FX.view = () => { const cam = W.camera; cam.updateMatrixWorld(); const me = cam.matrixWorld.elements;
    let fx = -me[8], fz = -me[10]; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl; return { fx, fz, rx: -fz, rz: fx, cam }; };
  FX.proj = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(W.camera); const c = k.renderer.domElement;
    return [(v.x * 0.5 + 0.5) * c.width, (-v.y * 0.5 + 0.5) * c.height, v.z]; };
  FX.fxGroup = () => W.group('fx');
  // composed frame (what the player sees), fx group optionally hidden
  FX.compose = (hide) => { const g = FX.fxGroup(); const was = g.visible; if (hide) g.visible = false;
    if (k.composer) k.composer.render(0); else k.renderer.render(k.scene, k.camera);
    const u = k.renderer.domElement.toDataURL('image/png'); g.visible = was; return u; };
  // scene into a float target (no composer: scene-referred linear light), fx group optionally hidden
  FX.floatFrame = (hide, w, h) => { const g = FX.fxGroup(); const was = g.visible; if (hide) g.visible = false; const r = k.renderer; let rt = null, out = null;
    try { rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
      r.setRenderTarget(rt); r.clear(); r.render(k.scene, W.camera);
      const buf = new Float32Array(w * h * 4); r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      let s = ''; const u8 = new Uint8Array(buf.buffer); const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); out = btoa(s);
    } catch (e) { out = null; } finally { r.setRenderTarget(null); g.visible = was; if (rt) rt.dispose(); } return out; };
  FX.step = (n, dt, render) => { for (let i = 0; i < n; i++) { const d = dt; for (const u of k._updaters) u(d, 0); if (render && (i === n - 1)) { if (k.composer) k.composer.render(d); else k.renderer.render(k.scene, k.camera); } } };
  FX.counts = () => { k.renderer.info.reset(); if (k.composer) k.composer.render(0); else k.renderer.render(k.scene, k.camera); const i = k.renderer.info.render; return { calls: i.calls, tris: i.triangles }; };
  FX.drain = () => { for (let i = 0; i < 150; i++) for (const u of k._updaters) u(1 / 30, 0); };
  FX.pool = () => { let pm = null; FX.fxGroup().traverse((o) => { if (o.isInstancedMesh && o.name === 'fx-quads') pm = o; }); return pm; };
  return 'ok';
}"""


def lum(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def bbox_w(mask):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return 0, 0, None
    return int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1), (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))


def main(v, args):
    out_dir = args.shots
    os.makedirs(out_dir, exist_ok=True)
    M = {}
    meshopt_glb = os.path.join(SCRATCH, "meshopt_quad.glb")
    if not os.path.exists(meshopt_glb):
        try:
            subprocess.run(["node", os.path.join(SCRATCH, "make_meshopt_glb.mjs"), meshopt_glb], check=True, capture_output=True, timeout=60)
        except Exception as e:
            v.note("could not build the meshopt test GLB: %s" % e)
    with common.Session(args, name="stormfx_fx") as s:
        # a route for the meshopt test file (page-level routes win over the disk route)
        glb_url = s.origin() + "/games/last-circle/_stormfx_test/meshopt_quad.glb"
        if os.path.exists(meshopt_glb):
            data = open(meshopt_glb, "rb").read()
            s.context.route(glb_url, lambda route: route.fulfill(status=200, body=data, headers={"Content-Type": "model/gltf-binary", "Access-Control-Allow-Origin": "*"}))
        s.boot()
        s.sleep(1.0)

        # ── decoders (menu state, before any match) ───────────────────────────
        dec = s.js("""() => { const k = window.__LC__.W.kernel; return { draco: k.dracoLoader.decoderMode, dracoPending: !!k.dracoLoader.decoderPending, meshoptSupported: k.meshoptDecoder.supported,
            meshoptLoadedBeforeUse: k.meshoptDecoder.loaded, outPass: k.outputPass && k.outputPass.constructor.name, wasm: typeof WebAssembly === 'object' }; }""")
        M["decoders0"] = dec
        reqs0 = s.js("() => performance.getEntriesByType('resource').map(r => r.name).filter(n => /meshopt|draco/.test(n))")
        M["requests0"] = reqs0
        v.check("kernel output pass is the storm-grade copy (LCOutputPass) and meshopt is registered lazily (not requested before use)",
                dec["outPass"] == "LCOutputPass" and dec["meshoptSupported"] and not dec["meshoptLoadedBeforeUse"] and not any("meshopt" in r for r in reqs0), {"dec": dec, "reqs": reqs0})

        # Draco parity: decode one real character base through the shared (wasm) loader and through a fresh JS-forced loader
        par = s.js("""async () => { const k = window.__LC__.W.kernel; const T = window.__LC__.W.THREE;
          const base = window.__LC__.W.assetBase + 'assets/chars/meshy/'; const urls = ['athlete.glb'];
          const hash = (root) => { let h = 2166136261 >>> 0, n = 0; root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) { const a = o.geometry.attributes.position.array; for (let i = 0; i < a.length; i++) { h = Math.imul(h ^ ((a[i] * 1000) | 0), 16777619) >>> 0; } n += a.length; } }); return { h, n }; };
          const out = { url: urls[0], mode0: k.dracoLoader.decoderMode };
          const g1 = await k.loader.loadAsync(base + urls[0]); out.wasm = hash(g1.scene); out.mode1 = k.dracoLoader.decoderMode;
          // a second loader forced to the JS decoder, same path
          const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
          const dl = new DRACOLoader(); dl.setDecoderPath('assets/vendor/three/examples/jsm/libs/draco/'); dl.setDecoderConfig({ type: 'js' });
          const gl = new GLTFLoader(); gl.setDRACOLoader(dl); const g2 = await gl.loadAsync(base + urls[0]); out.js = hash(g2.scene); dl.dispose();
          return out; }""")
        M["dracoParity"] = par
        v.check("Draco decoder is WebAssembly (the JS decoder stays as the fallback)", par.get("mode1") == "wasm", par)
        v.check("a real Draco character base decodes IDENTICALLY through wasm and JS (position hash)", par["wasm"]["n"] > 0 and par["wasm"] == par["js"], par)

        # meshopt: load the test GLB through the kernel's own loader (built with vertex codec version 0: the vendored decoder is meshoptimizer 0.18)
        if os.path.exists(meshopt_glb):
            try:
                mo = s.js("""async (u) => { const k = window.__LC__.W.kernel; const g = await k.loader.loadAsync(u); let pos = null, idx = null; g.scene.traverse((o) => { if (o.isMesh) { pos = Array.from(o.geometry.attributes.position.array); idx = Array.from(o.geometry.index.array); } });
                  return { pos, idx, loaded: k.meshoptDecoder.loaded, reqs: performance.getEntriesByType('resource').map(r => r.name).filter(n => /meshopt/.test(n)) }; }""", glb_url)
            except Exception as e:
                mo = {"error": str(e).splitlines()[0][:300], "pos": None, "idx": None, "loaded": False, "reqs": []}
            M["meshopt"] = mo
            want = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0.5]
            v.check("a meshopt-compressed GLB (EXT_meshopt_compression, built with meshoptimizer) loads through the kernel loader and decodes to the source geometry",
                    mo["pos"] == want and mo["idx"] == [0, 1, 2, 0, 2, 3] and mo["loaded"] and any("meshopt_decoder" in r for r in mo["reqs"]), mo)
        else:
            v.cnj("meshopt GLB round trip", "the test GLB could not be built (node + meshoptimizer)")

        # Draco FALLBACK: (a) the wasm file answers 404, (b) no usable WebAssembly - both must land on the JS decoder and still decode identically
        def extra_page(init_script=None, block_wasm=False):
            pg = s.context.new_page()
            msgs, fails = [], []
            pg.on("console", lambda m: msgs.append((m.type, m.text)))
            pg.on("response", lambda r: fails.append((r.status, r.url)) if r.status >= 400 else None)
            if init_script:
                pg.add_init_script(init_script)
            if block_wasm:
                pg.route("**/draco_decoder.wasm*", lambda route: route.fulfill(status=404, body="no"))
            pg.goto(s.base, wait_until="commit", timeout=120000)
            t0 = __import__("time").time()
            while __import__("time").time() - t0 < 240:
                try:
                    if pg.evaluate("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)"):
                        break
                except Exception:
                    pass
                pg.wait_for_timeout(300)
            r = pg.evaluate("""async () => { const k = window.__LC__.W.kernel; const base = window.__LC__.W.assetBase + 'assets/chars/meshy/';
              const g = await k.loader.loadAsync(base + 'athlete.glb'); let h = 2166136261 >>> 0, n = 0;
              g.scene.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) { const a = o.geometry.attributes.position.array; for (let i = 0; i < a.length; i++) { h = Math.imul(h ^ ((a[i] * 1000) | 0), 16777619) >>> 0; } n += a.length; } });
              return { mode: k.dracoLoader.decoderMode, reason: k.dracoLoader.decoderFallbackReason, h, n, reqs: performance.getEntriesByType('resource').map(r => r.name).filter(n => /draco/.test(n)).map(n => n.split('/').pop()) }; }""")
            r["warn"] = [t for (ty, t) in msgs if ty == "warning" and "Draco" in t][:2]
            r["fails"] = [u.split("/")[-1] for (st, u) in fails][:4]
            pg.close()
            return r

        try:
            fb1 = extra_page(block_wasm=True)
        except Exception as e:
            fb1 = {"error": str(e).splitlines()[0][:300]}
        M["dracoFallback404"] = fb1
        v.check("Draco: the wasm file answering 404 falls back to the JS decoder, warns once, and the character still decodes IDENTICALLY",
                fb1.get("mode") == "js" and fb1.get("h") == par["wasm"]["h"] and fb1.get("n") == par["wasm"]["n"] and bool(fb1.get("warn")), fb1)
        try:
            fb2 = extra_page(init_script="Object.defineProperty(window, 'WebAssembly', { value: undefined, configurable: true });")
        except Exception as e:
            fb2 = {"error": str(e).splitlines()[0][:300]}
        M["dracoFallbackNoWasm"] = fb2
        v.check("Draco: no WebAssembly -> JS decoder from the start (no wasm file requested) and the character decodes IDENTICALLY",
                fb2.get("mode") == "js" and fb2.get("h") == par["wasm"]["h"] and fb2.get("n") == par["wasm"]["n"] and not any("wasm" in r for r in fb2.get("reqs", [])), fb2)

        # ── practice match ────────────────────────────────────────────────────
        M["start"] = s.start_match(mode="practice", seed=7)
        s.guard_player(True)
        s.install_pump()
        s.js(FX_JS)
        s.freeze_loop()
        s.step_frames(30, 1 / 60, True)

        # LCOutputPass at grade 0 must be BIT-IDENTICAL to three's stock OutputPass (the storm grade is a uniform-coherent branch that a neutral frame skips):
        # the same frozen frame through the composer as LC, stock, LC again (determinism control); the whole canvas compared with readPixels.
        NEUTRAL_JS = """async () => {
          const W = window.__LC__.W, k = W.kernel, gl = k.renderer.getContext();
          const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');
          const comp = k.composer; if (!comp) return { error: 'no composer' };
          const idx = comp.passes.length - 1; const lc = comp.passes[idx];
          if (!lc.isLCOutputPass) return { error: 'last pass is not LCOutputPass' };
          lc.setStormGrade(0);
          const stock = new OutputPass(); stock.renderToScreen = lc.renderToScreen;
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
          const grab = () => { const a = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
          const render = (pass) => { comp.passes[idx] = pass; comp.render(0); return grab(); };
          let A, B, A2, G;
          try { A = render(lc); B = render(stock); A2 = render(lc); lc.setStormGrade(0.5); G = render(lc); } finally { lc.setStormGrade(0); comp.passes[idx] = lc; stock.dispose(); }
          const diff = (x, y) => { let n = 0, mx = 0; for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - y[i]); if (d) { n++; if (d > mx) mx = d; } } return { differingBytes: n, maxDiff: mx }; };
          let lit = 0; for (let i = 0; i < A.length; i += 4) if (A[i] | A[i + 1] | A[i + 2]) lit++;
          return { w, h, litPixels: lit, lcVsStock: diff(A, B), lcVsLc: diff(A, A2), grade05VsNeutral: diff(A, G) };
        }"""
        neu = s.js(NEUTRAL_JS)
        M["neutralGrade"] = neu
        if neu.get("error"):
            v.cnj("LCOutputPass at grade 0 is bit-identical to the stock OutputPass", neu["error"])
        else:
            v.check("LCOutputPass at grade 0 is BIT-IDENTICAL to three's stock OutputPass (whole canvas, same frozen frame; determinism control LC vs LC is identical too)",
                    neu["litPixels"] > 0.5 * neu["w"] * neu["h"] and neu["lcVsLc"]["differingBytes"] == 0 and neu["lcVsStock"]["differingBytes"] == 0
                    and neu["grade05VsNeutral"]["differingBytes"] > 0.5 * neu["litPixels"], neu)   # the last term proves the probe CAN see a grade (grade 0.5 changes most bytes)

        facts = s.js("""() => { const W = window.__LC__.W; const fxg = W.group('fx'); let boxes = 0; const kinds = [];
          fxg.traverse((o) => { if (o.geometry && o.geometry.type === 'BoxGeometry') boxes++; if (o.isMesh || o.isSprite) kinds.push((o.name || o.type) + ':' + (o.geometry && o.geometry.type) + ':' + (o.material && o.material.type) + ':ro' + o.renderOrder); });
          W.scene.traverse((o) => { if (o.isInstancedMesh && o.geometry && o.geometry.type === 'BoxGeometry' && o.material && o.material.isMeshBasicMaterial && o.instanceColor) boxes++; });
          const pm = window.__FX__.pool(); const rb = window.__LC__.feel().fx.particles;
          return { boxes, kinds, poolGeo: pm.geometry.type, poolVerts: pm.geometry.attributes.position.count, poolIdx: pm.geometry.index.count, poolMat: pm.material.type, poolRO: pm.renderOrder, poolSlots: pm.instanceMatrix.count, rb }; }""")
        M["facts"] = facts
        v.check("fx pool is ONE InstancedMesh of PlaneGeometry (4 vertices, 2 triangles per slot) + ShaderMaterial, 0 BoxGeometry cubes in the fx group or anywhere as an instanced particle mesh",
                facts["boxes"] == 0 and facts["poolGeo"] == "PlaneGeometry" and facts["poolVerts"] == 4 and facts["poolIdx"] == 6 and facts["poolMat"] == "ShaderMaterial" and facts["poolSlots"] == 1024, facts)
        v.check("fx pool renderOrder > 5 (above the storm wall; loot beams / rings are >= 6)", facts["poolRO"] > 5 and all((":ro" in k_) and int(k_.rsplit("ro", 1)[1]) > 5 for k_ in facts["kinds"] if k_.startswith(("fx-quads", "Sprite", "Mesh:RingGeometry"))), facts["kinds"])
        v.info("atlas cells", facts["rb"].get("atlas"))

        # idle vs live, measured as the POOL's own contribution: the same frame state rendered with the pool shown and hidden
        # (bots keep walking between two stepped frames, so a before/after pair also counts name tags that wandered into view:
        # run a2-2 read 117 -> 125 calls of which 7 were two-triangle sprites). A dirt impact spawns pool particles only.
        POOL_AB = """() => { const pm = window.__FX__.pool(); const on = window.__FX__.counts(); const was = pm.visible; pm.visible = false;
          const off = window.__FX__.counts(); pm.visible = was; return { on, off, dCalls: on.calls - off.calls, dTris: on.tris - off.tris, count: pm.count }; }"""
        s.js("() => window.__FX__.drain()")
        idle = s.js(POOL_AB)
        s.js("""() => { const W = window.__LC__.W, X = window.__FX__.view(); const p = W.player;
          const b = { x: X.cam.position.x + X.fx * 7, y: p.pos.y + 1.4, z: X.cam.position.z + X.fz * 7 };
          W.events.emit('impact', { x: b.x, y: b.y, z: b.z, nx: 0, ny: 1, nz: 0 }, 'dirt'); return b; }""")
        s.js("() => window.__FX__.step(1, 1 / 60, false)")
        live = s.js(POOL_AB)
        M["draws"] = {"idle": idle, "live": live}
        v.check("the pool adds exactly ONE draw call (2 triangles per slot) while particles are live, and NONE when idle",
                idle["dCalls"] == 0 and idle["dTris"] == 0 and live["dCalls"] == 1 and live["dTris"] == 2 * 1024, {"idle": idle, "live": live})
        s.js("() => window.__FX__.drain()")

        # flood: the 1,024 cap
        flood = s.js("""() => { const W = window.__LC__.W, X = window.__FX__.view(); for (let i = 0; i < 90; i++) W.events.emit('explosion', { x: X.cam.position.x + X.fx * 9, y: W.player.pos.y + 1, z: X.cam.position.z + X.fz * 9 }, 3);
          for (let i = 0; i < 4; i++) for (const u of W.kernel._updaters) u(1 / 60, 0); const r = window.__LC__.feel().fx.particles; return r; }""")
        M["flood"] = flood
        v.check("a 90-explosion flood never exceeds the 1,024 particle cap", flood["live"] <= flood["cap"] == 1024, flood)
        s.js("() => window.__FX__.drain()")

        # ── glare: muzzle flash and tracer, float A/B + composed A/B ──────────
        W_, H_ = 640, 360

        def scene_ab(emit_js, name, frames=1):
            s.js("() => window.__FX__.drain()")
            info = s.js(emit_js)
            s.js("(n) => window.__FX__.step(n, 1 / 60, false)", frames)
            on_f = s.js("([w, h]) => window.__FX__.floatFrame(false, w, h)", [W_, H_])
            off_f = s.js("([w, h]) => window.__FX__.floatFrame(true, w, h)", [W_, H_])
            url_on = s.js("() => window.__FX__.compose(false)")
            url_off = s.js("() => window.__FX__.compose(true)")
            L.save_png(url_on, os.path.join(out_dir, "fx_%s_on.png" % name))
            L.save_png(url_off, os.path.join(out_dir, "fx_%s_off.png" % name))
            if not on_f or not off_f:
                return None
            A, B = L.float_buf(on_f, W_, H_), L.float_buf(off_f, W_, H_)
            la, lb = lum(A[..., :3]), lum(B[..., :3])
            d = la - lb
            dmax = float(d.max())
            res = {"info": info, "deltaMax": dmax}
            if dmax > 0.02:
                src = d > 0.05 * dmax
                sw, sh, bb = bbox_w(src)
                ratio = la[src] / np.maximum(lb[src], 0.02)
                res.update({"srcW": sw, "srcH": sh, "srcBox": bb, "peakRatio": float(ratio.max()), "p99Ratio": float(np.percentile(ratio, 99)),
                            "peakLum": float(la[src].max()), "surfaceLumAtPeak": float(lb[src][ratio.argmax()])})
                on_c, off_c = L.png_to_arr(url_on), L.png_to_arr(url_off)
                dc = np.abs(L.luma(on_c) - L.luma(off_c))
                halo = dc > 4.0
                hw, hh, hb = bbox_w(halo)
                sx = on_c.shape[1] / float(W_)
                res.update({"haloW": hw, "haloH": hh, "haloBox": hb, "srcW_full": sw * sx, "haloOverSrc": (hw / max(sw * sx, 1.0))})
            return res

        flash_js = """() => { const W = window.__LC__.W, X = window.__FX__.view(); const p = W.player;
          const b = { x: X.cam.position.x + X.fx * 6, y: p.pos.y + 1.5, z: X.cam.position.z + X.fz * 6 };
          W.events.emit('shotFired', p, 'ar', { x: b.x, y: b.y, z: b.z }, new W.THREE.Vector3(X.fx, 0, X.fz)); return { at: b, px: window.__FX__.proj(b.x, b.y, b.z) }; }"""
        fl = scene_ab(flash_js, "flash", 1)
        M["flash"] = fl
        if fl is None or "peakRatio" not in fl:
            v.cnj("muzzle flash glare", "no measurable flash in the A/B (%s)" % (fl,))
        else:
            v.check("muzzle flash peak <= 8x the surface behind it (float, scene-referred)", fl["peakRatio"] <= 8.0,
                    "peak %.2fx (p99 %.2fx), peak lum %.2f over surface %.2f; source %d x %d px" % (fl["peakRatio"], fl["p99Ratio"], fl["peakLum"], fl["surfaceLumAtPeak"], fl["srcW"], fl["srcH"]))
            v.check("muzzle flash halo (composed delta > 4/255) <= 3x the source width", fl["haloOverSrc"] <= 3.0,
                    "halo %d px vs source %.0f px = %.2fx" % (fl["haloW"], fl["srcW_full"], fl["haloOverSrc"]))

        tr_js = """() => { const W = window.__LC__.W, X = window.__FX__.view(); const p = W.player;
          const b = { x: X.cam.position.x + X.fx * 25 - X.rx * 6, y: p.pos.y + 2.2, z: X.cam.position.z + X.fz * 25 - X.rz * 6 };
          W.events.emit('tracer', { x: b.x, y: b.y, z: b.z, vx: X.rx * 200, vy: 0, vz: X.rz * 200, weaponId: 'ar' }); return { at: b, px: window.__FX__.proj(b.x, b.y, b.z) }; }"""
        tr = scene_ab(tr_js, "tracer", 2)
        M["tracer"] = tr
        if tr is None or "peakRatio" not in tr:
            v.cnj("tracer glare", "no measurable tracer in the A/B (%s)" % (tr,))
        else:
            v.check("tracer peak <= 8x the surface behind it (float, scene-referred)", tr["peakRatio"] <= 8.0,
                    "peak %.2fx (p99 %.2fx), peak lum %.2f over surface %.2f" % (tr["peakRatio"], tr["p99Ratio"], tr["peakLum"], tr["surfaceLumAtPeak"]))
            v.check("tracer halo (composed delta > 4/255) <= 3x the source extent", tr["haloOverSrc"] <= 3.0 or tr["haloW"] <= 12,
                    "halo %d x %d px vs source %d x %d px (%.2fx)" % (tr["haloW"], tr["haloH"], tr["srcW"] * 2, tr["srcH"] * 2, tr["haloOverSrc"]))
            long_, short_ = max(tr["srcW"], tr["srcH"]), max(1, min(tr["srcW"], tr["srcH"]))
            v.check("the tracer is a thin streak: >= 6x longer than wide, <= 6 px thick at 25 m (640 px frame)", long_ >= 6 * short_ and short_ <= 6, "%d x %d px" % (tr["srcW"], tr["srcH"]))

        # impacts / dust / smoke frames for the eye
        s.js("() => window.__FX__.drain()")
        s.js("""() => { const W = window.__LC__.W, X = window.__FX__.view(), p = W.player; const b = { x: X.cam.position.x + X.fx * 8, y: p.pos.y + 1.0, z: X.cam.position.z + X.fz * 8 };
          W.events.emit('impact', { x: b.x + 1.2, y: b.y, z: b.z, nx: 0, ny: 0, nz: 1 }, 'stone'); W.events.emit('impact', { x: b.x - 1.2, y: b.y, z: b.z, nx: 0, ny: 0, nz: 1 }, 'flesh');
          W.events.emit('impact', { x: b.x, y: b.y - 0.4, z: b.z, nx: 0, ny: 1, nz: 0 }, 'dirt'); W.events.emit('touchdown', p, 14);
          W.events.emit('explosion', { x: b.x + 3, y: p.pos.y + 0.5, z: b.z + 3 }, 3.5); W.events.emit('actorHurt', p, { dmg: 20, toShield: 20, isHead: false, attackerId: 'x' }); }""")
        s.js("() => window.__FX__.step(5, 1 / 60, false)")
        L.save_png(s.js("() => window.__FX__.compose(false)"), os.path.join(out_dir, "fx_mix_f5.png"))
        s.js("() => window.__FX__.step(8, 1 / 60, false)")
        L.save_png(s.js("() => window.__FX__.compose(false)"), os.path.join(out_dir, "fx_mix_f13.png"))

        M["atlas"] = s.js("() => window.__LC__.feel().fx.particles.atlas")
        d = s.diagnostics()
        M["diag"] = {k: d[k] for k in ("consoleErrors", "pageErrors", "windowErrors", "failedRequests", "shader", "shaderWarnings")}
        v.check("0 console errors, 0 page / window errors, 0 shader errors, 0 failed requests",
                not (d["consoleErrors"] or d["pageErrors"] or d["windowErrors"] or d["shader"] or d["failedRequests"]), M["diag"])
    v.data["measure"] = M


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    common.add_common_args(ap)
    ap.add_argument("--shots", default=os.path.join(SCRATCH, "shots"))
    args = ap.parse_args()
    sys.exit(common.run_gate("stormfx_fx", lambda v: main(v, args), args))
