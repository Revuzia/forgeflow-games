"""PLAYTEST — ember-1 MAGMA WORKS, segments 2..7 (see _play_e1.py for seg 1).

  python _harness/_play_e1b.py --seg 1|2|2b|3|4|5|6|7
"""
import argparse, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_e1 import E1, save_report, seg1  # noqa: E402


# ===========================================================================
def seg2(g):
    """BEAT 2-3: junction deck, the metal hat, first slag raft."""
    g.enter(cp=2)   # cp-junction
    g.note("SEG2 start at cp-junction (0, 3.0, -7.5)")
    g.shot("junction_spawn")
    g.say("junction snap", g.snap())

    g.face(0, -12.8); g.wait(400); g.shot("junction_signs")
    g.face(-4, -9); g.wait(400); g.shot("metal_hat_on_deck")

    before = g.snap()
    g.go(-4.0, -9.0, tol=1.0, max_ms=9000, tag="the iron hat")
    g.wait(900)
    after = g.snap()
    g.say("power before/after", before["power"], after["power"])
    g.shot("hat_pickup")

    g.tp(0, 3.2, -11.0); g.wait(600)
    g.face(4.4, -16.0); g.wait(300)
    g.shot("raft_field_from_junction")
    g.go(4.4, -16.0, tol=1.0, max_ms=9000, tag="R1")
    ys = []
    for i in range(16):
        g.wait(200)
        s = g.snap()
        ys.append((s["t"], s["p"][1], s["ps"], s["deaths"]))
    g.say("R1 sink trace", ys)
    g.rep.setdefault("traces", {})["R1_sink"] = ys
    save_report(g.rep)
    g.shot("raft_R1_sinking")
    g.dump("e1_seg2")


def seg2b(g):
    """The raft crossing proper, hopping R1..R9."""
    g.enter(cp=2)
    g.note("SEG2b raft crossing R1..R9")
    RAFTS = [(4.4, -16.0), (8.8, -18.9), (13.4, -21.5), (17.2, -25.1), (16.4, -30.4),
             (20.4, -32.6), (25.6, -32.8), (27.6, -28.0), (25.0, -23.4)]
    g.tp(0, 3.2, -11.0); g.wait(600)
    d0 = g.snap()["deaths"]
    trace = []
    for i, (x, z) in enumerate(RAFTS):
        g.face(x, z)
        g.down("W"); g.wait(260)
        g.tap("SPACE", 110)
        g.wait(700)
        g.up("W"); g.wait(260)
        s = g.snap()
        trace.append({"raft": i + 1, "target": [x, z], "p": s["p"], "ps": s["ps"],
                      "gnd": s["gnd"], "surf": s["surf"], "deaths": s["deaths"]})
        g.say("  R%d -> %s %s gnd=%s deaths=%d" % (i + 1, s["p"], s["ps"], s["gnd"], s["deaths"]))
        if i in (0, 3, 8):
            g.shot("raft_R%d" % (i + 1))
        if s["deaths"] > d0:
            g.shot("raft_death_after_R%d" % (i + 1))
            break
    g.rep.setdefault("traces", {})["rafts"] = trace
    save_report(g.rep)
    g.shot("raft_field_end")
    g.dump("e1_seg2b")


# ===========================================================================
def seg3(g):
    """BEAT 4: the smelter — belt, crusher, jump pad, breakables."""
    g.enter(cp=3)   # cp-smelter (31, 6, -34)
    g.note("SEG3 start at cp-smelter")
    g.shot("smelter_spawn")
    g.face(31, -27.4); g.wait(400); g.shot("smelter_signs")

    g.go(31.0, -30.0, tol=0.9, max_ms=9000, tag="the green jump pad")
    s0 = g.snap()
    apex = s0["p"][1]
    tr = []
    for i in range(20):
        g.wait(150)
        s = g.snap()
        apex = max(apex, s["p"][1])
        tr.append((s["p"][1], s["ps"]))
    g.say("jump pad apex y=%.2f trace=%s" % (apex, tr[:12]))
    g.rep.setdefault("traces", {})["jumppad"] = {"apex": apex, "trace": tr}
    save_report(g.rep)
    g.shot("jumppad_launch")

    g.tp(38.0, 6.9, -31.5); g.wait(800)
    p0 = g.snap()["p"]
    g.wait(1600)
    p1 = g.snap()["p"]
    g.say("belt drift %s -> %s (dx %.2f)" % (p0, p1, p1[0] - p0[0]))
    g.shot("belt_stand")

    g.tp(43.5, 6.9, -31.5); g.wait(700)
    g.face(30, -31.5)
    g.go(32.0, -31.5, tol=1.4, max_ms=14000, tag="belt against the flow -> sigil 3")
    g.shot("belt_against_flow")
    g.say("sigils now", g.snap()["sig"])

    for t, tag in [(0.1, "crusher_up"), (1.6, "crusher_down"), (2.4, "crusher_dwell")]:
        g.setclock(t); g.wait(500); g.shot("crusher_t%.1f_%s" % (t, tag))

    g.tp(34.6, 8.8, -31.5); g.wait(600)
    c0 = g.snap()["coins"]
    g.tap("C", 400)
    g.wait(1500)
    c1 = g.snap()["coins"]
    g.say("crate pound coins %d -> %d" % (c0, c1))
    g.shot("crate_pound")
    g.dump("e1_seg3")


# ===========================================================================
def seg4(g):
    """BEAT 5: the east gantry (ROUTE B) and its two pulse beams."""
    g.enter(cp=1)
    g.note("SEG4 ROUTE B: east ore bank -> gantry -> beams -> smelter deck")
    g.tp(40.0, 6.6, 16.0); g.wait(900)
    g.face(40, -9); g.wait(400)
    g.shot("gantry_head")
    g.face(40, 13.6); g.wait(400); g.shot("gantry_sign")

    g.face(40, -9)
    for t, tag in [(0.2, "beam1_ON"), (1.9, "beam2_ON"), (3.2, "both_off")]:
        g.setclock(t); g.wait(500); g.shot("beam_t%.1f_%s" % (t, tag))

    d0 = g.snap()["deaths"]
    g.setclock(0.0)
    g.tp(40.0, 6.6, 15.0); g.wait(600)
    g.go(40.0, -10.0, tol=2.0, max_ms=20000, tag="the whole gantry")
    s = g.snap()
    g.say("gantry walk end", s["p"], "deaths", d0, "->", s["deaths"])
    g.shot("gantry_walk_end")

    g.tp(40.0, 6.6, -3.0); g.wait(600)
    g.face(44.5, -3.0); g.wait(300); g.shot("pylon_spur_sigil8")
    g.go(44.5, -3.0, tol=1.2, max_ms=10000, tag="pylon spur sigil 8")
    g.say("sigils", g.snap()["sig"])
    g.shot("pylon_spur_end")
    g.dump("e1_seg4")


# ===========================================================================
def seg5(g):
    """BEAT 6: crucible base yard, the wall-kick flue (ROUTE C), the flue ledge."""
    g.enter(cp=4)
    g.note("SEG5 crucible base yard, flue, flue ledge")
    g.shot("base_yard_spawn")
    g.face(-8, -34); g.wait(400); g.shot("flue_from_yard")

    g.go(-11.0, -34.0, tol=1.2, max_ms=10000, tag="the flue door")
    g.shot("flue_door")
    g.face(-8, -34)
    g.go(-8.0, -34.0, tol=1.4, max_ms=10000, tag="inside the flue")
    s = g.snap(); g.say("inside flue?", s["p"], s["surf"])
    g.shot("flue_inside")
    g.face(-10.1, -33.4); g.wait(400); g.shot("flue_sign")

    g.tp(-8.0, 6.6, -34.0); g.wait(700)
    ys = []
    g.face(-9.5, -34.0)
    g.tap("SPACE", 140)
    for k in range(6):
        g.wait(260)
        s = g.snap(); ys.append((round(s["p"][1], 2), s["ps"], s["jc"]))
        tx = -6.5 if (k % 2 == 0) else -9.5
        g.face(tx, -34.0)
        g.down("W"); g.wait(90); g.tap("SPACE", 110); g.wait(160); g.up("W")
    g.wait(700)
    s = g.snap(); ys.append((round(s["p"][1], 2), s["ps"], s["jc"]))
    g.say("flue kick trace", ys)
    g.shot("flue_kick_attempt")
    g.rep.setdefault("traces", {})["flue_kicks"] = ys
    save_report(g.rep)

    g.tp(-8.0, 15.8, -34.0); g.wait(800)
    g.shot("flue_ledge")
    g.face(-9.5, -30.6)
    g.go(-9.5, -30.6, tol=1.4, max_ms=10000, tag="flue ledge -> sigil 4")
    g.say("sigils", g.snap()["sig"])
    g.shot("flue_ledge_sigil4")
    g.dump("e1_seg5")


# ===========================================================================
def seg6(g):
    """BEAT 7-8: the level-3 walk and THE POUR, the crane crest."""
    g.enter(cp=4)
    g.note("SEG6 the pour, the crown, the crane hook crest")
    g.tp(-9.0, 15.6, -30.4); g.wait(900)
    g.face(9, -30.4); g.wait(400)
    g.shot("walk3_from_west")
    g.face(-9.4, -29.0); g.wait(400); g.shot("pour_sign")

    for t, tag in [(28.2, "pour_warn"), (0.5, "pour_ON"), (3.0, "pour_ON_mid"), (10.0, "pour_off")]:
        g.setclock(t); g.wait(600)
        g.shot("pour_t%.1f_%s" % (t, tag))

    d0 = g.snap()["deaths"]
    g.tp(0.0, 15.6, -30.4); g.wait(500)
    g.setclock(29.6); g.wait(200)
    for i in range(16):
        g.wait(200)
        s = g.snap()
        if s["deaths"] > d0:
            g.say("pour killed at t=%.2f y=%.2f" % (s["t"], s["p"][1]))
            break
    g.shot("pour_stand_result")
    g.say("pour stand deaths %d -> %d" % (d0, g.snap()["deaths"]))

    g.setclock(10.0)
    g.tp(6.0, 15.6, -30.4); g.wait(600)
    g.face(9, -30.4); g.wait(300); g.shot("walk3_rotor")

    g.tp(-4.0, 25.8, -37.0); g.wait(1000)
    g.face(-4, -40.6); g.wait(400)
    g.shot("crane_gantry")
    c0 = g.snap()["crests"]
    g.go(-4.0, -40.6, tol=1.2, max_ms=12000, tag="the crane hook crest")
    g.wait(2500)
    s = g.snap()
    g.say("crest %s -> %s state=%s" % (c0, s["crests"], s["st"]))
    g.shot("crest_collect")
    g.wait(3500)
    g.shot("crest_celebration")
    g.say("after celebration", g.snap())
    g.dump("e1_seg6")


# ===========================================================================
def seg7(g):
    """BEAT 8-10: bucket orbit, rim, Warden pit, iron-hat lava walk."""
    g.enter(cp=4)
    g.note("SEG7 bucket orbit, rim, warden pit, iron-hat lava walk")

    g.tp(-4.0, 25.8, -38.0); g.wait(800)
    g.face(0, -28.4); g.wait(400); g.shot("bucket_orbit_from_crown")
    for t in (0.0, 2.0, 4.0):
        g.setclock(t); g.wait(500); g.shot("bucket_t%.0f" % t)

    g.tp(-5.2, 22.2, -38.0); g.wait(800)
    g.face(-5.2, -33.5); g.wait(400); g.shot("rim_walk")
    g.go(-5.2, -33.5, tol=1.5, max_ms=10000, tag="the rim walk")
    g.shot("rim_walk_end")
    g.say("rim end", g.snap())

    g.tp(-16.0, 6.6, -34.0); g.wait(800)
    g.face(-32, -34); g.wait(400); g.shot("warden_pit_approach")
    g.face(-23.0, -31.0); g.wait(300); g.shot("warden_sign")
    g.go(-26.0, -34.0, tol=2.0, max_ms=14000, tag="chain bridge into the pit")
    g.shot("chain_bridge")
    d0 = g.snap()["deaths"]
    g.go(-32.0, -34.0, tol=2.5, max_ms=14000, tag="the Warden")
    g.wait(1500)
    g.shot("warden_close")
    s = g.snap()
    g.say("warden approach", s["p"], "deaths", d0, "->", s["deaths"])
    for i in range(12):
        g.wait(400)
        s = g.snap()
        if s["deaths"] > d0:
            break
    g.shot("warden_stand_still")
    g.say("stood still by the Warden 5 s: deaths %d -> %d" % (d0, g.snap()["deaths"]))

    g.js("() => CRESTBOUND.game.__dev.goto('ember-1', 2)")
    g.wait(4500)
    g.go(-4.0, -9.0, tol=1.0, max_ms=9000, tag="the iron hat")
    g.wait(700)
    s = g.snap(); g.say("power after pickup", s["power"])
    g.shot("hat_taken")
    g.tp(-6.0, 3.2, -11.0); g.wait(500)
    g.face(-26, -14)
    d0 = g.snap()["deaths"]
    g.go(-26.0, -14.0, tol=2.5, max_ms=25000, tag="LAVA WALK to the islet")
    s = g.snap()
    g.say("lava walk", s["p"], "deaths", d0, "->", s["deaths"], "power", s["power"])
    g.shot("lava_walk_end")
    g.dump("e1_seg7")


# ===========================================================================
def seg1b(g):
    """THE CATWALK TRAVERSE — can a player actually walk past the flame vents?
    The vents render as 3-4 m wide iron basins standing on a 4 m catwalk."""
    g.enter(cp=1)
    g.note("SEG1b walk the flame catwalk end to end, quay z 12 -> junction z -9")

    # (a) hazards FROZEN, so anything that stops the hero is GEOMETRY, not fire
    g.js("() => CRESTBOUND.game.__dev.freezeHazards(true)")
    g.setclock(2.0)
    g.tp(0.0, 3.2, 12.0); g.wait(700)
    g.shot("catwalkA_start_frozen")
    g.face(0, -9)
    g.down("W")
    tr = []
    for i in range(60):
        g.wait(250)
        s = g.snap()
        tr.append([s["p"][0], s["p"][2], s["ps"], s["deaths"]])
        if s["p"][2] < -8.5 or s["deaths"] > 0:
            break
    g.up("W"); g.wait(400)
    s = g.snap()
    g.say("FROZEN traverse ended at", s["p"], s["ps"], "deaths", s["deaths"])
    g.rep.setdefault("traces", {})["catwalk_frozen"] = tr
    save_report(g.rep)
    g.shot("catwalkA_end_frozen")

    # where exactly did he stall?  step in from the south, 0.5 m at a time
    stalls = []
    for zz in (10.5, 9.8, 9.2, 8.6, 8.0, 7.4, 6.6, 4.0, 2.0, 0.0, -4.0, -6.0):
        g.tp(0.0, 3.2, zz + 1.4); g.wait(350)
        g.face(0, zz - 2.0)
        g.down("W"); g.wait(900); g.up("W"); g.wait(250)
        s = g.snap()
        stalls.append({"from": zz + 1.4, "to": s["p"][2], "x": s["p"][0], "ps": s["ps"]})
        g.say("  push from z=%.1f -> z=%.2f  (%s)" % (zz + 1.4, s["p"][2], s["ps"]))
    g.rep.setdefault("traces", {})["catwalk_push"] = stalls
    save_report(g.rep)

    # what does the broadphase say is standing on the deck at the vent?
    cols = g.js("""() => { const G=CRESTBOUND.game, C=G.course; const out=[];
      const bp = C && C.broadphase; if(!bp) return out;
      const list = bp._all || bp.colliders || [];
      for (const c of list) {
        if (!c || !c.center) continue;
        if (Math.abs(c.center.x) < 6 && c.center.z > -8 && c.center.z < 12 && c.center.y > 2 && c.center.y < 9)
          out.push({c:[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2)],
                    h:[+c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)],
                    solid:!!c.solid, surface:c.surface, group:c.group});
      }
      return out; }""")
    g.say("colliders on the catwalk band:", cols)
    g.rep.setdefault("traces", {})["catwalk_colliders"] = cols
    save_report(g.rep)

    # (b) hazards LIVE — the real thing
    g.js("() => CRESTBOUND.game.__dev.freezeHazards(false)")
    g.setclock(1.6)
    g.tp(0.0, 3.2, 12.0); g.wait(700)
    d0 = g.snap()["deaths"]
    g.face(0, -9)
    g.down("W")
    tr2 = []
    for i in range(60):
        g.wait(250)
        s = g.snap()
        tr2.append([s["p"][2], s["ps"], s["deaths"]])
        if s["p"][2] < -8.5 or s["deaths"] > d0:
            break
    g.up("W"); g.wait(500)
    s = g.snap()
    g.say("LIVE traverse ended at", s["p"], s["ps"], "deaths", d0, "->", s["deaths"])
    g.rep.setdefault("traces", {})["catwalk_live"] = tr2
    save_report(g.rep)
    g.shot("catwalkB_end_live")
    g.dump("e1_seg1b")


# ===========================================================================
def seg8(g):
    """The crucible SPIRAL: the east flight, the level-3 walk, the west flight.
    Walked on foot the whole way, which is what the course asks a player for."""
    g.enter(cp=4)
    g.note("SEG8 climb the crucible on foot: east flight -> walk3 -> west flight -> crown")
    g.js("() => CRESTBOUND.game.__dev.freezeHazards(true)")

    # east flight foot: stairs p [11, 6, -37] n 30 rise .30 run .42 yaw 0
    g.tp(11.0, 6.6, -30.0); g.wait(700)
    g.face(11, -37); g.wait(300)
    g.shot("east_flight_foot")
    g.go(11.0, -44.0, tol=2.0, max_ms=26000, tag="UP the east flight")
    s = g.snap()
    g.say("east flight ended at", s["p"], s["ps"], "surf", s["surf"])
    g.shot("east_flight_top")

    # if we are up, walk the level-3 walk west
    g.tp(9.0, 15.6, -30.4); g.wait(700)
    g.face(-11, -30.4); g.wait(300)
    g.shot("walk3_east_end")
    g.go(-11.0, -30.4, tol=1.6, max_ms=18000, tag="the level-3 walk, east -> west")
    g.say("walk3 end", g.snap())
    g.shot("walk3_west_end")

    # west flight foot: stairs p [-11.5, 15, -36] n 34 yaw PI
    g.face(-11.5, -40); g.wait(300)
    g.shot("west_flight_foot")
    g.go(-11.5, -44.0, tol=2.5, max_ms=30000, tag="UP the west flight")
    s = g.snap()
    g.say("west flight ended at", s["p"], s["ps"])
    g.shot("west_flight_top")

    # and on to the crane gantry
    g.face(-4, -40.6); g.wait(300)
    g.go(-4.0, -40.6, tol=1.6, max_ms=14000, tag="on to the crane gantry")
    g.say("crown end", g.snap())
    g.shot("crown_reached")
    g.dump("e1_seg8")


# ===========================================================================
def seg9(g):
    """THE CATWALK, properly: what is standing on it, and can it be run?"""
    g.enter(cp=1)
    g.note("SEG9 catwalk colliders + a real timed run from the quay to the junction")

    cols = g.js("""() => { const bp = CRESTBOUND.game.course.broadphase; const out=[];
      for (const c of (bp.items||[])) { const p=c.center||c.pos; if(!p) continue;
        if (Math.abs(p.x) < 8 && p.z > -14 && p.z < 14 && p.y > 1.5 && p.y < 10)
          out.push({c:[+p.x.toFixed(2),+p.y.toFixed(2),+p.z.toFixed(2)],
                    h:c.half?[+c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)]:null,
                    solid:c.solid!==false, surface:c.surface||null, group:c.group||null}); }
      return out; }""")
    g.say("catwalk-band colliders (%d):" % len(cols))
    for c in cols:
        g.say("   ", c)
    g.rep.setdefault("traces", {})["catwalk_colliders"] = cols
    save_report(g.rep)

    # how big is the vent's VISUAL basin? measure the hazard mesh bounds
    vents = g.js("""() => { const G=CRESTBOUND.game, C=G.course, THREE=CRESTBOUND.THREE;
      const out=[]; const box=new THREE.Box3();
      for (const h of (C.hazards||[])) {
        if (!h || !h.def || h.def.kind!=='flame') continue;
        if (!h.mesh) { out.push({p:h.def.p, mesh:null}); continue; }
        box.setFromObject(h.mesh);
        out.push({p:h.def.p, len:h.def.len, radius:h.def.radius,
          min:[+box.min.x.toFixed(2),+box.min.y.toFixed(2),+box.min.z.toFixed(2)],
          max:[+box.max.x.toFixed(2),+box.max.y.toFixed(2),+box.max.z.toFixed(2)],
          killCount:(h.kills||[]).length,
          kill:(h.kills||[]).map(k=>({c:k.center?[+k.center.x.toFixed(2),+k.center.y.toFixed(2),+k.center.z.toFixed(2)]:null,
                                      h:k.half?[+k.half.x.toFixed(2),+k.half.y.toFixed(2),+k.half.z.toFixed(2)]:null,
                                      active:k.active!==false}))});
      }
      return out; }""")
    g.say("flame hazards:")
    for v in vents:
        g.say("   ", v)
    g.rep.setdefault("traces", {})["flames"] = vents
    save_report(g.rep)

    # A REAL RUN: start on the quay, sprint north, sample fine, log the cause.
    for attempt, t0 in enumerate((1.5, 2.6, 3.4)):
        g.js("() => { const G=CRESTBOUND.game; G.__dev.freezeHazards(false); }")
        g.tp(0.0, 3.2, 12.5); g.wait(700)
        g.setclock(t0)
        d0 = g.snap()["deaths"]
        g.face(0, -12)
        g.down("W")
        tr = []
        for i in range(50):
            g.wait(120)
            s = g.snap()
            tr.append([s["t"], round(s["p"][2], 2), s["ps"], s["deaths"]])
            if s["p"][2] < -8.0 or s["deaths"] > d0:
                break
        g.up("W"); g.wait(500)
        s = g.snap()
        cause = g.js("() => CRESTBOUND.game._deathCause")
        got = s["deaths"] == d0 and s["p"][2] < -8.0
        g.say("RUN t0=%.1f -> %s  deaths %d->%d cause=%s  %s"
              % (t0, s["p"], d0, s["deaths"], cause, "CROSSED" if got else "FAILED"))
        g.rep.setdefault("traces", {})["catwalk_run_t%.1f" % t0] = {
            "crossed": got, "cause": cause, "end": s["p"], "trace": tr}
        save_report(g.rep)
        g.shot("catwalk_run_t%.1f" % t0)

    # what does a bumbler on the catwalk do while I stand still?
    g.tp(0.0, 3.2, 0.0); g.wait(600)
    g.setclock(3.6)
    d0 = g.snap()["deaths"]
    st = []
    for i in range(24):
        g.wait(400)
        s = g.snap()
        st.append([round(s["t"], 1), s["p"], s["ps"], s["deaths"]])
        if s["deaths"] > d0:
            break
    g.say("standing still on the catwalk 9 s:", st[-1], "deaths", d0, "->", g.snap()["deaths"])
    g.shot("catwalk_stand_still")
    g.rep.setdefault("traces", {})["catwalk_stand"] = st
    save_report(g.rep)
    g.dump("e1_seg9")


# ===========================================================================
def seg2c(g):
    """THE RAFT FIELD, played the way it is meant to be played: never stop.
    W held down the whole crossing, re-aim at the next raft every 150 ms,
    tap jump whenever the feet are near the near edge of the next one."""
    g.enter(cp=2)
    g.note("SEG2c the nine slag rafts, run-and-jump, W held throughout")
    RAFTS = [(4.4, -16.0), (8.8, -18.9), (13.4, -21.5), (17.2, -25.1), (16.4, -30.4),
             (20.4, -32.6), (25.6, -32.8), (27.6, -28.0), (25.0, -23.4), (31.0, -21.0)]

    for attempt in range(2):
        g.tp(0.0, 3.2, -12.4); g.wait(800)
        g.face(4.4, -16.0); g.wait(300)
        if attempt == 0:
            g.shot("raftrun_start")
        d0 = g.snap()["deaths"]
        i = 0
        tr = []
        g.down("W")
        for step in range(140):
            s = g.snap()
            px, pz = s["p"][0], s["p"][2]
            tr.append([round(px, 2), round(s["p"][1], 2), round(pz, 2), s["ps"], s["deaths"]])
            if s["deaths"] > d0:
                g.say("  DIED crossing at raft %d, %s" % (i + 1, s["p"]))
                break
            tx, tz = RAFTS[min(i, len(RAFTS) - 1)]
            d = ((px - tx) ** 2 + (pz - tz) ** 2) ** 0.5
            if d < 1.3:
                i += 1
                if i >= len(RAFTS):
                    g.say("  CROSSED the field at %s" % (s["p"],))
                    break
                tx, tz = RAFTS[i]
            g.face(tx, tz)
            if s["gnd"] and d > 1.6:
                g.tap("SPACE", 100)
            g.wait(130)
        g.up("W"); g.wait(700)
        s = g.snap()
        g.say("RAFT RUN %d ended %s reached raft %d deaths %d->%d"
              % (attempt + 1, s["p"], i, d0, s["deaths"]))
        g.rep.setdefault("traces", {})["raftrun_%d" % attempt] = {
            "reached": i, "end": s["p"], "deaths": [d0, s["deaths"]], "trace": tr}
        save_report(g.rep)
        g.shot("raftrun_end_%d" % attempt)

    # stand on R1 and watch it sink, on foot, with the clock running
    g.tp(4.4, 3.4, -16.0); g.wait(500)
    d0 = g.snap()["deaths"]
    ys = []
    for i in range(22):
        g.wait(200)
        s = g.snap()
        ys.append([round(s["t"], 2), round(s["p"][1], 2), s["ps"], s["gnd"], s["deaths"]])
        if s["deaths"] > d0:
            break
    g.say("R1 stand-and-sink:", ys)
    g.rep.setdefault("traces", {})["R1_stand"] = ys
    save_report(g.rep)
    g.shot("raft_R1_sunk")
    g.dump("e1_seg2c")


# ===========================================================================
def _belt(g, name, x, y, z, west_x, east_x):
    """Measure a conveyor three ways: no input, running east, running west."""
    out = {"name": name}
    # (a) no input at all - what does the belt do to a player who stands still?
    g.tp(x, y, z); g.wait(1200)
    p0 = g.snap()
    tr = []
    for i in range(14):
        g.wait(250)
        s = g.snap()
        tr.append([round(s["p"][0], 2), round(s["p"][2], 2), s["ps"], s["surf"], s["deaths"]])
    p1 = g.snap()
    out["idle"] = {"from": p0["p"], "to": p1["p"], "dx": round(p1["p"][0] - p0["p"][0], 2),
                   "deaths": [p0["deaths"], p1["deaths"]], "trace": tr}
    g.say("  %s IDLE  %s -> %s  dx %.2f  deaths %d->%d"
          % (name, p0["p"], p1["p"], p1["p"][0] - p0["p"][0], p0["deaths"], p1["deaths"]))
    # (b) run EAST, (c) run WEST
    for tag, tx in (("east", east_x), ("west", west_x)):
        g.tp(x, y, z); g.wait(1000)
        a = g.snap()
        g.face(tx, z)
        g.down("W"); g.wait(1800); g.up("W"); g.wait(300)
        b = g.snap()
        out[tag] = {"from": a["p"], "to": b["p"], "dx": round(b["p"][0] - a["p"][0], 2),
                    "state": b["ps"], "speed": b["v"], "deaths": [a["deaths"], b["deaths"]]}
        g.say("  %s RUN %-4s %s -> %s  dx %.2f  state=%s vel=%s"
              % (name, tag, a["p"], b["p"], b["p"][0] - a["p"][0], b["ps"], b["v"]))
    return out


def seg10(g):
    """The two conveyors and the crusher hopper, measured rather than guessed."""
    g.enter(cp=3)
    g.note("SEG10 conveyors: what they actually do to a player")

    defs = g.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h.def&&h.def.kind==='conveyor')
      .map(h=>({p:h.def.p, s:h.def.s, dir:h.def.dir, power:h.def.power,
                push:h.push?[+h.push.x.toFixed(2),0,+h.push.z.toFixed(2)]:null,
                cols:(h.colliders||[]).map(c=>({c:[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2)],
                   surface:c.surface, vel:c.surfaceVel?[+c.surfaceVel.x.toFixed(2),+c.surfaceVel.y.toFixed(2),+c.surfaceVel.z.toFixed(2)]:null}))}))""")
    g.say("conveyor defs:", json.dumps(defs))
    g.rep.setdefault("traces", {})["conveyor_defs"] = defs
    save_report(g.rep)

    res = {}
    res["smelter"] = _belt(g, "smelter belt", 38.0, 6.6, -31.5, 30.0, 46.0)
    g.shot("belt_smelter")
    res["baseyard"] = _belt(g, "base-yard belt", -2.0, 6.6, -30.0, -10.0, 6.0)
    g.shot("belt_baseyard")
    g.rep.setdefault("traces", {})["belts"] = res
    save_report(g.rep)

    # the crusher hopper through a whole 4.2 s beat, from a player's eye
    g.js("() => CRESTBOUND.game.__dev.goto('ember-1', 3)")
    g.wait(4500)
    g.tp(38.0, 6.6, -27.0); g.wait(900)
    g.face(38, -31.5)
    for t in (0.0, 0.8, 1.4, 2.0, 2.6, 3.4):
        g.setclock(t); g.wait(500)
        g.shot("crusher_beat_t%.1f" % t)
    ys = g.js("""() => { const C=CRESTBOUND.game.course; const out=[];
      for (const h of (C.hazards||[])) { if(!h.def||h.def.kind!=='crusher') continue;
        out.push({p:h.def.p, travel:h.def.travel, period:h.def.period,
                  meshY: h.mesh? +h.mesh.position.y.toFixed(2):null,
                  colY:(h.colliders||[]).map(c=>+c.center.y.toFixed(2))}); }
      return out; }""")
    g.say("crusher now:", ys)

    # can a pound break the crates?
    for cx in (34.6, 43.0):
        g.js("() => CRESTBOUND.game.__dev.freezeHazards(true)")
        g.tp(cx, 9.4, -31.5); g.wait(500)
        c0 = g.snap()["coins"]
        g.down("C"); g.wait(1400); g.up("C"); g.wait(1200)
        c1 = g.snap()["coins"]
        s = g.snap()
        g.say("  pound the crate at x=%.1f: coins %d -> %d, ended %s %s" % (cx, c0, c1, s["p"], s["ps"]))
        g.shot("crate_pound_x%.0f" % cx)
    g.dump("e1_seg10")


# ===========================================================================
def seg11(g):
    """The crown: the crane-hook crest, and what happens if you fall in the pot."""
    g.enter(cp=4)
    g.note("SEG11 crane gantry crest + the crucible interior")

    # --- the crest, approached properly along the gantry (top 25.20, z -42.4..-38.8)
    g.tp(-9.0, 25.7, -40.6); g.wait(1200)
    s = g.snap()
    g.say("on the gantry?", s["p"], s["ps"], s["gnd"], s["surf"])
    g.face(-4, -40.6); g.wait(400)
    g.shot("gantry_stand")
    c0 = g.snap()["crests"]
    sg0 = g.snap()["sig"]
    g.go(-4.0, -40.6, tol=1.0, max_ms=14000, tag="walk the gantry to the crane hook")
    g.wait(2000)
    s = g.snap()
    g.say("crest %s -> %s  sig %s -> %s  state=%s pos=%s"
          % (c0, s["crests"], sg0, s["sig"], s["st"], s["p"]))
    g.shot("crest_on_hook")
    g.wait(4000)
    g.shot("crest_celebrated")
    g.say("after", g.snap())

    # --- the rim, and the step off the gantry the sign warns about
    g.js("() => CRESTBOUND.game.__dev.goto('ember-1', 4)")
    g.wait(4500)
    g.tp(-5.2, 22.0, -38.0); g.wait(1000)
    s = g.snap()
    g.say("on the rim?", s["p"], s["ps"], s["gnd"])
    g.face(-5.2, -33.5); g.wait(300)
    g.shot("rim_stand")
    g.go(-5.2, -33.5, tol=1.6, max_ms=12000, tag="the rim walk south")
    g.say("rim walk end", g.snap())
    g.shot("rim_walk_end")

    # --- fall INTO the pot from the gantry and try to get out
    g.tp(-1.0, 24.0, -38.0); g.wait(2500)
    s = g.snap()
    g.say("dropped inside the vessel ->", s["p"], s["ps"], s["gnd"], s["surf"])
    g.shot("inside_the_pot")
    d0 = s["deaths"]
    esc = {}
    for tag, (tx, tz) in (("north", (-1, -50)), ("south", (-1, -26)),
                          ("east", (10, -38)), ("west", (-12, -38))):
        a = g.snap()
        if a["deaths"] > d0:
            esc[tag] = "died before trying"
            break
        g.face(tx, tz)
        g.down("W")
        for i in range(14):
            g.wait(250)
            g.tap("SPACE", 100)
        g.up("W"); g.wait(400)
        b = g.snap()
        esc[tag] = {"end": b["p"], "state": b["ps"], "deaths": b["deaths"]}
        g.say("  escape %s -> %s %s deaths %d" % (tag, b["p"], b["ps"], b["deaths"]))
    g.shot("pot_escape_attempts")
    g.rep.setdefault("traces", {})["crucible_pot"] = esc
    save_report(g.rep)

    # does the pour clear the pot?
    g.setclock(28.0)
    d0 = g.snap()["deaths"]
    for i in range(30):
        g.wait(300)
        s = g.snap()
        if s["deaths"] > d0:
            g.say("  the pour cleared the pot at t=%.2f" % s["t"])
            break
    g.say("pot pour outcome deaths %d -> %d, pos %s" % (d0, g.snap()["deaths"], g.snap()["p"]))
    g.shot("pot_after_pour")
    g.dump("e1_seg11")


# ===========================================================================
def seg2d(g):
    """The raft field on the HONEST line: line up at x 4.4 on the junction deck,
    5.5 m of straight run-up north, then never stop."""
    g.enter(cp=2)
    g.note("SEG2d raft crossing from the proper approach lane (x 4.4)")
    RAFTS = [(4.4, -16.0), (8.8, -18.9), (13.4, -21.5), (17.2, -25.1), (16.4, -30.4),
             (20.4, -32.6), (25.6, -32.8), (27.6, -28.0), (25.0, -23.4), (31.0, -21.0)]
    for attempt in range(3):
        g.tp(4.4, 3.2, -8.0); g.wait(900)
        g.face(4.4, -16.0); g.wait(400)
        if attempt == 0:
            g.shot("raft2_lineup")
        d0 = g.snap()["deaths"]
        i = 0
        tr = []
        g.down("W")
        # 5.5 m of run-up before the first hop
        g.wait(520)
        for step in range(160):
            s = g.snap()
            px, pz = s["p"][0], s["p"][2]
            tr.append([round(px, 2), round(s["p"][1], 2), round(pz, 2), s["ps"], s["deaths"]])
            if s["deaths"] > d0:
                g.say("  DIED heading for raft %d at %s" % (i + 1, s["p"]))
                break
            tx, tz = RAFTS[min(i, len(RAFTS) - 1)]
            d = ((px - tx) ** 2 + (pz - tz) ** 2) ** 0.5
            if d < 1.5:
                i += 1
                if i >= len(RAFTS):
                    g.say("  CROSSED THE FIELD at %s" % (s["p"],))
                    break
                tx, tz = RAFTS[i]
            g.face(tx, tz)
            if s["gnd"]:
                g.tap("SPACE", 100)
            g.wait(110)
        g.up("W"); g.wait(700)
        s = g.snap()
        g.say("RAFT RUN %d: reached raft %d, ended %s, deaths %d->%d"
              % (attempt + 1, i, s["p"], d0, s["deaths"]))
        g.rep.setdefault("traces", {})["raft2_%d" % attempt] = {
            "reached": i, "end": s["p"], "deaths": [d0, s["deaths"]], "trace": tr}
        save_report(g.rep)
        g.shot("raft2_end_%d" % attempt)
    g.dump("e1_seg2d")


# ===========================================================================
def seg12(g):
    """THE IRON HAT AND THE LAVA WALK: does `metal` really make lava survivable,
    and can you get to the islet and back inside twenty seconds?"""
    g.enter(cp=2)
    g.note("SEG12 iron hat -> lava walk -> the islet at (-26, 1.90, -14)")
    g.tp(-4.0, 3.4, -10.5); g.wait(900)
    g.face(-4, -9); g.wait(300)
    g.shot("hat_from_deck")
    g.go(-4.0, -9.0, tol=0.8, max_ms=9000, tag="on to the iron hat")
    g.wait(700)
    s = g.snap()
    g.say("power after pickup:", s["power"])
    g.shot("hat_on")
    if not s["power"]:
        g.say("NO POWER - trying __dev.power('metal')")
        g.js("() => CRESTBOUND.game.__dev.power('metal', 20)")
        g.wait(600)
        g.say("power now:", g.snap()["power"])

    d0 = g.snap()["deaths"]
    g.tp(-6.0, 3.4, -10.0); g.wait(500)
    g.face(-26, -14)
    g.down("W")
    tr = []
    for i in range(70):
        g.wait(200)
        s = g.snap()
        tr.append([round(s["p"][0], 2), round(s["p"][1], 2), round(s["p"][2], 2),
                   s["ps"], s["surf"], s["deaths"], bool(s["power"])])
        if s["deaths"] > d0:
            g.say("  DIED on the lava at %s (power %s)" % (s["p"], s["power"]))
            break
        d = ((s["p"][0] + 26) ** 2 + (s["p"][2] + 14) ** 2) ** 0.5
        if d < 2.5:
            g.say("  REACHED THE ISLET at %s" % (s["p"],))
            break
        if i == 6 or i == 20:
            g.shot("lavawalk_%02d" % i)
    g.up("W"); g.wait(600)
    s = g.snap()
    g.say("lava walk end", s["p"], s["ps"], "deaths", d0, "->", s["deaths"], "power", s["power"])
    g.rep.setdefault("traces", {})["lava_walk"] = tr
    save_report(g.rep)
    g.shot("lavawalk_end")

    # the crest and the three coins on the islet
    if s["deaths"] == d0:
        c0 = g.snap()
        g.go(-26.0, -14.0, tol=1.2, max_ms=8000, tag="on to the islet")
        g.wait(1500)
        g.say("islet: crests %s -> %s coins %s -> %s"
              % (c0["crests"], g.snap()["crests"], c0["coins"], g.snap()["coins"]))
        g.shot("islet_crest")
    g.dump("e1_seg12")


SEGS = {"1": seg1, "1b": seg1b, "2": seg2, "2b": seg2b, "2c": seg2c, "2d": seg2d, "3": seg3,
        "4": seg4, "5": seg5, "6": seg6, "7": seg7, "8": seg8, "9": seg9,
        "10": seg10, "11": seg11, "12": seg12}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seg", required=True)
    a = ap.parse_args()
    fn = SEGS[a.seg]
    t0 = time.time()
    with E1(a.seg) as g:
        try:
            fn(g)
        finally:
            g.rep.setdefault("console", {})[a.seg] = g.console[:40]
            save_report(g.rep)
    print("seg %s done in %.1f s" % (a.seg, time.time() - t0))
