# -*- coding: utf-8 -*-
"""
qa_flee.py -- reproduce the owner report "enemies run right away instead of
standing to fight and attack" (port 8853).

Scene: REAL boot spawn (save key removed so auto-save cannot relocate it),
mixed pack woken at 12 m -- 2 rimeImps, 1 glacierBrute, 1 hailPlateGuard.
The pack bearing is the steepest 12 m corridor around the spawn (play-like
hilly approach). Player pinned; 30 s game-time of per-unit tracking:
signed radial velocity, distance-band occupancy, enemies.state[], flash,
plus a steer() spy that attributes each frame to a mechanism:
    away        final steer dir points AWAY while intent was the chase
    sepDom      |separation * SEP_W| >= |pursuit| (candidate a)
    slopeIntent raw chase line itself is > CLIMB_MAX  (real terrain block)
    slopeFinal  sep-adjusted line is > CLIMB_MAX (gate engages; candidate b)
    pathOn / desp  tier-3 A* follow / desperation frames (candidate d)
FLEE SIGNATURE = radial velocity > +0.4 m/s sustained > 2 s while state is
combat-family (ALERTED/COMBAT) with no attack in the previous 4 s game-time.

Runs the identical scene twice: pathing ON (shipped code) and pathing OFF
(steer/standDrift monkey-patched back to the pre-2d81836a passthrough) for
the before/after contrast. GUARD sub-phase at the end of each run: player
pinned 1.5 m from the hailPlateGuard for 8 s -- a planted bulwark must swing.

Usage: python qa_flee.py [--on-only|--off-only]
"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8853
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

CLIMB_MAX = 0.62
TRACK_S = 30.0            # game-time main phase
GUARD_S = 8.0             # game-time guard sub-phase
FLEE_VR = 0.4             # m/s outward = fleeing
FLEE_WINDOW_S = 2.0       # sustained this long = signature
NO_ATK_S = 4.0
PACK = [("rimeImp", -2.0), ("rimeImp", 2.0), ("glacierBrute", 0.0),
        ("hailPlateGuard", 3.5)]
SPAWN_R = 12.0
# u.reach + MELEE_PAD per unit, band = reach*1.1 (acceptance definition)
REACH = {"rimeImp": 1.7, "glacierBrute": 3.0, "hailPlateGuard": 2.3}
COMBAT_FAMILY = (1, 2)    # ALERTED, COMBAT
ATTACK_STATES = (3, 4, 9)  # WINDUP, STRIKE, FIRING
ST_NAMES = ["IDLE", "ALERT", "COMBAT", "WINDUP", "STRIKE", "RECOVER", "SUBM",
            "RETREAT", "RETURN", "FIRING", "BURIED", "ALARM", "REFORM",
            "GUARD", "DYING"]

SETUP_JS = """(() => {
    const SF = SNOWFLOW;
    SF.S.combatEnemies = false;
    const r = SF.combat.registry;
    for (let i = r.count - 1; i >= 0; i--)
        if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
    SF.character.health = SF.character.healthMax;
    if (SF.shrine && SF.shrine.mesh) SF.shrine.mesh.visible = false;
    return { px: +SF.character.position.x.toFixed(2),
             pz: +SF.character.position.z.toFixed(2),
             realm: SF.combat.encounters ? SF.combat.encounters.realm : null };
})()"""

# Steepest 12 m corridor: for 16 bearings, walk 3 lines (center, +-2 m
# perpendicular) from the ring point toward the player, 1 m steps; record the
# corridor's max up-step. Returns all + the argmax bearing.
SITE_JS = """((px, pz, R) => {
    const T = SNOWFLOW.terrain;
    const out = [];
    for (let b = 0; b < 16; b++) {
        const a = b * Math.PI / 8;
        const bx = Math.cos(a), bz = Math.sin(a);
        let worst = -9;
        for (const o of [-2, 0, 2]) {
            const sx = px + bx * R - bz * o, sz = pz + bz * R + bx * o;
            const d = Math.hypot(px - sx, pz - sz);
            const ns = Math.ceil(d);
            let h0 = T.heightAt(sx, sz);
            for (let k = 1; k <= ns; k++) {
                const t = k / ns;
                const h1 = T.heightAt(sx + (px - sx) * t, sz + (pz - sz) * t);
                const g = (h1 - h0) / (d / ns);
                if (g > worst) worst = g;
                h0 = h1;
            }
        }
        out.push(+worst.toFixed(2));
    }
    let bi = 0;
    for (let b = 1; b < 16; b++) if (out[b] > out[bi]) bi = b;
    return { grades: out, bearing: bi, bearingRad: bi * Math.PI / 8,
             maxUpGrade: out[bi] };
})"""

PIN_JS = """((px, pz) => {
    const SF = SNOWFLOW, c = SF.character;
    c.position.x = px; c.position.z = pz;
    c.position.y = SF.terrain.heightAt(px, pz);
    c.velocity.set(0, 0, 0);
    c.health = c.healthMax;
    return true;
})"""

SPAWN_JS = """((pts) => {
    const en = SNOWFLOW.combat.enemies;
    const ids = [];
    for (const [name, x, z] of pts) ids.push(en.spawn(name, x, z, 10));
    // enemy-slot index per id (enemy arrays, not registry slots)
    const idx = ids.map(id => {
        for (let i = 0; i < 24; i++) if (en.alive[i] && en.id[i] === id) return i;
        return -1;
    });
    return { ids, idx };
})"""

WAKE_JS = """((ids) => {
    const r = SNOWFLOW.combat.registry;
    for (const id of ids) if (id >= 0) r.damage(id, 1, {});
    return ids.map(id => r.slot(id));
})"""

GAMEWAIT_JS = """((sec) => new Promise((res) => {
    const reg = SNOWFLOW.combat.registry, t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res(+reg.time.toFixed(2))
        : requestAnimationFrame(tick);
    tick();
}))"""

# Passthrough = the literal pre-2d81836a locomotion: _move applies the raw
# direction, standing units do not drift. beginFrame left running (timers only).
PATHING_OFF_JS = """(() => {
    const pt = SNOWFLOW.combat.enemies.pathing;
    pt.steer = function (en, i, mx, mz, dt) { this.outX = mx; this.outZ = mz; };
    pt.standDrift = function () { this.outX = 0; this.outZ = 0; return 0; };
    return "pathing OFF (passthrough)";
})()"""

SPY_JS = """(() => {
    const en = SNOWFLOW.combat.enemies, pt = en.pathing, T = SNOWFLOW.terrain;
    const N = 24, SEP_W = 1.2, CM = %CM%, LOOK = 1.8;
    const D = window.__flee = {
        frames: new Int32Array(N), away: new Int32Array(N),
        sepDom: new Int32Array(N), slopeIntent: new Int32Array(N),
        slopeFinal: new Int32Array(N), pathOn: new Int32Array(N),
        desp: new Int32Array(N), drift: new Int32Array(N),
    };
    const climb = (x, z, dx, dz) =>
        (T.heightAt(x + dx * LOOK, z + dz * LOOK) - T.heightAt(x, z)) / LOOK;
    const steer0 = pt.steer.bind(pt);
    pt.steer = function (e2, i, mx, mz, dt) {
        steer0(e2, i, mx, mz, dt);
        D.frames[i]++;
        const x = en.x[i], z = en.z[i], c = en.controller.position;
        let px = c.x - x, pz = c.z - z;
        const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
        if (mx * px + mz * pz > 0.5 &&
            pt.outX * px + pt.outZ * pz < -0.1) D.away[i]++;
        const sx = (pt.sepX[i] || 0) * SEP_W, sz = (pt.sepZ[i] || 0) * SEP_W;
        if (Math.hypot(sx, sz) >= 1) D.sepDom[i]++;
        if (climb(x, z, mx, mz) > CM) D.slopeIntent[i]++;
        let ax = mx + sx, az = mz + sz;
        const al = Math.hypot(ax, az);
        if (al > 1e-4) { ax /= al; az /= al; }
        if (climb(x, z, ax, az) > CM) D.slopeFinal[i]++;
        if (pt._pathLen && pt._pathLen[i] > 0) D.pathOn[i]++;
        if (pt._despT && pt._despT[i] > 0) D.desp[i]++;
    };
    if (pt.standDrift) {
        const drift0 = pt.standDrift.bind(pt);
        pt.standDrift = function (e2, i, ux, uz, dist, mn, mx2) {
            const m = drift0(e2, i, ux, uz, dist, mn, mx2);
            if (m > 0) D.drift[i]++;
            return m;
        };
    }
    return "spy on";
})()"""

SAMPLE_JS = """((idx) => {
    const SF = SNOWFLOW, en = SF.combat.enemies, c = SF.character;
    const D = window.__flee;
    const out = { t: +SF.combat.registry.time.toFixed(3), e: [] };
    for (const i of idx) {
        if (i < 0 || !en.alive[i]) { out.e.push(null); continue; }
        out.e.push({
            x: +en.x[i].toFixed(2), z: +en.z[i].toFixed(2),
            d: +Math.hypot(en.x[i] - c.position.x,
                           en.z[i] - c.position.z).toFixed(3),
            st: en.state[i], fl: +en.flash[i].toFixed(2),
            tk: en.token[i], pl: en.planted[i], sp: +en.speedNow[i].toFixed(1),
            diag: D ? [D.frames[i], D.away[i], D.sepDom[i], D.slopeIntent[i],
                       D.slopeFinal[i], D.pathOn[i], D.desp[i], D.drift[i]]
                    : null,
        });
    }
    return out;
})"""


# --------------------------------------------------------------- crest mode
# Player on the top of a real dune face near spawn, pack 12 m DOWNHILL: the
# direct chase line exceeds CLIMB_MAX for every unit, so the contour /
# separation / A* machinery carries the whole approach. --crest [--fight].
CREST_JS = """((CM) => {
    const T = SNOWFLOW.terrain, c = SNOWFLOW.character;
    const px = c.position.x, pz = c.position.z;
    const e = 2, R = 120, step = 4;
    let best = null;
    for (let x = px - R; x <= px + R; x += step) {
        for (let z = pz - R; z <= pz + R; z += step) {
            const gx = (T.heightAt(x + e, z) - T.heightAt(x - e, z)) / (2 * e);
            const gz = (T.heightAt(x, z + e) - T.heightAt(x, z - e)) / (2 * e);
            const g = Math.hypot(gx, gz);
            if (g < CM * 1.15) continue;
            if (!best || g > best.g) best = { x, z, g, gx, gz };
        }
    }
    if (!best) return null;
    const ux = best.gx / best.g, uz = best.gz / best.g;   // uphill unit
    // player at the top of the face, pack ring centre 12 m downhill
    const bx = best.x + ux * 6, bz = best.z + uz * 6;
    return { bx: +bx.toFixed(1), bz: +bz.toFixed(1),
             ux: +ux.toFixed(3), uz: +uz.toFixed(3),
             faceGrade: +best.g.toFixed(2) };
})"""
# Director-spawned pack (perception wake, scatter cluster, real levels) +
# a player that WALKS toward the pack and then stands watching -- the owner
# scenario. Usage: qa_flee.py --real "The Hunt" [--with-off]

REAL_SETUP_JS = """(() => {
    const SF = SNOWFLOW;
    SF.S.combatEnemies = true;
    const r = SF.combat.registry;
    for (let i = r.count - 1; i >= 0; i--)
        if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
    SF.character.health = SF.character.healthMax;
    return { px: +SF.character.position.x.toFixed(2),
             pz: +SF.character.position.z.toFixed(2),
             realm: SF.combat.encounters.realm };
})()"""

REAL_SPAWN_JS = """((name) => {
    const enc = SNOWFLOW.combat.encounters;
    const ok = enc.spawnPack(name);
    return { ok, ax: enc._slots[0].x, az: enc._slots[0].z,
             queued: enc._slots[0].qCount };
})"""

REAL_ALIVE_JS = """(() => {
    const en = SNOWFLOW.combat.enemies;
    let n = 0;
    for (let i = 0; i < 24; i++) if (en.alive[i]) n++;
    return n;
})()"""

REAL_SAMPLE_JS = """(() => {
    const SF = SNOWFLOW, en = SF.combat.enemies, c = SF.character;
    const D = window.__flee;
    const out = { t: +SF.combat.registry.time.toFixed(3),
                  px: +c.position.x.toFixed(1), pz: +c.position.z.toFixed(1),
                  cs: +(c.speed || 0).toFixed(1), e: [] };
    for (let i = 0; i < 24; i++) {
        if (!en.alive[i]) continue;
        out.e.push({
            i, k: en.units[en.unitOf[i]].key,
            x: +en.x[i].toFixed(2), z: +en.z[i].toFixed(2),
            d: +Math.hypot(en.x[i] - c.position.x,
                           en.z[i] - c.position.z).toFixed(3),
            st: en.state[i], fl: +en.flash[i].toFixed(2), tk: en.token[i],
            oc: +en.openerCd[i].toFixed(1), cl: en.cloaked[i],
            diag: D ? [D.frames[i], D.away[i], D.sepDom[i], D.slopeIntent[i],
                       D.slopeFinal[i], D.pathOn[i], D.desp[i], D.drift[i]]
                    : null,
        });
    }
    return out;
})()"""

WALK_JS = """((tx, tz, step) => {
    const SF = SNOWFLOW, c = SF.character;
    const dx = tx - c.position.x, dz = tz - c.position.z;
    const d = Math.hypot(dx, dz);
    const s = Math.min(step, d);
    if (d > 1e-3) {
        c.position.x += dx / d * s;
        c.position.z += dz / d * s;
        c.position.y = SF.terrain.heightAt(c.position.x, c.position.z);
    }
    c.health = c.healthMax;
    return +d.toFixed(1);
})"""


def analyze_real(samples, label):
    units = {}
    for s in samples:
        for e in s["e"]:
            units.setdefault(e["i"], {"k": e["k"], "tr": []})
            units[e["i"]]["tr"].append((s["t"], e))
    res = []
    for i, u in sorted(units.items()):
        tr = u["tr"]
        band = REACH.get(u["k"], 2.5) * 1.1
        states = {}
        atk_times = []
        first_atk = None
        arrive_t = None
        flee_total = 0.0
        flee_longest = 0.0
        cur = 0.0
        cur_t0 = None
        windows = []
        min_d = 1e9
        for j, (t, e) in enumerate(tr):
            states[ST_NAMES[e["st"]]] = states.get(ST_NAMES[e["st"]], 0) + 1
            if e["d"] < min_d:
                min_d = e["d"]
            if e["st"] in ATTACK_STATES or e["fl"] > 0.5:
                atk_times.append(t)
                if first_atk is None:
                    first_atk = t
            if arrive_t is None and e["d"] <= band:
                arrive_t = t
            if j > 0:
                t0, e0 = tr[j - 1]
                dt = t - t0
                if dt > 1e-3:
                    vr = (e["d"] - e0["d"]) / dt
                    recent = any(t - at <= NO_ATK_S for at in atk_times)
                    if vr > FLEE_VR and e["st"] in COMBAT_FAMILY and not recent:
                        if cur == 0.0:
                            cur_t0 = t0
                        cur += dt
                        flee_total += dt
                        if cur > flee_longest:
                            flee_longest = cur
                    else:
                        if cur >= FLEE_WINDOW_S:
                            windows.append((round(cur_t0, 1), round(cur, 1)))
                        cur = 0.0
        if cur >= FLEE_WINDOW_S:
            windows.append((round(cur_t0, 1), round(cur, 1)))
        last = tr[-1][1]
        res.append({
            "slot": i, "unit": u["k"], "bandM": round(band, 2),
            "minDist": round(min_d, 2), "finalDist": last["d"],
            "arriveT": round(arrive_t - tr[0][0], 1) if arrive_t else None,
            "firstAtkT": round(first_atk - tr[0][0], 1) if first_atk else None,
            "nAtkSamples": len(atk_times), "fleeTotalS": round(flee_total, 1),
            "fleeLongestS": round(flee_longest, 1), "fleeWindows": windows,
            "states": states, "diag": last["diag"],
        })
    print(f"--- {label} ---")
    for r in res:
        print(json.dumps(r))
    return res


def run_real(pg, pack_name):
    import math
    setup = pg.evaluate(REAL_SETUP_JS)
    print("real setup:", setup)

    def gamewait(sec):
        return pg.evaluate(GAMEWAIT_JS + f"({sec})")

    sp = pg.evaluate(REAL_SPAWN_JS + f"({json.dumps(pack_name)})")
    print("spawnPack:", sp)
    if not sp["ok"]:
        raise RuntimeError("spawnPack refused")
    # queue drains on the director's clock -- wait for every member
    for _ in range(80):
        if pg.evaluate(REAL_ALIVE_JS) >= sp["queued"]:
            break
        pg.wait_for_timeout(250)
    n = pg.evaluate(REAL_ALIVE_JS)
    print("alive after drain:", n, "of", sp["queued"])
    print("spy:", pg.evaluate(SPY_JS.replace("%CM%", str(CLIMB_MAX))))

    ax, az = sp["ax"], sp["az"]
    samples = []
    t0 = pg.evaluate("SNOWFLOW.combat.registry.time")
    stand = None
    woken = False
    while True:
        s = pg.evaluate(REAL_SAMPLE_JS)
        samples.append(s)
        near = min((e["d"] for e in s["e"]), default=1e9)
        if not woken and near <= 12.0:
            # the "first spotter" wake: the noisy-arrival hearing check needs
            # controller.speed > 5, which a teleport walk never produces --
            # poke the nearest unit instead; _drainEvents _propagate()s the
            # pack exactly like a sight/hearing wake would.
            print("wake poke:", pg.evaluate("""(() => {
                const SF = SNOWFLOW, en = SF.combat.enemies,
                      c = SF.character, r = SF.combat.registry;
                let bi = -1, bd = 1e9;
                for (let i = 0; i < 24; i++) {
                    if (!en.alive[i]) continue;
                    const d = Math.hypot(en.x[i] - c.position.x,
                                         en.z[i] - c.position.z);
                    if (d < bd) { bd = d; bi = i; }
                }
                if (bi >= 0) r.damage(en.id[bi], 0.5, {});
                return { slot: bi, d: +bd.toFixed(1) };
            })()"""))
            woken = True
        if stand is None:
            if near <= 7.0:
                stand = (s["px"], s["pz"])
                print(f"standing at t+{round(s['t'] - t0, 1)}s "
                      f"({s['px']},{s['pz']}), nearest {near}")
            else:
                pg.evaluate(WALK_JS + f"({ax}, {az}, 0.8)")   # ~4 m/s walk
        else:
            pg.evaluate(PIN_JS + f"({stand[0]}, {stand[1]})")
        if s["t"] - t0 >= 45.0:
            break
        pg.wait_for_timeout(200)
    return samples


def main_real():
    from playwright.sync_api import sync_playwright
    idx = sys.argv.index("--real")
    pack_name = sys.argv[idx + 1]
    with_off = "--with-off" in sys.argv

    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    report = {"pack": pack_name}
    try:
        if not wait_server():
            subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                             cwd=str(ROOT), stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
            if not wait_server():
                print("RESULT: FAIL server never came up")
                return 1
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.add_init_script(
                "try{localStorage.removeItem('driftwake_save')}catch(e){}")

            def boot():
                pg.goto(GAME_URL, wait_until="domcontentloaded")
                pg.wait_for_function(
                    "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                    timeout=120000)
                pg.wait_for_timeout(2500)

            boot()
            samples = run_real(pg, pack_name)
            report["on"] = analyze_real(samples, f"{pack_name} / pathing ON")
            if with_off:
                boot()
                print(pg.evaluate(PATHING_OFF_JS))
                samples = run_real(pg, pack_name)
                report["off"] = analyze_real(samples,
                                             f"{pack_name} / pathing OFF")
            br.close()
    finally:
        srv.terminate()
    print("FLEE_REAL_JSON:", json.dumps(report))
    return 0


def wait_server():
    for _ in range(40):
        try:
            with urllib.request.urlopen(
                    f"http://localhost:{PORT}/games/driftwake/index.html",
                    timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def analyze(samples, kinds, label):
    """Per-unit flee windows, band arrival, first attack."""
    res = []
    n = len(kinds)
    for k in range(n):
        band = REACH[kinds[k]] * 1.1
        arrive_t = None
        first_atk = None
        atk_times = []
        flee_total = 0.0
        flee_longest = 0.0
        cur = 0.0
        cur_t0 = None
        windows = []
        states = {}
        prev = None
        for s in samples:
            e = s["e"][k]
            if e is None:
                continue
            st = e["st"]
            states[ST_NAMES[st]] = states.get(ST_NAMES[st], 0) + 1
            attacking = st in ATTACK_STATES or e["fl"] > 0.5
            if attacking:
                atk_times.append(s["t"])
                if first_atk is None:
                    first_atk = s["t"]
            if arrive_t is None and e["d"] <= band:
                arrive_t = s["t"]
            if prev is not None:
                pe = prev["e"][k]
                dt = s["t"] - prev["t"]
                if pe is not None and dt > 1e-3:
                    vr = (e["d"] - pe["d"]) / dt
                    recent_atk = any(s["t"] - at <= NO_ATK_S for at in atk_times)
                    fleeing = (vr > FLEE_VR and st in COMBAT_FAMILY
                               and not recent_atk)
                    if fleeing:
                        if cur == 0.0:
                            cur_t0 = prev["t"]
                        cur += dt
                        flee_total += dt
                        if cur > flee_longest:
                            flee_longest = cur
                    else:
                        if cur >= FLEE_WINDOW_S:
                            windows.append((round(cur_t0, 1), round(cur, 1)))
                        cur = 0.0
            prev = s
        if cur >= FLEE_WINDOW_S:
            windows.append((round(cur_t0, 1), round(cur, 1)))
        final = None
        for s in reversed(samples):
            if s["e"][k] is not None:
                final = s["e"][k]
                break
        d0 = samples[0]["e"][k]["d"] if samples[0]["e"][k] else None
        res.append({
            "unit": kinds[k], "bandM": round(band, 2),
            "startDist": d0, "finalDist": final["d"] if final else None,
            "arriveT": round(arrive_t - samples[0]["t"], 1) if arrive_t else None,
            "firstAtkT": round(first_atk - samples[0]["t"], 1) if first_atk else None,
            "nAtkSamples": len(atk_times),
            "fleeTotalS": round(flee_total, 1),
            "fleeLongestS": round(flee_longest, 1),
            "fleeWindows": windows,
            "states": states,
            "diag": final["diag"] if final else None,
        })
    print(f"--- {label} ---")
    for r in res:
        print(json.dumps(r))
    return res


# A fighting player's pressure, exactly as spellHits sends it: wave-shaped
# knockback (4 m + stagger via poise) radially away from the player on every
# enemy within 9 m. Cast every 4 s game-time.
WAVE_HIT_JS = """(() => {
    const SF = SNOWFLOW, en = SF.combat.enemies, r = SF.combat.registry,
          c = SF.character;
    let hit = 0;
    for (let i = 0; i < 24; i++) {
        if (!en.alive[i]) continue;
        const dx = en.x[i] - c.position.x, dz = en.z[i] - c.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 9) continue;
        r.damage(en.id[i], 6, { cc: "knockback", ccMag: 4,
                                dirX: dx / (d || 1), dirZ: dz / (d || 1),
                                poise: 30, tag: "wave" });
        hit++;
    }
    return hit;
})()"""

AIM_JS = """((yaw) => {
    SNOWFLOW.rig.yaw = yaw;
    SNOWFLOW.rig.distanceTarget = 12;
    return true;
})"""


def run_scene(pg, site, guard_engage=True, fight=False, shots_tag=None):
    setup = pg.evaluate(SETUP_JS)
    print("setup:", setup)
    px, pz = setup["px"], setup["pz"]

    def gamewait(sec):
        return pg.evaluate(GAMEWAIT_JS + f"({sec})")

    a = site["bearingRad"]
    import math
    bx, bz = math.cos(a), math.sin(a)
    pts = []
    kinds = []
    for name, off in PACK:
        pts.append([name, px + bx * SPAWN_R - bz * off,
                    pz + bz * SPAWN_R + bx * off])
        kinds.append(name)
    sp = pg.evaluate(SPAWN_JS + f"({json.dumps(pts)})")
    print("spawn:", sp)
    if any(i < 0 for i in sp["ids"]) or any(i < 0 for i in sp["idx"]):
        raise RuntimeError(f"spawn failed: {sp}")
    gamewait(0.1)
    slots = pg.evaluate(WAKE_JS + f"({json.dumps(sp['ids'])})")
    print("woken, registry slots:", slots)
    print("spy:", pg.evaluate(SPY_JS.replace("%CM%", str(CLIMB_MAX))))

    samples = []
    t0 = pg.evaluate("SNOWFLOW.combat.registry.time")
    next_wave = 6.0            # let them arrive first, then fight back
    next_shot = 2.0
    shot_n = 0
    if shots_tag:
        import math as _m
        pg.evaluate(AIM_JS + f"({_m.atan2(bx, -bz) + _m.pi})")
    while True:
        s = pg.evaluate(SAMPLE_JS + f"({json.dumps(sp['idx'])})")
        pg.evaluate(PIN_JS + f"({px}, {pz})")
        samples.append(s)
        el = s["t"] - t0
        if fight and el >= next_wave:
            hit = pg.evaluate(WAVE_HIT_JS)
            print(f"wave at t+{round(el, 1)}s hit {hit}")
            next_wave += 4.0
        if shots_tag and el >= next_shot and shot_n < 6:
            p = str(Path(__file__).parent / f"flee_{shots_tag}_{shot_n}.png")
            pg.screenshot(path=p)
            shot_n += 1
            next_shot += 5.0
        if el >= TRACK_S:
            break
        pg.wait_for_timeout(200)

    guard = None
    if guard_engage:
        gk = kinds.index("hailPlateGuard")
        ge = samples[-1]["e"][gk]
        if ge is not None:
            import math as m2
            gx, gz = ge["x"], ge["z"]
            gd = m2.hypot(gx - px, gz - pz) or 1
            ex = gx - (gx - px) / gd * 1.5
            ez = gz - (gz - pz) / gd * 1.5
            pg.evaluate(PIN_JS + f"({ex}, {ez})")
            t1 = pg.evaluate("SNOWFLOW.combat.registry.time")
            gsam = []
            while True:
                s = pg.evaluate(SAMPLE_JS + f"({json.dumps(sp['idx'])})")
                pg.evaluate(PIN_JS + f"({ex}, {ez})")
                gsam.append(s)
                if s["t"] - t1 >= GUARD_S:
                    break
                pg.wait_for_timeout(200)
            swung = any(x["e"][gk] and (x["e"][gk]["st"] in ATTACK_STATES
                        or x["e"][gk]["fl"] > 0.5) for x in gsam)
            states = sorted({ST_NAMES[x["e"][gk]["st"]] for x in gsam
                             if x["e"][gk]})
            guard = {"swung": swung, "states": states,
                     "dist": gsam[-1]["e"][gk]["d"] if gsam[-1]["e"][gk] else None}
            print("guard sub-phase:", json.dumps(guard))

    return samples, kinds, guard


def main():
    from playwright.sync_api import sync_playwright

    on_only = "--on-only" in sys.argv
    off_only = "--off-only" in sys.argv

    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    report = {}
    try:
        if not wait_server():
            # Windows double-bind is fine -- one more attempt.
            subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                             cwd=str(ROOT), stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
            if not wait_server():
                print("RESULT: FAIL server never came up")
                return 1
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.add_init_script(
                "try{localStorage.removeItem('driftwake_save')}catch(e){}")

            def boot():
                pg.goto(GAME_URL, wait_until="domcontentloaded")
                pg.wait_for_function(
                    "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                    timeout=120000)
                pg.wait_for_timeout(2500)

            boot()
            setup0 = pg.evaluate(SETUP_JS)
            if "--crest" in sys.argv:
                import math as _m
                crest = pg.evaluate(CREST_JS + f"({CLIMB_MAX})")
                print("CREST:", json.dumps(crest))
                if not crest:
                    print("RESULT: FAIL no crest site near spawn")
                    br.close()
                    return 1
                pg.evaluate(PIN_JS + f"({crest['bx']}, {crest['bz']})")
                site = {"bearingRad": _m.atan2(-crest["uz"], -crest["ux"]),
                        "maxUpGrade": crest["faceGrade"], "crest": crest}
                report["site"] = site
                report["spawn"] = {"px": crest["bx"], "pz": crest["bz"]}
            else:
                site = pg.evaluate(
                    SITE_JS + f"({setup0['px']}, {setup0['pz']}, {SPAWN_R})")
                print("SITE:", json.dumps(site))
                report["site"] = site
                report["spawn"] = {"px": setup0["px"], "pz": setup0["pz"]}

            fight = "--fight" in sys.argv
            if not off_only:
                samples, kinds, guard = run_scene(
                    pg, site, fight=fight, shots_tag="on" if fight else None)
                report["on"] = {"units": analyze(samples, kinds, "pathing ON"),
                                "guard": guard}

            if not on_only:
                boot()
                print(pg.evaluate(PATHING_OFF_JS))
                if "--crest" in sys.argv:
                    pg.evaluate(SETUP_JS)
                    pg.evaluate(PIN_JS + f"({site['crest']['bx']}, "
                                         f"{site['crest']['bz']})")
                samples, kinds, guard = run_scene(
                    pg, site, fight=fight, shots_tag="off" if fight else None)
                report["off"] = {"units": analyze(samples, kinds, "pathing OFF"),
                                 "guard": guard}
            br.close()
    finally:
        srv.terminate()

    print("FLEE_JSON:", json.dumps(report))
    # verdict: repro = any unit in ON run shows a >2 s flee window
    on_units = report.get("on", {}).get("units", [])
    flee_on = [u for u in on_units if u["fleeWindows"]]
    off_units = report.get("off", {}).get("units", [])
    flee_off = [u for u in off_units if u["fleeWindows"]]
    print(f"RESULT: ON fleeUnits={len(flee_on)} OFF fleeUnits={len(flee_off)}")
    return 0


if __name__ == "__main__":
    sys.exit(main_real() if "--real" in sys.argv else main())
