"""PLAYTEST beats 1c..9 for rime-1 FROST COTTAGE. Imported by _play_rime1.py."""


def beat1c(p):
    """The plug, dead centre, and the swim under it."""
    p.say("\n===== BEAT 1c — POUND THE PLUG DEAD CENTRE =====")
    p.tp(5.0, 2.0, 42.0)
    p.wait(900)
    p.face(5, 38)
    st = p.both()
    p.say("  standing dead centre on the plug:", st)
    p.shot("b1c_plug_centre")
    hist = []
    p.tap("SPACE", 140)
    p.wait(240)
    p.down("C")
    for _ in range(8):
        p.wait(130)
        hist.append(p.both())
    p.up("C")
    for _ in range(10):
        p.wait(200)
        hist.append(p.both())
    p.say("  pound state sequence:", [x["pstate"] for x in hist])
    p.say("  pound y track:", [x["pos"][1] for x in hist])
    p.say("  end:", hist[-1])
    png = p.shot("b1c_after_pound_centre")
    p.say("  flags:", p.js("() => { const f = CRESTBOUND.game.save.flags;"
                           " return ['ice-hole-open'].map(k => [k, f.get(k)]); }"))
    p.say("  breakable alive?:", p.js(
        "() => (CRESTBOUND.game.course.hazards||[]).filter(h => (h.kind||(h.def&&h.def.kind))==='breakable')"
        ".map(h => ({p: h.def&&h.def.p, broken: !!h.broken, dead: !!h.dead,"
        " colliders: (h.colliders||[]).map(c => !!c.active)}))"))
    return hist, png


def beat1d(p):
    """Into the water: swim, sink to sigil 1, and get back OUT."""
    p.say("\n===== BEAT 1d — THE WATER =====")
    # drop straight in whether or not the plug broke
    p.tp(5.0, 0.6, 42.0)
    p.wait(1200)
    st = p.both()
    p.say("  after dropping to y 0.6 at the hole:", st)
    p.shot("b1d_in_water")
    if not st["inWater"]:
        p.say("  NOT in water at y 0.6 — the plug is still solid or the volume is short")
    # CROUCH TO SINK (the sign says so) -> sigil 1 at (5, -0.40, 42)
    p.down("C")
    sink = []
    for _ in range(12):
        p.wait(250)
        sink.append(p.both())
    p.up("C")
    p.say("  sink states:", [x["pstate"] for x in sink])
    p.say("  sink depth:", [x["pos"][1] for x in sink])
    p.say("  sigils:", sink[-1]["sigils"], "coins:", sink[-1]["coins"])
    p.shot("b1d_lake_bed")
    # SWIM BACK UP: jump = stroke
    up = []
    for _ in range(16):
        p.tap("SPACE", 90)
        p.wait(200)
        up.append(p.both())
    p.say("  swim-up states:", [x["pstate"] for x in up])
    p.say("  swim-up y:", [x["pos"][1] for x in up])
    p.shot("b1d_surfaced")
    # GET OUT: surfaced + jump, walking north toward the sheet
    p.face(5, 46)
    p.down("W")
    out = []
    for i in range(18):
        p.tap("SPACE", 90)
        p.wait(220)
        out.append(p.both())
    p.up("W")
    p.wait(600)
    p.say("  exit states:", [x["pstate"] for x in out])
    p.say("  exit y:", [x["pos"][1] for x in out])
    fin = p.both()
    p.say("  ended:", fin)
    png = p.shot("b1d_out_of_water")
    return fin, png


def beat2(p):
    """THE NORTH SHORE — off the ice, cp2, the trodden track up to the square."""
    p.say("\n===== BEAT 2 — THE NORTH SHORE AND THE CLIMB =====")
    p.tp(0, 2.2, 36.0)
    p.wait(800)
    p.face(0, 30)
    p.shot("b2_northshore_approach")
    before = p.snap()["cpIndex"]
    p.walk_to(0, 30.0, tol=1.2, max_ms=9000, stop_on_card=False, tag="cp-northshore")
    p.wait(700)
    p.say("  cpIndex %s -> %s" % (before, p.snap()["cpIndex"]))
    p.shot("b2_cp_northshore")
    for (x, z, tag) in [(0, 24, "track 1"), (-1, 16, "track 2"),
                        (0, 10, "track 3"), (0, 3.0, "cp-square")]:
        r = p.walk_to(x, z, tol=1.4, max_ms=11000, stop_on_card=False, tag=tag)
        p.say("    -> y=%.2f surface=%s pstate=%s" % (r["end"][1], r["state"]["surface"], r["state"]["pstate"]))
    p.wait(700)
    p.say("  square:", p.both())
    p.shot("b2_square")


def beat3(p):
    """THE VILLAGE — pedestal, bumbler, roof stair, four caps, the bells, the pine."""
    p.say("\n===== BEAT 3 — THE VILLAGE =====")
    p.tp(0, 5.2, 3.0)
    p.wait(800)
    p.face(0, 8)
    p.shot("b3_square_look_north")
    p.walk_to(0, 6.4, tol=1.2, max_ms=6000, stop_on_card=False, tag="the pedestal")
    p.shot("b3_pedestal")

    # BUMBLER: stand perfectly still in its patrol box, see if it hurts us
    p.tp(0, 5.2, 8.5)
    p.wait(500)
    d0 = p.snap()["deaths"]
    p.say("  standing still in the square bumbler's loop for 9 s ...")
    seen = []
    for _ in range(18):
        p.wait(500)
        seen.append(p.both())
    p.shot("b3_bumbler_standing_still")
    d1 = p.snap()["deaths"]
    moved = max(((x["pos"][0]) ** 2 + (x["pos"][2] - 8.5) ** 2) ** 0.5 for x in seen)
    p.say("  deaths %s -> %s ; max displacement while idle %.2f m" % (d0, d1, moved))
    p.say("  bumbler positions:", p.js(
        "() => (CRESTBOUND.game.course.critters||[]).filter(c => (c.kind||(c.def&&c.def.kind))==='bumbler')"
        ".map(c => c.mesh ? [+c.mesh.position.x.toFixed(2), +c.mesh.position.y.toFixed(2), +c.mesh.position.z.toFixed(2)] : null)"))

    # THE ROOF STAIR: three snow blocks then cap 1
    p.tp(-14.6, 5.2, 9.5)
    p.wait(600)
    p.face(-14.6, 11.8)
    p.shot("b3_roofstair_foot")
    for (x, z, tag) in [(-14.6, 11.8, "block1_590"), (-14.6, 13.6, "block2_740"),
                        (-13.4, 15.6, "leanto_890"), (-9.0, 16.0, "cap1_1025")]:
        p.face(x, z)
        p.down("W")
        p.wait(330)
        p.tap("SPACE", 140)
        p.wait(950)
        p.up("W")
        p.wait(750)
        st = p.both()
        p.say("    jump to %s -> %s %s grounded=%s" % (tag, st["pos"], st["pstate"], st["grounded"]))
    p.shot("b3_cap1")

    for (x, z, tag) in [(-1.5, 18.0, "cap2"), (6.0, 16.0, "cap3_past_bells"), (13.0, 12.0, "cap4_sigil2")]:
        p.face(x, z)
        p.down("W")
        p.wait(420)
        p.tap("SPACE", 150)
        p.wait(1000)
        p.up("W")
        p.wait(850)
        st = p.both()
        p.say("    -> %s : %s %s sigils=%s" % (tag, st["pos"], st["pstate"], st["sigils"]))
        p.shot("b3_" + tag)

    # sigil 4 hangs between the bells at (2.2, 11.90, 16.5)
    p.tp(2.2, 10.8, 19.6)
    p.wait(700)
    p.face(2.2, 16.5)
    p.shot("b3_bells_from_cap2")
    p.say("  bell positions:", p.js(
        "() => (CRESTBOUND.game.course.hazards||[]).filter(h => (h.kind||(h.def&&h.def.kind))==='pendulum')"
        ".map(h => h.mesh ? [+h.mesh.position.x.toFixed(2), +h.mesh.position.y.toFixed(2), +h.mesh.position.z.toFixed(2)] : null)"))
    d0 = p.snap()["deaths"]
    p.walk_to(2.2, 16.5, tol=1.6, max_ms=9000, stop_on_card=False, tag="into the bells for sigil 4")
    p.wait(900)
    p.say("  after the bells: deaths %s -> %s, %s" % (d0, p.snap()["deaths"], p.both()))
    p.shot("b3_bells_after")

    # THE OLD PINE — press into the trunk to climb
    p.tp(-16.0, 5.2, 23.6)
    p.wait(800)
    p.face(-16, 20)
    p.shot("b3_pine_approach")
    p.down("W")
    states = []
    for _ in range(22):
        p.wait(400)
        states.append(p.both())
    p.up("W")
    p.wait(600)
    p.say("  pine climb states:", [x["pstate"] for x in states])
    p.say("  pine y track:", [x["pos"][1] for x in states])
    p.say("  pine end:", states[-1])
    p.shot("b3_pine_climb")


def beat4(p):
    """THE BARN — the gnasher, the stair, the gantry, the hay wall, the secret."""
    p.say("\n===== BEAT 4 — THE BARN =====")
    p.tp(-14.0, 5.4, 6.0)
    p.wait(800)
    p.face(-19, 8)
    p.shot("b4_yard_approach")

    d0 = p.snap()["deaths"]
    p.walk_to(-18.0, 7.2, tol=1.4, max_ms=9000, stop_on_card=False, tag="into the gnasher's reach")
    p.wait(400)
    p.shot("b4_gnasher_close")
    hist = []
    for _ in range(16):
        p.wait(350)
        hist.append(p.both())
    d1 = p.snap()["deaths"]
    p.say("  gnasher: deaths %s -> %s ; states %s" % (d0, d1, sorted(set(x["pstate"] for x in hist))))
    p.say("  positions while idle:", [x["pos"] for x in hist[::4]])
    p.say("  gnasher mesh:", p.js(
        "() => (CRESTBOUND.game.course.critters||[]).filter(c => (c.kind||(c.def&&c.def.kind))==='gnasher')"
        ".map(c => c.mesh ? [+c.mesh.position.x.toFixed(2), +c.mesh.position.y.toFixed(2), +c.mesh.position.z.toFixed(2)] : null)"))
    p.shot("b4_gnasher_after")

    # POUND THE POST 3x  (post at -19, 8.6)
    p.tp(-19.0, 5.6, 9.7)
    p.wait(700)
    for i in range(4):
        p.face(-19.0, 8.6)
        p.tap("SPACE", 140)
        p.wait(280)
        p.down("C")
        p.wait(800)
        p.up("C")
        p.wait(800)
        p.say("    post pound %d -> %s" % (i + 1, p.both()))
    p.shot("b4_post_pounded")
    p.say("  flags:", p.js("() => { const f = CRESTBOUND.game.save.flags;"
                           " return ['gnasher-freed','hay-wall-broken'].map(k => [k, f.get(k)]); }"))

    # THE STAIR up the barn's south face
    p.tp(-17.2, 5.3, 6.4)
    p.wait(700)
    p.face(-22, 6.4)
    p.shot("b4_stair_foot")
    p.walk_to(-22.5, 6.4, tol=1.5, max_ms=12000, stop_on_card=False, tag="up the barn stair")
    p.wait(600)
    p.say("  stair end:", p.both())
    p.shot("b4_stair_top")
    p.walk_to(-26.2, 6.2, tol=1.6, max_ms=9000, stop_on_card=False, tag="the eaves walk")
    p.walk_to(-27.2, 4.4, tol=1.6, max_ms=9000, stop_on_card=False, tag="the loft gantry")
    p.shot("b4_gantry")
    p.face(-27.2, 2.9)
    p.walk_to(-27.2, 4.0, tol=1.0, max_ms=6000, stop_on_card=False, tag="up to the hay")
    p.shot("b4_hay_before")
    for i in range(3):
        p.tap("SPACE", 140)
        p.wait(280)
        p.down("C")
        p.wait(800)
        p.up("C")
        p.wait(800)
        s = p.both()
        p.say("    hay pound %d -> %s crests=%s" % (i + 1, s["pos"], s["crests"]))
        if s["crests"]:
            break
    p.shot("b4_hay_after")
    p.say("  flags:", p.js("() => { const f = CRESTBOUND.game.save.flags;"
                           " return ['gnasher-freed','hay-wall-broken'].map(k => [k, f.get(k)]); }"))
    p.walk_to(-27.2, 0.5, tol=1.4, max_ms=9000, stop_on_card=False, tag="past the hay to the secret crest")
    p.wait(1400)
    p.say("  after the gantry:", p.both())
    p.shot("b4_secret")


def beat5(p):
    """THE DRIFT — the cornice, the 41 deg slide, the lip jump, the catch ledge."""
    p.say("\n===== BEAT 5 — THE DRIFT =====")
    p.tp(-6.0, 5.2, -1.0)
    p.wait(800)
    p.face(-6, -13)
    p.shot("b5_drift_from_square")
    r = p.walk_to(-6.0, -13.2, tol=1.6, max_ms=15000, stop_on_card=False, tag="up to the cornice")
    p.wait(600)
    p.say("  cornice:", p.both())
    p.shot("b5_cornice")
    p.face(-6, -8.9)
    p.down("W")
    ride = []
    for _ in range(14):
        p.wait(200)
        ride.append(p.both())
    p.say("  drift states:", [x["pstate"] for x in ride])
    p.say("  drift track:", [x["pos"] for x in ride])
    p.shot("b5_sliding")
    p.tap("SPACE", 150)
    p.wait(1100)
    p.up("W")
    p.wait(1000)
    st = p.both()
    p.say("  after the lip jump:", st)
    p.shot("b5_after_lip_jump")
    p.walk_to(-6.0, -5.5, tol=1.4, max_ms=8000, stop_on_card=False, tag="catch ledge / sigil 5")
    p.wait(800)
    p.say("  catch ledge:", p.both())
    p.shot("b5_catch_ledge")


def beat6(p):
    """THE LEDGE, THE CHUTE, THE GORGE, THE GEYSER, THE SINKERS, THE ICE BRIDGE."""
    p.say("\n===== BEAT 6 — THE LEDGE AND THE GORGE =====")
    p.tp(6.0, 6.4, -8.0)
    p.wait(800)
    p.face(13, -19)
    p.shot("b6_hillside_track")
    for (x, z, tag) in [(10, -14, "track"), (13, -19, "track"), (14, -22, "cp-ledge")]:
        r = p.walk_to(x, z, tol=1.6, max_ms=13000, stop_on_card=False, tag=tag)
        p.say("    -> y=%.2f %s" % (r["end"][1], r["state"]["pstate"]))
    p.wait(700)
    p.say("  ledge:", p.both())
    p.shot("b6_ledge")

    # THE CHUTE: onto the launch block, then ride the 42 deg slab
    p.face(17.0, -23.8)
    p.down("W")
    p.wait(400)
    p.tap("SPACE", 140)
    p.wait(1000)
    p.up("W")
    p.wait(700)
    p.say("  launch block:", p.both())
    p.shot("b6_launch_block")
    p.face(22.2, -29.0)
    p.down("W")
    ride = []
    for _ in range(14):
        p.wait(200)
        ride.append(p.both())
    p.say("  chute states:", [x["pstate"] for x in ride])
    p.say("  chute track:", [x["pos"] for x in ride])
    p.shot("b6_chute")
    p.tap("SPACE", 150)
    p.wait(1100)
    p.up("W")
    p.wait(1000)
    p.say("  after the chute lip jump:", p.both())
    p.shot("b6_after_chute")
    p.walk_to(26.4, -32.4, tol=1.6, max_ms=9000, stop_on_card=False, tag="jump ledge / sigil 6")
    p.wait(800)
    p.say("  jump ledge:", p.both())
    p.shot("b6_jump_ledge")

    # THE GEYSER PAD on the gorge floor
    p.tp(23.3, 6.5, -25.5)
    p.wait(900)
    p.face(23.3, -27.9)
    p.shot("b6_geyser_approach")
    y0 = p.pos()[1]
    p.walk_to(23.3, -27.9, tol=1.0, max_ms=8000, stop_on_card=False, tag="onto the geyser pad")
    fly = []
    for _ in range(14):
        p.wait(200)
        fly.append(p.both())
    apex = max(x["pos"][1] for x in fly)
    p.say("  geyser: from y %.2f -> apex %.2f (rise %.2f), states %s"
          % (y0, apex, apex - y0, [x["pstate"] for x in fly]))
    p.shot("b6_geyser_launch")
    p.wait(1200)
    p.say("  landed:", p.both())

    # THE SINKERS up to the knoll
    p.tp(26.4, 7.6, -32.4)
    p.wait(800)
    p.face(28.3, -34.3)
    p.shot("b6_sinkers_from_ledge")
    for (x, z, tag) in [(28.3, -34.3, "sinker1_850"), (30.3, -35.9, "sinker2_1000"),
                        (31.6, -38.4, "sinker3_1150"), (33.2, -39.4, "sinker4_1300")]:
        p.face(x, z)
        p.down("W")
        p.wait(380)
        p.tap("SPACE", 150)
        p.wait(1000)
        p.up("W")
        p.wait(600)
        st = p.both()
        p.say("    %s -> %s %s grounded=%s" % (tag, st["pos"], st["pstate"], st["grounded"]))
    p.shot("b6_sinkers")

    # THE VANISHING ICE BRIDGE from the ledge's SE corner
    p.tp(18.6, 11.0, -24.2)
    p.wait(900)
    p.face(34, -33)
    p.shot("b6_bridge_start")
    p.say("  bridge tiles:", p.js(
        "() => (CRESTBOUND.game.course.hazards||[]).filter(h => (h.kind||(h.def&&h.def.kind))==='vanish')"
        ".map(h => ({p: h.def && h.def.p, on: (h.colliders||[]).map(c => !!c.active), vis: h.mesh ? h.mesh.visible : null}))"))
    cross = []
    p.down("W")
    for _ in range(22):
        p.wait(280)
        cross.append(p.both())
        p.face(34, -33)
    p.up("W")
    p.wait(800)
    p.say("  bridge crossing states:", [x["pstate"] for x in cross])
    p.say("  bridge track:", [x["pos"] for x in cross[::3]])
    p.say("  end:", p.both())
    p.shot("b6_bridge_crossed")
    p.walk_to(38, -34, tol=1.6, max_ms=9000, stop_on_card=False, tag="the knoll FINISH")
    p.wait(700)
    p.say("  knoll:", p.both())
    p.shot("b6_knoll")


def beat7(p):
    """THE CHAPEL TRACK — the bell over the track, up onto the green."""
    p.say("\n===== BEAT 7 — THE CHAPEL TRACK =====")
    p.tp(12.0, 10.6, -25.0)
    p.wait(800)
    p.face(6, -31)
    p.shot("b7_track_start")
    d0 = p.snap()["deaths"]
    for (x, z, tag) in [(8, -29, "track"), (6, -31, "UNDER THE BELL"), (4, -33, "track"),
                        (0, -37, "track"), (0, -42, "cp-green")]:
        r = p.walk_to(x, z, tol=1.6, max_ms=13000, stop_on_card=False, tag=tag)
        p.say("    -> y=%.2f %s deaths=%s" % (r["end"][1], r["state"]["pstate"], p.snap()["deaths"]))
        if tag.startswith("UNDER"):
            p.shot("b7_under_the_bell")
    p.wait(700)
    p.say("  green: deaths %s -> %s, %s" % (d0, p.snap()["deaths"], p.both()))
    p.shot("b7_green")


def beat8(p):
    """THE CHAPEL — the door, the wall-kick shaft, the belfry crest, sigil 7."""
    p.say("\n===== BEAT 8 — THE CHAPEL AND THE BELL TOWER =====")
    p.tp(4.5, 15.4, -47.0)
    p.wait(900)
    p.face(0, -47)
    p.shot("b8_tower_door_outside")
    r = p.walk_to(0.0, -47.0, tol=1.2, max_ms=10000, stop_on_card=False, tag="through the tower door")
    p.wait(700)
    st = p.both()
    p.say("  inside the shaft:", st)
    p.shot("b8_inside_shaft")
    p.say("  CAMERA in the shaft: dist=%s yaw=%s pitch=%s pos=%s"
          % (st["camDist"], st["camYaw"], st["camPitch"], st["camPos"]))

    # THE WALL KICK: jump into a wall, then Space at contact, alternating
    kicks = []
    p.face(0, -49)              # into the north wall
    p.tap("SPACE", 150)
    p.wait(240)
    for i in range(10):
        # steer into the wall we are nearest, then kick
        p.face(0, -49 if i % 2 == 0 else -45)
        p.down("W")
        p.wait(150)
        p.tap("SPACE", 110)
        p.wait(260)
        p.up("W")
        s = p.both()
        kicks.append(s)
        p.say("    kick %d -> y=%.2f %s wall=%s cam.dist=%s" % (i + 1, s["pos"][1], s["pstate"], s.get("wallN"), s["camDist"]))
        if s["pos"][1] > 23.0:
            break
    p.shot("b8_wallkick")
    p.say("  wall-kick top y:", max(k["pos"][1] for k in kicks))
    p.say("  camera dist during the shaft:", [k["camDist"] for k in kicks])

    # get to the belfry deck and the crest whatever happened
    p.tp(0, 23.6, -50.0)
    p.wait(900)
    p.face(0.8, -50.9)
    p.shot("b8_belfry_deck")
    p.walk_to(0.8, -50.9, tol=1.2, max_ms=8000, stop_on_card=False, tag="THE OPEN CREST")
    p.wait(2500)
    p.say("  after the crest:", p.both())
    p.shot("b8_crest")
    p.wait(2500)
    p.say("  after celebration:", p.both())
    p.shot("b8_after_celebration")

    # sigil 7 on the nave cap, along the wall tops
    p.tp(0, 23.6, -49.0)
    p.wait(700)
    p.face(0, -41)
    p.shot("b8_walltops")
    r = p.walk_to(0, -41.0, tol=1.8, max_ms=12000, stop_on_card=False, tag="wall tops to the nave cap / sigil 7")
    p.wait(800)
    p.say("  nave cap:", p.both())
    p.shot("b8_nave_cap")


def beat9(p):
    """THE CREST FACE — the sleigh lift, the shelf, the slide, the kicker."""
    p.say("\n===== BEAT 9 — THE CREST FACE =====")
    p.tp(5.0, 15.5, -47.6)
    p.wait(900)
    p.face(5, -50)
    p.shot("b9_lift_foot")
    p.say("  sleigh position:", p.js(
        "() => (CRESTBOUND.game.course.hazards||[]).filter(h => (h.kind||(h.def&&h.def.kind))==='mover')"
        ".map(h => h.mesh ? [+h.mesh.position.x.toFixed(2), +h.mesh.position.y.toFixed(2), +h.mesh.position.z.toFixed(2)] : null)"))
    # wait for the sleigh to be at the bottom, then board it
    for _ in range(40):
        m = p.js("() => { const h = (CRESTBOUND.game.course.hazards||[])"
                 ".find(h => (h.kind||(h.def&&h.def.kind))==='mover');"
                 " return h && h.mesh ? [+h.mesh.position.x.toFixed(2), +h.mesh.position.y.toFixed(2), +h.mesh.position.z.toFixed(2)] : null; }")
        if m and m[1] < 16.2:
            break
        p.wait(500)
    p.say("  sleigh at the bottom:", m)
    p.walk_to(m[0], m[2], tol=1.4, max_ms=7000, stop_on_card=False, tag="board the sleigh")
    p.wait(500)
    p.shot("b9_boarded")
    ride = []
    for _ in range(26):
        p.wait(900)
        ride.append(p.both())
    p.say("  lift ride y:", [x["pos"][1] for x in ride])
    p.say("  carried?:", [x["grounded"] for x in ride])
    p.say("  end of the ride:", ride[-1])
    p.shot("b9_lift_top")

    # the shelf, sigil 8
    p.tp(0, 40.8, -79.0)
    p.wait(900)
    p.face(0, -75)
    p.shot("b9_shelf")
    p.say("  shelf:", p.both())

    # RIDE THE FACE
    p.face(0, -60)
    p.down("W")
    face = []
    for _ in range(30):
        p.wait(220)
        face.append(p.both())
    p.say("  face states:", [x["pstate"] for x in face])
    p.say("  face y:", [round(x["pos"][1], 1) for x in face])
    p.say("  face z:", [round(x["pos"][2], 1) for x in face])
    p.shot("b9_riding_the_face")
    # jump at the kicker's lip
    p.tap("SPACE", 160)
    p.wait(1100)
    p.up("W")
    p.wait(1400)
    p.say("  after the kicker:", p.both())
    p.shot("b9_after_kicker")
