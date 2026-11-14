#!/usr/bin/env python
"""
Weather probe — stands `src/vfx/weather.js` up inside the LIVE page and measures it.

`main.js` does not construct the weather field yet (Task B may not edit it), so
this probe does what the integration diff will do: dynamically imports the module,
constructs it against the live SNOWFLOW scene / sky / shadows / spray globals, and
splices `weather.update()` into the frame immediately after `spray.update()` — the
exact slot REALM_CONTRACT §2.3 puts it in.

Then, per realm and per preset, it reports:
  * live particle count and draw range
  * draws / triangles delta against the same frame with the sheet hidden
  * whether the field actually MOVES (drift uniforms + a JS mirror of the shader's
    placement math, evaluated at two different frames)
  * NaN sweep over every uniform the system owns
  * every console / GLSL error raised while it ran

    python weatherprobe.py --url http://localhost:8788/games/driftwake/index.html?v=x
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8788/games/driftwake/index.html?v=wxprobe"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
SHADER_MARKERS = ("THREE.WebGLProgram", "THREE.WebGLShader", "ERROR:",
                  "gl.getShaderInfoLog", "Program Info Log", "VALIDATE_STATUS")

# --------------------------------------------------------------------- page JS

INSTALL = r"""
async () => {
    const SF = globalThis.SNOWFLOW;
    const M = await import('/games/driftwake/src/vfx/weather.js');
    const w = new M.WeatherField(SF.scene, SF.sky, SF.shadows, 'cold', {
        globals: SF.spray.globals,
        groundRef: SF.character,
    });
    // Exactly where the integration diff puts it: after spray.update(), before
    // drawFrame(). Wrapping spray.update is the only way to reach that slot
    // without editing main.js.
    const sp = SF.spray;
    const orig = sp.update.bind(sp);
    sp.update = (dt, cam) => { orig(dt, cam); w.update(dt, cam); };
    globalThis.__WX = w;
    globalThis.__WXM = M;
    return { ok: true, realm: w.realmName, count: w.count,
             shadowCompiled: w._shadowCompiled };
}
"""

# Mirrors the vertex shader's placement for one index, in JS, so "the field moved"
# is a measured world position and not an inference from a uniform.
MEASURE = r"""
(idx) => {
    const w = globalThis.__WX;
    const f = (x) => Math.fround(x);
    const hash31 = (p) => {
        let p3 = [f(p * 0.1031), f(p * 0.1030), f(p * 0.0973)].map(v => v - Math.floor(v));
        const d = p3[0]*(p3[1]+33.33) + p3[1]*(p3[2]+33.33) + p3[2]*(p3[0]+33.33);
        p3 = p3.map(v => v + d);
        const a = [p3[0]+p3[1], p3[0]+p3[2], p3[1]+p3[2]];
        const b = [p3[2], p3[1], p3[0]];
        return a.map((v,i) => { const r = v*b[i]; return r - Math.floor(r); });
    };
    const cam = SNOWFLOW.rig.camera.position;
    const box = w._uBox.value, off = w._uBoxOff.value, dr = w._uDriftA.value;
    const inner = (idx + 0.5) < w.count * w._uInner.value.x;
    const s = inner ? w._uInner.value.y : 1.0;
    const B = [box.x*s, box.y*s, box.z*s];
    const C = [cam.x + off.x*s, cam.y + off.y*s, cam.z + off.z*s];
    const h = hash31(idx + 0.5);
    const out = [];
    for (let k = 0; k < 3; k++) {
        const base = (h[k] - 0.5) * B[k];
        const d = [dr.x, dr.y, dr.z][k];
        let rel = base + d;
        const m = ((rel - C[k] + B[k]*0.5) % B[k] + B[k]) % B[k];
        out.push(C[k] + (m - B[k]*0.5));
    }
    return out;
}
"""

STATE = r"""
() => {
    const w = globalThis.__WX, SF = globalThis.SNOWFLOW;
    const v3 = (u) => [u.value.x, u.value.y, u.value.z];
    const v4 = (u) => [u.value.x, u.value.y, u.value.z, u.value.w];
    const nums = []
        .concat(v3(w._uBox), v3(w._uBoxOff), v3(w._uDriftA), v3(w._uDriftB),
                v3(w._uVelA), v3(w._uVelB), v3(w._uCamVel), v3(w._uRadii),
                v3(w._uAlpha), v3(w._uTint), v3(w._uGlowTint),
                v4(w._uShape), v4(w._uFade), v4(w._uLight),
                [w._uRise.value.x, w._uInner.value.x, w._uInner.value.y,
                 w._uKindSplit.value.x, w._uKindSplit.value.y,
                 w._uProjY.value, w._uCount.value, w._uDevilCount.value,
                 w._uShadowAmt.value, w.gust,
                 w.fogBoost.density, w.fogBoost.falloff]);
    for (let i = 0; i < w._uDevilA.value.length; i++) {
        const a = w._uDevilA.value[i], b = w._uDevilB.value[i];
        nums.push(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w);
    }
    return {
        realm: w.realmName,
        preset: SF.S.preset,
        count: w.count,
        drawRange: w.geometry.drawRange.count,
        triangles: w.triangles,
        visible: w.mesh.visible,
        renderOrder: w.mesh.renderOrder,
        gust: w.gust,
        fogBoost: [w.fogBoost.density, w.fogBoost.falloff],
        uFog: [SF.sky.uniforms.uFog.value.x, SF.sky.uniforms.uFog.value.y],
        stretchClamp: w._uShape.value.x,
        glowFrac: w._uKindSplit.value.y,
        devils: w._uDevilCount.value,
        shadowAmt: w._uShadowAmt.value,
        driftA: v3(w._uDriftA),
        velA: v3(w._uVelA), velB: v3(w._uVelB),
        nanCount: nums.filter(x => !Number.isFinite(x)).length,
        nanWhere: nums.map((x,i)=>[x,i]).filter(p=>!Number.isFinite(p[0])).map(p=>p[1]),
        drawCalls: SF.perfStats.drawCalls,
        tris: SF.perfStats.triangles,
    };
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--wait", type=float, default=120.0)
    ap.add_argument("--outdir", default=os.path.join(HERE, "..", "_shots"))
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    os.makedirs(os.path.abspath(args.outdir), exist_ok=True)
    msgs, perrs = [], []
    report = {"realms": {}, "presets": {}, "errors": []}

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("console", lambda m: msgs.append((m.type, m.text)))
        pg.on("pageerror", lambda e: perrs.append(f"pageerror: {e}"))
        pg.goto(args.url, wait_until="load", timeout=60_000)

        deadline = time.time() + args.wait
        ready = False
        while time.time() < deadline:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig)"):
                ready = True
                break
            pg.wait_for_timeout(500)
        if not ready:
            print("BOOT FAILED", file=sys.stderr)
            br.close()
            return 2
        pg.wait_for_timeout(2000)

        base = pg.evaluate(
            "() => ({d: SNOWFLOW.perfStats.drawCalls, t: SNOWFLOW.perfStats.triangles})")
        report["baseline"] = base

        try:
            report["install"] = pg.evaluate(INSTALL)
        except Exception as e:
            report["install"] = {"ok": False, "error": str(e)}
            print(json.dumps(report, indent=1))
            br.close()
            return 3
        pg.wait_for_timeout(1200)

        # ---- per realm --------------------------------------------------------
        for realm in ("cold", "sand", "ash"):
            pg.evaluate("(r) => { __WX.setRealm(r); }", realm)
            pg.wait_for_timeout(900)
            a = pg.evaluate(MEASURE, 7)
            b = pg.evaluate(MEASURE, 1900)
            st1 = pg.evaluate(STATE)
            pg.wait_for_timeout(600)
            a2 = pg.evaluate(MEASURE, 7)
            b2 = pg.evaluate(MEASURE, 1900)
            st2 = pg.evaluate(STATE)
            shot = os.path.join(args.outdir, f"wx_{realm}.png")
            pg.screenshot(path=shot)
            # hidden-vs-shown draw delta
            pg.evaluate("() => { __WX.mesh.visible = false; }")
            pg.wait_for_timeout(500)
            off = pg.evaluate(
                "() => ({d: SNOWFLOW.perfStats.drawCalls, t: SNOWFLOW.perfStats.triangles})")
            pg.evaluate("() => { __WX.mesh.visible = true; }")
            pg.wait_for_timeout(500)
            on = pg.evaluate(
                "() => ({d: SNOWFLOW.perfStats.drawCalls, t: SNOWFLOW.perfStats.triangles})")
            report["realms"][realm] = {
                "state": st2,
                "pos_i7_t0": a, "pos_i7_t1": a2,
                "pos_i1900_t0": b, "pos_i1900_t1": b2,
                "moved_i7": max(abs(a[i] - a2[i]) for i in range(3)),
                "moved_i1900": max(abs(b[i] - b2[i]) for i in range(3)),
                "drift_t0": st1["driftA"], "drift_t1": st2["driftA"],
                "draws_off": off, "draws_on": on,
                "draw_delta": on["d"] - off["d"], "tri_delta": on["t"] - off["t"],
                "shot": shot,
            }

        # ---- per preset (cold) ------------------------------------------------
        pg.evaluate("() => { __WX.setRealm('cold'); }")
        for preset in ("ultra", "high", "balanced", "performance"):
            pg.evaluate("(p) => { SNOWFLOW.applyPreset(p); }", preset)
            pg.wait_for_timeout(900)
            st = pg.evaluate(STATE)
            pg.evaluate("() => { __WX.mesh.visible = false; }")
            pg.wait_for_timeout(450)
            off = pg.evaluate(
                "() => ({d: SNOWFLOW.perfStats.drawCalls, t: SNOWFLOW.perfStats.triangles})")
            pg.evaluate("() => { __WX.mesh.visible = true; }")
            pg.wait_for_timeout(450)
            on = pg.evaluate(
                "() => ({d: SNOWFLOW.perfStats.drawCalls, t: SNOWFLOW.perfStats.triangles})")
            report["presets"][preset] = {
                "state": st, "draw_delta": on["d"] - off["d"],
                "tri_delta": on["t"] - off["t"], "draws_on": on,
            }
        pg.evaluate("() => { SNOWFLOW.applyPreset('ultra'); }")
        pg.wait_for_timeout(900)

        # ---- stretch at speed: feed the real camera-velocity input -------------
        pg.evaluate("""() => {
            __WX._camVel.set(0, 0, -19.5);
            __WX._uCamVel.value.set(0, 0, -19.5);
            // hold it against the smoother for a few frames
            __WX.__hold = setInterval(() => {
                __WX._camVel.set(0, 0, -19.5);
                __WX._uCamVel.value.set(0, 0, -19.5);
            }, 8);
        }""")
        pg.wait_for_timeout(900)
        stretch_shot = os.path.join(args.outdir, "wx_cold_speed.png")
        pg.screenshot(path=stretch_shot)
        pg.evaluate("() => { clearInterval(__WX.__hold); }")
        report["stretch_shot"] = stretch_shot

        # ---- weather-only frame, to prove it renders and moves ----------------
        pg.evaluate("""() => {
            const S = SNOWFLOW.S;
            SNOWFLOW.set('showTerrain', false);
            SNOWFLOW.set('showCharacter', false);
            SNOWFLOW.set('showWake', false);
            SNOWFLOW.set('showSpells', false);
            SNOWFLOW.set('taa', false);
            SNOWFLOW.set('grain', false);
        }""")
        pg.wait_for_timeout(900)
        iso_a = os.path.join(args.outdir, "wx_isolated_a.png")
        iso_b = os.path.join(args.outdir, "wx_isolated_b.png")
        pg.screenshot(path=iso_a)
        pg.wait_for_timeout(350)
        pg.screenshot(path=iso_b)
        pg.evaluate("() => { __WX.mesh.visible = false; }")
        pg.wait_for_timeout(500)
        iso_off = os.path.join(args.outdir, "wx_isolated_off.png")
        pg.screenshot(path=iso_off)
        pg.evaluate("() => { __WX.mesh.visible = true; }")
        report["iso"] = [iso_a, iso_b, iso_off]

        br.close()

    shader_errs = [t for ty, t in msgs
                   if ty == "error" and any(m in t for m in SHADER_MARKERS)]
    other_errs = [t for ty, t in msgs
                  if ty == "error" and not any(m in t for m in SHADER_MARKERS)]
    report["errors"] = {"shader": shader_errs[:10], "console": other_errs[:10],
                        "page": perrs[:10]}
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
