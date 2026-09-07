"""PLAYTEST DRIVER — EMBER FOUNDRY 3 "CINDER CHASE"  (owner instruction P11)

Drives the shipped page with REAL KeyboardEvents, samples the live player state,
and drops PNGs. Stages are selectable so a long run can be taken in pieces and
nothing is lost if a stage dies.

    python _harness/_play_ember3.py --stage rim
    python _harness/_play_ember3.py --stage shaft
    python _harness/_play_ember3.py --stage chase
"""
import argparse, json, math, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play, URL  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "_playreports", "ember-3.json")

# Port 8788 is shared with every other lane; under contention its listen backlog
# overflows and the page's ~70 module requests come back ERR_CONNECTION_REFUSED
# (measured this session: "NO BOOT ... reqfail ...hazards/chase.js"). 8811 is this
# lane's own copy of the same repo root.
PLAY_URL = "http://127.0.0.1:8811/games/crestbound/index.html?dev=1&quality=low&autoscale=0"


# --------------------------------------------------------------- report file
def load_report():
    if os.path.exists(REPORT):
        try:
            with open(REPORT, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"area": "ember-3", "played": [], "defects": [], "worked": [], "blocked": []}


def save_report(r):
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(r, f, indent=1)


class E3(Play):
    """ember-3 specific helpers on top of the shared Play driver."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.report = load_report()

    # ------------------------------------------------------------ reporting
    def _append(self, key, item):
        """Re-read before writing so two stages running at once cannot clobber
        each other's findings (this run has died on a usage limit before)."""
        cur = load_report()
        cur.setdefault(key, [])
        if item not in cur[key]:
            cur[key].append(item)
        self.report = cur
        save_report(cur)

    def found(self, where, did, happened, should, png, note=""):
        d = {"where": where, "did": did, "happened": happened, "should": should, "png": png}
        if note:
            d["note"] = note
        self._append("defects", d)
        self.say("  ** DEFECT: %s | %s -> %s" % (where, did, happened))
        return d

    def ok(self, text):
        self._append("worked", text)
        self.say("  OK: " + text)

    def blocked(self, text):
        self._append("blocked", text)
        self.say("  BLOCKED: " + text)

    def note(self, text):
        self._append("played", text)
        self.say("  . " + text)

    # ------------------------------------------------------------ nav
    def snap(self):
        return self.js("""() => { const G = CRESTBOUND.game, P = G.player;
          const gs = G.__dev ? G.__dev.state() : {};
          const col = G._collectibles;
          return { st: G.state, course: G.courseId,
            t: +(G.course ? G.course.clock : 0).toFixed(2),
            p: P ? [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)] : null,
            v: P ? [+P.vel.x.toFixed(2), +P.vel.y.toFixed(2), +P.vel.z.toFixed(2)] : null,
            ps: P ? P.state : null, gnd: P ? !!P.grounded : null,
            jc: P ? P.jumpCount : null, sp: P ? +Math.hypot(P.vel.x, P.vel.z).toFixed(2) : null,
            surf: P ? P.surface : null, dead: P ? !!P.dead : null,
            cp: gs.cpIndex, coins: col && col.counts ? col.counts.coins : null,
            sig: col && col.counts ? col.counts.sigils : null,
            crests: gs.crests, deaths: G.deaths,
            cam: G.cam ? [+G.cam.yaw.toFixed(2), +G.cam.pitch.toFixed(2), +G.cam.dist.toFixed(2), G.cam.mode] : null }; }""")

    def enter(self, course="ember-3", cp=None):
        self.click_title()
        self.wait(900)
        self.unlock_all()
        self.js("(c) => CRESTBOUND.game.__dev.goto(c[0], c[1])", [course, cp])
        for _ in range(80):
            self.wait(250)
            s = self.js("""() => { const G = CRESTBOUND.game;
                return { st: G.state, course: G.courseId,
                         t: G.course ? +G.course.clock.toFixed(2) : null }; }""")
            if s["course"] == course and s["st"] in ("playing", "cinematic"):
                self.first_clock = s["t"]
                break
        self.wait(1200)
        return self.snap()

    def walk(self, x, z, tol=1.4, max_ms=12000, keys=("W",), tag="", reaim_ms=200):
        """Walk toward XZ with real W held, re-aiming the camera. Never stops on
        the 'playing' state (which walk_to in _playlib does)."""
        self.face(x, z)
        self.down(*keys)
        t0 = time.time()
        prev = self.snap()["p"]
        stuck = 0
        trail = []
        while (time.time() - t0) * 1000 < max_ms:
            self.wait(reaim_ms)
            s = self.snap()
            trail.append(s)
            p = s["p"]
            if s["dead"]:
                break
            d = math.hypot(p[0] - x, p[2] - z)
            if d <= tol:
                break
            moved = math.hypot(p[0] - prev[0], p[2] - prev[2])
            stuck = stuck + 1 if moved < 0.06 else 0
            prev = p
            if stuck >= 7:
                break
            self.face(x, z)
        self.up(*keys)
        self.wait(160)
        s = self.snap()
        p = s["p"]
        d = math.hypot(p[0] - x, p[2] - z)
        res = {"target": [x, z], "end": p, "dist": round(d, 2),
               "ms": int((time.time() - t0) * 1000), "arrived": d <= tol,
               "stuck": stuck >= 7, "snap": s, "trail": trail}
        self.say("  walk->%s %s end=%s d=%.2f %s%s ps=%s" % (
            [x, z], "(" + tag + ")" if tag else "", p, d,
            "ARRIVED" if res["arrived"] else "SHORT", " STUCK" if res["stuck"] else "",
            s["ps"]))
        return res

    def jump_to(self, x, z, hold_ms=1500, jump_after=420, tag=""):
        """Run at an XZ target and jump — a real running jump, not a teleport."""
        self.face(x, z)
        self.down("W")
        self.wait(jump_after)
        self.down("SPACE")
        self.wait(110)
        self.up("SPACE")
        out = []
        t = 0
        while t < hold_ms:
            self.wait(120); t += 120
            out.append(self.snap())
        self.up("W")
        self.wait(300)
        s = self.snap()
        self.say("  jump->%s %s end=%s ps=%s gnd=%s" % ([x, z], tag, s["p"], s["ps"], s["gnd"]))
        return {"end": s, "trail": out}

    def chase_front(self):
        """Height of the rising-lava front right now, read off the live hazard."""
        return self.js("""() => { const G = CRESTBOUND.game;
          const hz = G.course && G.course.hazards ? G.course.hazards : [];
          for (const w of hz) {
            if (w && w.def && w.def.kind === 'chase') {
              const h = (w.h && typeof w.h.front === 'number') ? w.h : w;   // course wraps hazards
              const t = G.course.clock;
              return { found: true,
                       y: (typeof h.front === 'number') ? +h.front.toFixed(2) : null,
                       at: (typeof h.frontAt === 'function') ? +h.frontAt(t).toFixed(2) : null,
                       from: h.from, to: h.to, speed: h.speed, delay: h.delay,
                       kills: (h.kills && h.kills.length) || 0,
                       t: +t.toFixed(2) };
            }
          }
          return { found: false, t: G.course ? +G.course.clock.toFixed(2) : null }; }""")

    def set_clock(self, t):
        return self.js("(t) => CRESTBOUND.game.__dev.setClock(t)", t)

    def hazards(self):
        return self.js("""() => (CRESTBOUND.game.course.hazards||[]).map(h => ({
            kind: h && h.def ? h.def.kind : null,
            id: h && h.def ? h.def.id : null,
            p: h && h.def && h.def.p ? h.def.p : null }))""")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="rim")
    ap.add_argument("--cp", type=int, default=None)
    args = ap.parse_args()

    fn = STAGES.get(args.stage)
    if not fn:
        print("stages: " + ", ".join(STAGES))
        return 2
    for attempt in range(3):
        try:
            with E3("ember-3", url=PLAY_URL) as g:
                booted = g.js("() => typeof globalThis.CRESTBOUND")
                if booted == "undefined":
                    print("attempt %d: page did not boot, retrying" % attempt, flush=True)
                    continue
                s = g.enter("ember-3", args.cp)
                g.say("entered:", json.dumps(s))
                if s["course"] != "ember-3":
                    g.say("FAILED TO ENTER ember-3")
                    return 1
                fn(g)
                g.say("console:", json.dumps(g.console[:20]))
                g.dump("ember3_" + args.stage)
            return 0
        except Exception as e:
            print("attempt %d died: %r" % (attempt, e), flush=True)
    return 1


# ---------------------------------------------------------------- stages
def stage_smoke(g):
    g.shot("00_spawn")
    g.say("hazards:", json.dumps(g.hazards()))
    g.say("front:", json.dumps(g.chase_front()))


def stage_rim(g):
    """BEAT 1-3: the ash plain, both lava pools, the geysers, the cannon."""
    fc = getattr(g, "first_clock", None)
    g.note("course clock at the FIRST frame the game called itself 'playing': %s s" % fc)
    if fc is not None and fc > 6.0:
        g.found("ember-3 course entry (the chase clock)",
                "loaded CINDER CHASE and read course.clock on the very first frame the game reported state 'playing'",
                "the course clock was already %.1f s when control was handed over — the chase's 40 s of grace was %.0f%% spent before I could take a step" % (fc, 100 * fc / 40),
                "the clock a chase course is timed against should start when the player gets control, not while the course is loading",
                g.shot("00_clock_at_handover"),
                note="the lava front leaves the shaft floor at t=40 s; the plaza is ~60 m from the crack")
    s = g.snap()
    g.note("spawn %s state=%s clock=%.1f" % (s["p"], s["ps"], s["t"]))
    g.shot("01_spawn_plaza")

    # --- the ash path north, through cp1 -------------------------------
    r = g.walk(0, 40, tag="cp1 ring")
    g.shot("02_cp1")
    s = g.snap()
    g.note("after cp1 walk: cp=%s coins=%s" % (s["cp"], s["coins"]))
    r = g.walk(0, 30, tag="ash path")
    r = g.walk(0, 20, tag="ash path")
    g.shot("03_ashpath")
    s = g.snap()
    g.note("mid ash path %s coins=%s" % (s["p"], s["coins"]))

    # --- the plaza pedestal coin ring ----------------------------------
    g.walk(-6, 41, tag="plaza pedestal ring")
    g.shot("04_plaza_pedestal")
    s = g.snap()
    g.note("plaza pedestal ring: coins=%s pos=%s" % (s["coins"], s["p"]))

    # --- the east lava pool: rim ring, stones, sigil 1 -----------------
    g.walk(24, 26, max_ms=20000, tag="toward east pool")
    g.shot("05_east_pool_approach")
    g.walk(32, 24.2, max_ms=14000, tag="east pool first stone")
    g.shot("06_east_pool_stone1")
    s = g.snap()
    g.note("east pool stone approach: %s ps=%s surf=%s dead=%s" % (s["p"], s["ps"], s["surf"], s["dead"]))
    before = g.snap()
    j = g.jump_to(32, 30.5, tag="stone1 -> sigil stone")
    g.shot("07_east_pool_sigil")
    s = g.snap()
    g.note("east pool after jump: %s sig=%s deaths=%s" % (s["p"], s["sig"], s["deaths"]))

    # --- the west pool + its flame -------------------------------------
    g.js("() => CRESTBOUND.game.__dev.tp(-30, 3.0, 24.0)")
    g.wait(700)
    g.walk(-30, 27.4, max_ms=9000, tag="west pool stone 1 (walked)")
    g.shot("08_west_pool")
    # stand still on the middle stone under the flame for a full cycle
    g.walk(-30, 30.6, max_ms=9000, tag="west pool flame stone")
    d0 = g.snap()["deaths"]
    trail = []
    for i in range(28):
        g.wait(220)
        trail.append(g.snap())
    g.shot("09_west_pool_flame_stand")
    s = g.snap()
    g.note("stood on the flame stone %0.1f s: deaths %s -> %s ps=%s" % (28 * 0.22, d0, s["deaths"], s["ps"]))
    if s["deaths"] > d0:
        g.found("ember-3 west lava pool, flame stone [-30, 30.6]",
                "walked onto the stone the flame vent stands on and stood still for 6 s",
                "the flame killed me while standing still on the only stone in the pool (deaths %s -> %s)" % (d0, s["deaths"]),
                "a flame vent should not be the only footing across a pool — or the stone should sit clear of the jet",
                g.shot("09b_west_flame_death"))

    # --- geyser terrace, cp2, the pads ---------------------------------
    g.js("() => CRESTBOUND.game.__dev.tp(-28, 5.0, 10.0)")
    g.wait(700)
    g.walk(-34, 4, max_ms=14000, tag="cp2 geyser terrace")
    g.shot("10_cp2_geyser")
    s = g.snap()
    g.note("cp2 geyser terrace: %s cp=%s" % (s["p"], s["cp"]))
    # the sign
    g.face(-34, 8)
    g.wait(400)
    g.shot("11_geyser_sign_STAND_ON_IT")
    # pad 1 -> pillar A (sigil 2)
    g.walk(-40, 2, max_ms=12000, tag="pad 1")
    pre = g.snap()
    out = []
    for i in range(16):
        g.wait(200); out.append(g.snap())
    top = max((o["p"][1] for o in out), default=None)
    g.shot("12_pad1_launch")
    g.note("pad 1 launch: entered at y=%.2f, peak y=%.2f, end %s" % (pre["p"][1], top or -99, g.snap()["p"]))
    if top is None or top < pre["p"][1] + 2.0:
        g.found("ember-3 geyser terrace, jump pad 1 [-40, 4.54, 2]",
                "walked onto the pad and waited",
                "the pad did not throw me (peak y %.2f from %.2f)" % (top or -99, pre["p"][1]),
                "a jumppad with power 9.0 should launch ~9 m",
                g.shot("12b_pad1_nolaunch"))
    else:
        g.ok("ember-3 jump pad 1 launches on contact (peak y %.2f from %.2f)" % (top, pre["p"][1]))

    # --- cannon bluff cp3, the pad, the crag, the cannon ---------------
    g.js("() => CRESTBOUND.game.__dev.tp(28, 6.2, 4.0)")
    g.wait(700)
    g.walk(34, 2, max_ms=14000, tag="cp3 cannon bluff")
    g.shot("13_cp3_bluff")
    s = g.snap()
    g.note("cp3 bluff: %s cp=%s" % (s["p"], s["cp"]))
    g.face(30, 9.2)
    g.wait(400)
    g.shot("14_cannon_sign")
    g.walk(40, 6, max_ms=12000, tag="bluff jump pad")
    for i in range(12):
        g.wait(200)
    g.shot("15_bluff_pad_crag")
    g.note("bluff pad -> crag: %s" % (g.snap()["p"],))
    # the cannon
    g.js("() => CRESTBOUND.game.__dev.tp(27.5, 6.4, 6.0)")
    g.wait(700)
    g.walk(30, 6, max_ms=9000, tag="into the cannon breech")
    g.shot("16_cannon_enter")
    pre = g.snap()
    out = []
    for i in range(30):
        g.wait(200); out.append(g.snap())
        if out[-1]["ps"] == "cannon":
            break
    g.wait(400)
    for i in range(24):
        g.wait(200); out.append(g.snap())
    g.shot("17_cannon_after")
    s = g.snap()
    states = sorted(set(o["ps"] for o in out))
    g.note("cannon: entered at %s, states seen %s, end %s" % (pre["p"], states, s["p"]))
    if "cannon" not in states:
        g.found("ember-3 cannon bluff, the shaft-gun [30, 5.6, 6]",
                "walked into the cannon breech from the bluff, as its own sign says (CLIMB IN AND IT FIRES)",
                "the player never entered the cannon (states seen: %s); end pos %s" % (states, s["p"]),
                "walking into the breech should put the hero in the 'cannon' state and fire him at the balcony",
                g.shot("17b_cannon_nofire"))
    else:
        g.ok("ember-3 cannon takes the hero on walk-in and fires (end %s)" % (s["p"],))


def stage_court(g):
    """BEAT 4-5: through the crack, the court, the vents, the slag steps to cp5."""
    g.js("() => CRESTBOUND.game.__dev.skipCP(3)")
    g.wait(1400)
    s = g.snap()
    g.note("cp-court start %s cp=%s clock=%.1f" % (s["p"], s["cp"], s["t"]))
    g.shot("20_court_spawn")

    # read the pedestal + the coin ring
    g.walk(-6, -8, max_ms=12000, tag="court pedestal / coin ring")
    g.shot("21_court_pedestal")
    s = g.snap()
    g.note("court pedestal: %s coins=%s" % (s["p"], s["coins"]))

    # the floor vents — walk the gauntlet toward sigil 4's slag block
    d0 = g.snap()["deaths"]
    g.walk(-6, -22, max_ms=14000, tag="first floor vent")
    g.shot("22_floor_vent")
    g.walk(-6, -28, max_ms=14000, tag="sigil 4 slag block")
    g.shot("23_sigil4_block")
    s = g.snap()
    g.note("vent walk to sigil 4: end %s sig=%s deaths %s -> %s" % (s["p"], s["sig"], d0, s["deaths"]))

    # THE SLAG STEPS — a real running jump up each one
    steps = [(0, -11.5, 7.6), (6, -14, 9.1), (8.5, -20, 10.6), (6, -26, 12.1), (0, -28.5, 13.6)]
    g.js("() => CRESTBOUND.game.__dev.tp(0, 6.1, -8.5)")
    g.wait(600)
    ok = True
    for i, (x, z, top) in enumerate(steps):
        pre = g.snap()
        j = g.jump_to(x, z, hold_ms=1600, jump_after=380, tag="S%d" % (i + 1))
        s = g.snap()
        g.shot("24_%d_slagstep_S%d" % (i, i + 1))
        landed = abs(s["p"][1] - top) < 0.8
        g.note("S%d target top %.2f: landed y=%.2f %s (ps=%s)" % (
            i + 1, top, s["p"][1], "OK" if landed else "MISSED", s["ps"]))
        if not landed:
            ok = False
            g.found("ember-3 slag steps, S%d [%s, %s] top %.2f" % (i + 1, x, z, top),
                    "ran at the step from the previous one and jumped (real W + Space)",
                    "ended at y=%.2f (%s), state %s" % (s["p"][1], s["p"], s["ps"]),
                    "a 1.5-1.6 m rise over a 2 m gap is inside the single jump; it should land",
                    g.shot("24b_%d_slagstep_miss" % i))
            # get back on track so the rest of the stage still runs
            g.js("(p) => CRESTBOUND.game.__dev.tp(p[0], p[1], p[2])", [x, top + 0.4, z])
            g.wait(500)
    if ok:
        g.ok("ember-3 slag steps S1-S5 all land on a plain running jump (the BEAT 5 rhythm reads)")

    # up to the gallery sill
    j = g.jump_to(0, -32.0, hold_ms=1800, jump_after=420, tag="S5 -> gallery sill 14.00")
    s = g.snap()
    g.shot("25_gallery_sill")
    g.note("S5 -> gallery: end %s ps=%s" % (s["p"], s["ps"]))
    if s["p"][1] < 13.5:
        g.found("ember-3 BEAT 5 exit, S5 (top 13.60) -> gallery sill (14.00)",
                "ran north off S5 and jumped for the sill, the only way BEAT 5 joins BEAT 6",
                "fell back to y=%.2f at %s" % (s["p"][1], s["p"]),
                "the last step of the spiral should reach the gallery; it is a 1.5 m gap at +0.4",
                g.shot("25b_gallery_miss"))


def stage_shaft(g):
    """BEAT 6-8: plates, bars, mid deck, the tube secret, the chimney, the spiral."""
    g.js("() => CRESTBOUND.game.__dev.skipCP(4)")
    g.wait(1400)
    s = g.snap()
    g.note("cp-gallery start %s cp=%s clock=%.1f" % (s["p"], s["cp"], s["t"]))
    g.shot("30_gallery")

    # the gallery coin line + the sign
    g.walk(6, -33.5, max_ms=10000, tag="gallery coin line east")
    g.shot("31_gallery_coins")
    g.note("gallery coin line: %s coins=%s" % (g.snap()["p"], g.snap()["coins"]))

    # --- ride the east elevator plate M1 --------------------------------
    g.js("() => CRESTBOUND.game.__dev.tp(11.5, 14.2, -16.0)")
    g.wait(700)
    g.walk(9.5, -12.0, max_ms=12000, tag="onto plate M1")
    ride = []
    for i in range(50):
        g.wait(250); ride.append(g.snap())
    g.shot("32_plate_ride")
    ys = [r["p"][1] for r in ride]
    g.note("plate M1 ride: y %.2f -> %.2f (min %.2f max %.2f), ps=%s" % (
        ys[0], ys[-1], min(ys), max(ys), ride[-1]["ps"]))
    if max(ys) < 20.0:
        g.found("ember-3 BEAT 6, elevator plate M1 [9.5, 14.8, -12]",
                "stood on the plate and waited 12 s for it to lift (it runs 15.05 -> 21.65 on a 9 s period)",
                "the highest I reached was y=%.2f — the plate never carried me up" % max(ys),
                "a mover with a rider should carry the hero from the y-14 gallery to the mid deck",
                g.shot("32b_plate_noride"))
    else:
        g.ok("ember-3 elevator plate M1 carries the hero 15 -> %.1f m (the rider works)" % max(ys))

    # --- the rotor bars -------------------------------------------------
    g.js("() => CRESTBOUND.game.__dev.tp(0, 22.5, -20)")
    g.wait(900)
    g.shot("33_middeck")
    s = g.snap()
    g.note("mid deck: %s surf=%s" % (s["p"], s["surf"]))
    # stand still on the mid deck under the y-26 rotor for a full period
    d0 = s["deaths"]
    for i in range(35):
        g.wait(220)
    s = g.snap()
    g.note("stood on the mid deck 7.7 s (one full rotor period at y26 is 7 s): deaths %s -> %s, pos %s" % (
        d0, s["deaths"], s["p"]))
    g.shot("34_middeck_rotor")

    # --- BEAT 7 the secret: long jump east into the lava tube -----------
    g.js("() => CRESTBOUND.game.__dev.tp(-6.0, 22.5, -20)")
    g.wait(700)
    # long jump = run east, crouch+jump at speed
    g.face(21, -20)
    g.down("W")
    g.wait(900)                      # build speed along the 13 m deck
    pre = g.snap()
    g.down("C")
    g.wait(60)
    g.down("SPACE")
    g.wait(110)
    g.up("SPACE"); g.up("C")
    lj = []
    for i in range(16):
        g.wait(150); lj.append(g.snap())
    g.up("W")
    g.wait(400)
    s = g.snap()
    g.shot("35_longjump_tube")
    states = [x["ps"] for x in lj]
    g.note("mid deck long jump east: launch speed %.2f, states %s, end %s" % (
        pre["sp"], sorted(set(states)), s["p"]))
    if s["p"][0] < 11.5:
        g.found("ember-3 BEAT 7, the secret long jump: mid deck (x -6.5..6.5, 22.10) -> lava tube floor (x 12..21, 22.60)",
                "ran the 13 m of deck along +X at speed %.2f m/s and did crouch+jump (C then Space) — the long jump the course header says this crest is worth" % pre["sp"],
                "ended at x=%.2f (%s) — short of the tube mouth at x=12" % (s["p"][0], s["p"]),
                "a long jump is safe to 6.42 m and this gap is 5.50 m at +0.50; it should clear",
                g.shot("35b_longjump_short"))
    else:
        g.ok("ember-3 the long jump from the mid deck reaches the lava tube (end %s)" % (s["p"],))

    # pound the plug either way
    g.js("() => CRESTBOUND.game.__dev.tp(16.5, 23.2, -20)")
    g.wait(800)
    g.shot("36_tube_inside")
    s0 = g.snap()
    g.walk(18.0, -20, max_ms=8000, tag="up to the plug")
    # jump then pound (C in the air)
    g.tap("SPACE", 110)
    g.wait(260)
    g.down("C"); g.wait(700); g.up("C")
    g.wait(1200)
    g.shot("37_plug_pound")
    s = g.snap()
    g.note("pound at the plug: crests %s -> %s, pos %s" % (s0["crests"], s["crests"], s["p"]))
    # is the crest there now?
    got = g.js("""() => { const G = CRESTBOUND.game, c = G._collectibles;
        return { crests: G.__dev.state().crests, live: c && c._crests ? c._crests.length : null }; }""")
    g.note("after the pound: %s" % json.dumps(got))

    # sigil 6 in the tube
    g.walk(15.0, -20, max_ms=8000, tag="sigil 6 in the tube")
    g.shot("38_sigil6")
    g.note("sigil 6 attempt: sig=%s pos=%s" % (g.snap()["sig"], g.snap()["p"]))

    # --- BEAT 8 the chimney (wall kicks) --------------------------------
    g.js("() => CRESTBOUND.game.__dev.tp(-10.5, 22.6, -12.0)")
    g.wait(800)
    g.shot("39_chimney_foot")
    s0 = g.snap()
    # jump, then alternate kicks against the two walls
    g.face(-8.8, -12.0)
    g.tap("SPACE", 110)
    kicks = []
    for i in range(8):
        g.wait(230)
        # steer into the wall we are nearest, then kick
        st = g.snap()
        tx = -8.5 if st["p"][0] < -9.8 else -12.2
        g.face(tx, -12.0)
        g.down("W"); g.wait(150)
        g.tap("SPACE", 100)
        g.up("W")
        kicks.append(g.snap())
    g.wait(600)
    s = g.snap()
    g.shot("40_chimney_kicks")
    top = max(k["p"][1] for k in kicks) if kicks else s0["p"][1]
    g.note("chimney: start y %.2f, best y %.2f, end %s ps=%s" % (s0["p"][1], top, s["p"], s["ps"]))
    if top < 26.0:
        g.found("ember-3 BEAT 8, the wall-kick chimney (foot 22.20 -> head 30.70, 2.80 m slot at x -12 .. -9.2, z -12)",
                "jumped in the slot and alternated Space against each wall for 8 kicks, exactly as its own sign says (KICK ONE WALL, THEN THE OTHER)",
                "best height reached was y=%.2f of the 30.70 the head sits at; ended %s" % (top, s["p"]),
                "four kicks at +2.0 m each should climb the 8.50 m",
                g.shot("40b_chimney_short"))
    else:
        g.ok("ember-3 the wall-kick chimney climbs (best y %.2f)" % top)

    # --- the vanish spiral ----------------------------------------------
    spiral = [(9.0, -20.0, 23.7), (6.5, -26.0, 25.3), (0, -28.5, 26.9),
              (-6.5, -26.0, 28.5), (-9.0, -20.0, 30.1), (-6.5, -14.0, 31.7),
              (0, -11.5, 33.3), (0, -20.0, 34.9)]
    g.js("() => CRESTBOUND.game.__dev.tp(9.0, 24.1, -20.0)")
    g.wait(800)
    for i in range(1, len(spiral)):
        x, z, top = spiral[i]
        pre = g.snap()
        g.jump_to(x, z, hold_ms=1700, jump_after=340, tag="U%d" % i)
        s = g.snap()
        g.shot("41_%d_spiral_U%d" % (i, i))
        landed = abs(s["p"][1] - top) < 0.9
        g.note("spiral U%d top %.2f: y=%.2f %s ps=%s" % (i, top, s["p"][1], "OK" if landed else "MISSED", s["ps"]))
        if not landed:
            g.found("ember-3 BEAT 8 upper spiral, ledge %d at [%s, %s] top %.2f" % (i, x, z, top),
                    "ran at it from the previous ledge and jumped",
                    "ended y=%.2f at %s (state %s)" % (s["p"][1], s["p"], s["ps"]),
                    "the authored gap is 2.1-2.6 m at +1.60, inside the single jump's 3.28 m",
                    g.shot("41b_%d_spiral_miss" % i))
            g.js("(p) => CRESTBOUND.game.__dev.tp(p[0], p[1], p[2])", [x, top + 0.4, z])
            g.wait(500)
    # onto the deck
    g.jump_to(0, -24.0, hold_ms=1800, jump_after=380, tag="exit ledge -> caldera deck")
    s = g.snap()
    g.shot("42_deck_arrive")
    g.note("exit ledge -> deck: end %s ps=%s" % (s["p"], s["ps"]))


def stage_chase(g):
    """The set piece: can the climb be made at the pace the lava rises?"""
    g.js("() => CRESTBOUND.game.__dev.skipCP(3)")   # cp-court, clockOffset 0
    g.wait(1500)
    f = g.chase_front()
    g.note("chase params: %s" % json.dumps(f))
    s = g.snap()
    g.note("chase start at cp-court %s clock=%.2f front=%s" % (s["p"], s["t"], f.get("y")))
    g.shot("50_chase_start")

    # play it: floor -> steps -> gallery -> plate -> mid deck -> spiral -> exit
    route = [
        ("walk", 0, -8.5, 6000),
        ("jump", 0, -11.5, 7.6),
        ("jump", 6, -14, 9.1),
        ("jump", 8.5, -20, 10.6),
        ("jump", 6, -26, 12.1),
        ("jump", 0, -28.5, 13.6),
        ("jump", 0, -32.0, 14.0),
    ]
    log = []
    for step in route:
        if step[0] == "walk":
            g.walk(step[1], step[2], max_ms=step[3], tag="chase")
        else:
            g.jump_to(step[1], step[2], hold_ms=1500, jump_after=340, tag="chase")
        s = g.snap(); f = g.chase_front()
        log.append({"t": s["t"], "y": s["p"][1], "front": f.get("y"), "p": s["p"], "deaths": s["deaths"]})
        g.note("chase t=%.1f hero y=%.2f front y=%s margin %.2f" % (
            s["t"], s["p"][1], f.get("y"), s["p"][1] - (f.get("y") or 0)))
        if s["deaths"] > 0:
            break
    g.shot("51_chase_gallery")

    # keep climbing on the real clock
    g.walk(9.5, -12.0, max_ms=12000, tag="chase: onto plate M1")
    for i in range(40):
        g.wait(250)
        s = g.snap(); f = g.chase_front()
        if i % 8 == 0:
            g.note("chase ride t=%.1f y=%.2f front=%s" % (s["t"], s["p"][1], f.get("y")))
        if s["deaths"] > 0:
            break
    s = g.snap(); f = g.chase_front()
    g.shot("52_chase_plate")
    g.note("chase after the plate: t=%.1f hero %s front %s deaths=%s" % (s["t"], s["p"], f.get("y"), s["deaths"]))

    # spiral on the clock
    spiral = [(9.0, -20.0, 23.7), (6.5, -26.0, 25.3), (0, -28.5, 26.9),
              (-6.5, -26.0, 28.5), (-9.0, -20.0, 30.1), (-6.5, -14.0, 31.7),
              (0, -11.5, 33.3), (0, -20.0, 34.9)]
    if g.snap()["p"][1] < 21.0:
        g.js("() => CRESTBOUND.game.__dev.tp(0, 22.5, -20)")
        g.wait(600)
        g.note("(teleported to the mid deck to keep the chase test going; the plate ride is reported above)")
    g.js("() => CRESTBOUND.game.__dev.tp(9.0, 24.1, -20.0)")
    g.wait(500)
    for i in range(1, len(spiral)):
        x, z, top = spiral[i]
        g.jump_to(x, z, hold_ms=1500, jump_after=320, tag="chase U%d" % i)
        s = g.snap(); f = g.chase_front()
        g.note("chase U%d t=%.1f y=%.2f front=%s margin %.2f deaths=%s" % (
            i, s["t"], s["p"][1], f.get("y"), s["p"][1] - (f.get("y") or 0), s["deaths"]))
        if abs(s["p"][1] - top) > 0.9:
            g.js("(p) => CRESTBOUND.game.__dev.tp(p[0], p[1], p[2])", [x, top + 0.4, z])
            g.wait(400)
        if s["deaths"] > 2:
            break
    g.shot("53_chase_top")
    s = g.snap(); f = g.chase_front()
    g.note("chase end: t=%.1f hero %s front %s deaths=%s" % (s["t"], s["p"], f.get("y"), s["deaths"]))

    # ---- FAIRNESS: die in the shaft and see what the clock does --------
    g.js("() => CRESTBOUND.game.__dev.skipCP(4)")   # cp-gallery, clockOffset 30
    g.wait(1400)
    pre = g.snap(); pref = g.chase_front()
    g.note("cp-gallery entry: clock %.2f front %s" % (pre["t"], pref.get("y")))
    g.js("() => CRESTBOUND.game.__dev.setClock(70)")
    g.wait(600)
    mid = g.snap(); midf = g.chase_front()
    g.note("clock forced to 70: front %s (should be at/near the 32.0 stop)" % midf.get("y"))
    g.shot("54_front_at_70s")
    g.js("() => CRESTBOUND.game.__dev.kill('lava')")
    g.wait(2500)
    post = g.snap(); postf = g.chase_front()
    g.note("after a death at cp-gallery: clock %.2f front %s pos %s" % (post["t"], postf.get("y"), post["p"]))
    g.shot("55_after_death_reset")
    if postf.get("y") is not None and postf["y"] > 15.0:
        g.found("ember-3 the chase, respawn at cp-gallery (clockOffset 30)",
                "let the clock run to 70 s (front at %.1f m), then died" % (midf.get("y") or -1),
                "respawned with the lava front still at y=%.2f, i.e. above the y-14 gallery the checkpoint puts me on" % postf["y"],
                "cp-gallery declares clockOffset 30, which should put the front back on the shaft floor (4.5 m) and give ~22 s of grace",
                g.shot("55b_unfair_reset"))
    else:
        g.ok("ember-3 dying at cp-gallery rewinds the lava front to %.2f m (the retry is fair)" % (postf.get("y") or -1))


def stage_caldera(g):
    """BEAT 9-10: the deck, the Warden, the crest on the lip, sigil 8, the rings."""
    g.js("() => CRESTBOUND.game.__dev.skipCP(5)")
    g.wait(1500)
    s = g.snap()
    g.note("cp-deck start %s cp=%s" % (s["p"], s["cp"]))
    g.shot("60_deck")
    g.face(0, -31)
    g.wait(500)
    g.shot("61_deck_sign")

    # walk at the Warden and fight it: jump the wave, pound its back
    d0 = g.snap()["deaths"]
    g.walk(0, -28, max_ms=12000, tag="toward the Warden")
    g.shot("62_warden_approach")
    w = g.js("""() => { const w = CRESTBOUND.game._warden;
        return w ? { hp: w.hp, engaged: !!w.engaged, p: w.mesh ? [+w.mesh.position.x.toFixed(2), +w.mesh.position.y.toFixed(2), +w.mesh.position.z.toFixed(2)] : null } : null; }""")
    g.note("warden: %s" % json.dumps(w))
    if not w:
        g.found("ember-3 BEAT 9, the Warden of the Caldera",
                "walked onto the north slab where the course places a warden at [0, 36, -31] with arena r 6",
                "there is no _warden on the live course at all",
                "the boss crest depends on it — it should be there and engage",
                g.shot("62b_no_warden"))
    else:
        # fight: jump on approach, pound when behind
        for rnd in range(14):
            g.walk(0, -31, max_ms=2600, tag="warden round %d" % rnd)
            g.tap("SPACE", 110)
            g.wait(300)
            g.down("C"); g.wait(500); g.up("C")
            g.wait(700)
            st = g.js("""() => { const w = CRESTBOUND.game._warden;
                return w ? { hp: w.hp, engaged: !!w.engaged } : null; }""")
            if st and st["hp"] <= 0:
                break
        g.shot("63_warden_fight")
        st = g.js("""() => { const w = CRESTBOUND.game._warden; return w ? { hp: w.hp, engaged: !!w.engaged } : null; }""")
        s = g.snap()
        g.note("warden after 14 rounds: %s, deaths %s -> %s, crests %s" % (json.dumps(st), d0, s["deaths"], s["crests"]))

    # the crest on the lip
    g.js("() => CRESTBOUND.game.__dev.tp(0, 36.4, -34.0)")
    g.wait(700)
    g.walk(0, -36.6, max_ms=9000, tag="the lip")
    g.shot("64_lip")
    s0 = g.snap()
    g.tap("SPACE", 110)
    g.wait(1400)
    s = g.snap()
    g.shot("65_open_crest")
    g.note("open crest attempt: crests %s -> %s, pos %s, state %s" % (s0["crests"], s["crests"], s["p"], s["st"]))
    if s["crests"] == s0["crests"] and s["st"] not in ("clear", "cinematic"):
        g.found("ember-3 the open crest, CREST ON THE CALDERA LIP [0, 38.80, -37]",
                "stood on the lip block (top 37.60) and jumped for the crest 1.20 m above it",
                "no crest collected (crests still %s), state %s at %s" % (s["crests"], s["st"], s["p"]),
                "the course's only required crest should collect on contact from the lip",
                g.shot("65b_crest_missed"))
    else:
        g.ok("ember-3 the open crest collects from the lip")

    # sigil 8 on the east crag
    g.js("() => CRESTBOUND.game.__dev.tp(13.0, 36.5, -20.0)")
    g.wait(700)
    s0 = g.snap()
    g.jump_to(17.0, -20.0, hold_ms=1700, jump_after=360, tag="east crag, sigil 8")
    g.wait(600)
    s = g.snap()
    g.shot("66_sigil8_crag")
    g.note("sigil 8 crag: sig %s -> %s, end %s" % (s0["sig"], s["sig"], s["p"]))


def stage_clock(g):
    """Where the chase's 40 s of grace actually goes: load, intro, card, death."""
    g.note("dev-goto handover clock: %s s" % getattr(g, "first_clock", None))

    # --- 1. A REAL entry: back to the Keep, walk into the ember-3 gate ----
    g.js("() => CRESTBOUND.game.__dev.keep()")
    for _ in range(60):
        g.wait(400)
        if g.js("() => CRESTBOUND.game.state") == "keep":
            break
    g.wait(1200)
    gate = g.js("""() => { const G = CRESTBOUND.game;
        const gt = (G._gates||[]).find(x => x.course === 'ember-3');
        return gt ? { p: [gt.pos.x, gt.pos.y, gt.pos.z], yaw: gt.yaw,
                      unlocked: gt.unlocked, sealed: gt.sealed } : null; }""")
    g.note("keep gate for ember-3: %s" % json.dumps(gate))
    if not gate:
        g.blocked("could not find the ember-3 gate in the Keep to time a real entry")
        return
    # stand 3 m in front of it and walk in
    import math as _m
    yaw = gate["yaw"] or 0
    fx = -_m.sin(yaw); fz = -_m.cos(yaw)
    sx = gate["p"][0] - fx * 3.2
    sz = gate["p"][2] - fz * 3.2
    g.js("(p) => CRESTBOUND.game.__dev.tp(p[0], p[1], p[2])", [sx, gate["p"][1] - 1.4, sz])
    g.wait(900)
    g.shot("70_keep_gate_ember3")
    g.face(gate["p"][0], gate["p"][2])
    g.down("W")
    seen = None
    for _ in range(40):
        g.wait(200)
        st = g.js("() => ({ st: CRESTBOUND.game.state, card: !!document.querySelector('.cb-card.on') })")
        if st["st"] == "card" or st["card"]:
            seen = "card"; break
        if st["st"] in ("playing", "cinematic"):
            seen = st["st"]; break
    g.up("W")
    g.shot("71_course_card")
    g.note("walking into the ember-3 painting produced: %s" % seen)
    if seen == "card":
        g.js("""() => { const c = document.querySelector('.cb-card');
            const b = c ? [...c.querySelectorAll('button')].find(x => /ENTER/i.test(x.textContent||'')) : null;
            if (b) { if (b.__activate) b.__activate(); else b.click(); } }""")
    # sample the clock every 200 ms from the card through to control
    trace = []
    handover = None
    for _ in range(160):
        g.wait(200)
        st = g.js("""() => { const G = CRESTBOUND.game;
            return { st: G.state, id: G.courseId, t: G.course ? +G.course.clock.toFixed(2) : null }; }""")
        trace.append(st)
        if st["id"] == "ember-3" and st["st"] == "playing":
            handover = st["t"]
            break
    g.shot("72_real_entry_playing")
    firstseen = next((x["t"] for x in trace if x["id"] == "ember-3" and x["t"] is not None), None)
    g.note("REAL entry through the painting: course clock first readable %.2f s, clock at control handover %.2f s (states: %s)" % (
        firstseen or -1, handover if handover is not None else -1,
        ",".join(sorted(set(x["st"] for x in trace)))))
    if handover is not None and handover > 6.0:
        g.found("ember-3 entry from the Keep (the chase clock)",
                "walked into the CINDER CHASE painting in the Keep, pressed ENTER on the course card, and read course.clock on the first frame the game reported 'playing'",
                "the chase clock already read %.1f s before I could move — %.0f%% of the 40 s the lava gives you spent on the loading screen, the intro and the card" % (handover, 100 * handover / 40),
                "on a course whose whole design is a 40 s head start, the clock must not run while the player has no control (game.js `simulating` includes 'cinematic' and 'card', and course.update is not gated on `frozen`)",
                g.shot("72b_entry_clock"))
    else:
        g.ok("ember-3 hands over control with the chase clock at %.1f s" % (handover if handover is not None else -1))

    # --- 2. What a DEATH costs the chase clock --------------------------
    g.js("() => CRESTBOUND.game.__dev.skipCP(3)")
    g.wait(1500)
    g.js("() => CRESTBOUND.game.__dev.setClock(35)")
    g.wait(400)
    pre = g.snap(); pref = g.chase_front()
    g.js("() => CRESTBOUND.game.__dev.kill('lava')")
    dtrace = []
    for _ in range(30):
        g.wait(200)
        dtrace.append(g.js("""() => { const G = CRESTBOUND.game;
            return { st: G.state, t: G.course ? +G.course.clock.toFixed(2) : null }; }"""))
        if dtrace[-1]["st"] == "playing" and len(dtrace) > 4:
            break
    post = g.snap(); postf = g.chase_front()
    g.shot("73_death_clock")
    g.note("death at cp-court: clock %.2f (front %s) -> after respawn %.2f (front %s); peak during the death sequence %.2f" % (
        pre["t"], pref.get("y"), post["t"], postf.get("y"),
        max((x["t"] or 0) for x in dtrace)))
    if post["t"] > 1.0:
        g.found("ember-3 respawn at cp-court (clockOffset 0)",
                "let the chase clock reach 35 s, then died, then read the clock after the respawn",
                "the clock came back at %.2f s, not 0 — the checkpoint's own clockOffset is 0" % post["t"],
                "cp-court declares clockOffset 0 so a retry should get the full 40 s of grace back",
                g.shot("73b_death_clock_not_reset"))
    else:
        g.ok("ember-3 dying at cp-court rewinds the chase clock to %.2f s (clockOffset 0 honoured)" % post["t"])


def _colliders_near(g, x, y, z, r=3.0):
    return g.js("""(q) => { const A = globalThis.CRESTBOUND, G = A.game, C = G.course;
        const T = A.THREE;
        const box = new T.Box3(new T.Vector3(q.x-q.r, q.y-1.5, q.z-q.r),
                               new T.Vector3(q.x+q.r, q.y+3.0, q.z+q.r));
        const cols = C.broadphase.query(box, []);
        return cols.map(c => ({
          kind: c.kind || c.type || null,
          surface: c.surface || null,
          solid: c.solid !== false,
          active: c.active !== false,
          group: c.group || null,
          center: c.center ? [+c.center.x.toFixed(2), +c.center.y.toFixed(2), +c.center.z.toFixed(2)] : null,
          half: c.half ? [+c.half.x.toFixed(2), +c.half.y.toFixed(2), +c.half.z.toFixed(2)] : null,
          refKind: c.ref && c.ref.def ? (c.ref.def.kindOf || c.ref.def.kind) : (c.ref && c.ref.kind) || null,
          props: c.props ? Object.keys(c.props).slice(0, 8) : null,
        })); }""", {"x": x, "y": y, "z": z, "r": r})


def stage_stuck(g):
    """Follow up the two places the rim walk stopped dead: is something invisible there?"""
    # ---------------- the geyser terrace, cp2 -> pad 1 ------------------
    g.js("() => CRESTBOUND.game.__dev.skipCP(1)")
    g.wait(1400)
    s = g.snap()
    g.note("cp2 start %s" % (s["p"],))
    r = g.walk(-40, 2, max_ms=14000, tag="cp2 -> jump pad 1")
    st = g.snap()
    g.shot("80_geyser_stuck")
    cols = _colliders_near(g, st["p"][0] - 1.2, st["p"][1], st["p"][2] - 0.6, 2.6)
    g.note("colliders within 2.6 m WEST of where the walk stopped (%s): %s" % (
        st["p"], json.dumps(cols)))
    # look at what is in the way
    g.js("""(p) => { const G = CRESTBOUND.game;
        G.cam.yaw = Math.atan2(-(p[0] - G.player.pos.x), -(p[1] - G.player.pos.z)); }""",
         [-40.0, 2.0])
    g.wait(600)
    g.shot("81_geyser_obstruction")
    if not r["arrived"]:
        g.found("ember-3 geyser terrace, walking from cp2 [-34, 4.4, 4] to jump pad 1 [-40, 4.54, 2]",
                "held W straight at the pad across 6 m of the terrace flat (the flat is dead level at 4.40 for 11 m around (-34, 4))",
                "the hero stopped at %s and stayed there running on the spot (%s), %.1f m short of the pad" % (
                    st["p"], st["ps"], r["dist"]),
                "the terrace between the checkpoint and its own 'STAND ON IT' pad should be walkable",
                g.shot("81b_geyser_blocked"),
                note="colliders logged in the played narrative for this stop")
    # try the other two pads too, from directly beside them
    for (px, pz, name) in ((-40, 2, "pad 1 power 9"), (-36, -2, "pad 2 power 6"), (-34, 10, "pad 3 power 8")):
        g.js("(p) => CRESTBOUND.game.__dev.tp(p[0], p[1], p[2])", [px + 2.2, 5.4, pz + 2.2])
        g.wait(700)
        pre = g.snap()
        rr = g.walk(px, pz, tol=0.9, max_ms=7000, tag="onto %s" % name)
        peak = pre["p"][1]
        for i in range(18):
            g.wait(200)
            sn = g.snap()
            peak = max(peak, sn["p"][1])
        end = g.snap()
        g.shot("82_%s" % name.split()[1])
        g.note("%s: walked on from 2.2 m away -> end %s, peak y %.2f (terrace is 4.40)" % (
            name, end["p"], peak))
        if peak < 6.5:
            g.found("ember-3 geyser terrace, %s at [%s, 4.54, %s]" % (name, px, pz),
                    "walked onto the pad from 2.2 m away and waited 3.6 s (its own sign says STAND ON IT)",
                    "the pad never launched me: peak height %.2f m off a 4.40 m terrace, ended %s" % (peak, end["p"]),
                    "a jumppad with power 6-9 should throw the hero 6-9 m up; sigil 2 on the tall pillar is reachable no other way",
                    g.shot("82b_%s_nolaunch" % name.split()[1]))
        else:
            g.ok("ember-3 %s launches the hero to %.2f m" % (name, peak))

    # ---------------- the cannon bluff, cp3 ----------------------------
    g.js("() => CRESTBOUND.game.__dev.skipCP(2)")
    g.wait(1400)
    s = g.snap()
    g.note("cp3 start %s" % (s["p"],))
    g.shot("83_bluff_start")
    r = g.walk(30, 6, max_ms=12000, tag="cp3 -> the cannon breech")
    st = g.snap()
    g.shot("84_bluff_stuck")
    cols = _colliders_near(g, st["p"][0] + 1.2, st["p"][1], st["p"][2], 3.0)
    g.note("cp3 -> cannon: stopped at %s (%s); colliders 1.2 m EAST: %s" % (
        st["p"], st["ps"], json.dumps(cols)))
    if not r["arrived"]:
        g.found("ember-3 cannon bluff, walking from cp3 [34, 5.6, 2] to the cannon breech [30, 5.6, 6]",
                "held W straight at the cannon from the checkpoint, the way its own sign tells you to (CLIMB IN AND IT FIRES)",
                "the hero stopped at %s in state '%s' and could not get any closer than %.1f m" % (
                    st["p"], st["ps"], r["dist"]),
                "the bluff flat is level at 5.60 for 12 m around (34, 2) — the walk to the course's only ROUTE C should be clear",
                g.shot("84b_bluff_blocked"))
    # then try boarding it from right on top of the breech
    g.js("() => CRESTBOUND.game.__dev.tp(30.0, 6.6, 7.6)")
    g.wait(800)
    g.shot("85_on_the_breech")
    seen = []
    for key, label in (("W", "walk in"), ("E", "interact"), ("SPACE", "jump")):
        if key == "W":
            g.walk(30, 6, tol=0.7, max_ms=4000, tag="walk into the breech")
        else:
            g.tap(key, 120)
        for i in range(8):
            g.wait(200)
            seen.append((label, g.snap()["ps"]))
        g.note("cannon board attempt with %s: states %s" % (
            label, sorted(set(x[1] for x in seen if x[0] == label))))
    g.shot("86_cannon_attempts")
    states = sorted(set(x[1] for x in seen))
    if "cannon" not in states:
        g.found("ember-3 the cannon 'shaft-gun' [30, 5.6, 6] — ROUTE C",
                "stood on the breech itself and tried all three things a player would: walked into it, pressed E (interact) and pressed Space",
                "the hero never entered the 'cannon' state; states seen were %s. The trigger volume exists (hazards/launch.js builds it with props.cannon/enter/fire) but nothing in the shipped code calls the controller's enterCannon(): `grep -rn enterCannon runtime/` returns only controller.js's own definition" % states,
                "the sign says CLIMB IN AND IT FIRES; ROUTE C (the cannon over the east wall onto the balcony at 14.8) is one of the three routes to the course's open crest",
                g.shot("86b_cannon_dead"))
    else:
        g.ok("ember-3 the cannon boards and fires (states %s)" % states)


def stage_plaza(g):
    """The coin stuck in the cp-plaza pad, and the two lava pools done properly."""
    # --- the coin in the checkpoint pad --------------------------------
    g.js("() => CRESTBOUND.game.__dev.tp(0, 1.7, 40)")
    g.wait(900)
    g.shot("90_on_the_cp_pad")
    near = g.js("""() => { const G = CRESTBOUND.game, C = G._collectibles;
        const out = { coins: [], pad: null };
        const P = G.player.pos;
        const list = C && (C._coins || C.coins) ? (C._coins || C.coins) : [];
        for (const c of list) {
          const p = c.pos || c.p || (c.position ? c.position : null);
          if (!p) continue;
          const d = Math.hypot(p.x - P.x, p.z - P.z);
          if (d < 5) out.coins.push({ p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
                                      d: +d.toFixed(2), got: !!(c.got || c.taken || c.dead) });
        }
        const T = CRESTBOUND.THREE;
        const box = new T.Box3(new T.Vector3(P.x-3, P.y-2, P.z-3), new T.Vector3(P.x+3, P.y+3, P.z+3));
        const cols = G.course.broadphase.query(box, []);
        out.pad = cols.map(c => ({ top: c.center && c.half ? +(c.center.y + c.half.y).toFixed(2) : null,
                                   c: c.center ? [+c.center.x.toFixed(2), +c.center.y.toFixed(2), +c.center.z.toFixed(2)] : null,
                                   half: c.half ? [+c.half.x.toFixed(2), +c.half.y.toFixed(2), +c.half.z.toFixed(2)] : null,
                                   surface: c.surface || null }));
        return out; }""")
    g.note("standing on the cp-plaza pad: %s" % json.dumps(near))
    c0 = g.snap()["coins"]
    for i in range(24):
        g.wait(250)
    c1 = g.snap()["coins"]
    g.shot("91_pad_coin_after_6s")
    g.note("stood on the pad 6 s: coins %s -> %s" % (c0, c1))
    still = [c for c in near["coins"] if not c["got"] and c["d"] < 1.6]
    if still and c1 == c0:
        g.found("ember-3 spawn plaza, the cp-plaza checkpoint pad at [0, 1.6, 40]",
                "teleported onto the checkpoint pad and stood on it for 6 s with a coin visibly half-buried in the pad's face",
                "the coin sat there, its lower half sunk through the pad disc, and the counter never moved (%s -> %s). Coins within 1.6 m still uncollected: %s" % (
                    c0, c1, json.dumps(still)),
                "the plaza coin trail should not intersect the checkpoint pad, and a coin at the hero's feet (magnet radius 1.3 m) should be picked up",
                g.shot("91b_pad_coin_stuck"))

    # --- the west pool: three stones and a flame vent on the middle one -
    g.js("() => CRESTBOUND.game.__dev.tp(-30, 2.2, 24.5)")
    g.wait(900)
    g.shot("92_west_pool_bank")
    d0 = g.snap()["deaths"]
    r = g.walk(-30, 27.4, tol=1.2, max_ms=9000, tag="west pool stone 1")
    s = g.snap()
    g.note("west pool stone 1: end %s ps=%s deaths %s->%s" % (s["p"], s["ps"], d0, s["deaths"]))
    g.shot("93_west_stone1")
    # stand on the FLAME stone for two full cycles (on 1.6 / off 2.6 = 4.2 s)
    g.js("() => CRESTBOUND.game.__dev.tp(-30, 1.9, 30.6)")
    g.wait(800)
    d1 = g.snap()["deaths"]
    frames = []
    for i in range(40):
        g.wait(230)
        frames.append(g.snap())
        if i in (6, 14, 22, 30):
            g.shot("94_%d_flame_cycle" % i)
    s = g.snap()
    g.note("stood still on the flame stone [-30, 30.6] for 9.2 s (2+ cycles of on 1.6/off 2.6): deaths %s -> %s, positions %s" % (
        d1, s["deaths"], [f["p"] for f in frames[::10]]))
    if s["deaths"] > d1:
        g.found("ember-3 west lava pool, the middle stepping stone [-30, 0.3, 30.6]",
                "stood still on the middle stone — the one the course puts a flame vent on top of ({kind:'flame', p:[-30,1.7,30.6]}) — for 9.2 s",
                "the vent killed me %d time(s) while I was standing still on the only footing in the pool" % (s["deaths"] - d1),
                "a hazard mounted on the one safe stone gives the player nowhere to stand; the vent should be beside the stone, or the stone should be big enough to stand clear of the jet",
                g.shot("94b_flame_kill"))
    else:
        g.ok("ember-3 the west pool flame vent does not kill a player standing on the stone it is mounted on")

    # --- the east pool: the plug stone and sigil 1 ----------------------
    g.js("() => CRESTBOUND.game.__dev.tp(32, 2.2, 21.5)")
    g.wait(900)
    g.shot("95_east_pool_rim")
    d2 = g.snap()["deaths"]
    r = g.walk(32, 24.2, tol=1.3, max_ms=9000, tag="east pool stone [32, 24.2]")
    s = g.snap()
    g.note("east pool first stone: end %s ps=%s deaths %s->%s" % (s["p"], s["ps"], d2, s["deaths"]))
    g.shot("96_east_stone1")
    if s["deaths"] > d2:
        g.found("ember-3 east lava pool, the walk from the rim onto the first stone [32, 24.2]",
                "teleported to the pool rim at [32, 21.5] and walked straight at the first stepping stone",
                "died on the way (deaths %s -> %s) — the bank drops into the lava before the stone is in jump range" % (d2, s["deaths"]),
                "the header calls the east bank a 61 deg slide surface and the pool an optional line, but the coin ring at r 11 leads a player onto it",
                g.shot("96b_east_bank_slide"))
    # sigil 1 on the plug
    g.js("() => CRESTBOUND.game.__dev.tp(32, 2.0, 27.4)")
    g.wait(800)
    s0 = g.snap()
    g.jump_to(32, 30.5, hold_ms=1700, jump_after=300, tag="sigil 1 plug stone")
    s = g.snap()
    g.shot("97_sigil1")
    g.note("sigil 1 attempt: sig %s -> %s, end %s deaths %s->%s" % (
        s0["sig"], s["sig"], s["p"], s0["deaths"], s["deaths"]))
    if s["sig"] == s0["sig"]:
        g.found("ember-3 east lava pool, sigil 1 on the basalt plug [32.0, 2.8, 30.5]",
                "stood on the neighbouring stone [32, 27.4] and ran-jumped the 3.1 m onto the plug the sigil hangs over",
                "the sigil was not collected (still %s of 8) and I ended at %s" % (s["sig"], s["p"]),
                "sigil 1 is authored 1.30 m over a stone top of 1.50 — a plain single jump should take it",
                g.shot("97b_sigil1_missed"))
    else:
        g.ok("ember-3 sigil 1 on the east pool plug collects off a single jump")


SIGNS = [
    ("STAND ON IT", [-34, 5.7, 8], 0.5, "geyser terrace, beside the pads"),
    ("CLIMB IN AND IT FIRES", [30, 7.4, 9.2], 0.0, "cannon bluff, over the breech"),
    ("it aims through the tap-holes", [30, 6.9, 9.2], 0.0, "cannon bluff, the second line"),
    ("CINDER CHASE  70s", [5, 2.6, 40], 0.0, "spawn plaza, the race pad"),
    ("THE LONG WAY IS THE DRY WAY", [-16.4, 7.6, -9.0], -1.5708, "the gantry stair foot"),
    ("RIDE THE PLATE / MIND THE BARS", [0, 15.6, -32.4], 3.1416, "the y-14 gallery"),
    ("KICK ONE WALL, THEN THE OTHER", [-11.6, 24.0, -12.0], 1.5708, "the wall-kick chimney"),
    ("THEY GO WHEN THEY GLOW", [6.6, 26.6, -25.9], -0.9, "the vanish spiral"),
    ("JUMP THE WAVE / DODGE THE CHARGE / POUND ITS BACK", [0, 37.9, -26.6], 3.1416, "the caldera deck"),
]


def stage_signs(g):
    """Can a player READ each sign from where the sign expects them to stand?"""
    import math as _m
    for i, (text, p, yaw, where) in enumerate(SIGNS):
        # the text plate faces local +Z rotated by yaw; stand 4 m along that normal
        nx, nz = _m.sin(yaw), _m.cos(yaw)
        sx, sz = p[0] + nx * 4.0, p[2] + nz * 4.0
        g.js("(q) => CRESTBOUND.game.__dev.tp(q[0], q[1], q[2])", [sx, p[1] - 0.9, sz])
        g.wait(700)
        g.js("""(q) => { const G = CRESTBOUND.game;
            const P = G.player.pos;
            const yaw = Math.atan2(-(q[0] - P.x), -(q[2] - P.z));
            G.player.__test.setFacing(yaw);
            if (G.cam) { G.cam.yaw = yaw; G.cam.pitch = 0.05; G.cam.dist = 3.4; } }""", p)
        g.wait(700)
        png = g.shot("SIGN%d_%s" % (i, text.split()[0].lower().strip(",")))
        st = g.snap()
        g.note("sign '%s' (%s): stood at %s, camera on it -> %s" % (text, where, st["p"], png))


CLIMB_JS = r"""
(cfg) => {
  const A = globalThis.CRESTBOUND, G = A.game, E = A.engine;
  const P = () => G.player, IN = () => G.input;
  if (E && E.running) E.stop();          // hand-step: game time is 1/60 s per step,
                                         // independent of how slowly this box renders
  const KEYS = ['KeyW','KeyA','KeyS','KeyD','Space','ControlLeft','KeyC','KeyF'];
  KEYS.forEach(c => IN().__test.release(c));
  IN().__test.stick(0, 0);

  const front = () => {
    const hz = (G.course && G.course.hazards) || [];
    for (const w of hz) {
      if (w && w.def && w.def.kind === 'chase') {
        const h = (w.h && typeof w.h.front === 'number') ? w.h : w;
        return (typeof h.front === 'number') ? h.front : null;
      }
    }
    return null;
  };

  const camYaw = () => (G.cam && Number.isFinite(G.cam.yaw)) ? G.cam.yaw : 0;
  const stickTo = (tx, tz, mag) => {                 // world direction -> camera space
    const p = P().pos;
    let wx = tx - p.x, wz = tz - p.z;
    const L = Math.hypot(wx, wz) || 1; wx /= L; wz /= L;
    const y = camYaw(), fx = -Math.sin(y), fz = -Math.cos(y), rx = -fz, rz = fx;
    IN().__test.stick((wx*rx + wz*rz) * mag, (wx*fx + wz*fz) * mag);
  };

  const wps = cfg.waypoints;
  let wi = cfg.startWaypoint || 0, i = 0, jumpUntil = -1, standT = 0;
  const trace = [];
  const deaths0 = G.deaths;
  const dt = 1/60;
  const maxFrames = cfg.maxFrames || 60 * 200;

  while (i < maxFrames && wi < wps.length) {
    const w = wps[wi];
    const p = P().pos;
    const d = Math.hypot(w.p[0] - p.x, w.p[2] - p.z);
    const dy = w.p[1] - p.y;

    if (w.ride) {
      IN().__test.stick(0, 0);                       // stand on the plate and let it lift
      standT++;
      if (p.y >= w.p[1] - 0.5) { wi++; standT = 0; }
    } else {
      stickTo(w.p[0], w.p[2], 1.0);
      // jump when we are close enough that the gap is the next thing, and grounded
      if (P().grounded && jumpUntil < i && d < (w.jumpAt || 4.4) && dy > 0.4) {
        IN().__test.press('Space'); jumpUntil = i + (w.hold || 20);
      }
      if (jumpUntil >= 0 && i >= jumpUntil) { IN().__test.release('Space'); jumpUntil = -1; }
      if (d < (w.tol || 1.4) && Math.abs(dy) < 1.0 && P().grounded) { wi++; }
    }

    G.update(dt);
    i++;
    if (i % 6 === 0) {
      trace.push({ i, t: +G.course.clock.toFixed(2), wi,
                   p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
                   st: P().state, front: front(), d: +d.toFixed(2) });
    }
    if (G.deaths > deaths0) break;
  }
  KEYS.forEach(c => IN().__test.release(c));
  IN().__test.stick(0, 0);
  const p = P().pos;
  return { reached: wi, of: wps.length, frames: i,
           clock: +G.course.clock.toFixed(2), front: front(),
           end: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
           died: G.deaths > deaths0, deaths: G.deaths,
           trace: trace.filter((_, k) => k % 3 === 0).slice(-90) };
}"""

ROUTE_B = [
    {"p": [0, 6.0, -9.0], "tol": 1.6},                     # walk in off cp-court
    {"p": [0, 7.6, -11.5], "jumpAt": 4.4},                 # S1
    {"p": [6.0, 9.1, -14.0], "jumpAt": 4.4},               # S2
    {"p": [8.5, 10.6, -20.0], "jumpAt": 4.4},              # S3
    {"p": [6.0, 12.1, -26.0], "jumpAt": 4.4},              # S4
    {"p": [0, 13.6, -28.5], "jumpAt": 4.4},                # S5
    {"p": [0, 14.0, -32.5], "jumpAt": 4.4, "tol": 1.8},    # gallery sill  (cp5)
    {"p": [9.5, 15.05, -12.0], "tol": 2.0, "jumpAt": 3.2}, # onto plate M1
    {"p": [9.5, 21.5, -12.0], "ride": True},               # ride it up
    {"p": [0, 22.1, -20.0], "jumpAt": 4.4, "tol": 2.0},    # mid deck
    {"p": [9.0, 23.7, -20.0], "jumpAt": 4.4},              # U1
    {"p": [6.5, 25.3, -26.0], "jumpAt": 4.4},              # U2 (vanish)
    {"p": [0, 26.9, -28.5], "jumpAt": 4.4},                # U3
    {"p": [-6.5, 28.5, -26.0], "jumpAt": 4.4},             # U4 (vanish)
    {"p": [-9.0, 30.1, -20.0], "jumpAt": 4.4},             # U5
    {"p": [-6.5, 31.7, -14.0], "jumpAt": 4.4},             # U6 (vanish)
    {"p": [0, 33.3, -11.5], "jumpAt": 4.4},                # U7
    {"p": [0, 34.9, -20.0], "jumpAt": 4.6, "tol": 2.0},    # the exit ledge
    {"p": [0, 36.0, -20.0], "jumpAt": 2.4, "tol": 2.4},    # the caldera deck
]


def stage_climb(g):
    """THE question: can Route B be climbed at the pace the lava rises?

    Hand-stepped at a fixed 1/60 s so the measurement is independent of this
    box's frame rate (HARNESS_NOTES: engine.js clamps dt, so under contention
    game time runs far behind wall time and every wall-clock cadence lies)."""
    g.js("() => CRESTBOUND.game.__dev.skipCP(3)")
    g.wait(1600)
    s = g.snap()
    f = g.chase_front()
    g.note("climb: starting at cp-court %s, clock %.2f, front %s (chase from %s to %s at %s m/s after %s s)" % (
        s["p"], s["t"], f.get("y"), f.get("from"), f.get("to"), f.get("speed"), f.get("delay")))
    g.shot("A0_climb_start")

    res = g.js(CLIMB_JS, {"waypoints": ROUTE_B, "maxFrames": 60 * 220})
    g.note("ROUTE B autopilot (hand-stepped 1/60 s): reached waypoint %d of %d in %d frames = %.1f s of course time; ended %s, front %s, died=%s" % (
        res["reached"], res["of"], res["frames"], res["frames"] / 60.0,
        res["end"], res["front"], res["died"]))
    for row in res["trace"][-30:]:
        g.say("   climb t=%5.1f wp=%2d y=%6.2f front=%s st=%s p=%s" % (
            row["t"], row["wi"], row["p"][1], row["front"], row["st"], row["p"]))
    g.js("() => { const E = CRESTBOUND.engine; if (E && !E.running && E.start) E.start(); }")
    g.wait(600)
    g.shot("A1_climb_end")

    secs = res["frames"] / 60.0
    if res["reached"] < res["of"]:
        g.found("ember-3 ROUTE B, the shaft climb from cp-court [0, 6, -6] to the caldera deck",
                "hand-stepped the game at a fixed 1/60 s and drove an autopilot that walks at the waypoint and jumps when it is within 3 m and the target is higher — a player who never hesitates and never misses a turn",
                "it got to waypoint %d of %d (%s) after %.1f s of course time and stopped there; the lava front was at %s. died=%s" % (
                    res["reached"], res["of"], res["end"], secs, res["front"], res["died"]),
                "a perfect player should be able to run the whole of ROUTE B; if the autopilot cannot pass a step, a human on a keyboard certainly cannot",
                g.shot("A1b_climb_stuck"),
                note="last trace rows are in the played narrative")
    else:
        g.ok("ember-3 ROUTE B is climbable end to end: the autopilot reached the caldera deck in %.1f s of course time with the lava front at %s m (it stops at 32.0 m at t=74.4 s)" % (secs, res["front"]))

    # And the SAME climb with the clock where a player would actually be
    g.js("() => CRESTBOUND.game.__dev.skipCP(3)")
    g.wait(1500)
    g.js("() => CRESTBOUND.game.__dev.setClock(12)")   # a realistic handover clock, measured this session
    g.wait(400)
    res2 = g.js(CLIMB_JS, {"waypoints": ROUTE_B, "maxFrames": 60 * 220})
    g.note("ROUTE B again, but started at clock 12 s (the clock a real entry hands over on this box): reached %d/%d, ended %s at clock %.1f, front %s, died=%s" % (
        res2["reached"], res2["of"], res2["end"], res2["clock"], res2["front"], res2["died"]))
    g.js("() => { const E = CRESTBOUND.engine; if (E && !E.running && E.start) E.start(); }")
    g.wait(500)
    g.shot("A2_climb_from_12s")


def stage_misc(g):
    """The death banner, the coin in the checkpoint pad, the bars and the vanish ledges."""
    # ---- 1. the death banner text -------------------------------------
    g.js("() => CRESTBOUND.game.__dev.skipCP(3)")
    g.wait(1500)
    g.js("() => CRESTBOUND.game.__dev.kill('lava')")
    seen = []
    for i in range(14):
        g.wait(140)
        seen.append(g.js("""() => {
            const els = [...document.querySelectorAll('*')].filter(e =>
                e.children.length === 0 && (e.textContent||'').trim().length > 3 &&
                /INCIN|LAVA|BURN|FELL|VOID|CRUSH|DIED|SPIK/i.test(e.textContent||''));
            return els.map(e => ({ t: (e.textContent||'').trim(), cls: e.className,
                w: Math.round(e.getBoundingClientRect().width),
                sw: e.scrollWidth, ow: e.offsetWidth,
                clipped: e.scrollWidth > e.clientWidth + 1 })); }"""))
        if i == 5:
            g.shot("B0_death_banner")
    flat = [x for row in seen for x in row]
    g.note("death banner elements seen during the death: %s" % json.dumps(flat[:8]))
    clipped = [x for x in flat if x.get("clipped")]
    if clipped:
        g.found("ember-3 (and every course) — the death banner",
                "died to the lava at cp-court and read the death overlay's own DOM while it was on screen",
                "the cause word is clipped by its box: %s (scrollWidth > clientWidth). On the frame I captured it reads 'INCINERAT' with the last letters cut off" % json.dumps(clipped[:3]),
                "the death cause should fit its panel; a truncated word is the first thing a player reads after every mistake",
                g.shot("B0b_death_banner_clipped"))
    else:
        g.note("the death banner reported no DOM clipping; the 'INCINERAT' frame may be a reveal animation mid-flight")

    # ---- 2. the coin buried in the cp-plaza pad ------------------------
    g.js("() => CRESTBOUND.game.__dev.skipCP(0)")
    g.wait(1200)
    g.js("() => CRESTBOUND.game.__dev.tp(0, 1.7, 40)")
    g.wait(900)
    g.shot("B1_cp_pad")
    probe = g.js("""() => { const G = CRESTBOUND.game, T = CRESTBOUND.THREE, P = G.player.pos;
        const out = { coinMeshes: [], padTops: [], coins: G._collectibles ? G._collectibles.counts.coins : null };
        // every mesh within 2.5 m whose name or material hints 'coin'
        G.course.group.traverse(o => {
          if (!o.isMesh && !o.isInstancedMesh) return;
          o.updateWorldMatrix(true, false);
          const wp = new T.Vector3(); o.getWorldPosition(wp);
          if (wp.distanceTo(P) < 3.0) out.coinMeshes.push({ name: o.name || o.type,
            p: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)],
            inst: !!o.isInstancedMesh, count: o.count || null });
        });
        const box = new T.Box3(new T.Vector3(P.x-2.5, P.y-2, P.z-2.5), new T.Vector3(P.x+2.5, P.y+3, P.z+2.5));
        for (const c of G.course.broadphase.query(box, [])) {
          out.padTops.push({ top: c.center && c.half ? +(c.center.y + c.half.y).toFixed(2) : null,
                             c: c.center ? [+c.center.x.toFixed(2), +c.center.y.toFixed(2), +c.center.z.toFixed(2)] : null,
                             surface: c.surface || null });
        }
        return out; }""")
    c0 = g.snap()["coins"]
    for i in range(20):
        g.wait(250)
    c1 = g.snap()["coins"]
    g.shot("B2_cp_pad_after5s")
    g.note("cp-plaza pad probe: %s ; coins %s -> %s after 5 s standing on it" % (json.dumps(probe)[:900], c0, c1))

    # ---- 3. the rotor bars: can one shove you off the mid deck? --------
    g.js("() => CRESTBOUND.game.__dev.tp(0, 22.5, -20)")
    g.wait(1200)
    d0 = g.snap()["deaths"]
    poss = []
    for i in range(45):
        g.wait(240)
        poss.append(g.snap()["p"])
        if i in (10, 25, 40):
            g.shot("B3_%d_middeck_bars" % i)
    s = g.snap()
    moved = max(math.hypot(p[0], p[2] + 20) for p in poss)
    g.note("stood still on the mid deck for 10.8 s with the y-26 bar ring overhead: deaths %s -> %s, furthest from the deck centre %.2f m, end %s" % (
        d0, s["deaths"], moved, s["p"]))
    if s["deaths"] > d0:
        g.found("ember-3 BEAT 6, the mid deck [0, 22.10, -20] under the y-26 rotor ring",
                "stood absolutely still on the middle of the mid deck for 10.8 s (the y-26 ring's period is 7 s, so it swept me twice)",
                "the rotor killed or shoved me off: deaths %s -> %s, ended %s" % (d0, s["deaths"], s["p"]),
                "the course's own comment says the bars are rideable solids with no kill 'because a 10 m bar sweeping a 24 m room at head height is already the hazard'; standing still on the deck should be safe",
                g.shot("B3b_middeck_shoved"))
    else:
        g.ok("ember-3 standing still on the mid deck under the rotor bars is safe (no kill, no shove) over 10.8 s")

    # ---- 4. the vanish ledges: do they warn before they go? ------------
    g.js("() => CRESTBOUND.game.__dev.tp(6.5, 25.8, -26.0)")
    g.wait(1200)
    d1 = g.snap()["deaths"]
    watch = []
    for i in range(40):
        g.wait(220)
        watch.append(g.js("""() => { const G = CRESTBOUND.game;
            const P = G.player;
            let v = null;
            for (const w of (G.course.hazards||[])) {
              if (w && w.def && w.def.kind === 'vanish' && Math.abs(w.def.p[0] - 6.5) < 0.1) {
                const h = w.h || w;
                v = { on: h.on !== undefined ? h.on : null, warn: h.warn01 !== undefined ? +(h.warn01||0).toFixed(2) : null,
                      solid: h.solid !== undefined ? h.solid : null };
              }
            }
            return { y: +P.pos.y.toFixed(2), st: P.state, gnd: !!P.grounded, v }; }"""))
        if i in (6, 16, 26):
            g.shot("B4_%d_vanish" % i)
    s = g.snap()
    ys = [w["y"] for w in watch]
    g.note("stood on the first vanish ledge [6.5, 25.05, -26] for 8.8 s (cycle on 3.4 / off 1.7 / warn 0.8): y range %.2f..%.2f, deaths %s -> %s, hazard states %s" % (
        min(ys), max(ys), d1, s["deaths"], json.dumps([w["v"] for w in watch[::8]])))
    if min(ys) > 24.0 and s["deaths"] == d1:
        g.found("ember-3 BEAT 8, the vanish ledge at [6.5, 25.05, -26]",
                "stood on the first vanish ledge of the upper spiral for 8.8 s — more than two full on/off cycles (on 3.4 s, off 1.7 s)",
                "the ledge never went away: my y never dropped below %.2f and I never fell. Its own sign says THEY GO WHEN THEY GLOW" % min(ys),
                "a vanish ledge on a cycle should drop the player when it goes; if it never vanishes, the whole BEAT 8 wave is decoration",
                g.shot("B4b_vanish_never"))
    else:
        g.ok("ember-3 the vanish ledges really do drop away on their cycle (y fell to %.2f while standing on one)" % min(ys))


def _climb_chunked(g, tag, chunk_frames=900, chunks=14):
    """Same autopilot, but handed to the page in short evaluates so one long
    call cannot be lost when a contended Chrome drops the tab."""
    wi, total, last = 0, 0, None
    for k in range(chunks):
        r = g.js(CLIMB_JS, {"waypoints": ROUTE_B, "maxFrames": chunk_frames, "startWaypoint": wi})
        total += r["frames"]
        last = r
        g.say("   [%s] chunk %d: wp %d -> %d, +%d frames (%.1f s), y=%.2f front=%s clock=%.1f died=%s" % (
            tag, k, wi, r["reached"], r["frames"], r["frames"] / 60.0, r["end"][1], r["front"],
            r["clock"], r["died"]))
        wi = r["reached"]
        if r["died"] or wi >= len(ROUTE_B):
            break
        if r["frames"] < chunk_frames * 0.2 and k > 1:
            break
    last["reached"] = wi
    last["frames"] = total
    return last


def stage_climb2(g):
    """The Route B climb, chunked (crash-resilient) — the same measurement."""
    g.js("() => CRESTBOUND.game.__dev.skipCP(3)")
    g.wait(1600)
    f = g.chase_front()
    s = g.snap()
    g.note("climb2: cp-court %s clock %.2f front %s (chase %s -> %s at %s m/s after %s s)" % (
        s["p"], s["t"], f.get("y"), f.get("from"), f.get("to"), f.get("speed"), f.get("delay")))
    g.shot("C0_climb2_start")
    res = _climb_chunked(g, "routeB")
    g.js("() => { const E = CRESTBOUND.engine; if (E && !E.running && E.start) E.start(); }")
    g.wait(600)
    g.shot("C1_climb2_end")
    secs = res["frames"] / 60.0
    g.note("ROUTE B autopilot (hand-stepped 1/60 s, chunked): reached waypoint %d of %d, %d frames = %.1f s of course time, ended %s, clock %.1f, lava front %s, died=%s" % (
        res["reached"], res["of"], res["frames"], secs, res["end"], res["clock"], res["front"], res["died"]))
    if res["reached"] < res["of"]:
        g.found("ember-3 ROUTE B — the shaft climb from cp-court [0, 6, -6] to the caldera deck",
                "hand-stepped the game at a fixed 1/60 s (so the measurement does not depend on this box's frame rate) and drove an autopilot that runs straight at each ledge and jumps when it is within 3 m of it and the ledge is higher — a player who never hesitates",
                "it stalled at waypoint %d of %d, at %s, after %.1f s of course time; the lava front was at %s m and the clock read %.1f" % (
                    res["reached"], res["of"], res["end"], secs, res["front"], res["clock"]),
                "the fast line up the shaft has to be runnable; the lava reaches the mid deck at t=61.9 s and stops at 32.0 m at t=74.4 s",
                g.shot("C1b_climb2_stalled"))
    else:
        g.ok("ember-3 ROUTE B climbs end to end: a perfect run reaches the caldera deck in %.1f s of course time (the front takes the mid deck at t=61.9 s and stops at 32.0 m at t=74.4 s), ending %s with the front at %s m" % (
            secs, res["end"], res["front"]))


def stage_probe2(g):
    """What kills a player standing still on the mid deck, and the pad coin."""
    # ---- the mid deck ---------------------------------------------------
    g.js("() => CRESTBOUND.game.__dev.skipCP(4)")
    g.wait(1500)
    g.js("() => CRESTBOUND.game.__dev.tp(0, 22.5, -20)")
    g.wait(1000)
    g.shot("D0_middeck")
    d0 = g.snap()["deaths"]
    log = []
    for i in range(50):
        g.wait(200)
        row = g.js("""() => { const G = CRESTBOUND.game, P = G.player;
            const near = [];
            for (const c of (G.course.critters||[])) {
              const m = c.mesh || c.root || (c.h && c.h.mesh);
              if (!m) continue;
              const d = m.position.distanceTo(P.pos);
              if (d < 9) near.push({ k: (c.def && c.def.kind) || c.kind || '?',
                  d: +d.toFixed(2), p: [+m.position.x.toFixed(1), +m.position.y.toFixed(1), +m.position.z.toFixed(1)] });
            }
            return { p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
                     st: P.state, dead: !!P.dead, deaths: G.deaths,
                     cause: G.lastDeathCause || (G.lastDeathTimeline && G.lastDeathTimeline.cause) || null,
                     near }; }""")
        log.append(row)
        if row["deaths"] > d0:
            g.shot("D1_middeck_death")
            break
    last = log[-1]
    before = log[max(0, len(log) - 5)]
    g.note("mid deck, standing still: deaths %s -> %s after %.1f s. Cause reported: %s. Last frames: %s" % (
        d0, last["deaths"], len(log) * 0.2, last.get("cause"),
        json.dumps(log[-5:])[:900]))
    if last["deaths"] > d0:
        g.found("ember-3 BEAT 6, the mid deck [0, 22.10, -20] — the course's own 'breather before the vanish spiral'",
                "teleported onto the middle of the mid deck and stood perfectly still, touching nothing, with the chase clock still under 15 s (the lava front does not leave 4.50 m until t=40 s)",
                "I was killed after %.1f s without moving. Death cause reported: %s. What was within 9 m in the frames before: %s" % (
                    len(log) * 0.2, last.get("cause"),
                    json.dumps([r["near"] for r in log[-4:]])[:500]),
                "the one wide platform in the shaft, the place the course puts a six-coin ring and calls the breather, must not kill a player who is standing on it doing nothing",
                g.shot("D1b_middeck_death"))
    else:
        g.ok("ember-3 standing still on the mid deck for %.1f s is safe" % (len(log) * 0.2))

    # ---- the coin in the cp-plaza pad, read off the collectibles --------
    g.js("() => CRESTBOUND.game.__dev.skipCP(0)")
    g.wait(1400)
    g.js("() => CRESTBOUND.game.__dev.tp(0, 1.7, 40)")
    g.wait(1000)
    g.shot("D2_pad")
    info = g.js("""() => { const G = CRESTBOUND.game, C = G._collectibles, P = G.player.pos;
        const out = { keys: C ? Object.keys(C).slice(0, 40) : null, near: [], counts: C ? C.counts : null };
        const pools = [];
        for (const k of Object.keys(C || {})) {
          const v = C[k];
          if (Array.isArray(v) && v.length && v[0] && (v[0].pos || v[0].p)) pools.push([k, v]);
        }
        for (const [k, arr] of pools) {
          for (const it of arr) {
            const p = it.pos || it.p;
            const x = p.x !== undefined ? p.x : p[0], y = p.y !== undefined ? p.y : p[1], z = p.z !== undefined ? p.z : p[2];
            const d = Math.hypot(x - P.x, z - P.z);
            if (d < 3.5) out.near.push({ pool: k, p: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)],
                d: +d.toFixed(2), got: !!(it.got || it.taken || it.collected || it.dead) });
          }
        }
        return out; }""")
    c0 = g.snap()["coins"]
    for i in range(16):
        g.wait(250)
    c1 = g.snap()["coins"]
    g.shot("D3_pad_after4s")
    g.note("cp-plaza pad: collectibles near the pad %s ; coins %s -> %s after 4 s standing on it" % (
        json.dumps(info)[:800], c0, c1))
    uncollected = [x for x in info.get("near", []) if not x["got"] and x["d"] < 1.5]
    if uncollected and c1 == c0:
        g.found("ember-3 spawn plaza, the cp-plaza checkpoint pad [0, 1.6, 40]",
                "stood on the checkpoint pad, where a coin from the plaza trail is visibly half-sunk through the pad disc, and waited 4 s",
                "the coin is inside the pad and was not collected: %s ; the counter stayed at %s. The same coin is visible buried in the pad in four separate frames across three runs" % (
                    json.dumps(uncollected), c1),
                "a coin should not intersect the checkpoint pad, and a coin at the hero's feet (1.3 m magnet) should be picked up",
                g.shot("D3b_pad_coin"))
    else:
        g.note("no uncollected collectible was reported within 1.5 m of the pad centre; the buried coin in the screenshots is still a visual intersection")

    # ---- the death banner, frame by frame ------------------------------
    g.js("() => CRESTBOUND.game.__dev.kill('lava')")
    texts = []
    for i in range(16):
        g.wait(120)
        texts.append(g.js("""() => { const out = [];
            for (const e of document.querySelectorAll('div,span,h1,h2,p')) {
              if (e.children.length) continue;
              const t = (e.textContent||'').trim();
              if (!t || t.length > 40) continue;
              const r = e.getBoundingClientRect();
              if (r.width < 40 || r.height < 10) continue;
              const cs = getComputedStyle(e);
              if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
              if (/^[A-Z ]{4,}$/.test(t)) out.push({ t, w: Math.round(r.width),
                  sw: e.scrollWidth, cw: e.clientWidth, of: cs.overflow, cls: e.className });
            }
            return out; }"""))
        if i == 4:
            g.shot("D4_death_text")
    seen = sorted({x["t"] for row in texts for x in row})
    g.note("death overlay: the all-caps strings visible frame by frame were %s ; full rows %s" % (
        json.dumps(seen), json.dumps(texts[3:8])[:600]))


def stage_deck(g):
    """WHAT kills a player standing still on the mid deck? Name it."""
    g.js("() => CRESTBOUND.game.__dev.skipCP(4)")
    g.wait(1500)
    kv = g.js("""() => { const G = CRESTBOUND.game, T = CRESTBOUND.THREE;
        const P = new T.Vector3(0, 22.6, -20);
        const out = { kills: [], vols: [], hazards: [] };
        for (const k of (G.course.killVolumes || [])) {
          const c = k.center || k.pos, h = k.half;
          const d = c ? Math.hypot(c.x - P.x, c.y - P.y, c.z - P.z) : null;
          out.kills.push({ kind: k.kind, active: k.active !== false,
            c: c ? [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)] : null,
            half: h ? [+h.x.toFixed(2), +h.y.toFixed(2), +h.z.toFixed(2)] : null,
            contains: (c && h) ? (Math.abs(P.x-c.x) <= h.x && Math.abs(P.y-c.y) <= h.y && Math.abs(P.z-c.z) <= h.z) : null,
            d: d === null ? null : +d.toFixed(2) });
        }
        for (const w of (G.course.hazards || [])) {
          const kills = (w.kills || (w.h && w.h.kills) || []);
          for (const k of kills) {
            const c = k.center || k.pos, h = k.half;
            if (!c || !h) continue;
            const inside = Math.abs(P.x-c.x) <= h.x && Math.abs(P.y-c.y) <= h.y && Math.abs(P.z-c.z) <= h.z;
            if (inside || Math.hypot(c.x-P.x, c.y-P.y, c.z-P.z) < 14) {
              out.hazards.push({ hz: w.def ? w.def.kind : '?', kind: k.kind, inside,
                c: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
                half: [+h.x.toFixed(2), +h.y.toFixed(2), +h.z.toFixed(2)],
                active: k.active !== false });
            }
          }
        }
        return out; }""")
    g.note("kill volumes at the mid-deck stand point [0, 22.6, -20]: %s" % json.dumps(kv)[:1400])

    g.js("() => CRESTBOUND.game.__dev.tp(0, 22.5, -20)")
    g.wait(900)
    g.shot("E0_middeck")
    d0 = g.snap()["deaths"]
    cause = None
    frames = []
    for i in range(40):
        g.wait(150)
        r = g.js("""() => { const G = CRESTBOUND.game, P = G.player;
            const crit = [];
            for (const c of (G.course.critters || [])) {
              const o = c.mesh || c.group || c.root || (c.h && (c.h.mesh || c.h.group));
              const pos = o && o.position ? o.position : (c.pos || null);
              if (!pos) continue;
              const d = Math.hypot(pos.x - P.pos.x, pos.y - P.pos.y, pos.z - P.pos.z);
              if (d < 12) crit.push({ k: (c.def && c.def.kind) || c.kind || '?', d: +d.toFixed(2),
                  p: [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)] });
            }
            return { p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
                     st: P.state, deaths: G.deaths, cause: G._deathCause || null,
                     t: +G.course.clock.toFixed(2), crit }; }""")
        frames.append(r)
        if r["deaths"] > d0:
            cause = r["cause"]
            g.shot("E1_middeck_death")
            break
    g.note("mid deck stand test: deaths %s -> %s after %.1f s; DEATH CAUSE = %s; frames %s" % (
        d0, frames[-1]["deaths"], len(frames) * 0.15, cause, json.dumps(frames[-4:])[:800]))
    if frames[-1]["deaths"] > d0:
        g.found("ember-3 BEAT 6, the mid deck [0, 22.10, -20] — the course's 'breather before the vanish spiral'",
                "stood perfectly still in the middle of the mid deck (the 13 x 10 m platform with the six-coin ring on it) and pressed nothing, with the chase clock at %.1f s — the lava front does not leave 4.50 m until t = 40 s" % frames[0]["t"],
                "dead in %.1f s. The game reports the cause as '%s'. Nothing was near: critters within 12 m in the last frames = %s. Reproduced three times in three separate runs (deaths 0->1, 1->2, 0->1)" % (
                    len(frames) * 0.15, cause, json.dumps([f["crit"] for f in frames[-3:]])),
                "the one wide, flat platform in the shaft — where the course puts its coin ring and calls the breather — must not kill a player who is standing on it doing nothing",
                g.shot("E1b_middeck_death"),
                note="kill-volume dump for this exact spot is in the played narrative above")
    else:
        g.ok("ember-3 standing still on the mid deck for %.1f s was safe this time" % (len(frames) * 0.15))


STAGES = {"smoke": stage_smoke, "rim": stage_rim, "court": stage_court, "clock": stage_clock,
          "stuck": stage_stuck, "plaza": stage_plaza, "signs": stage_signs, "climb": stage_climb,
          "climb2": stage_climb2, "misc": stage_misc, "probe2": stage_probe2, "deck": stage_deck,
          "shaft": stage_shaft, "chase": stage_chase, "caldera": stage_caldera}

if __name__ == "__main__":
    sys.exit(main())
