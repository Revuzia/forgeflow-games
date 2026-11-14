"""PLAYTEST — ember-1 MAGMA WORKS. Owner instruction P11: go out and PLAY.

Segments so a usage limit cannot kill the whole run:
  python _harness/_play_e1.py --seg 1   shore + quay + flame catwalk
  python _harness/_play_e1.py --seg 2   junction, metal hat, raft field
  python _harness/_play_e1.py --seg 3   smelter: belt, crusher, jump pad, breakables
  python _harness/_play_e1.py --seg 4   east gantry route B + pulse beams
  python _harness/_play_e1.py --seg 5   crucible base yard, flue wall-kick, east flight
  python _harness/_play_e1.py --seg 6   the pour, west flight, crane gantry crest
  python _harness/_play_e1.py --seg 7   bucket orbit, rim, warden pit, lava walk / islet
Every segment writes _harness/_playreports/ember-1.json additively.
"""
import argparse, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "_playreports", "ember-1.json")
os.makedirs(os.path.dirname(REPORT), exist_ok=True)


def load_report():
    if os.path.exists(REPORT):
        try:
            with open(REPORT, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"area": "ember-1", "defects": [], "worked": [], "blocked": [], "played": []}


def save_report(r):
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(r, f, indent=1)


class E1(Play):
    def __init__(self, seg):
        Play.__init__(self, "ember-1")
        self.seg = str(seg)
        self.rep = load_report()
        try:
            base = int("".join(c for c in self.seg if c.isdigit()) or "0")
        except ValueError:
            base = 0
        self.n = 100 * base + (50 if self.seg.endswith("b") else 0)

    # ---- persistence: every confirmed finding hits disk immediately
    def bug(self, where, did, happened, should, png, note=""):
        d = {"where": where, "did": did, "happened": happened, "should": should,
             "png": png, "seg": self.seg}
        if note:
            d["note"] = note
        self.rep["defects"].append(d)
        save_report(self.rep)
        self.say("  ** DEFECT %s | %s -> %s" % (where, did, happened))
        return d

    def ok(self, what):
        self.rep["worked"].append(what)
        save_report(self.rep)
        self.say("  OK: " + what)

    def blocked(self, what):
        self.rep["blocked"].append(what)
        save_report(self.rep)
        self.say("  BLOCKED: " + what)

    def note(self, line):
        self.rep.setdefault("played", []).append(line)
        save_report(self.rep)
        self.say("  . " + line)

    # ---- entry
    def wait_boot(self, secs=300):
        """The box is shared with other lanes; _playlib's 80 s is not enough."""
        t0 = time.time()
        while time.time() - t0 < secs:
            try:
                ok = self.pg.evaluate(
                    "() => (typeof CRESTBOUND !== 'undefined') && !!CRESTBOUND.game "
                    "&& !!CRESTBOUND.game.course && !!CRESTBOUND.game.player")
            except Exception as e:
                ok = False
                self.say("  boot poll error:", str(e)[:120])
            if ok:
                self.say("booted after %.1f s" % (time.time() - t0))
                self.wait(1200)
                return True
            self.pg.wait_for_timeout(1000)
        self.say("BOOT TIMEOUT after %d s; console:" % secs, self.console[:8])
        return False

    def enter(self, cp=None):
        if not self.wait_boot():
            raise RuntimeError("game never booted")
        st = self.state()
        self.say("boot state", st["gstate"], st["course"])
        if st["gstate"] == "title":
            got = self.click_title()
            self.say("title button:", got)
            self.wait(1200)
        self.unlock_all()
        self.js("() => CRESTBOUND.game.__dev.goto('ember-1'%s)"
                % ("" if cp is None else (", %d" % cp)))
        for _ in range(80):
            self.wait(400)
            s = self.state()
            if s["course"] == "ember-1" and s["gstate"] == "playing":
                break
        self.wait(1200)
        s = self.state()
        self.say("in course:", s["course"], s["gstate"], s["pos"])
        return s

    def go(self, x, z, tol=1.2, max_ms=9000, keys=("W",), tag=""):
        """walk_to, but WITHOUT _playlib's stop_on_card break — inside a course
        `gstate` is always 'playing', so stop_on_card=True aborts the walk on the
        first 220 ms sample and every walk reports DID NOT ARRIVE."""
        return self.walk_to(x, z, tol=tol, max_ms=max_ms, keys=keys,
                            stop_on_card=False, tag=tag)

    def clock(self):
        return self.js("() => CRESTBOUND.game.course ? +CRESTBOUND.game.course.clock.toFixed(2) : null")

    def setclock(self, t):
        return self.js("(t) => CRESTBOUND.game.__dev.setClock(t)", t)

    def snap(self):
        return self.js("""() => { const G=CRESTBOUND.game, P=G.player, c=G._collectibles;
          const s = G.__dev.state();
          return {st:G.state, t:+(G.course?G.course.clock:0).toFixed(2),
            p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
            v:[+P.vel.x.toFixed(2),+P.vel.y.toFixed(2),+P.vel.z.toFixed(2)],
            ps:P.state, gnd:!!P.grounded, surf:P.surface, jc:P.jumpCount,
            coins:c&&c.counts?c.counts.coins:null, sig:c&&c.counts?c.counts.sigils:null,
            crests:s.crests, deaths:G.deaths, cp:s.cpIndex,
            power:s.power||null,
            cam:G.cam?[+G.cam.yaw.toFixed(2),+G.cam.pitch.toFixed(2),+G.cam.dist.toFixed(2),G.cam.mode]:null};}""")


# ===========================================================================
def seg1(g):
    """BEAT 1-2: obsidian shore, the sign, coin trail, quay, flame catwalk."""
    g.enter()
    g.note("SEG1 spawn on the obsidian shore, yard flat")
    g.shot("spawn")

    # --- read the spawn sign a player would read from where he stands
    s = g.snap(); g.say("spawn snap", s)
    g.face(4.4, 38.5)
    g.wait(400)
    p1 = g.shot("spawn_sign_from_spawn")
    g.go(4.4, 41.0, tol=1.6, max_ms=7000, tag="toward the MAGMA WORKS sign")
    g.face(4.4, 38.5); g.wait(500)
    p2 = g.shot("sign_close")
    g.say("sign read pos", g.pos())

    # --- the coin trail out of the yard to the quay
    c0 = g.snap()["coins"]
    for (x, z) in [(0, 45), (-1, 38), (1, 30), (0, 23)]:
        g.go(x, z, tol=1.8, max_ms=9000, tag="coin trail")
    c1 = g.snap()["coins"]
    g.note("coin trail yard->quay collected %d coins (%d -> %d)" % (c1 - c0, c0, c1))
    g.shot("coin_trail_end")

    # --- the arc over the shore swell (the first jump the course asks for)
    g.go(-19, 40, tol=2.0, max_ms=9000, tag="shore swell arc start")
    g.face(-13, 40)
    g.down("W"); g.wait(500); g.tap("SPACE", 120); g.wait(700); g.up("W")
    g.wait(500)
    g.note("swell arc jump -> coins %d" % g.snap()["coins"])
    g.shot("swell_arc")

    # --- to the quay head / cp2
    g.go(0, 24, tol=2.0, max_ms=12000, tag="back to the track")
    before = g.snap()
    g.go(0, 15.5, tol=1.6, max_ms=12000, tag="quay head + cp2")
    after = g.snap()
    g.say("cp before/after", before["cp"], after["cp"], "pos", after["p"])
    g.shot("quay_head")

    # --- the quay sigil pedestal and the race sign
    g.face(-6, 16); g.wait(400); g.shot("quay_pedestal")
    g.face(3.4, 17); g.wait(400); g.shot("race_sign")

    # --- FLAME CATWALK. Force each phase of the cycle and look at it.
    # vents at z 8 / 2 / -4, cycle on1.4 off2.6 warn0.7, phases 0 / 1.35 / 2.70
    g.tp(0, 3.2, 12.0); g.wait(600)
    g.face(0, -6)
    for t, tag in [(0.2, "vent1_ON"), (1.6, "vent1_off_vent2_warnish"),
                   (2.9, "vent3_ON"), (3.6, "all_off")]:
        g.setclock(t); g.wait(500)
        g.shot("catwalk_t%.1f_%s" % (t, tag))
    g.note("flame vent phases photographed from the catwalk mouth")

    # close-up of a firing vent from a player's standing distance
    g.tp(0, 3.2, 10.6); g.wait(400)
    g.face(0, 8.0)
    g.setclock(0.4); g.wait(400)
    g.shot("vent1_closeup_ON")
    g.setclock(2.2); g.wait(400)
    g.shot("vent1_closeup_OFF")

    # --- does walking into a firing vent kill fairly?
    d0 = g.snap()["deaths"]
    g.tp(0, 3.2, 11.5); g.wait(400)
    g.setclock(0.0); g.wait(200)
    g.face(0, -6)
    g.down("W")
    hit = None
    for i in range(28):
        g.wait(160)
        s = g.snap()
        if s["deaths"] > d0:
            hit = s
            break
    g.up("W"); g.wait(900)
    g.say("vent kill test:", "DIED at" if hit else "SURVIVED walk through vents", hit)
    g.shot("vent_walkthrough_result")
    g.note("walked the catwalk straight through the vent line, deaths %d -> %d"
           % (d0, g.snap()["deaths"]))

    g.dump("e1_seg1")
