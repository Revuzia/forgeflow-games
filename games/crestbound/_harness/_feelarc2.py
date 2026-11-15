#!/usr/bin/env python
"""Feel lane round-2: the measurements no gate makes.
  A. turn radius / yaw rate at FULL RUN vs WALK  (the 'analog' claim)
  B. wall kick availability AFTER a long wallslide (window vs on-wall)
  C. stuck-state probes: bonk exit, slideRecover exit, wallslide exit, crouch exit
Hand-steps game.update(1/60) via feelshots' own driver."""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import feelshots as FS
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OPEN = dict(p=[-58.0, 2.20, 66.0], yaw=0.0)     # measured clear >=26 m, flat y~2.0
SHAFT = FS.SHAFT


def boot(p):
    b = FS.launch(p, True)
    pg = b.new_page(viewport={"width": 1200, "height": 675})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(FS.DEFAULT_URL, wait_until="load", timeout=90_000)
    dl = time.time() + 150
    while time.time() < dl:
        try:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(400)
    FS.leave_title(pg)
    pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", "verdant-1")
    FS.leave_title(pg, timeout=60)
    pg.wait_for_timeout(1500)
    assert pg.evaluate(FS.DRIVER_JS) == "ok"
    return b, pg, errs


def setup(pg, place, auto=None):
    pg.evaluate("(a) => { const F = window.__FEEL; F.begin({}); "
                "F.place(a.p[0], a.p[1], a.p[2], a.yaw); F.step(30); F.begin({auto:a.auto}); }",
                {"p": place["p"], "yaw": place["yaw"], "auto": auto})


def run(pg, acts, total):
    for f, js in sorted(acts, key=lambda k: k[0]):
        pg.evaluate("(n) => window.__FEEL.stepTo(n)", f)
        pg.evaluate("() => { %s }" % js)
    pg.evaluate("(n) => window.__FEEL.stepTo(n)", total)
    return pg.evaluate("() => window.__FEEL.dump()")


def unwrap(a):
    out, off = [], 0.0
    for i, v in enumerate(a):
        if i:
            d = v - a[i - 1]
            if d > math.pi:
                off -= 2 * math.pi
            elif d < -math.pi:
                off += 2 * math.pi
        out.append(v + off)
    return out


def arc(samples, lo, hi, label):
    s = [k for k in samples if lo <= k["i"] <= hi]
    f = unwrap([k["f"] for k in s])
    yaw_rate, radii, sps = [], [], []
    for i in range(1, len(s)):
        w = abs(f[i] - f[i - 1]) * 60.0
        sp = s[i]["sp"]
        if w > 0.05:
            yaw_rate.append(w)
            sps.append(sp)
            if w > 0.2:
                radii.append(sp / w)
    if not yaw_rate:
        print("   %-18s NO TURN DETECTED" % label)
        return None
    tot = abs(f[-1] - f[0])
    r = {"label": label, "peak_yaw_rate": round(max(yaw_rate), 3),
         "median_yaw_rate": round(sorted(yaw_rate)[len(yaw_rate) // 2], 3),
         "median_radius_m": round(sorted(radii)[len(radii) // 2], 3) if radii else None,
         "turned_deg": round(math.degrees(tot), 1),
         "turn_time_s": round(len(yaw_rate) / 60.0, 3),
         "speed_at_turn": round(sorted(sps)[len(sps) // 2], 2),
         "speed_in": round(s[0]["sp"], 2), "speed_out": round(s[-1]["sp"], 2)}
    print("   %-18s yaw %.2f rad/s (peak %.2f)  radius %.2f m  turned %.0f deg in %.2f s  speed %.2f -> %.2f"
          % (label, r["median_yaw_rate"], r["peak_yaw_rate"], r["median_radius_m"] or -1,
             r["turned_deg"], r["turn_time_s"], r["speed_in"], r["speed_out"]))
    return r


LATE_JS = ("(n) => { const F = window.__FEEL;"
           " for (let k = 0; k < 200; k++) { F.step(1);"
           "   if (F.samples[F.samples.length-1].st === 'wallslide') break; }"
           " F.step(n); F.press('Space'); F.step(6); F.release('Space'); F.step(24); }")

OUT = {}
with sync_playwright() as p:
    br, pg, errs = boot(p)

    print("=" * 92)
    print("A. TURN RADIUS vs SPEED  (contract: turnRateSlow 14 below 3 m/s, turnRateFast 4.2 at run)")
    print("=" * 92)
    setup(pg, OPEN)
    d = run(pg, [(0, "__FEEL.setStick(0,-1,1)"), (40, "__FEEL.setStick(-1,0,1)")], 110)
    OUT["turn_run"] = arc(d["samples"], 40, 100, "run mag 1.0")
    setup(pg, OPEN)
    d = run(pg, [(0, "__FEEL.setStick(0,-1,0.40)"), (40, "__FEEL.setStick(-1,0,0.40)")], 110)
    OUT["turn_walk"] = arc(d["samples"], 40, 100, "walk mag 0.40")
    setup(pg, OPEN)
    d = run(pg, [(0, "__FEEL.setStick(0,-1,1)"), (40, "__FEEL.setStick(-0.7,-0.7,1)")], 110)
    OUT["turn_run45"] = arc(d["samples"], 40, 100, "run 45 deg")

    print()
    print("=" * 92)
    print("B. WALL KICK AFTER A LONG WALLSLIDE  (is the kick gated by wallKick.window?)")
    print("=" * 92)
    for delay in (4, 12, 25, 45, 70):
        setup(pg, SHAFT)
        acts = [(2, "__FEEL.setStick(0,-1,1)"), (6, "__FEEL.press('Space')"),
                (11, "__FEEL.release('Space')")]
        run(pg, acts, 26)
        pg.evaluate(LATE_JS, delay)
        s = pg.evaluate("() => window.__FEEL.dump()")["samples"]
        got = any(k["st"] == "wallkick" for k in s[-32:])
        vy = max((k["vy"] for k in s[-32:]), default=0)
        sl = sum(1 for k in s if k["st"] == "wallslide")
        print("   slid %2d frames (%.2f s) before jump -> %-7s (peak vy after press %6.2f, wallslide frames %d)"
              % (delay, delay / 60.0, "KICK" if got else "NO KICK", vy, sl))
        OUT["latekick_%d" % delay] = {"delay_frames": delay, "kicked": got, "peak_vy": round(vy, 2)}

    print()
    print("=" * 92)
    print("C. STUCK-STATE PROBES  (enter the state, then stop asking for it)")
    print("=" * 92)
    setup(pg, FS.MEADOW)
    d = run(pg, [(0, "__FEEL.setStick(0,1,1)"), (100, "__FEEL.clearStick()")], 200)
    s = d["samples"]
    after = [k["st"] for k in s[102:]]
    print("   bonk  : held 100 f then released -> states %s ; end %s sp %.2f"
          % (sorted(set(after)), s[-1]["st"], s[-1]["sp"]))
    OUT["bonk_exit"] = {"states_after_release": sorted(set(after)), "end": s[-1]["st"]}

    setup(pg, FS.MEADOW)
    d = run(pg, [(0, "__FEEL.setStick(0,-1,1)"), (18, "__FEEL.press('KeyF')"),
                 (24, "__FEEL.release('KeyF'); __FEEL.clearStick()")], 240)
    s = d["samples"]
    print("   dive  : stick released at f24 -> end %s sp %.2f ; states %s"
          % (s[-1]["st"], s[-1]["sp"], " -> ".join(dict.fromkeys(k["st"] for k in s))))
    OUT["dive_release"] = {"end": s[-1]["st"], "end_sp": s[-1]["sp"]}

    setup(pg, SHAFT)
    d = run(pg, [(2, "__FEEL.setStick(0,-1,1)"), (6, "__FEEL.press('Space')"),
                 (11, "__FEEL.release('Space')")], 300)
    s = d["samples"]
    print("   wallsl: never jumped -> end %s y %.2f grounded %d ; states %s"
          % (s[-1]["st"], s[-1]["y"], s[-1]["g"], " -> ".join(dict.fromkeys(k["st"] for k in s))))
    OUT["wallslide_end"] = {"end": s[-1]["st"], "y": s[-1]["y"], "grounded": s[-1]["g"]}

    setup(pg, FS.MEADOW)
    d = run(pg, [(4, "__FEEL.press('ControlLeft')"), (80, "__FEEL.release('ControlLeft')"),
                 (90, "__FEEL.setStick(0,-1,1)")], 160)
    s = d["samples"]
    print("   crouch: released f80 -> end %s sp %.2f ; states %s"
          % (s[-1]["st"], s[-1]["sp"], " -> ".join(dict.fromkeys(k["st"] for k in s))))
    OUT["crouch_exit"] = {"end": s[-1]["st"], "end_sp": s[-1]["sp"]}

    try:
        pg.evaluate("() => { const E = CRESTBOUND.engine, G = CRESTBOUND.game;"
                    " if (E && !E.running) E.start((dt) => G.update(dt)); }")
    except Exception:
        pass
    br.close()

json.dump(OUT, open(os.path.join(HERE, "_feelarc2.json"), "w"), indent=1)
print("\nwrote _harness/_feelarc2.json")
if errs:
    print("PAGE ERRORS:", errs[:5])
