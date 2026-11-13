# -*- coding: utf-8 -*-
"""
qa_questcore.py -- lane Q (the quest engine) proof, on the LIVE page.

main.js does not construct the QuestSystem yet, so it is dynamically imported
and driven by a rAF loop with GAME dt (registry.time deltas). progression.js,
bossEncounters.js and portal.js are the page's own (already edited) modules,
so their emits are the real ones.

Flow (QUEST_DESIGN §6/§10, lane Q PROVE list):
  fresh save (PLAY = progression.newGame()) -> tracker cold.1
  touch the spawn shrine -> cold.2 (+ shrine line + echo.cold.1)
  surf 150 m (input.surf + input.moveZ pinned) -> cold.3
  forced imp pack appears ~40 m ahead -> kill 5 -> cold.4 + first ding
  boss director NOT armed while cold.4 is open (sampled over game time)
  activate 3 ring shrines (following the waypoint) -> cold.5 AND mini armed
  kill the mini boss -> cold.6
  save -> reload -> (register) -> CONTINUE -> the step survives

Scripted shortcuts (reported, not hidden): the player is made invulnerable
(progression.graceUntil) so a probe cannot die mid-run; shrine touches and the
approach to the arena are teleports onto the real stand points; kills are
registry.damage() calls (the real damage/kill-event path). Every emit is
observed through bus listeners.

    python _harness/qa_questcore.py
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8921
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# A threading static server with a deep accept backlog: under a loaded
# machine the stock `python -m http.server` (backlog 5) refused the enemy-body
# GLB burst with ERR_CONNECTION_REFUSED (measured on this port, 2026-09-30).
SERVER_CODE = """
import http.server, functools, sys
class S(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass
S(('', int(sys.argv[1])), functools.partial(H, directory=sys.argv[2])).serve_forever()
"""

# Helpers defined on every navigation (they only touch SNOWFLOW lazily).
PRELUDE = r"""
window.__gw = (sec) => new Promise((res) => {
    const r = SNOWFLOW.combat.registry, t0 = r.time;
    const tick = () => (r.time - t0 >= sec) ? res() : requestAnimationFrame(tick);
    tick();
});
window.__until = (fn, maxSec) => new Promise((res) => {
    const r = SNOWFLOW.combat.registry, t0 = r.time;
    const tick = () => {
        let ok = false;
        try { ok = !!fn(); } catch (e) { ok = false; }
        if (ok) return res({ ok: true, waited: +(r.time - t0).toFixed(2) });
        if (r.time - t0 >= maxSec) return res({ ok: false, waited: +(r.time - t0).toFixed(2) });
        requestAnimationFrame(tick);
    };
    tick();
});
window.__pin = (name, val) => Object.defineProperty(SNOWFLOW.input, name,
    { configurable: true, enumerable: true, get: () => val, set: () => {} });
window.__unpin = (name, val) => Object.defineProperty(SNOWFLOW.input, name,
    { configurable: true, enumerable: true, writable: true, value: val });
window.__tp = (x, z) => {
    const c = SNOWFLOW.character;
    c.position.set(x, SNOWFLOW.terrain.heightAt(x, z), z);
    c.velocity.set(0, 0, 0);
};
window.__mkQS = async () => {
    const SF = SNOWFLOW;
    const { bus } = await import('/games/driftwake/src/quests/events.js');
    // [lane INT] The INTEGRATED build: main.js constructs and drives the
    // QuestSystem itself (SNOWFLOW.quests; its frame calls quests.update(dt)
    // right after progression.update, and enterRealm emits 'realm:entered').
    // Reuse it: a second engine would double every completion and every XP
    // grant. Only the event log is installed here.
    if (SF.quests && SF.meaning) {
        const reg0 = SF.combat.registry;
        window.__bus = bus;
        window.__log = window.__log || [];
        const EV0 = ['quest:step', 'quest:complete', 'quest:waypoint', 'dialogue',
            'hint', 'hint:clear', 'ending:begin', 'shrine:activated',
            'enemy:killed', 'boss:killed', 'portal:entered', 'player:levelup',
            'player:died'];
        for (const ev of EV0) {
            bus.on(ev, (p) => window.__log.push({ t: +reg0.time.toFixed(2), ev,
                p: p == null ? null : JSON.parse(JSON.stringify(p)) }));
        }
        window.__qs = SF.quests;
        return SF.quests;
    }
    const { QuestSystem } = await import('/games/driftwake/src/quests/questSystem.js');
    const reg = SF.combat.registry;
    window.__bus = bus;
    window.__log = window.__log || [];
    const EV = ['quest:step', 'quest:complete', 'quest:waypoint', 'dialogue',
        'hint', 'hint:clear', 'ending:begin', 'shrine:activated',
        'enemy:killed', 'boss:killed', 'portal:entered', 'player:levelup',
        'player:died'];
    for (const ev of EV) {
        bus.on(ev, (p) => window.__log.push({ t: +reg.time.toFixed(2), ev,
            p: p == null ? null : JSON.parse(JSON.stringify(p)) }));
    }
    const ctx = {
        scene: SF.scene, terrain: SF.terrain, character: SF.character,
        rig: SF.rig, spells: SF.spells, registry: reg,
        enemies: SF.combat.enemies, encounters: SF.combat.encounters,
        bosses: SF.combat.bosses, portal: SF.portal, shrine: SF.shrine,
        landmarks: SF.landmarks, progression: SF.progression,
        realms: SF.realms, enterRealm: SF.enterRealm,
        getRealm: () => SF.combat.bosses.realm,
        input: SF.input, S: SF.S, bus, crystals: SF.spells.crystals,
        sky: SF.sky, shadows: SF.shadows, overlay: SF.overlay,
    };
    const qs = new QuestSystem(ctx);
    window.__qs = qs;
    let lt = reg.time;
    const loop = () => {
        const t = reg.time;
        const dt = t - lt;
        lt = t;
        qs.update(dt > 0 ? dt : 0);
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return qs;
};
window.__evs = (since) => (window.__log || []).filter((e) => e.t >= since);
"""

J_SETUP = r"""(async () => {
    const SF = SNOWFLOW;
    if (SF.applyPreset) SF.applyPreset('performance');
    try { localStorage.removeItem('driftwake_save'); } catch (e) {}
    const qs = await __mkQS();
    const reg = SF.combat.registry, B = SF.combat.bosses, P = SF.progression;
    const atRegister = qs.tracked ? qs.tracked.stepId : null;
    // PLAY = a NEW RUN.
    const tPlay = reg.time;
    window.__tPlay = tPlay;
    P.newGame();
    P.graceUntil = 1e9;            // probe cannot die mid-run (reported)
    await __gw(0.6);
    const sp = SF.shrine.positions[0];
    const c = SF.character;
    return {
        testMode: P.testMode, level: P.level, xp: P.xp, xpNeed: P.xpNeed,
        schema: JSON.parse(localStorage.getItem('driftwake_save') || '{}').schemaVer,
        atRegister, tracked: qs.tracked, waypoint: qs.waypoint,
        spawnShrine: { id: sp.id, x: +sp.x.toFixed(2), z: +sp.z.toFixed(2),
            distFromPlayer: +Math.hypot(sp.x - c.position.x, sp.z - c.position.z).toFixed(2) },
        bossGateInstalled: typeof B.questGate === 'function',
        bossState: B.state, bossEligible: B._eligibleKind(),
        lit: P.litShrines('cold').slice(),
        events: __evs(tPlay).map(e => e.ev + ' ' + JSON.stringify(e.p)),
    };
})()"""

J_TOUCH = r"""(async () => {
    const SF = SNOWFLOW, qs = __qs, reg = SF.combat.registry, P = SF.progression;
    const t0 = reg.time;
    const sp = SF.shrine.positions[0];
    __tp(sp.sx, sp.sz);             // the stand point, 4.5 m from the anchor
    const u = await __until(() => qs.main.cold >= 1, 5);
    await __gw(0.3);
    return {
        until: u, main: qs.main, tracked: qs.tracked, waypoint: qs.waypoint,
        xp: P.xp, level: P.level, lit: P.litShrines('cold').slice(),
        lastShrineId: P.lastShrineId,
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)),
    };
})()"""

J_SURF = r"""(async () => {
    const SF = SNOWFLOW, qs = __qs, reg = SF.combat.registry, P = SF.progression;
    const c = SF.character;
    const t0 = reg.time;
    const x0 = c.position.x, z0 = c.position.z;
    const s0 = qs.surfM;
    __pin('surf', true);
    __pin('moveZ', 1);
    const u = await __until(() => qs.main.cold >= 2, 60);
    const surfed = qs.surfM - s0;
    __unpin('surf', false);
    __unpin('moveZ', 0);
    const dispM = Math.hypot(c.position.x - x0, c.position.z - z0);
    const u2 = await __until(() => qs.packSpawns >= 1, 4);
    const en = SF.combat.enemies;
    const keys = Array.from(qs._forced).map((id) => {
        for (let i = 0; i < en.id.length; i++) {
            if (en.id[i] === id && en.alive[i]) return en.units[en.unitOf[i]].key;
        }
        return null;
    });
    const px = c.position.x, pz = c.position.z;
    return {
        until: u, surfedM: +surfed.toFixed(1), surfM: +qs.surfM.toFixed(1),
        displacementM: +dispM.toFixed(1), main: qs.main, tracked: qs.tracked,
        packUntil: u2, packSpawns: qs.packSpawns, forced: Array.from(qs._forced),
        forcedKeys: keys,
        packCentreDistFromPlayerNow: +Math.hypot(qs.packX - px, qs.packZ - pz).toFixed(1),
        waypoint: qs.waypoint, xp: P.xp, level: P.level,
        events: __evs(t0).filter(e => e.ev !== 'quest:step' ||
            (e.p && e.p.reason !== 'progress')).map(e => e.ev + ' ' + JSON.stringify(e.p)),
        surfProgressEmits: __evs(t0).filter(e => e.ev === 'quest:step' &&
            e.p && e.p.reason === 'progress').map(e => e.p.progress.have),
    };
})()"""

J_KILL = r"""(async () => {
    const SF = SNOWFLOW, qs = __qs, reg = SF.combat.registry, P = SF.progression;
    const c = SF.character;
    const t0 = reg.time;
    // Ride at the pack the way a player would (walk/run), until one is close.
    const dx = qs.packX - c.position.x, dz = qs.packZ - c.position.z;
    SF.rig.yaw = Math.atan2(dx, -dz);
    __pin('moveZ', 1);
    const near = () => {
        let best = 1e9;
        for (const id of qs._forced) {
            const s = reg.slot(id);
            if (s < 0) continue;
            best = Math.min(best, Math.hypot(reg.x[s] - c.position.x, reg.z[s] - c.position.z));
        }
        return best;
    };
    const ap = await __until(() => near() < 14, 20);
    __unpin('moveZ', 0);
    const nearAtStop = near();
    const wpBefore = qs.waypoint;
    const killed = [];
    for (const id of Array.from(qs._forced)) {
        const s = reg.slot(id);
        if (s < 0 || reg.hp[s] <= 0) continue;
        reg.damage(id, reg.hp[s] + 1, { tag: 'probe' });
        killed.push(id);
        await __gw(0.4);
    }
    const u = await __until(() => qs.main.cold >= 3, 5);
    await __gw(0.5);
    const lv = __evs(__tPlay).filter(e => e.ev === 'player:levelup');
    return {
        approach: ap, nearAtStop: +nearAtStop.toFixed(1), wpBefore,
        killed, until: u, main: qs.main, kills: qs.killsForOnboarding,
        tracked: qs.tracked, waypoint: qs.waypoint, level: P.level, xp: P.xp,
        xpNeed: P.xpNeed,
        firstDingGameS: lv.length ? +(lv[0].t - __tPlay).toFixed(2) : null,
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)),
    };
})()"""

J_RING = r"""(async () => {
    const SF = SNOWFLOW, qs = __qs, reg = SF.combat.registry, P = SF.progression;
    const B = SF.combat.bosses, c = SF.character;
    const t0 = reg.time;
    // ---- NOT armed before: sample the director over game time.
    const before = [];
    for (let i = 0; i < 18; i++) {
        before.push({ state: B.state, eligible: B._eligibleKind(),
            gate: qs.bossUnlocked('cold', 'mini') });
        await __gw(0.5);
    }
    const nearestDormant = () => {
        let best = null, bd = 1e18;
        for (let i = 1; i < SF.shrine.positions.length; i++) {
            const p = SF.shrine.positions[i];
            if (P.isShrineLit('cold', p.id)) continue;
            const d = (p.x - c.position.x) ** 2 + (p.z - c.position.z) ** 2;
            if (d < bd) { bd = d; best = p; }
        }
        return best;
    };
    const visits = [];
    for (let k = 0; k < 3; k++) {
        await __gw(0.4);                         // let the waypoint refresh
        const wp = qs.waypoint;
        const want = nearestDormant();
        const target = SF.shrine.positions.find(p =>
            wp && Math.abs(p.x - wp.x) < 0.01 && Math.abs(p.z - wp.z) < 0.01);
        visits.push({ waypoint: wp, nearestDormant: want ? want.id : null,
            waypointIsNearestDormant: !!(target && want && target.id === want.id),
            bossStateBeforeTouch: B.state, eligibleBeforeTouch: B._eligibleKind() });
        const go = target || want;
        __tp(go.sx, go.sz);
        await __gw(0.8);
    }
    const u = await __until(() => qs.main.cold >= 4, 5);
    const armedAt = reg.time;
    const arm = await __until(() => B.state === 'pending' && B.kind === 'mini', 12);
    await __gw(0.4);
    return {
        notArmedSamples: before.length,
        armedWhileClosed: before.filter(s => s.state !== 'idle' || s.eligible !== null).length,
        gateOpenWhileClosed: before.filter(s => s.gate).length,
        firstSample: before[0], visits, until: u, arm,
        armLatencyS: +(reg.time - armedAt).toFixed(2),
        main: qs.main, tracked: qs.tracked,
        director: { state: B.state, kind: B.kind, ax: +B.ax.toFixed(1), az: +B.az.toFixed(1),
            eligible: B._eligibleKind() },
        waypoint: qs.waypoint, lit: P.litShrines('cold').slice(),
        level: P.level, xp: P.xp,
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)),
    };
})()"""

J_BOSS = r"""(async () => {
    const SF = SNOWFLOW, qs = __qs, reg = SF.combat.registry, P = SF.progression;
    const B = SF.combat.bosses, c = SF.character;
    const t0 = reg.time;
    // Approach to 30 m of the arena (inside the 45 m emergence radius).
    const vx = c.position.x - B.ax, vz = c.position.z - B.az;
    const L = Math.hypot(vx, vz) || 1;
    __tp(B.ax + vx / L * 30, B.az + vz / L * 30);
    const live = await __until(() => B.state === 'live' && B.bossId > 0, 15);
    const bossName = B.row ? B.row.bossName : null;
    const levelBefore = P.level, xpBefore = P.xp;
    let hits = 0;
    for (let i = 0; i < 8 && qs.main.cold < 5; i++) {
        const s = reg.slot(B.bossId);
        if (s >= 0 && reg.hp[s] > 0) { reg.damage(B.bossId, reg.hp[s] + 1, { tag: 'probe' }); hits++; }
        await __gw(0.6);
    }
    const u = await __until(() => qs.main.cold >= 5, 5);
    await __gw(0.5);
    return {
        live, bossName, hits, until: u, main: qs.main, tracked: qs.tracked,
        waypoint: qs.waypoint, levelBefore, xpBefore, level: P.level, xp: P.xp,
        killedFlags: P.bossesKilled, directorState: B.state,
        gates: { mini: qs.bossUnlocked('cold', 'mini'), realm: qs.bossUnlocked('cold', 'realm') },
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)),
    };
})()"""

J_SAVE = r"""(() => {
    const SF = SNOWFLOW, P = SF.progression;
    P.save();
    const b = JSON.parse(localStorage.getItem('driftwake_save'));
    return { schemaVer: b.schemaVer, level: b.level, quest: b.quest,
        shrinesLit: b.shrinesLit, bossesKilled: b.bossesKilled,
        playTime: b.playTime, keys: Object.keys(b) };
})()"""

J_RELOAD = r"""(async () => {
    const SF = SNOWFLOW, reg = SF.combat.registry, P = SF.progression;
    const B = SF.combat.bosses;
    window.__log = [];
    const tR = reg.time;
    const qs = await __mkQS();
    const atRegister = { tracked: qs.tracked, main: Object.assign({}, qs.main),
        waypoint: qs.waypoint };
    // CONTINUE = progression.continueRun() (the shell's onContinue core).
    P.continueRun();
    P.graceUntil = 1e9;
    await __gw(1.0);
    const afterContinue = { tracked: qs.tracked, main: Object.assign({}, qs.main),
        waypoint: qs.waypoint, surfM: qs.surfM, kills: qs.killsForOnboarding,
        hintsSeen: qs.hintsSeen };
    // The dead mini boss must not re-arm, the realm boss must stay gated.
    const samples = [];
    for (let i = 0; i < 12; i++) {
        samples.push({ state: B.state, eligible: B._eligibleKind() });
        await __gw(0.5);
    }
    return {
        level: P.level, lit: P.litShrines('cold').slice(),
        atRegister, afterContinue,
        miniKilled: B._isKilled('mini'),
        gates: { mini: qs.bossUnlocked('cold', 'mini'), realm: qs.bossUnlocked('cold', 'realm') },
        armedAfterReload: samples.filter(s => s.state !== 'idle' || s.eligible !== null).length,
        samples: samples.length,
        events: __evs(tR).map(e => e.ev + ' ' + JSON.stringify(e.p)),
    };
})()"""


J_FPS = r"""(async () => {
    // Wall-clock frame rate + game-time rate over a fixed wall window.
    const r = SNOWFLOW.combat.registry;
    const g0 = r.time, w0 = performance.now();
    let n = 0;
    await new Promise((res) => {
        const tick = () => { n++; if (performance.now() - w0 >= 20000) res(); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
    });
    const wall = (performance.now() - w0) / 1000;
    return { frames: n, wallS: +wall.toFixed(1), fps: +(n / wall).toFixed(2),
        gameSPerWallS: +((r.time - g0) / wall).toFixed(3) };
})()"""


def wait_booted(pg, budget_s=900):
    """Poll the boot in short slices, printing the boot phase, so a slow
    (loaded machine) boot and a FAILED boot are told apart."""
    t0 = time.time()
    while True:
        try:
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && SNOWFLOW.combat && !SNOWFLOW.S.freezeTime",
                timeout=30000)
            print("[boot] ready after %.0f s" % (time.time() - t0), flush=True)
            pg.wait_for_timeout(2500)
            return
        except Exception:
            pass
        try:
            ph = pg.evaluate("() => [(document.getElementById('boot-phase')||{}).textContent||'',"
                             " !!(document.getElementById('nogpu')||{classList:{contains:()=>0}})"
                             ".classList.contains('show')]")
        except Exception as e:
            ph = ["(unresponsive: %s)" % str(e).splitlines()[0][:80], False]
        print("[boot] %.0f s phase=%r nogpu=%s" % (time.time() - t0, ph[0], ph[1]), flush=True)
        if ph[1]:
            raise RuntimeError("boot failed: #nogpu shown (%s)" % ph[0])
        if time.time() - t0 > budget_s:
            raise RuntimeError("boot did not finish in %d s (last phase %r)" % (budget_s, ph[0]))


def boot(pg):
    pg.goto(URL, wait_until="commit", timeout=240000)
    wait_booted(pg)


_T_LOAD = time.time()


def show(title, obj):
    print("\n==== " + title + "   [wall %.0f s]" % (time.time() - _T_LOAD))
    print(json.dumps(obj, indent=1, ensure_ascii=False), flush=True)


def main():
    from playwright.sync_api import sync_playwright

    # The shared deep-backlog server (orchestrator rule: qa_server.py PORT).
    srv = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve().parent / "qa_server.py"), str(PORT)],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    errors = []
    checks = []
    T0 = time.time()

    def check(name, ok, detail=""):
        checks.append((name, bool(ok), detail))

    def stamp(what):
        print("[wall %6.0f s] %s" % (time.time() - T0, what), flush=True)

    try:
        with sync_playwright() as pw:
            # A PERSISTENT profile: Chrome's GPU program cache survives between
            # runs, so a re-run (and the reload below) skips most of the
            # pipeline compiles that dominate boot on a loaded machine.
            import tempfile
            prof = str(Path(tempfile.gettempdir()) / "driftwake_qa_8921_profile")
            br = pg = None
            boot_err = []
            # Orchestrator rule: ONE browser at a time, boot wait up to 15 min,
            # at most two attempts; a failed boot is NOT RUN, never a pass.
            for attempt in (1, 2):
                br = pw.chromium.launch_persistent_context(
                    prof, channel="chrome", headless=False, args=FLAGS,
                    viewport={"width": 960, "height": 540})
                pg = br.pages[0] if br.pages else br.new_page()
                def on_err(msg):
                    errors.append(msg)
                    print("[page] " + msg[:300], flush=True)
                pg.on("pageerror", lambda e: on_err("pageerror: %s" % e))
                pg.on("console", lambda m: on_err("console.%s: %s" % (m.type, m.text))
                      if m.type == "error" else None)
                pg.add_init_script(PRELUDE)
                stamp("boot attempt %d" % attempt)
                try:
                    boot(pg)
                    break
                except Exception as e:
                    boot_err.append("attempt %d: %s" % (attempt, str(e).splitlines()[0][:200]))
                    try:
                        fps = pg.evaluate("() => new Promise(res => { let n = 0; const w0 = performance.now();"
                                          " const t = () => { n++; if (performance.now() - w0 > 20000)"
                                          " res(n / ((performance.now() - w0) / 1000)); else requestAnimationFrame(t); };"
                                          " requestAnimationFrame(t); })")
                        boot_err.append("  measured rAF fps at give-up: %.2f" % fps)
                    except Exception as e2:
                        boot_err.append("  fps unmeasurable: %s" % str(e2).splitlines()[0][:120])
                    br.close()
                    br = pg = None
            if pg is None:
                print("\n==== NOT RUN (environment): the page did not boot in two attempts")
                for line in boot_err:
                    print("  " + line)
                return 2
            stamp("booted")
            show("FRAME RATE after boot", pg.evaluate(J_FPS))

            r = pg.evaluate(J_SETUP)
            show("PLAY (fresh save)", r)
            check("fresh save -> cold.1", r["tracked"] and r["tracked"]["stepId"] == "cold.1")
            check("waypoint on the spawn shrine", r["waypoint"] and r["waypoint"]["kind"] == "shrine"
                  and abs(r["waypoint"]["x"] - r["spawnShrine"]["x"]) < 0.01)
            check("boss gate installed, director idle", r["bossGateInstalled"]
                  and r["bossState"] == "idle" and r["bossEligible"] is None)
            check("save is schema v4", r["schema"] == 4)

            r = pg.evaluate(J_TOUCH)
            show("TOUCH spawn shrine", r)
            ev = " ".join(r["events"])
            check("touch -> cold.2", r["main"]["cold"] == 1 and r["tracked"]["stepId"] == "cold.2")
            check("shrine:activated first=true", '"id":"cold_spawn"' in ev and '"first":true' in ev)
            check("Echo spoke (echo.cold.1)", '"id":"echo.cold.1"' in ev)
            check("surf hint shown", 'hint {"id":"hint.surf"' in ev)

            r = pg.evaluate(J_SURF)
            show("SURF 150 m", r)
            ev = " ".join(r["events"])
            check("surf 150 m -> cold.3", r["main"]["cold"] == 2 and r["tracked"]["stepId"] == "cold.3")
            check("surf hint cleared", 'hint:clear {"id":"hint.surf"}' in ev)
            check("forced pack of 5 rimeImp", r["packSpawns"] == 1
                  and r["forcedKeys"] == ["rimeImp"] * 5)
            check("waypoint -> pack", r["waypoint"] and r["waypoint"]["kind"] == "pack")

            r = pg.evaluate(J_KILL)
            show("KILL 5", r)
            ev = " ".join(r["events"])
            check("kill 5 -> cold.4", r["main"]["cold"] == 3 and r["tracked"]["stepId"] == "cold.4")
            check("enemy:killed x5 keyed rimeImp", ev.count('enemy:killed {"realm":"cold","key":"rimeImp"') >= 5)
            check("dinged (level >= 2)", r["level"] >= 2)
            check("first ding < 60 s game time", r["firstDingGameS"] is not None
                  and r["firstDingGameS"] < 60, str(r["firstDingGameS"]))
            check("waypoint -> dormant shrine", r["waypoint"] and r["waypoint"]["kind"] == "shrine")

            r = pg.evaluate(J_RING)
            show("KINDLE THE RING (3 shrines)", r)
            check("mini NOT armed before cold.4 done", r["armedWhileClosed"] == 0
                  and r["gateOpenWhileClosed"] == 0, "%d samples" % r["notArmedSamples"])
            check("waypoint followed nearest dormant x3",
                  all(v["waypointIsNearestDormant"] for v in r["visits"]))
            check("3 shrines -> cold.5", r["main"]["cold"] == 4 and r["tracked"]["stepId"] == "cold.5")
            check("mini boss ARMED after", r["arm"]["ok"] and r["director"]["kind"] == "mini")
            check("waypoint -> boss arena", r["waypoint"] and r["waypoint"]["kind"] == "boss"
                  and abs(r["waypoint"]["x"] - r["director"]["ax"]) < 0.2)

            r = pg.evaluate(J_BOSS)
            show("BREAK THE MINI BOSS", r)
            ev = " ".join(r["events"])
            check("boss emerged", r["live"]["ok"])
            check("boss:killed mini first=true", '"kind":"mini"' in ev and '"first":true' in ev)
            check("kill -> cold.6", r["main"]["cold"] == 5 and r["tracked"]["stepId"] == "cold.6")

            r = pg.evaluate(J_SAVE)
            show("SAVE blob", r)
            check("blob v4 carries quest.main.cold = 5", r["schemaVer"] == 4
                  and r["quest"]["main"]["cold"] == 5)

            stamp("reload")
            try:
                pg.reload(wait_until="commit", timeout=240000)
                wait_booted(pg)
            except Exception as e:
                print("\n==== RELOAD NOT RUN (environment): %s" % str(e).splitlines()[0][:200])
                check("reload -> CONTINUE (NOT RUN: environment, reload did not boot)", False)
                br.close()
                br = None
            if br is None:
                raise SystemExit(report(checks, errors))
            stamp("reloaded")
            r = pg.evaluate(J_RELOAD)
            show("RELOAD -> CONTINUE", r)
            check("step survives reload (register)", r["atRegister"]["tracked"]["stepId"] == "cold.6")
            check("step survives CONTINUE", r["afterContinue"]["tracked"]["stepId"] == "cold.6"
                  and r["afterContinue"]["main"]["cold"] == 5)
            check("dead mini stays dead, realm boss gated", r["miniKilled"]
                  and not r["gates"]["realm"] and r["armedAfterReload"] == 0)
            stamp("done")
            br.close()
    finally:
        srv.terminate()

    return report(checks, errors)


def report(checks, errors):
    print("\n==== PAGE ERRORS (%d)" % len(errors))
    for e in errors:
        print("  " + e[:400])
    print("\n==== CHECKS")
    for name, ok, detail in checks:
        print("  %s  %s%s" % ("PASS" if ok else "FAIL", name, ("  [" + detail + "]") if detail else ""))
    fails = [c for c in checks if not c[1]]
    print("\n%d/%d checks passed; page errors: %d" % (len(checks) - len(fails), len(checks), len(errors)))
    return 1 if fails or errors else 0


if __name__ == "__main__":
    sys.exit(main())
