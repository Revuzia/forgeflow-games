"""Critter portrait battery + A/B against the un-merged build.

Freezes verdant-1 at a fixed course clock, then for every critter parks the
camera at a fixed offset from that creature and photographs it. Run once with
the consolidation ON and once with `--nomerge`; the scene clock, sun and camera
are identical in both, so a pixel diff is the consolidation and nothing else.

    python _harness/_lane_crittershots.py            # merged
    python _harness/_lane_crittershots.py --nomerge  # original per-part rig
"""
import argparse, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "_shots", "critters")
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]

CLICK = r"""() => {const w=['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
 for(const q of w) for(const b of Array.from(document.querySelectorAll('button'))){
  if((b.textContent||'').toUpperCase().indexOf(q)<0) continue; const r=b.getBoundingClientRect();
  if(b.disabled||r.width<4) continue; if(b.__activate)b.__activate(); else b.click(); return q;} return null;}"""

SETUP = r"""async (course) => { const A=globalThis.CRESTBOUND, g=A.game;
  await g.__dev.goto(course);
  for(let i=0;i<150;i++) await new Promise(r=>requestAnimationFrame(r));
  A.engine.stop && A.engine.stop();
  const cs = (g.course && g.course.critters) || [];
  return cs.map((c,i)=>({i, kind:c.kind, p:[c.pos.x, c.pos.y, c.pos.z]})); }"""

SHOT = r"""(i) => { const A=globalThis.CRESTBOUND, g=A.game, cam=A.engine.camera;
  const c = g.course.critters[i];
  const r = (c.kind==='warden') ? 3.4 : (c.kind==='fen' ? 2.6 : 1.9);
  const p = c.pos;
  const eye = (c.kind==='warden') ? 4.4 : (c.kind==='fen' ? 1.3 : r*0.42);
  cam.position.set(p.x + r*0.72, p.y + eye, p.z + r*0.72);
  cam.lookAt(p.x, p.y + (c.kind==='warden'?3.4:(c.kind==='fen'?0.9:0.05)), p.z);
  cam.updateMatrixWorld(true);
  A.engine.render(0); A.engine.render(0);
  return c.kind; }"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--nomerge", action="store_true")
    ap.add_argument("--size", type=int, default=560)
    a = ap.parse_args()
    tag = "nomerge" if a.nomerge else "merged"
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page(viewport={"width": a.size, "height": a.size})
        if a.nomerge:
            pg.add_init_script("globalThis.CRESTBOUND_NOMERGE = true;")
        pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&quality=high",
                wait_until="load", timeout=60000)
        dl = time.time() + 60
        while time.time() < dl:
            if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"): break
            pg.wait_for_timeout(300)
        dl = time.time() + 60
        while time.time() < dl:
            if pg.evaluate("CRESTBOUND.game.state") in ("keep", "playing"): break
            pg.evaluate(CLICK); pg.wait_for_timeout(400)
        pg.wait_for_timeout(1200)
        rows = pg.evaluate(SETUP, a.course)
        seen = {}
        for r in rows:
            kind = pg.evaluate(SHOT, r["i"])
            n = seen.get(kind, 0); seen[kind] = n + 1
            f = os.path.join(OUT, "%s_%s%d.png" % (tag, kind, n))
            pg.screenshot(path=f)
            print("  %-8s %s" % (kind, os.path.basename(f)))
        br.close()
    print("wrote %d shots to %s" % (len(rows), OUT))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
