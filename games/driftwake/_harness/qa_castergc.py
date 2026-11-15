# -*- coding: utf-8 -*-
"""
qa_castergc.py -- A/B on the two `unregisterCaster` hooks this lane wired.

F1's realm release gives the mesh-enemy BODIES back, but the caster bookkeeping
they registered into lives in two other modules. Before this lane there was no
inverse of `registerCaster`, so every released body left one `{mesh, proxy}`
entry per cascade in `shadows._perCascade` and one in `depthPass._casters`,
plus a proxy child in each of those scenes -- forever.

This measures that directly, in ONE session against ONE build, by shadowing the
new methods with `undefined` on the instance so meshEnemies' feature-detect
(meshEnemies.js:1403/1406) misses them:

    ARM A  hooks HIDDEN   -- the pre-hook behaviour
    ARM B  hooks LIVE     -- `delete` hands the call back to the prototype

Each arm walks cold -> sand -> ash -> cold with an 8-body fight in every realm
and reports shadow entries per cascade, prepass entries, and the proxy children
actually parented in those scenes.

PASS: ARM A's per-cycle growth is positive and ARM B's is <= 0.
Port 8799.
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
OUT_JSON = HERE / "qa_castergc.out.json"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

RING = ["sand", "ash", "cold"]
FIGHT_N = 8
FIGHT_S = 3.0

PRELUDE = r"""
window.__cg = (() => {
    const SF = SNOWFLOW;
    const reg = SF.combat.registry;
    const en = SF.combat.enemies;
    const v = en.vis;

    const rafs = (n) => new Promise((res) => {
        let k = n;
        const tick = () => (--k <= 0) ? res(true) : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
    });
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res(true)
            : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
    });

    // An enemy caster proxy carries `_inst`; terrain / character / wake proxies
    // in the same scene do not.
    const mine = (scene) => {
        let n = 0;
        for (let i = 0; i < scene.children.length; i++) {
            if (scene.children[i]._inst !== undefined) n++;
        }
        return n;
    };

    const snap = (tag) => {
        const sh = SF.shadows, dp = SF.depthPass;
        const ent = [], px = [];
        for (let c = 0; c < sh.scenes.length; c++) {
            ent.push(sh._perCascade ? sh._perCascade[c].length : -1);
            px.push(mine(sh.scenes[c]) + "/" + sh.scenes[c].children.length);
        }
        return {
            tag: tag, realm: v.realm,
            instances: v.stats.instances, types: v.stats.types,
            shEnt: ent, shProxy: px,
            dpEnt: dp._casters ? dp._casters.length : -1,
            dpProxy: mine(dp.scene) + "/" + dp.scene.children.length,
            hookShadow: typeof sh.unregisterCaster,
            hookDepth: typeof dp.unregisterCaster,
        };
    };

    const residentKeys = () => {
        const a = [], b = [];
        for (const entry of v._types) {
            const t = entry[1];
            if (!t || t.state !== 1 || !t.unit || !t.unit.combatKey) continue;
            (t.unit.realm === v.realm ? a : b).push(t.unit.combatKey);
        }
        return a.length ? a : b;
    };

    const fight = async (n, secs) => {
        const keys = residentKeys();
        if (!keys.length) return 0;
        const c = SF.character, ids = [];
        for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const x = c.position.x + Math.cos(a) * 6;
            const z = c.position.z + Math.sin(a) * 6;
            const id = en.spawn(keys[k % keys.length], x, z, 10);
            if (typeof id === "number" && id > 0) ids.push(id);
        }
        await rafs(2);
        for (let k = 0; k < ids.length; k++) {
            if (reg.slot(ids[k]) >= 0) reg.damage(ids[k], 1, {});
        }
        await gameWait(secs);
        en.clear();
        await rafs(8);
        return ids.length;
    };

    return { rafs, snap, fight };
})();
"""

# `undefined` on the INSTANCE shadows the prototype method, so meshEnemies'
# `typeof ... === "function"` guard misses it. `delete` gives it straight back.
HIDE = r"""((on) => {
    const sh = SNOWFLOW.shadows, dp = SNOWFLOW.depthPass;
    if (on) { sh.unregisterCaster = undefined; dp.unregisterCaster = undefined; }
    else { delete sh.unregisterCaster; delete dp.unregisterCaster; }
    return { shadow: typeof sh.unregisterCaster, depth: typeof dp.unregisterCaster };
})"""

STEP = r"""(async (arg) => {
    const M = window.__cg;
    if (arg.token) await SNOWFLOW.enterRealm(arg.token);
    const v = SNOWFLOW.combat.enemies.vis;
    if (v.streaming) { try { await v.streaming; } catch (e) {} }
    await M.rafs(12);
    await M.fight(arg.n, arg.secs);
    return M.snap(arg.tag);
})"""


def run_arm(pg, label, hide):
    print("\n---- ARM %s  (unregisterCaster %s) ----"
          % (label, "HIDDEN" if hide else "LIVE"), flush=True)
    print("   hook typeof:", json.dumps(pg.evaluate(HIDE, hide)), flush=True)
    out = [pg.evaluate(STEP, {"token": None, "tag": "%s0:cold" % label,
                              "n": FIGHT_N, "secs": FIGHT_S})]
    for i, tok in enumerate(RING):
        out.append(pg.evaluate(STEP, {"token": tok,
                                      "tag": "%s%d:%s" % (label, i + 1, tok),
                                      "n": FIGHT_N, "secs": FIGHT_S}))
    for s in out:
        print("   %-10s %-5s inst=%-3d types=%-3d shEnt=%-12s shProxy=%-22s "
              "dpEnt=%-3d dpProxy=%s"
              % (s["tag"], s["realm"], s["instances"], s["types"],
                 ",".join(str(x) for x in s["shEnt"]),
                 ",".join(s["shProxy"]), s["dpEnt"], s["dpProxy"]), flush=True)
    return out


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.0)
    errs, perrs = [], []
    a = b = None
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: errs.append(m.text)
                  if m.type == "error" else None)
            pg.on("pageerror", lambda e: perrs.append(str(e)[:400]))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(PRELUDE)
            a = run_arm(pg, "A", True)
            b = run_arm(pg, "B", False)
            br.close()
    finally:
        srv.terminate()

    def growth(rows, key):
        if key == "sh":
            return rows[-1]["shEnt"][0] - rows[0]["shEnt"][0]
        return rows[-1]["dpEnt"] - rows[0]["dpEnt"]

    ga_sh, ga_dp = growth(a, "sh"), growth(a, "dp")
    gb_sh, gb_dp = growth(b, "sh"), growth(b, "dp")

    print("")
    print("=" * 90)
    print("  cold -> sand -> ash -> cold, growth in caster bookkeeping over the cycle")
    print("=" * 90)
    print("  ARM A (hooks hidden)  shadow c0 %s   prepass %s"
          % (" -> ".join(str(s["shEnt"][0]) for s in a),
             " -> ".join(str(s["dpEnt"]) for s in a)))
    print("  ARM B (hooks live)    shadow c0 %s   prepass %s"
          % (" -> ".join(str(s["shEnt"][0]) for s in b),
             " -> ".join(str(s["dpEnt"]) for s in b)))
    print("  growth  ARM A shadow +%d  prepass +%d" % (ga_sh, ga_dp))
    print("  growth  ARM B shadow %+d  prepass %+d" % (gb_sh, gb_dp))
    print("  console errors: %d   page errors: %d" % (len(errs), len(perrs)))

    ok = ga_sh > 0 and ga_dp > 0 and gb_sh <= 0 and gb_dp <= 0 and not perrs
    print("")
    print("RESULT: %s" % ("PASS" if ok else "FAIL"))
    OUT_JSON.write_text(json.dumps({"armA": a, "armB": b, "errs": errs,
                                    "pageerrors": perrs, "ok": ok}, indent=1),
                        encoding="utf-8")
    print("wrote %s" % OUT_JSON)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
