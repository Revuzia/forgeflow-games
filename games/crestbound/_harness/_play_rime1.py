"""PLAYTEST — rime-1 FROST COTTAGE (owner instruction P11: agents must PLAY).

Drives the shipped page with REAL KeyboardEvents, walks the course beat by
beat, screenshots every event, and appends every confirmed defect to
_playreports/rime-1.json the MOMENT it is confirmed (a usage limit must not
take the findings with it).

  python _harness/_play_rime1.py --beats 1,2
"""
import argparse, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _playlib import Play                                    # noqa: E402

REPORT = os.path.join(HERE, "_playreports", "rime-1.json")
os.makedirs(os.path.dirname(REPORT), exist_ok=True)


def load_report():
    if os.path.exists(REPORT):
        try:
            with open(REPORT, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"area": "rime-1", "defects": [], "worked": [], "blocked": []}


def save_report(r):
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(r, f, indent=1)


class R1(Play):
    def __init__(self, *a, **k):
        Play.__init__(self, *a, **k)
        self.rep = load_report()

    def flush(self):
        save_report(self.rep)

    def bug(self, where, did, happened, should, png, note=""):
        d = {"where": where, "did": did, "happened": happened, "should": should, "png": png}
        if note:
            d["note"] = note
        # de-dupe by (where, did)
        for x in self.rep["defects"]:
            if x.get("where") == where and x.get("did") == did:
                x.update(d)
                break
        else:
            self.rep["defects"].append(d)
        self.flush()
        self.say("  ** DEFECT: %s | %s -> %s" % (where, did, happened))
        return d

    def ok(self, s):
        if s not in self.rep["worked"]:
            self.rep["worked"].append(s)
            self.flush()
        self.say("  ok: " + s)

    def blocked(self, s):
        if s not in self.rep["blocked"]:
            self.rep["blocked"].append(s)
            self.flush()
        self.say("  BLOCKED: " + s)

    # ------------------------------------------------------------------ HUD
    def snap(self):
        return self.js("() => { const s = CRESTBOUND.game.__dev.state(); return {"
                       "coins:s.coins, coinsTotal:s.coinsTotal, sigils:s.sigils, crests:s.crests,"
                       "crestsTotal:s.crestsTotal, cpIndex:s.cpIndex, deaths:s.deaths,"
                       "state:s.state, speed:+(s.speed||0).toFixed(2), power: s.power?s.power.id:null }; }")

    def both(self):
        st = self.state(); sn = self.snap()
        st.update(sn)
        return st

    def enter_course(self, cid="rime-1", cp=None):
        self.click_title()
        self.wait(900)
        self.js("() => CRESTBOUND.game.__dev.unlockAll()")
        self.wait(300)
        if cp is None:
            self.js("(c) => CRESTBOUND.game.__dev.goto(c)", cid)
        else:
            self.js("([c,i]) => CRESTBOUND.game.__dev.goto(c,i)", [cid, cp])
        for _ in range(80):
            self.wait(300)
            s = self.state()
            if s["course"] == cid and s["gstate"] in ("playing", "cinematic"):
                break
        self.wait(1400)
        # skip any intro cinematic
        for _ in range(30):
            if self.state()["gstate"] != "cinematic":
                break
            self.tap("SPACE"); self.wait(300)
        self.wait(600)
        return self.both()


# =====================================================================  BEATS
def beat1(p):
    """THE FROZEN LAKE — spawn, the sign, cp1, ice drift, the plug, the dive."""
    p.say("\n===== BEAT 1 — THE FROZEN LAKE =====")
    s = p.enter_course("rime-1")
    p.say("  entered:", s)
    a = p.shot("b1_spawn")
    p.say("  spawn shot", a)
    if s["course"] != "rime-1":
        p.blocked("could not load rime-1 (state %s)" % s)
        return

    # --- the spawn sign: can a player READ it from where he stands? ---------
    p.face(5.2, 57.0)
    p.wait(400)
    p.shot("b1_sign_from_spawn")
    # walk right up to it
    p.walk_to(4.0, 57.6, tol=1.4, max_ms=6000, stop_on_card=False, tag="up to the sign")
    p.face(5.2, 57.0); p.wait(400)
    p.shot("b1_sign_close")

    # --- cp1 (cp-shore at z 58.5) ------------------------------------------
    before = p.snap()["cpIndex"]
    p.walk_to(0, 58.5, tol=1.0, max_ms=8000, stop_on_card=False, tag="cp-shore")
    p.wait(600)
    after = p.snap()["cpIndex"]
    p.say("  cpIndex %s -> %s" % (before, after))
    p.shot("b1_cp_shore")

    # --- the ICE: run onto it and let go. Does it drift? --------------------
    p.face(0, 40)
    p.down("W")
    p.wait(1500)
    at_release = p.both()
    p.up("W")
    slide = []
    for _ in range(14):
        p.wait(160)
        slide.append(p.both())
    p.shot("b1_ice_drift")
    rel = at_release["pos"]; end = slide[-1]["pos"]
    dist = ((end[0] - rel[0]) ** 2 + (end[2] - rel[2]) ** 2) ** 0.5
    spd0 = (at_release["vel"][0] ** 2 + at_release["vel"][2] ** 2) ** 0.5
    p.say("  ICE: released at %s surface=%s speed=%.2f -> coasted %.2f m over %.1f s, final speed %.2f"
          % (rel, at_release["surface"], spd0, dist, 14 * 0.16,
             (slide[-1]["vel"][0] ** 2 + slide[-1]["vel"][2] ** 2) ** 0.5))
    p.say("  ICE surfaces seen:", sorted(set(str(x["surface"]) for x in slide)))
    return {"ice_dist": dist, "ice_spd0": spd0, "slide": slide, "cp": (before, after)}


def beat1b(p):
    """The hole: walk to it, pound the plug, dive to sigil 1, get back out."""
    p.say("\n===== BEAT 1b — THE HOLE, THE DIVE, THE WAY OUT =====")
    # get near the hole (5, 42) but stop short so we can walk the last stretch
    p.tp(5.0, 2.0, 48.0)
    p.wait(600)
    p.face(5, 42)
    p.shot("b1b_hole_approach")
    w = p.walk_to(5.0, 44.5, tol=1.2, max_ms=8000, stop_on_card=False, tag="edge of the plug")
    p.wait(400)
    st = p.both()
    p.say("  standing on the plug?", st)
    p.shot("b1b_on_plug")

    # POUND it: jump, then crouch in the air
    p.tap("SPACE", 140)
    p.wait(260)
    air = p.state()
    p.say("  airborne before pound:", air["pstate"], air["pos"])
    p.down("C")
    p.wait(900)
    p.up("C")
    p.wait(900)
    st2 = p.both()
    p.say("  after pound:", st2)
    png = p.shot("b1b_after_pound")
    return {"after_pound": st2, "png": png}



from _play_rime1_beats import (beat1c, beat1d, beat2, beat3, beat4, beat5,
                               beat6, beat7, beat8, beat9)   # noqa: E402

BEATS = {"1": beat1, "1b": beat1b, "1c": beat1c, "1d": beat1d, "2": beat2,
         "3": beat3, "4": beat4, "5": beat5, "6": beat6, "7": beat7,
         "8": beat8, "9": beat9}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--beats", default="1")
    a = ap.parse_args()
    order = [b.strip() for b in a.beats.split(",") if b.strip() in BEATS]
    with R1("rime1") as p:
        if order and order[0] != "1":
            p.enter_course("rime-1")
        for b in order:
            try:
                BEATS[b](p)
            except Exception as e:
                p.say("  !! beat %s raised %r" % (b, e))
                import traceback
                traceback.print_exc()
        p.say("\nconsole:", p.console[:24])
        p.flush()
