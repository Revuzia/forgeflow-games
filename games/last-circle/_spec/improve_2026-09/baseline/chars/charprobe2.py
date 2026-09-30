"""characters-art lane probe v2: one evaluate per scenario (the shared iGPU is heavily contended)."""
import sys, json, argparse, time
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = __file__.replace("\\", "/").rsplit("/", 1)[0]
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--enable-gpu","--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required",
         "--disable-background-timer-throttling","--disable-renderer-backgrounding"]
JS = open(HERE + "/charprobe.js", encoding="utf-8").read()
T0 = time.time()
def log(*a): print(f"{time.time()-T0:6.1f}s", *a, flush=True)

SCEN = r"""
async ([label, ffS, cluster]) => {
  const C = window.__LC__, W = C.W, P = window.__CP;
  for (let i = 0; i < ffS; i++) C.fastForward(1, 1/30);
  // let the real frame pipeline run twice (followShadow, mixers, fx) before measuring
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out = { label };
  out.frame = P.frame({});
  out.actors = P.actorStats();
  out.mixers = P.mixerMs();
  if (cluster) {
    const undo = P.cluster(cluster[0], cluster[1]);
    out.cl = P.frame({}); out.clActors = P.actorStats();
    P.toggle('nametag', false); out.clNoTag = P.frame({});
    P.toggle('weapon', false); out.clNoTagWpn = P.frame({});
    P.toggle('castShadow', false); out.clNoCharShadow = P.frame({});
    P.toggle('castShadow', true);
    P.toggle('actors', false); out.clWorld = P.frame({});
    P.toggle('actors', true); P.toggle('weapon', true); P.toggle('nametag', true);
    undo();
  }
  return out;
}
"""

def short(f):
    return f"calls={f['calls']} tris={f['tris']:,} progs={f['programs']} tex={f['textures']} geo={f['geometries']} submit={f['submitMs']}ms"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", default="isla_viva")
    ap.add_argument("--mode", default="standard")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--plan", default="0,0;10,0;10,0;25,1;75,0;120,1")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    res = {"map": a.map, "mode": a.mode, "seed": a.seed, "steps": []}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.set_default_timeout(1800000)
        pg.goto(URL, wait_until="domcontentloaded", timeout=600000)
        log("dom loaded")
        pg.wait_for_function("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)", timeout=1200000, polling=2000)
        log("__LC__ ready")
        info = pg.evaluate("""(src) => { (0, eval)(src); window.__CPinstall(); const r = window.__LC__.W.kernel.renderer; const gl = r.getContext();
            const e = gl.getExtension('WEBGL_debug_renderer_info');
            return { gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a', dpr: r.getPixelRatio(), graphics: window.__LC__.W.settings.graphics }; }""", JS)
        res.update(info); log("ready", info)
        pg.evaluate("([m,mode,seed]) => window.__LC__.startMatch({mapId:m, mode, seed})", [a.map, a.mode, a.seed])
        log("startMatch resolved")
        pg.wait_for_function("() => ['drop','match'].includes(window.__LC__.W.phase)", timeout=1200000, polling=500)
        log("phase", pg.evaluate("() => window.__LC__.W.phase"))
        tot = 0
        for i, step in enumerate(a.plan.split(";")):
            ffs, cl = step.split(",")
            tot += int(ffs)
            label = f"t+{tot}"
            clus = [14, 20] if cl == "1" else None
            r = pg.evaluate(SCEN, [label, int(ffs), clus])
            res["steps"].append(r)
            ac = r["actors"]
            log(f"[{label}] phase={ac['phase']} t={ac['t']} alive={ac['alive']} {short(r['frame'])} bodyInFrustum={ac['bodyInFrustum']} chutes={ac['chutes']} tagsVis={ac['nametagVisible']} wpnVis={ac['weaponVisible']} dist={ac['distHist']} mixers={r['mixers']}")
            for k, v in sorted(r["frame"]["byKey"].items(), key=lambda kv: -kv[1]["tris"])[:12]:
                print(f"        {k:30s} calls={v['calls']:4d} tris={v['tris']:>11,} objs={v['objs']}", flush=True)
            if clus:
                log(f"   CLUSTER {clus}: full {short(r['cl'])} inFrustum={r['clActors']['bodyInFrustum']}")
                log(f"      -nametags {short(r['clNoTag'])}")
                log(f"      -weapons  {short(r['clNoTagWpn'])}")
                log(f"      -charShadow {short(r['clNoCharShadow'])}")
                log(f"      world only {short(r['clWorld'])}")
                for k, v in sorted(r["cl"]["byKey"].items(), key=lambda kv: -kv[1]["tris"])[:10]:
                    print(f"        {k:30s} calls={v['calls']:4d} tris={v['tris']:>11,} objs={v['objs']}", flush=True)
            if a.out: json.dump(res, open(a.out, "w", encoding="utf-8"), indent=1)
        res["groups"] = pg.evaluate("() => window.__CP.groups()")
        res["errors"] = errs
        log("groups", json.dumps(res["groups"]))
        log("errors", errs[:5])
        if a.out: json.dump(res, open(a.out, "w", encoding="utf-8"), indent=1)
        br.close()
main()
