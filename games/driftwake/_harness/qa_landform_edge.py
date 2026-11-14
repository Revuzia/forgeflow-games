# -*- coding: utf-8 -*-
"""
qa_landform_edge.py -- laneE verification, port 8874.

Two modes.

  python qa_landform_edge.py before
      Records the COLD-at-boot heightfield: 20 fixed sample points plus the
      400 m transect, into _harness/qa_landform_baseline.json. Run this on the
      PRE-CHANGE tree; the AFTER run compares against it and any drift on the
      cold points is a failure.

  python qa_landform_edge.py            (default: after)
      1. transect  -- the same fixed 400 m line sampled in cold / sand / ash.
                      RMS delta between every realm pair must exceed 2 m.
      2. cold-hold -- the 20 fixed points, compared byte-for-byte against the
                      recorded baseline.
      3. seating   -- six realm switches; after each, |character.y - heightAt|
                      must fall under 1.0 m within one second of GAME time.
      4. edge      -- walks the player at the play-area clamp and samples the
                      fog uniform, the drawn weather particle count and
                      terrain.edgePush() across the last 120 m.
      5. shots     -- the storm wall in cold and in ash.

Game-time waits only (SNOWFLOW.combat.registry.time + rAF); no wall sleeps for
game state.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[3]
PORT = 8874
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

BASELINE = HERE / "qa_landform_baseline.json"
OUT = HERE / "qa_landform_edge.out.json"

# --------------------------------------------------------------- shared JS

# 20 fixed points, spread over the playable disc, never on the origin.
PTS = """[[0,0],[40,0],[0,40],[-40,0],[0,-40],[120,80],[-120,80],[120,-80],
 [-120,-80],[250,250],[-250,250],[250,-250],[-250,-250],[400,120],[-400,120],
 [120,400],[120,-400],[520,0],[0,520],[-370,-370]]"""

# A fixed 400 m line: 81 samples at 5 m spacing, offset off both axes so it
# crosses dunes rather than running along one.
TRANSECT = """(() => { const o = []; for (let i = 0; i <= 80; i++) {
    const t = -200 + i * 5; o.push([t * 0.94 + 60, t * 0.34 - 90]); } return o; })()"""

SAMPLE_JS = f"""(() => {{
    const T = SNOWFLOW.terrain;
    const pts = {PTS};
    const tr = {TRANSECT};
    return {{
        realm: T.realmName,
        pts: pts.map(p => T.heightAt(p[0], p[1])),
        transect: tr.map(p => T.heightAt(p[0], p[1])),
        minH: T.heightfield.minHeight,
        maxH: T.heightfield.maxHeight,
    }};
}})()"""


def rms(a, b):
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    return (sum((a[i] - b[i]) ** 2 for i in range(n)) / n) ** 0.5


def boot(pw):
    br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.goto(GAME_URL, wait_until="domcontentloaded")
    pg.wait_for_function(
        "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime", timeout=180000)
    pg.wait_for_timeout(2500)
    return br, pg


# Wait for N frames of GAME time, then read the sample block back.
ENTER_JS = """(async (name) => {
    const SF = SNOWFLOW, reg = SF.combat.registry;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const y0 = SF.character.position.y;
    await SF.enterRealm(name);
    // the re-bake lands inside terrain.update(); give it game frames, not ms
    await gameWait(0.25);
    const seatT = [];
    for (let i = 0; i < 4; i++) {
        await gameWait(0.25);
        const c = SF.character.position;
        seatT.push(+Math.abs(c.y - SF.terrain.heightAt(c.x, c.z)).toFixed(3));
    }
    const c = SF.character.position;
    return {
        realm: SF.terrain.realmName,
        yBefore: +y0.toFixed(2),
        y: +c.y.toFixed(2),
        ground: +SF.terrain.heightAt(c.x, c.z).toFixed(2),
        seatT,
        rebakes: SF.terrain.rebakeCount,
    };
})(REALM)"""


def main():
    from playwright.sync_api import sync_playwright

    mode = (sys.argv[1] if len(sys.argv) > 1 else "after").lower()

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    try:
        with sync_playwright() as pw:
            br, pg = boot(pw)
            if mode == "before":
                base = pg.evaluate(SAMPLE_JS)
                BASELINE.write_text(json.dumps(base, indent=1), encoding="utf-8")
                print(f"BASELINE realm={base['realm']} "
                      f"relief=[{base['minH']:.2f},{base['maxH']:.2f}] "
                      f"-> {BASELINE.name}")
                for i, v in enumerate(base["pts"]):
                    print(f"  p{i:02d} {v!r}")
                br.close()
                return
            run_after(pg)
            br.close()
    finally:
        srv.terminate()


def run_after(pg):
    res = {}
    ok = []

    # ---------------------------------------------------- 1. cold hold + transect
    cold = pg.evaluate(SAMPLE_JS)
    base = json.loads(BASELINE.read_text(encoding="utf-8"))
    drift = [i for i in range(len(base["pts"]))
             if base["pts"][i] != cold["pts"][i]]
    res["coldHold"] = {
        "points": len(base["pts"]), "drifted": len(drift),
        "maxAbsDelta": max(abs(base["pts"][i] - cold["pts"][i])
                           for i in range(len(base["pts"]))),
        "relief": [cold["minH"], cold["maxH"]],
        "baselineRelief": [base["minH"], base["maxH"]],
    }
    ok.append(("cold byte-identical at boot", len(drift) == 0))
    print(f"[1] cold-hold  drifted {len(drift)}/{len(base['pts'])} points, "
          f"max |delta| = {res['coldHold']['maxAbsDelta']:.9f} m")

    # ---------------------------------------------------- 2. per-realm transects
    tr = {"cold": cold["transect"]}
    seat = {}
    order = ["sand", "ash", "cold", "ash", "sand", "cold"]
    for i, name in enumerate(order):
        seat[f"{i}:{name}"] = pg.evaluate(ENTER_JS.replace("REALM", f"'{name}'"))
        s = pg.evaluate(SAMPLE_JS)
        tr[name] = s["transect"]
        res.setdefault("relief", {})[name] = [round(s["minH"], 2),
                                              round(s["maxH"], 2)]
    res["transectRms"] = {}
    print("[2] transect RMS delta between realms (m):")
    for a, b in (("cold", "sand"), ("cold", "ash"), ("sand", "ash")):
        v = rms(tr[a], tr[b])
        res["transectRms"][f"{a}-{b}"] = round(v, 3)
        ok.append((f"transect {a} vs {b} > 2 m", v > 2.0))
        print(f"    {a:5s} vs {b:5s}  {v:7.3f}   relief {res['relief'].get(a)} "
              f"/ {res['relief'].get(b)}")

    # ---------------------------------------------------- 3. seating
    res["seating"] = seat
    worst = 0.0
    for k, v in seat.items():
        worst = max(worst, v["seatT"][-1])
        print(f"[3] switch {k:8s} y {v['yBefore']:7.2f} -> {v['y']:7.2f} "
              f"ground {v['ground']:7.2f}  |dy| over 1 s {v['seatT']}")
    ok.append(("character re-seated < 1.0 m within 1 s", worst < 1.0))
    res["worstSeatError"] = worst

    # ---------------------------------------------------- 3b. realm data invariants
    inv = pg.evaluate("""(() => ({
        schema: SNOWFLOW.realms.realmSchemaDiff(),
        landform: SNOWFLOW.realms.landformCheck(),
    }))()""")
    res["invariants"] = inv
    ok.append(("realm schema symmetric", len(inv["schema"]) == 0))
    ok.append(("landform.heightScale == wind.macroHeightScale",
               len(inv["landform"]) == 0))
    print(f"[3b] realmSchemaDiff {inv['schema']}  landformCheck {inv['landform']}")

    # ---------------------------------------------------- 3c. the ground, per realm
    # The owner's complaint was that a realm switch did not change the shape of
    # the world. One framing, three realms, same camera.
    for realm in ("cold", "sand", "ash"):
        pg.evaluate(ENTER_JS.replace("REALM", f"'{realm}'"))
        pg.evaluate(SHOT_JS)
        pg.wait_for_timeout(1400)
        pg.screenshot(path=str(HERE / f"landform_ground_{realm}.png"))
        print(f"[3c] shot -> landform_ground_{realm}.png")

    # ---------------------------------------------------- 4. edge
    for realm in ("cold", "ash"):
        pg.evaluate(ENTER_JS.replace("REALM", f"'{realm}'"))
        rows = pg.evaluate(EDGE_JS)
        res.setdefault("edge", {})[realm] = rows
        fogs = [r["fog"] for r in rows]
        mono = all(fogs[i] <= fogs[i + 1] + 1e-9 for i in range(len(fogs) - 1))
        cnt0, cnt1 = rows[0]["wx"], rows[-1]["wx"]
        push_far = rows[0]["push"]
        push_near = rows[-1]["push"]
        ratio = (cnt1 / cnt0) if cnt0 else 0
        ok.append((f"{realm}: fog ramps monotonically", mono))
        ok.append((f"{realm}: particle count ~triples", ratio > 2.7))
        ok.append((f"{realm}: edgePush 0 at 100 m", push_far == 0))
        ok.append((f"{realm}: edgePush > 0 in last 30 m", push_near > 0))
        print(f"[4] {realm}: fog {fogs[0]:.5f} -> {fogs[-1]:.5f} mono={mono}  "
              f"weather {cnt0} -> {cnt1} (x{ratio:.2f})  "
              f"push {push_far} -> {push_near:.3f}")
        for r in rows:
            print(f"      d={r['d']:5.1f} m  fog {r['fog']:.5f}  "
                  f"wx {r['wx']:5d}  push {r['push']:.3f}  edge01 {r['e']:.3f}")
        pg.wait_for_timeout(1200)
        pg.screenshot(path=str(HERE / f"landform_stormwall_{realm}.png"))
        print(f"    shot -> landform_stormwall_{realm}.png")

    # ---------------------------------------------------- verdict
    print("\n--- checks ---")
    bad = 0
    for name, good in ok:
        print(f"  {'OK  ' if good else 'FAIL'}  {name}")
        bad += 0 if good else 1
    res["checks"] = [{"name": n, "ok": bool(g)} for n, g in ok]
    res["failed"] = bad
    OUT.write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(f"\n{'ALL OK' if bad == 0 else str(bad) + ' FAILED'} -> {OUT.name}")


# The clean-frame recipe: one fixed camera over one fixed patch of ground, so
# the three realm shots differ only by the landform.
SHOT_JS = """(() => {
    const SF = SNOWFLOW, T = SF.terrain;
    SF.character.position.x = 150;
    SF.character.position.z = 150;
    SF.character.position.y = T.heightAt(150, 150);
    SF.rig.yaw = 0;
    SF.rig.distanceTarget = 7;
    return T.realmName;
})()"""

# Walk the player out to the clamp along +X, sampling the storm band.
EDGE_JS = """(async () => {
    const SF = SNOWFLOW, reg = SF.combat.registry, T = SF.terrain;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const R = T.playRadius;
    const out = [];
    // distances INSIDE the clamp, from 120 m out to hard against it
    for (const d of [120, 100, 80, 60, 40, 30, 20, 10, 2]) {
        const r = R - d;
        SF.character.position.x = r;
        SF.character.position.z = 0;
        SF.character.position.y = T.heightAt(r, 0);
        SF.rig.yaw = Math.PI / 2;      // look outward, down +X
        await gameWait(0.35);
        const p = T.edgePush(SF.character.position.x, SF.character.position.z);
        out.push({
            d,
            fog: +SF.sky.uniforms.uFog.value.x.toFixed(6),
            wx: SF.weather.count,
            push: +Math.hypot(p.fx, p.fz).toFixed(3),
            e: +T.edge01(SF.character.position.x, SF.character.position.z)
                .toFixed(3),
        });
    }
    return out;
})()"""


if __name__ == "__main__":
    main()
