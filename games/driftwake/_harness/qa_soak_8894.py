# -*- coding: utf-8 -*-
"""
qa_soak_8894.py -- ONE continuous long soak, played like a player.

Drives a single uninterrupted session of >= 12 minutes of GAME time with
?test on: walk, run, surf, fight packs, mini boss, realm boss, portal, two
deaths, dev-portal realm switches, every spell repeatedly, the storm edge,
an idle sit at a shrine, and a return to the starting realm.

Samples every 15 s of GAME time and reports TRENDS: draw calls, triangles,
JS heap, WebGL geometry/texture/program counts, registry + enemy counts,
mote occupancy, spell pool occupancy, DOM node count, cumulative
setTimeout / setInterval / rAF / addEventListener churn.

Every wait is GAME-time (rAF poll of SNOWFLOW.combat.registry.time) with a
wall-clock escape hatch that records a stall rather than hanging.

Read-only on game state except for the player inputs a real player makes,
plus three deliberate probe pokes that are logged as such:
  - `character.health = 0`      to die (through the real death path)
  - `bosses.spawnBoss(kind)`    the documented force path
  - `registry.damage(id, n)`    to finish a boss inside the soak budget
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

OUT_JSON = HERE / "qa_soak_8894.out.json"

# --------------------------------------------------------------------------
# The in-page driver. A synchronous IIFE that installs the instrumentation,
# kicks off the scripted session and the sampler, and returns immediately.
# --------------------------------------------------------------------------
DRIVER = r"""
(() => {
const S = SNOWFLOW;
const reg = S.combat.registry;
const I = S.input;
const ch = S.character;

// ---------------------------------------------------------------- counters
if (!window.__soakPatched) {
    window.__soakPatched = true;
    window.__stMade = 0; window.__siMade = 0; window.__rafMade = 0;
    window.__lisAdd = 0; window.__lisRem = 0;
    const st = window.setTimeout, si = window.setInterval;
    const rf = window.requestAnimationFrame.bind(window);
    window.setTimeout = function (...a) { window.__stMade++; return st.apply(window, a); };
    window.setInterval = function (...a) { window.__siMade++; return si.apply(window, a); };
    window.requestAnimationFrame = function (cb) { window.__rafMade++; return rf(cb); };
    const ael = EventTarget.prototype.addEventListener;
    const rel = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (...a) {
        window.__lisAdd++; return ael.apply(this, a);
    };
    EventTarget.prototype.removeEventListener = function (...a) {
        window.__lisRem++; return rel.apply(this, a);
    };
}

const soak = window.__soak = {
    phase: "init", phaseLog: [], samples: [], notes: [], stalls: 0,
    startedWall: Date.now(), gt0: reg.time, done: false, fatal: null,
};

const gt = () => +(reg.time - soak.gt0).toFixed(2);
function note(msg, extra) {
    soak.notes.push(Object.assign(
        { gt: gt(), wall: Date.now(), phase: soak.phase, msg }, extra || {}));
}
function setPhase(p) {
    soak.phase = p;
    soak.phaseLog.push({ gt: gt(), wall: Date.now(), phase: p });
}

// ------------------------------------------------------------ game-time wait
// Polls registry.time over rAF. The wall-clock escape exists so a frozen
// frame loop records a STALL instead of hanging the whole soak.
function wait(sec) {
    return new Promise((res) => {
        const t0 = reg.time, w0 = Date.now();
        const budget = sec * 1000 * 6 + 20000;
        const tick = () => {
            if (reg.time - t0 >= sec) return res();
            if (Date.now() - w0 > budget) {
                soak.stalls++;
                note("STALL: game time did not advance", {
                    wantSec: sec, gotSec: +(reg.time - t0).toFixed(2),
                    wallMs: Date.now() - w0 });
                return res();
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}

// ------------------------------------------------------------------- inputs
function key(code, down) {
    window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup",
        { code, key: code, bubbles: true, cancelable: true }));
}
function tap(code) { key(code, true); key(code, false); }
function mouse(type, button) {
    document.dispatchEvent(new MouseEvent(type, {
        button, buttons: button === 0 ? 1 : 2, bubbles: true, cancelable: true }));
}
function look(dx, dy) {
    document.dispatchEvent(new MouseEvent("mousemove",
        { movementX: dx, movementY: dy || 0, bubbles: true }));
}
const LOOK_SCALE = 0.0022;

function faceToward(tx, tz) {
    const dx = tx - ch.position.x, dz = tz - ch.position.z;
    const want = Math.atan2(dx, -dz);
    let d = want - S.rig.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const step = Math.max(-0.30, Math.min(0.30, d));
    look(step / LOOK_SCALE, 0);
}

function fwd(on) { key("KeyW", on); }
function strafe(code, on) { key(code, on); }

// The player's pointer lock. Automation cannot produce the real gesture, and
// mousedown / mousemove / surf all gate on it; this is the documented pin.
I.locked = true;

// ---------------------------------------------------------------- targeting
function nearest(maxD) {
    let best = -1, bd = maxD || 1e9;
    for (let i = 0; i < reg.count; i++) {
        if (reg.hp[i] <= 0) continue;
        if (reg.kind[i] === "dummy") continue;
        const dx = reg.x[i] - ch.position.x, dz = reg.z[i] - ch.position.z;
        const d = Math.hypot(dx, dz);
        if (d < bd) { bd = d; best = i; }
    }
    return best < 0 ? null
        : { slot: best, id: reg.idOf[best], d: bd, x: reg.x[best], z: reg.z[best] };
}

// ------------------------------------------------------------------- spells
const CASTS = ["Digit2", "Digit3", "Digit4", "Digit5", "Digit1"];
let castI = 0;
function castNext() { tap(CASTS[castI++ % CASTS.length]); }

// -------------------------------------------------------------- the sampler
function poolOf(o) {
    if (!o) return -1;
    if (typeof o.liveCount === "number") return o.liveCount;
    if (typeof o._live === "number") return o._live;
    if (typeof o.active === "boolean") return o.active ? 1 : 0;
    return -1;
}

function snap(tag) {
    const r = S.renderer, info = r.info, ps = S.perfStats;
    let objs = 0, meshes = 0, visM = 0;
    S.scene.traverse((o) => {
        objs++;
        if (o.isMesh || o.isSkinnedMesh) { meshes++; if (o.visible) visM++; }
    });
    let regAlive = 0;
    for (let i = 0; i < reg.count; i++) if (reg.hp[i] > 0) regAlive++;
    const en = S.combat.enemies;
    let enAlive = 0;
    for (let i = 0; i < en.alive.length; i++) if (en.alive[i]) enAlive++;
    const vis = en.vis || null;
    const sp = S.spells;
    const m = performance.memory || null;
    const bs = S.combat.bosses.stats;
    const ps_ = S.portal.stats;
    const hs = S.hitstop.stats;
    let hsTrig = 0;
    if (hs && hs.triggers) for (const k in hs.triggers) hsTrig += hs.triggers[k];

    soak.samples.push({
        gt: gt(), wall: Date.now(), phase: soak.phase, tag: tag || null,
        dc: ps.drawCalls, tri: ps.triangles,
        fps: +ps.fps.toFixed(1), mean: +ps.mean.toFixed(2), p99: +ps.p99.toFixed(2),
        heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(2) : null,
        heapTotMB: m ? +(m.totalJSHeapSize / 1048576).toFixed(2) : null,
        geo: info.memory.geometries, tex: info.memory.textures,
        prog: info.programs ? info.programs.length : -1,
        sceneObjs: objs, meshes, visMeshes: visM,
        regCount: reg.count, regAlive, evCount: reg.eventCount,
        enAlive, insts: vis ? vis._insts.length : -1,
        types: vis ? vis._types.size : -1, mats: vis ? vis.materials.length : -1,
        // The §5.2 attack-token pools. These are FREE counts: if a removal
        // path ever drops a held token they ratchet down and never recover,
        // and the field silently stops attacking.
        meleeFree: en._meleeFree, rangedFree: en._rangedFree,
        instLive: vis ? vis._insts.filter((o) => o.live).length : -1,
        motes: S.motes.stats.active, motesSpawned: S.motes.stats.spawned,
        motesPicked: S.motes.stats.picked,
        bolts: poolOf(sp.bolt), crystals: poolOf(sp.crystals),
        strands: poolOf(sp.water), burst: poolOf(sp.burst),
        shock: poolOf(sp.shockwave),
        spSweep: poolOf(sp.sweep), spRibbon: poolOf(sp.ribbon),
        spBloom: poolOf(sp.bloom), spVortex: poolOf(sp.vortex),
        spCrystallize: poolOf(sp.crystallize),
        dom: document.getElementsByTagName("*").length,
        headKids: document.head.children.length,
        bodyKids: document.body.children.length,
        canvases: document.getElementsByTagName("canvas").length,
        hsTrig, hsRejected: hs ? hs.rejected : -1,
        bossState: bs.state, bossKind: bs.kind,
        bossHpFrac: +(bs.hpFrac || 0).toFixed(3), bossPhase: bs.phase,
        portalOpen: ps_.open, portalTok: ps_.token, portalEntered: ps_.entered,
        realm: S.combat.encounters.realm,
        lvl: S.progression.level, deaths: S.progression.deaths,
        dead: S.progression.dead,
        hp: +ch.health.toFixed(1), hpMax: ch.healthMax,
        px: +ch.position.x.toFixed(1), pz: +ch.position.z.toFixed(1),
        edge01: +S.terrain.edge01(ch.position.x, ch.position.z).toFixed(3),
        stMade: window.__stMade, siMade: window.__siMade,
        rafMade: window.__rafMade,
        lisAdd: window.__lisAdd, lisRem: window.__lisRem,
        lisNet: window.__lisAdd - window.__lisRem,
        stalls: soak.stalls,
    });
}

(async function sampler() {
    while (!soak.done) { try { snap(); } catch (e) { note("snap threw: " + e); }
                         await wait(15); }
})();

// ------------------------------------------------------------- the sessions
async function combat(sec, label) {
    // Hold the bolt (LMB) and rotate the other five on a ~0.7 s cycle while
    // closing on whatever the director has put nearest.
    mouse("mousedown", 0);
    fwd(true);
    const t0 = reg.time;
    let i = 0;
    while (reg.time - t0 < sec) {
        const n = nearest();
        if (n) {
            faceToward(n.x, n.z);
            // back off if we are inside its swing, otherwise close
            if (n.d < 2.6) { fwd(false); strafe("KeyS", true); }
            else { strafe("KeyS", false); fwd(true); }
        } else {
            // no pack up: wander so the director's roam path can place one
            fwd(true); strafe("KeyS", false);
            if ((i % 12) === 0) look(220, 0);
        }
        if ((i % 2) === 0) castNext();
        if ((i % 17) === 0) tap("Space");
        i++;
        await wait(0.7);
    }
    mouse("mouseup", 0);
    fwd(false); strafe("KeyS", false);
    note("combat block done: " + label, { casts: i });
}

async function walk(sec, tx, tz, opts) {
    const o = opts || {};
    if (o.surf) I.surf = true;
    if (o.run) tap("ShiftLeft");
    fwd(true);
    const t0 = reg.time;
    while (reg.time - t0 < sec) {
        if (tx !== null) faceToward(tx, tz);
        else look(40, 0);
        await wait(0.35);
    }
    fwd(false);
    if (o.surf) I.surf = false;
    if (o.run) tap("ShiftLeft");
}

async function run() {
try {
    // ---------------------------------------------------- 0. quiet baseline
    setPhase("A-baseline-idle");
    snap("BASELINE");
    await wait(12);
    snap("BASELINE-2");

    // ------------------------------------------------------- 1. walk + run
    setPhase("B-walk-run");
    await walk(30, null, null, { run: true });
    await walk(18, 0, 0, {});

    // ---------------------------------------------------------- 2. surf ride
    setPhase("C-surf");
    await walk(34, null, null, { surf: true, run: true });

    // -------------------------------------------------------- 3. first packs
    setPhase("D-combat-1");
    await combat(90, "cold pack 1");

    // ------------------------------------------------------ 4. the storm edge
    setPhase("E-storm-edge");
    {
        const R = S.terrain.playRadius || 240;
        const a = 0.9;
        await walk(45, Math.cos(a) * R * 1.4, Math.sin(a) * R * 1.4,
                   { run: true, surf: true });
        note("edge reached", {
            edge01: +S.terrain.edge01(ch.position.x, ch.position.z).toFixed(3),
            r: +Math.hypot(ch.position.x, ch.position.z).toFixed(1),
            playRadius: R });
        await walk(20, null, null, { surf: true });
    }

    // -------------------------------------------------------- 5. more packs
    setPhase("F-combat-2");
    await walk(16, 0, 0, { run: true });
    await combat(80, "cold pack 2");

    // ------------------------------------------------------------ 6. death 1
    setPhase("G-death-1");
    note("PROBE POKE: character.health = 0 (death path 1)");
    ch.health = 0;
    await wait(12);
    note("after death 1", { dead: S.progression.dead,
                            deaths: S.progression.deaths,
                            hp: ch.health,
                            px: +ch.position.x.toFixed(1),
                            pz: +ch.position.z.toFixed(1) });

    // ------------------------------------------------------------ 7. mini boss
    setPhase("H-mini-boss");
    {
        const ok = S.combat.bosses.spawnBoss("mini");
        note("PROBE POKE: spawnBoss('mini')", { ok: !!ok,
                                                state: S.combat.bosses.stats.state });
        await wait(3);
        const b = S.combat.bosses.stats;
        if (b.id > 0) {
            await walk(10, b.arenaX, b.arenaZ, { run: true });
            await combat(55, "mini boss");
            // finish it inside the budget, through the real damage path
            const st = S.combat.bosses.stats;
            if (st.id > 0 && st.hp > 0) {
                note("PROBE POKE: registry.damage(mini, remaining)",
                     { hp: st.hp });
                reg.damage(st.id, st.hp + 50, { tag: "soak" });
            }
            await wait(8);
        } else { note("mini boss never spawned", { stats: b.state }); }
    }

    // ----------------------------------------------------------- 8. realm boss
    setPhase("I-realm-boss");
    {
        const ok = S.combat.bosses.spawnBoss("realm");
        note("PROBE POKE: spawnBoss('realm')", { ok: !!ok,
                                                 state: S.combat.bosses.stats.state });
        await wait(3);
        const b = S.combat.bosses.stats;
        if (b.id > 0) {
            await walk(10, b.arenaX, b.arenaZ, { run: true });
            await combat(50, "realm boss p1");
            let st = S.combat.bosses.stats;
            if (st.id > 0 && st.hp > 0) {
                // drop it to 50% so PHASE 2 actually runs, then fight on
                note("PROBE POKE: realm boss -> phase 2", { hp: st.hp,
                                                            frac: st.hpFrac });
                reg.damage(st.id, Math.max(0, st.hp - st.hpMax * 0.5),
                           { tag: "soak" });
                await wait(6);
                note("phase after cut", { phase: S.combat.bosses.stats.phase,
                                          frac: S.combat.bosses.stats.hpFrac });
                await combat(40, "realm boss p2");
                st = S.combat.bosses.stats;
                if (st.id > 0 && st.hp > 0) {
                    note("PROBE POKE: registry.damage(realm, remaining)",
                         { hp: st.hp });
                    reg.damage(st.id, st.hp + 200, { tag: "soak" });
                }
            }
            await wait(10);
            note("realm boss down", { bossState: S.combat.bosses.stats.state,
                                      portal: S.portal.stats.open,
                                      portalTok: S.portal.stats.token });
        } else { note("realm boss never spawned", { stats: b.state }); }
    }

    // ------------------------------------------------------------ 9. portal
    setPhase("J-portal");
    {
        const p = S.portal.stats;
        if (p.open) {
            const t0 = reg.time;
            while (!S.portal.stats.entered && reg.time - t0 < 70) {
                await walk(4, S.portal.stats.x, S.portal.stats.z,
                           { run: true, surf: true });
            }
            note("portal walk done", {
                entered: S.portal.stats.entered,
                realm: S.combat.encounters.realm,
                dist: +Math.hypot(ch.position.x - S.portal.stats.x,
                                  ch.position.z - S.portal.stats.z).toFixed(1) });
            await wait(10);
        } else { note("portal never opened - skipping portal leg"); }
    }

    // ----------------------------------------------------------- 10. death 2
    setPhase("K-death-2");
    note("PROBE POKE: character.health = 0 (death path 2)");
    ch.health = 0;
    await wait(12);
    note("after death 2", { dead: S.progression.dead,
                            deaths: S.progression.deaths, hp: ch.health });

    // ------------------------------------------------- 11. dev realm portals
    setPhase("L-realm-sand");
    tap("Digit6");
    await wait(8);
    note("after Digit6", { realm: S.combat.encounters.realm });
    await combat(55, "sand pack");

    setPhase("M-realm-ash");
    tap("Digit7");
    await wait(8);
    note("after Digit7", { realm: S.combat.encounters.realm });
    await combat(55, "ash pack");

    // ------------------------------------------------------- 12. shrine idle
    setPhase("N-shrine-idle");
    {
        const sh = (S.shrine && S.shrine.positions) ? S.shrine.positions : null;
        const p0 = sh && sh.length > 1 ? sh[1]
                 : (sh && sh.length ? sh[0] : { x: 0, z: 0 });
        await walk(30, p0.x, p0.z, { run: true, surf: true });
        note("at shrine", { x: p0.x, z: p0.z,
                            d: +Math.hypot(ch.position.x - p0.x,
                                           ch.position.z - p0.z).toFixed(1) });
        await wait(50);          // fully idle, no input at all
    }

    // ------------------------------------------- 13. home to the start realm
    setPhase("O-return-cold");
    {
        // Digit7 while Ash is live toggles back to Cold (main.js realmPortal)
        if (S.combat.encounters.realm !== "cold") tap("Digit7");
        await wait(10);
        if (S.combat.encounters.realm !== "cold") { tap("Digit6"); await wait(10); }
        note("realm after return", { realm: S.combat.encounters.realm });
        await walk(25, 0, 0, { run: true });
    }

    // --------------------------------------------- 14. the quiescent compare
    setPhase("P-final-idle");
    // Every held input released; nothing cast; let the world settle so the
    // final numbers are comparable with the BASELINE pair at the top.
    fwd(false); strafe("KeyS", false); I.surf = false;
    I.boltHeld = false; I.spellHeld2 = false;
    mouse("mouseup", 0);
    snap("FINAL-SETTLE-START");
    await wait(45);
    snap("FINAL");
    await wait(15);
    snap("FINAL-2");
} catch (e) {
    soak.fatal = String((e && e.stack) || e);
    note("FATAL: " + soak.fatal);
}
    soak.done = true;
    soak.endedWall = Date.now();
    soak.gtTotal = gt();
}
run();
return "started";
})()
"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)

    console = []
    errors = []
    out = {"console": console, "pageerrors": errors}

    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})

            def on_console(msg):
                if msg.type in ("warning", "error"):
                    try:
                        loc = msg.location
                    except Exception:
                        loc = {}
                    console.append({
                        "wall": int(time.time() * 1000), "type": msg.type,
                        "text": msg.text[:600],
                        "url": (loc or {}).get("url", ""),
                        "line": (loc or {}).get("lineNumber", -1)})

            def on_pageerror(err):
                errors.append({"wall": int(time.time() * 1000),
                               "text": str(err)[:2000]})

            pg.on("console", on_console)
            pg.on("pageerror", on_pageerror)

            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)

            # DELIBERATE, LOGGED DEVIATION. Six sibling WebGL harnesses are
            # sharing this GPU, which drove frame times past MAX_FRAME_MS
            # (main.js:147, 100 ms) — and a frame over that clamp advances
            # the GAME clock slower than the wall clock, so a 12-minute
            # game-time session could not finish inside any sane wall budget.
            # `resolutionScale` 0.5 quarters the pixels and leaves EVERY
            # render pass, system and update path enabled (unlike stepping
            # the preset down, which switches ssr/dof/mountains off and would
            # stop exercising those code paths). Leak trends — heap, WebGL
            # object counts, pool occupancy, registry counts — do not depend
            # on output resolution. Absolute ms/fps numbers from this run are
            # NOT comparable to a default-resolution run and are reported as
            # contaminated either way, because of the sibling load.
            pg.evaluate("() => SNOWFLOW.set('resolutionScale', 0.5)")
            pg.wait_for_timeout(1500)

            boot = pg.evaluate("""() => ({
                resolutionScale: SNOWFLOW.S.resolutionScale,
                preset: SNOWFLOW.S.preset,
                testMode: SNOWFLOW.progression.testMode,
                unlocked: Array.from(SNOWFLOW.progression.unlocked || []),
                level: SNOWFLOW.progression.level,
                realm: SNOWFLOW.combat.encounters.realm,
                deaths: SNOWFLOW.progression.deaths,
            })""")
            out["boot"] = boot
            print("BOOT", json.dumps(boot), flush=True)

            pg.screenshot(path=str(HERE / "soak_shot_start.png"))

            started = pg.evaluate(DRIVER)
            print("driver:", started, flush=True)

            mid_shot = False
            t_start = time.time()
            LIMIT_S = 50 * 60
            while True:
                time.sleep(20)
                try:
                    st = pg.evaluate("""() => {
                        const s = window.__soak;
                        return { phase: s.phase, n: s.samples.length,
                                 done: s.done, gt: s.samples.length ?
                                    s.samples[s.samples.length-1].gt : 0,
                                 stalls: s.stalls, fatal: s.fatal };
                    }""")
                except Exception as e:
                    print("poll failed:", e, flush=True)
                    break
                el = int(time.time() - t_start)
                print("  [%4ds] phase=%-16s samples=%2d gt=%7.1f stalls=%d"
                      % (el, st["phase"], st["n"], st["gt"], st["stalls"]),
                      flush=True)
                if not mid_shot and st["gt"] >= 380:
                    pg.screenshot(path=str(HERE / "soak_shot_mid.png"))
                    mid_shot = True
                    print("  (mid screenshot)", flush=True)
                if st["done"]:
                    break
                if time.time() - t_start > LIMIT_S:
                    print("  WALL LIMIT hit - stopping", flush=True)
                    break

            pg.screenshot(path=str(HERE / "soak_shot_end.png"))
            soak = pg.evaluate("() => window.__soak")
            out["soak"] = soak
            out["endState"] = pg.evaluate("""() => ({
                realm: SNOWFLOW.combat.encounters.realm,
                level: SNOWFLOW.progression.level,
                deaths: SNOWFLOW.progression.deaths,
                dead: SNOWFLOW.progression.dead,
                hp: SNOWFLOW.character.health,
                testMode: SNOWFLOW.progression.testMode,
                bossState: SNOWFLOW.combat.bosses.stats.state,
                portal: SNOWFLOW.portal.stats.open,
            })""")
            br.close()
    finally:
        srv.terminate()
        OUT_JSON.write_text(json.dumps(out, indent=1), encoding="utf-8")
        print("wrote", OUT_JSON, flush=True)


if __name__ == "__main__":
    main()
