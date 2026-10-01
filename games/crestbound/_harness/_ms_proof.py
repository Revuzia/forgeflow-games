#!/usr/bin/env python
"""Missions lane (stage 1) proof: the mission select changes the level.

Drives the SHIPPING flow with real input and reads the frames:

  title (real mouse click on NEW GAME) -> the Keep -> walk into the Bailey Meadow
  painting (hero placed 1.9 m out at the gate's own stand-out spot, then REAL `W`
  held until the card opens) -> course card -> REAL arrow keys pick a mission ->
  REAL Enter -> the course loads in that mission's state -> the same three camera
  stations are photographed in each mission -> the rampart crest is climbed with
  REAL key events (input.__test.press dispatches KeyboardEvents on window;
  the engine is stopped and game.update(1/60) hand-stepped, as feelshots.py does,
  so machine load cannot change the result) -> celebration -> clear panel ->
  REAL Enter -> the Keep -> the save is read back from localStorage.

    python _harness/_ms_proof.py [--url URL] [--out DIR] [--headed]

Writes frames + proof.json into --out (default _spec/audit_2026_09_29/frames/missions).
Dev-only probe (?dev=1 is used for the placement teleports, never for the choice).
"""
import argparse
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = "http://localhost:8788/games/crestbound/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
SWIFT = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
         "--autoplay-policy=no-user-gesture-required"]

LOG = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


def wait_for(pg, js, timeout_s, arg=None, poll_ms=250):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            v = pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
            if v:
                return v
        except Exception:
            pass
        pg.wait_for_timeout(poll_ms)
    return None


STATE = "() => { const G = globalThis.CRESTBOUND && CRESTBOUND.game; return G ? {state: G.state, course: G.courseId, loading: G._loading} : null; }"

CARD = r"""() => {
  const c = document.querySelector('.cb-card');
  if (!c) return null;
  const q = (s) => { const n = c.querySelector(s); return n ? n.textContent : null; };
  return {
    open: c.classList.contains('on'),
    tiles: Array.from(c.querySelectorAll('.cc-mtile')).map((t, i) => ({
      n: i + 1, name: t.querySelector('.nm').textContent, sel: t.classList.contains('is-sel'),
      got: t.classList.contains('is-got'), shown: t.style.display !== 'none' })),
    k: q('.cc-mission .k'), name: q('.cc-mission .nm'), sub: q('.cc-mission .sub'),
    btns: Array.from(c.querySelectorAll('.cc-btns .cb-btn')).map(b => (b.textContent || '').trim() + (b.classList.contains('is-focus') ? ' [focus]' : '')),
    cardMission: CRESTBOUND.game.card ? CRESTBOUND.game.card.mission : null,
  };
}"""

LIVE = r"""() => {
  const A = CRESTBOUND, G = A.game, C = G.course, T = A.THREE;
  if (!C) return null;
  const v = (p) => p ? [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] : null;
  const col = C.collectibles;
  const mill = (C.hazards || []).find(r => r.kind === 'mill');
  // the north door: a broadphase ray from the courtyard straight at the doorway
  const out = { t: 0, normal: new T.Vector3(), collider: null };
  const hitDoor = C.broadphase.raycast(new T.Vector3(0, 10.4, -30.0), new T.Vector3(0, 0, -1), 8, out);
  const tim = document.querySelector('.ch-timers'), dth = document.querySelector('.ch-deaths');
  return {
    state: G.state, courseId: G.courseId,
    mission: G.mission ? { id: G.mission.id, index: G.mission.index, name: G.mission.name, present: G.mission.present,
      absent: G.mission.absent, routes: G.mission.routes, at: G.mission.at, counts: G.mission.counts } : null,
    critters: C.critters.map(c => ({ kind: c.kind || (c.def && c.def.kind), tag: c.def && c.def.tag || null, pos: v(c.pos || (c.mesh && c.mesh.position)) })),
    crests: col ? col.crests.map(c => ({ id: c.id, present: c.present, home: v(c.home), race: !!c.race })) : null,
    crestDefs: (C.def.crests || []).length,
    millPeriod: mill && mill.h ? mill.h.period : null,
    northDoorHit: hitDoor ? +out.t.toFixed(2) : null,
    raceMs: col ? col.raceMs : null,
    runstatsOff: document.documentElement.classList.contains('cb-runstats-off'),
    timersDisplay: tim ? getComputedStyle(tim).display : null,
    deathsDisplay: dth ? getComputedStyle(dth).display : null,
    player: v(G.player && G.player.pos),
  };
}"""

PLACE = r"""([x, y, z, yaw]) => {
  const G = CRESTBOUND.game, P = G.player;
  P.__test.teleport({ x, y, z }); P.__test.setVel({ x: 0, y: 0, z: 0 });
  P.__test.setFacing(yaw);
  if (G.cam && G.cam.__test && G.cam.__test.setYaw) G.cam.__test.setYaw(yaw);
  else if (G.cam) G.cam.recenter();
  return true;
}"""

# Stand at the gate's own stand-out spot facing the painting; the WALK is real.
GATE_AIM = r"""(course) => {
  const G = CRESTBOUND.game;
  const g = (G._gates || []).find(x => x.course === course);
  if (!g) return null;
  const dx = g.pos.x - g.exitPos.x, dz = g.pos.z - g.exitPos.z;
  const yaw = Math.atan2(-dx, -dz);
  const P = G.player;
  P.__test.teleport({ x: g.exitPos.x, y: g.exitPos.y + 0.3, z: g.exitPos.z }); P.__test.setVel({ x: 0, y: 0, z: 0 });
  P.__test.setFacing(yaw);
  if (G.cam && G.cam.__test && G.cam.__test.setYaw) G.cam.__test.setYaw(yaw);
  G._gateSuppressed = -1;
  return { yaw: +yaw.toFixed(3), exit: [g.exitPos.x, g.exitPos.y, g.exitPos.z], locked: g.locked };
}"""

# Hand-stepped climb of the merlon stair to the rampart crest. Real KeyboardEvents via
# input.__test.press; the stick at walk magnitude is the analog injection point (contract §4).
CLIMB = r"""async () => {
  const A = CRESTBOUND, G = A.game, E = A.engine, IN = G.input, P = G.player;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const edges = [ { z: -26.2, top: 15.70 }, { z: -27.9, top: 17.00 }, { z: -29.3, top: 18.15 } ];
  const log = [];
  let hold = 0, jumps = 0, i = 0;
  for (i = 0; i < 600; i++) {
    const cy = G.cam ? G.cam.yaw : 0;
    // world -Z, converted through the live camera yaw (forward = (-sin cy, -cos cy))
    const fx = -Math.sin(cy), fz = -Math.cos(cy), rx = -fz, rz = fx;
    const wx = 0, wz = -1;
    IN.__test.stick((wx * rx + wz * rz) * 0.5, (wx * fx + wz * fz) * 0.5);
    const feet = P.pos.y;
    if (hold > 0) { hold--; if (hold === 0) IN.__test.release('Space'); }
    else if (P.grounded) {
      const next = edges.find(e => e.top > feet + 0.3);
      if (next && P.pos.z - next.z < 1.0 && P.pos.z - next.z > 0) {
        IN.__test.press('Space'); hold = 16; jumps++;
        log.push({ i, ev: 'jump', z: +P.pos.z.toFixed(2), y: +feet.toFixed(2), toward: next.top });
      }
    }
    G.update(1 / 60);
    if (i % 20 === 0) log.push({ i, st: P.state, p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)], g: P.grounded });
    if (G.state === 'clear') { log.push({ i, ev: 'CREST', state: G.state, p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)] }); break; }
  }
  IN.__test.stick(0, 0); IN.__test.release('Space');
  E.render(1 / 60);
  return { frames: i, jumps, log, state: G.state };
}"""

# The walk into the painting, hand-stepped: KeyW held as a real KeyboardEvent, the camera
# pinned toward the painting every frame (the player steers with the mouse; gatecheck AIM).
WALK = r"""async (course) => {
  const A = CRESTBOUND, G = A.game, E = A.engine, IN = G.input, P = G.player;
  const g = (G._gates || []).find(x => x.course === course);
  if (!g) return { err: 'no gate' };
  const wasRunning = E.running; E.stop();
  IN.__test.press('KeyW');
  let i = 0;
  for (i = 0; i < 900; i++) {
    const dx = g.pos.x - P.pos.x, dz = g.pos.z - P.pos.z;
    const yaw = Math.atan2(-dx, -dz);
    const slide = (typeof G.cam._yawSlide === 'number') ? G.cam._yawSlide : 0;
    G.cam.yaw = yaw - slide; G.cam._rcHoldT = 0;
    G.update(1 / 60);
    if (G.state === 'card') break;
  }
  IN.__test.release('KeyW');
  E.render(1 / 60);
  E.start(E._loopFn);
  return { frames: i, state: G.state, pos: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)], near: G._gateNear, dwell: G._gateDwell };
}"""

STEP = r"""async (n) => {
  const A = CRESTBOUND, G = A.game, E = A.engine;
  for (let i = 0; i < n; i++) G.update(1 / 60);
  E.render(1 / 60);
  return { state: G.state, clearT: G._clearT };
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=BASE)
    ap.add_argument("--out", default=os.path.join(ROOT, "_spec", "audit_2026_09_29", "frames", "missions"))
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--boot", type=int, default=900)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    proof = {"url": args.url, "steps": {}}
    errors = []

    def shot(pg, name):
        path = os.path.join(args.out, name + ".png")
        try:
            pg.screenshot(path=path, timeout=60_000)
            log("  frame", os.path.relpath(path, ROOT))
        except Exception as e:
            log("  frame FAILED", name, str(e)[:120])

    def settle(pg, ms):
        pg.wait_for_timeout(ms)

    with sync_playwright() as p:
        try:
            br = p.chromium.launch(channel="chrome", headless=not args.headed, args=FLAGS)
        except Exception:
            br = p.chromium.launch(headless=not args.headed, args=SWIFT)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:240]))
        pg.on("console", lambda m: errors.append("console.error: " + m.text[:240]) if m.type == "error" else None)
        url = args.url + "?dev=1&quality=low&autoscale=0"
        log("goto", url)
        pg.goto(url, wait_until="load", timeout=120_000)
        t0 = time.time()
        st = wait_for(pg, "() => globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state === 'title'", args.boot, poll_ms=1000)
        log("title after %.0f s" % (time.time() - t0), bool(st))
        if not st:
            log("NEVER REACHED TITLE", pg.evaluate(STATE))
            return 2
        settle(pg, 1500)
        # ---- NEW GAME: a real mouse click on the button ----
        box = pg.evaluate(r"""() => { const b = Array.from(document.querySelectorAll('button.cb-btn')).find(x => /NEW GAME/i.test(x.textContent) && x.getBoundingClientRect().width > 4);
            if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }""")
        log("NEW GAME button at", box)
        if box:
            pg.mouse.click(box[0], box[1])
        st = wait_for(pg, "() => CRESTBOUND.game.state === 'keep' && !CRESTBOUND.game._loading", 300, poll_ms=500)
        if not st:
            # a confirm dialog may ask to erase progress on a non-fresh profile
            pg.keyboard.press("Enter")
            st = wait_for(pg, "() => CRESTBOUND.game.state === 'keep' && !CRESTBOUND.game._loading", 300, poll_ms=500)
        log("in the Keep:", bool(st), pg.evaluate(STATE))
        settle(pg, 1500)

        def walk_into_card(tag):
            aim = pg.evaluate(GATE_AIM, "verdant-1")
            log("[%s] placed at the Bailey gate stand-out spot" % tag, aim)
            w = pg.evaluate(WALK, "verdant-1")
            log("[%s] hand-stepped walk (real KeyW held):" % tag, json.dumps(w))
            ok = wait_for(pg, "() => CRESTBOUND.game.state === 'card' && document.querySelector('.cb-card.on')", 30, poll_ms=100)
            log("[%s] card raised by the walk-in:" % tag, bool(ok))
            settle(pg, 1200)
            return bool(ok)

        def enter_course(tag):
            pg.keyboard.press("Enter")
            ok = wait_for(pg, "() => CRESTBOUND.game.courseId === 'verdant-1' && ['playing','cinematic'].includes(CRESTBOUND.game.state) && !CRESTBOUND.game._loading", 400, poll_ms=500)
            log("[%s] course loaded:" % tag, bool(ok), pg.evaluate(STATE))
            if pg.evaluate("() => CRESTBOUND.game.state") == "cinematic":
                settle(pg, 900)
                pg.keyboard.press("Space")        # skip the intro, as a player can
                wait_for(pg, "() => CRESTBOUND.game.state === 'playing'", 60, poll_ms=250)
            settle(pg, 1500)
            return bool(ok)

        def stations(tag):
            # V1 the courtyard from the gate checkpoint, looking north at the back door
            pg.evaluate(PLACE, [0.0, 9.2, -15.2, 0.0]); settle(pg, 1600); shot(pg, tag + "_v1_courtyard")
            live1 = pg.evaluate(LIVE)
            # V2 the Warden's ring from its west entrance, looking east
            pg.evaluate(PLACE, [-13.5, 17.5, -54.0, -math.pi / 2]); settle(pg, 1600); shot(pg, tag + "_v2_ring")
            live2 = pg.evaluate(LIVE)
            # V3 the crest tower from the rampart checkpoint, looking north
            pg.evaluate(PLACE, [10.0, 14.6, -25.0, 0.0]); settle(pg, 1600); shot(pg, tag + "_v3_tower")
            return live1, live2

        # ================= RUN 1: pick MISSION 5 with real arrows =================
        if not walk_into_card("run1"):
            proof["error"] = "card never opened"; json.dump(proof, open(os.path.join(args.out, "proof.json"), "w"), indent=1); return 3
        c0 = pg.evaluate(CARD); proof["steps"]["card_open_default"] = c0
        log("  card on open:", c0["k"], "|", c0["name"], "|", [t["name"] + ("*" if t["sel"] else "") for t in c0["tiles"]])
        shot(pg, "01_card_default")
        for _ in range(4):
            pg.keyboard.press("ArrowRight"); settle(pg, 160)
        c1 = pg.evaluate(CARD); proof["steps"]["card_after_4_right"] = c1
        log("  after 4x ArrowRight:", c1["k"], "|", c1["name"], "| sel", [t["n"] for t in c1["tiles"] if t["sel"]])
        shot(pg, "02_card_mission5")
        enter_course("run1")
        L = pg.evaluate(LIVE); proof["steps"]["boss_live"] = L
        log("  RUN 1 mission:", json.dumps(L["mission"]))
        log("  critters:", json.dumps(L["critters"]))
        log("  crests built:", json.dumps(L["crests"]), "| def.crests", L["crestDefs"])
        log("  mill period", L["millPeriod"], "| north door ray hit", L["northDoorHit"], "| runstatsOff", L["runstatsOff"], L["timersDisplay"], L["deathsDisplay"])
        shot(pg, "03_boss_arrival")
        b1, b2 = stations("04_boss")
        proof["steps"]["boss_v1"] = b1; proof["steps"]["boss_v2"] = b2
        # never uninvited: stand on the (absent) race start pad for 1.5 s
        pg.evaluate(PLACE, [0.0, 9.3, -15.5, 0.0]); settle(pg, 1500)
        proof["steps"]["boss_on_race_pad"] = pg.evaluate(LIVE)
        log("  on the race start pad in mission 5: raceMs", proof["steps"]["boss_on_race_pad"]["raceMs"])
        pg.evaluate("() => CRESTBOUND.game.returnToKeep()")
        wait_for(pg, "() => CRESTBOUND.game.state === 'keep' && !CRESTBOUND.game._loading", 300, poll_ms=500)
        settle(pg, 1500)

        # ================= RUN 2: the default cursor, MISSION 1 =================
        walk_into_card("run2")
        c2 = pg.evaluate(CARD); proof["steps"]["card_run2"] = c2
        log("  card run2:", c2["k"], "|", c2["name"])
        shot(pg, "05_card_mission1")
        enter_course("run2")
        L = pg.evaluate(LIVE); proof["steps"]["open_live"] = L
        log("  RUN 2 mission:", json.dumps(L["mission"]))
        log("  critters:", json.dumps(L["critters"]))
        log("  crests built:", json.dumps(L["crests"]))
        log("  mill period", L["millPeriod"], "| north door ray hit", L["northDoorHit"], "| runstatsOff", L["runstatsOff"], L["timersDisplay"], L["deathsDisplay"])
        o1, o2 = stations("06_open")
        proof["steps"]["open_v1"] = o1; proof["steps"]["open_v2"] = o2

        # ---- collect the rampart crest with real keys, hand-stepped ----
        pg.evaluate("() => { const E = CRESTBOUND.engine; E.stop(); return true; }")
        pg.evaluate(PLACE, [10.0, 14.6, -24.6, 0.0])
        pg.evaluate(STEP, 30)
        shot(pg, "07_climb_start")
        climb = pg.evaluate(CLIMB)
        proof["steps"]["climb"] = climb
        log("  climb:", climb["frames"], "frames,", climb["jumps"], "jumps, state", climb["state"])
        for e in climb["log"]:
            if "ev" in e:
                log("    ", json.dumps(e))
        shot(pg, "08_crest_taken")
        pg.evaluate(STEP, 60); shot(pg, "09_celebration")
        pg.evaluate(STEP, 110)
        # hand the loop back to the engine for the UI panel
        pg.evaluate("() => { const E = CRESTBOUND.engine; E.start(E._loopFn); return true; }")
        panel = wait_for(pg, r"""() => { const n = document.querySelector('.ch-clear.on, .ch-clear-wrap.on, [class*=clear].on');
            const btns = Array.from(document.querySelectorAll('button.cb-btn')).filter(b => b.getBoundingClientRect().width > 4 && /STAY|RETURN|KEEP/i.test(b.textContent));
            return btns.length ? btns.map(b => (b.textContent || '').trim()) : null; }""", 30, poll_ms=250)
        proof["steps"]["clear_panel_buttons"] = panel
        log("  clear panel visible buttons:", panel)
        settle(pg, 900)
        shot(pg, "10_clear_panel")
        save_mid = pg.evaluate("() => JSON.parse(localStorage.getItem('crestbound.save.v1') || 'null')")
        pg.keyboard.press("Enter")
        back = wait_for(pg, "() => CRESTBOUND.game.state === 'keep' && CRESTBOUND.game.courseId === 'keep' && !CRESTBOUND.game._loading", 300, poll_ms=500)
        log("  Enter on the clear panel -> the Keep:", bool(back))
        settle(pg, 1800)
        shot(pg, "11_back_in_keep")
        save = pg.evaluate("() => JSON.parse(localStorage.getItem('crestbound.save.v1') || 'null')")
        rec = (save or {}).get("courses", {}).get("verdant-1")
        proof["steps"]["save_after"] = rec
        log("  SAVE verdant-1:", json.dumps(rec))
        log("  Save.crestTotal():", pg.evaluate("() => CRESTBOUND.Save ? CRESTBOUND.Save.crestTotal() : (CRESTBOUND.game.save.crestTotal())"))
        proof["steps"]["save_at_panel"] = (save_mid or {}).get("courses", {}).get("verdant-1")

        # ================= RUN 3: the race is invited only by its own mission =================
        walk_into_card("run3")
        c3 = pg.evaluate(CARD); proof["steps"]["card_run3"] = c3
        log("  card run3 (after the crest):", c3["k"], "|", c3["name"], "| got", [t["n"] for t in c3["tiles"] if t["got"]])
        shot(pg, "12_card_after_crest")
        pg.keyboard.press("Digit6"); settle(pg, 300)
        c4 = pg.evaluate(CARD); proof["steps"]["card_digit6"] = c4
        log("  Digit6 ->", c4["k"], "|", c4["name"])
        enter_course("run3")
        L = pg.evaluate(LIVE)
        log("  RUN 3 mission:", L["mission"] and L["mission"]["id"], "| race crest built:", [c["id"] for c in L["crests"] if c["race"]], "| runstatsOff", L["runstatsOff"])
        pg.evaluate(PLACE, [0.0, 9.3, -15.5, 0.0]); settle(pg, 1800)
        R = pg.evaluate(LIVE); proof["steps"]["race_on_pad"] = R
        log("  on the start pad in mission 6: raceMs", R["raceMs"], "| runstatsOff", R["runstatsOff"], "| timers", R["timersDisplay"], "| deaths", R["deathsDisplay"])
        shot(pg, "13_race_running")

        proof["errors"] = errors[:40]
        log("page errors:", len(errors))
        for e in errors[:12]:
            log("   ", e)
        br.close()
    proof["log"] = LOG
    with open(os.path.join(args.out, "proof.json"), "w", encoding="utf-8") as f:
        json.dump(proof, f, indent=1)
    log("wrote", os.path.join(args.out, "proof.json"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
