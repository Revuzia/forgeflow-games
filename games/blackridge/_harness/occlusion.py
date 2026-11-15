#!/usr/bin/env python
"""
LANE B — ADS VIEWMODEL OCCLUSION METER.

Measures, in the LIVE game at real gameplay FOV, what fraction of the screen
the first-person weapon (plus its optic) covers, at hip and at full ADS, for
every weapon. ADS is entered through the REAL input path (a button-2
MouseEvent on #view, exactly what the owner's right click produces), not by
poking sim state.

The mask is exact, not a diff: the scene is re-rendered ONCE to the default
framebuffer through the viewmodel camera with `scene.overrideMaterial` forced
to flat white on a black clear, and the pixels are read back. Only VM_LAYER
objects are in that camera's layer mask, so every lit pixel IS the viewmodel.
No thresholding guesswork, no bloom/exposure contamination.

Reported per weapon / per pose:
  area%      viewmodel pixels / screen pixels
  bboxH%     silhouette bounding-box height / screen height
  centreH%   how far up the screen the silhouette reaches in the centre column
  disc%      coverage of the sight-picture disc (radius 12% of screen height,
             centred on the crosshair) — the region a player reads targets in
  band%      coverage of the horizontal threat band (centre +/- 12% of height,
             full width) — peripheral vision at the reticle's elevation

    python occlusion.py
    python occlusion.py --out ..\_shots\occl --json occl.json
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server

DEFAULT_URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

WEAPONS = ["warden", "vesper", "corvus", "pike"]

# ---- in-page mask reader -------------------------------------------------
MEASURE_JS = r"""
async () => {
  if (!window.__VMMASK__) {
    const THREE = await import('three');
    const F = window.__FPS__;
    window.__VMMASK__ = () => {
      const r = F.renderer, sc = F.scene, vc = F.vm.camera;
      const gl = r.getContext();
      const sz = new THREE.Vector2(); r.getSize(sz);
      const dpr = r.getPixelRatio();
      const w = Math.max(1, Math.floor(sz.x * dpr)), h = Math.max(1, Math.floor(sz.y * dpr));
      const pBg = sc.background, pOv = sc.overrideMaterial, pRT = r.getRenderTarget();
      const pClear = new THREE.Color(); r.getClearColor(pClear);
      const pAlpha = r.getClearAlpha();
      sc.background = null;
      sc.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, true);
      r.render(sc, vc);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      sc.background = pBg; sc.overrideMaterial = pOv; r.setRenderTarget(pRT);
      r.setClearColor(pClear, pAlpha);

      // readPixels origin is BOTTOM-left; convert to a top-left row index.
      let n = 0, minX = 1e9, maxX = -1, minYt = 1e9, maxYt = -1;
      let disc = 0, discOf = 0, band = 0, bandOf = 0;
      let centreTop = h;                      // top-most lit row (top-left idx)
      // alignment guards: the sight sits on the centre ray by construction, so
      // (a) the exact centre pixel must be CLEAR (you look through the sight)
      // and (b) the lit pixels in the centre row band must be balanced about
      // x = w/2. Both are recorded so a FOV/scale change can be shown not to
      // have moved the sight off the ray.
      let rowSum = 0, rowN = 0, centreLit = 0;
      const cx = w / 2, cy = h / 2;
      const R = 0.12 * h, R2 = R * R;
      const bandHalf = 0.12 * h;
      const colHalf = Math.max(1, 0.01 * w);  // "centre column" = +/-1% of width
      for (let y = 0; y < h; y++) {
        const yt = h - 1 - y;                 // top-left row index
        const dy = yt - cy;
        const inBand = Math.abs(dy) <= bandHalf;
        for (let x = 0; x < w; x++) {
          const lit = buf[(y * w + x) * 4] > 24;
          const dx = x - cx;
          const inDisc = (dx * dx + dy * dy) <= R2;
          if (inDisc) { discOf++; if (lit) disc++; }
          if (inBand) { bandOf++; if (lit) band++; }
          if (Math.abs(dy) <= 0.02 * h && lit) { rowSum += x; rowN++; }
          if (Math.abs(dx) <= 1.5 && Math.abs(dy) <= 1.5 && lit) centreLit++;
          if (!lit) continue;
          n++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (yt < minYt) minYt = yt;
          if (yt > maxYt) maxYt = yt;
          if (Math.abs(dx) <= colHalf && yt < centreTop) centreTop = yt;
        }
      }
      // SIGHT ALIGNMENT + SIGHT SIZE, measured off the same mask.
      // The topmost 12 lit rows of the silhouette ARE the sight assembly (the
      // rear ring / front post tower is the highest thing on the weapon at
      // ADS). Its horizontal centroid must sit on x = w/2 — that is the
      // "sight on the centre ray" contract — and its width is the sight's
      // on-screen size, which is what any occlusion fix must not destroy.
      let topSum = 0, topN = 0, topMinX = 1e9, topMaxX = -1;
      if (maxYt >= 0) {
        for (let y = 0; y < h; y++) {
          const yt = h - 1 - y;
          if (yt < minYt || yt > minYt + 11) continue;
          for (let x = 0; x < w; x++) {
            if (buf[(y * w + x) * 4] > 24) {
              topSum += x; topN++;
              if (x < topMinX) topMinX = x;
              if (x > topMaxX) topMaxX = x;
            }
          }
        }
      }
      const of = w * h;
      return {
        sightDx: topN ? +((topSum / topN) - cx).toFixed(2) : null,
        sightWpx: topMaxX < 0 ? null : (topMaxX - topMinX + 1),
        sightTopPct: maxYt < 0 ? null : +(100 * (h - minYt) / h).toFixed(2),
        w, h, px: n,
        areaPct: +(100 * n / of).toFixed(2),
        bboxHPct: maxYt < 0 ? 0 : +(100 * (maxYt - minYt + 1) / h).toFixed(2),
        bboxWPct: maxX < 0 ? 0 : +(100 * (maxX - minX + 1) / w).toFixed(2),
        centreHPct: centreTop >= h ? 0 : +(100 * (h - centreTop) / h).toFixed(2),
        discPct: +(100 * disc / Math.max(1, discOf)).toFixed(2),
        bandPct: +(100 * band / Math.max(1, bandOf)).toFixed(2),
        // alignment: px offset of the centre-band silhouette centroid from the
        // screen centre (0 = the sight is symmetric about the centre ray), and
        // whether the crosshair pixel itself is blocked by geometry.
        centroidDx: rowN ? +((rowSum / rowN) - cx).toFixed(2) : null,
        centreBlocked: centreLit > 0,
        vmFov: +vc.fov.toFixed(3), worldFov: +F.camera.fov.toFixed(3),
      };
    };
  }
  return window.__VMMASK__();
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--out", default=os.path.join(HERE, "..", "_shots", "occl"))
    ap.add_argument("--json", default=os.path.join(HERE, "..", "_shots", "occl.json"))
    ap.add_argument("--shots", action="store_true", help="also save ADS screenshots")
    ap.add_argument("--share", type=float, default=None,
                    help="force VIEWMODEL ads zoom share (1 = pre-iter10 behaviour)")
    ap.add_argument("--standoff", type=float, default=None,
                    help="force ADS standoff in metres (0 = pre-iter10 behaviour)")
    ap.add_argument("--tag", default="")
    args = ap.parse_args()

    ensure_server()
    out = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(args.url, wait_until="load", timeout=60_000)
        pg.wait_for_function(
            "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim && __FPS__.vm)",
            timeout=120_000)
        pg.evaluate("__FPS__.__test.startMission()")
        pg.wait_for_timeout(1500)
        pg.evaluate("__FPS__.__test.god(true); __FPS__.__test.noTarget(true)")
        pg.evaluate("__FPS__.__test.hud(false)")
        pg.wait_for_timeout(300)

        # A/B on ONE build: `1` = the pre-iter10 "hold the vm:world FOV ratio"
        # behaviour, `None` = whatever weapon_data.js now ships.
        pg.evaluate("(v)=>__FPS__.vm.setAdsZoomShareOverride(v)", args.share)
        pg.evaluate("(v)=>__FPS__.vm.setAdsStandoffOverride(v)", args.standoff)

        for wid in WEAPONS:
            pg.evaluate("(id)=>__FPS__.__test.give(id)", wid)
            # let the equip raise finish and the mesh actually load
            pg.wait_for_function(
                "(id)=>{const v=__FPS__.vm; return v && v.currentId===id;}",
                arg=wid, timeout=20_000)
            pg.wait_for_timeout(900)
            hip = pg.evaluate(MEASURE_JS)

            # ---- REAL right-click ADS (input.js: canvas mousedown button 2) --
            pg.evaluate("""() => {
              const c = document.getElementById('view');
              c.dispatchEvent(new MouseEvent('mousedown', {button: 2, buttons: 2, bubbles: true}));
            }""")
            pg.wait_for_function(
                "()=>{const w=__FPS__.sim.state.player.weapon; return w && (w.adsT||0)>=0.999;}",
                timeout=10_000)
            pg.wait_for_timeout(400)   # settle
            adsT = pg.evaluate("__FPS__.sim.state.player.weapon.adsT")
            ads = pg.evaluate(MEASURE_JS)
            if args.shots:
                os.makedirs(os.path.abspath(args.out), exist_ok=True)
                pg.screenshot(path=os.path.join(args.out, f"ads_{wid}{args.tag}.png"))
            pg.evaluate("""() => window.dispatchEvent(
              new MouseEvent('mouseup', {button: 2, buttons: 0, bubbles: true}))""")
            pg.wait_for_timeout(500)
            out[wid] = {"hip": hip, "ads": ads, "adsT": adsT}
            print(f"{wid:8s} HIP area={hip['areaPct']:6.2f}%  bboxH={hip['bboxHPct']:6.2f}%"
                  f"  centreH={hip['centreHPct']:6.2f}%  disc={hip['discPct']:6.2f}%"
                  f"  band={hip['bandPct']:6.2f}%")
            print(f"{'':8s} ADS area={ads['areaPct']:6.2f}%  bboxH={ads['bboxHPct']:6.2f}%"
                  f"  centreH={ads['centreHPct']:6.2f}%  disc={ads['discPct']:6.2f}%"
                  f"  band={ads['bandPct']:6.2f}%"
                  f"  sightW={ads['sightWpx']}px  sightDx={ads['sightDx']}px")
            print(f"{'':8s}     vmFov={ads['vmFov']}  worldFov={ads['worldFov']}"
                  f"  centroidDx={ads['centroidDx']}px  centreBlocked={ads['centreBlocked']}"
                  f"  adsT={adsT}")
        vmfov = pg.evaluate("({vm: __FPS__.vm.camera.fov, world: __FPS__.camera.fov})")
        print("cameras:", vmfov)
        br.close()
    if errs:
        print("PAGE ERRORS:", errs[:5])
    os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
    with open(args.json, "w", encoding="utf-8") as f:
        json.dump({"viewport": [args.width, args.height], "weapons": out}, f, indent=2)
    print("json ->", args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
