# -*- coding: utf-8 -*-
"""
qa_meshrelease.py -- does a realm change GIVE THE BODIES BACK?

Cycles cold -> sand -> ash -> cold TWICE through the real `SNOWFLOW.enterRealm`,
and in every realm exercises the instance pool the way play does: spawn one body
of every resident type, let them bind and draw, then free them so they land on
their type's free list -- which is exactly the state a realm switch used to
strand forever.

After each realm it reports, off the LIVE systems:

  instances / types / _insts.length   the renderer's own pool
  scene.children                       the holder Groups that never left
  renderer.info.memory geo/tex         decoded GLB geometry + base-colour maps
  shadow + prepass proxy counts        the casters that have no unregister

PASS (all four):
  1. types and instances come BACK to the cold baseline band on the round trip
     (a band, not a monotone ramp)
  2. no "INSTANCE_MAX reached" warning is ever logged
  3. after the whole churn, six fresh spawns all bind (`_slotInst` non-null)
     and all draw (`mesh.visible`)
  4. no console error / pageerror during the churn

Port 8911.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PORT = 8911
ROOT = Path(__file__).resolve().parents[3]
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         # `performance.memory` without a collection is noise; with an explicit
         # gc() before every sample it is RETAINED heap, which is the number the
         # release is actually about.
         "--js-flags=--expose-gc"]

# Probe slots live at the TOP of the 24-slot pool. `enemies.clear()` only frees
# slots the DIRECTOR has marked alive (enemies.js:898-899), so a slot spawned
# straight onto the vis is ours to free and nobody else's to disturb.
# 14 bodies per realm x 3 distinct realms = 42 instances, which is PAST the
# INSTANCE_MAX of 40. That is the point: with the release disabled the third
# realm must run the cap out and log the warning, and with it enabled the same
# churn must never come close. At 10 per realm arm A plateaued at 35 and the
# INSTANCE_MAX gate passed vacuously in BOTH arms, proving nothing.
PROBE_SLOT0 = 10
PROBE_N = 14

PRELUDE = r"""
window.__mr = (() => {
    const SF = SNOWFLOW;
    const v = SF.combat.enemies.vis;

    const rafs = (n) => new Promise((res) => {
        let k = n;
        const tick = () => (--k <= 0) ? res(true) : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
    });

    // Enemy caster proxies carry `_inst`; terrain / character / wake proxies in
    // the same scenes do not. Counting both tells the enemy share from the rest.
    const proxies = (scene) => {
        let mine = 0;
        for (let i = 0; i < scene.children.length; i++) {
            if (scene.children[i]._inst !== undefined) mine++;
        }
        return { mine, all: scene.children.length };
    };

    const snap = (tag) => {
        // Three collections: the first drops the fresh garbage, the later two
        // reach objects only freed once their holder went. Without this the
        // heap number is allocation noise, not retention.
        if (window.gc) { window.gc(); window.gc(); window.gc(); }
        const info = SF.renderer.info;
        const sh = SF.shadows, dp = SF.depthPass;
        const shp = [], shEntries = [];
        for (let c = 0; c < sh.scenes.length; c++) {
            const p = proxies(sh.scenes[c]);
            shp.push(p.mine + "/" + p.all);
            shEntries.push(sh._perCascade ? sh._perCascade[c].length : -1);
        }
        const dpp = proxies(dp.scene);
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
            shProxy: shp,
            shEntries: shEntries,
            dpProxy: dpp.mine + "/" + dpp.all,
            dpEntries: dp._casters ? dp._casters.length : -1,
            heapMB: (performance.memory
                ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)
                : -1),
        };
    };

    // One body of every resident type, ringed around the character at 5 m so
    // every one is inside the 30 m no-frustum-cull band (meshEnemies update()).
    const spawnAll = async (n) => {
        const c = SF.character;
        // THE CURRENT REALM'S bodies, not the first ten in `_types`. `_types` is
        // a Map in insertion order, so without this filter the probe re-spawns
        // the COLD ten in sand and ash, never builds an instance of the new
        // realm's bodies, and the instance pool never comes under the pressure
        // that exhausts INSTANCE_MAX. (Found by running it the naive way: arm A
        // held a flat 19 instances across all six switches.)
        const keys = [];
        const other = [];
        for (const entry of v._types) {
            const t = entry[1];
            if (!t || t.state !== 1 || !t.unit || !t.unit.combatKey) continue;
            (t.unit.realm === v.realm ? keys : other).push(t.unit.combatKey);
        }
        for (let k = 0; keys.length < n && k < other.length; k++) {
            keys.push(other[k]);
        }
        // CYCLE the keys rather than stopping at the tenth. A realm has ten
        // bodies and the pool has fourteen slots free above SLOT0, so the first
        // four types get a SECOND concurrent instance — and a second concurrent
        // body of one type is a second `_build`, which is exactly how a real
        // encounter (two rime imps at once) grows the pool. Capping at
        // keys.length held arm A to 37 of 40 and never crossed INSTANCE_MAX.
        if (!keys.length) return [];
        const used = Math.min(n, 24 - SLOT0);
        for (let k = 0; k < used; k++) {
            const a = (k / Math.max(1, used)) * Math.PI * 2;
            const x = c.position.x + Math.cos(a) * 5;
            const z = c.position.z + Math.sin(a) * 5;
            const y = SF.terrain.heightAt(x, z);
            v.spawn(SLOT0 + k, keys[k % keys.length], x, y, z);
            v.drive(SLOT0 + k, x, y, z, 0, 0, 0, 0, 0, 0, 0);
        }
        await rafs(8);
        const rows = [];
        for (let k = 0; k < used; k++) {
            const inst = v._slotInst[SLOT0 + k];
            rows.push({
                key: keys[k % keys.length],
                bound: !!inst,
                visible: !!(inst && inst.mesh.visible),
                inScene: !!(inst && inst.root.parent),
                proxies: inst ? inst.proxies.length : -1,
            });
        }
        return rows;
    };

    const freeAll = async (n) => {
        for (let k = 0; k < n; k++) v.free(SLOT0 + k);
        await rafs(6);
    };

    return { rafs, snap, spawnAll, freeAll };
})();
"""

SETTLE = r"""(async () => {
    const v = SNOWFLOW.combat.enemies.vis;
    // The other nine bodies of the realm walk in behind the priority one; wait
    // for the whole walk so type counts are comparable realm to realm.
    if (v.streaming) { try { await v.streaming; } catch (e) {} }
    await window.__mr.rafs(12);
    return true;
})()"""

CYCLE = r"""(async (arg) => {
    const M = window.__mr;
    if (arg.token) await SNOWFLOW.enterRealm(arg.token);
    const v = SNOWFLOW.combat.enemies.vis;
    if (v.streaming) { try { await v.streaming; } catch (e) {} }
    await M.rafs(12);
    const before = M.snap(arg.tag + ":idle");
    const rows = await M.spawnAll(arg.n);
    const peak = M.snap(arg.tag + ":spawned");
    await M.freeAll(arg.n);
    const after = M.snap(arg.tag);
    return { before: before, peak: peak, after: after, rows: rows };
})"""

FINAL = r"""(async (n) => {
    const M = window.__mr;
    const rows = await M.spawnAll(n);
    const s = M.snap("final:spawned");
    await M.freeAll(n);
    return { rows: rows, snap: s };
})"""

# LAST step of the run, because it tears the enemy layer down for good.
# `dispose()` now routes through the same `_releaseInstance` a realm change
# uses, and `_releaseInstance` is idempotent -- so disposing right after a realm
# release must not double-free a skeleton or throw. Nothing in the game calls
# dispose() (the contract says so), which is exactly why it is worth touching
# once here rather than never.
DISPOSE = r"""(async () => {
    const M = window.__mr, v = SNOWFLOW.combat.enemies.vis;
    const before = M.snap("dispose:before");
    let threw = null;
    try { v.dispose(); } catch (e) { threw = String(e); }
    await M.rafs(6);
    const after = M.snap("dispose:after");
    return { threw: threw, before: before, after: after };
})()"""

# The A/B arm. Shadowing `_releaseRealm` with a no-op on the INSTANCE restores
# the exact pre-fix behaviour (load() still runs, nothing is given back);
# deleting the own-property hands the call back to the prototype. This is how
# both arms are measured in ONE session, against ONE build, without swapping a
# file other lanes are serving off the same tree.
TOGGLE = r"""((on) => {
    const v = SNOWFLOW.combat.enemies.vis;
    if (on) { delete v._releaseRealm; }
    else { v._releaseRealm = function () {}; }
    return { patched: Object.prototype.hasOwnProperty.call(v, "_releaseRealm"),
             hasProto: typeof Object.getPrototypeOf(v)._releaseRealm };
})"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)

    warns, errs = [], []
    warns_a = []
    rows, samples = [], []
    final = None
    disp = None
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: (
                warns.append(m.text) if "INSTANCE_MAX" in m.text
                else (errs.append(m.text) if m.type == "error" else None)))
            pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))

            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(PRELUDE.replace("SLOT0", str(PROBE_SLOT0)))
            pg.evaluate(SETTLE)

            def run(seq):
                for token, tag in seq:
                    r = pg.evaluate(CYCLE, {"token": token, "tag": tag,
                                            "n": PROBE_N})
                    samples.append(r["before"])
                    samples.append(r["peak"])
                    samples.append(r["after"])
                    rows.append({"tag": tag, "rows": r["rows"]})
                    print("  %-16s idle inst=%-3d types=%-3d | peak inst=%-3d "
                          "| after inst=%-3d types=%-3d geo=%-4d tex=%-4d "
                          "shEnt=%s"
                          % (tag, r["before"]["instances"],
                             r["before"]["types"], r["peak"]["instances"],
                             r["after"]["instances"], r["after"]["types"],
                             r["after"]["geo"], r["after"]["tex"],
                             ",".join(str(x) for x in r["after"]["shEntries"])))

            print("\n-- ARM A: _releaseRealm DISABLED (pre-fix behaviour) --")
            print("   toggle:", json.dumps(pg.evaluate(TOGGLE, False)))
            run([(None, "A0:cold(base)"),
                 ("sand", "A1:sand"), ("ash", "A2:ash"), ("cold", "A3:cold"),
                 ("sand", "A4:sand"), ("ash", "A5:ash"), ("cold", "A6:cold")])
            warns_a = list(warns)

            print("\n-- ARM B: _releaseRealm ENABLED (the fix) --")
            print("   toggle:", json.dumps(pg.evaluate(TOGGLE, True)))
            run([("sand", "B1:sand"), ("ash", "B2:ash"), ("cold", "B3:cold"),
                 ("sand", "B4:sand"), ("ash", "B5:ash"), ("cold", "B6:cold")])

            final = pg.evaluate(FINAL, 6)
            disp = pg.evaluate(DISPOSE)
            br.close()
    finally:
        srv.terminate()

    out = Path(__file__).with_name("qa_meshrelease.out.json")
    out.write_text(json.dumps(
        {"samples": samples, "binds": rows, "final": final,
         "dispose": disp,
         "instanceMaxWarnings": warns, "consoleErrors": errs},
        indent=1), encoding="utf-8")

    print("\n== PER-REALM (after spawn+free -- the state a realm switch sees)")
    hdr = ("tag              realm  inst live pool types mats sceneKids  geo  "
           "tex  shProxy(c0/c1/c2)      shEntries        dpProxy  dpEnt  heapMB")
    print(hdr)
    print("-" * len(hdr))
    for s in samples:
        if ":" in s["tag"] and s["tag"].split(":")[-1] in ("idle", "spawned"):
            continue
        print("%-16s %-6s %4d %4d %4d %5d %4d %9d %4d %4d  %-22s %-16s %-8s %5d %7s"
              % (s["tag"], str(s["realm"]), s["instances"], s["instLive"],
                 s["instPooled"], s["types"], s["mats"], s["sceneKids"],
                 s["geo"], s["tex"], ",".join(s["shProxy"]),
                 ",".join(str(x) for x in s["shEntries"]), s["dpProxy"],
                 s["dpEntries"], s["heapMB"]))

    after = [s for s in samples
             if s["tag"].split(":")[-1] not in ("idle", "spawned")]
    colds = [s for s in after if "cold" in s["tag"]]
    bColds = [s for s in colds if s["tag"].startswith("B")]

    # The baseline is the FIRST ARM-B cold sample, not A0: arm A ran first and
    # its cold baseline was taken while the director happened to hold four live
    # bodies of its own. The question the gate asks is whether a round trip
    # comes BACK, so both ends of it must be measured in the same arm.
    print("\n== COLD ROUND TRIP  (baseline = first ARM-B cold sample)")
    ok = True
    base = bColds[0] if bColds else None
    for s in colds:
        ref = base if base else s
        dI = s["instances"] - ref["instances"]
        dT = s["types"] - ref["types"]
        band = abs(dI) <= 2 and abs(dT) <= 1
        mark = ""
        if s["tag"].startswith("B"):
            mark = " <- gated" if not band else " <- gated, IN BAND"
            if not band:
                ok = False
        print("   %-16s instances=%-3d (%+d vs B-base)  types=%-3d (%+d)  "
              "geo=%-4d tex=%-4d heap=%sMB  %s"
              % (s["tag"], s["instances"], dI, s["types"], dT, s["geo"],
                 s["tex"], s["heapMB"], "IN BAND" if band else "OUT OF BAND")
              + mark)
    if len(bColds) < 2:
        ok = False
        print("   not enough ARM B cold samples")

    print("\n== MONOTONICITY  (types + caster bookkeeping + retained heap)")
    for arm in ("A", "B"):
        ss = [s for s in after if s["tag"].startswith(arm)]
        if not ss:
            continue
        print("   ARM %s types   : %s" % (arm, " -> ".join(
            str(s["types"]) for s in ss)))
        print("   ARM %s shEnt c0: %s" % (arm, " -> ".join(
            str(s["shEntries"][0]) for s in ss)))
        print("   ARM %s heap MB : %s" % (arm, " -> ".join(
            str(s["heapMB"]) for s in ss)))

    warns_b = warns[len(warns_a):]
    print("\n== GATE 2  INSTANCE_MAX warnings")
    print("   ARM A (release disabled): %d  %s"
          % (len(warns_a), json.dumps(warns_a[:2])))
    print("   ARM B (the fix)         : %d  %s"
          % (len(warns_b), json.dumps(warns_b[:2])))
    ok = ok and not warns_b

    print("== GATE 3  six fresh spawns after the churn")
    fr = (final or {}).get("rows", [])
    bad = [r for r in fr if not r["bound"] or not r["visible"]]
    for r in fr:
        print("   %-22s bound=%-5s visible=%-5s inScene=%-5s proxies=%d"
              % (r["key"], r["bound"], r["visible"], r["inScene"],
                 r["proxies"]))
    ok = ok and bool(fr) and not bad

    print("== GATE 4  console errors: %d %s"
          % (len(errs), json.dumps(errs[:4])))
    ok = ok and not errs

    print("== GATE 5  dispose() after a realm release")
    if disp:
        b, a = disp["before"], disp["after"]
        print("   threw: %s" % disp["threw"])
        print("   insts %d -> %d   types %d -> %d   geo %d -> %d   "
              "tex %d -> %d" % (b["insts"], a["insts"], b["types"], a["types"],
                                b["geo"], a["geo"], b["tex"], a["tex"]))
        print("   enemy shadow proxies %s -> %s   prepass %s -> %s"
              % (b["shProxy"][0], a["shProxy"][0], b["dpProxy"],
                 a["dpProxy"]))
        ok = ok and disp["threw"] is None and a["insts"] == 0
    else:
        ok = False
        print("   not run")

    print("\nRESULT:", "PASS" if ok else "FAIL")
    print("wrote", out)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
