#!/usr/bin/env python
"""RENDER LANE — count T-junctions in every terrain chunk's FAR (stride-2) index.

A T-junction is a stride-2 edge of the coarse mesh whose grid MIDPOINT vertex is
used by some other coarse triangle: the fine strip on one side has a vertex the
coarse quad on the other side does not, so the two surfaces disagree by the
curvature at that point and the background shows through as a hairline crack
(rime-3 "dead-straight bright hairlines across the snow").

    python _rn_tjunction.py --courses rime-3,verdant-1,keep
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

BASE = os.environ.get("RNURL", "http://localhost:8788/games/crestbound/index.html")
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
CLICK_JS = r"""() => { const words=['CONTINUE','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
  for (const w of words) for (const b of document.querySelectorAll('button')) {
    const r=b.getBoundingClientRect(); if(b.disabled||r.width<4) continue;
    if((b.textContent||'').toUpperCase().indexOf(w)<0) continue;
    if(b.__activate) b.__activate(); else b.click(); return w; } return null; }"""
LOAD_JS = r"""async (id) => { const G=CRESTBOUND.game; const t0=performance.now();
  const live=()=>G.course&&G.courseId===id&&(G.state==='playing'||G.state==='keep');
  if (!live()) await G.__dev.goto(id);
  const tick=()=>new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f);setTimeout(f,60);});
  while(performance.now()<t0+40000&&!live()) await tick(); return live(); }"""
TJ_JS = r"""() => {
  const grp = CRESTBOUND.game.course.group;
  const out = [];
  grp.traverse(o => {
    if (!o.isLOD || !/^terrain\.chunk\./.test(o.name || '')) return;
    const near = o.levels[0].object, far = o.levels[1] && o.levels[1].object;
    if (!far) return;
    const fine = near.geometry.index.array, coarse = far.geometry.index.array;
    const lw = fine[1];                       // both pushQuad branches start (qa, qc, ...) with qc = L(i0, j0+1) = lw
    const nv = near.geometry.attributes.position.count;
    const lh = nv / lw;
    const used = new Uint8Array(nv);
    for (let k = 0; k < coarse.length; k++) used[coarse[k]] = 1;
    // every edge of every coarse triangle; a stride-2 edge with a USED midpoint is a T-junction
    let tj = 0, edges = 0; const seen = new Set(); const where = [];
    const pos = near.geometry.attributes.position.array;
    for (let k = 0; k < coarse.length; k += 3) {
      const tri = [coarse[k], coarse[k + 1], coarse[k + 2]];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const key = a < b ? a * nv + b : b * nv + a;
        if (seen.has(key)) continue; seen.add(key); edges++;
        const ai = a % lw, aj = (a / lw) | 0, bi = b % lw, bj = (b / lw) | 0;
        const di = bi - ai, dj = bj - aj;
        if ((Math.abs(di) === 2 || di === 0) && (Math.abs(dj) === 2 || dj === 0) && (di !== 0 || dj !== 0)) {
          const m = (aj + dj / 2) * lw + (ai + di / 2);
          if (used[m]) { tj++; if (where.length < 6) where.push([+(pos[m*3] + o.position.x).toFixed(1), +(pos[m*3+1] + o.position.y).toFixed(2), +(pos[m*3+2] + o.position.z).toFixed(1)]); }
        }
      }
    }
    out.push({ chunk: o.name, lw, lh, fineTris: fine.length / 3, coarseTris: coarse.length / 3, coarseEdges: edges, tjunctions: tj, sample: where });
  });
  return out;
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--courses", default="rime-3")
    args = ap.parse_args()
    total = 0
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(BASE + "?dev=1&quality=low&autoscale=0", wait_until="load", timeout=90000)
        for _ in range(160):
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"): break
            pg.wait_for_timeout(400)
        for _ in range(80):
            if pg.evaluate("CRESTBOUND.game.state") in ("keep", "playing"): break
            pg.evaluate(CLICK_JS); pg.wait_for_timeout(400)
        for c in [x for x in args.courses.split(",") if x]:
            ok = pg.evaluate(LOAD_JS, c)
            pg.wait_for_timeout(600)
            rows = pg.evaluate(TJ_JS)
            n = sum(r["tjunctions"] for r in rows)
            total += n
            print("== %s live=%s chunks=%d T-junctions=%d" % (c, ok, len(rows), n))
            for r in rows:
                if r["tjunctions"]:
                    print("   %-22s grid %dx%d fine %d coarse %d tris  T=%d  e.g. %s" % (
                        r["chunk"], r["lw"], r["lh"], r["fineTris"], r["coarseTris"], r["tjunctions"], r["sample"][:3]))
        br.close()
    print("TOTAL T-junctions: %d" % total)
    return 0 if total == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
