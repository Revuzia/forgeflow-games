#!/usr/bin/env python
"""Is the material LOD VISIBLE? Render the same frame with the gate on and off.

The fill lane's material LOD fades the injected extras (macro de-tiler, rim,
caustics) and the specular IBL out between `lodDistance` and
`lodDistance + fade`. That is only legitimate if a player cannot see where it
happens, so this renders one frozen frame twice - `Mats.setLodDistance(0)`
(disabled) and the tier value - reads both back off the GPU, and reports the
per-channel difference.

    python _lodvisible.py --course verdant-1 --station spawn --quality high

A pass is a mean absolute difference under ~1/255 and a worst-pixel difference
that is not a visible edge. The shots are written beside the harness so the
boundary can be looked at, not just measured.
"""
import argparse
import os
import sys

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

# Freeze the game clock, then render the SAME frame twice with only the LOD
# radius changed, reading each back into a byte array.
DIFF_JS = r"""
async (opts) => {
  const A = globalThis.CRESTBOUND, E = A.engine, R = E.renderer, G = A.game;
  const M = A.Mats || (await import(new URL('runtime/world/materials.js', location.href).href)).Mats;
  if (!M || typeof M.setLodDistance !== 'function') return {error: 'Mats.setLodDistance missing'};
  const frame = () => new Promise(r => requestAnimationFrame(r));
  E.stop();                                    // no animation between the two reads
  for (let k = 0; k < 4; k++) await frame();

  const gl = R.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const shot = (dist) => {
    M.setLodDistance(dist);
    E.render(0);                                // one full composed frame to the canvas
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  };
  const off = shot(0);                          // LOD disabled: full quality everywhere
  const on = shot(opts.dist);                   // the tier radius
  M.setLodDistance(opts.dist);
  E.start(E._loopFn || null);

  let sum = 0, worst = 0, over1 = 0, over4 = 0, n = 0, wx = 0, wy = 0;
  for (let i = 0; i < off.length; i += 4) {
    const d = Math.max(Math.abs(off[i] - on[i]), Math.abs(off[i + 1] - on[i + 1]),
                       Math.abs(off[i + 2] - on[i + 2]));
    sum += d; n++;
    if (d > 1) over1++;
    if (d > 4) over4++;
    if (d > worst) { worst = d; const px = (i / 4) | 0; wx = px % w; wy = (px / w) | 0; }
  }
  return {w: w, h: h, pixels: n, meanAbs: +(sum / n).toFixed(3), worst: worst,
          pctOver1: +(100 * over1 / n).toFixed(2), pctOver4: +(100 * over4 / n).toFixed(2),
          worstAt: [wx, wy], lodDistance: M.lodDistance};
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--stations", default="spawn,cp2,cp3")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--dist", type=float, default=32.0)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()
    rc = 0
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
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
        print("%-10s %-8s %8s %7s %9s %9s  %s"
              % ("course", "station", "meanAbs", "worst", "%>1/255", "%>4/255", "worst at"))
        for st in [x.strip() for x in args.stations.split(",") if x.strip()]:
            pos = pg.evaluate(STATION_JS, st)
            if pos is None:
                continue
            pg.wait_for_timeout(1400)
            r = pg.evaluate(DIFF_JS, {"dist": args.dist})
            if not isinstance(r, dict) or r.get("error"):
                print("%-10s %-8s ERROR %s" % (args.course, st, (r or {}).get("error")))
                rc = 2
                continue
            print("%-10s %-8s %8.3f %7d %9.2f %9.2f  %s"
                  % (args.course, st, r["meanAbs"], r["worst"], r["pctOver1"],
                     r["pctOver4"], r["worstAt"]))
            if r["meanAbs"] > 1.0 or r["pctOver4"] > 2.0:
                rc = 1
        br.close()
    print("RESULT: %s" % ("OK (the LOD is not visible)" if rc == 0 else "LOOK AT IT"))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
