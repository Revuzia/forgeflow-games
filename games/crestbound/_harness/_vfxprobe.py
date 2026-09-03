#!/usr/bin/env python
"""One-shot probe: composer/RT colour space, sky program defines, sun-in-frame test."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
BASE = "http://localhost:8788/games/crestbound/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]
course = sys.argv[1] if len(sys.argv) > 1 else "verdant-1"
tag = sys.argv[2] if len(sys.argv) > 2 else "pre"
with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = b.new_page(viewport={"width": 1600, "height": 900})
    pg.goto(BASE + "?dev=1", wait_until="domcontentloaded")
    pg.wait_for_function("globalThis.CRESTBOUND && CRESTBOUND.game", timeout=60000)
    import time as _t
    CLICK = """() => {
      const bs = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
      for (const w of ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','BEGIN','ENTER'])
        for (const b of bs) { const r=b.getBoundingClientRect();
          if (b.disabled||r.width<4||r.height<4) continue;
          if (!(b.textContent||'').toUpperCase().includes(w)) continue;
          if (typeof b.__activate==='function') b.__activate(); else b.click(); return w; }
      return null; }"""
    dl = _t.time() + 45
    while _t.time() < dl:
        st = pg.evaluate("globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state")
        if st in ("keep", "playing"): break
        if st == "paused": pg.keyboard.press("Escape")
        pg.evaluate(CLICK)
        pg.wait_for_timeout(400)
    print("title left, state", pg.evaluate("CRESTBOUND.game.state"), "dev", pg.evaluate("!!CRESTBOUND.game.__dev"))
    import time as _t
    pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", course)
    dl = _t.time() + 120
    ok = False
    while _t.time() < dl:
        if pg.evaluate("(id)=>!!(CRESTBOUND.game.course && CRESTBOUND.game.courseId===id && (CRESTBOUND.game.state==='playing'||CRESTBOUND.game.state==='keep'))", course):
            ok = True; break
        pg.evaluate("""() => { const bs=Array.from(document.querySelectorAll('button'));
          for (const w of ['ENTER','PLAY','CONTINUE','START']) for (const b of bs)
            if ((b.textContent||'').toUpperCase().includes(w)) { b.click(); return; } }""")
        pg.wait_for_timeout(400)
    print('loaded', ok)
    pg.wait_for_timeout(2500)
    info = pg.evaluate("""() => {
      const A = globalThis.CRESTBOUND, E = A.engine, R = E.renderer, THREE = A.THREE;
      const out = {outputColorSpace: R.outputColorSpace, toneMapping: R.toneMapping,
                   exposure: R.toneMappingExposure, hasComposer: !!E.composer};
      if (E.composer) {
        const rt = E.composer.renderTarget1;
        out.rtColorSpace = rt && rt.texture ? rt.texture.colorSpace : null;
        out.rtType = rt && rt.texture ? rt.texture.type : null;
        out.passes = E.composer.passes.map(p => p.constructor.name);
      }
      // find the sky dome and read its compiled program defines
      let sky = null;
      E.scene.traverse(o => { if (o.name === 'cb.sky.dome') sky = o; });
      if (sky) {
        out.skyToneMapped = sky.material.toneMapped;
        const prog = sky.material.program;
        out.skyProgHasToneMapping = prog ? /define TONE_MAPPING/.test(prog.vertexShader || '') : null;
        // the real check: the compiled fragment source
        try {
          const gl = R.getContext();
          out.skyDefines = prog ? String(prog.cacheKey).slice(0, 0) : null;
        } catch(e) {}
      }
      out.themeId = A.game.themeId;
      const th = A.game.course && A.game.course.theme;
      out.sunDir = th && th.sky && th.sky.params ? th.sky.params.sunDir : null;
      return out;
    }""")
    print(json.dumps(info, indent=1))
    # point the camera AT the sun (freeze the follow cam like shots.py VISTA_JS)
    pg.evaluate("""() => {
      const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE;
      const p = G.course.theme.sky.params;
      const d = new THREE.Vector3(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize();
      const C3 = A.engine.camera;
      G.cam.update = function () {};
      const apply = () => {
        C3.position.set(G.player.pos.x, G.player.pos.y + 3, G.player.pos.z);
        C3.up.set(0,1,0);
        C3.lookAt(C3.position.x + d.x*200, C3.position.y + d.y*200, C3.position.z + d.z*200);
        C3.updateMatrixWorld(true);
      };
      apply();
      A.engine.onFrame(apply);
    }""")
    pg.wait_for_timeout(1500)
    out = os.path.join(ROOT, "_shots", "_probe_sun_%s_%s.png" % (course, tag))
    pg.screenshot(path=out)
    print("shot", out)
    b.close()
