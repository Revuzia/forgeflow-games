# -*- coding: utf-8 -*-
"""
qa_feel_verify.py -- re-runs the enemybars TAB-caret repro against the fixed
src/ui/enemybars.js, and answers the open flinch-overlay question (is the
CL_HIT clip actually present on a fodder body, and does it gain weight over a
scrubbed windup?).
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8893
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

HELP = """
    const S = SNOWFLOW, reg = S.combat.registry, en = S.combat.enemies;
    const c = S.character, motes = S.motes, bars = S.enemyBars;
    const waitFrames = (n) => new Promise(res => {
        let k = 0;
        const f = () => (++k >= n) ? res() : requestAnimationFrame(f);
        requestAnimationFrame(f);
    });
    const clearField = async () => {
        for (let i = reg.count - 1; i >= 0; i--) en.despawn(reg.idOf[i]);
        motes.clear();
        await waitFrames(2);
    };
    const tgtBars = () => {
        const on = [];
        for (let i = 0; i < bars._bar.length; i++)
            if (bars._bar[i].classList.contains('tgt')) on.push(i);
        return on;
    };
    const slotOfId = (id) => {
        for (let i = 0; i < bars._id.length; i++) if (bars._id[i] === id) return i;
        return -1;
    };
"""

BARS = """(async () => {
""" + HELP + """
    const out = {};
    await clearField();
    S.input.locked = true;
    c.health = c.healthMax;
    const realTargeting = bars.targeting;
    const fake = { targetId: -1 };
    bars.targeting = fake;
    await waitFrames(3);

    const idA = en.spawn(0, c.position.x + 8, c.position.z + 1, 10);
    await waitFrames(2); reg.damage(idA, 1, {}); await waitFrames(3);
    const idB = en.spawn(0, c.position.x + 8, c.position.z - 1, 10);
    await waitFrames(2); reg.damage(idB, 1, {}); await waitFrames(3);
    out.slots = { A: slotOfId(idA), B: slotOfId(idB) };

    fake.targetId = idB;  await waitFrames(3);
    out.afterSelectB = { tgtBars: tgtBars(), cache: Array.from(bars._isTgt) };
    fake.targetId = idA;  await waitFrames(3);
    out.afterRetargetToA = { tgtBars: tgtBars(), expected: [out.slots.A],
                             cache: Array.from(bars._isTgt) };

    reg.damage(idB, 999999, {});
    for (let k = 0; k < 300; k++) {
        await waitFrames(1);
        if (reg.slot(idB) < 0) break;
    }
    await waitFrames(4);
    out.afterBDies = { tgtBars: tgtBars(), barSlotB: slotOfId(idB) };
    const idC = en.spawn(0, c.position.x + 9, c.position.z + 3, 10);
    await waitFrames(2); reg.damage(idC, 1, {}); await waitFrames(4);
    out.afterCClaims = { tgtBars: tgtBars(), slotC: slotOfId(idC),
                         slotA: slotOfId(idA), expected: [slotOfId(idA)] };

    // and the ordinary direction (LOW -> HIGH) still works
    fake.targetId = idC; await waitFrames(3);
    out.afterRetargetToC = { tgtBars: tgtBars(), expected: [slotOfId(idC)] };
    fake.targetId = -1;  await waitFrames(3);
    out.afterDeselect = { tgtBars: tgtBars(), expected: [] };

    bars.targeting = realTargeting;
    await clearField();
    return out;
})()"""

FLINCH = """(async () => {
""" + HELP + """
    const out = {};
    await clearField();
    S.input.locked = true;
    c.health = c.healthMax;
    const id = en.spawn(0, c.position.x + 2.2, c.position.z, 10);
    await waitFrames(3); reg.damage(id, 1, {}); await waitFrames(4);
    let idx = -1;
    for (let i = 0; i < en.alive.length; i++)
        if (en.alive[i] && en.id[i] === id) idx = i;
    const vis = en.vis;
    const inst = vis && vis._slotInst ? vis._slotInst[idx] : null;
    out.body = {
        unit: en.units[en.unitOf[idx]].name,
        hasInst: !!inst,
        clipNames: inst && inst.acts
            ? inst.acts.map(a => a ? a.getClip().name : null) : null,
        CL_HIT_present: !!(inst && inst.acts && inst.acts[3]),
    };
    // hit it hard enough to arm flinchT (>= 20) with no poise break, then
    // watch the CL_HIT weight and the drive channel for a few frames.
    reg.hp[reg.slot(id)] = reg.hpMax[reg.slot(id)] * 500;
    reg.damage(id, 25, {});
    const trace = [];
    for (let k = 0; k < 6; k++) {
        await waitFrames(1);
        trace.push({
            f: k,
            flinchT: +en.flinchT[idx].toFixed(3),
            driveFlinch: vis.flinch ? +vis.flinch[idx].toFixed(3) : null,
            state: en.state[idx],
            flash: +en.flash[idx].toFixed(3),
            w: inst && inst.weights
                ? Array.from(inst.weights).map(v => +v.toFixed(3)) : null,
        });
    }
    out.trace = trace;
    await clearField();
    return out;
})()"""


def main():
    from playwright.sync_api import sync_playwright
    import time as _t

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        _t.sleep(2.5)
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            for label, js in (("BARS (post-fix)", BARS), ("FLINCH", FLINCH)):
                print("\n=========== %s ===========" % label)
                try:
                    print(json.dumps(pg.evaluate(js), indent=1))
                except Exception as ex:  # noqa: BLE001
                    print("  EVAL FAILED:", ex)
            if errs:
                print("\n!! page errors:", errs[:6])
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
