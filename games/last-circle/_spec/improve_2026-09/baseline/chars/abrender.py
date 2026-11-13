"""A/B render: shipped character GLB vs the scratch-decimated LOD0/LOD1, same rig, same idle frame,
same lights and the same in-game material fix (player.js:361-367: metalness 0, emissive stripped,
colour x3.2). Renders in a SEPARATE WebGLRenderer on its own canvas inside the live game page (so it
uses the game's own three r172 + GLTFLoader + DRACOLoader), never touching the game's scene.
Outputs one PNG strip per skin + a JSON of pixel diffs. Repo untouched."""
import sys, json, base64, time, os
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
BASE = "http://127.0.0.1:8790/games/last-circle/assets/chars/meshy/"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu", "--disable-gpu-sandbox"]
SKINS = sys.argv[1].split(",") if len(sys.argv) > 1 else ["soldier", "juggernaut"]
T0 = time.time()
def log(*a): print(f"{time.time()-T0:6.1f}s", *a, flush=True)

JS = r"""
async ([skin, b64lod0, b64lod1, base]) => {
  const W = window.__LC__.W, THREE = W.THREE, K = W.kernel;
  const toBuf = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  const parse = (buf) => new Promise((res, rej) => K.loader.parse(buf, base, res, rej));
  const full = await K.loader.loadAsync(base + skin + ".glb");
  const lod0 = await parse(toBuf(b64lod0));
  const lod1 = await parse(toBuf(b64lod1));
  const idle = await K.loader.loadAsync(base + skin + "_idle.glb");
  const clip = idle.animations[0];
  const cv = document.createElement("canvas"); cv.width = 1200; cv.height = 400;
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(1200, 400, false);
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  const prep = (g) => {
    const root = g.scene; let tris = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material.clone(); m.metalness = 0;
      if (m.emissiveMap) { m.emissiveMap = null; m.emissive.setHex(0); }
      m.color.setHSL(0.08, 0.3, 0.74).multiplyScalar(3.2);
      o.material = m; o.frustumCulled = false;
      tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
    });
    const mx = new THREE.AnimationMixer(root); const a = mx.clipAction(clip); a.play(); mx.update(0.6);
    root.updateMatrixWorld(true);
    let sm = null; root.traverse((o) => { if (o.isSkinnedMesh && !sm) sm = o; });
    let bsMs = null, bsR = null;
    if (sm) { const t0 = performance.now(); for (let k = 0; k < 3; k++) { sm.boundingSphere = null; sm.computeBoundingSphere(); } bsMs = +((performance.now() - t0) / 3).toFixed(1); bsR = +sm.boundingSphere.radius.toFixed(3); }
    return { root, tris, bsMs, bsR };
  };
  const A = prep(full), B = prep(lod0), C = prep(lod1);
  const shots = {}; const diffs = {};
  // camera distances: in-game third-person follow (~4.2 m), a mid fight (12 m), far (35 m)
  for (const dist of [4.2, 12, 35]) {
    const px = [];
    for (const M of [A, B, C]) {
      const sc = new THREE.Scene(); sc.background = new THREE.Color(0x9fc7e8);
      sc.add(new THREE.HemisphereLight(0xbfe3ff, 0x223344, 0.9));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(4, 7, 5); sc.add(sun);
      sc.add(M.root);
      const cam = new THREE.PerspectiveCamera(57, 1, 0.1, 200);
      cam.position.set(0.9, 1.5, dist); cam.lookAt(0, 1.0, 0);
      r.setViewport(0, 0, 400, 400); r.setScissor(0, 0, 400, 400); r.setScissorTest(true);
      r.render(sc, cam);
      const gl = r.getContext(); const buf = new Uint8Array(400 * 400 * 4);
      gl.readPixels(0, 0, 400, 400, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      px.push(buf);
      sc.remove(M.root);
      // lay the three side by side for the PNG
      const tmp = document.createElement("canvas"); tmp.width = 400; tmp.height = 400;
      const ctx = tmp.getContext("2d"); const id = ctx.createImageData(400, 400);
      for (let y = 0; y < 400; y++) id.data.set(buf.subarray((399 - y) * 1600, (400 - y) * 1600), y * 1600);
      ctx.putImageData(id, 0, 0);
      (shots[dist] = shots[dist] || []).push(tmp.toDataURL("image/png"));
    }
    // mean abs RGB diff over pixels that are not background in either image
    const d = (p, q) => { let s = 0, n = 0, mx = 0; for (let i = 0; i < p.length; i += 4) {
      const bgP = Math.abs(p[i] - p[0]) + Math.abs(p[i+1] - p[1]) + Math.abs(p[i+2] - p[2]) < 6;
      const bgQ = Math.abs(q[i] - q[0]) + Math.abs(q[i+1] - q[1]) + Math.abs(q[i+2] - q[2]) < 6;
      if (bgP && bgQ) continue; const e = (Math.abs(p[i]-q[i]) + Math.abs(p[i+1]-q[i+1]) + Math.abs(p[i+2]-q[i+2])) / 3;
      s += e; n++; if (e > 32) mx++; } return { meanAbs: +(s / Math.max(1, n)).toFixed(2), charPx: n, pxOver32: mx }; };
    diffs[dist] = { lod0_vs_full: d(px[0], px[1]), lod1_vs_full: d(px[0], px[2]) };
  }
  r.dispose();
  return { tris: [A.tris, B.tris, C.tris], bsMs: [A.bsMs, B.bsMs, C.bsMs], bsR: [A.bsR, B.bsR, C.bsR], shots, diffs };
}
"""

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.set_default_timeout(1800000)
    pg.goto(URL, wait_until="domcontentloaded", timeout=600000)
    pg.wait_for_function("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)", timeout=1200000, polling=2000)
    log("ready")
    out = {}
    for skin in SKINS:
        b0 = base64.b64encode(open(os.path.join(HERE, "dec", skin + "_lod0.glb"), "rb").read()).decode()
        b1 = base64.b64encode(open(os.path.join(HERE, "dec", skin + "_lod1.glb"), "rb").read()).decode()
        r = pg.evaluate(JS, [skin, b0, b1, BASE])
        out[skin] = {"tris": r["tris"], "bsMs": r["bsMs"], "bsR": r["bsR"], "diffs": r["diffs"]}
        log(skin, r["tris"], "boundingSphere ms", r["bsMs"], "radius", r["bsR"], json.dumps(r["diffs"]))
        # stitch PNG rows with PIL: one row per distance, columns = full | lod0 | lod1
        from PIL import Image
        import io
        rows = []
        for k in sorted(r["shots"], key=float):
            ims = [Image.open(io.BytesIO(base64.b64decode(u.split(",", 1)[1]))).convert("RGB") for u in r["shots"][k]]
            row = Image.new("RGB", (400 * len(ims), 400))
            for i, im in enumerate(ims): row.paste(im, (400 * i, 0))
            rows.append(row)
        sheet = Image.new("RGB", (1200, 400 * len(rows)))
        for i, row in enumerate(rows): sheet.paste(row, (0, 400 * i))
        sheet.save(os.path.join(HERE, f"ab_{skin}.png"))
        log("saved", f"ab_{skin}.png")
    json.dump(out, open(os.path.join(HERE, "ab_diffs.json"), "w"), indent=1)
    br.close()
