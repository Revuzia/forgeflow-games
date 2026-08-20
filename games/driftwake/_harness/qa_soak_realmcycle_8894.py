# -*- coding: utf-8 -*-
"""
qa_soak_realmcycle_8894.py -- the RETURN-TO-START comparison, isolated.

The long soak (qa_soak_8894.py) answers "what grew over 15 minutes". This one
answers the narrower question the soak's tail is at risk of truncating:
after cold -> sand -> ash -> cold -> sand -> ash -> cold, what does NOT come
back to its cold baseline?

Measures, per realm entry, with a short fight in each so bodies actually get
built: renderer.info.memory.geometries / textures, program count, JS heap,
meshEnemies `_types.size` / `materials.length` / `_insts.length`, the melee
and ranged attack-token free counts, scene object count, DOM nodes.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PORT = 8894
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]
OUT_JSON = HERE / "qa_soak_realmcycle_8894.out.json"

DRIVER = r"""
(() => {
const S = SNOWFLOW, reg = S.combat.registry, I = S.input, ch = S.character;
const en = S.combat.enemies, vis = en.vis;
const R = window.__rc = { rows: [], notes: [], done: false, fatal: null,
                          stalls: 0, warns: [] };
I.locked = true;

// ---- Math.random call counter (ARCHITECTURE.md §6 audit) ----------------
// Apply-through wrapper: same return value, same distribution, zero
// behaviour change. Frames are counted off rAF so the per-frame rate is
// measurable rather than asserted.
if (!window.__rngPatched) {
    window.__rngPatched = true;
    window.__rngCalls = 0;
    window.__frames = 0;
    window.__rngSites = Object.create(null);
    const orig = Math.random;
    Math.random = function () {
        const n = ++window.__rngCalls;
        // Sample 1 in 25 so the stack capture cannot itself distort the
        // frame; the tally is a rate, not a census.
        if (n % 25 === 0) {
            const st = (new Error()).stack || "";
            const lines = st.split("\n");
            // [0] "Error", [1] this wrapper, [2] the real caller.
            const who = (lines[2] || "?").trim()
                .replace(/^at\s+/, "").replace(/\?v=[^:)]*/, "")
                .replace(/https?:\/\/[^/]+\//, "");
            window.__rngSites[who] = (window.__rngSites[who] || 0) + 1;
        }
        return orig();
    };
    const tick = () => { window.__frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
}

function wait(sec) {
    return new Promise((res) => {
        const t0 = reg.time, w0 = Date.now();
        const budget = sec * 1000 * 8 + 20000;
        const tick = () => {
            if (reg.time - t0 >= sec) return res();
            if (Date.now() - w0 > budget) { R.stalls++; return res(); }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}
function key(c, d) {
    window.dispatchEvent(new KeyboardEvent(d ? "keydown" : "keyup",
        { code: c, key: c, bubbles: true, cancelable: true }));
}
function tap(c) { key(c, true); key(c, false); }
function mouse(t, b) {
    document.dispatchEvent(new MouseEvent(t,
        { button: b, buttons: b === 0 ? 1 : 2, bubbles: true, cancelable: true }));
}
function look(dx) {
    document.dispatchEvent(new MouseEvent("mousemove",
        { movementX: dx, bubbles: true }));
}

// The rider's live animation state. The soak's end-of-session screenshot
// showed an arms-out pose; this is the disconfirming check — capture the
// SAME reading on a fresh boot-idle and after a long play session, so an
// ordinary idle pose cannot be mistaken for a bind-pose fallback.
function riderPose() {
    const mc = S.meshChar;
    if (!mc) return { err: "no meshChar" };
    const acts = mc._acts || [];
    const out = { weights: {}, running: {}, mixerTime: mc.mixer ? +mc.mixer.time.toFixed(2) : null,
                  wSum: 0, visible: !!(mc.root && mc.root.visible) };
    const NAMES = ["idle", "walk", "run", "jump", "fall", "land", "roll",
                   "skate", "lookaround", "weightshift", "cast",
                   "cast3", "cast4", "cast5"];
    for (let i = 0; i < acts.length; i++) {
        if (!acts[i]) continue;
        const w = acts[i].getEffectiveWeight();
        out.weights[NAMES[i] || i] = +w.toFixed(3);
        out.running[NAMES[i] || i] = acts[i].isRunning();
        out.wSum += w;
    }
    out.wSum = +out.wSum.toFixed(3);
    // Bone geometry: a bind/T-pose reads as arms far apart and level with
    // the shoulders. Measured, not eyeballed.
    let L = null, R = null, hips = null, head = null;
    mc.root.traverse((o) => {
        if (!o.isBone) return;
        if (!L && /LeftHand$/.test(o.name)) L = o;
        if (!R && /RightHand$/.test(o.name)) R = o;
        if (!hips && /Hips$/.test(o.name)) hips = o;
        if (!head && /Head$/.test(o.name)) head = o;
    });
    if (L && R && hips) {
        const a = new L.position.constructor();
        const b = new L.position.constructor();
        const h = new L.position.constructor();
        L.getWorldPosition(a); R.getWorldPosition(b); hips.getWorldPosition(h);
        out.handSpanM = +a.distanceTo(b).toFixed(3);
        out.handRiseM = +(((a.y + b.y) / 2) - h.y).toFixed(3);
        if (head) {
            const hd = new L.position.constructor();
            head.getWorldPosition(hd);
            out.headRiseM = +(hd.y - h.y).toFixed(3);
        }
    }
    return out;
}

function row(tag) {
    const info = S.renderer.info, m = performance.memory || null;
    let objs = 0; S.scene.traverse(() => objs++);
    let enAlive = 0;
    for (let i = 0; i < en.alive.length; i++) if (en.alive[i]) enAlive++;
    let regAlive = 0;
    for (let i = 0; i < reg.count; i++) if (reg.hp[i] > 0) regAlive++;
    R.rows.push({
        tag, gt: +reg.time.toFixed(1), realm: S.combat.encounters.realm,
        geo: info.memory.geometries, tex: info.memory.textures,
        prog: info.programs ? info.programs.length : -1,
        heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(2) : null,
        types: vis._types.size, mats: vis.materials.length,
        insts: vis._insts.length,
        instLive: vis._insts.filter((o) => o.live).length,
        freeByType: (() => {
            const o = {};
            vis._types.forEach((t, k) => { o[k] = t.free ? t.free.length : -1; });
            return o;
        })(),
        meleeFree: en._meleeFree, rangedFree: en._rangedFree,
        enAlive, regCount: reg.count, regAlive,
        sceneObjs: objs, dom: document.getElementsByTagName("*").length,
        dc: S.perfStats.drawCalls, tri: S.perfStats.triangles,
        fps: +S.perfStats.fps.toFixed(1),
        mean: +S.perfStats.mean.toFixed(2),
        // Per-system CPU ms. If a system's cost climbs with every realm
        // visited while the live body count is unchanged, the cost is being
        // paid for bodies that are no longer in this realm.
        sys: JSON.parse(JSON.stringify(S.perfSystems)),
        visStats: JSON.parse(JSON.stringify(vis.stats)),
        rngCalls: window.__rngCalls, frames: window.__frames,
        rngSites: JSON.parse(JSON.stringify(window.__rngSites)),
    });
}

async function fight(sec) {
    mouse("mousedown", 0);
    key("KeyW", true);
    const t0 = reg.time; let i = 0;
    const CAST = ["Digit2", "Digit3", "Digit4", "Digit5", "Digit1"];
    while (reg.time - t0 < sec) {
        let best = -1, bd = 1e9;
        for (let k = 0; k < reg.count; k++) {
            if (reg.hp[k] <= 0 || reg.kind[k] === "dummy") continue;
            const d = Math.hypot(reg.x[k] - ch.position.x, reg.z[k] - ch.position.z);
            if (d < bd) { bd = d; best = k; }
        }
        if (best >= 0) {
            const want = Math.atan2(reg.x[best] - ch.position.x,
                                    -(reg.z[best] - ch.position.z));
            let d = want - S.rig.yaw;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            look(Math.max(-0.3, Math.min(0.3, d)) / 0.0022);
        } else { look(180); }
        tap(CAST[i % CAST.length]);
        i++;
        await wait(0.6);
    }
    mouse("mouseup", 0);
    key("KeyW", false);
}

async function go(realmKey, label) {
    tap(realmKey);
    await wait(10);
    row("enter:" + label);
    await fight(30);
    row("fought:" + label);
}

(async () => {
try {
    // Fresh boot, no input has ever been sent: THE idle-pose baseline.
    await wait(6);
    R.poseFresh = riderPose();
    R.poseFreshAt = +reg.time.toFixed(1);
    window.__poseShot = "fresh";
    await wait(4);

    row("BASELINE-cold");
    await fight(30);
    row("cold-after-fight-0");

    for (let cyc = 0; cyc < 2; cyc++) {
        await go("Digit6", "sand-c" + cyc);      // cold -> sand
        await go("Digit7", "ash-c" + cyc);       // sand -> ash
        tap("Digit7");                            // ash -> cold (toggle back)
        await wait(10);
        row("enter:cold-c" + cyc);
        await fight(30);
        row("fought:cold-c" + cyc);
    }

    // Quiescent: nothing alive, nothing cast, settle then compare.
    en.clear();
    S.motes.clear();
    // Every held input released, exactly as the long soak's final leg did.
    key("KeyW", false); key("KeyS", false);
    I.surf = false; I.boltHeld = false; I.spellHeld2 = false;
    mouse("mouseup", 0);
    await wait(45);
    R.poseAfter = riderPose();
    R.poseAfterAt = +reg.time.toFixed(1);
    window.__poseShot = "after";
    await wait(10);
    row("FINAL-cold-quiescent");
} catch (e) {
    R.fatal = String((e && e.stack) || e);
}
    R.done = true;
})();
return "started";
})()
"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    console = []
    out = {"console": console}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: console.append(
                {"wall": int(time.time() * 1000), "type": m.type,
                 "text": m.text[:400]}) if m.type in ("warning", "error") else None)
            pg.on("pageerror", lambda e: console.append(
                {"wall": int(time.time() * 1000), "type": "pageerror",
                 "text": str(e)[:1200]}))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate("() => SNOWFLOW.set('resolutionScale', 0.5)")
            pg.wait_for_timeout(1500)
            print("driver:", pg.evaluate(DRIVER), flush=True)
            t0 = time.time()
            shot_done = set()
            while True:
                time.sleep(10)
                st = pg.evaluate("() => ({n: window.__rc.rows.length, "
                                 "done: window.__rc.done, "
                                 "fatal: window.__rc.fatal, "
                                 "shot: window.__poseShot || null, "
                                 "tag: window.__rc.rows.length ? "
                                 "window.__rc.rows[window.__rc.rows.length-1].tag : ''})")
                if st["shot"] and st["shot"] not in shot_done:
                    shot_done.add(st["shot"])
                    pg.screenshot(path=str(HERE / ("pose_%s.png" % st["shot"])))
                    print("  (pose screenshot: %s)" % st["shot"], flush=True)
                print("  [%4ds] rows=%d last=%s" % (int(time.time() - t0),
                                                    st["n"], st["tag"]), flush=True)
                if st["done"] or time.time() - t0 > 35 * 60:
                    break
            out["rc"] = pg.evaluate("() => window.__rc")
            pg.screenshot(path=str(HERE / "soak_realmcycle_end.png"))
            br.close()
    finally:
        srv.terminate()
        OUT_JSON.write_text(json.dumps(out, indent=1), encoding="utf-8")
        print("wrote", OUT_JSON, flush=True)


if __name__ == "__main__":
    main()
