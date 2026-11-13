# -*- coding: utf-8 -*-
"""
qa_soak_instcap_8894.py -- drive `meshEnemies._insts` to the INSTANCE_MAX wall.

The long soak reached 31 retained body instances of the 40 cap after visiting
each realm once; the two-lap probe reached 33 and was still climbing. This
walks the realm ring (cold -> sand -> ash -> cold) repeatedly with a short
fight in each realm so the director actually spawns bodies, and reports the
instance count after every leg.

The failure it is looking for is meshEnemies.js:967-971 --

    if (this._insts.length >= INSTANCE_MAX) {
        console.warn("meshEnemies: INSTANCE_MAX reached; " + type.slug +
            " spawned without a body");
        return null;

-- i.e. an enemy that spawns with no visible body. Console warnings are
captured, so the warning firing IS the observation.
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
OUT_JSON = HERE / "qa_soak_instcap_8894.out.json"

DRIVER = r"""
(() => {
const S = SNOWFLOW, reg = S.combat.registry, I = S.input, ch = S.character;
const en = S.combat.enemies, vis = en.vis;
const R = window.__cap = { rows: [], done: false, fatal: null, stalls: 0 };
I.locked = true;

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

function row(tag) {
    let live = 0;
    for (let i = 0; i < vis._insts.length; i++) if (vis._insts[i].live) live++;
    let objs = 0; S.scene.traverse(() => objs++);
    const m = performance.memory;
    // Per-type instance census: which bodies are hoarding the pool.
    const byType = {};
    vis._types.forEach((t, k) => {
        if (t.insts && t.insts.length) byType[k] = t.insts.length;
    });
    R.rows.push({
        tag, realm: S.combat.encounters.realm,
        insts: vis._insts.length, live, types: vis._types.size,
        byType, sceneObjs: objs,
        heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(2) : null,
        geo: S.renderer.info.memory.geometries,
        tex: S.renderer.info.memory.textures,
        enAlive: (() => { let n = 0;
            for (let i = 0; i < en.alive.length; i++) if (en.alive[i]) n++;
            return n; })(),
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
        } else { look(200); }
        tap(CAST[i % CAST.length]);
        i++;
        await wait(0.5);
    }
    mouse("mouseup", 0);
    key("KeyW", false);
}

(async () => {
try {
    row("BASELINE");
    // Six laps of the realm ring. `enterRealm` directly: this is exactly what
    // the realm portal calls (main.js wires portal.onEnter -> enterRealm), so
    // it is the player's own path, just without the walk to the gate.
    const RING = ["sand", "ash", "cold"];
    for (let lap = 0; lap < 6; lap++) {
        for (let r = 0; r < RING.length; r++) {
            await SNOWFLOW.enterRealm(RING[r]);
            await wait(6);
            row("lap" + lap + ":enter:" + RING[r]);
            await fight(22);
            row("lap" + lap + ":fought:" + RING[r]);
            if (vis._insts.length >= 40) {
                R.hitCap = { lap, realm: RING[r], insts: vis._insts.length };
            }
        }
    }
    row("FINAL");
} catch (e) { R.fatal = String((e && e.stack) || e); }
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
    warns = []
    out = {"warns": warns}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: warns.append(
                {"wall": int(time.time() * 1000), "type": m.type,
                 "text": m.text[:300]}) if m.type in ("warning", "error") else None)
            pg.on("pageerror", lambda e: warns.append(
                {"wall": int(time.time() * 1000), "type": "pageerror",
                 "text": str(e)[:800]}))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate("() => SNOWFLOW.set('resolutionScale', 0.5)")
            pg.wait_for_timeout(1000)
            print("driver:", pg.evaluate(DRIVER), flush=True)
            t0 = time.time()
            seen = 0
            while True:
                time.sleep(10)
                st = pg.evaluate("""() => {
                    const c = window.__cap, r = c.rows[c.rows.length - 1] || {};
                    return { n: c.rows.length, done: c.done, fatal: c.fatal,
                             tag: r.tag || '', insts: r.insts, live: r.live,
                             hitCap: c.hitCap || null };
                }""")
                if st["n"] != seen:
                    seen = st["n"]
                    print("  [%4ds] %-22s insts=%s live=%s%s"
                          % (int(time.time() - t0), st["tag"], st["insts"],
                             st["live"],
                             "  *** CAP HIT ***" if st["hitCap"] else ""),
                          flush=True)
                if st["done"] or time.time() - t0 > 30 * 60:
                    break
            out["cap"] = pg.evaluate("() => window.__cap")
            br.close()
    finally:
        srv.terminate()
        OUT_JSON.write_text(json.dumps(out, indent=1), encoding="utf-8")
        print("\nconsole warnings/errors: %d" % len(warns), flush=True)
        for w in warns[:25]:
            print("   [%s] %s" % (w["type"], w["text"]), flush=True)
        print("wrote", OUT_JSON, flush=True)


if __name__ == "__main__":
    main()
