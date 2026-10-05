# -*- coding: utf-8 -*-
"""
qa_questchain.py -- lane Q, the rest of the chain on the LIVE page (companion
to qa_questcore.py, same harness: dynamic-import QuestSystem, rAF-driven with
GAME dt, bus listeners on every emit, persistent profile so the GPU program
cache from qa_questcore makes the boot cheaper).

  H  LEGACY: a v3 blob (level 7, cold mini dead, no quest section) -> CONTINUE
     -> the veteran skips the onboarding (tracker cold.4, onboarding hints
     seen) and the v3-only `boons` key survives the next save verbatim.
  B  CONTINUE a crafted v4 save parked at cold.6 (3 rings lit, mini dead).
  C  light the last 3 ring shrines -> cold.7 AND the realm boss arms (not
     before: sampled while cold.6 was open).
  D  kill the realm boss -> cold.8, the portal opens, the waypoint is the gate.
  G  ENDING logic (crafted state, QUEST §9's "3 spawn shrines + both bosses of
     every realm" branch): ash chain parked at ash.6, stand on the Cold spawn
     shrine -> quest:complete ash.6 + ending:begin, post-game tracker queued.
  E  walk into the portal -> portal:entered {from cold, to sand} -> cold.8
     completes -> in Sand the tracker is sand.1 and points at the spawn shrine.
  F  touch the Sand spawn shrine -> shrine:activated {realm sand, first} ->
     sand.2.

    python _harness/qa_questchain.py
"""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))
from qa_questcore import (SERVER_CODE, PRELUDE, ROOT, PORT, URL, FLAGS,  # noqa: E402
                          wait_booted, show)

J_LEGACY = r"""(async () => {
    const SF = SNOWFLOW, P = SF.progression, reg = SF.combat.registry;
    const qs = await __mkQS();
    const t0 = reg.time;
    // A v3 blob exactly as the v3 save() wrote it (plus boons: []).
    const v3 = { schemaVer: 3, level: 7, xp: 120, driftmarks: 0,
        spellsUnlocked: [2, 1, 3, 4], boons: [], realmsUnlocked: ['cold'],
        bossesKilled: { 'cold:mini': true, 'The Icewall': true }, bossGates: {},
        lastShrineId: 'shrine_e', restedBank: 0, lastSeenTs: Date.now(),
        objectiveState: {}, deaths: 2, pos: null };
    localStorage.setItem('driftwake_save', JSON.stringify(v3));
    P.continueRun();
    P.graceUntil = 1e9;
    await __gw(0.8);
    const after = { tracked: qs.tracked, main: Object.assign({}, qs.main),
        hintsSeen: Object.assign({}, qs.hintsSeen), surfM: qs.surfM,
        kills: qs.killsForOnboarding, level: P.level,
        lit: P.litShrines('cold').slice() };
    P.save();
    const b = JSON.parse(localStorage.getItem('driftwake_save'));
    return { after, saved: { schemaVer: b.schemaVer, boons: b.boons,
        questMain: b.quest && b.quest.main, keys: Object.keys(b) },
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)) };
})()"""

J_PARK = r"""(async () => {
    const SF = SNOWFLOW, P = SF.progression, reg = SF.combat.registry;
    const qs = __qs, B = SF.combat.bosses;
    const t0 = reg.time;
    // Three rings nearest the spawn lit, mini dead, level 6, quest at cold.6.
    const pos = SF.shrine.positions;
    const v4 = { schemaVer: 4, level: 6, xp: 0, driftmarks: 0,
        spellsUnlocked: [2, 1, 3, 4], realmsUnlocked: ['cold'],
        bossesKilled: { 'cold:mini': true }, bossGates: {},
        lastShrineId: pos[1].id, restedBank: 0, lastSeenTs: Date.now(),
        objectiveState: {}, deaths: 0, pos: null,
        shrinesLit: { cold: ['cold_spawn', pos[1].id, pos[2].id, pos[3].id], sand: [], ash: [] },
        playTime: 600,
        quest: { main: { cold: 5, sand: 0, ash: 0 }, surfM: 180, killsForOnboarding: 5,
            hintsSeen: { 'hint.surf': true, 'hint.bolt': true, 'hint.arc': true,
                'hint.journal': true }, endingSeen: false,
            caches: {}, trials: {}, bounties: {}, lore: [] } };
    localStorage.setItem('driftwake_save', JSON.stringify(v4));
    P.continueRun();
    P.graceUntil = 1e9;
    __tp(pos[1].sx, pos[1].sz);
    await __gw(0.8);
    return { tracked: qs.tracked, main: Object.assign({}, qs.main), waypoint: qs.waypoint,
        director: { state: B.state, kind: B.kind, eligible: B._eligibleKind() },
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)) };
})()"""

J_WAKE = r"""(async () => {
    const SF = SNOWFLOW, P = SF.progression, reg = SF.combat.registry;
    const qs = __qs, B = SF.combat.bosses, c = SF.character;
    const t0 = reg.time;
    const before = [];
    for (let i = 0; i < 16; i++) {
        before.push({ state: B.state, kind: B.kind, eligible: B._eligibleKind() });
        await __gw(0.5);
    }
    const visits = [];
    for (let k = 0; k < 3; k++) {
        await __gw(0.4);
        const wp = qs.waypoint;
        const target = SF.shrine.positions.find(p =>
            wp && Math.abs(p.x - wp.x) < 0.01 && Math.abs(p.z - wp.z) < 0.01);
        visits.push({ wp: wp && wp.label, id: target ? target.id : null,
            lit: target ? P.isShrineLit('cold', target.id) : null });
        if (!target) break;
        __tp(target.sx, target.sz);
        await __gw(0.8);
    }
    const u = await __until(() => qs.main.cold >= 6, 5);
    const arm = await __until(() => B.state === 'pending' && B.kind === 'realm', 12);
    await __gw(0.4);
    return { realmArmedWhileCold6Open: before.filter(s => s.kind === 'realm' || s.eligible === 'realm').length,
        samples: before.length, visits, until: u, arm, main: Object.assign({}, qs.main),
        tracked: qs.tracked, waypoint: qs.waypoint,
        director: { state: B.state, kind: B.kind, ax: +B.ax.toFixed(1), az: +B.az.toFixed(1) },
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)) };
})()"""

J_ELDER = r"""(async () => {
    const SF = SNOWFLOW, P = SF.progression, reg = SF.combat.registry;
    const qs = __qs, B = SF.combat.bosses, c = SF.character;
    const t0 = reg.time;
    const vx = c.position.x - B.ax, vz = c.position.z - B.az;
    const L = Math.hypot(vx, vz) || 1;
    __tp(B.ax + vx / L * 30, B.az + vz / L * 30);
    const live = await __until(() => B.state === 'live' && B.bossId > 0, 20);
    const name = B.row ? B.row.bossName : null;
    let hits = 0;
    for (let i = 0; i < 10 && qs.main.cold < 7; i++) {
        const s = reg.slot(B.bossId);
        if (s >= 0 && reg.hp[s] > 0) { reg.damage(B.bossId, reg.hp[s] + 1, { tag: 'probe' }); hits++; }
        await __gw(0.6);
    }
    const u = await __until(() => qs.main.cold >= 7, 5);
    await __gw(0.6);
    const g = SF.portal;
    return { live, name, hits, until: u, main: Object.assign({}, qs.main), tracked: qs.tracked,
        waypoint: qs.waypoint, portal: { open: g.isOpen, x: +g.x.toFixed(1), z: +g.z.toFixed(1),
            token: g.token, from: g.from },
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)) };
})()"""

J_ENDING = r"""(async () => {
    const SF = SNOWFLOW, P = SF.progression, reg = SF.combat.registry;
    const qs = __qs;
    const t0 = reg.time;
    // Crafted: every realm's chain done up to ash.6, the §9 alternate
    // condition true (3 spawn shrines lit + all six bosses down), NOT all 21.
    const saved = { main: Object.assign({}, qs.main), unlocked: P.realmsUnlocked.slice(),
        killed: Object.assign({}, P.bossesKilled), sand: P.litShrines('sand').slice(),
        ash: P.litShrines('ash').slice() };
    qs.main.sand = 6; qs.main.ash = 5;
    for (const r of ['sand', 'ash']) {
        if (P.realmsUnlocked.indexOf(r) < 0) P.realmsUnlocked.push(r);
        P.bossesKilled[r + ':mini'] = true; P.bossesKilled[r + ':realm'] = true;
        if (!P.isShrineLit(r, 'cold_spawn')) P.litShrines(r).push('cold_spawn');
    }
    P.bossesKilled['cold:realm'] = true;
    const eligible = qs.endingEligible();
    let lit = 0; for (const r of ['cold', 'sand', 'ash']) lit += P.litShrines(r).length;
    const sp = SF.shrine.positions[0];
    __tp(sp.sx, sp.sz);
    const u = await __until(() => qs.endingSeen, 5);
    await __gw(0.5);
    const out = { eligible, litTotal: lit, until: u, endingSeen: qs.endingSeen,
        main: Object.assign({}, qs.main), tracked: qs.tracked,
        journal: (() => { const j = qs.journal(); return { mainDone: j.mainDone,
            mainTotal: j.mainTotal, playerTitle: j.playerTitle }; })(),
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)) };
    // Restore the crafted fields so the portal leg runs on the real state.
    qs.main.sand = saved.main.sand; qs.main.ash = saved.main.ash; qs.endingSeen = false;
    P.realmsUnlocked.length = 0; for (const r of saved.unlocked) P.realmsUnlocked.push(r);
    for (const k in P.bossesKilled) if (!(k in saved.killed)) delete P.bossesKilled[k];
    P.litShrines('sand').length = 0; for (const s of saved.sand) P.litShrines('sand').push(s);
    P.litShrines('ash').length = 0; for (const s of saved.ash) P.litShrines('ash').push(s);
    qs._endingTouched = false; qs._dirty = true;
    await __gw(0.5);
    out.restoredTracked = qs.tracked && qs.tracked.stepId;
    return out;
})()"""

J_PORTAL = r"""(async () => {
    const SF = SNOWFLOW, P = SF.progression, reg = SF.combat.registry;
    const qs = __qs, g = SF.portal;
    const t0 = reg.time;
    // Arm (seen outside the 2.5 m ring), then walk in.
    __tp(g.x + 8, g.z);
    await __gw(0.6);
    const armed = g.stats.armed;
    __tp(g.x, g.z);
    const u = await __until(() => qs.main.cold >= 8, 8);
    const r = await __until(() => SF.combat.bosses.realm === 'sand' && qs.realm === 'sand', 600);
    await __gw(1.5);
    return { armed, until: u, realmSwap: r, main: Object.assign({}, qs.main),
        qsRealm: qs.realm, progressionRealm: P.realm, unlocked: P.realmsUnlocked.slice(),
        tracked: qs.tracked, waypoint: qs.waypoint,
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)) };
})()"""

J_SANDSPAWN = r"""(async () => {
    const SF = SNOWFLOW, P = SF.progression, reg = SF.combat.registry;
    const qs = __qs;
    const t0 = reg.time;
    await __gw(1.0);                       // the post-swap re-ground (3 frames)
    const sp = SF.shrine.positions[0];
    __tp(sp.sx, sp.sz);
    const u = await __until(() => qs.main.sand >= 1, 6);
    await __gw(0.5);
    return { until: u, main: Object.assign({}, qs.main), tracked: qs.tracked,
        waypoint: qs.waypoint, litSand: P.litShrines('sand').slice(),
        events: __evs(t0).map(e => e.ev + ' ' + JSON.stringify(e.p)) };
})()"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-c", SERVER_CODE, str(PORT), str(ROOT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    errors = []
    checks = []

    def check(name, ok, detail=""):
        checks.append((name, bool(ok), detail))

    try:
        with sync_playwright() as pw:
            prof = str(Path(tempfile.gettempdir()) / "driftwake_qa_8921_profile")
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
            pg.goto(URL, wait_until="commit", timeout=240000)
            wait_booted(pg)
            pg.evaluate("() => { if (SNOWFLOW.applyPreset) SNOWFLOW.applyPreset('performance'); }")

            r = pg.evaluate(J_LEGACY)
            show("H  LEGACY v3 -> CONTINUE", r)
            check("veteran v3 save skips onboarding (cold.4)",
                  r["after"]["tracked"]["stepId"] == "cold.4" and r["after"]["main"]["cold"] == 3)
            check("onboarding hints marked seen", all(r["after"]["hintsSeen"].get(h) for h in
                  ("hint.surf", "hint.bolt", "hint.arc", "hint.journal")))
            check("v3 `boons` key preserved by the v4 save", r["saved"]["boons"] == []
                  and r["saved"]["schemaVer"] == 4)

            r = pg.evaluate(J_PARK)
            show("B  CONTINUE crafted v4 at cold.6", r)
            check("crafted v4 save resumes at cold.6", r["tracked"]["stepId"] == "cold.6")

            r = pg.evaluate(J_WAKE)
            show("C  WAKE THE ANCHORS", r)
            check("realm boss not armed while cold.6 open", r["realmArmedWhileCold6Open"] == 0,
                  "%d samples" % r["samples"])
            check("all 6 -> cold.7", r["main"]["cold"] == 6 and r["tracked"]["stepId"] == "cold.7")
            check("realm boss armed after", r["arm"]["ok"])
            check("waypoint -> realm boss arena", r["waypoint"] and r["waypoint"]["kind"] == "boss")

            r = pg.evaluate(J_ELDER)
            show("D  THE REALM BOSS", r)
            ev = " ".join(r["events"])
            check("boss:killed realm", '"kind":"realm"' in ev and '"first":true' in ev)
            check("-> cold.8, portal open from cold to sand", r["main"]["cold"] == 7
                  and r["portal"]["open"] and r["portal"]["from"] == "cold"
                  and r["portal"]["token"] == "sand")
            check("waypoint -> portal", r["waypoint"] and r["waypoint"]["kind"] == "portal"
                  and abs(r["waypoint"]["x"] - r["portal"]["x"]) < 0.2)

            r = pg.evaluate(J_ENDING)
            show("G  ENDING (crafted §9 alternate condition)", r)
            ev = " ".join(r["events"])
            check("ending eligible on 3 spawns + 6 bosses (< 21 lit)", r["eligible"]
                  and r["litTotal"] < 21, "lit %d" % r["litTotal"])
            check("ash.6 completes + ending:begin", "ending:begin" in ev
                  and '"stepId":"ash.6"' in ev and r["endingSeen"])

            r = pg.evaluate(J_PORTAL)
            show("E  THROUGH THE PORTAL", r)
            ev = " ".join(r["events"])
            check("portal:entered {from cold, to sand}",
                  'portal:entered {"from":"cold","to":"sand"}' in ev)
            check("cold.8 complete, now tracking sand.1", r["main"]["cold"] == 8
                  and r["tracked"]["stepId"] == "sand.1")
            check("progression.realm follows (sand)", r["progressionRealm"] == "sand")
            check("waypoint -> sand spawn shrine", r["waypoint"] and r["waypoint"]["kind"] == "shrine"
                  and r["waypoint"]["realm"] == "sand")

            r = pg.evaluate(J_SANDSPAWN)
            show("F  SAND SPAWN SHRINE", r)
            ev = " ".join(r["events"])
            check("shrine:activated realm sand first", '"realm":"sand","id":"cold_spawn"' in ev
                  and '"first":true' in ev)
            check("sand.1 -> sand.2", r["main"]["sand"] == 1 and r["tracked"]["stepId"] == "sand.2")
            br.close()
    finally:
        srv.terminate()

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
