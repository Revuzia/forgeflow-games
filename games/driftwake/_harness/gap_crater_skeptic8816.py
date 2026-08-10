# -*- coding: utf-8 -*-
"""
gap_crater.py -- live proof of the SAND EXPLOSION crater (commit a34d64e9).

Claims under test:
  1. In SAND, spell 4 ("Sand Explosion", crystallize.js _crater) carves a REAL
     depression into the persistent deform field (centre dep delta >= 0.40 m in
     field units -- shaders/deformSim.glsl.js:18 "R depression depth, metres,
     positive = pushed down") with a RAISED berm ring at ~2.4 m (G channel up).
  2. GAMEPLAY INVARIANCE: damage / stun / poise-break of the spikes hit are
     identical in sand and cold (combatData.spikes: 30 dmg, 1.5 s stun, 60 poise).
  3. COLD CONTROL: cast(4) in cold writes only the ordinary glaze brushes
     (depth 0.10 central) -- no crater-magnitude depression.

Readback reuses probe_deform_skip.py's renderer.readRenderTargetPixels path
(RGBA16F halves, toroidal fract addressing, 7x7 max window per point).

    python gap_crater.py          (serves repo root on port 8803 itself)
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[3]
PORT = 8816
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
SHOTS = Path(r"C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/9e9ff830-6ecf-420d-ba55-625913a5412e/scratchpad")
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

# ---------------------------------------------------------------- JS blocks

SETUP = """() => {
    const SF = globalThis.SNOWFLOW;
    SF.combat.encounters._nextSpawnAt = 1e9;
    SF.combat.encounters._clearAll();
    SF.combat.enemies.clear();
    SF.progression.unlocked.add(1);
    SF.progression.unlocked.add(3);
    SF.progression.unlocked.add(4);
    for (const s of ['#boot','#hint','#overlay','#crosshair'])
        document.querySelectorAll(s).forEach(e => e.style.display='none');
    return { realm: SF.spells.realm,
             pos: { x: SF.character.position.x, z: SF.character.position.z } };
}"""

# 7x7-max readback of the deform field at a list of world points.
# Same addressing + half decode as probe_deform_skip.py READBACK.
READBACK = """(pts) => {
    const SF = globalThis.SNOWFLOW, d = SF.deform;
    const rt = d._pp.read;
    const res = d.res, size = d.size;
    const f = (v) => v - Math.floor(v);
    const half = (h) => {
        const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
        if (e === 0) return s * m * 5.9604644775390625e-8;
        if (e === 31) return m ? NaN : s * Infinity;
        return s * Math.pow(2, e - 15) * (1 + m / 1024);
    };
    const out = [];
    const buf = new Uint16Array(7 * 7 * 4);
    for (const p of pts) {
        const i = Math.max(3, Math.min(res - 4, Math.floor(f(p.x / size) * res)));
        const j = Math.max(3, Math.min(res - 4, Math.floor(f(p.z / size) * res)));
        SF.renderer.readRenderTargetPixels(rt, i - 3, j - 3, 7, 7, buf);
        const o = [0, 0, 0, 0];
        for (let k = 0; k < 49; k++)
            for (let ch = 0; ch < 4; ch++)
                o[ch] = Math.max(o[ch], half(buf[k * 4 + ch]));
        out.push({ dep: o[0], berm: o[1], comp: o[2], ice: o[3] });
    }
    return out;
}"""

# Pick a flat-ish target r metres from the player: 12 candidate bearings,
# flatness = height spread over a 2 m cross at the candidate, keep the flattest
# whose bearing differs from `avoid` (radians, -1 = none) by > 1.0 rad.
PICK_TARGET = """(arg) => {
    const SF = globalThis.SNOWFLOW, c = SF.character.position;
    const r = arg.r, avoid = arg.avoid;
    let best = null;
    for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        if (avoid >= 0) {
            let da = Math.abs(a - avoid) % (Math.PI * 2);
            if (da > Math.PI) da = Math.PI * 2 - da;
            if (da < 1.0) continue;
        }
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        const hs = [];
        for (const [ox, oz] of [[0,0],[2,0],[-2,0],[0,2],[0,-2]])
            hs.push(SF.terrain.heightAt(x + ox, z + oz));
        const spread = Math.max(...hs) - Math.min(...hs);
        if (!best || spread < best.spread) best = { x, z, a, spread };
    }
    return best;
}"""

# Cast spell 4 at a world point through the REAL pipeline (unlock+mana+cd gates
# opened, aim = eye->target ray, spells.cast(4)), return the scheduled aim
# point captured in _pending -- the exact detonation centre.
CAST4_AT = """(t) => {
    const SF = globalThis.SNOWFLOW, sp = SF.spells, ch = SF.character;
    ch.mana = ch.manaMax;
    sp._cdUntil[4] = 0;
    const eye = SF.rig.camera.position;
    const ty = SF.terrain.heightAt(t.x, t.z);
    let dx = t.x - eye.x, dy = ty - eye.y, dz = t.z - eye.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    sp.aim.set(dx, dy, dz);
    SF.rig.yaw = Math.atan2(dx, -dz);
    SF.character.facing = SF.rig.yaw;
    sp.cast(4);
    const p = sp._pending;
    return { key: p.key, x: p.a0, y: p.a1, z: p.a2,
             mana: ch.mana, realm: sp.realm };
}"""

# Game-time wait (registry.time advances by dt; the harness Chrome can run at
# ~0.1x wall speed so wall sleeps are useless). Wall-capped at 180 s.
GAME_WAIT = """(sec) => new Promise((res, rej) => {
    const reg = globalThis.SNOWFLOW.combat.registry;
    const t0 = reg.time, w0 = Date.now();
    const tick = () => {
        if (reg.time - t0 >= sec) return res(reg.time - t0);
        if (Date.now() - w0 > 180000) return rej(new Error('game-time wait wall cap'));
        requestAnimationFrame(tick);
    };
    tick();
})"""

SPAWN = """(a) => {
    const SF = globalThis.SNOWFLOW, E = SF.combat.enemies,
          reg = SF.combat.registry;
    const id = E.spawn(a.key, a.x, a.z, a.level);
    if (id < 0) return { err: 'spawn failed' };
    let slot = -1;
    for (let i = 0; i < reg.count; i++) if (reg.idOf[i] === id) { slot = i; break; }
    return { id, slot, hp: reg.hp[slot], poise: reg.poise[slot],
             poiseMax: reg.poiseMax[slot], tier: reg.tier[slot],
             y: reg.y[slot] };
}"""

# Poll per-frame for the spike hit on `id`; on the first frame hp drops,
# capture damage + CC state deltas. Wall-capped; game-time capped at 6 s.
# PINS the body to (a.x, a.z) every frame: scourScout has perceptionM 20, and a
# spawn whose random yaw happens to face the player aggroes and sprints out of
# the 2.23 m disc during the 0.95 s strike delay (run 3's sand miss). The pin
# is position-only -- damage, poise and CC mechanics are untouched.
MEASURE_HIT = """(a) => new Promise((res, rej) => {
    const SF = globalThis.SNOWFLOW, reg = SF.combat.registry,
          E = SF.combat.enemies;
    let slot = -1;
    for (let i = 0; i < reg.count; i++) if (reg.idOf[i] === a.id) { slot = i; break; }
    if (slot < 0) return res({ err: 'no slot for id' });
    let eslot = -1;
    for (let i = 0; i < E.id.length; i++)
        if (E.alive[i] && E.id[i] === a.id) { eslot = i; break; }
    const hp0 = reg.hp[slot], t0 = reg.time, w0 = Date.now();
    const tick = () => {
        if (Date.now() - w0 > 180000) return rej(new Error('measure wall cap'));
        if (reg.idOf[slot] !== a.id) return res({ err: 'slot recycled' });
        if (eslot >= 0 && E.alive[eslot]) {
            E.x[eslot] = a.x; E.z[eslot] = a.z;
            E.y[eslot] = SF.terrain.heightAt(a.x, a.z);
        }
        if (reg.hp[slot] < hp0 - 0.01) {
            return res({
                dmg: hp0 - reg.hp[slot],
                stunLeft: reg.stunUntil[slot] - reg.time,
                breakLeft: reg.breakUntil[slot] - reg.time,
                staggerLeft: reg.staggerUntil[slot] - reg.time,
                poiseAfter: reg.poise[slot],
                waited: reg.time - t0,
            });
        }
        if (reg.time - t0 > 6) return res({ err: 'no hit inside 6 s game time' });
        requestAnimationFrame(tick);
    };
    tick();
})"""

# Force every standing crystal prism to sublimate now (visual-clarity poke for
# the screenshots only -- gameplay/measurement is already done by then).
KILL_CRYSTALS = """() => {
    const cf = globalThis.SNOWFLOW.spells.crystals;
    let n = 0;
    for (let i = 0; i < cf.age.length; i++)
        if (cf.alive[i]) { cf.age[i] = cf.life[i] + 999; n++; }
    return n;
}"""

# Move the player to fresh ground: the deform window (80 m, toroidal) follows
# the PLAYER, and the sim pass zeroes texels that wrap in -- so a 60 m hop
# guarantees a virgin field. Settle 0.9 s of game time for the scroll.
TELEPORT = """(p) => {
    const SF = globalThis.SNOWFLOW, c = SF.character;
    c.position.x = p.x; c.position.z = p.z;
    c.position.y = SF.terrain.heightAt(p.x, p.z);
    c.velocity.x = 0; c.velocity.z = 0;
    return { x: c.position.x, z: c.position.z };
}"""

POSE_SHOT = """(a) => {
    const SF = globalThis.SNOWFLOW, c = SF.character;
    c.position.x = a.px; c.position.z = a.pz;
    c.position.y = SF.terrain.heightAt(a.px, a.pz);
    c.velocity.x = 0; c.velocity.z = 0;
    const dx = a.tx - a.px, dz = a.tz - a.pz;
    SF.rig.yaw = Math.atan2(dx, -dz);
    c.facing = SF.rig.yaw;
    SF.rig.pitch = a.pitch;
    SF.rig.distance = SF.rig.distanceTarget = a.dist;
    return true;
}"""


def ring_points(cx, cz, r, n=12):
    import math
    return [{"x": cx + math.cos(2 * math.pi * k / n) * r,
             "z": cz + math.sin(2 * math.pi * k / n) * r} for k in range(n)]


def do_cast_and_read(pg, target):
    """Cast 4 at target; return (centre_before, ring_before, centre_after,
    ring_after, det) where det is the exact detonation point."""
    det = pg.evaluate(CAST4_AT, target)
    if det["key"] != 4:
        raise RuntimeError(f"cast(4) did not schedule (pending key={det['key']}) "
                           f"-- gate blocked? {json.dumps(det)}")
    pts = [{"x": det["x"], "z": det["z"]}] + ring_points(det["x"], det["z"], 2.4)
    before = pg.evaluate(READBACK, pts)
    # strike at +0.95 s game; brushes next sim frame; settle to +2.2 s
    pg.evaluate(GAME_WAIT, 2.2)
    after = pg.evaluate(READBACK, pts)
    return before[0], before[1:], after[0], after[1:], det


def teleport(pg, x, z):
    pg.evaluate(TELEPORT, {"x": x, "z": z})
    pg.evaluate(GAME_WAIT, 0.9)


def invariance_pass(pg, realm_label, level):
    """Cast 4, then spawn a MEDIUM scourScout AT the captured detonation point
    during the 0.95 s strike delay -- guarantees the body is inside the 2.23 m
    disc wherever the aim ray actually landed (an eye ray past a down-sloping
    target can overshoot to the 22 m cap; run 2 missed by 16 m that way)."""
    tgt = pg.evaluate(PICK_TARGET, {"r": 7.0, "avoid": -1})
    det = pg.evaluate(CAST4_AT, {"x": tgt["x"], "z": tgt["z"]})
    if det["key"] != 4:
        raise RuntimeError(f"{realm_label}: cast(4) blocked: {json.dumps(det)}")
    sp = pg.evaluate(SPAWN, {"key": "scourScout", "x": det["x"], "z": det["z"],
                             "level": level})
    if "err" in sp:
        raise RuntimeError(f"{realm_label}: {sp['err']}")
    hit = pg.evaluate(MEASURE_HIT, {"id": sp["id"],
                                    "x": det["x"], "z": det["z"]})
    pg.evaluate("() => globalThis.SNOWFLOW.combat.enemies.clear()")
    return {"spawn": sp, "hit": hit, "det": {"x": det["x"], "z": det["z"]}}


def main():
    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(exist_ok=True)
    out = {}
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2000)
            out["setup"] = pg.evaluate(SETUP)

            # ---- calibration: a real footprint in field units ------------
            pg.evaluate("() => window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyW'}))")
            pg.evaluate(GAME_WAIT, 1.2)
            pg.evaluate("() => window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyW'}))")
            here = pg.evaluate("() => ({x: SNOWFLOW.character.position.x,"
                               " z: SNOWFLOW.character.position.z})")
            out["calibration_footprint"] = pg.evaluate(READBACK, [here])[0]

            # ---- COLD CONTROL (default realm is cold) --------------------
            # Each cast gets VIRGIN ground: the first run had the sand target
            # land 1.7 m from the cold cast (before-read ice 0.997), which ate
            # the delta headroom under the field's own 0.55 m depth clamp
            # (deformation.js:383  maxDepth = 0.55 * S.deformDepth).
            assert out["setup"]["realm"] == "cold", out["setup"]
            teleport(pg, 60, 0)
            tgt = pg.evaluate(PICK_TARGET, {"r": 6.0, "avoid": -1})
            cb, rb, ca, ra, cdet = do_cast_and_read(pg, tgt)
            out["cold_cast"] = {
                "det": cdet, "centre_before": cb, "centre_after": ca,
                "centre_dep_delta": ca["dep"] - cb["dep"],
                "ring_berm_delta_max": max(a["berm"] - b["berm"]
                                           for a, b in zip(ra, rb)),
            }

            # ---- COLD invariance -----------------------------------------
            teleport(pg, 120, 0)
            out["cold_hit"] = invariance_pass(pg, "cold", 8)

            # ---- realm switch to SAND ------------------------------------
            pg.evaluate("() => globalThis.SNOWFLOW.enterRealm('sand')")
            pg.wait_for_function(
                "() => SNOWFLOW.spells.realm === 'sand'"
                " && SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                timeout=300000)
            pg.evaluate("""() => {
                const SF = globalThis.SNOWFLOW;
                SF.combat.encounters._nextSpawnAt = 1e9;
                SF.combat.encounters._clearAll();
                SF.combat.enemies.clear();
            }""")
            pg.evaluate(GAME_WAIT, 0.5)

            # ---- SAND crater ---------------------------------------------
            teleport(pg, 180, 0)
            tgt = pg.evaluate(PICK_TARGET, {"r": 6.0, "avoid": -1})
            sb, srb, sa, sra, sdet = do_cast_and_read(pg, tgt)
            ring_deltas = [{"berm": a["berm"] - b["berm"],
                            "dep": a["dep"] - b["dep"]}
                           for a, b in zip(sra, srb)]
            best_ring = max(ring_deltas, key=lambda r: r["berm"])
            out["sand_cast"] = {
                "det": sdet, "centre_before": sb, "centre_after": sa,
                "centre_dep_delta": sa["dep"] - sb["dep"],
                "centre_berm_delta": sa["berm"] - sb["berm"],
                "ring_deltas": ring_deltas,
                "ring_berm_delta_max": best_ring["berm"],
                "ring_dep_at_best_berm": best_ring["dep"],
            }

            # ---- screenshots (BEFORE leaving the area: the toroidal window
            # follows the player and zeroes texels that wrap back in, so a
            # 60 m round trip would erase this crater) --------------------
            out["crystals_killed"] = pg.evaluate(KILL_CRYSTALS)
            pg.evaluate(GAME_WAIT, 0.4)
            cx, cz = sdet["x"], sdet["z"]
            # low camera behind the character, crater between it and the light
            # (pitch 0.30: at 0.10 the crater 4 m ahead fell below the frame)
            pg.evaluate(POSE_SHOT, {"px": cx + 3.0, "pz": cz + 3.0,
                                    "tx": cx, "tz": cz,
                                    "pitch": 0.30, "dist": 8.0})
            pg.evaluate(GAME_WAIT, 0.6)
            pg.screenshot(path=str(SHOTS / "gap_crater.png"))
            pg.evaluate(POSE_SHOT, {"px": cx, "pz": cz,
                                    "tx": cx - 4, "tz": cz - 4,
                                    "pitch": 0.22, "dist": 5.0})
            pg.evaluate(GAME_WAIT, 0.8)
            pg.screenshot(path=str(SHOTS / "gap_crater_stand.png"))

            # ---- SAND invariance -----------------------------------------
            teleport(pg, 240, 0)
            out["sand_hit"] = invariance_pass(pg, "sand", 8)
            br.close()
    finally:
        srv.terminate()

    # ------------------------------------------------------------- verdicts
    print(json.dumps(out, indent=2))
    cold = out["cold_cast"]; sand = out["sand_cast"]
    ch, sh = out["cold_hit"]["hit"], out["sand_hit"]["hit"]
    # Field clamps (deformation.js:383-384): R saturates at 0.55 m depression,
    # G at 0.34 m berm -- the crater's 0.66 write is DESIGNED to bottom the
    # field out, so thresholds are set against the clamps, not the raw write.
    checks = {}
    checks["virgin ground before both casts (dep<0.05, ice<0.05)"] = (
        cold["centre_before"]["dep"] < 0.05 and cold["centre_before"]["ice"] < 0.05
        and sand["centre_before"]["dep"] < 0.05 and sand["centre_before"]["ice"] < 0.05)
    checks["sand centre carves >= 0.40 m depression"] = \
        sand["centre_dep_delta"] >= 0.40
    checks["sand centre reaches the 0.55 m field clamp (>= 0.47)"] = \
        sand["centre_after"]["dep"] >= 0.47
    checks["sand ring berm raised (>= 0.25 m, clamp 0.34)"] = \
        sand["ring_berm_delta_max"] >= 0.25
    checks["sand ring berm exceeds its own dep there (berm-dominant lip)"] = \
        sand["ring_berm_delta_max"] > sand["ring_dep_at_best_berm"]
    checks["cold centre stays glaze-only (< 0.25 m)"] = \
        cold["centre_dep_delta"] < 0.25
    checks["sand centre >= 2x cold centre"] = \
        sand["centre_dep_delta"] >= 2.0 * max(cold["centre_dep_delta"], 1e-6)
    hits_ok = "dmg" in ch and "dmg" in sh
    checks["both realms landed the spike hit"] = hits_ok
    if hits_ok:
        checks["damage invariant (|d| < 0.01)"] = abs(ch["dmg"] - sh["dmg"]) < 0.01
        checks["stun invariant (|d| < 0.10 s)"] = \
            abs(ch["stunLeft"] - sh["stunLeft"]) < 0.10
        checks["poise-break invariant (|d| < 0.10 s)"] = \
            abs(ch["breakLeft"] - sh["breakLeft"]) < 0.10
        checks["stun actually applied (~1.5 s)"] = \
            1.2 < sh["stunLeft"] <= 1.55 and 1.2 < ch["stunLeft"] <= 1.55
    for k, v in checks.items():
        print(f"  {'PASS' if v else 'FAIL'}  {k}")
    ok = all(checks.values())
    print("\nRESULT: " + ("OK" if ok else "BROKEN -- read the numbers above"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
