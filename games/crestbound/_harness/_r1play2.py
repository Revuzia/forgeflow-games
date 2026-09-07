"""rime-1 PLAYTEST pass 2 — the rest of the course, hand-stepped.

Everything is written to _harness/_r1play2.txt as it happens so a killed run
still leaves what it learned on disk.
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from _r1step import Step, brief

OUT = os.path.join(HERE, "_r1play2.txt")
_lines = []


class Step2(Step):
    def say(self, *a):
        line = " ".join(str(x) for x in a)
        print(line, flush=True)
        _lines.append(line)
        with open(OUT, "w", encoding="utf-8") as f:
            f.write("\n".join(_lines))

    def face_to(self, x, z):
        """Aim hero + camera at a world XZ point."""
        return self.js("""([tx,tz]) => { const G = CRESTBOUND.game, P = G.player;
            const yaw = Math.atan2(-(tx - P.pos.x), -(tz - P.pos.z));
            P.__test.setFacing(yaw); if (G.cam) { G.cam.yaw = yaw; G.cam._rcHoldT = 0; }
            return +yaw.toFixed(3); }""", [x, z])

    def walk(self, x, z, frames=300, tag="", reface=20):
        """Hold full stick toward an XZ target, re-aiming every `reface` frames."""
        self.face_to(x, z)
        self.stick(0, 1)
        out = []
        done = 0
        while done < frames:
            n = min(reface, frames - done)
            out += self.run(n, max(1, n // 3))
            done += n
            cur = out[-1]
            d = ((cur["p"][0] - x) ** 2 + (cur["p"][2] - z) ** 2) ** 0.5
            if d < 0.9:
                break
            self.face_to(x, z)
        self.stick(0, 0)
        self.run(6, 6)
        cur = self.js("() => __R1.s()")
        d = ((cur["p"][0] - x) ** 2 + (cur["p"][2] - z) ** 2) ** 0.5
        self.say("  walk -> (%.1f, %.1f)%s : ended %s %s d=%.2f%s"
                 % (x, z, (" " + tag) if tag else "", cur["p"], cur["st"], d,
                    "  *** DID NOT ARRIVE" if d > 1.6 else ""))
        return cur, out

    def hop(self, x, z, hold=10, air=45, tag=""):
        """Run at an XZ target and jump — the ordinary platforming input."""
        self.face_to(x, z)
        self.stick(0, 1)
        self.run(16, 8)
        self.press("Space")
        a = self.run(hold, 4)
        self.release("Space")
        b = self.run(air, 6)
        self.stick(0, 0)
        c = self.run(12, 6)
        cur = self.js("() => __R1.s()")
        d = ((cur["p"][0] - x) ** 2 + (cur["p"][2] - z) ** 2) ** 0.5
        self.say("  hop -> (%.1f, %.1f) %s : %s %s g=%d d=%.2f" % (x, z, tag, cur["p"], cur["st"], cur["g"], d))
        return cur, a + b + c


def sc_roofs(p):
    p.say("\n### BEAT 3 — THE VILLAGE ROOF LINE (snow blocks -> lean-to -> four caps) ###")
    p.place(-14.6, 5.10, 9.4, 0.0)
    p.run(20, 10)
    p.say("  square, at the foot of the roof stair:", json.dumps(p.js("() => __R1.s()")))
    p.shotnow("r2_roofstair_foot")
    for (x, z, want, tag) in [(-14.6, 11.8, 5.90, "snow block 1"), (-14.6, 13.6, 7.40, "snow block 2"),
                              (-13.4, 15.6, 8.90, "lean-to"), (-9.0, 16.0, 10.25, "CAP 1")]:
        cur, _ = p.hop(x, z, tag=tag + " (top %.2f)" % want)
        if abs(cur["p"][1] - want) > 0.4:
            p.say("    ^^ did NOT land on %s (y %.2f, wanted %.2f)" % (tag, cur["p"][1], want))
    p.shotnow("r2_cap1")
    for (x, z, tag) in [(-1.5, 18.0, "CAP 2"), (6.0, 16.0, "CAP 3 (across the bells)"), (13.0, 12.0, "CAP 4 + sigil 2")]:
        cur, _ = p.hop(x, z, tag=tag)
        p.say("    collectibles:", json.dumps(p.snapc()))
    p.shotnow("r2_cap4")


def sc_bells(p):
    p.say("\n### BEAT 3 — THE TWO SWINGING BELLS between caps 2 and 3, sigil 4 at (2.2, 11.90, 16.5) ###")
    p.place(-1.5, 10.75, 18.0, 0.0)
    p.run(20, 10)
    p.say("  on cap 2:", json.dumps(p.js("() => __R1.s()")))
    p.say("  bells:", json.dumps(p.js(
        "() => (CRESTBOUND.game.course.hazards||[]).filter(h => (h.kind||(h.def&&h.def.kind))==='pendulum')"
        ".map(h => h.mesh ? [+h.mesh.position.x.toFixed(2), +h.mesh.position.y.toFixed(2), +h.mesh.position.z.toFixed(2)] : null)")))
    p.shotnow("r2_bells")
    d0 = p.snapc()
    cur, s = p.hop(2.2, 16.5, tag="into the bell gap for sigil 4", air=70)
    p.say("  states through the gap:", sorted(set(x["st"] for x in s)))
    p.say("  before %s after %s" % (json.dumps(d0), json.dumps(p.snapc())))
    p.shotnow("r2_bells_after")


def sc_pine(p):
    p.say("\n### BEAT 3 — THE OLD PINE at (-16, 20): 'PRESS INTO THE TRUNK TO CLIMB' ###")
    p.place(-16.0, 5.20, 23.4, 0.0)
    p.run(20, 10)
    p.say("  at the pine:", json.dumps(p.js("() => __R1.s()")))
    p.shotnow("r2_pine_foot")
    p.face_to(-16, 20)
    p.stick(0, 1)
    s = p.run(400, 25)
    p.stick(0, 0)
    p.say("  climb:", brief(s))
    p.say("  states:", sorted(set(x["st"] for x in s)))
    p.say("  highest y: %.2f (crow's nest top is gy(-16,20)+8.8 ~ 6.0+8.8)" % max(x["p"][1] for x in s))
    p.say("  collectibles:", json.dumps(p.snapc()))
    p.shotnow("r2_pine_top")


def sc_gnasher(p):
    p.say("\n### BEAT 4 — THE GNASHER at the barn door (post -19, 8.6; chain 5.5) ###")
    p.place(-14.0, 5.30, 6.0, 0.0)
    p.run(20, 10)
    p.shotnow("r2_yard")
    p.say("  gnasher:", json.dumps(p.js(
        "() => (CRESTBOUND.game.course.critters||[]).map(c => ({k: c.kind || (c.def && c.def.kind),"
        " p: c.mesh ? [+c.mesh.position.x.toFixed(2), +c.mesh.position.y.toFixed(2), +c.mesh.position.z.toFixed(2)] : null,"
        " kills: (c.kills||[]).length })).filter(c => c.k === 'gnasher')")))
    cur, _ = p.walk(-18.5, 7.2, frames=260, tag="into the gnasher's reach")
    p.say("  standing in reach, 8 s, no input:")
    s = p.run(480, 60)
    p.say("   ", brief(s))
    p.say("  deaths:", json.dumps(p.snapc()))
    p.shotnow("r2_gnasher")
    # pound the post 3x
    p.place(-19.0, 5.40, 9.6, 0.0)
    p.run(16, 8)
    for i in range(4):
        p.face_to(-19.0, 8.6)
        p.stick(0, 1)
        p.run(14, 7)
        p.press("Space"); p.run(9, 5); p.release("Space"); p.run(5, 5)
        p.press("KeyC"); p.run(8, 4); p.release("KeyC")
        s = p.run(50, 10)
        p.stick(0, 0)
        p.run(10, 10)
        cur = p.js("() => __R1.s()")
        p.say("    post pound %d -> %s %s ; flags %s" % (i + 1, cur["p"], cur["st"],
              json.dumps(p.js("() => ['gnasher-freed'].map(k => [k, CRESTBOUND.game.save.flags.get(k)])"))))
    p.shotnow("r2_post_pounded")


def sc_barnstair(p):
    p.say("\n### BEAT 4 — THE BARN STAIR, THE EAVES WALK AND THE LOFT GANTRY ###")
    p.place(-17.4, 5.20, 6.4, 0.0)
    p.run(20, 10)
    p.say("  stair foot:", json.dumps(p.js("() => __R1.s()")))
    p.shotnow("r2_stair_foot")
    cur, s = p.walk(-22.0, 6.4, frames=280, tag="up the barn stair (10 x 0.34 = 3.4 m)")
    p.say("  y track:", [round(x["p"][1], 2) for x in s[::3]])
    p.shotnow("r2_stair_top")
    cur, _ = p.walk(-25.8, 6.3, frames=220, tag="the eaves walk (top 8.20)")
    cur, _ = p.walk(-27.2, 4.5, frames=220, tag="onto the loft gantry")
    p.shotnow("r2_gantry")
    cur, _ = p.walk(-27.2, 3.8, frames=160, tag="up to the hay wall")
    p.say("  at the hay:", json.dumps(cur))
    p.shotnow("r2_hay_before")
    for i in range(3):
        p.press("Space"); p.run(9, 5); p.release("Space"); p.run(5, 5)
        p.press("KeyC"); p.run(8, 4); p.release("KeyC")
        p.run(50, 10)
        p.say("    hay pound %d: breakables %s crests %s"
              % (i + 1, json.dumps(p.brk()), json.dumps(p.snapc())))
    p.shotnow("r2_hay_after")
    cur, _ = p.walk(-27.2, 0.6, frames=200, tag="past the hay to the SECRET crest")
    p.run(180, 60)
    p.say("  after: %s ; crests %s" % (json.dumps(p.js("() => __R1.s()")), json.dumps(p.snapc())))
    p.shotnow("r2_secret")


def sc_tracks(p):
    p.say("\n### THE REQUIRED WALK: square -> hillside -> ledge -> chapel track -> green ###")
    p.place(0.0, 5.00, 3.0, 0.0)
    p.run(20, 10)
    p.shotnow("r2_square")
    legs = [(2, -1), (6, -8), (10, -14), (13, -19), (14, -22), (12, -25), (8, -29),
            (6, -31), (4, -33), (0, -37), (2, -42), (0, -44)]
    for (x, z) in legs:
        cur, s = p.walk(x, z, frames=320, tag="")
        st = sorted(set(q["st"] for q in s))
        if "slopeSlide" in st or "bonk" in st:
            p.say("      states on this leg: %s" % st)
    p.say("  green:", json.dumps(p.js("() => __R1.s()")))
    p.say("  checkpoints hit:", json.dumps(p.snapc()))
    p.shotnow("r2_green")


def sc_towerdoor(p):
    p.say("\n### BEAT 8 — THE TOWER DOORWAY (east face, 1.10 x 2.40 at x 1.8, z ~-46.7) ###")
    p.place(4.5, 15.40, -46.9, 0.0)
    p.run(20, 10)
    p.shotnow("r2_tower_outside")
    cur, s = p.walk(0.0, -47.0, frames=300, tag="through the door into the shaft")
    p.say("  inside?:", json.dumps(cur))
    p.say("  camera in the shaft: dist=%s" % cur["cam"])
    p.say("  cam dist through the walk:", sorted(set(q["cam"][0] for q in s))[:10])
    p.shotnow("r2_shaft_inside")



QCOL = r"""([x0,z0,x1,z1]) => { const T = CRESTBOUND.THREE, bp = CRESTBOUND.game.course.broadphase;
  const box = new T.Box3(new T.Vector3(x0, -3, z0), new T.Vector3(x1, 5, z1));
  const out = []; bp.query(box, out);
  return out.map(c => ({ kind: (c.props && c.props.kind) || '?', surface: c.surface,
    breakable: !!(c.props && c.props.breakable),
    x: [+(c.center.x - c.half.x).toFixed(2), +(c.center.x + c.half.x).toFixed(2)],
    z: [+(c.center.z - c.half.z).toFixed(2), +(c.center.z + c.half.z).toFixed(2)],
    top: +(c.center.y + c.half.y).toFixed(2), active: !!c.active, solid: !!c.solid })); }"""


def sc_ice(p):
    p.say("\n### BEAT 1 - WHAT IS UNDER THE ICE PLUG, AND WHY IT CRUSHES YOU ###")
    p.say("  colliders in the plug's footprint (x 3..7, z 39..45):")
    for c in p.js(QCOL, [3.0, 39.0, 7.0, 45.0]):
        p.say("     " + json.dumps(c))
    p.js("() => { const G = CRESTBOUND.game; if (!G.__dh) { G.__deaths = [];"
         " const o = G.onDeath.bind(G); G.onDeath = function (c) { G.__deaths.push({cause:String(c),"
         " p:[+G.player.pos.x.toFixed(2),+G.player.pos.y.toFixed(2),+G.player.pos.z.toFixed(2)]}); return o(c); };"
         " G.__dh = 1; } G.__deaths.length = 0; }")
    p.say("  stand on the plug, per-frame:")
    p.place(5.0, 1.45, 42.0, 0.0)
    s = p.run(300, 10)
    p.say("   " + json.dumps([(q["i"], q["st"], q["p"], q["g"]) for q in s]))
    p.say("  deaths: " + json.dumps(p.js("() => CRESTBOUND.game.__deaths")))
    p.shotnow("r2_on_plug")
    p.say("\nnow POUND it immediately and see whether the hole opens:")
    p.js("() => { CRESTBOUND.game.__deaths.length = 0; }")
    p.place(5.0, 1.45, 42.0, 0.0)
    p.run(8, 8)
    p.press("Space"); p.run(9, 9); p.release("Space"); p.run(6, 6)
    p.press("KeyC"); p.run(8, 8); p.release("KeyC")
    s = p.run(80, 8)
    p.say("   pound track: " + json.dumps([(q["i"], q["st"], q["p"], q["g"], q["water"]) for q in s]))
    p.say("   breakables: " + json.dumps(p.brk()))
    p.say("   flag ice-hole-open: " + json.dumps(p.js("() => CRESTBOUND.game.save.flags.get('ice-hole-open')")))
    p.say("   colliders in the footprint AFTER the pound:")
    for c in p.js(QCOL, [3.0, 39.0, 7.0, 45.0]):
        p.say("     " + json.dumps(c))
    s = p.run(240, 24)
    p.say("   240 frames later: " + json.dumps([(q["i"], q["st"], q["p"], q["water"], q["sub"]) for q in s]))
    p.say("   collectibles: " + json.dumps(p.snapc()))
    p.say("   deaths: " + json.dumps(p.js("() => CRESTBOUND.game.__deaths")))
    p.shotnow("r2_plug_pounded")


SCENES2 = {"ice": sc_ice, "roofs": sc_roofs, "bells": sc_bells, "pine": sc_pine, "gnasher": sc_gnasher,
           "barnstair": sc_barnstair, "tracks": sc_tracks, "towerdoor": sc_towerdoor}

if __name__ == "__main__":
    from _r1step import SCENES
    want = sys.argv[1:] or list(SCENES2)
    with Step2("rime1b") as p:
        p.say("starting: " + " ".join(want))
        p.boot("rime-1")
        for w in want:
            fn = SCENES2.get(w) or SCENES.get(w)
            if not fn:
                p.say("no scene " + w)
                continue
            try:
                p.js("() => __R1.begin()")
                fn(p)
            except Exception as e:
                p.say("  !! %s raised %r" % (w, e))
                import traceback
                traceback.print_exc()
        p.say("\nconsole: " + json.dumps(p.console[:24]))
