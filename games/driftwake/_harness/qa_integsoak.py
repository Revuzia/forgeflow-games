# -*- coding: utf-8 -*-
"""
qa_integsoak.py -- the INTEGRATOR's realm-cycle soak.

Re-runs the check that originally found the mesh-enemy realm leak, on the
integrated tree (F1 release + the shadows/depthPass `unregisterCaster` hooks
this lane wired, F2 shrine/landmark re-grounding, F3 boss re-seat + gate
persistence, F4 feel fixes):

    cold -> sand -> ash -> cold -> sand -> ash -> cold        (twice round)

Every realm gets a REAL fight -- eight resident-type bodies spawned through
`enemies.spawn()` (the director's own entry point, not a raw vis slot), woken
with `registry.damage(id, 1, {})`, driven for five GAME seconds off
`registry.time`, then cleared -- so the instance pool, the caster registries
and the scene graph all take the churn a played realm change takes.

Reported per step, off the live systems:

    instances / types / _insts.length     the mesh-enemy pool
    scene.children                        holder Groups that never left
    shadow _perCascade[c].length          caster bookkeeping (all cascades)
    depthPass._casters.length             prepass bookkeeping
    geometries / textures / programs      renderer.info
    heapMB                                RETAINED heap (3x gc() first)

PASS (all of):
  1. the closing cold sample is inside the band of the OPENING cold sample
     (types +0, instances <= +2, scene kids +0, shadow/prepass entries +0,
     geo/tex <= +2, heap <= +25 MB)
  2. the two mid-cycle cold samples do not RATCHET (each cold sample is inside
     the same band, so the series is flat, not a staircase)
  3. no "INSTANCE_MAX reached" warning
  4. no console error and no page error

Port 8799 (self-served; a second bind on Windows is harmless and both servers
serve the same repo root).
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[3]
PORT = 8799
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
OUT_JSON = HERE / "qa_integsoak.out.json"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         # RETAINED heap needs a collection before the read; without it the
         # number is allocation noise and every step looks like a leak.
         "--js-flags=--expose-gc"]

# cold is the boot realm, so the ring below is entered starting from sand.
RING = ["sand", "ash", "cold", "sand", "ash", "cold"]
FIGHT_N = 8          # bodies per realm
FIGHT_S = 5.0        # GAME seconds of real combat per realm

PRELUDE = r"""
window.__is = (() => {
    const SF = SNOWFLOW;
    const reg = SF.combat.registry;
    const en = SF.combat.enemies;
    const v = en.vis;

    const rafs = (n) => new Promise((res) => {
        let k = n;
        const tick = () => (--k <= 0) ? res(true) : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
    });

    // GAME time, never wall time: a stalled frame must lengthen the wait, not
    // shorten the fight.
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res(true)
            : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
    });

    const snap = (tag) => {
        if (window.gc) { window.gc(); window.gc(); window.gc(); }
        const info = SF.renderer.info;
        const sh = SF.shadows, dp = SF.depthPass;
        const shEntries = [];
        for (let c = 0; c < sh.scenes.length; c++) {
            shEntries.push(sh._perCascade ? sh._perCascade[c].length : -1);
        }
        let live = 0, pooled = 0;
        for (let i = 0; i < v._insts.length; i++) {
            if (v._insts[i].live) live++; else pooled++;
        }
        return {
            tag: tag,
            realm: v.realm,
            instances: v.stats.instances,
            types: v.stats.types,
            insts: v._insts.length,
            instLive: live,
            instPooled: pooled,
            mats: v.materials.length,
            sceneKids: SF.scene.children.length,
            geo: info.memory.geometries,
            tex: info.memory.textures,
            programs: info.programs ? info.programs.length : -1,
            shEntries: shEntries,
            dpEntries: dp._casters ? dp._casters.length : -1,
            regCount: reg.count,
            heapMB: (performance.memory
                ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)
                : -1),
        };
    };

    // The CURRENT realm's resident types, by combatData key -- the same filter
    // qa_meshrelease uses, and for the same reason: without it every realm
    // re-spawns the cold ten and the new realm's bodies are never built.
    const residentKeys = () => {
        const mine = [], other = [];
        for (const entry of v._types) {
            const t = entry[1];
            if (!t || t.state !== 1 || !t.unit || !t.unit.combatKey) continue;
            (t.unit.realm === v.realm ? mine : other).push(t.unit.combatKey);
        }
        return mine.length ? mine : other;
    };

    // A real fight: spawn through the DIRECTOR's entry point, wake each body
    // (a fresh registry slot lands next frame, so damage after one rAF), run
    // it, then clear the way a realm change clears.
    const fight = async (n, secs) => {
        const keys = residentKeys();
        if (!keys.length) return { spawned: 0, keys: 0, woke: 0 };
        const c = SF.character;
        const ids = [];
        for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const x = c.position.x + Math.cos(a) * 6;
            const z = c.position.z + Math.sin(a) * 6;
            const id = en.spawn(keys[k % keys.length], x, z, 10);
            if (typeof id === "number" && id > 0) ids.push(id);
        }
        await rafs(2);
        let woke = 0;
        for (let k = 0; k < ids.length; k++) {
            if (reg.slot(ids[k]) < 0) continue;
            reg.damage(ids[k], 1, {});
            woke++;
        }
        await gameWait(secs);
        const mid = snap("fight");
        en.clear();
        await rafs(8);
        return { spawned: ids.length, keys: keys.length, woke: woke,
                 peakInstances: mid.instances, peakLive: mid.instLive };
    };

    return { rafs, gameWait, snap, fight, residentKeys };
})();
"""

SETTLE = r"""(async () => {
    const v = SNOWFLOW.combat.enemies.vis;
    if (v.streaming) { try { await v.streaming; } catch (e) {} }
    await window.__is.rafs(12);
    return true;
})()"""

STEP = r"""(async (arg) => {
    const M = window.__is;
    if (arg.token) await SNOWFLOW.enterRealm(arg.token);
    const v = SNOWFLOW.combat.enemies.vis;
    if (v.streaming) { try { await v.streaming; } catch (e) {} }
    await M.rafs(12);
    const f = await M.fight(arg.n, arg.secs);
    const s = M.snap(arg.tag);
    return { fight: f, snap: s };
})"""


def band(base, s):
    """Deltas that must hold for a sample to be inside the cold baseline band."""
    return {
        "types": s["types"] - base["types"],
        "instances": s["instances"] - base["instances"],
        "sceneKids": s["sceneKids"] - base["sceneKids"],
        "shEnt0": s["shEntries"][0] - base["shEntries"][0],
        "dpEnt": s["dpEntries"] - base["dpEntries"],
        "geo": s["geo"] - base["geo"],
        "tex": s["tex"] - base["tex"],
        "heapMB": round(s["heapMB"] - base["heapMB"], 1),
    }


LIMITS = {"types": 0, "instances": 2, "sceneKids": 0, "shEnt0": 0, "dpEnt": 0,
          "geo": 2, "tex": 2, "heapMB": 25.0}


def in_band(d):
    return [k for k, v in d.items() if v > LIMITS[k]]


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.0)

    warns, errs, perrs = [], [], []
    steps = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: (
                warns.append(m.text) if "INSTANCE_MAX" in m.text
                else (errs.append(m.text) if m.type == "error" else None)))
            pg.on("pageerror", lambda e: perrs.append(str(e)[:400]))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(PRELUDE)
            pg.evaluate(SETTLE)

            # S0 -- the OPENING cold sample, with the same fight every later
            # step gets, so the baseline is comparable and not a cold start.
            r = pg.evaluate(STEP, {"token": None, "tag": "S0:cold",
                                   "n": FIGHT_N, "secs": FIGHT_S})
            steps.append(r)
            print("  %-10s %s" % ("S0:cold", json.dumps(r["fight"])), flush=True)

            for i, tok in enumerate(RING):
                tag = "S%d:%s" % (i + 1, tok)
                r = pg.evaluate(STEP, {"token": tok, "tag": tag,
                                       "n": FIGHT_N, "secs": FIGHT_S})
                steps.append(r)
                print("  %-10s %s" % (tag, json.dumps(r["fight"])), flush=True)

            pg.screenshot(path=str(HERE / "qa_integsoak_end.png"))
            br.close()
    finally:
        srv.terminate()

    snaps = [s["snap"] for s in steps]
    base = snaps[0]

    print("")
    print("=" * 118)
    print("  REALM CYCLE  cold -> sand -> ash -> cold -> sand -> ash -> cold "
          "(2 rounds), 8-body fight in every realm")
    print("=" * 118)
    hdr = ("%-11s %-6s %5s %5s %6s %6s %5s %5s %5s %-14s %5s %8s"
           % ("step", "realm", "inst", "type", "scene", "insts", "geo", "tex",
              "prog", "shEntries", "dpEnt", "heapMB"))
    print(hdr)
    for s in snaps:
        print("%-11s %-6s %5d %5d %6d %6d %5d %5d %5d %-14s %5d %8.1f" % (
            s["tag"], s["realm"], s["instances"], s["types"], s["sceneKids"],
            s["insts"], s["geo"], s["tex"], s["programs"],
            ",".join(str(x) for x in s["shEntries"]), s["dpEntries"],
            s["heapMB"]))

    print("")
    print("== BAND vs the opening cold sample (limits %s)" % json.dumps(LIMITS))
    colds = [(i, s) for i, s in enumerate(snaps) if s["realm"] == "cold"]
    fails = []
    for i, s in enumerate(snaps):
        d = band(base, s)
        bad = in_band(d)
        mark = "IN BAND" if not bad else ("OUT OF BAND -> " + ",".join(bad))
        # Only COLD samples are held to the band: sand and ash legitimately
        # carry a different realm's ten bodies.
        if s["realm"] != "cold":
            mark = "(not cold - informational)"
        elif bad:
            fails.append((s["tag"], bad, d))
        print("  %-11s %-46s %s" % (s["tag"], json.dumps(d), mark))

    print("")
    print("== RATCHET CHECK  (the cold series must be flat, not a staircase)")
    print("   cold types   : %s" % " -> ".join(str(s["types"]) for _, s in colds))
    print("   cold inst    : %s" % " -> ".join(str(s["instances"]) for _, s in colds))
    print("   cold shEnt c0: %s" % " -> ".join(str(s["shEntries"][0]) for _, s in colds))
    print("   cold dpEnt   : %s" % " -> ".join(str(s["dpEntries"]) for _, s in colds))
    print("   cold sceneKid: %s" % " -> ".join(str(s["sceneKids"]) for _, s in colds))
    print("   cold geo/tex : %s" % " -> ".join("%d/%d" % (s["geo"], s["tex"])
                                               for _, s in colds))
    print("   cold heapMB  : %s" % " -> ".join("%.1f" % s["heapMB"] for _, s in colds))
    print("   ALL steps types: %s" % " -> ".join(str(s["types"]) for s in snaps))
    print("   ALL steps shEnt c0: %s" % " -> ".join(str(s["shEntries"][0])
                                                    for s in snaps))
    print("   ALL steps dpEnt: %s" % " -> ".join(str(s["dpEntries"]) for s in snaps))

    print("")
    print("== INSTANCE_MAX warnings: %d %s" % (len(warns), warns[:3]))
    print("== console errors: %d %s" % (len(errs), errs[:3]))
    print("== page errors: %d %s" % (len(perrs), perrs[:3]))

    ok = (not fails) and (not warns) and (not errs) and (not perrs)
    print("")
    print("RESULT: %s" % ("PASS" if ok else "FAIL"))
    for tag, bad, d in fails:
        print("   FAIL %s out of band on %s -> %s" % (tag, bad, json.dumps(d)))

    OUT_JSON.write_text(json.dumps(
        {"steps": steps, "warns": warns, "errs": errs, "pageerrors": perrs,
         "ok": ok}, indent=1), encoding="utf-8")
    print("wrote %s" % OUT_JSON)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
