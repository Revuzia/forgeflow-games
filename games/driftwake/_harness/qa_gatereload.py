# -*- coding: utf-8 -*-
"""
qa_gatereload.py -- does a raised realm gate survive a PAGE RELOAD?

F3's director keeps its own `_gates` for the life of a run, so qa_bossfix
section B already proves a gate survives a realm change. It cannot survive a
RELOAD unless `progression.save()` carries the mirror `bossEncounters` writes
into `progression.bossGates` -- the hook this lane wired into
progression.js (save blob key + restore + constructor/newRun init).

A/B against ONE build, on the real save blob:

  ARM A  the blob is rewritten with `bossGates` DELETED -- byte-for-byte what
         the pre-hook `save()` produced, since it wrote a fixed key list.
  ARM B  the blob is put back verbatim, with `bossGates` present.

Both arms reload the page and then ask the director to re-enter cold
(`bosses.setRealm("cold")` -> `_restoreGate()` -> `_gateFor()`), and read the
portal. ARM A must come back gateless (the run-level soft-lock), ARM B must
re-raise the same gate at the same place with the same token.

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
OUT_JSON = HERE / "qa_gatereload.out.json"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

PRELUDE = r"""
const SF = globalThis.SNOWFLOW;
const reg = SF.combat.registry;
const B = SF.combat.bosses;
const P = SF.portal;
const Pr = SF.progression;

const frame = () => new Promise(r =>
    requestAnimationFrame(() => requestAnimationFrame(r)));
const gwait = (sec) => new Promise(res => {
    const t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res() : requestAnimationFrame(tick);
    tick();
});
async function forceBoss(kind, tries) {
    for (let t = 0; t < (tries || 60); t++) {
        if (B.spawnBoss(kind)) { await frame(); return true; }
        await gwait(0.4);
    }
    return false;
}
async function killBoss() {
    for (let k = 0; k < 400; k++) {
        const id = B.bossId, s = id > 0 ? reg.slot(id) : -1;
        if (s < 0) break;
        reg.damage(id, Math.max(50, reg.hpMax[s] * 0.3), {});
        await frame();
    }
    await frame(); await frame();
}
"""

# ---- phase 1: earn the gate, then report the blob the save produced --------
JS_EARN = PRELUDE + r"""
(async () => {
    B.clearBoss();
    await frame();
    if (!await forceBoss("realm")) return { err: "boss never emerged: " + B.lastRefusal };
    await frame();
    reg.damage(B.bossId, 1, {});
    await frame();
    await killBoss();
    const st = P.stats;
    const raw = localStorage.getItem("driftwake_save");
    const blob = raw ? JSON.parse(raw) : null;
    return {
        realm: B.realm,
        gate: { open: st.open, token: st.token,
                x: +st.x.toFixed(3), z: +st.z.toFixed(3) },
        liveMirror: Pr.bossGates ? JSON.parse(JSON.stringify(Pr.bossGates)) : null,
        blobHasKey: !!(blob && blob.bossGates),
        blobGates: blob ? blob.bossGates : null,
        blobKeys: blob ? Object.keys(blob).length : -1,
    };
})()"""

# ---- arm the NEXT load, at document-start ---------------------------------
# The blob cannot be rewritten from the running page and then reloaded: that
# page keeps autosaving until navigation, and its autosave writes the LIVE
# `bossGates` straight back over the edit (measured -- ARM A came back with the
# mirror intact and the gate up, which is the old page's save, not a restore).
# So the arm is selected through two private keys the game never touches, and
# the blob is rewritten by an init script that runs BEFORE any game code on the
# next load. `__arm` = "A" deletes the key (the pre-hook save); "B" writes the
# fixture back (the save this lane's hook now produces).
INIT = r"""
try {
    var arm = localStorage.getItem("__arm");
    if (arm) {
        var b = JSON.parse(localStorage.getItem("driftwake_save") || "{}");
        if (arm === "A") { delete b.bossGates; }
        else { b.bossGates = JSON.parse(localStorage.getItem("__fixture") || "{}"); }
        localStorage.setItem("driftwake_save", JSON.stringify(b));
        localStorage.setItem("__armApplied", arm + ":" + (b.bossGates ? "key" : "nokey"));
    }
} catch (e) {}
"""

JS_ARM = r"""((arg) => {
    localStorage.setItem("__arm", arg.arm);
    localStorage.setItem("__fixture", JSON.stringify(arg.gates || {}));
    return { arm: arg.arm, fixture: arg.gates || null };
})"""

JS_APPLIED = r"""(() => ({
    applied: localStorage.getItem("__armApplied"),
    blobHasKey: !!(JSON.parse(localStorage.getItem("driftwake_save") || "{}").bossGates),
}))()"""

# ---- phase 2: after the reload, ask the director for the gate --------------
JS_READ = PRELUDE + r"""
(async () => {
    const restored = Pr.bossGates ? JSON.parse(JSON.stringify(Pr.bossGates)) : null;
    // The public realm entry point the director exposes; it runs
    // `_restoreGate()` -> `_gateFor()`, which is the only reader of the mirror.
    B.setRealm("cold");
    await frame(); await frame();
    const st = P.stats;
    return {
        realm: B.realm,
        progressionGates: restored,
        directorOwnGates: B.stats.gates ? Object.keys(B.stats.gates) : null,
        portal: { open: st.open, token: st.token,
                  x: st.open ? +st.x.toFixed(3) : null,
                  z: st.open ? +st.z.toFixed(3) : null },
    };
})()"""


def boot(pg):
    pg.goto(GAME_URL, wait_until="domcontentloaded")
    pg.wait_for_function(
        "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime", timeout=180000)
    pg.wait_for_timeout(2500)


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.0)
    perrs = []
    out = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("pageerror", lambda e: perrs.append(str(e)[:400]))
            pg.add_init_script(INIT)

            boot(pg)
            earn = pg.evaluate(JS_EARN)
            out["earn"] = earn
            print("EARN", json.dumps(earn, indent=1), flush=True)
            if earn.get("err"):
                print("RESULT: FAIL (could not earn a gate)")
                return 1
            gates = earn["blobGates"] or earn["liveMirror"]

            # ---- ARM A: the pre-hook save ------------------------------
            print("\n---- ARM A  blob stripped of bossGates at document-start "
                  "(the pre-hook save)", flush=True)
            print("  armed:", json.dumps(pg.evaluate(
                JS_ARM, {"arm": "A", "gates": gates})), flush=True)
            boot(pg)
            print("  init script:", json.dumps(pg.evaluate(JS_APPLIED)),
                  flush=True)
            a = pg.evaluate(JS_READ)
            out["armA"] = a
            print("  ", json.dumps(a), flush=True)

            # ---- ARM B: the blob this lane's save() now writes ----------
            print("\n---- ARM B  bossGates written back at document-start "
                  "(the hook)", flush=True)
            print("  armed:", json.dumps(pg.evaluate(
                JS_ARM, {"arm": "B", "gates": gates})), flush=True)
            boot(pg)
            print("  init script:", json.dumps(pg.evaluate(JS_APPLIED)),
                  flush=True)
            b = pg.evaluate(JS_READ)
            out["armB"] = b
            print("  ", json.dumps(b), flush=True)
            br.close()
    finally:
        srv.terminate()

    g = out["earn"]["gate"]
    a, b = out["armA"], out["armB"]
    checks = {
        "save blob carries bossGates": out["earn"]["blobHasKey"],
        "ARM A: mirror empty after reload":
            not (a["progressionGates"] or {}),
        "ARM A: no gate re-raised (the old soft-lock)":
            not a["portal"]["open"],
        "ARM B: mirror restored after reload":
            bool((b["progressionGates"] or {}).get("cold")),
        "ARM B: gate re-raised": bool(b["portal"]["open"]),
        "ARM B: same token": b["portal"]["token"] == g["token"],
        "ARM B: same place":
            b["portal"]["open"]
            and abs((b["portal"]["x"] or 0) - g["x"]) < 0.01
            and abs((b["portal"]["z"] or 0) - g["z"]) < 0.01,
        "no page errors": not perrs,
    }
    print("\n" + "=" * 72)
    for k, v in checks.items():
        print("  %-46s %s" % (k, "PASS" if v else "FAIL"))
    print("=" * 72)
    if perrs:
        for e in perrs[:5]:
            print("  pageerror:", e)
    ok = all(checks.values())
    print("\nRESULT: %s" % ("PASS" if ok else "FAIL"))
    out["checks"] = checks
    out["pageerrors"] = perrs
    OUT_JSON.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print("wrote %s" % OUT_JSON)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
