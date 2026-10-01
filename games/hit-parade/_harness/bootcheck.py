#!/usr/bin/env python
"""HIT PARADE boot check - CONTRACT §13 gate G4 (+ the SHELL lab proof with --lab).

    python _harness/bootcheck.py --headless          # G4: a deep-linked versus bout driven by REAL keys
    python _harness/bootcheck.py --lab --headless    # SHELL lab: loop / input / gamepad / settings / save / __HP__
    python _harness/bootcheck.py --base <url>        # another server (a deployed build: /__shot is skipped)
    python _harness/bootcheck.py --stubs --headless  # G4 before every lane landed: HP_LAB_STUBS=1 (vite.config.ts)

G4 flow (real input at the player's layer; dyefield bootcheck.py shape, fighter content):
  1. load /?mode=versus&p1=johnny&p2=bruno&stage=rust_theater&seed=1&cpu2=1&dev=1, wait for
     __HP__.state().phase == 'ready' (the PRESS START card over the loaded bout);
  2. a REAL Enter key on the card -> phase 'bout' (a real click is the fallback, and SAID);
  3. the round intro runs out -> __HP__.match().phase 'fight'; shot _shots/boot_fight.png;
  4. REAL D holds walk P1 forward: >= 0.3 m covered while in walk_f (up to 3 x 0.9 s holds; CHANGED(integrator));
  5. walk into range (real D hold until the gap < 1.1 m), then REAL J taps (5L) until a HIT event with a = 0 lands and
     P2's hp falls (<= 6 tries); shot _shots/boot_hit.png;
  6. REAL I taps (SIMPLE 5S = the fighter's main special) until a HIT / BLOCK event with a = 0 and c = 3 (special,
     CONTRACT §17 rule 6) or a PROJ_HIT by P1 with c = 6 (a projectile special; CHANGED(integrator)) (<= 6 tries);
  6b. CHANGED(integrator) 3D (CONTRACT §35.10): a REAL Q tap -> P1 SIDESTEP, moved >= 0.3 m, P1 yaw + sim camN turn >= 5 deg;
     a REAL E hold 1.6 s -> SIDEWALK, the bearing around P2 + the camN sweep + P1's yaw >= 30 deg (<= 3 tries each); shots
     _shots/boot_step_before / boot_step_tap / boot_step_circle.png; distances are planar (x, z) everywhere;
  7. frames + sim ticks advancing, and VERDICT "BOOTS CLEAN" only with 0 console / page / window / shader errors and
     0 failed requests.
Exit codes: 0 clean · 1 not clean · 2 the page never got far enough to judge.

--lab (lane SHELL, runtime/lab/shell.html + src/lab/shell.ts; never in the build): with synthetic gamepads
(common.PADS_INIT_JS) it checks, and prints every measured number:
  loop     real-rAF tick rate vs min(60, 5 x fps) and the simulated 30/60/90/120/144/240 Hz render cap (~60 fps,
           60 ticks/s); pause = 0 ticks while paused and no fast-forward burst after resume
  input    REAL keys: P1 D -> RIGHT, A+D and W+S -> neutral (SOCD), a zero-length J tap -> L for exactly the ticks it
           spans (latched), P2 arrows / numpad, H -> THROW macro, J+K -> L|M, Esc -> pause UI action
  gamepad  pad 0 X -> L, stick 8-way sectors + 30 % dead zone, d-pad, analog RT -> IMPACT, keyboard + pad SOCD, pad 1
           -> P2, START -> pause
  store    settings + save set -> reload -> read back; bindings apply live; a corrupt and a hostile blob load as
           sanitised defaults; blocked localStorage (getter throws) boots with persisted = false and no page error
  surface  __HP__ exists; dev.step works with ?dev=1 and throws without it
  flow     the phase table (legal / illegal / terminal error) and THE SEASON / PILOT ladders
Report: _harness/_reports/bootcheck_lab.json (G4: bootcheck.json). Exit 0 only when every check passes (1 = a check
failed, 3 = none failed but one could not be measured on this machine, e.g. rAF starved: said, never a pass).
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (BIT, P1_KEYS, P2_KEYS, PAD, SHOTS, HarnessError, Session, add_common_args, build_url,  # noqa: E402
                    cpu_load, diag_problems, events_tail, fighters_info, is_local, match_info, preflight_chromes,
                    print_diagnostics, save_report, wait_match_phase, wait_warm)

ALL_BITS = 0x7FFF   # CHANGED(integrator) 3D: bits 13 / 14 = STEP_IN / STEP_OUT (CONTRACT §35.16 item 1)


# CHANGED(integrator) 3D: ground-plane geometry helpers for the ring (FighterSnap x / z in m, yaw in radians, camN [x, z])
def planar(a, b):
    return math.hypot((a.get("x") or 0.0) - (b.get("x") or 0.0), (a.get("z") or 0.0) - (b.get("z") or 0.0))


def ang_deg(a, b):
    """smallest |a - b| between two angles in degrees"""
    return abs((a - b + 180.0) % 360.0 - 180.0)


def cam_deg(cam):
    """camN [x, z] -> yaw-convention degrees (0 = +Z, 90 = +X)"""
    return math.degrees(math.atan2(cam[0], cam[1])) if cam and len(cam) >= 2 else None


def fwd_key(ff):
    """P1's forward key from its SCREEN side sign (FighterSnap.facing, the sim's LEFT / RIGHT mapping under camN)"""
    fc = ff[0].get("facing")
    if fc is None:
        fc = 1 if (ff[1].get("x") or 0) >= (ff[0].get("x") or 0) else -1
    return "KeyD" if fc >= 0 else "KeyA"


# ─────────────────────────────── the SHELL lab ───────────────────────────────
class Checks:
    def __init__(self):
        self.items = []

    def check(self, name, ok, detail=""):
        self.items.append({"name": name, "ok": bool(ok), "detail": detail})
        print("   %s %s%s" % ("ok  " if ok else "FAIL", name, (" - " + (detail if isinstance(detail, str) else json.dumps(detail, default=str))) if detail != "" else ""), flush=True)
        return ok

    def inconclusive(self, name, why):
        """the environment could not produce the evidence (e.g. rAF starved): reported, never counted as a pass"""
        self.items.append({"name": name, "ok": None, "detail": why})
        print("   ???? %s - INCONCLUSIVE: %s" % (name, why), flush=True)

    @property
    def failed(self):
        return [c for c in self.items if c["ok"] is False]

    @property
    def unknown(self):
        return [c for c in self.items if c["ok"] is None]


def lab_wait(sess, timeout_s=30):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if sess.safe_js("() => !!window.__LAB__", default=False):
            return True
        time.sleep(0.2)
    return False


def ticks(sess):
    return sess.js("() => __LAB__.ticks()")


def words_since(sess, t):
    return sess.js("(t) => __LAB__.history(t)", t)


def settle(sess, n=3, budget_s=45.0):
    """wait until the loop ran n more ticks. A starved machine (rAF at < 1 fps, measured here with other lanes' Blender /
    Chrome at 100 % CPU) can go seconds between frames, so the budget is long; returns False when it ran out."""
    t0 = ticks(sess)
    deadline = time.time() + budget_s
    while time.time() < deadline:
        if ticks(sess) >= t0 + n:
            return True
        time.sleep(0.02)
    return False


def word_now(sess, p=0):
    return sess.js("(p) => __LAB__.words()[p]", p)


def run_lab(args) -> int:
    C = Checks()
    report = {"mode": "lab", "headless": args.headless}
    load0 = cpu_load()
    report["cpuLoadStart"] = load0
    print("cpu load     : %s %%" % load0)
    others, _ = preflight_chromes("pre-flight")
    report["otherAutomatedChrome"] = others
    url = build_url(args.base, "lab/shell.html", dev=1)
    sess = Session(args, "bootcheck-lab", pads=True)
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    shot = os.path.join(SHOTS, "shell_lab.png")
    try:
        sess.goto(url)
        if not lab_wait(sess):
            print("SETUP FAILED: window.__LAB__ never appeared at %s" % url)
            return 2
        sess.js("() => __LAB__.save.reset()")

        # ── surface
        print("-- __HP__")
        st = sess.js("() => __HP__.state()")
        C.check("__HP__ exists with version + state()", isinstance(st, dict) and bool(sess.js("() => __HP__.version")),
                {"version": sess.js("() => __HP__.version"), "phase": st.get("phase")})
        ok, v = sess.hp("dev.step", 5)
        C.check("__HP__.dev.step(5) runs 5 ticks with ?dev=1", ok and v == 5, v)
        ok, v = sess.hp("dev.setInputs", 0, BIT["RIGHT"] | BIT["H"], 3)
        settle(sess, 5)
        forced = [h for h in words_since(sess, 0) if h[1] == (BIT["RIGHT"] | BIT["H"])]
        C.check("__HP__.dev.setInputs(0, RIGHT|H, 3) reaches the tick words", ok and len(forced) >= 1, forced[:2])

        # ── loop
        print("-- loop")
        m = sess.js("() => __LAB__.measureTicks(6000)")
        report["loopReal"] = m
        fl = sess.js("() => __LAB__.frameLog(240)")
        report["frameLog"] = fl
        # real rAF, per rendered frame [gap ms, ticks, simEnabled]: replay the SPEC (SIM_DT 1/60, dt clamp 0.1 s, <= 5
        # ticks per frame, the owed rest dropped) over the REAL gaps and demand the exact tick count per frame. The
        # replay starts after the first frame that leaves the accumulator at a known 0 (a capped / stalled frame).
        sim_dt, due = 1.0 / 60.0, 1.0 / 60.0 - 1e-7
        acc, known, mism, compared, h_ms, h_ticks, frozen = 0.0, False, [], 0, 0.0, 0, False
        for k, fr in enumerate(fl):
            raw, got_t, en = fr[0], fr[1], fr[2] if len(fr) > 2 else 1
            if not en:
                acc, known, frozen = 0.0, True, True
                continue
            if frozen:                       # loop.ts RESUME_PRIME: the resume frame starts just under one tick
                acc, frozen = sim_dt * 0.999, False
            acc += min(raw / 1000.0, 0.1)
            n = 0
            while acc >= due and n < 5:
                acc = max(0.0, acc - sim_dt)
                n += 1
            reset = acc >= due
            if reset:
                acc = 0.0
            if known:
                compared += 1
                if n != got_t:
                    mism.append({"frame": k, "gapMs": round(raw, 3), "spec": n, "real": got_t})
                if raw < 90:
                    h_ms += raw
                    h_ticks += got_t
            if reset:
                known = True
        stalls = [f for f in fl if f[0] >= 100]
        h_rate = 1000.0 * h_ticks / h_ms if h_ms > 0 else 0.0
        report["loopReplay"] = {"compared": compared, "mismatches": mism[:10], "healthyMs": h_ms, "healthyRate": h_rate, "stalls": len(stalls)}
        name = "real rAF: every frame ran exactly the spec's tick count (%d frames replayed, %d stalls >= 100 ms)" % (compared, len(stalls))
        if mism or compared >= 10:
            C.check(name, not mism, mism[:4] or "healthy stretches %.2f ticks/s over %.0f ms" % (h_rate, h_ms))
        else:
            C.inconclusive(name, "only %d frames to replay (rAF %.1f fps, cpu %s %%) - no mismatch among them" % (compared, m["fps"], load0))
        C.check("real rAF: no frame ever ran more than 5 ticks", all(f[1] <= 5 for f in fl), max((f[1] for f in fl), default=0))
        print("NOTE: real rAF this run: %.1f fps overall, %.2f ticks/s overall, %d stalls >= 100 ms (cpu %s %%)" % (m["fps"], m["rate"], len(stalls), load0))
        cap = sess.js("() => [30, 60, 90, 120, 144, 240].map((hz) => __LAB__.capSim(hz, 10))")
        report["capSuite"] = cap
        for r in cap:
            C.check("simulated %3d Hz rAF: %d frames / %d ticks in 10 s" % (r["hz"], r["frames"], r["ticks"]),
                    abs(r["tickRate"] - 60) <= 0.5 and abs(r["fps"] - min(60, r["hz"])) <= 1.5,
                    "fps %.1f, ticks/s %.1f, cap skips %d" % (r["fps"], r["tickRate"], r["skips"]))
        pz = sess.js("() => __LAB__.pauseTest(1000)")
        report["pause"] = pz
        C.check("pause: 0 ticks while paused (1 s)", pz["ticksWhilePaused"] == 0, pz)
        C.check("resume: no fast-forward burst", pz["ticksAfterResume"] <= pz["expected"] + 3,
                "%d ticks in %.0f ms after resume (expected ~%.1f)" % (pz["ticksAfterResume"], pz["windowMs"], pz["expected"]))

        # ── keyboard
        print("-- keyboard (real key events)")
        kb = sess.page.keyboard

        def hold_read(keys, p=0, ms=250):
            for k in keys:
                kb.down(k)
            time.sleep(ms / 1000.0)
            settle(sess, 3)
            w = word_now(sess, p)
            for k in reversed(keys):
                kb.up(k)
            settle(sess, 3)
            return w

        w = hold_read([P1_KEYS["right"]])
        C.check("P1 D held -> RIGHT", w == BIT["RIGHT"], "word %d" % w)
        C.check("released -> 0", word_now(sess) == 0, "word %d" % word_now(sess))
        w = hold_read([P1_KEYS["left"], P1_KEYS["right"]])
        C.check("P1 A + D held -> SOCD neutral", w == 0, "word %d" % w)
        w = hold_read([P1_KEYS["up"], P1_KEYS["down"]])
        C.check("P1 W + S held -> SOCD neutral", w == 0, "word %d" % w)
        w = hold_read([P1_KEYS["down"], P1_KEYS["right"], P1_KEYS["l"]])
        C.check("P1 S + D + J held -> DOWN|RIGHT|L (3L)", w == BIT["DOWN"] | BIT["RIGHT"] | BIT["L"], "word %d" % w)
        w = hold_read([P1_KEYS["l"], P1_KEYS["m"]])
        C.check("P1 J + K held -> L|M (the sim reads the chord)", w == BIT["L"] | BIT["M"], "word %d" % w)
        w = hold_read([P1_KEYS["throw"]])
        C.check("P1 H held -> THROW macro bit", w == BIT["THROW"], "word %d" % w)
        w = hold_read([P1_KEYS["assist"], P1_KEYS["s"]])
        C.check("P1 U + I held -> ASSIST|S", w == BIT["ASSIST"] | BIT["S"], "word %d" % w)
        # a zero-length tap: down + up inside one tick -> latched for exactly the tick(s) it spans
        tapped = []
        for _ in range(3):
            t0 = ticks(sess)
            kb.down(P1_KEYS["l"])
            kb.up(P1_KEYS["l"])
            settle(sess, 4)
            hist = words_since(sess, t0)
            on = [h for h in hist if h[1] & BIT["L"]]
            tapped.append({"changes": hist, "ticksWithL": len(on)})
        n_ok = sum(1 for t in tapped if 1 <= t["ticksWithL"] <= 2 and t["changes"] and t["changes"][-1][1] == 0)
        C.check("zero-length J tap -> L latched for 1 tick, then 0 (3 taps)", n_ok == 3, tapped)
        t_p2 = ticks(sess)
        w = hold_read([P2_KEYS["left"], P2_KEYS["l"]], p=1)
        C.check("P2 Left + Num1 held -> P2 LEFT|L", w == BIT["LEFT"] | BIT["L"], "word %d" % w)
        p1_seen = [h for h in words_since(sess, t_p2 + 1) if h[1]]
        C.check("P2 keys never reach P1", word_now(sess, 0) == 0 and not p1_seen, p1_seen[:3])
        w = hold_read([P2_KEYS["impact"], P2_KEYS["parry"]], p=1)
        C.check("P2 Num+ + Num6 held -> IMPACT|PARRY", w == BIT["IMPACT"] | BIT["PARRY"], "word %d" % w)
        ui0 = len(sess.js("() => __LAB__.uiEvents()"))
        sess.press("Escape", 40)
        settle(sess, 2)
        ui = sess.js("() => __LAB__.uiEvents()")[ui0:]
        C.check("Esc -> one 'pause' UI action from P1 (key)", len(ui) == 1 and ui[0]["a"] == "pause" and ui[0]["p"] == 0 and ui[0]["via"] == "key", ui)

        # ── gamepads (synthetic navigator.getGamepads)
        print("-- gamepad (synthetic standard pads)")

        def pad_read(i, buttons=None, axes=None, p=0):
            sess.pad(i, buttons=buttons, axes=axes)
            settle(sess, 3)
            return word_now(sess, p)

        sess.pad(0)
        settle(sess, 2)
        w = pad_read(0, {PAD["X"]: 1})
        C.check("pad 0 X -> P1 L", w == BIT["L"], "word %d" % w)
        w = pad_read(0, {PAD["X"]: 0})
        C.check("pad 0 released -> 0", w == 0, "word %d" % w)
        cases = [((0.9, 0.0), BIT["RIGHT"], "stick right"), ((0.2, 0.1), 0, "stick inside the 30 % dead zone"),
                 ((0.7, -0.7), BIT["UP"] | BIT["RIGHT"], "stick up-right (9)"), ((-0.72, 0.69), BIT["LEFT"] | BIT["DOWN"], "stick down-left (1)"),
                 ((0.38, -0.92), BIT["UP"], "stick 67.5+ deg -> up only"), ((0.0, 0.0), 0, "stick centred")]
        for (x, y), want_w, label in cases:
            w = pad_read(0, axes=[x, y])
            C.check("pad 0 %s (%.2f, %.2f)" % (label, x, y), w == want_w, "word %d want %d" % (w, want_w))
        w = pad_read(0, {PAD["DOWN"]: 1})
        C.check("pad 0 d-pad down -> DOWN", w == BIT["DOWN"], "word %d" % w)
        pad_read(0, {PAD["DOWN"]: 0})
        w = pad_read(0, {PAD["RT"]: 0.8})
        C.check("pad 0 RT analog 0.8 -> IMPACT", w == BIT["IMPACT"], "word %d" % w)
        pad_read(0, {PAD["RT"]: 0})
        w = pad_read(0, {PAD["LT"]: 1, PAD["LB"]: 1})
        C.check("pad 0 LT + LB -> THROW|PARRY", w == BIT["THROW"] | BIT["PARRY"], "word %d" % w)
        pad_read(0, {PAD["LT"]: 0, PAD["LB"]: 0})
        kb.down(P1_KEYS["right"])
        w = pad_read(0, {PAD["LEFT"]: 1})
        kb.up(P1_KEYS["right"])
        pad_read(0, {PAD["LEFT"]: 0})
        C.check("keyboard RIGHT + pad LEFT together -> SOCD neutral", w == 0, "word %d" % w)
        sess.pad(1)
        w1 = pad_read(1, {PAD["A"]: 1}, p=1)
        w0 = word_now(sess, 0)
        C.check("pad 1 A -> P2 S, P1 untouched", w1 == BIT["S"] and w0 == 0, "P2 %d, P1 %d" % (w1, w0))
        pad_read(1, {PAD["A"]: 0}, p=1)
        ui0 = len(sess.js("() => __LAB__.uiEvents()"))
        pad_read(0, {PAD["START"]: 1})
        pad_read(0, {PAD["START"]: 1})       # still held: no second event
        pad_read(0, {PAD["START"]: 0})
        ui = sess.js("() => __LAB__.uiEvents()")[ui0:]
        C.check("pad 0 START (held 2 samples) -> exactly one 'pause' from P1 (pad)", len(ui) == 1 and ui[0]["p"] == 0 and ui[0]["via"] == "pad", ui)
        report["pads"] = sess.js("() => __HP__.input().pads")

        # ── settings + save round trip
        print("-- settings / save")
        sess.js("""() => { const S = __LAB__.settings; S.set({ gore: 'confetti', screenShake: 0.25, reduceFlashing: true, cinematics: 'short',
                   volume: { master: 0.8, music: 0.3, sfx: 0.9, voice: 0.9, crowd: 0.7 } });
                   S.bindKey(0, 'l', 'KeyZ'); S.setScheme(1, 1); S.bindPad(0, 's', 5); }""")
        w = hold_read(["KeyZ"])
        C.check("rebound P1 L = Z applies live (Z -> L)", w == BIT["L"], "word %d" % w)
        w = hold_read([P1_KEYS["l"]])
        C.check("J no longer bound after the remap", w == 0, "word %d" % w)
        w = pad_read(0, {5: 1})
        pad_read(0, {5: 0})
        C.check("rebound P1 pad S = RB applies live (RB -> S)", w == BIT["S"], "word %d" % w)
        clear = sess.js("() => __LAB__.save.recordClear({ fighter: 'johnny', length: 'season', difficulty: 0, score: 123456, name: 'TESTER' })")
        C.check("SEASON clear unlocks freak + ricky, board rank 0", clear.get("unlocked") == ["freak", "ricky"] and clear.get("rank") == 0, clear)
        nm = sess.js("() => __LAB__.save.setOnlineName('  Ringside   Rita!!<b>')")
        C.check("online name sanitised", nm == "Ringside Rit" or nm.startswith("Ringside Rit"), repr(nm))
        sess.goto(url)
        lab_wait(sess)
        s = sess.js("() => __LAB__.settings.get()")
        sv = sess.js("() => __LAB__.save.get()")
        got = {"gore": s["gore"], "screenShake": s["screenShake"], "reduceFlashing": s["reduceFlashing"], "cinematics": s["cinematics"],
               "music": s["volume"]["music"], "p1L": s["controls"][0]["keys"]["l"], "p2scheme": s["controls"][1]["scheme"],
               "p1padS": s["controls"][0]["pad"]["s"], "unlocks": sv["unlocks"], "board0": (sv.get("board") or [{}])[0], "onlineName": sv["onlineName"],
               "seasonClears": sv.get("seasonClears")}
        report["roundTrip"] = got
        C.check("after reload: settings read back", got["gore"] == "confetti" and got["screenShake"] == 0.25 and got["reduceFlashing"] is True
                and got["cinematics"] == "short" and got["music"] == 0.3 and got["p1L"] == ["KeyZ"] and got["p2scheme"] == 1 and got["p1padS"] == [5], got)
        C.check("after reload: save read back", got["unlocks"] == {"freak": True, "ricky": True} and got["board0"].get("score") == 123456
                and got["board0"].get("name") == "TESTER" and got["seasonClears"] == {"johnny": 1} and got["onlineName"].startswith("Ringside"), got)
        w = hold_read(["KeyZ"])
        C.check("after reload: the saved binding drives input (Z -> L)", w == BIT["L"], "word %d" % w)
        vs = sess.js("() => __LAB__.settings.view()")
        C.check("viewSettings() maps onto CONTRACT §17.1", vs == {"splatter": "confetti", "screenShake": 0.25, "reduceFlashing": True, "cinematicCamera": "short", "bloom": True}, vs)
        # corrupt + hostile blobs
        sess.js("() => localStorage.setItem('hitparade.save.v1', '{not json')")
        sess.goto(url)
        lab_wait(sess)
        s = sess.js("() => __LAB__.settings.get()")
        C.check("corrupt blob -> defaults, page boots", s["gore"] == "splatter" and s["controls"][0]["keys"]["l"] == ["KeyJ"], {"gore": s["gore"], "p1L": s["controls"][0]["keys"]["l"]})
        hostile = {"settings": {"gore": "blood", "screenShake": "NaN", "quality": "ultra", "volume": {"music": 7},
                                "controls": [{"scheme": 3, "keys": {"l": ["KeyJ", "KeyJ", "<script>", "Mouse0"], "m": ["KeyJ"]}, "pad": {"s": [0, 99, -1]}}]},
                   "unlocks": {"freak": "yes"}, "scores": {"season": [{"fighter": "../x", "score": 1e99}, {"fighter": "bruno", "score": "12"}]},
                   "clears": {"bad id": {"season": 3}}, "online": {"name": 42}}
        sess.js("(b) => localStorage.setItem('hitparade.save.v1', JSON.stringify(b))", hostile)
        sess.goto(url)
        lab_wait(sess)
        s = sess.js("() => __LAB__.settings.get()")
        sv = sess.js("() => __LAB__.save.get()")
        san = {"gore": s["gore"], "shake": s["screenShake"], "quality": s["quality"], "music": s["volume"]["music"], "scheme": s["controls"][0]["scheme"],
               "p1L": s["controls"][0]["keys"]["l"], "p1M": s["controls"][0]["keys"]["m"], "p1padS": s["controls"][0]["pad"]["s"],
               "freak": sv["unlocks"]["freak"], "board": sv["board"], "clears": sv["clears"], "name": sv["onlineName"]}
        report["hostile"] = san
        C.check("hostile blob -> every field sanitised", san["gore"] == "splatter" and san["shake"] in (1, 0.4) and san["quality"] in ("high", "med")
                and san["music"] == 1 and san["scheme"] == 0 and san["p1L"] == ["KeyJ"] and san["p1M"] == [] and san["p1padS"] == [0]
                and san["freak"] is False and [r["fighter"] for r in san["board"]] == ["bruno"] and san["clears"] == {} and san["name"] == "42", san)
        errs = sess.js("() => __LAB__.errors")
        C.check("no page errors across the reloads", not errs and not sess.page_errors, (errs or []) + sess.page_errors)

        # ── flow + season
        print("-- flow / season")
        ft = sess.js("() => __LAB__.flowTest()")
        report["flow"] = ft
        C.check("flow: legal path clean, menu->bout flagged, error terminal", ft["violations"] == ["menu->bout", "error->menu"] and ft["final"] == "error"
                and ft["screen"] == "settings" and ft["screenBefore"] == "main", {k: ft[k] for k in ("violations", "final", "screen", "screenBefore")})
        se = sess.js("() => __LAB__.seasonTest(7)")
        report["season"] = se
        kinds = [x["kind"] for x in se["season"]]
        levels = [x["level"] for x in se["season"]]
        opp = [x["opponent"] for x in se["season"]]
        C.check("SEASON: 8 bouts + BRAWL after 3 + HECKLER after 6, rival 5th, freak, ricky",
                kinds == ["bout", "bout", "bout", "brawl", "bout", "rival", "bout", "heckler", "miniboss", "boss"]
                and opp[5] == "boneyard" and opp[8] == "freak" and opp[9] == "ricky" and "johnny" not in opp
                and len(set(o for o, k in zip(opp, kinds) if k == "bout")) == 5 and "boneyard" not in [o for o, k in zip(opp, kinds) if k == "bout"],
                list(zip(kinds, opp)))
        C.check("SEASON Normal levels 2 3 3 - 4 5 5 - 6 6", levels == [2, 3, 3, 0, 4, 5, 5, 0, 6, 6], levels)
        pk = [(x["kind"], x["level"]) for x in se["pilot"]]
        C.check("PILOT Hard (+2): 4 5 BRAWL 6 FREAK 8 RICKY 8", pk == [("bout", 4), ("bout", 5), ("brawl", 0), ("bout", 6), ("miniboss", 8), ("boss", 8)], pk)
        C.check("ladder deterministic for a seed; clear after 1 continue", se["deterministic"] and se["cleared"] and se["continues"] == 1, se["trail"])

        sess.screenshot(shot)
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()

    # ── storage blocked (a fresh context whose localStorage getter throws) + dev functions without ?dev=1
    print("-- blocked storage / no dev")
    args2 = argparse.Namespace(**vars(args))
    sess2 = Session(args2, "bootcheck-lab-blocked")
    try:
        sess2.start()
        sess2.page.add_init_script("""(() => { try { Object.defineProperty(window, 'localStorage', { configurable: true,
            get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } }); } catch (e) {} })();""")
        sess2.goto(build_url(args.base, "lab/shell.html"))
        if lab_wait(sess2):
            info = sess2.js("() => { __LAB__.settings.set({ gore: 'sparks' }); return { available: __LAB__.save.available(), persisted: __LAB__.settings.persisted(),"
                            " gore: __LAB__.settings.get().gore, raw: __LAB__.save.raw() }; }")
            C.check("blocked localStorage: boots, value applies in memory, persisted = false",
                    info["available"] is False and info["persisted"] is False and info["gore"] == "sparks" and str(info["raw"]).startswith("THROWS"), info)
            ok, v = sess2.hp("dev.step", 1)
            C.check("__HP__.dev.* throws without ?dev=1", (not ok) and "dev-only" in str(v), v)
            errs = sess2.js("() => __LAB__.errors")
            C.check("blocked storage: no page errors", not errs and not sess2.page_errors, (errs or []) + sess2.page_errors)
        else:
            C.check("blocked localStorage: lab page boots", False, "window.__LAB__ never appeared")
    finally:
        diag2 = sess2.diagnostics() if sess2.page else {}
        sess2.close()

    report["checks"] = C.items
    report["diagnostics"] = [diag, diag2]
    report["cpuLoadEnd"] = cpu_load()
    probs = diag_problems(diag) + diag_problems(diag2)
    print("=" * 84)
    print_diagnostics(diag)
    for p in probs:
        print("   X %s" % p)
    ok = not C.failed and not probs
    report["verdict"] = ("LAB PASS" if not C.unknown else "LAB INCONCLUSIVE") if ok else "LAB FAIL"
    print("checks       : %d passed, %d failed, %d inconclusive" % (len(C.items) - len(C.failed) - len(C.unknown), len(C.failed), len(C.unknown)))
    for c in C.unknown:
        print("   ? %s - %s" % (c["name"], c["detail"]))
    for c in C.failed:
        print("   X %s - %s" % (c["name"], json.dumps(c["detail"], default=str)[:400]))
    print("shot         : %s" % shot)
    print("report       : %s" % save_report("bootcheck_lab", report, args.base))
    print("RESULT: %s" % (("OK" if not C.unknown else "INCONCLUSIVE") if ok else "FAIL"))
    return (0 if not C.unknown else 3) if ok else 1


# ─────────────────────────────── G4: the real game ───────────────────────────────
def hits_by(evs, a, types, c=None):
    out = []
    for e in evs or []:
        if e.get("a") == a and e.get("typeName") in types and (c is None or e.get("c") == c):
            out.append(e)
    return out


def wait_free(sess, max_s=3.0):
    """P1 free to act (idle / walks / crouch) -> the fighters snapshot (or the last one seen)"""
    t0 = time.time()
    ff = None
    while time.time() - t0 < max_s:
        ff = fighters_info(sess) or [{}, {}]
        if (ff[0].get("stateName") or "") in ("idle", "walk_f", "walk_b", "crouch"):
            return ff
        time.sleep(0.03)
    return ff or [{}, {}]


def step_kind(fs):
    st = (fs or {}).get("step") or {}
    return st.get("kind") or {"sidestep": "sidestep", "sidewalk": "sidewalk", "step_end": "settle"}.get((fs or {}).get("stateName"), "none")


def _deg(v):
    return round(math.degrees(v), 1) if isinstance(v, (int, float)) else None


def step_checks(sess, args, shots):
    """CHANGED(integrator) 3D: G4's ring step. (a) a REAL Q tap (P1 STEP_IN): P1 enters SIDESTEP, moves >= 0.3 m in the
    plane, its yaw turns (auto-face around P2) and the sim's camN turns (>= 5 deg each); (b) a REAL E hold of 1.6 s
    (STEP_OUT): P1 enters SIDEWALK, its bearing around P2 turns >= 30 deg, the camN sweep >= 30 deg and P1's yaw >= 30 deg.
    Up to 3 tries each (the live CPU can hit P1 out of a step). Every number is read from __HP__ (fighters / match)."""
    out = {"tap": None, "hold": None, "problems": []}
    kb = sess.page.keyboard
    for attempt in range(3):
        ff = wait_free(sess)
        m0 = match_info(sess) or {}
        p0, o0 = dict(ff[0]), dict(ff[1])
        y0, c0 = p0.get("yaw"), cam_deg(m0.get("camN"))
        kinds = set()
        if attempt == 0:
            shots["step_before"] = sess.screenshot(os.path.join(args.out_dir, "boot_step_before.png"))
        sess.press(P1_KEYS["stepin"], 60)
        t_end = time.time() + 0.5
        while time.time() < t_end:
            fs = fighters_info(sess)
            if fs:
                kinds.add(step_kind(fs[0]))
            time.sleep(0.02)
        f1 = fighters_info(sess) or [p0, o0]
        m1 = match_info(sess) or {}
        y1, c1 = f1[0].get("yaw"), cam_deg(m1.get("camN"))
        r = {"try": attempt + 1, "key": P1_KEYS["stepin"], "kinds": sorted(kinds), "moved": round(planar(f1[0], p0), 3),
             "dist": [round(planar(p0, o0), 3), round(planar(f1[0], f1[1]), 3)], "yawDeg": [_deg(y0), _deg(y1)],
             "camNDeg": [round(c0, 1) if c0 is not None else None, round(c1, 1) if c1 is not None else None]}
        r["yawTurn"] = round(ang_deg(math.degrees(y0), math.degrees(y1)), 1) if isinstance(y0, (int, float)) and isinstance(y1, (int, float)) else None
        r["camTurn"] = round(ang_deg(c0, c1), 1) if c0 is not None and c1 is not None else None
        r["ok"] = "sidestep" in kinds and r["moved"] >= 0.3 and (r["yawTurn"] or 0) >= 5.0 and (r["camTurn"] or 0) >= 5.0
        out["tap"] = r
        if r["ok"]:
            shots["step_tap"] = sess.screenshot(os.path.join(args.out_dir, "boot_step_tap.png"))
            break
        time.sleep(0.4)
    if not (out["tap"] or {}).get("ok"):
        out["problems"].append("real Q tap (STEP_IN): no sidestep with yaw + camN turning in 3 tries (%s)" % json.dumps(out["tap"]))
    time.sleep(0.4)
    for attempt in range(3):
        ff = wait_free(sess)
        m0 = match_info(sess) or {}
        p0, o0 = dict(ff[0]), dict(ff[1])
        y0, c0 = p0.get("yaw"), cam_deg(m0.get("camN"))
        b0 = math.degrees(math.atan2((p0.get("x") or 0) - (o0.get("x") or 0), (p0.get("z") or 0) - (o0.get("z") or 0)))
        kinds, dists, cam_sweep, last_c = set(), [], 0.0, c0
        kb.down(P1_KEYS["stepout"])
        t0 = time.time()
        while time.time() - t0 < 1.6:
            fs = fighters_info(sess)
            mm = match_info(sess) or {}
            if fs:
                k = step_kind(fs[0])
                kinds.add(k)
                if k == "sidewalk":
                    dists.append(planar(fs[0], fs[1]))
            cc = cam_deg(mm.get("camN"))
            if cc is not None and last_c is not None:
                cam_sweep += ((cc - last_c + 180.0) % 360.0) - 180.0
            if cc is not None:
                last_c = cc
            time.sleep(0.03)
        circle_shot = sess.screenshot(os.path.join(args.out_dir, "boot_step_circle.png"))
        kb.up(P1_KEYS["stepout"])
        f1 = fighters_info(sess) or [p0, o0]
        m1 = match_info(sess) or {}
        y1, c1 = f1[0].get("yaw"), cam_deg(m1.get("camN"))
        b1 = math.degrees(math.atan2((f1[0].get("x") or 0) - (f1[1].get("x") or 0), (f1[0].get("z") or 0) - (f1[1].get("z") or 0)))
        r = {"try": attempt + 1, "key": P1_KEYS["stepout"], "heldS": 1.6, "kinds": sorted(kinds), "bearingTurn": round(ang_deg(b0, b1), 1),
             "camSweepDeg": round(cam_sweep, 1), "camTurn": round(ang_deg(c0, c1), 1) if c0 is not None and c1 is not None else None,
             "yawDeg": [_deg(y0), _deg(y1)],
             "yawTurn": round(ang_deg(math.degrees(y0), math.degrees(y1)), 1) if isinstance(y0, (int, float)) and isinstance(y1, (int, float)) else None,
             "distWalk": [round(min(dists), 3), round(max(dists), 3)] if dists else None,
             "camNDeg": [round(c0, 1) if c0 is not None else None, round(c1, 1) if c1 is not None else None]}
        r["ok"] = "sidewalk" in kinds and r["bearingTurn"] >= 30.0 and abs(r["camSweepDeg"]) >= 30.0 and (r["yawTurn"] or 0) >= 30.0
        out["hold"] = r
        shots["step_circle"] = circle_shot
        if r["ok"]:
            break
        time.sleep(0.5)
    if not (out["hold"] or {}).get("ok"):
        out["problems"].append("real E hold (STEP_OUT): no circle-walk turning bearing / camN / yaw >= 30 deg in 3 tries (%s)" % json.dumps(out["hold"]))
    return out


def run_game(args) -> int:
    url = build_url(args.base, mode="versus", p1="johnny", p2="bruno", stage="rust_theater", seed=1, cpu2=args.cpu, dev=1)
    report = {"url": url, "headless": args.headless}
    problems, notes = [], []
    fatal = None
    shots = {}
    t_ready = None
    entered = None
    walk = press = special = None
    tick_a = tick_b = None
    adv = (False, None, None)
    others, _ = preflight_chromes("pre-flight")
    report["otherAutomatedChrome"] = others
    sess = Session(args, "bootcheck", server_env={"HP_LAB_STUBS": "1"} if args.stubs else None)
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    try:
        t0 = time.time()
        try:
            sess.goto(url)
        except Exception as e:
            fatal = "navigation failed: %s" % str(e).splitlines()[0]
        if not fatal and not sess.wait_hp(args.wait):
            fatal = "window.__HP__ never appeared within %.0f s" % args.wait
        if not fatal:
            ok, ph = sess.wait_phase("ready", args.wait)
            t_ready = time.time() - t0
            if not ok:
                st = sess.state() or {}
                fatal = "never reached 'ready' (phase=%r after %.0f s)%s" % (ph, args.wait, (": " + str(st.get("error"))[:1500]) if st.get("error") else "")
        if not fatal:
            shots["ready"] = sess.screenshot(os.path.join(args.out_dir, "boot_ready.png"))
            sess.press("Enter", 60)
            ok, ph = sess.wait_phase("bout", 5.0)
            entered = "real Enter on PRESS START" if ok else None
            if not ok:
                vw, vh = args.width, args.height
                sess.page.mouse.click(vw / 2, vh / 2)
                ok, ph = sess.wait_phase("bout", 5.0)
                if ok:
                    entered = "real click on PRESS START (Enter did not start it)"
                    problems.append("a real Enter on the PRESS START card did not start the bout (a click did)")
                else:
                    fatal = "could not enter the bout by Enter or click (phase %r)" % ph
        if not fatal:
            ok, mph = wait_match_phase(sess, "fight", 20.0)
            if not ok:
                fatal = "the round intro never reached 'fight' (match phase %r)" % mph
        if not fatal:
            wait_warm(sess, notes, "before the walk")
            s0 = sess.state() or {}
            tick_a = s0.get("tick")
            shots["fight"] = sess.screenshot(os.path.join(args.out_dir, "boot_fight.png"))
            # CHANGED(integrator): the CPU is live - it walks in, attacks, pushes - so a single timed hold is flaky (measured:
            # gap 0.61 m after dx 0.38 m; P1 pushed to -1.47 m then stunned through the hold, dx 0.07 m). The walk is judged
            # on the frames P1 actually spends in walk_f (§17 animId 1): up to 3 real 0.9 s D holds, each started once P1
            # is free (idle / walk) and held TOWARD P2 (A or D), summing the forward x covered between consecutive walk_f
            # samples; pass at >= 0.3 m (net dx alone is not evidence: a back throw carried P1 4.6 m across the stage).
            f0 = fighters_info(sess) or [{}, {}]
            walk_anim = 0
            walk_dx = 0.0
            holds = 0
            while holds < 3 and walk_dx < 0.5:
                holds += 1
                t_free = time.time() + 3.0
                while time.time() < t_free and ((fighters_info(sess) or [{}, {}])[0].get("animId") not in (0, 1, 2)):
                    time.sleep(0.05)
                prev = None
                ffk = fighters_info(sess) or [{}, {}]
                walk_key = fwd_key(ffk)   # toward P2 (CHANGED(integrator) 3D: by P1's screen side sign, not the x order)
                sess.page.keyboard.down(walk_key)
                t_end = time.time() + 0.9
                while time.time() < t_end:
                    ff = fighters_info(sess) or [{}, {}]
                    cur = ff[0]
                    if cur.get("animId") == 1:
                        walk_anim += 1
                        if prev is not None and prev.get("animId") == 1 and isinstance(cur.get("x"), (int, float)) and isinstance(prev.get("x"), (int, float)):
                            # CHANGED(integrator) 3D: progress = the step's displacement along the line to P2 (planar)
                            ux, uz = (ff[1].get("x") or 0) - prev["x"], (ff[1].get("z") or 0) - (prev.get("z") or 0)
                            un = math.hypot(ux, uz) or 1.0
                            walk_dx += max(0.0, ((cur["x"] - prev["x"]) * ux + ((cur.get("z") or 0) - (prev.get("z") or 0)) * uz) / un)
                    prev = cur
                    time.sleep(0.05)
                sess.page.keyboard.up(walk_key)
                time.sleep(0.3)
            f1 = fighters_info(sess) or [{}, {}]
            dx = (f1[0].get("x") or 0) - (f0[0].get("x") or 0)
            gap1 = planar(f1[0], f1[1])
            walk = {"from": f0[0].get("x"), "to": f1[0].get("x"), "dx": dx, "gapAfter": gap1, "walkAnimSamples": walk_anim,
                    "walkFramesDx": round(walk_dx, 3), "holds": holds}
            if not walk_dx >= 0.3:
                problems.append("real D holds x%d: P1 covered only %.2f m while in walk_f (%d samples; net dx %.2f m, gap %.2f m)" % (holds, walk_dx, walk_anim, dx, gap1))
            # close the gap
            gap = planar(f1[0], f1[1])
            if gap > 1.1:
                gk = fwd_key(f1)
                sess.page.keyboard.down(gk)
                end = time.time() + 3.0
                while time.time() < end:
                    ff = fighters_info(sess) or [{}, {}]
                    gap = planar(ff[0], ff[1])
                    if gap < 1.1:
                        break
                    time.sleep(0.03)
                sess.page.keyboard.up(gk)
            # 5L until a HIT by P1 and P2's hp falls
            hp0 = ((fighters_info(sess) or [{}, {}])[1]).get("hp")
            press = {"tries": 0, "hit": None, "hp": [hp0, None], "gap": gap}
            for i in range(6):
                press["tries"] += 1
                # CHANGED(integrator): the live CPU knocks P1 down / pushes it away between taps (measured: every tap at a
                # 2.43 m gap) - walk back into range before each tap (real D hold, <= 1.5 s)
                ffg = fighters_info(sess) or [{}, {}]
                if planar(ffg[0], ffg[1]) > 1.0:
                    fk = fwd_key(ffg)
                    sess.page.keyboard.down(fk)
                    t_in = time.time() + 1.5
                    while time.time() < t_in:
                        ffg = fighters_info(sess) or [{}, {}]
                        if planar(ffg[0], ffg[1]) < 0.9:
                            break
                        time.sleep(0.03)
                    sess.page.keyboard.up(fk)
                    hp0 = ffg[1].get("hp", hp0)
                sess.press("KeyJ", 50)
                time.sleep(0.35)
                ev = events_tail(sess, 200)
                h = hits_by(ev, 0, ("HIT", "COUNTER", "PUNISH"))
                hp1 = ((fighters_info(sess) or [{}, {}])[1]).get("hp")
                if h and isinstance(hp0, (int, float)) and isinstance(hp1, (int, float)) and hp1 < hp0:
                    press.update({"hit": h[-1], "hp": [hp0, hp1]})
                    break
            if not press["hit"]:
                problems.append("real J (5L) taps x%d never landed a HIT by P1 with P2 hp falling (%s)" % (press["tries"], press))
            else:
                shots["hit"] = sess.screenshot(os.path.join(args.out_dir, "boot_hit.png"))
            # the main special (SIMPLE 5S) until a special-class hit / block
            special = {"tries": 0, "event": None}
            for i in range(6):
                special["tries"] += 1
                time.sleep(0.5)
                sess.press("KeyI", 50)
                time.sleep(0.6)
                ev = events_tail(sess, 200)
                # CHANGED(integrator): a projectile special (johnny's 5S = BRICKBAT) lands with c = 6 (projectile class,
                # CONTRACT §17 rule 6), a melee special with c = 3; both are "the special lands"
                h = hits_by(ev, 0, ("HIT", "BLOCK", "COUNTER", "PUNISH", "PROJ_HIT"), c=3) + hits_by(ev, 0, ("PROJ_HIT",), c=6)
                if h:
                    special["event"] = h[-1]
                    break
            if not special["event"]:
                problems.append("real I (SIMPLE 5S) taps x%d never landed a special-class (c = 3) HIT / BLOCK by P1" % special["tries"])
            # CHANGED(integrator) 3D (CONTRACT §35.2 / §35.3 / §35.10): a REAL Q tap = SIDESTEP and a REAL held E =
            # SIDEWALK (circle-walk) in the real game; P1's yaw and the sim's camera basis camN must turn
            step3d = step_checks(sess, args, shots)
            report["step3d"] = step3d
            for p in step3d["problems"]:
                problems.append(p)
            adv = sess.frames_advancing(3.0)
            s1 = sess.state() or {}
            tick_b = s1.get("tick")
            if s1.get("phase") not in ("bout", "results"):
                problems.append("not in the bout at the final sample (phase %r)" % s1.get("phase"))
            if is_local(args.base):
                ok_s, v = sess.hp("shot", "boot_canvas")
                report["hpShot"] = v
            else:
                report["hpShot"] = {"skipped": "non-local base (no /__shot endpoint on a deployed build)"}
    finally:
        tl = sess.timeline() if sess.page else []
        diag = sess.diagnostics() if sess.page else {}
        sess.close()

    sim_adv = isinstance(tick_a, (int, float)) and isinstance(tick_b, (int, float)) and tick_b > tick_a
    print("=" * 84)
    print("URL          : %s" % url)
    print("boot -> ready: %s" % ("%.1f s" % t_ready if t_ready is not None else "-"))
    print("entered      : %s" % (entered or "NO"))
    print("walk         : %s" % json.dumps(walk))
    print("5L           : %s" % json.dumps(press, default=str))
    print("5S special   : %s" % json.dumps(special, default=str))
    st3 = report.get("step3d") or {}
    print("Q sidestep   : %s" % json.dumps(st3.get("tap"), default=str))
    print("E circle     : %s" % json.dumps(st3.get("hold"), default=str))
    print("frames       : %s -> %s (%s)" % (adv[1], adv[2], "advancing" if adv[0] else "STALLED"))
    print("sim ticks    : %s -> %s (%s)" % (tick_a, tick_b, "advancing" if sim_adv else "STALLED"))
    for k, v in shots.items():
        print("shot %-7s : %s" % (k, "ok" if v else "FAILED"))
    for n in notes:
        print("NOTE         : %s" % n)
    print("timeline     : %s" % (" | ".join(tl[-12:]) or "-"))
    print("-" * 84)
    print_diagnostics(diag)
    print("=" * 84)
    report.update({"readyS": t_ready, "entered": entered, "walk": walk, "press": press, "special": special, "framesAdvancing": adv[0],
                   "simAdvancing": sim_adv, "diagnostics": diag, "fatal": fatal, "notes": notes, "shots": shots, "timeline": tl})
    if fatal:
        report["verdict"] = "NOT CLEAN"
        print("VERDICT: NOT CLEAN - %s" % fatal)
        for p in diag_problems(diag):
            print("   X %s" % p)
        print("report       : %s" % save_report("bootcheck", report, args.base))
        print("RESULT: FAIL")
        return 2
    problems += diag_problems(diag)
    if not adv[0]:
        problems.append("the harness frame counter did not advance (rAF stalled)")
    if not sim_adv:
        problems.append("the sim tick did not advance during the bout (%s -> %s)" % (tick_a, tick_b))
    clean = not problems
    report["verdict"] = "BOOTS CLEAN" if clean else "NOT CLEAN"
    report["problems"] = problems
    print("VERDICT: %s" % report["verdict"])
    for p in problems:
        print("   X %s" % p)
    print("report       : %s" % save_report("bootcheck", report, args.base))
    print("RESULT: %s" % ("OK" if clean else "FAIL"))
    return 0 if clean else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="HIT PARADE boot check (gate G4) / SHELL lab (--lab)")
    add_common_args(ap)
    ap.add_argument("--lab", action="store_true", help="run the SHELL lab page checks instead of the G4 bout")
    ap.add_argument("--cpu", type=int, default=1, help="CPU level of P2 in the G4 bout (default 1)")
    ap.add_argument("--stubs", action="store_true",
                    help="start the dev server with HP_LAB_STUBS=1: a missing lane module (core/ai/cpu.ts) resolves to its lab stand-in")
    ap.add_argument("--wait", type=float, default=90.0, help="seconds to wait for __HP__ and 'ready'")
    ap.add_argument("--out-dir", default=SHOTS)
    args = ap.parse_args()
    return run_lab(args) if args.lab else run_game(args)


if __name__ == "__main__":
    raise SystemExit(main())
