"""
LIGHT LANE r2 discriminating probe: which rig term lights a region?

Boots one course at the auto tier (quality=low&autoscale=0, hardware headless
Chrome), poses at a station, then for each VARIANT mutates the live light rig
(or the hero's fill uniforms), renders a few frames, screenshots, and prints
the mean RGB of the named screen region. The base frame is restored between
variants, so every row is a one-term delta against the same baseline.

    python _harness/_light_r2probe.py --course verdant-3 --station spawn --region 300,150,700,350
"""
import argparse
import os
import sys
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shots as S  # noqa: E402

VARIANTS = {
    "base":   "",
    "base2":  "",
    "key0":   "E.sun.intensity = 0;",
    "fill0":  "E.fill.intensity = 0;",
    "rim0":   "E.rim.intensity = 0;",
    "hemi0":  "E.hemi.intensity = 0;",
    "amb0":   "E.ambient.intensity = 0;",
    "env0":   "E.scene.environmentIntensity = 0;",
    "hemi2":  "E.hemi.intensity *= 2;",
    "hemi20": "E.hemi.intensity = 20;",
    "amb20":  "E.ambient.intensity = 20;",
    "fill20": "E.fill.intensity = 20;",
    "info":   "console.log('CBPROBE', JSON.stringify({hemiParent: E.hemi.parent && E.hemi.parent.name, inScene: (()=>{let f=false; E.scene.traverse(o=>{if(o===E.hemi)f=true;}); return f;})(), hemiVis: E.hemi.visible, groupVis: E.hemi.parent && E.hemi.parent.visible, hemiCol: E.hemi.color.getHexString(), gnd: E.hemi.groundColor.getHexString()}));",
    "amb2":   "E.ambient.intensity *= 2;",
    "hfill0": "H._rimU.uCbHeroFill.value.w = 0;",
    "hfill3": "H._rimU.uCbHeroFill.value.w *= 3;",
    "hsky0":  "H._rimU.uCbHeroSky.value.w = 0; H._rimU.uCbHeroRim.value.w = 0;",
    "shadow0": "E.sun.castShadow = false;",
    "hkey0":  "H._rimU.uCbHeroKey.value.w = 0;",
    "noslope": "E.scene.traverse(o => { if (!o.isMesh || o.name.indexOf('terrain') !== 0) return; const u = E.renderer.properties.get(o.material).uniforms; if (u && u.uCbSlope) { if (!globalThis.__cbSlopeSaved) globalThis.__cbSlopeSaved = [u.uCbSlope.value.x, u.uCbSlope.value.y]; u.uCbSlope.value.set(10, 11); } });",
    "blend3": "E.scene.traverse(o => { if (!o.isMesh || o.name.indexOf('terrain') !== 0) return; const u = E.renderer.properties.get(o.material).uniforms; if (u && u.uCbBlendTint) { if (!globalThis.__cbTintSaved) globalThis.__cbTintSaved = [u.uCbBlendTint.value.x, u.uCbBlendTint.value.y, u.uCbBlendTint.value.z]; u.uCbBlendTint.value.multiplyScalar(3); } });",
    "hkey2":  "H._rimU.uCbHeroKey.value.w *= 2;",
    "fog0":   "E.scene.fog.density = 0;",
    "aer0":   "E.scene.traverse(o => { if (!o.isMesh) return; const u = E.renderer.properties.get(Array.isArray(o.material) ? o.material[0] : o.material).uniforms; if (u && u.uCbFogAer && !globalThis.__cbAerSaved) { globalThis.__cbAerSaved = [u.uCbFogAer.value[3], u.uCbFogSky.value[3], u.uCbFogH.value[3]]; u.uCbFogAer.value[3] = 0; u.uCbFogSky.value[3] = 0; u.uCbFogH.value[3] = 0; } });",
    "nofog":  "E.scene.fog.density = 0; E.scene.traverse(o => { if (!o.isMesh) return; const u = E.renderer.properties.get(Array.isArray(o.material) ? o.material[0] : o.material).uniforms; if (u && u.uCbFogAer && !globalThis.__cbAerSaved) { globalThis.__cbAerSaved = [u.uCbFogAer.value[3], u.uCbFogSky.value[3], u.uCbFogH.value[3]]; u.uCbFogAer.value[3] = 0; u.uCbFogSky.value[3] = 0; u.uCbFogH.value[3] = 0; } });",
}

SNAP_JS = r"""
() => {
  const E = CRESTBOUND.engine, G = CRESTBOUND.game, H = G.hero || (G.player && G.player.hero);
  return {
    sun: E.sun.intensity, fill: E.fill.intensity, rim: E.rim.intensity, hemi: E.hemi.intensity,
    amb: E.ambient.intensity, env: E.scene.environmentIntensity, cast: E.sun.castShadow, fogd: E.scene.fog ? E.scene.fog.density : 0,
    hkey: H && H._rimU ? H._rimU.uCbHeroKey.value.w : null,
    hfill: H && H._rimU ? H._rimU.uCbHeroFill.value.w : null,
    hsky: H && H._rimU ? H._rimU.uCbHeroSky.value.w : null,
    hrim: H && H._rimU ? H._rimU.uCbHeroRim.value.w : null,
  };
}
"""

RESTORE_JS = r"""
(s) => {
  const E = CRESTBOUND.engine, G = CRESTBOUND.game, H = G.hero || (G.player && G.player.hero);
  E.sun.intensity = s.sun; E.fill.intensity = s.fill; E.rim.intensity = s.rim;
  E.hemi.intensity = s.hemi; E.ambient.intensity = s.amb; E.scene.environmentIntensity = s.env;
  E.sun.castShadow = s.cast;
  E.scene.fog.density = s.fogd;
  if (globalThis.__cbAerSaved) { const sv = globalThis.__cbAerSaved; E.scene.traverse(o => { if (!o.isMesh) return; const u = E.renderer.properties.get(Array.isArray(o.material) ? o.material[0] : o.material).uniforms; if (u && u.uCbFogAer) { u.uCbFogAer.value[3] = sv[0]; u.uCbFogSky.value[3] = sv[1]; u.uCbFogH.value[3] = sv[2]; } }); delete globalThis.__cbAerSaved; }
  if (H && H._rimU) { H._rimU.uCbHeroKey.value.w = s.hkey; }
  E.scene.traverse(o => { if (!o.isMesh || o.name.indexOf('terrain') !== 0) return; const u = E.renderer.properties.get(o.material).uniforms; if (!u) return;
    if (globalThis.__cbSlopeSaved && u.uCbSlope) u.uCbSlope.value.set(globalThis.__cbSlopeSaved[0], globalThis.__cbSlopeSaved[1]);
    if (globalThis.__cbTintSaved && u.uCbBlendTint) u.uCbBlendTint.value.set(globalThis.__cbTintSaved[0], globalThis.__cbTintSaved[1], globalThis.__cbTintSaved[2]); });
  delete globalThis.__cbSlopeSaved; delete globalThis.__cbTintSaved;
  if (H && H._rimU) { H._rimU.uCbHeroFill.value.w = s.hfill; H._rimU.uCbHeroSky.value.w = s.hsky; H._rimU.uCbHeroRim.value.w = s.hrim; }
  return true;
}
"""

FRAMES_JS = r"""
async (n) => { const f = () => new Promise(r => requestAnimationFrame(r)); for (let i = 0; i < n; i++) await f(); return true; }
"""


def region_mean(path, box):
    from PIL import Image
    im = Image.open(path).convert("RGB").crop(box)
    px = list(im.getdata())
    n = max(1, len(px))
    return tuple(round(sum(p[i] for p in px) / n) for i in range(3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-3")
    ap.add_argument("--station", default="spawn")
    ap.add_argument("--region", default="300,150,700,350", help="x0,y0,x1,y1 (semicolon-separate several)")
    ap.add_argument("--variants", default="base,key0,fill0,hemi0,amb0,env0,shadow0,hemi2")
    ap.add_argument("--dist", type=float, default=8.0)
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--outdir", default=os.path.join(S.SHOTS, "_lightprobe"))
    args = ap.parse_args()
    boxes = [tuple(int(v) for v in r.split(",")) for r in args.region.split(";") if r.strip()]
    variants = [v.strip() for v in args.variants.split(",") if v.strip()]
    os.makedirs(args.outdir, exist_ok=True)

    with sync_playwright() as p:
        try:
            br = p.chromium.launch(channel="chrome", headless=True, args=S.FLAGS)
        except Exception as e:
            print("no hardware chrome:", str(e)[:100]); br = p.chromium.launch(headless=True, args=S.HEADLESS_FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("console", lambda m: print("console:", m.text) if "CBPROBE" in m.text else None)
        pg.goto("%s?dev=1&quality=low&autoscale=0" % S.BASE, wait_until="load", timeout=60000)
        deadline = time.time() + 70
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        if not S.leave_title(pg):
            print("never live"); return 2
        ok, why = S.goto_course(pg, args.course)
        if not ok:
            print("goto failed", why); return 2
        pg.wait_for_timeout(1000)
        meta = pg.evaluate(S.STATIONS_JS)
        st = next((s for s in meta["stations"] if s["name"] == args.station), None)
        if not st:
            print("no station", args.station, [s["name"] for s in meta["stations"]]); return 2
        if st.get("kind") == "vista":
            pg.evaluate(S.VISTA_JS, {"st": st})
        else:
            pg.evaluate(S.POSE_JS, {"st": st, "dist": args.dist})
        # something settles over several seconds after a pose (measured: azure-1
        # crest-open base [82,86,68] -> [27,52,63] over the run): wait until two
        # frames 120 apart agree within 3/255 before trusting a variant.
        prev = None
        for _try in range(8):
            pg.evaluate(FRAMES_JS, 120)
            out0 = os.path.join(args.outdir, "%s_%s_settle.png" % (args.course, args.station))
            pg.screenshot(path=out0)
            cur = [region_mean(out0, b) for b in boxes]
            print("settle", _try, cur)
            if prev is not None and all(abs(a - b) <= 3 for m0, m1 in zip(prev, cur) for a, b in zip(m0, m1)):
                break
            prev = cur
        snap = pg.evaluate(SNAP_JS)
        print("rig:", snap)
        variants = variants + ["base2"]
        for v in variants:
            js = VARIANTS.get(v)
            if js is None:
                print("unknown variant", v); continue
            if js:
                pg.evaluate("() => { const E = CRESTBOUND.engine, G = CRESTBOUND.game, H = G.hero || (G.player && G.player.hero); " + js + " }")
            pg.evaluate(FRAMES_JS, 6)
            out = os.path.join(args.outdir, "%s_%s_%s.png" % (args.course, args.station, v))
            pg.screenshot(path=out)
            means = [region_mean(out, b) for b in boxes]
            print("%-8s %s" % (v, "  ".join("%s->%s" % (b, m) for b, m in zip(boxes, means))))
            pg.evaluate(RESTORE_JS, snap)
            pg.evaluate(FRAMES_JS, 2)
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
