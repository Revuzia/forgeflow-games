#!/usr/bin/env python
"""CRESTBOUND creature arena — proves every stage-1 creature and realm boss in
the REAL game loop with REAL keys (creatures lane; DEV ONLY, not a gate).

For each realm it boots the shipped page (?dev=1&quality=low&autoscale=0,
headless Chrome on the real GPU), swaps the arena def from cr_arena.js into the
page's course cache under that realm's first course id (in memory only — no
file changes), enters it with __dev.goto, STOPS the engine and hand-steps
game.update(1/60) through cr_bot.js (real KeyboardEvents, a mouse player's
camera steering). Each creature/boss proof in cr_scenarios.js returns a record;
the frames it captured from the real renderer are written as JPEGs.

    python _harness/cr_arena.py verdant            # both enemies + the boss
    python _harness/cr_arena.py ember --only slagcrab
    python _harness/cr_arena.py all

Outputs: _shots/cr_arena/<realm>/NN_<beat>.jpg and _harness/cr_arena_<realm>.json
ONE browser at a time (HARNESS_NOTES: Chrome contention).
"""
import argparse, base64, json, os, sys, time
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
URL = "http://localhost:8788/games/crestbound/index.html?dev=1&quality=low&autoscale=0"
BASE = "/games/crestbound/"
HOST = {"verdant": "verdant-1", "ember": "ember-1", "rime": "rime-1", "azure": "azure-1"}
ROSTER = {
    "verdant": ["burrower", "podspitter"],
    "ember": ["slagcrab", "emberimp"],
    "rime": ["skater", "snowcub"],
    "azure": ["sentry", "puffer"],
}
BOSS = {"verdant": "bramblehide", "ember": "slagmaw", "rime": "hoarhorn", "azure": "gyrarch"}
# the hero lane's punch / kick on one enemy per realm (run after that enemy's own proof)
STRIKE = {"verdant": "strike:podspitter", "ember": "strike:slagcrab", "rime": "strike:snowcub", "azure": "strike:sentry"}

LOAD_JS = """async ([realm, id, base]) => {
  const E = CRESTBOUND.engine;
  if (!E.running && E.__crLoop) E.start(E.__crLoop);
  const D = await import(base + 'runtime/data/index.js');
  const AR = await import(base + '_harness/cr_arena.js');
  const def = await D.getCourse(id);
  const arena = AR.arenaDef(realm);
  for (const k of Object.keys(def)) delete def[k];
  Object.assign(def, arena);
  globalThis.__crArena = { realm, id };
  await CRESTBOUND.game.__dev.goto(id);
  return Object.keys(def).length;
}"""

READY_JS = """(id) => { const G = CRESTBOUND.game;
  return { st: G.state, id: G.courseId, name: G.course && G.course.def && G.course.def.name,
           critters: G.course ? (G.course.critters || []).map(c => c.kind) : null }; }"""

SETUP_JS = """async (base) => {
  const B = await import(base + '_harness/cr_bot.js');
  const S = await import(base + '_harness/cr_scenarios.js');
  const E = CRESTBOUND.engine;
  if (E._loopFn) E.__crLoop = E._loopFn;
  E.stop();
  globalThis.__crFrames = [];
  const bot = B.makeBot();
  globalThis.__crBot = bot;
  globalThis.__crS = S.makeScenarios(bot);
  bot.watch();
  bot.idle(30);
  return { hero: bot.hero(), kinds: bot.watch() };
}"""


def save_frames(pg, outdir, start):
    fr = pg.evaluate("(s) => (globalThis.__crFrames || []).slice(s).map(f => ({name: f.name, f: f.f, url: f.url}))", start)
    names = []
    for i, f in enumerate(fr):
        n = start + i + 1
        path = os.path.join(outdir, "%02d_%s.jpg" % (n, f["name"].replace(":", "_")))
        if f.get("url") and "," in f["url"]:
            with open(path, "wb") as fh:
                fh.write(base64.b64decode(f["url"].split(",", 1)[1]))
            names.append(os.path.relpath(path, ROOT).replace("\\", "/"))
        else:
            names.append("(no pixels) " + f["name"])
    return start + len(fr), names


def boot(p):
    br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    console = []
    pg.on("console", lambda m: console.append(m.type + ": " + m.text[:300]) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: console.append("pageerror: " + str(e)[:400]))
    t0 = time.time()
    pg.goto(URL, wait_until="load", timeout=900000)
    # the box can be at 100 % CPU (other lanes): boot measured at 5+ minutes
    for _ in range(2400):
        try:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.__dev)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(500)
    print("page up in %.0f s" % (time.time() - t0), flush=True)
    return br, pg, console


def run_realm(pg, console, realm, only, args):
    id_ = HOST[realm]
    outdir = os.path.join(ROOT, "_shots", "cr_arena", realm)
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        if f.endswith(".jpg") or f.endswith(".png"):
            os.remove(os.path.join(outdir, f))
    result = {"realm": realm, "host": id_, "url": URL, "started": time.strftime("%Y-%m-%d %H:%M:%S"), "proofs": {}}
    c0 = len(console)
    t0 = time.time()
    pg.evaluate(LOAD_JS, [realm, id_, BASE])
    ready = None
    for _ in range(2400):
        ready = pg.evaluate(READY_JS, id_)
        if ready["id"] == id_ and ready["st"] == "playing" and ready["critters"] and ready["name"] and "ARENA" in ready["name"]:
            break
        pg.wait_for_timeout(500)
    print("[%s] arena loaded in %.0f s: %s" % (realm, time.time() - t0, json.dumps(ready)), flush=True)
    result["arena"] = ready
    if not ready or ready["id"] != id_:
        raise RuntimeError("arena did not load: %r" % ready)
    setup = pg.evaluate(SETUP_JS, BASE)
    print("[%s] bot ready: %s" % (realm, json.dumps(setup)), flush=True)
    fi = 0
    todo = list(ROSTER[realm]) + [STRIKE[realm]] + ([BOSS[realm]] if not args.no_boss else [])
    if only:
        todo = [k for k in todo if k in only]
    for kind in todo:
        t1 = time.time()
        try:
            rec = pg.evaluate("""(k) => { const S = globalThis.__crS;
                  if (k.indexOf('strike:') === 0) return S.strike(k.slice(7));
                  if (!S[k]) throw new Error('no scenario ' + k); return S[k](); }""", kind)
        except Exception as e:
            rec = {"kind": kind, "error": str(e)[:600]}
        fi, names = save_frames(pg, outdir, fi)
        rec["frames"] = names
        rec["wallS"] = round(time.time() - t1, 1)
        result["proofs"][kind] = rec
        ev = rec.get("events") or {}
        print("[%s] %-12s %.0fs states=%s defeated=%s reward=%s err=%s" % (
            realm, kind, rec["wallS"], ",".join(ev.get("states", [])[:16]),
            (rec.get("final") or {}).get("how"), (rec.get("steps") or {}).get("reward"),
            rec.get("error")), flush=True)
        if args.screens:
            pg.evaluate("() => CRESTBOUND.engine.render(1/60)")
            pg.screenshot(path=os.path.join(outdir, "zz_%s_page.png" % kind))
    result["console"] = console[c0:c0 + 80]
    path = os.path.join(HERE, "cr_arena_%s.json" % realm)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=1)
    print("[%s] wrote %s" % (realm, path), flush=True)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("realm", choices=["verdant", "ember", "rime", "azure", "all"])
    ap.add_argument("--only", default="", help="comma list of kinds")
    ap.add_argument("--no-boss", action="store_true")
    ap.add_argument("--screens", action="store_true", help="also a page screenshot (DOM HUD) after each proof")
    args = ap.parse_args()
    only = [k for k in args.only.split(",") if k]
    realms = ["verdant", "ember", "rime", "azure"] if args.realm == "all" else [args.realm]
    with sync_playwright() as p:
        br, pg, console = boot(p)
        try:
            for r in realms:
                try:
                    run_realm(pg, console, r, only, args)
                except Exception as e:
                    print("[%s] FAILED: %s" % (r, str(e)[:500]), flush=True)
        finally:
            br.close()


if __name__ == "__main__":
    main()
