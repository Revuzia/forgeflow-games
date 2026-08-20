# -*- coding: utf-8 -*-
"""
qa_flinchgate.py -- does the WINDUP TELEGRAPH out-weigh the hit flinch?

meshEnemies.js drives the hit-flinch overlay (CL_HIT, clip slot 3) at a fixed
FLINCH_W = 0.3, while the attack action it is supposed to ride on is weighted
`max(clamp01(flash), lunge)`. Nothing in the file converts CL_HIT to an additive
clip -- no `makeClipAdditive`, no `blendMode` -- so both are NORMAL-blend actions
competing in the same mixer weight pool, and for the whole early telegraph
(flash < 0.3) the flinch was the heavier of the two: a body hit mid-windup
swallowed its own tell.

Three phases, on one live body, reading the mixer weights the renderer actually
set:

  T  TELEGRAPHING   flash=0.15, lunge=0, flinch=1
     PASS: CL_HIT weight ~0 and the attack action carries the pose.
  F  NOT WINDING UP flash=0,    lunge=0, flinch=1
     PASS: CL_HIT weight ramps to FLINCH_W (0.3) -- the recoil still reads.
  S  COMMITTED      flash=1,    lunge=1, flinch=1
     PASS: CL_HIT weight ~FLINCH_W -- once the strike is out, the flinch is
     back on top of the follow-through.

All waits are GAME time off the registry clock. Port 8911.
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
         "--disable-features=CalculateNativeWinOcclusion"]

CL_HIT = 3
SLOT = 23
FLINCH_W = 0.3

JS = r"""(async (key) => {
    const SF = SNOWFLOW, v = SF.combat.enemies.vis, c = SF.character;
    const reg = SF.combat.registry;
    const CL_HIT = 3;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res(true)
            : requestAnimationFrame(tick);
        tick();
    });

    const x = c.position.x, z = c.position.z - 5;
    const y = SF.terrain.heightAt(x, z);
    v.spawn(23, key, x, y, z);
    const inst = v._slotInst[23];
    if (!inst) return { err: "not bound" };
    if (!inst.mixer) return { err: "no mixer (bind-pose-only body)" };
    if (!inst.acts[CL_HIT]) return { err: "no hit clip in this role kit" };

    // The mixer only steps a slot inside SPLITS[0] and inside the per-frame
    // budget; give every phase enough GAME time for the manual weight ramp
    // (step = dt / FADE, FADE = 0.15 s) to reach its target several times over.
    const phase = async (label, flash, lunge, flinch) => {
        // Release any scrubbed attack first, so each phase enters clean.
        v.drive(23, x, y, z, 0, 0, 0, 0, 0, 0, 0);
        await gameWait(0.8);
        v.drive(23, x, y, z, 0, 0, flash, lunge, 0, 0, flinch);
        await gameWait(1.2);
        const atk = inst.atk;
        return {
            phase: label,
            drive: { flash: flash, lunge: lunge, flinch: flinch },
            atk: atk,
            striking: !!inst.striking,
            wHit: +inst.weights[CL_HIT].toFixed(4),
            tHit: +inst.targets[CL_HIT].toFixed(4),
            wAtk: atk >= 0 ? +inst.weights[atk].toFixed(4) : -1,
            tAtk: atk >= 0 ? +inst.targets[atk].toFixed(4) : -1,
            hitClip: inst.acts[CL_HIT].getClip().name,
            atkClip: atk >= 0 ? inst.acts[atk].getClip().name : "-",
            // Proof that CL_HIT is a normal-blend action, not additive: an
            // additive action reports THREE.AdditiveAnimationBlendMode (2501).
            hitBlendMode: inst.acts[CL_HIT].blendMode,
        };
    };

    const out = [];
    out.push(await phase("T telegraphing", 0.15, 0, 1));
    out.push(await phase("F not winding up", 0, 0, 1));
    out.push(await phase("S committed", 1, 1, 1));
    v.drive(23, x, y, z, 0, 0, 0, 0, 0, 0, 0);
    v.free(23);
    return { rows: out };
})"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)

    results = {}
    errs = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            for key in ("rimeImp", "glacierBrute"):
                results[key] = pg.evaluate(JS, key)
            br.close()
    finally:
        srv.terminate()

    out = Path(__file__).with_name("qa_flinchgate.out.json")
    out.write_text(json.dumps(results, indent=1), encoding="utf-8")

    ok = True
    for key, res in results.items():
        print("\n== %s" % key)
        if "err" in res:
            print("   ERROR:", res["err"])
            ok = False
            continue
        for r in res["rows"]:
            print("   %-18s atk=%-2d striking=%-5s  wHit=%-7s tHit=%-7s  "
                  "wAtk=%-7s tAtk=%-7s  blendMode=%s"
                  % (r["phase"], r["atk"], r["striking"], r["wHit"],
                     r["tHit"], r["wAtk"], r["tAtk"], r["hitBlendMode"]))
        by = {r["phase"][0]: r for r in res["rows"]}

        # T: the telegraph must own the pose. CL_HIT target must be 0 and the
        # attack must be the heavier of the two.
        t = by["T"]
        cond = (t["atk"] >= 0 and not t["striking"]
                and t["tHit"] == 0 and t["wHit"] < 0.02
                and t["wAtk"] > t["wHit"])
        print("   T gate: telegraph outweighs flinch -> %s"
              % ("PASS" if cond else "FAIL"))
        ok = ok and cond

        # F: with no windup in flight the recoil must still play, at FLINCH_W.
        f = by["F"]
        cond = (f["atk"] < 0 and abs(f["tHit"] - FLINCH_W) < 0.01
                and f["wHit"] > 0.25)
        print("   F gate: flinch still visible at FLINCH_W -> %s"
              % ("PASS" if cond else "FAIL"))
        ok = ok and cond

        # S: past the strike the flinch is allowed back on top.
        s = by["S"]
        cond = s["striking"] and s["tHit"] > 0.25
        print("   S gate: flinch returns after the strike -> %s"
              % ("PASS" if cond else "FAIL"))
        ok = ok and cond

    if errs:
        print("\nPAGE ERRORS:", json.dumps(errs[:4]))
        ok = False
    print("\nRESULT:", "PASS" if ok else "FAIL")
    print("wrote", out)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
