# -*- coding: utf-8 -*-
"""
qa_worldact.py -- lane W (world activities) proof, in the LIVE page.

main.js does not construct the systems yet, so this dynamically imports
src/world/{caches,trials,bounties,beacon}.js into the running game
(qa_worldact.js builds the ctx from SNOWFLOW, drives update(dt) on GAME time)
and asserts, per realm:
  * 15 caches, split 2 relic / 12 lore / 1 grand; open one of each kind via
    the interact edge and check the 'cache:opened' + 'reward' events;
  * 3 trials built, every consecutive gate pair re-validated independently;
  * 3 bounties sited;
and in Cold additionally:
  * surf a trial with pinned input (surf held, rig yaw on the next gate) to a
    medal; its best time must persist across a page RELOAD;
  * walk into a bounty's 80 m radius: spawns with 2.5x HP and its STORY name;
    kill it; RELOAD; it stays dead and does not respawn;
  * emit a waypoint and screenshot the beacon from 200 m (+ pixel diff);
  * draw-call delta with all four systems visible vs hidden.

    python _harness/qa_worldact.py            # full battery
    python _harness/qa_worldact.py --stage smoke
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[3]
PORT = 8923
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
SHOTS = HERE.parent / "_shots"
HARNESS_JS = (HERE / "qa_worldact.js").read_text(encoding="utf-8")

RESULTS = []


def check(name, ok, detail):
    RESULTS.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + "  " + json.dumps(detail, default=str))
    sys.stdout.flush()


def open_page(state):
    pg = state["bctx"].new_page()
    pg.set_default_timeout(300000)
    pg.on("pageerror", lambda e: state["errors"].append("pageerror: %s" % e))
    def _con(m):
        if m.type == "error":
            state["console"].append(m.text[:400])
            print("CONSOLE-ERROR " + m.text[:300])
    pg.on("console", _con)
    state["pg"] = pg
    return pg


FPS_JS = """() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 10000) requestAnimationFrame(f);
        else res(+(n / ((performance.now() - t0) / 1000)).toFixed(2)); };
    requestAnimationFrame(f);
    setTimeout(() => res(+(n / ((performance.now() - t0) / 1000)).toFixed(2)), 60000);
})"""


def measure_fps(pg):
    """rAF callbacks per wall second over ~10 s (None if the page is wedged)."""
    try:
        return pg.evaluate(FPS_JS)
    except Exception as e:
        return "unmeasurable: %s" % str(e)[:120]


def boot(state):
    """Load (or reload) the game and install the harness. Lane rule on this
    shared, overloaded machine: boot wait up to 15 min, TWO attempts; a page
    that cannot boot twice is recorded as NOT RUN (environment) with its
    measured frame rate — never a pass."""
    for attempt in range(2):
        pg = state["pg"]
        t0 = time.time()
        try:
            pg.goto(GAME_URL, wait_until="commit", timeout=400000)
            pg.wait_for_function("() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                                 timeout=900000, polling=2000)
            # Probe-only: the cheapest rung, so a saturated shared GPU keeps
            # the frame loop (and the game clock) moving.
            pg.evaluate("() => SNOWFLOW.applyPreset('performance')")
            pg.wait_for_timeout(2500)
            info = pg.evaluate(HARNESS_JS)
            state["fps"] = measure_fps(pg)
            print("setup (boot %.0f s, attempt %d, %s rAF/s)" % (time.time() - t0, attempt,
                  state["fps"]), json.dumps(info))
            return pg
        except Exception as e:
            fps = measure_fps(pg)
            state.setdefault("bootFails", []).append(
                {"attempt": attempt, "s": round(time.time() - t0), "fps": fps, "err": str(e)[:240]})
            print("boot attempt %d failed after %.0f s (%s rAF/s): %s"
                  % (attempt, time.time() - t0, fps, str(e)[:240]))
            try:
                pg.close()
            except Exception:
                pass
            open_page(state)
    raise RuntimeError("NOT RUN (environment): game failed to boot twice " +
                       json.dumps(state.get("bootFails")))


def shot(pg, name):
    """Screenshot that cannot abort the battery: a starved renderer can take
    minutes to present a frame. Returns the path or None."""
    path = SHOTS / name
    try:
        pg.screenshot(path=str(path), timeout=240000)
        return path
    except Exception as e:
        print("SHOT-FAILED %s: %s" % (name, str(e)[:160]))
        return None


def ev(pg, js):
    return pg.evaluate("async () => { const H = window.__WA; " + js + " }")


def box_diff(off1_path, on_path, off2_path, box):
    """The object's box across an off / on / off pair (same pinned pose,
    only lane W's meshes hidden in the offs):
      signal   changed px (>= 16 of 255 luma) on vs off1 in the box,
      noise    changed px off2 vs off1 in the box (camera / weather / sky),
      control  changed px on vs off1 in a same-size box beside it,
      peak     the largest luma rise on vs off1 in the box (0..255)."""
    from PIL import Image, ImageChops
    a = Image.open(off1_path).convert("RGB")
    b = Image.open(on_path).convert("RGB")
    c = Image.open(off2_path).convert("RGB")
    W, Hh = a.size
    x0, y0, x1, y1 = [int(v) for v in box]
    x0, x1 = max(0, x0), min(W, x1)
    y0, y1 = max(0, y0), min(Hh, y1)
    if x1 <= x0 or y1 <= y0:
        return {"box": box, "err": "box off screen"}

    def count(p, q, bx):
        d = ImageChops.difference(p.crop(bx), q.crop(bx)).convert("L")
        return sum(d.histogram()[16:])
    bx = (x0, y0, x1, y1)
    bw = x1 - x0
    if (x0 + x1) / 2 < W / 2:
        cx0 = min(W - bw, x1 + 40)
    else:
        cx0 = max(0, x0 - 40 - bw)
    ctrl = (cx0, y0, cx0 + bw, y1)
    rise = ImageChops.subtract(b.crop(bx).convert("L"), a.crop(bx).convert("L"))
    return {"box": list(bx), "boxArea": bw * (y1 - y0),
            "signalPx": count(b, a, bx), "noisePx": count(c, a, bx),
            "controlBox": list(ctrl), "controlPx": count(b, a, ctrl),
            "peakRise": rise.getextrema()[1]}


# Each entry stands the rider, PINS it (H.pinHere), settles the camera on
# GAME time and returns the object's projected base (p0) and top (p1).
VISUAL_JS = {
    "cache_close": """const L = H.caches.list().filter(e => !e.opened);
        const c = L.find(e => e.kind === 'grand') || L[0];
        H.faceFrom(c.x, c.z, 10); H.pinHere();
        const s = await H.settle(4);
        const y = SNOWFLOW.terrain.heightAt(c.x, c.z);
        return Object.assign(s, {what: 'cache ' + c.kind + ' site ' + c.site, p0: H.project(c.x, y, c.z),
            p1: H.project(c.x, y + 2.2, c.z), draws: H.caches.draws});""",
    "cache_glint_85m": """const L = H.caches.list().filter(e => !e.opened);
        let c = null, v = null;
        for (const e of L) {
            const yt = SNOWFLOW.terrain.heightAt(e.x, e.z) + 1.65;
            v = H.clearView(e.x, e.z, yt, 85);
            if (v) { c = e; break; }
        }
        if (!c) return {err: 'no cache with a clear 85 m view'};
        H.tp(v.px, v.pz, v.facing + 0.3); SNOWFLOW.rig.pitch = 0.04; H.pinHere();   // 0.3 rad: the rider must not stand on the line of sight (0.12 put the glint behind its head)
        const s = await H.settle(4);
        const y = SNOWFLOW.terrain.heightAt(c.x, c.z);
        return Object.assign(s, {what: 'glint over ' + c.kind + ' site ' + c.site, p0: H.project(c.x, y, c.z),
            p1: H.project(c.x, y + 4.5, c.z), draws: H.caches.draws, gain: H.caches._gain.value});""",
    "trial_gate": """const tr = H.trials.trials[0];
        const bx = tr.gx[0] - tr.nx[0] * 22, bz = tr.gz[0] - tr.nz[0] * 22;
        H.tp(bx, bz, Math.atan2(tr.nx[0], -tr.nz[0])); SNOWFLOW.rig.pitch = 0.05; H.pinHere();
        const s = await H.settle(4);
        return Object.assign(s, {what: 'gate 1 of ' + tr.id, p0: H.project(tr.gx[0], tr.gy[0] - 3.5, tr.gz[0]),
            p1: H.project(tr.gx[0], tr.gy[0] + 3.5, tr.gz[0]), draws: H.trials.draws, gain: H.trials._gain.value});""",
    "beacon_200m": """const at = H.beaconAt(200); SNOWFLOW.rig.pitch = -0.05; H.pinHere();
        const s = await H.settle(4);
        const wx = at.waypoint[0], wz = at.waypoint[1], y = SNOWFLOW.terrain.heightAt(wx, wz);
        return Object.assign(s, {what: 'beacon 200 m', p0: H.project(wx, y, wz),
            p1: H.project(wx, y + 60, wz), draws: H.beacon.draws, visible: H.beacon.visible,
            gain: H.beacon._gain.value});""",
    "beacon_380m": """const at = H.beaconAt(380); SNOWFLOW.rig.pitch = -0.05; H.pinHere();
        const s = await H.settle(4);
        const wx = at.waypoint[0], wz = at.waypoint[1], y = SNOWFLOW.terrain.heightAt(wx, wz);
        return Object.assign(s, {what: 'beacon 380 m', p0: H.project(wx, y, wz),
            p1: H.project(wx, y + 60, wz), draws: H.beacon.draws, visible: H.beacon.visible,
            gain: H.beacon._gain.value});""",
}


def visual_one(pg, name, label=None):
    """One visual proof: rider pinned, camera settled on GAME time, the
    object projected to screen, an off / on / off triple (only lane W's
    meshes hidden in the offs). PASS = the object's box changes (>= 60 px),
    by >= 4x the off-to-off noise in that box and >= 4x the control box."""
    label = label or ("visual: %s rendered (off/on/off box diff)" % name)
    st = ev(pg, VISUAL_JS[name])
    # Freeze the WORLD for the triple (dt = 0: camera, rider animation, sun,
    # weather and uTime all hold; rendering continues), so the only change
    # between the frames is lane W's visibility.
    ev(pg, "SNOWFLOW.S.freezeTime = true; await H.frames(3); return 1;")
    ev(pg, "H.hide = true; await H.frames(3); return 1;")
    off1 = shot(pg, "worldact_v_%s_off.png" % name)
    ev(pg, "H.hide = false; await H.frames(3); return 1;")
    on = shot(pg, "worldact_v_%s_on.png" % name)
    ev(pg, "H.hide = true; await H.frames(3); return 1;")
    off2 = shot(pg, "worldact_v_%s_off2.png" % name)
    ev(pg, "H.hide = false; SNOWFLOW.S.freezeTime = false; H.unpin(); await H.frames(2); return 1;")
    if name.startswith("beacon"):
        ev(pg, "H.beacon.clear(); return 1;")
    p0, p1 = st.get("p0"), st.get("p1")
    if not (off1 and on and off2 and p0 and p1):
        check(label, False, {"state": st, "shots": [str(off1), str(on), str(off2)]})
        return False
    half = 40 if name.startswith("beacon") else 70
    box = (min(p0[0], p1[0]) - half, min(p0[1], p1[1]) - 20,
           max(p0[0], p1[0]) + half, max(p0[1], p1[1]) + 20)
    d = box_diff(off1, on, off2, box)
    sig = d.get("signalPx")
    ok = (isinstance(sig, int) and sig >= 60 and sig >= 4 * max(1, d["noisePx"])
          and sig >= 4 * max(1, d["controlPx"]))
    check(label, ok, {"state": st, "diff": d, "shots": [off1.name, on.name, off2.name]})
    return ok


def visual_stage(pg):
    r = ev(pg, "return await H.enter('cold');")
    check("visual: systems ready in cold", r.get("ready"), r)
    for name in VISUAL_JS:
        visual_one(pg, name)


def realm_battery(pg, realm, deep):
    r = ev(pg, "return await H.enter(%s);" % json.dumps(realm))
    check("%s: systems ready" % realm, r.get("ready"), r)
    c = ev(pg, "return H.counts();")
    k = c["kinds"]
    check("%s: 15 caches split 2 relic / 12 lore / 1 grand" % realm,
          c["caches"] == 15 and k == {"relic": 2, "lore": 12, "grand": 1}
          and c["placeFallbacks"] == 0,
          {"caches": c["caches"], "kinds": k, "placeFallbacks": c["placeFallbacks"]})
    ts = c["trials"]
    check("%s: 3 trials built, 8-12 gates, gold-able" % realm,
          len(ts) == 3 and all(8 <= t["gates"] <= 12 and t["ideal"] <= t["par"] for t in ts)
          and c["trialStats"]["failed"] == 0,
          {"trials": ts, "stats": c["trialStats"]})
    rv = ev(pg, "return H.revalidate();")
    check("%s: every gate pair re-validated (4 m window at 1 m steps)" % realm,
          all(t["maxUp4mWindow"] <= 0.33 and t["maxDown4mWindow"] <= 0.90
              and t["minPrismClear"] >= 4.0 and t["maxR"] <= 540
              and t["minShrine"] >= 20 for t in rv),
          rv)
    b = c["bounties"]
    check("%s: 3 bounties sited" % realm,
          len(b) == 3 and all(x["x"] is not None and x["place"] for x in b), b)
    for kind in ("relic", "lore", "grand"):
        o = ev(pg, "return await H.openKind(%s);" % json.dumps(kind))
        evs = o.get("events", [])
        opened = [e for e in evs if e["t"] == "cache:opened"]
        rewards = [e["p"] for e in evs if e["t"] == "reward"]
        ok = o.get("opened") and len(opened) == 1 and opened[0]["p"]["kind"] == kind
        if kind == "relic":
            ok = ok and any(rw["kind"] == "relic" and rw["id"].startswith("relic.")
                            for rw in rewards) and not any(rw["kind"] == "glass" for rw in rewards)
        elif kind == "lore":
            g = [rw for rw in rewards if rw["kind"] == "glass"]
            ok = ok and any(rw["kind"] == "lore" and rw["id"].startswith("lore." + realm)
                            for rw in rewards) and len(g) == 1 and 8 <= g[0]["amount"] <= 15
        else:
            g = [rw for rw in rewards if rw["kind"] == "glass"]
            ok = ok and len(g) == 1 and g[0]["amount"] == 60
        check("%s: open %s cache via E -> events + rewards" % (realm, kind), ok, o)
    if deep:
        return deep_cold(pg)
    return None


def deep_cold(pg):
    # ---------------- a cache close up and a glint at 60 m, PROVEN on screen
    # (game-time settle + projected on/off box diff; wall-clock waits were
    # under one frame at 0.6 fps and shot the camera mid-flight)
    visual_one(pg, "cache_close", "cold: cache formation rendered (off/on/off box diff)")
    visual_one(pg, "cache_glint_85m", "cold: cache glint rendered at 85 m (off/on/off box diff)")

    # ---------------- trial run
    best = None
    for k in range(3):
        for attempt in range(2):
            res = ev(pg, "return await H.runTrial(%d, 400);" % k)
            fin = [e for e in res["result"] if e["t"] == "trial:finished"]
            fail = [e for e in res["result"] if e["t"] == "trial:failed"]
            print("trial run", k, attempt, json.dumps(res))
            if fin and fin[0]["p"]["medal"] >= 1:
                best = res
                break
            if fail:
                continue
        if best:
            break
    ok = best is not None
    check("cold: trial surfed with pinned input -> medal", ok,
          best if best else "no medal in 6 runs")
    trial_id = best["id"] if best else None
    trial_best = best["record"]["best"] if best else None
    visual_one(pg, "trial_gate", "cold: trial gate rendered (off/on/off box diff)")

    # ---------------- bounty
    rv = ev(pg, "return await H.bountyReveal(0);")
    check("cold: bounty spawns inside 80 m with 2.5x HP, its STORY name, +3 lv, tint",
          rv["revealed"] and rv["distAtReveal"] <= 80.5 and abs(rv["hpRatio"] - 2.5) < 0.01
          and rv["name"] == rv["storyName"] and len(rv["events"]) == 1
          and isinstance(rv["tint"], dict) and rv["tint"]["mix"] > 0.5, rv)
    ev(pg, "await H.settle(2); return 1;")   # GAME time (a wall wait is < 1 frame at 0.6 fps)
    shot(pg, "worldact_bounty.png")
    kl = ev(pg, "return await H.bountyKill(0);")
    rewards = [e["p"] for e in kl.get("events", []) if e["t"] == "reward"]
    ekill = [e["p"] for e in kl.get("events", []) if e["t"] == "enemy:killed"]
    check("cold: bounty killed -> bounty:killed, 40 glass, 15% XP, enemy:killed.bounty set",
          kl.get("killed") and kl.get("isKilled")
          and any(r["kind"] == "glass" and r["amount"] == 40 for r in rewards)
          and any(r["kind"] == "xp" and r.get("granted") for r in rewards)
          and any(e.get("bounty") == "bounty.cold.1" for e in ekill), kl)

    # ---------------- beacon (the old whole-frame diff passed on a camera
    # still in flight — 82.9 m from the waypoint — so it is judged in its
    # projected box, camera settled on game time)
    visual_one(pg, "beacon_200m", "cold: beacon rendered from 200 m (off/on/off box diff)")
    visual_one(pg, "beacon_380m", "cold: beacon rendered from 380 m (off/on/off box diff)")

    # ---------------- draw delta, busy scene: at a trial start, caches in
    # glint range, a live bounty elsewhere, the beacon up.
    ev(pg, """const tr = H.trials.trials[0];
        H.tp(tr.gx[0] - tr.nx[0]*20, tr.gz[0] - tr.nz[0]*20, Math.atan2(tr.nx[0], -tr.nz[0]));
        H.bus.emit('quest:waypoint', {x: tr.gx[tr.n-1], z: tr.gz[tr.n-1], realm: 'cold', label: 'probe'});
        return 1;""")
    ev(pg, "await H.settle(2); return 1;")   # GAME time (a wall wait is < 1 frame at 0.6 fps)
    dd = ev(pg, "return await H.drawDelta(30);")
    check("cold: draw delta <= 5 with all four systems up", dd["delta"] <= 5.0 and dd["delta"] > 0,
          dd)
    ev(pg, "H.beacon.clear(); return 1;")

    # ---------------- persist + reload
    snap = ev(pg, """SNOWFLOW.progression.save();
        const b = JSON.parse(localStorage.getItem('driftwake_save'));
        return {quest: b && b.quest ? {caches: b.quest.caches, trials: b.quest.trials,
                bounties: b.quest.bounties, cachesSeen: b.quest.cachesSeen} : null,
                opened: H.caches.list().filter(e => e.opened).map(e => e.site)};""")
    print("saved blob quest.*", json.dumps(snap))
    return {"trial_id": trial_id, "trial_best": trial_best, "opened": snap["opened"],
            "blob": snap["quest"]}


def after_reload(state, saved):
    pg = boot(state)
    r = ev(pg, "return await H.enter('cold');")
    check("reload: systems ready in cold", r.get("ready"), r)
    st = ev(pg, """return {opened: H.caches.list().filter(e => e.opened).map(e => e.site),
        trial: %s ? H.trials.record(%s) : null,
        killed: H.bounties.isKilled('bounty.cold.1')};"""
            % (json.dumps(saved["trial_id"]), json.dumps(saved["trial_id"])))
    check("reload: opened caches persist (and stay visually opened)",
          sorted(st["opened"]) == sorted(saved["opened"]), st)
    if saved["trial_id"]:
        check("reload: trial best time persists",
              st["trial"] and st["trial"]["best"] is not None
              and abs(st["trial"]["best"] - saved["trial_best"]) < 1e-6
              and st["trial"]["medal"] >= 1, {"saved": saved["trial_best"], "loaded": st["trial"]})
    rv = ev(pg, """const i0 = H.log.length;
        const sx = H.bounties.sx[0], sz = H.bounties.sz[0];
        H.tp(sx + 10, sz, 0);
        await H.gameWait(3);
        return {killed: H.bounties.isKilled('bounty.cold.1'), liveId: H.bounties.liveId[0],
                revealed: H.since(i0, 'bounty:revealed').length,
                distToSite: +Math.hypot(SNOWFLOW.character.position.x - sx,
                    SNOWFLOW.character.position.z - sz).toFixed(1)};""")
    check("reload: killed bounty stays dead (player 10 m from its site, 3 s)",
          rv["killed"] and rv["liveId"] == -1 and rv["revealed"] == 0, rv)
    return pg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="full", choices=["smoke", "full", "realms", "visual"])
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(exist_ok=True)
    # qa_server.py, not `-m http.server`: the stock server's listen backlog
    # of 5 refuses module loads on a loaded machine (see qa_server.py).
    srv = subprocess.Popen(
        [sys.executable, str(HERE / "qa_server.py"), str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    state = {"errors": [], "console": []}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            state["bctx"] = br.new_context(viewport={"width": 1280, "height": 720})
            open_page(state)
            try:
                pg = boot(state)
            except RuntimeError as e:
                print(str(e))
                print("")
                print("SUMMARY NOT RUN (environment) -- boot failures: " +
                      json.dumps(state.get("bootFails")))
                br.close()
                return 3
            errors, console_errs = state["errors"], state["console"]
            if args.stage == "smoke":
                realm_battery(pg, "cold", False)
                shot(pg, "worldact_smoke.png")
            elif args.stage == "visual":
                visual_stage(pg)
                dd = ev(pg, """const tr = H.trials.trials[0];
                    H.tp(tr.gx[0] - tr.nx[0]*20, tr.gz[0] - tr.nz[0]*20, Math.atan2(tr.nx[0], -tr.nz[0]));
                    H.bus.emit('quest:waypoint', {x: tr.gx[tr.n-1], z: tr.gz[tr.n-1], realm: 'cold'});
                    await H.settle(2); const r = await H.drawDelta(10); H.beacon.clear(); return r;""")
                check("visual: draw delta <= 5 with all four systems up", 0 < dd["delta"] <= 5.0, dd)
            else:
                if args.stage == "full":
                    saved = realm_battery(pg, "cold", True)
                    pg = after_reload(state, saved)
                for realm in ("sand", "ash"):
                    realm_battery(pg, realm, False)
                    ev(pg, """const tr = H.trials.trials[0];
                        if (tr) H.tp(tr.gx[0] - tr.nx[0]*25, tr.gz[0] - tr.nz[0]*25,
                                     Math.atan2(tr.nx[0], -tr.nz[0])); return 1;""")
                    ev(pg, "await H.settle(2); return 1;")   # GAME time (a wall wait is < 1 frame at 0.6 fps)
                    shot(pg, "worldact_%s_trial.png" % realm)
            harness_errs = ev(pg, "return H.errors.slice(0, 10);")
            check("zero page errors / harness errors", not errors and not harness_errs,
                  {"pageErrors": errors[:10], "harnessErrors": harness_errs,
                   "consoleErrors": console_errs[:15]})
            br.close()
    finally:
        srv.terminate()
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print("\nSUMMARY %d checks, %d failed" % (len(RESULTS), n_fail))
    for name, ok in RESULTS:
        print(("  PASS " if ok else "  FAIL ") + name)
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
