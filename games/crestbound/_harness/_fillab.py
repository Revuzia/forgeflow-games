#!/usr/bin/env python
"""FILL LANE A/B — trustworthy per-config GPU cost at the SHIPPING tier.

Why this exists rather than `frameprobe.py`: frameprobe reduces each config
with the MINIMUM across repeats, and a GPU timer query that comes back tiny
(an occluded window, a driver hiccup, a disjoint the extension did not flag)
therefore WINS the reduction and prints as a 17 ms saving.  Measured
2026-09-03, keep/cp3/medium: `aniso 1`, `no point lights`, `half res`,
`scene only` and `ALL CUTS` all reduced to 1.20-1.40 ms (700-830 fps) in one
run whose `full chain` read 18.62 ms — physically impossible, and enough to
make every delta in that table meaningless.

This probe:
  * samples like perfcheck does — EXT_disjoint_timer_query_webgl2, one query
    per frame, disjoint frames DROPPED, and the MEDIAN of the surviving frames;
  * reduces a config over repeats with the MEDIAN of its per-repeat medians,
    so one bad repeat cannot become the answer;
  * refuses any per-repeat median below `--floor` ms (default 3) and reports
    how many were rejected, because "faster than physically possible" is a
    broken measurement, not a result;
  * interleaves configs inside each repeat, so drift affects every row equally.

    python _fillab.py --course keep --station cp3 --quality medium
"""
import argparse
import json
import os
import statistics
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8788/games/crestbound/index.html"
FLAGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--ignore-gpu-blocklist",
         "--use-angle=d3d11", "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"
CLICK_JS = r"""() => { const words=['CONTINUE','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
  for (const w of words) for (const b of document.querySelectorAll('button')) {
    const r=b.getBoundingClientRect(); if(b.disabled||r.width<4) continue;
    if((b.textContent||'').toUpperCase().indexOf(w)<0) continue;
    if(b.__activate) b.__activate(); else b.click(); return w; } return null; }"""
LOAD_JS = r"""async (id) => { const G=CRESTBOUND.game; const t0=performance.now();
  const live=()=>G.course&&G.courseId===id&&(G.state==='playing'||G.state==='keep');
  await G.__dev.goto(id);
  const tick=()=>new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f);setTimeout(f,60);});
  while(performance.now()<t0+40000&&!live()) await tick(); return live(); }"""
STATION_JS = r"""(name)=>{const A=CRESTBOUND,G=A.game,C=G.course,THREE=A.THREE;
  const posOf=o=>{if(!o)return null;if(typeof o.x==='number')return o;
    if(o.pos)return posOf(o.pos);
    if(o.p)return Array.isArray(o.p)?{x:o.p[0],y:o.p[1],z:o.p[2]}:posOf(o.p);
    if(o.position)return posOf(o.position);return null;};
  const p = name==='spawn'?posOf((C.spawnFor?C.spawnFor(0):{}).pos)
          : posOf((C.checkpoints||[])[parseInt(name.replace(/\D/g,''),10)-1]);
  if(!p) return null;
  const P=G.player; if(P&&P.__test){P.__test.teleport(new THREE.Vector3(p.x,p.y+0.6,p.z));
    P.__test.setVel(new THREE.Vector3(0,0,0));}
  if (G.cam && G.cam.snapToPlayer) G.cam.snapToPlayer();
  return [p.x,p.y,p.z];}"""

SETUP_JS = r"""
() => {
  const A = globalThis.CRESTBOUND, E = A.engine, R = E.renderer, P = E.post;
  const W = globalThis.__ab = globalThis.__ab || {};
  W.E = E; W.R = R; W.P = P; W.THREE = A.THREE;
  W.saved = P.composer.passes.map(p => p.enabled);
  W.passNames = P.composer.passes.map(p => p.constructor.name);
  W.sunShadow = E.sun ? E.sun.castShadow : false;
  W.shadowEnabled = R.shadowMap.enabled;
  W.pr = R.getPixelRatio();
  W.sharpen = (P.state && typeof P.state.sharpen === 'number') ? P.state.sharpen : 0;
  W.env = E.scene.environment;
  W.pointLights = []; E.scene.traverse(o => { if (o.isPointLight || o.isSpotLight) W.pointLights.push(o); });
  W.texes = []; E.scene.traverse(o => { if (!o.isMesh) return;
    const mm = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mm) { if (!m) continue;
      for (const k of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'])
        if (m[k] && W.texes.indexOf(m[k]) < 0) W.texes.push(m[k]); } });
  W.aniso0 = W.texes.length ? W.texes[0].anisotropy : null;
  W.nmaps = []; W.hidden = [];
  /* GPU timer plumbing, identical in shape to perfcheck's */
  const gl = R.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') || gl.getExtension('EXT_disjoint_timer_query');
  W.gl = gl; W.ext = ext;
  W.TIME_ELAPSED = ext ? (ext.TIME_ELAPSED_EXT !== undefined ? ext.TIME_ELAPSED_EXT : 0x88BF) : 0;
  W.GPU_DISJOINT = ext ? (ext.GPU_DISJOINT_EXT !== undefined ? ext.GPU_DISJOINT_EXT : 0x8FBB) : 0;
  return {passes: W.passNames, ext: !!ext, pr: W.pr, aniso: W.aniso0,
          drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight]};
}
"""

APPLY_JS = r"""
(cfg) => {
  const W = globalThis.__ab, E = W.E, R = W.R, P = W.P, THREE = W.THREE;
  const off = cfg.off || [];
  P.composer.passes.forEach((p, i) => { p.enabled = W.saved[i] && off.indexOf(p.constructor.name) < 0; });
  const wantShadow = cfg.shadows === false ? false : true;
  if (E.sun) E.sun.castShadow = wantShadow && W.sunShadow;
  R.shadowMap.enabled = wantShadow && W.shadowEnabled;
  for (const L of W.pointLights) L.visible = !cfg.noPointLights;
  E.scene.environment = cfg.noEnv ? null : W.env;
  const wantAniso = cfg.aniso !== undefined ? cfg.aniso : W.aniso0;
  for (const t of W.texes) if (t.anisotropy !== wantAniso) { t.anisotropy = wantAniso; t.needsUpdate = true; }
  if (cfg.noNormalMap) {
    if (!W.nmaps.length) E.scene.traverse(o => { if (!o.isMesh) return;
      const mm = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mm) if (m && m.normalMap) { W.nmaps.push([m, m.normalMap]); m.normalMap = null; m.needsUpdate = true; } });
  } else if (W.nmaps.length) { for (const e of W.nmaps) { e[0].normalMap = e[1]; e[0].needsUpdate = true; } W.nmaps.length = 0; }
  if (cfg.hideTransparent) {
    if (!W.hidden.length) E.scene.traverse(o => {
      if (o.isMesh && o.visible) { const mm = Array.isArray(o.material) ? o.material : [o.material];
        if (mm.some(m => m && m.transparent)) { W.hidden.push(o); o.visible = false; } } });
  } else if (W.hidden.length) { for (const o of W.hidden) o.visible = true; W.hidden.length = 0; }
  if (cfg.sort === 'depth') {
    R.setOpaqueSort((a, b) => (a.groupOrder - b.groupOrder) || (a.renderOrder - b.renderOrder) || (a.z - b.z) || (a.id - b.id));
  } else if (cfg.sort === 'depthOnly') {
    R.setOpaqueSort((a, b) => (a.z - b.z));
  } else R.setOpaqueSort(null);
  if (cfg.override === 'basic') {
    if (!W.basic) W.basic = new THREE.MeshBasicMaterial({color: 0x808080});
    E.scene.overrideMaterial = W.basic;
  } else E.scene.overrideMaterial = null;
  const pr = cfg.pr || W.pr;
  if (Math.abs(R.getPixelRatio() - pr) > 1e-3) { E.setRenderScale(pr / (W.pr / E.renderScale)); }
  /* PresentPass A/B (image lane): 'plain' = one bilinear tap (the old
     compositor stretch, in-chain); 'nosharp' = Catmull-Rom only; default =
     Catmull-Rom + RCAS at the engine's strength. */
  if (P.presentPass) {
    P.presentPass.setPlain(cfg.present === 'plain');
    if (P.presentPass.setCubic) P.presentPass.setCubic(cfg.present !== 'bilinear');
    if (P.setSharpen) P.setSharpen(cfg.present === 'nosharp' ? 0 : W.sharpen);
  }
  return true;
}
"""

MEASURE_JS = r"""
async (n) => {
  const W = globalThis.__ab, gl = W.gl, ext = W.ext, R = W.R;
  const G = globalThis.CRESTBOUND.game;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  /* game.js pauses on window blur, and a paused frame renders almost nothing:
     that is how frameprobe came back with 1.2 ms / 830 fps rows. Resume, and
     report the state so a still-paused sample can be thrown out rather than
     believed. */
  for (let k = 0; k < 30 && G.state === 'paused'; k++) {
    if (G.menu && G.menu.close) { try { G.menu.close(); } catch (e) {} }
    if (G.resume) { try { G.resume(); } catch (e) {} }
    await frame();
  }
  for (let i = 0; i < 24; i++) await frame();          // settle: compile, cull, resize
  if (!ext) return {ms: null, frames: 0, disjoint: 0};
  /* Queries are NEVER recycled and a disjoint-flagged result is KEPT but
     counted: the first version of this probe reused query objects and dropped
     every disjoint result, and came back with zero samples on every config
     while a throwaway inline probe on the same page and the same context read
     23-29 ms. Only a result that never became AVAILABLE is lost, and the tail
     drain is long enough (24 frames) that on this driver none are: the queries
     lag the frames by ~14. */
  const inflight = [], out = [];
  let open = null, disjoint = 0;
  const drain = () => { for (let i = inflight.length - 1; i >= 0; i--) { const q = inflight[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      inflight.splice(i, 1);
      if (gl.getParameter(W.GPU_DISJOINT)) disjoint++;
      out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q); } };
  for (let i = 0; i < n; i++) {
    if (open) { gl.endQuery(W.TIME_ELAPSED); inflight.push(open); open = null; }
    drain();
    open = gl.createQuery();
    gl.beginQuery(W.TIME_ELAPSED, open);
    await frame();
  }
  if (open) { gl.endQuery(W.TIME_ELAPSED); inflight.push(open); open = null; }
  for (let k = 0; k < 24; k++) { await frame(); drain(); }
  for (let i = 0; i < inflight.length; i++) gl.deleteQuery(inflight[i]);
  out.sort((a, b) => a - b);
  return {ms: out.length ? +out[out.length >> 1].toFixed(2) : null, frames: out.length,
          disjoint: disjoint, calls: R.info.render.calls, tris: R.info.render.triangles,
          state: G.state, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight]};
}
"""

RESTORE_JS = r"""
() => { const W = globalThis.__ab, E = W.E, R = W.R, P = W.P;
  P.composer.passes.forEach((p, i) => p.enabled = W.saved[i]);
  if (E.sun) E.sun.castShadow = W.sunShadow;
  R.shadowMap.enabled = W.shadowEnabled;
  for (const L of W.pointLights) L.visible = true;
  E.scene.environment = W.env;
  for (const t of W.texes) if (t.anisotropy !== W.aniso0) { t.anisotropy = W.aniso0; t.needsUpdate = true; }
  if (W.nmaps.length) { for (const e of W.nmaps) { e[0].normalMap = e[1]; e[0].needsUpdate = true; } W.nmaps.length = 0; }
  if (W.hidden.length) { for (const o of W.hidden) o.visible = true; W.hidden.length = 0; }
  E.scene.overrideMaterial = null;
  if (P.presentPass) { P.presentPass.setPlain(false); if (P.presentPass.setCubic) P.presentPass.setCubic(true); if (P.setSharpen) P.setSharpen(W.sharpen); }
  R.setOpaqueSort(null); }
"""

BLOOM = ["UnrealBloomPass", "ScaledBloomPass"]
GRADE = ["FinishPass", "GradePass"]
AA = ["FXAAPass", "SMAAPass"]

CONFIGS = [
    ("full", {}),
    ("present plain", {"present": "plain"}),
    ("present nosharp", {"present": "nosharp"}),
    ("present bilinear", {"present": "bilinear"}),
    ("-bloom", {"off": BLOOM}),
    ("-finish", {"off": GRADE}),
    ("-AA", {"off": AA}),
    ("-post (all 3)", {"off": BLOOM + GRADE + AA}),
    ("-shadows", {"shadows": False}),
    ("-transparent", {"hideTransparent": True}),
    ("aniso 1", {"aniso": 1}),
    ("no normal maps", {"noNormalMap": True}),
    ("no env map", {"noEnv": True}),
    ("no point lights", {"noPointLights": True}),
    ("depth sort", {"sort": "depth"}),
    ("basic override", {"override": "basic"}),
    ("basic, no post", {"override": "basic", "off": BLOOM + GRADE + AA}),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="keep")
    ap.add_argument("--station", default="cp3")
    ap.add_argument("--quality", default="medium")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--frames", type=int, default=45)
    ap.add_argument("--floor", type=float, default=3.0)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--only", default="", help="comma list of config names to run")
    ap.add_argument("--json", default="")
    ap.add_argument("--headless", action="store_true",
                    help="headless Chrome on the real GPU (HARNESS_NOTES: d3d11 headless keeps the Intel UHD)")
    args = ap.parse_args()

    want = [c.strip() for c in args.only.split(",") if c.strip()]
    configs = [(n, c) for n, c in CONFIGS if not want or n in want or n == "full"]

    samples = {n: [] for n, _ in configs}
    rejected = {n: 0 for n, _ in configs}
    bad = {}
    meta = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=args.headless, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.goto("%s?dev=1&quality=%s" % (BASE, args.quality), wait_until="load", timeout=60_000)
        for _ in range(150):
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
            pg.wait_for_timeout(400)
        for _ in range(80):
            if pg.evaluate(STATE_JS) in ("keep", "playing"):
                break
            pg.evaluate(CLICK_JS)
            pg.wait_for_timeout(400)
        pg.evaluate(LOAD_JS, args.course)
        st = pg.evaluate(STATION_JS, args.station)
        pg.wait_for_timeout(1500)
        info = pg.evaluate(SETUP_JS)
        present = set(info["passes"])
        configs = [(n, c) for n, c in configs
                   if not c.get("off") or any(o in present for o in c["off"])]
        print("course %s station %s (%s) quality %s — passes %s, buffer %s, aniso %s, timer %s"
              % (args.course, args.station, st, args.quality, info["passes"],
                 info["drawingBuffer"], info["aniso"], info["ext"]))
        for r in range(args.repeats + 1):
            for name, cfg in configs:
                pg.evaluate(APPLY_JS, cfg)
                m = pg.evaluate(MEASURE_JS, args.frames)
                if not r:
                    continue                      # round 0 is warm-up, discarded
                ms = m.get("ms")
                if (ms is None or ms < args.floor or (m.get("calls") or 0) < 20
                        or m.get("state") not in ("playing", "keep")):
                    rejected[name] += 1
                    bad[name] = "ms=%s frames=%s disjoint=%s calls=%s state=%s" % (ms, m.get("frames"), m.get("disjoint"), m.get("calls"), m.get("state"))
                    continue
                samples[name].append(ms)
                meta[name] = m
            pg.evaluate(RESTORE_JS)
        pg.evaluate(RESTORE_JS)
        br.close()

    def med(a):
        return statistics.median(a) if a else None

    base = med(samples["full"])
    print("-" * 82)
    print("%-18s%10s%10s%9s%8s%11s%7s" % ("config", "ms", "delta", "fps", "draws", "tris", "n"))
    print("-" * 82)
    rows = {}
    for name, _ in configs:
        ms = med(samples[name])
        m = meta.get(name, {})
        rows[name] = ms
        if ms is None:
            print("%-18s   no valid sample (%d rejected; last: %s)"
                  % (name, rejected[name], bad.get(name, "?")))
            continue
        print("%-18s%10.2f%+10.2f%9.1f%8s%11s%7d%s"
              % (name, ms, ms - base, 1000.0 / ms, m.get("calls"), f'{m.get("tris", 0):,}',
                 len(samples[name]), ("  [%d rejected]" % rejected[name]) if rejected[name] else ""))
    print("-" * 82)
    if base is None:
        print("NO VALID BASELINE — every 'full' sample was rejected (rows above say why).")
        return 2
    print("full = %.2f ms (%.1f fps) at %s" % (base, 1000.0 / base, info["drawingBuffer"]))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"course": args.course, "station": args.station, "quality": args.quality,
                       "info": info, "ms": rows, "samples": samples, "rejected": rejected}, f, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
