"""characters-art lane: live renderer.info attribution for Last Circle (read-only)."""
import sys, json, argparse, time
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = __file__.rsplit("\\",1)[0] if "\\" in __file__ else __file__.rsplit("/",1)[0]
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--enable-gpu","--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required",
         "--disable-background-timer-throttling","--disable-renderer-backgrounding"]
JS = open(HERE + "/charprobe.js", encoding="utf-8").read()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", default="isla_viva")
    ap.add_argument("--mode", default="standard")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--headful", action="store_true")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    res = {"map": a.map, "mode": a.mode, "seed": a.seed, "steps": []}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=not a.headful, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.goto(URL, wait_until="load", timeout=120000)
        for _ in range(300):
            if pg.evaluate("!!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)"): break
            pg.wait_for_timeout(300)
        res["gpu"] = pg.evaluate("""() => { const gl = window.__LC__.W.kernel.renderer.getContext();
            const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }""")
        res["dpr"] = pg.evaluate("() => window.__LC__.W.kernel.renderer.getPixelRatio()")
        res["graphics"] = pg.evaluate("() => window.__LC__.W.settings.graphics")
        print("gpu:", res["gpu"], "dpr:", res["dpr"], "graphics:", res["graphics"], flush=True)
        pg.evaluate("(src) => { (0, eval)(src); return window.__CPinstall(); }", JS)
        print("installed", flush=True)
        t0 = time.time()
        pg.evaluate("([m,mode,seed]) => window.__LC__.startMatch({mapId:m, mode, seed})", [a.map, a.mode, a.seed])
        res["startMatchS"] = round(time.time() - t0, 1)
        # wait for lobby -> drop/match (real timers)
        for _ in range(100):
            ph = pg.evaluate("() => window.__LC__.W.phase")
            if ph in ("drop", "match"): break
            pg.wait_for_timeout(200)
        pg.wait_for_timeout(600)

        def snap(label, extra=None):
            r = pg.evaluate("""(label) => { const P = window.__CP; const f = P.frame(); const tm = P.timed(5);
                return { label, frame: f, timing: tm, actors: P.actorStats(), mixers: P.mixerMs() }; }""", label)
            if extra: r.update(extra)
            res["steps"].append(r)
            f = r["frame"]; ac = r["actors"]
            print(flush=True); print(f"[{label}] phase={ac['phase']} t={ac['t']} alive={ac['alive']} calls={f['calls']} tris={f['tris']:,} progs={f['programs']} tex={f['textures']} best={r['timing']['bestMs']}ms inFrustum={ac['bodyInFrustum']} chutes={ac['chutes']} tags={ac['nametagVisible']} wpnVis={ac['weaponVisible']} dist={ac['distHist']}")
            top = sorted(f["byKey"].items(), key=lambda kv: -kv[1]["calls"])[:14]
            for k, v in top: print(f"     {k:34s} calls={v['calls']:4d} tris={v['tris']:>10,} objs={v['objs']}")
            return r

        def ff(sec):
            t = time.time(); out = None
            for _ in range(int(sec)):
                out = pg.evaluate("(s) => window.__LC__.fastForward(s, 1/30)", 1)
            print(f"   ff({sec}) took {time.time()-t:.1f}s", flush=True)
            return out

        snap("drop_start")
        ff(10); snap("drop_t10")
        ff(10); snap("drop_t20")
        ff(25); snap("landed_t45")
        # cluster test at landed
        for label, radius, dist in (("cluster12_t45", 12, 18), ("cluster30_t45", 30, 40)):
            r = pg.evaluate("""([radius, dist]) => { const P = window.__CP; const undo = P.cluster(radius, dist);
                const full = P.frame(); const tm = P.timed(5); const st = P.actorStats();
                P.toggle('nametag', false); const noTag = P.frame();
                P.toggle('weapon', false); const noTagWpn = P.frame();
                P.toggle('castShadow', false); const noShadow = P.frame();
                P.toggle('castShadow', true);
                P.toggle('actors', false); const world = P.frame(); const tmWorld = P.timed(5);
                P.toggle('actors', true); P.toggle('weapon', true); P.toggle('nametag', true);
                undo();
                return { full, tm, st, noTag: [noTag.calls, noTag.tris], noTagWpn: [noTagWpn.calls, noTagWpn.tris],
                         noShadow: [noShadow.calls, noShadow.tris, noShadow.finishMs], world: [world.calls, world.tris], tmWorld }; }""", [radius, dist])
            res["steps"].append({"label": label, **r})
            print(f"[{label}] calls={r['full']['calls']} tris={r['full']['tris']:,} best={r['tm']['bestMs']}ms inFrustum={r['st']['bodyInFrustum']} | noTag={r['noTag']} noTag+noWpn={r['noTagWpn']} +noCharShadow={r['noShadow']} | worldOnly={r['world']} bestWorld={r['tmWorld']['bestMs']}ms")
            top = sorted(r["full"]["byKey"].items(), key=lambda kv: -kv[1]["calls"])[:10]
            for k, v in top: print(f"     {k:34s} calls={v['calls']:4d} tris={v['tris']:>10,} objs={v['objs']}")
        ff(75); snap("mid_t120")
        ff(120); snap("mid_t240")
        res["groups"] = pg.evaluate("() => window.__CP.groups()")
        res["errors"] = errs
        print("groups:", json.dumps(res["groups"]))
        print("gpu:", res["gpu"], "dpr:", res["dpr"], "graphics:", res["graphics"], "errors:", errs[:3])
        br.close()
    if a.out:
        json.dump(res, open(a.out, "w", encoding="utf-8"), indent=1)

main()
