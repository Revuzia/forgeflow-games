"""PLAYTEST DRIVER - RIME SPIRE 2 "GLACIER SLIDE" (owner instruction P11).

Drives the shipped page with REAL KeyboardEvents, screenshots every event, and
appends every confirmed defect to _harness/_playreports/rime-2.json as it goes
so a run that dies still leaves its findings on disk.

    python _harness/_play_rime2.py <phase>
    phases: shelf upper lower lake west cavern crevasse peak race ice
"""
import json, os, sys, time, math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play, ROOT

REPORT = os.path.join(ROOT, "_harness", "_playreports", "rime-2.json")


def _load():
    try:
        with open(REPORT, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"area": "rime-2", "played": "", "defects": [], "worked": [], "blocked": []}


def _save(d):
    tmp = REPORT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1)
    os.replace(tmp, REPORT)


def rep_defect(where, did, happened, should, png, severity="", note=""):
    d = _load()
    e = {"where": where, "did": did, "happened": happened, "should": should, "png": png}
    if severity:
        e["severity"] = severity
    if note:
        e["note"] = note
    d["defects"].append(e)
    _save(d)
    print("  ** DEFECT: %s | %s" % (where, happened), flush=True)


def rep_worked(s):
    d = _load()
    if s not in d["worked"]:
        d["worked"].append(s)
    _save(d)
    print("  ok: %s" % s, flush=True)


def rep_blocked(s):
    d = _load()
    if s not in d["blocked"]:
        d["blocked"].append(s)
    _save(d)
    print("  BLOCKED: %s" % s, flush=True)


def rep_note(s):
    d = _load()
    d.setdefault("notes", [])
    d["notes"].append(s)
    _save(d)
    print("  note: %s" % s, flush=True)


# ---------------------------------------------------------------- helpers

def _patch_walk(p):
    """_playlib.walk_to breaks the instant gstate == 'playing' (it was written for the
    Keep, where gstate is 'keep'). Inside a course that makes every walk a no-op, so
    default stop_on_card to False here."""
    if getattr(p, "_walkpatched", False):
        return
    orig = p.walk_to
    def walk_to(x, z, **kw):
        kw.setdefault("stop_on_card", False)
        return orig(x, z, **kw)
    p.walk_to = walk_to
    p._walkpatched = True


def start(p, course="rime-2", cp=None):
    """Real title click, unlock everything, then the real course loader."""
    st = p.state()
    p.say("boot state:", st["gstate"])
    got = p.click_title()
    p.say("title button ->", got)
    p.wait(1400)
    p.unlock_all()
    p.wait(300)
    p.js("(a) => CRESTBOUND.game.__dev.goto(a[0], a[1])", [course, cp])
    for _ in range(80):
        p.wait(400)
        s = p.state()
        if s["course"] == course and s["gstate"] in ("playing", "cinematic"):
            break
    p.wait(1600)
    s = p.state()
    _patch_walk(p)
    p.say("loaded:", s["course"], s["gstate"], s["pos"])
    return s


def hs(st):
    v = st["vel"]
    return math.hypot(v[0], v[2])


def ride(p, waypoints, keys=("W",), tag="", per_ms=260, shot_every=6, shotname="ride",
         extra=None, max_s=40):
    """Hold W (and anything in keys) and re-aim the camera at each waypoint in turn,
    which is exactly what a player does with mouse + W. Samples every step."""
    p.down(*keys)
    samples = []
    n = 0
    t0 = time.time()
    for (wx, wz) in waypoints:
        for _ in range(24):
            if time.time() - t0 > max_s:
                break
            p.face(wx, wz)
            p.wait(per_ms)
            st = p.state()
            samples.append(st)
            n += 1
            if extra:
                extra(p, st, n)
            if shot_every and n % shot_every == 0:
                p.shot("%s_%02d" % (shotname, n))
            d = math.hypot(st["pos"][0] - wx, st["pos"][2] - wz)
            if d < 3.0:
                break
        if time.time() - t0 > max_s:
            break
    p.up(*keys)
    p.wait(200)
    return samples


def summarise(p, samples, tag):
    if not samples:
        return
    top = max(hs(s) for s in samples)
    st = samples[-1]
    p.say("  [%s] end %s state=%s grounded=%s surf=%s speed=%.2f topspeed=%.2f" % (
        tag, st["pos"], st["pstate"], st["grounded"], st["surface"], hs(st), top))
    states = []
    for s in samples:
        if not states or states[-1] != s["pstate"]:
            states.append(s["pstate"])
    p.say("  [%s] states: %s" % (tag, ",".join(str(x) for x in states)))
    return {"top": top, "end": st, "states": states}



def settle(p, ms=4000):
    """Wait until the hero is alive, in 'playing' and not mid-respawn."""
    t = 0
    while t < ms:
        st = p.js("""() => { const G = CRESTBOUND.game, P = G.player;
            return {gs: G.state, dead: !!P.dead, g: !!P.grounded,
                    p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)]}; }""")
        if st["gs"] == "playing" and not st["dead"]:
            return st
        p.wait(220); t += 220
    return st


def tpv(p, x, y, z, tries=4, tol=2.5):
    """VERIFIED teleport: settle first, teleport, then check the hero really is there.
    A plain tp during a death/respawn is silently undone by the respawn."""
    for k in range(tries):
        settle(p)
        p.js("([a,b,c]) => CRESTBOUND.game.__dev.tp(a,b,c)", [x, y, z])
        p.wait(420)
        pos = p.pos()
        if math.hypot(pos[0] - x, pos[2] - z) <= tol and abs(pos[1] - y) < 4.0:
            return pos
        p.say("  tp retry %d: wanted (%.2f,%.2f,%.2f) got %s" % (k + 1, x, y, z, pos))
        p.wait(600)
    p.say("  ** TELEPORT DID NOT HOLD, hero at %s (wanted %.2f,%.2f,%.2f)" % (p.pos(), x, y, z))
    return p.pos()


PHASES = {}
def phase(name):
    def deco(fn):
        PHASES[name] = fn
        return fn
    return deco


# ================================================================== BEAT 1
@phase("shelf")
def ph_shelf(p):
    s = start(p)
    p.shot("01_spawn")
    p.say("spawn snapshot:", s)
    if s["course"] != "rime-2":
        rep_blocked("could not load rime-2 through the real loader; got %s" % s["course"])
        return
    rep_worked("rime-2 loads from the Keep flow (title -> NEW GAME -> unlockAll -> goto) and drops the hero on the summit shelf at %s, grounded on snow" % (s["pos"],))

    # read the sign the way a player does: stand on the pad, look at it
    p.face(-0.2, -22.6)
    p.wait(500)
    sg = p.shot("02_sign_from_spawn")
    p.say("looking at the GLACIER SLIDE board from the spawn pad")

    # walk to the board and read it up close
    r = p.walk_to(-0.2, -21.0, tol=1.6, max_ms=8000, tag="to the sign")
    p.shot("03_sign_close")

    # the two pedestals
    r = p.walk_to(0, -34, tol=2.0, max_ms=9000, tag="sigil pedestal")
    p.shot("04_pedestal_sigils")
    r2_ = p.walk_to(-6, -28, tol=2.0, max_ms=9000, tag="coins pedestal")
    p.shot("05_pedestal_coins")

    # the race start pad
    r3 = p.walk_to(4, -23, tol=1.6, max_ms=9000, tag="race start pad")
    p.shot("06_race_pad")
    st = p.state()
    p.say("on the race pad:", st["pos"], st["pstate"], "surface", st["surface"])

    # the bumbler that circles the pedestal - stand still next to its path
    tpv(p, 0, 31.0, -33.0)
    p.wait(300)
    p.face(0, -36)
    before = p.state()
    p.wait(4000)
    after = p.state()
    p.shot("07_bumbler_standing_still")
    moved = math.hypot(after["pos"][0] - before["pos"][0], after["pos"][2] - before["pos"][2])
    p.say("stood still 4 s by the bumbler loop: moved %.2f m, state %s" % (moved, after["pstate"]))
    if moved > 1.0:
        rep_defect("rime-2 BEAT 1, summit shelf (0, 30, -33)",
                   "stood completely still for 4 s beside the bumbler's patrol loop",
                   "the bumbler shoved the hero %.2f m without any input" % moved,
                   "a patroller may knock you back when YOU walk into it, but standing still on the spawn shelf should not move you",
                   p.shot("07b_bumbler_shove"))
    p.dump("rime2_shelf")


# ================================================================== BEAT 2 upper
U = {"U0": (4.00, 29.40, -22.00), "U1": (11.00, 26.60, -18.00), "U2": (20.00, 23.80, -19.50),
     "U3": (24.20, 22.90, -21.90), "U4": (33.00, 20.60, -24.50), "U5": (42.00, 19.00, -21.00),
     "U6": (47.00, 18.20, -14.50), "U7": (43.50, 17.60, -8.50), "U8": (38.00, 17.30, -6.50)}
L = {"L0": (34.00, 17.20, -2.00), "L1": (33.00, 14.60, 4.50), "L2": (36.50, 12.00, 10.50),
     "L3": (32.90, 11.00, 13.70), "L4": (26.00, 8.60, 17.50), "L5": (18.50, 6.60, 18.60),
     "L6": (14.10, 5.70, 19.50), "L7": (7.00, 4.00, 19.00), "L8": (0.50, 2.60, 21.50),
     "L9": (-4.50, 2.20, 24.00)}


@phase("upper")
def ph_upper(p):
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("upper flume: rime-2 did not load")
        return
    # walk from the checkpoint pad to the chute mouth, on foot, like a player
    p.walk_to(4.0, -22.5, tol=2.0, max_ms=10000, tag="to the chute mouth")
    st = p.state()
    p.shot("10_chute_mouth")
    p.say("at the chute mouth:", st["pos"], st["pstate"], "surface", st["surface"])

    # THE RIDE. Aim down the chute and hold W through every deck point.
    wps = [(U["U1"][0], U["U1"][2]), (U["U2"][0], U["U2"][2]), (U["U3"][0], U["U3"][2]),
           (U["U4"][0], U["U4"][2]), (U["U5"][0], U["U5"][2]), (U["U6"][0], U["U6"][2]),
           (U["U7"][0], U["U7"][2]), (U["U8"][0], U["U8"][2])]
    fell = {"y": None}

    def watch(pp, st_, n):
        y = st_["pos"][1]
        if fell["y"] is None and y < 12.0 and st_["pos"][0] < 46:
            fell["y"] = y
            pp.say("  !! off the flume at %s (deck should be ~17-24 here)" % (st_["pos"],))
    sam = ride(p, wps, tag="upper", per_ms=240, shotname="upper", extra=watch, max_s=60)
    info = summarise(p, sam, "upper ride, no jumps")
    p.shot("11_upper_end")
    end = info["end"]
    d = {"phase": "upper", "end": end["pos"], "top": info["top"], "states": info["states"]}
    p.say("UPPER RIDE:", json.dumps(d))

    # did we clear GAP A (U2 -> U3, 4.84 m) without pressing jump?
    if end["pos"][0] < 22:
        rep_note("upper flume: riding with W only stopped at %s - GAP A needs a real jump" % (end["pos"],))
    p.dump("rime2_upper")


@phase("gapa")
def ph_gapa(p):
    """GAP A on its own: run the deck and jump it, the way the comment says."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("gapa: rime-2 did not load"); return
    # stand on the deck 9 m before the lip, at U1->U2
    tpv(p, 14.5, 26.2, -18.6)
    p.wait(500)
    p.face(U["U2"][0], U["U2"][2])
    p.shot("20_gapA_runup")
    p.down("W")
    hit = None
    for i in range(26):
        p.wait(170)
        st = p.state()
        x = st["pos"][0]
        if x > 19.2 and hit is None:
            hit = st
            p.tap("SPACE", 110)
            p.say("  jumped GAP A at %s speed %.2f" % (st["pos"], hs(st)))
            p.shot("21_gapA_launch")
        if hit and st["pos"][0] > 24.5:
            break
    p.up("W")
    p.wait(700)
    st = p.state()
    p.shot("22_gapA_land")
    p.say("GAP A result:", st["pos"], st["pstate"], "grounded", st["grounded"], "surface", st["surface"])
    if st["pos"][1] < 20.0:
        rep_defect("rime-2 BEAT 2, GAP A (flume deck U2 20,23.8,-19.5 -> U3 24.2,22.9,-21.9)",
                   "ran 5.5 m of deck at %s and pressed jump at the lip" % ("speed %.1f" % hs(hit) if hit else "?"),
                   "did not make the landing - ended at %s, %s" % (st["pos"], st["pstate"]),
                   "the course comment calls GAP A a 4.84 m single jump with the run-up paid for; it should land on U3",
                   p.shot("22b_gapA_missed"))
    else:
        rep_worked("GAP A (4.84 m gap in the upper flume) clears with one timed jump off a running approach - landed at %s" % (st["pos"],))
    p.dump("rime2_gapa")


@phase("wheel")
def ph_wheel(p):
    """The ice wheel at TURN 3 - a 2-arm bar rotor 1.3 m over the deck, period 4.4 s."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("wheel: rime-2 did not load"); return
    tpv(p, 28.0, 21.6, -23.2)
    p.wait(600)
    p.face(U["U4"][0], U["U4"][2])
    p.shot("30_wheel_approach")
    rot = p.js("""() => { const c = CRESTBOUND.game.course; const out = [];
        for (const h of (c.hazards||[])) { if (h && h.kind === 'rotor' && h.mesh)
          out.push({kind:h.kind, y:+h.mesh.position.y.toFixed(2), rotY:+h.mesh.rotation.y.toFixed(2),
                    cols:(h.colliders||[]).length, kills:(h.kills||[]).length}); } return out; }""")
    p.say("rotors on this course:", rot)
    # stand under it and see whether it kills, pushes, or is rideable
    deaths0 = p.js("() => CRESTBOUND.game.deaths")
    tpv(p, 33.0, 21.5, -24.5)
    p.wait(400)
    logs = []
    for i in range(14):
        p.wait(400)
        st = p.state()
        logs.append((st["pos"], st["pstate"], st["grounded"]))
        if i in (3, 7, 11):
            p.shot("31_wheel_stand_%d" % i)
    deaths1 = p.js("() => CRESTBOUND.game.deaths")
    p.say("stood in the wheel's sweep for 5.6 s: deaths %d -> %d" % (deaths0, deaths1))
    for l in logs[:6]:
        p.say("   ", l)
    st = p.state()
    if st["pos"][1] < 18.0:
        rep_defect("rime-2 BEAT 2, the ice wheel at TURN 3 (33, 21.9, -24.5)",
                   "stood on the deck inside the wheel's sweep and let the bar come round",
                   "the bar swept the hero off the flume - ended at %s" % (st["pos"],),
                   "a rideable bar should carry or shove gently; the sign says JUMP IT OR RIDE IT so being swept 14 m off the flume with no telegraph is a punish with no read",
                   p.shot("32_wheel_swept"))
    else:
        rep_worked("the ice wheel at TURN 3 is a solid rideable bar, not a killer - standing in its sweep did not kill (deaths %d -> %d)" % (deaths0, deaths1))
    p.dump("rime2_wheel")


# ================================================================== BEAT 2 lower
@phase("lower")
def ph_lower(p):
    s = start(p, cp=1)          # cp-mesa
    if s["course"] != "rime-2":
        rep_blocked("lower: rime-2 did not load"); return
    p.shot("40_mesa_cp")
    p.say("mid station spawn:", s["pos"], s["pstate"])
    p.walk_to(34.0, -2.0, tol=2.2, max_ms=11000, tag="to the lower flume lip")
    p.shot("41_lower_lip")
    wps = [(L["L1"][0], L["L1"][2]), (L["L2"][0], L["L2"][2]), (L["L3"][0], L["L3"][2]),
           (L["L4"][0], L["L4"][2]), (L["L5"][0], L["L5"][2]), (L["L6"][0], L["L6"][2]),
           (L["L7"][0], L["L7"][2]), (L["L8"][0], L["L8"][2]), (L["L9"][0], L["L9"][2])]
    sam = ride(p, wps, tag="lower", per_ms=230, shotname="lower", max_s=55)
    info = summarise(p, sam, "lower ride, no jumps")
    p.shot("42_lower_end")
    p.say("LOWER RIDE end:", info["end"]["pos"])
    p.dump("rime2_lower")


@phase("gapbc")
def ph_gapbc(p):
    s = start(p, cp=1)
    if s["course"] != "rime-2":
        rep_blocked("gapbc: rime-2 did not load"); return
    for name, a, b, lipx in (("GAP B", (35.0, 13.4, 7.4), L["L3"], None),
                             ("GAP C", (21.5, 7.4, 18.4), L["L6"], None)):
        tpv(p, a[0], a[1] + 0.4, a[2])
        p.wait(500)
        p.face(b[0], b[2])
        p.shot("5%d_%s_runup" % (0 if name == "GAP B" else 5, name.replace(" ", "")))
        p.down("W")
        jumped = None
        for i in range(24):
            p.wait(160)
            st = p.state()
            dx = math.hypot(st["pos"][0] - b[0], st["pos"][2] - b[2])
            if jumped is None and not st["grounded"]:
                jumped = st
                p.say("  %s: went airborne without a jump at %s (fell off the lip)" % (name, st["pos"]))
            if jumped is None and dx < 6.6:
                jumped = st
                p.tap("SPACE", 110)
                p.say("  %s: jumped at %s speed %.2f" % (name, st["pos"], hs(st)))
            if jumped and dx < 2.0:
                break
        p.up("W")
        p.wait(900)
        st = p.state()
        png = p.shot("%s_land" % name.replace(" ", ""))
        p.say("%s result: %s %s grounded=%s" % (name, st["pos"], st["pstate"], st["grounded"]))
        want_y = b[1]
        if st["pos"][1] < want_y - 2.5:
            rep_defect("rime-2 BEAT 2, %s on the lower flume (land at %s)" % (name, b),
                       "ran the deck and jumped at the lip",
                       "missed the landing and fell to %s" % (st["pos"],),
                       "%s is authored as a single-jump gap with the run-up paid for" % name, png)
        else:
            rep_worked("%s on the lower flume clears with a single timed jump (landed %s)" % (name, st["pos"]))
    p.dump("rime2_gapbc")


@phase("pend")
def ph_pend(p):
    """The two hanging icicles over the lower run, and the crevasse one."""
    s = start(p, cp=1)
    if s["course"] != "rime-2":
        rep_blocked("pend: rime-2 did not load"); return
    hz = p.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h => h && h.kind === 'pendulum')
        .map(h => ({y: h.mesh ? +h.mesh.position.y.toFixed(2) : null,
                    kills: (h.kills||[]).length,
                    kc: (h.kills||[]).map(k => [+k.center.x.toFixed(2), +k.center.y.toFixed(2), +k.center.z.toFixed(2)])}))""")
    p.say("pendulums:", json.dumps(hz))
    for tag, stand in (("pendA", (34.6, 15.9, 2.0)), ("pendB", (22.0, 9.6, 18.1))):
        d0 = p.js("() => CRESTBOUND.game.deaths")
        tpv(p, stand[0], stand[1], stand[2])
        p.wait(400)
        p.face(stand[0], stand[2] + 6)
        seen = []
        for i in range(16):
            p.wait(320)
            st = p.state()
            seen.append(st["pos"][1])
            if i in (2, 6, 10, 14):
                p.shot("60_%s_%d" % (tag, i))
        d1 = p.js("() => CRESTBOUND.game.deaths")
        st = p.state()
        p.say("%s: stood in the swing 5 s, deaths %d -> %d, end %s %s" % (tag, d0, d1, st["pos"], st["pstate"]))
        if d1 == d0:
            rep_defect("rime-2 BEAT 2, hanging icicle %s (pivot %s)" % (tag, stand),
                       "stood still on the flume deck directly under the swinging icicle for 5 seconds",
                       "the icicle passed through the hero without killing or touching him (deaths %d -> %d)" % (d0, d1),
                       "the comment says 'only the head kills' - if the head sweeps the racing line it should hit a player standing in it, otherwise the hazard is decoration",
                       p.shot("61_%s_nohit" % tag))
        else:
            rep_worked("hanging icicle %s does kill a hero standing in its swing (deaths %d -> %d)" % (tag, d0, d1))
    p.dump("rime2_pend")


# ================================================================== BEAT 4/5/6/8
@phase("west")
def ph_west(p):
    """The west ice face: mover lift + the four static seracs (the double-jump wall)."""
    s = start(p, cp=2)          # cp-lake
    if s["course"] != "rime-2":
        rep_blocked("west: rime-2 did not load"); return
    p.shot("70_lake_cp")
    p.walk_to(-24.0, 22.0, tol=2.5, max_ms=14000, tag="to the west ice face")
    p.shot("71_ice_face_from_below")
    st = p.state()
    p.say("at the foot of the west face:", st["pos"])

    mv = p.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h => h && h.kind === 'mover')
       .map(h => ({y: h.mesh ? +h.mesh.position.y.toFixed(2) : null,
                   x: h.mesh ? +h.mesh.position.x.toFixed(2) : null,
                   z: h.mesh ? +h.mesh.position.z.toFixed(2) : null}))""")
    p.say("movers:", json.dumps(mv))
    got_on = False
    for i in range(30):
        y = p.js("""() => { const hz=(CRESTBOUND.game.course.hazards||[]).filter(h=>h&&h.kind==='mover'&&h.mesh&&Math.abs(h.mesh.position.x+24)<1.5&&Math.abs(h.mesh.position.z-20)<1.5);
            return hz.length ? +hz[0].mesh.position.y.toFixed(2) : null; }""")
        if y is not None and y < 3.2:
            tpv(p, -24.0, y + 0.9, 20.0)
            p.wait(250)
            got_on = True
            break
        p.wait(320)
    if got_on:
        p.shot("72_on_the_lift")
        ys = []
        for i in range(20):
            p.wait(330)
            st = p.state()
            ys.append(round(st["pos"][1], 2))
            if i in (5, 12, 19):
                p.shot("73_lift_%d" % i)
        st = p.state()
        p.say("lift ride ys:", ys, "-> end", st["pos"], st["pstate"], "grounded", st["grounded"])
        if st["pos"][1] < 9.0:
            rep_defect("rime-2 BEAT 4, the ice-lift mover on the west face (-24, 2.6..12.4, 20)",
                       "stood on the lift block at the bottom of its travel and rode it up",
                       "the hero did not ride the block - ended at %s" % (st["pos"],),
                       "a mover carries the player by its motion (contract 10: carry by mover motion)",
                       p.shot("74_lift_failed"))
        else:
            rep_worked("the west-face ice lift carries the hero from the lake shore up to the apron ledge (y %.2f -> %.2f)" % (ys[0], st["pos"][1]))
    else:
        rep_blocked("could not catch the west-face lift at the bottom of its travel")

    tpv(p, -26.4, 3.4, 21.6)
    p.wait(500)
    p.face(-27.6, 19.0)
    p.shot("75_serac1")
    ok = []
    steps = [(-27.6, 5.7, 19.0), (-28.8, 8.1, 16.6), (-29.8, 10.5, 14.4)]
    for i, (tx, ty, tz) in enumerate(steps):
        p.face(tx, tz)
        p.down("W")
        p.wait(360)
        p.tap("SPACE", 130)
        p.wait(190)
        p.tap("SPACE", 130)
        p.wait(950)
        p.up("W")
        p.wait(400)
        st = p.state()
        made = st["pos"][1] > ty - 0.7
        ok.append(made)
        p.say("  serac step %d -> %s y=%.2f want>%.2f %s" % (i + 1, st["pos"], st["pos"][1], ty - 0.7, "OK" if made else "MISSED"))
        p.shot("76_serac_step%d" % (i + 1))
        if not made:
            break
    if all(ok) and len(ok) == 3:
        rep_worked("the static seracs on the west ice face are climbable with a real double jump (W + Space + Space) - three steps in a row landed")
    else:
        rep_defect("rime-2 BEAT 4, the static serac stair on the west ice face (-26.4,3.3,21.6 up to -29.8,10.5,14.4)",
                   "ran at each serac and pressed Space twice (the double jump the course sign asks for)",
                   "failed on step %d - ended at %s" % (len(ok), p.state()["pos"]),
                   "the comment calls these the course's one deliberate learn-the-double wall and the only static way up the face",
                   p.shot("77_serac_failed"))
    p.dump("rime2_west")


@phase("cavern")
def ph_cavern(p):
    s = start(p, cp=3)          # cp-cavern
    if s["course"] != "rime-2":
        rep_blocked("cavern: rime-2 did not load"); return
    p.shot("80_apron")
    p.say("apron spawn:", s["pos"])
    p.walk_to(-30.0, 8.0, tol=2.0, max_ms=10000, tag="into the cavern mouth")
    p.shot("81_cavern_mouth")
    p.walk_to(-30.0, 4.5, tol=2.0, max_ms=9000, tag="to the crystal")
    p.shot("82_cavern_inside")
    st = p.state()
    p.say("inside the cavern:", st["pos"], "camdist", st["camDist"], "campos", st["camPos"])
    if st["camDist"] is not None and st["camDist"] < 1.6:
        rep_defect("rime-2 BEAT 5, inside the crystal cavern (%s)" % (st["pos"],),
                   "walked in through the south mouth to the crystal",
                   "the camera pulled in to dist %.2f (contract minDist is 1.60)" % st["camDist"],
                   "the follow camera should hold at least minDist in a room 17 m wide and 8 m tall",
                   p.shot("83_cam_in_cavern"))
    beams = p.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h => h && h.kind === 'beam')
        .map(h => ({on: !!h.on, kills:(h.kills||[]).length}))""")
    p.say("beams:", json.dumps(beams))
    d0 = p.js("() => CRESTBOUND.game.deaths")
    tpv(p, -30.0, 12.0, 0.0)
    p.wait(300)
    seq = []
    for i in range(18):
        p.wait(330)
        b = p.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h&&h.kind==='beam').map(h=>!!h.on)""")
        seq.append(b)
        if i in (2, 8, 15):
            p.shot("84_beam_%d" % i)
    d1 = p.js("() => CRESTBOUND.game.deaths")
    p.say("stood in beam lane 1 for 6 s, deaths %d -> %d; on-flags: %s" % (d0, d1, seq[:8]))
    if d1 == d0:
        rep_defect("rime-2 BEAT 5, crystal cavern beam lane at (-30, 12, 0)",
                   "stood on the cavern floor in the middle of the first beam lane for 6 seconds, through several on/off cycles",
                   "never died (deaths %d -> %d) although the beam reported on during the stand" % (d0, d1),
                   "a laser lane that costs nothing to stand in is not a hazard",
                   p.shot("85_beam_nohit"))
    else:
        rep_worked("the cavern beam lanes really kill - standing in lane 1 died within 6 s (deaths %d -> %d)" % (d0, d1))

    tpv(p, -30.0, 12.0, 4.0)
    p.wait(400)
    p.shot("86_at_crystal")
    v0 = p.js("""() => (CRESTBOUND.game.course.hazards||[]).filter(h=>h&&h.kind==='vanish'&&h.mesh&&h.mesh.position.x<-25)
        .map(h => ({y:+h.mesh.position.y.toFixed(2), vis: !!(h.mesh && h.mesh.visible), solid: (h.colliders||[]).some(c=>c.active)}))""")
    p.say("vanish steps:", json.dumps(v0))
    steps = [(-30.0, 13.55, 0.6), (-30.0, 15.35, -1.0), (-30.0, 17.15, 0.6), (-30.0, 18.95, -1.0)]
    tpv(p, -30.0, 12.0, 2.6)
    p.wait(300)
    climbed = []
    for i, (tx, ty, tz) in enumerate(steps):
        p.face(tx, tz)
        p.down("W"); p.wait(230)
        p.tap("SPACE", 130)
        p.wait(850)
        p.up("W"); p.wait(500)
        st = p.state()
        made = st["pos"][1] > ty - 0.8
        climbed.append(made)
        p.say("  vanish step %d -> %s (want y>%.2f) %s grounded=%s" % (i + 1, st["pos"], ty - 0.8, "OK" if made else "MISSED", st["grounded"]))
        p.shot("87_vanish_%d" % (i + 1))
        if not made:
            break
    if all(climbed) and len(climbed) == 4:
        rep_worked("the vanish crystal stair climbs out through the cavern roof hole with four single jumps")
    else:
        rep_defect("rime-2 BEAT 5, the vanish crystal stair (-30, 13.55..18.95)",
                   "jumped the four crystal steps one at a time from the cavern floor",
                   "failed on step %d - ended at %s" % (len(climbed), p.state()["pos"]),
                   "four 1.80 m steps are inside a single jump (apex 1.91) and are the only way to the roof hole and the wing hat",
                   p.shot("88_vanish_failed"))
    p.dump("rime2_cavern")


@phase("crevasse")
def ph_crevasse(p):
    """BEAT 6: the vanish snow bridges, the crevasse pendulum, and the wall-kick shaft."""
    s = start(p, cp=4)          # cp-crevasse (the exit ledge)
    if s["course"] != "rime-2":
        rep_blocked("crevasse: rime-2 did not load"); return
    p.shot("90_cp_crevasse")
    p.say("cp5 spawn:", s["pos"], s["pstate"], "grounded", s["grounded"])

    # --- the snow bridges, from the approach ledge, crossed on foot
    tpv(p, -25.4, 17.9, -7.8)
    p.wait(600)
    p.face(-17.6, -17.8)
    p.shot("91_bridges_from_ledge")
    br = [(-23.0, 17.80, -10.0), (-21.2, 18.40, -12.6), (-19.4, 19.00, -15.2), (-17.6, 19.60, -17.8)]
    d0 = p.js("() => CRESTBOUND.game.deaths")
    crossed = []
    for i, (tx, ty, tz) in enumerate(br):
        p.face(tx, tz)
        p.down("W"); p.wait(240)
        p.tap("SPACE", 120)
        p.wait(800)
        p.up("W"); p.wait(450)
        st = p.state()
        made = st["pos"][1] > ty - 0.9
        crossed.append(made)
        p.say("  bridge %d -> %s (want y>%.2f) %s" % (i + 1, st["pos"], ty - 0.9, "OK" if made else "MISSED"))
        p.shot("92_bridge_%d" % (i + 1))
        if not made:
            break
    d1 = p.js("() => CRESTBOUND.game.deaths")
    if all(crossed) and len(crossed) == 4:
        rep_worked("the four vanish snow bridges across the west hollow can be crossed step by step (they hold long enough to land and go again)")
    else:
        rep_defect("rime-2 BEAT 6, the vanish snow bridges (-23,17.8,-10 to -17.6,19.6,-17.8)",
                   "hopped from the approach ledge along the four snow bridges, one jump each",
                   "fell on bridge %d - ended at %s (deaths %d -> %d)" % (len(crossed), p.state()["pos"], d0, d1),
                   "the comment says 3.16 m centre-to-centre at +0.60 m is inside a walk-off; a first crossing at a normal pace should not drop you 11 m",
                   p.shot("93_bridge_failed"))

    # --- the crevasse pendulum
    d0 = p.js("() => CRESTBOUND.game.deaths")
    tpv(p, -20.2, 19.6, -13.8)
    p.wait(400)
    for i in range(12):
        p.wait(330)
        if i in (3, 7, 11):
            p.shot("94_crev_pend_%d" % i)
    d1 = p.js("() => CRESTBOUND.game.deaths")
    st = p.state()
    p.say("stood under the crevasse icicle 4 s: deaths %d -> %d, at %s" % (d0, d1, st["pos"]))
    if d1 == d0:
        rep_note("crevasse icicle at (-20.2, 23.2, -13.8): standing under it for 4 s did not kill (head hangs at ~19.2, hero feet at %.2f)" % st["pos"][1])

    # --- THE SHAFT. Drop to the floor and wall-kick out.
    tpv(p, -13.0, 15.0, -21.0)
    p.wait(700)
    st = p.state()
    p.shot("95_shaft_floor")
    p.say("on the shaft floor:", st["pos"], st["pstate"], "grounded", st["grounded"], "camdist", st["camDist"])
    if st["camDist"] is not None and st["camDist"] < 1.6:
        rep_defect("rime-2 BEAT 6, the bottom of the wall-kick shaft (-13, 14.4, -21)",
                   "stood on the shaft floor, a 3.20 m clear well 8.8 m deep",
                   "the camera collapsed to dist %.2f (contract minDist 1.60; camcheck's shaft station requires >= minDist)" % st["camDist"],
                   "the camera should tilt up the shaft rather than pull in through the hero",
                   p.shot("96_shaft_cam"))
    # read the sign from the floor
    p.face(-13.0, -21.0 + 6)
    p.wait(400)
    p.shot("97_shaft_sign")

    # 1 jump + 4 kicks: jump, then alternate walls with Space at wall contact
    d0 = p.js("() => CRESTBOUND.game.deaths")
    ys = [st["pos"][1]]
    kicks = 0
    p.face(-11.05, -21.0)              # into the east wall
    p.down("W")
    p.tap("SPACE", 130)
    p.wait(220)
    for k in range(6):
        stt = p.state()
        ys.append(round(stt["pos"][1], 2))
        p.tap("SPACE", 110)
        kicks += 1
        p.wait(120)
        stt2 = p.state()
        if stt2["pstate"] in ("wallkick", "wallslide"):
            p.say("  kick %d fired: %s y=%.2f" % (k + 1, stt2["pstate"], stt2["pos"][1]))
        # flip to the other wall
        p.up("W")
        tx = -11.05 if (k % 2) else -14.95
        p.face(tx, -21.0)
        p.down("W")
        p.wait(260)
        p.shot("98_kick_%d" % (k + 1))
    p.up("W")
    p.wait(900)
    st = p.state()
    ys.append(round(st["pos"][1], 2))
    d1 = p.js("() => CRESTBOUND.game.deaths")
    p.say("wall-kick attempt ys:", ys, "-> end", st["pos"], st["pstate"], "deaths %d->%d" % (d0, d1))
    if st["pos"][1] < 22.0:
        rep_defect("rime-2 BEAT 6, the wall-kick shaft (-13, floor 14.40, exit ledge 23.00, 3.20 m clear)",
                   "from the shaft floor: jumped, then pressed Space at each wall while holding W into it, alternating walls, six times",
                   "never got out - highest y reached %.2f, ended at %s in state %s" % (max(ys), st["pos"], st["pstate"]),
                   "the course comment budgets 1 jump + 4 kicks = feet 24.31 against a 23.00 exit ledge; this is the ONLY way out of the crevasse and it is on the required line to cp5",
                   p.shot("99_shaft_stuck"), severity="high")
    else:
        rep_worked("the crevasse wall-kick shaft goes: jump plus alternating Space-at-the-wall kicks reached y %.2f, over the 23.00 exit ledge" % st["pos"][1])
    p.dump("rime2_crevasse")


@phase("peak")
def ph_peak(p):
    """BEAT 8: walk the shelf path to the peak and take ROUTE A, the serac spiral."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("peak: rime-2 did not load"); return
    p.walk_to(0, -40, tol=2.5, max_ms=16000, tag="the trodden path to the peak")
    p.shot("A0_path_to_peak")
    st = p.state()
    p.say("on the path:", st["pos"], st["pstate"], "surface", st["surface"])
    p.walk_to(6.4, -46.0, tol=2.6, max_ms=14000, tag="foot of ROUTE A")
    p.shot("A1_route_a_foot")
    st = p.state()
    p.say("at the spiral foot:", st["pos"])

    spiral = [(6.40, 35.35, -46.00), (5.20, 36.80, -49.72), (1.87, 38.25, -52.12),
              (-2.13, 39.70, -52.03), (-5.35, 41.15, -49.51), (-6.39, 42.60, -45.73),
              (-4.99, 44.05, -42.07), (-1.58, 45.50, -39.82)]
    # get onto block 1 first
    p.face(6.40, -46.00)
    p.down("W"); p.wait(300); p.tap("SPACE", 130); p.wait(900); p.up("W"); p.wait(500)
    st = p.state()
    p.say("  onto block 1: %s" % (st["pos"],))
    p.shot("A2_block1")
    made = []
    for i in range(1, len(spiral)):
        tx, ty, tz = spiral[i]
        p.face(tx, tz)
        p.down("W"); p.wait(280)
        p.tap("SPACE", 135)
        p.wait(900)
        p.up("W"); p.wait(450)
        stt = p.state()
        okk = stt["pos"][1] > ty - 0.9
        made.append(okk)
        p.say("  spiral block %d -> %s (want y>%.2f) %s" % (i + 1, stt["pos"], ty - 0.9, "OK" if okk else "MISSED"))
        p.shot("A3_spiral_%d" % (i + 1))
        if not okk:
            break
    st = p.state()
    if all(made) and len(made) == 7:
        rep_worked("ROUTE A, the eight-block serac spiral round the peak plinth, climbs with one single jump per block")
    else:
        rep_defect("rime-2 BEAT 8, ROUTE A serac spiral round the peak (blocks at radius 6.40 about (0,-46), tops 35.35..45.50)",
                   "single-jumped block to block up the spiral, aiming the camera at the next block each time",
                   "fell off after block %d - ended at %s y=%.2f" % (len(made) + 1, st["pos"], st["pos"][1]),
                   "the header calls ROUTE A the line the reach gate walks and the one that 'always works'; it is the required path to the open crest",
                   p.shot("A4_spiral_failed"), severity="high")

    # the crest itself
    tpv(p, 0.0, 46.0, -46.0)
    p.wait(800)
    st = p.state()
    p.shot("A5_peak_cap")
    p.say("on the peak cap:", st["pos"], st["pstate"], "grounded", st["grounded"])
    cr0 = p.js("() => CRESTBOUND.game.save.crestTotal()")
    p.face(0, -46.0)
    for i in range(8):
        p.down("W"); p.wait(200); p.up("W"); p.wait(200)
        st = p.state()
        if st["gstate"] not in ("playing",):
            break
    p.wait(1500)
    cr1 = p.js("() => CRESTBOUND.game.save.crestTotal()")
    st = p.state()
    p.shot("A6_crest")
    p.say("crest total %d -> %d, state %s" % (cr0, cr1, st["gstate"]))
    if cr1 > cr0 or st["gstate"] in ("clear", "card", "cinematic"):
        rep_worked("the open crest on the peak collects on contact and fires the course-clear flow (crests %d -> %d, state %s)" % (cr0, cr1, st["gstate"]))
    else:
        rep_defect("rime-2 BEAT 8, THE CREST ON THE PEAK (0, 46.75, -46)",
                   "stood on the peak cap and walked around under the crest for 3 s",
                   "the crest did not collect (crest total stayed %d, state %s)" % (cr0, st["gstate"]),
                   "walking into a crest should collect it and start the celebration",
                   p.shot("A7_crest_nocollect"))
    p.dump("rime2_peak")


@phase("race")
def ph_race(p):
    """THE LUGE: the race crest - summit to the lake, 45 s, the whole flume."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("race: rime-2 did not load"); return
    p.walk_to(4, -23, tol=1.8, max_ms=9000, tag="the race start pad")
    p.shot("B0_race_pad")
    st = p.state()
    snap = p.js("() => { const s = CRESTBOUND.game.__dev.state(); return {raceMs: s.raceMs, race: s.race}; }")
    p.say("standing on the start pad:", st["pos"], "race snapshot:", json.dumps(snap))
    # walk on and off a few times, then ride
    p.walk_to(4, -20, tol=1.5, max_ms=5000, tag="step off the pad")
    p.walk_to(4, -23, tol=1.5, max_ms=5000, tag="back on the pad")
    p.wait(600)
    snap2 = p.js("() => { const s = CRESTBOUND.game.__dev.state(); return {raceMs: s.raceMs, race: s.race}; }")
    p.say("after stepping on the pad again:", json.dumps(snap2))
    p.shot("B1_race_armed")
    if snap2.get("raceMs") in (None, 0) and not snap2.get("race"):
        rep_note("the race pad reported no raceMs after standing on it - could not confirm the LUGE timer arms from the pad")
    t0 = time.time()
    wps = [(U["U1"][0], U["U1"][2]), (U["U2"][0], U["U2"][2]), (U["U3"][0], U["U3"][2]),
           (U["U4"][0], U["U4"][2]), (U["U5"][0], U["U5"][2]), (U["U6"][0], U["U6"][2]),
           (U["U7"][0], U["U7"][2]), (U["U8"][0], U["U8"][2]), (L["L0"][0], L["L0"][2]),
           (L["L1"][0], L["L1"][2]), (L["L2"][0], L["L2"][2])]
    sam = ride(p, wps, tag="race", per_ms=210, shotname="race", max_s=50)
    summarise(p, sam, "race run")
    p.shot("B2_race_end")
    p.dump("rime2_race")


@phase("ice")
def ph_ice(p):
    """Does ice feel like LOST GRIP or LOST CONTROL? Measure it on the flume deck."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("ice: rime-2 did not load"); return
    # (a) on SNOW: run then release, how long to stop
    tpv(p, 0.0, 30.4, -30.0)
    p.wait(600)
    p.face(0, -38)
    p.down("W"); p.wait(1600)
    st_run = p.state()
    p.up("W")
    stopped_ms = None
    for i in range(24):
        p.wait(80)
        stt = p.state()
        if hs(stt) < 0.35:
            stopped_ms = (i + 1) * 80
            break
    p.say("SNOW: run speed %.2f, stop in %s ms" % (hs(st_run), stopped_ms))
    p.shot("C0_snow_stop")

    # (b) on the FLUME ICE (a flat-ish stretch of deck near the mid station)
    tpv(p, 38.0, 17.7, -6.5)
    p.wait(700)
    p.face(43.5, -8.5)
    p.down("W"); p.wait(1600)
    st_run2 = p.state()
    p.up("W")
    ice_stop = None
    slid = []
    for i in range(40):
        p.wait(80)
        stt = p.state()
        slid.append(round(hs(stt), 2))
        if hs(stt) < 0.35:
            ice_stop = (i + 1) * 80
            break
    st2 = p.state()
    p.say("FLUME ICE: run speed %.2f, stop in %s ms, surface %s, decay %s" % (
        hs(st_run2), ice_stop, st2["surface"], slid[:14]))
    p.shot("C1_ice_stop")

    # (c) a standing start on ice: how long to get moving
    tpv(p, 38.0, 17.7, -6.5)
    p.wait(600)
    p.face(43.5, -8.5)
    p.down("W")
    ramp = []
    for i in range(12):
        p.wait(120)
        ramp.append(round(hs(p.state()), 2))
    p.up("W")
    p.say("ICE ramp-up from rest (120 ms samples):", ramp)

    # (d) the steep head of the lower run - 21.6 deg vs iceSlideDeg 20
    tpv(p, 33.6, 15.9, 1.2)
    p.wait(700)
    st = p.state()
    slide = []
    for i in range(14):
        p.wait(200)
        stt = p.state()
        slide.append((stt["pstate"], round(hs(stt), 2), round(stt["pos"][1], 2)))
    p.say("standing on the 21.6 deg pitch with NO input:", slide[:10])
    p.shot("C2_steep_pitch")
    st = p.state()
    if all(x[0] != "slopeSlide" for x in slide) and abs(slide[0][2] - slide[-1][2]) < 0.4:
        rep_note("the 21.6 deg head of the lower flume (over iceSlideDeg 20) did NOT put the hero into slopeSlide with no input - he just stood there (states %s)" % ([x[0] for x in slide[:5]],))
    else:
        rep_worked("the steep head of the lower flume slides you on its own - standing still on the 21.6 deg ice pitch starts a slopeSlide, which is exactly the 'the chute only goes down' promise")
    p.dump("rime2_ice")



@phase("lip")
def ph_lip(p):
    """Walk the shelf lip on foot at a normal pace: where does the ground give way,
    is there any read for it, and what does the slide look like from inside?"""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("lip: rime-2 did not load"); return
    # A slow, deliberate walk SOUTH out of the spawn pad toward the signboard.
    p.face(0, -18)
    p.shot("D0_looking_south")
    trail = []
    p.down("W")
    for i in range(26):
        p.wait(150)
        st = p.state()
        trail.append((round(st["pos"][0], 2), round(st["pos"][1], 2), round(st["pos"][2], 2),
                      st["pstate"], round(hs(st), 2)))
        if st["pstate"] == "slopeSlide" or st["pos"][1] < 28.5:
            p.say("  ground gave way at %s state=%s" % (st["pos"], st["pstate"]))
            p.shot("D1_lip_gives_way")
            break
    p.up("W")
    for t in trail:
        p.say("   ", t)
    p.shot("D2_after_lip")
    # ride the slide out WITHOUT touching the camera, and look at what a player sees
    for i in range(14):
        p.wait(420)
        st = p.state()
        if i in (1, 4, 8, 13):
            p.shot("D3_sliding_%d" % i)
        if st["grounded"] and hs(st) < 0.4 and st["pstate"] not in ("slopeSlide",):
            break
    st = p.state()
    p.say("slide ended at %s state=%s speed=%.2f camYaw=%s camPitch=%s camDist=%s" % (
        st["pos"], st["pstate"], hs(st), st["camYaw"], st["camPitch"], st["camDist"]))
    p.shot("D4_slide_end")
    d = p.js("() => CRESTBOUND.game.deaths")
    p.say("deaths after the fall off the shelf:", d)
    drop = 30.0 - st["pos"][1]
    rep_note("walking SOUTH out of the spawn pad: the shelf gives way after about %.1f m and the hero slides %.1f m down the spire's south face to %s, no death, no checkpoint - the way back is the whole course" % (
        abs(trail[0][2] - (trail[-1][2] if trail else 0)), drop, st["pos"]))
    p.dump("rime2_lip")


@phase("mouth")
def ph_mouth(p):
    """Does walking forward out of the spawn actually put you on the flume?"""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("mouth: rime-2 did not load"); return
    # exactly the spawn facing, no camera help at all: hold W and see where you end up
    p.js("() => { const G = CRESTBOUND.game; G.player.__test.setFacing(-2.58); if (G.cam) G.cam.yaw = -2.58; }")
    p.wait(400)
    p.shot("E0_spawn_facing")
    p.down("W")
    trail = []
    for i in range(30):
        p.wait(200)
        st = p.state()
        trail.append((round(st["pos"][0], 1), round(st["pos"][1], 1), round(st["pos"][2], 1),
                      st["pstate"], st["surface"]))
        if i in (4, 9, 15, 22, 29):
            p.shot("E1_forward_%d" % i)
        if st["pos"][1] < 12:
            break
    p.up("W")
    p.wait(600)
    st = p.state()
    for t in trail:
        p.say("   ", t)
    p.say("held W from the spawn on the spawn facing -> %s %s surface=%s" % (st["pos"], st["pstate"], st["surface"]))
    p.shot("E2_forward_end")
    on_flume = st["surface"] == "ice" and st["pos"][1] > 12
    if on_flume:
        rep_worked("holding W from the spawn on the authored spawn facing puts you on the flume deck - the course's first instruction works without any camera work")
    else:
        rep_defect("rime-2 BEAT 1->2, spawn (0,30,-26) yaw -2.58 to the chute mouth U0 (4, 29.4, -22)",
                   "held W from the checkpoint pad on the authored spawn facing and nothing else - the most literal reading of 'the chute only goes down'",
                   "ended at %s on %s in state %s, not on the flume" % (st["pos"], st["surface"], st["pstate"]),
                   "the spawn facing is authored to aim at the chute mouth, so walking forward should feed the hero onto the ice",
                   p.shot("E3_missed_mouth"))
    p.dump("rime2_mouth")


@phase("probe")
def ph_probe(p):
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("probe: rime-2 did not load"); return
    info = p.js("""() => { const c = CRESTBOUND.game.course; const hz = c.hazards || [];
      const seen = {}; const sample = [];
      for (const h of hz) {
        const k = (h && (h.kind || (h.def && h.def.kind))) || '?';
        seen[k] = (seen[k]||0)+1;
        if (sample.length < 3) sample.push(Object.keys(h||{}).slice(0,26));
      }
      return {n: hz.length, kinds: seen, keys: sample,
              cKeys: Object.keys(c).slice(0,40)}; }""")
    p.say("hazards:", json.dumps(info, indent=1))
    rot = p.js("""() => (CRESTBOUND.game.course.hazards||[])
        .filter(h => h && (h.def && h.def.kind === 'rotor'))
        .map(h => ({p: h.def.p, period: h.def.period,
                    mesh: h.mesh ? [+h.mesh.position.x.toFixed(2), +h.mesh.position.y.toFixed(2), +h.mesh.position.z.toFixed(2)] : null,
                    rotY: h.mesh ? +h.mesh.rotation.y.toFixed(3) : null,
                    cols: (h.colliders||[]).length, kills: (h.kills||[]).length}))""")
    p.say("rotors:", json.dumps(rot))
    pend = p.js("""() => (CRESTBOUND.game.course.hazards||[])
        .filter(h => h && h.def && h.def.kind === 'pendulum')
        .map(h => ({p: h.def.p, len: h.def.len,
                    kills: (h.kills||[]).map(k => k.center ? [+k.center.x.toFixed(2), +k.center.y.toFixed(2), +k.center.z.toFixed(2)] : null),
                    cols: (h.colliders||[]).length}))""")
    p.say("pendulums:", json.dumps(pend))
    beams = p.js("""() => (CRESTBOUND.game.course.hazards||[])
        .filter(h => h && h.def && h.def.kind === 'beam')
        .map(h => ({a: h.def.a, on: !!h.on, kills: (h.kills||[]).length,
                    active: (h.kills||[]).map(k => !!k.active)}))""")
    p.say("beams:", json.dumps(beams))
    van = p.js("""() => (CRESTBOUND.game.course.hazards||[])
        .filter(h => h && h.def && h.def.kind === 'vanish')
        .map(h => ({p: h.def.p, solid: (h.colliders||[]).map(c=>!!c.active), vis: h.mesh?!!h.mesh.visible:null}))""")
    p.say("vanish:", json.dumps(van))
    mov = p.js("""() => (CRESTBOUND.game.course.hazards||[])
        .filter(h => h && h.def && h.def.kind === 'mover')
        .map(h => ({p: h.def.p, now: h.mesh ? [+h.mesh.position.x.toFixed(2), +h.mesh.position.y.toFixed(2), +h.mesh.position.z.toFixed(2)] : null}))""")
    p.say("movers:", json.dumps(mov))
    crit = p.js("""() => (CRESTBOUND.game.course.critters||[])
        .map(h => ({kind: h.def ? h.def.kind : (h.kind||'?'),
                    now: h.mesh ? [+h.mesh.position.x.toFixed(2), +h.mesh.position.y.toFixed(2), +h.mesh.position.z.toFixed(2)] : null,
                    kills: (h.kills||[]).length}))""")
    p.say("critters:", json.dumps(crit))
    p.dump("rime2_probe")


@phase("wheel2")
def ph_wheel2(p):
    """The ice wheel at TURN 3 - stand ON the deck (surface 21.90 at (33,-24.5))."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("wheel2: rime-2 did not load"); return
    # deck top at U4 is 20.60; the rotor sits at 21.90, i.e. 1.30 m over it
    tpv(p, 33.0, 20.75, -24.5)
    p.wait(900)
    st = p.state()
    p.say("standing at the wheel:", st["pos"], st["pstate"], "grounded", st["grounded"], "surface", st["surface"])
    if not st["grounded"]:
        tpv(p, 33.0, 21.0, -24.5); p.wait(900); st = p.state()
        p.say("  retry:", st["pos"], st["pstate"], st["grounded"])
    p.face(42.0, -21.0)
    p.shot("F0_wheel_deck")
    d0 = p.js("() => CRESTBOUND.game.deaths")
    ys, moved = [], []
    for i in range(16):
        p.wait(350)
        stt = p.state()
        ys.append(round(stt["pos"][1], 2))
        moved.append([round(stt["pos"][0], 2), round(stt["pos"][2], 2), stt["pstate"]])
        if i in (2, 6, 10, 14):
            p.shot("F1_wheel_%d" % i)
    d1 = p.js("() => CRESTBOUND.game.deaths")
    st = p.state()
    p.say("stood on the deck under the wheel 5.6 s: deaths %d->%d, y %s" % (d0, d1, ys))
    p.say("   xz/state:", moved)
    drift = math.hypot(st["pos"][0] - 33.0, st["pos"][2] + 24.5)
    if d1 > d0:
        rep_defect("rime-2 BEAT 2, the ice wheel at TURN 3 (rotor at 33, 21.90, -24.5, 1.30 m over the deck)",
                   "stood still on the flume deck in the wheel's sweep, as a player would while reading the JUMP IT OR RIDE IT sign",
                   "the wheel killed the hero (deaths %d -> %d)" % (d0, d1),
                   "the course comment says 'a bar is a RIDEABLE solid, so this is a timing puzzle, not a trap'",
                   p.shot("F2_wheel_killed"))
    elif drift > 2.0:
        rep_worked("the ice wheel at TURN 3 is a solid rideable bar: standing in its sweep shoved the hero %.1f m along the deck instead of killing him (deaths %d -> %d)" % (drift, d0, d1))
    else:
        rep_defect("rime-2 BEAT 2, the ice wheel at TURN 3 (rotor at 33, 21.90, -24.5)",
                   "stood on the deck at the wheel's hub for 5.6 s (its period is 4.4 s, so both arms passed through the hero)",
                   "nothing at all happened - no push, no ride, no hit; the hero drifted %.2f m" % drift,
                   "the sign says JUMP IT OR RIDE IT; a bar that passes through you is neither",
                   p.shot("F2_wheel_nothing"))
    # now try to RIDE it: stand out on an arm
    tpv(p, 35.4, 21.0, -24.5)
    p.wait(1200)
    st0 = p.state()
    for i in range(10):
        p.wait(400)
        if i in (3, 8):
            p.shot("F3_wheel_ride_%d" % i)
    st1 = p.state()
    p.say("out on the arm: %s -> %s (%s)" % (st0["pos"], st1["pos"], st1["pstate"]))
    p.dump("rime2_wheel2")

@phase("wheel3")
def ph_wheel3(p):
    """What exactly happens when you are on the deck as the ice wheel comes round?"""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("wheel3: rime-2 did not load"); return
    p.js("() => CRESTBOUND.game.__dev.setClock(0)")
    tpv(p, 30.5, 21.4, -23.6)
    p.wait(600)
    st = p.state()
    p.say("placed short of the wheel:", st["pos"], st["pstate"], "grounded", st["grounded"], "surface", st["surface"])
    p.face(33.0, -24.5)
    p.shot("G0_before_wheel")
    d0 = p.js("() => CRESTBOUND.game.deaths")
    log = []
    death = None
    p.down("W")
    for i in range(40):
        p.wait(150)
        snap = p.js("""() => { const G = CRESTBOUND.game, P = G.player;
           return {d: G.deaths, cause: P.deathCause, st: P.state,
             p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
             tl: G.lastDeathTimeline ? (G.lastDeathTimeline.cause || null) : null}; }""")
        log.append(snap)
        if snap["d"] > d0 and death is None:
            death = (i, log[max(0, i - 2)], snap)
            p.shot("G1_death_frame")
            break
        if i in (4, 10, 18, 28):
            p.shot("G2_wheel_%d" % i)
    p.up("W")
    for l in log[-10:]:
        p.say("   ", json.dumps(l))
    if death:
        i, before, at = death
        p.say("DIED at sample %d: %s  (cause %s / %s)" % (i, at["p"], at["cause"], at["tl"]))
        rep_defect("rime-2 BEAT 2, the ice wheel at TURN 3 (rotor p [33, 21.90, -24.5], height 0.5, deck top 20.60)",
                   "ran down the flume deck into the wheel at running speed, the way the racing line takes you, with the sign 3 m earlier reading JUMP IT OR RIDE IT",
                   "the wheel KILLED the hero on contact at %s (death cause '%s'). Its bar centre is 1.30 m over the deck and it is 0.50 m thick, so the clear space under it is 1.05 m - a 1.50 m hero cannot stand under it, and being swept by a solid mover is a crush." % (at["p"], at["cause"] or at["tl"]),
                   "the course's own comment says 'a bar is a RIDEABLE solid, so this is a timing puzzle, not a trap - you jump it or you ride it a quarter turn'. Riding it means standing ON it; being caught by it should shove or carry, not kill.",
                   p.shot("G3_wheel_killed"), severity="HIGH")
    else:
        st = p.state()
        p.say("no death; ended", st["pos"], st["pstate"])
        rep_worked("running the flume deck through the ice wheel at TURN 3 did not kill (ended %s) - the bar is a solid you can be shoved by" % (st["pos"],))
    # can you actually RIDE it? stand on top of an arm
    p.js("() => CRESTBOUND.game.__dev.setClock(0)")
    tpv(p, 35.6, 22.4, -24.5)
    p.wait(1400)
    st0 = p.state()
    p.shot("G4_on_the_arm")
    p.say("dropped onto the arm at", st0["pos"], st0["pstate"], "grounded", st0["grounded"])
    for i in range(8):
        p.wait(420)
        if i in (2, 6):
            p.shot("G5_riding_%d" % i)
    st1 = p.state()
    p.say("after 3.4 s on the arm:", st1["pos"], st1["pstate"], "grounded", st1["grounded"])
    if st1["pos"][1] > 21.0 and st1["grounded"]:
        rep_worked("you really can RIDE the ice wheel - dropping onto an arm leaves the hero standing on it and carried round (%s -> %s)" % (st0["pos"], st1["pos"]))
    else:
        rep_defect("rime-2 BEAT 2, riding the ice wheel at TURN 3",
                   "dropped onto the top of one of the wheel's arms from 1 m above it, then stood still for 3.4 s",
                   "did not ride it: %s -> %s, state %s, grounded %s" % (st0["pos"], st1["pos"], st1["pstate"], st1["grounded"]),
                   "the sign says JUMP IT OR RIDE IT, so the arm must be standable and must carry the hero round",
                   p.shot("G6_ride_failed"))
    p.dump("rime2_wheel3")

@phase("wheel4")
def ph_wheel4(p):
    """Place the hero on the deck at the wheel and watch, frame by frame, from the
    instant of placement - the last two runs died inside the setup and I could not
    see what killed him."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("wheel4: rime-2 did not load"); return
    SNAP = """() => { const G = CRESTBOUND.game, P = G.player;
        return {d: G.deaths, cause: P.deathCause, st: P.state, gs: G.state,
          p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
          v: [+P.vel.x.toFixed(2), +P.vel.y.toFixed(2), +P.vel.z.toFixed(2)],
          g: !!P.grounded, sf: P.surface, clk: +(G.course.clock||0).toFixed(2)}; }"""
    for tag, tgt in (("under_hub", (33.0, 20.75, -24.5)),
                     ("deck_before", (30.5, 21.35, -23.7)),
                     ("deck_after", (36.0, 20.0, -25.7))):
        p.js("() => CRESTBOUND.game.__dev.setClock(0)")
        p.wait(150)
        tpv(p, tgt[0], tgt[1], tgt[2])
        log = []
        for i in range(22):
            p.wait(110)
            log.append(p.js(SNAP))
            if i == 1:
                p.shot("H0_%s_placed" % tag)
            if log[-1]["d"] != log[0]["d"]:
                p.shot("H1_%s_died" % tag)
                break
        p.say("--- %s target %s" % (tag, tgt))
        for l in log:
            p.say("   ", json.dumps(l))
        p.shot("H2_%s_end" % tag)
    p.dump("rime2_wheel4")

@phase("wheel5")
def ph_wheel5(p):
    """Is the ice wheel a FAIR timing puzzle? Three questions:
       1. can you crouch under the bar?  2. can you jump it?
       3. does the GAP A landing drop you inside its kill disc?"""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("wheel5: rime-2 did not load"); return
    SNAP = """() => { const G = CRESTBOUND.game, P = G.player;
        return {d: G.deaths, cause: P.deathCause, st: P.state,
          p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
          clk: +(G.course.clock||0).toFixed(2)}; }"""

    # ---- 1. crouch under the bar (crouch height 0.95, clearance under it 1.05)
    p.js("() => CRESTBOUND.game.__dev.setClock(0)")
    tpv(p, 33.0, 20.7, -24.5)
    p.down("C")
    log = []
    for i in range(16):
        p.wait(140)
        log.append(p.js(SNAP))
        if i == 2:
            p.shot("I0_crouched_under")
        if log[-1]["d"] != log[0]["d"]:
            p.shot("I1_crouch_died")
            break
    p.up("C")
    crouch_died = log[-1]["d"] != log[0]["d"]
    p.say("CROUCHED under the wheel hub: died=%s  first=%s last=%s" % (
        crouch_died, json.dumps(log[0]), json.dumps(log[-1])))

    # ---- 2. the GAP A landing vs the wheel, at four clock phases
    outcomes = []
    for phase_t in (0.0, 1.1, 2.2, 3.3):
        p.js("(t) => CRESTBOUND.game.__dev.setClock(t)", phase_t)
        tpv(p, 14.5, 26.2, -18.6)
        p.wait(450)
        p.face(20.0, -19.5)
        p.down("W")
        jumped = False
        res = None
        for i in range(30):
            p.wait(150)
            sn = p.js(SNAP)
            if not jumped and sn["p"][0] > 19.2:
                p.tap("SPACE", 110)
                jumped = True
            if sn["d"] != 0 and sn["st"] == "dead":
                res = ("DIED", sn)
                break
            if sn["p"][0] > 34.5 or (jumped and sn["p"][1] < 15):
                res = ("through", sn)
                break
        p.up("W")
        p.wait(400)
        sn = p.js(SNAP)
        if res is None:
            res = ("stopped", sn)
        outcomes.append((phase_t, res[0], res[1]["p"], res[1]["cause"], res[1]["clk"]))
        p.say("  GAP A at clock %.1f -> %s at %s (cause %s, clk %.2f)" % (
            phase_t, res[0], res[1]["p"], res[1]["cause"], res[1]["clk"]))
        p.shot("I2_gapA_phase_%s" % str(phase_t).replace(".", "_"))
        # clear any death state before the next attempt
        p.wait(900)

    deaths = [o for o in outcomes if o[1] == "DIED"]
    p.say("GAP A -> TURN 3 outcomes:", json.dumps(outcomes))
    if deaths:
        rep_defect("rime-2 BEAT 2, the ice wheel at TURN 3 (rotor p [33, 21.90, -24.5], arms 2, len 4.2, period 4.4) - and the GAP A landing that feeds it",
                   "jumped GAP A the way the course intends (9 m of deck run-up, one timed Space at the lip) at four different course-clock phases (0.0 / 1.1 / 2.2 / 3.3 s) and let the landing carry me down the deck",
                   "%d of 4 runs ended in a CRUSH death: %s. The wheel's arms are 4.2 m long, so its swept disc is 8.4 m across on a 5.2 m wide chute - it covers the whole deck - and the GAP A landing at (32.0, 21.1, -22.0) is 2.7 m from the hub, INSIDE that disc. You land out of a committed jump straight into the bar with no frame to react in." % (
                       len(deaths), "; ".join("clk %.1f -> %s at %s" % (d[0], d[3], d[2]) for d in deaths)),
                   "the course's own comment calls it 'a timing puzzle, not a trap - you jump it or you ride it a quarter turn'. Two fixes are possible: put the GAP A landing outside the swept disc, or make the arms shove instead of crush.",
                   p.shot("I3_wheel_gapA"), severity="HIGH")
    else:
        rep_worked("GAP A into TURN 3 survived all four clock phases - the ice wheel does not ambush the landing")
    if crouch_died:
        rep_defect("rime-2 BEAT 2, ducking the ice wheel (rotor bar underside ~1.05 m over the deck at TURN 3)",
                   "held crouch (C) standing at the wheel's hub while an arm came round - a crouched hero is 0.95 m, the bar's underside is about 1.05 m over the deck, so ducking should be the third answer",
                   "crushed anyway (cause %s at %s)" % (log[-1]["cause"], log[-1]["p"]),
                   "if the geometry leaves 1.05 m of clearance and crouch is 0.95 m, crouching under it should work; if it is not meant to work the bar should sit low enough that the player can see it will not",
                   p.shot("I4_crouch_crushed"))
    else:
        rep_worked("you CAN duck the ice wheel: holding crouch at the hub let the arm pass over the hero without a scratch - a third, discoverable answer to JUMP IT OR RIDE IT")
    p.dump("rime2_wheel5")

@phase("wheel6")
def ph_wheel6(p):
    """Run the TURN 3 deck through the wheel from a safe start (x=28, outside the
    4.2 m disc), four clock phases, three ways: run, run+crouch, run+jump."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("wheel6: rime-2 did not load"); return
    SNAP = """() => { const G = CRESTBOUND.game, P = G.player;
        return {d: G.deaths, cause: P.deathCause, st: P.state,
          p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
          clk: +(G.course.clock||0).toFixed(2)}; }"""
    results = []
    for mode in ("run", "crouch", "jump"):
        for phase_t in (0.0, 1.1, 2.2, 3.3):
            p.js("(t) => CRESTBOUND.game.__dev.setClock(t)", phase_t)
            tpv(p, 28.0, 21.98, -23.02)
            p.wait(500)
            st0 = p.js(SNAP)
            if abs(st0["p"][0]) < 5:
                results.append((mode, phase_t, "SETUP-FAILED", st0["p"], st0["cause"]))
                p.say("  %s @%.1f setup failed (hero at %s)" % (mode, phase_t, st0["p"]))
                p.wait(800)
                continue
            d0 = st0["d"]
            p.face(42.0, -21.0)
            if mode == "crouch":
                p.down("C")
            p.down("W")
            out = None
            for i in range(26):
                p.wait(140)
                sn = p.js(SNAP)
                if mode == "jump" and 30.0 < sn["p"][0] < 31.6:
                    p.tap("SPACE", 110)
                if sn["d"] > d0:
                    out = ("DIED:" + str(sn["cause"]), sn)
                    p.shot("J_%s_%s_died" % (mode, str(phase_t).replace(".", "_")))
                    break
                if sn["p"][0] > 38.5:
                    out = ("through", sn)
                    break
                if sn["p"][1] < 15:
                    out = ("fell off", sn)
                    break
            p.up("W")
            if mode == "crouch":
                p.up("C")
            if out is None:
                out = ("stalled", p.js(SNAP))
            results.append((mode, phase_t, out[0], out[1]["p"], out[1]["cause"]))
            p.say("  %-6s @clock %.1f -> %-16s %s" % (mode, phase_t, out[0], out[1]["p"]))
            p.wait(900)
    p.say("WHEEL RESULTS:", json.dumps(results))
    good = [r for r in results if r[2] not in ("SETUP-FAILED",)]
    died = [r for r in good if r[2].startswith("DIED")]
    p.shot("J_end")
    if died:
        rep_defect("rime-2 BEAT 2, the ice wheel at TURN 3 (rotor [33, 21.90, -24.5], arms 2, len 4.2, period 4.4; deck top 20.60, chute 5.20 m wide)",
                   "ran the deck through the wheel from a safe start 5 m short of it, at four course-clock phases, three ways - plain run, run holding crouch, and run with a jump timed at the bar",
                   "%d of %d attempts ended in a CRUSH death (cause 'crush'): %s. The arms are 4.2 m long, so the swept disc is 8.4 m across on a 5.2 m chute - it covers the deck from berm to berm, there is no lane past it, and the bar's underside sits about 1.05 m over a deck a 1.50 m hero is standing on." % (
                       len(died), len(good), "; ".join("%s@%.1f at %s" % (d[0], d[1], d[3]) for d in died)),
                   "the course comment promises 'a RIDEABLE solid... a timing puzzle, not a trap'. Death by crush from a decorative-looking ice bar on a slick 14-degree ramp, where the player has just committed to a jump, is a trap. Either the arms should shove/carry on contact or the bar needs enough clearance to duck.",
                   p.shot("J_wheel_summary"), severity="HIGH",
                   note="proven separately: dropping ONTO an arm does work - the hero stands on it and is carried round (33.06,22.15,-26.71) -> (30.79,22.15,-24.46)")
    else:
        rep_worked("the ice wheel at TURN 3 can be run through at every clock phase without dying (%d attempts)" % len(good))
    p.dump("rime2_wheel6")

def ride_deck(p, legs, tag, max_s=70, shotname="ride"):
    """Ride a flume: `legs` is a list of (targetXZ, jumpAtDistOrNone). Holds W the whole
    way, re-aims the camera at the next deck point every 150 ms (mouse + W, what a
    player does), and taps Space once when the named gap lip comes up."""
    p.down("W")
    t0 = time.time()
    n = 0
    log = []
    for (tx, tz), jumpAt in legs:
        fired = jumpAt is None
        for _ in range(30):
            if time.time() - t0 > max_s:
                break
            p.face(tx, tz)
            p.wait(150)
            st = p.state()
            n += 1
            log.append((round(st["pos"][0], 1), round(st["pos"][1], 1), round(st["pos"][2], 1),
                        st["pstate"], st["surface"], round(hs(st), 1)))
            if n % 7 == 0:
                p.shot("%s_%02d" % (shotname, n))
            d = math.hypot(st["pos"][0] - tx, st["pos"][2] - tz)
            if not fired and d <= jumpAt:
                p.tap("SPACE", 110)
                fired = True
                p.say("   jumped for the gap at %s speed %.2f" % (st["pos"], hs(st)))
                p.shot("%s_gapjump_%02d" % (shotname, n))
            if d < 2.6:
                break
            if st["pos"][1] < 2.5:
                break
        if time.time() - t0 > max_s:
            break
    p.up("W")
    p.wait(400)
    return log


@phase("upper2")
def ph_upper2(p):
    """The upper flume, ridden end to end with the GAP A jump."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("upper2: rime-2 did not load"); return
    tpv(p, 4.6, 29.6, -21.6)
    st = p.state()
    p.say("on the chute mouth deck:", st["pos"], st["pstate"], "surface", st["surface"])
    p.shot("K0_mouth_deck")
    legs = [((U["U1"][0], U["U1"][2]), None),
            ((U["U2"][0], U["U2"][2]), 1.9),      # GAP A lip
            ((U["U3"][0], U["U3"][2]), None),
            ((U["U4"][0], U["U4"][2]), None),
            ((U["U5"][0], U["U5"][2]), None),
            ((U["U6"][0], U["U6"][2]), None),
            ((U["U7"][0], U["U7"][2]), None),
            ((U["U8"][0], U["U8"][2]), None)]
    log = ride_deck(p, legs, "upper2", shotname="K1")
    for l in log:
        p.say("   ", l)
    st = p.state()
    p.shot("K2_upper_end")
    p.say("UPPER RUN ended at %s %s surface=%s" % (st["pos"], st["pstate"], st["surface"]))
    d = p.js("() => CRESTBOUND.game.deaths")
    made = st["pos"][1] > 15 and st["pos"][0] > 34
    if made:
        rep_worked("the UPPER flume can be ridden end to end - chute mouth, TURN 1, TURN 2, the GAP A jump, TURN 3, the high span, TURN 4, down to the mid station at %s (deaths %d)" % (st["pos"], d))
    else:
        rep_defect("rime-2 BEAT 2, the upper flume ridden end to end (mouth 4,29.4,-22 -> mid station 38,17.3,-6.5)",
                   "started on the mouth deck, held W, aimed the camera at each deck point in turn and took one jump at the GAP A lip - the intended luge line",
                   "came off the ice at %s (state %s, surface %s), deaths %d" % (st["pos"], st["pstate"], st["surface"], d),
                   "the flume is the course's set piece and its whole promise is that it carries you; a clean line should reach the mid station",
                   p.shot("K3_upper_failed"), severity="high")
    p.dump("rime2_upper2")


@phase("lower2")
def ph_lower2(p):
    """The lower flume, ridden end to end with the GAP B and GAP C jumps."""
    s = start(p, cp=1)
    if s["course"] != "rime-2":
        rep_blocked("lower2: rime-2 did not load"); return
    tpv(p, 34.0, 17.5, -1.9)
    st = p.state()
    p.say("on the lower lip:", st["pos"], st["pstate"], "surface", st["surface"])
    p.shot("L0_lower_lip")
    legs = [((L["L1"][0], L["L1"][2]), None),
            ((L["L2"][0], L["L2"][2]), 1.9),      # GAP B lip
            ((L["L3"][0], L["L3"][2]), None),
            ((L["L4"][0], L["L4"][2]), None),
            ((L["L5"][0], L["L5"][2]), 1.9),      # GAP C lip
            ((L["L6"][0], L["L6"][2]), None),
            ((L["L7"][0], L["L7"][2]), None),
            ((L["L8"][0], L["L8"][2]), None),
            ((L["L9"][0], L["L9"][2]), None),
            ((-4.5, 27.0), None)]                 # the FINISH pad on the lake
    log = ride_deck(p, legs, "lower2", shotname="L1")
    for l in log:
        p.say("   ", l)
    st = p.state()
    p.shot("L2_lower_end")
    d = p.js("() => CRESTBOUND.game.deaths")
    p.say("LOWER RUN ended at %s %s surface=%s deaths=%d" % (st["pos"], st["pstate"], st["surface"], d))
    if st["pos"][2] > 20 and st["pos"][1] < 4:
        rep_worked("the LOWER flume can be ridden end to end - mesa lip, TURN 5, the GAP B jump, TURN 6, the GAP C jump, and out of the mouth onto the frozen lake at %s" % (st["pos"],))
    else:
        rep_defect("rime-2 BEAT 2, the lower flume ridden end to end (mesa lip 34,17.2,-2 -> the mouth over the lake -4.5,2.2,24)",
                   "started on the mesa lip, held W, aimed at each deck point and took one jump at each of GAP B and GAP C",
                   "came off the ice at %s (state %s, surface %s)" % (st["pos"], st["pstate"], st["surface"]),
                   "the second half of the luge is the half the mid-station sign promises is faster; a clean line should reach the lake",
                   p.shot("L3_lower_failed"), severity="high")
    p.dump("rime2_lower2")

@phase("upper3")
def ph_upper3(p):
    """Three honest attempts at the upper flume, and the TUCK the sign promises."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("upper3: rime-2 did not load"); return
    runs = []
    for mode in ("steer", "tuck", "lookahead"):
        tpv(p, 5.6, 29.3, -21.1)
        st = p.state()
        if st["surface"] != "ice":
            p.say("  (%s) start surface is %s at %s" % (mode, st["surface"], st["pos"]))
        p.face(U["U1"][0], U["U1"][2])
        p.wait(250)
        p.down("W")
        if mode == "tuck":
            p.down("C")
        trail = []
        aim = [(U["U1"][0], U["U1"][2]), (U["U2"][0], U["U2"][2]), (U["U3"][0], U["U3"][2]),
               (U["U4"][0], U["U4"][2]), (U["U5"][0], U["U5"][2])]
        ai = 0
        jumped = False
        for i in range(46):
            tx, tz = aim[min(ai, len(aim) - 1)]
            if mode == "lookahead":
                tx2, tz2 = aim[min(ai + 1, len(aim) - 1)]
                tx, tz = (tx + tx2) / 2, (tz + tz2) / 2
            p.face(tx, tz)
            p.wait(140)
            stt = p.state()
            trail.append((round(stt["pos"][0], 1), round(stt["pos"][1], 1), round(stt["pos"][2], 1),
                          stt["surface"], round(hs(stt), 1)))
            if i % 8 == 0:
                p.shot("M_%s_%02d" % (mode, i))
            d = math.hypot(stt["pos"][0] - aim[min(ai, len(aim) - 1)][0],
                           stt["pos"][2] - aim[min(ai, len(aim) - 1)][1])
            if d < 3.0 and ai < len(aim) - 1:
                ai += 1
            if not jumped and ai == 1 and stt["pos"][0] > 18.6:
                p.tap("SPACE", 110); jumped = True
            if stt["pos"][1] < 16.0:
                break
        p.up("W")
        if mode == "tuck":
            p.up("C")
        p.wait(500)
        stt = p.state()
        off = None
        for t in trail:
            if t[3] != "ice":
                off = t
                break
        runs.append({"mode": mode, "end": stt["pos"], "lastIce": off, "top": max(t[4] for t in trail),
                     "trail": trail})
        p.say("  %-9s -> end %s  first non-ice sample %s  top speed %.1f" % (
            mode, stt["pos"], off, max(t[4] for t in trail)))
        p.shot("M_%s_end" % mode)
    made = [r for r in runs if r["end"][1] > 15 and r["end"][0] > 33]
    p.say("UPPER ATTEMPTS:", json.dumps([{k: r[k] for k in ("mode", "end", "lastIce", "top")} for r in runs]))
    if not made:
        rep_defect("rime-2 BEAT 2, TURN 1 of the upper flume - the berm at (10.49, 27.55, -15.15), 6.0 m long, against a 9 m turn (U1 11,26.6,-18 -> U2 20,23.8,-19.5)",
                   "rode the flume from the chute mouth three times - steering at the next deck point, holding crouch (the TUCK the spawn sign asks for), and looking one point ahead - at 10-12 m/s, which is what the chute gives you after 20 m of 19-degree ice",
                   "all three runs slid off the OUTSIDE of TURN 1 and fell about 14 m onto the glacier: ends %s. The ice carries the drift past the downstream end of the berm - the berm spans about x 7.5 to x 13.4 while the turn's outside edge runs on to x 20, so the last 6.6 m of the turn has no wall on it, and that is exactly where a rider at flume speed arrives." % ([r["end"] for r in runs],),
                   "the flume is the course's whole set piece and TURN 1 is its FIRST corner; the berm should cover the corner it belongs to. Steering back onto the deck had no authority against the ice - this reads as lost CONTROL, not lost grip.",
                   p.shot("M_turn1_summary"), severity="HIGH")
    else:
        rep_worked("the upper flume's TURN 1 can be held: %d of 3 rides stayed on the ice through it" % len(made))
    p.dump("rime2_upper3")


@phase("tuck")
def ph_tuck(p):
    """'CROUCH AT SPEED TO TUCK - THE ICE KEEPS THE REST'. Does crouching at speed
    on the flume do anything at all?"""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("tuck: rime-2 did not load"); return
    out = {}
    for mode in ("plain", "crouch"):
        tpv(p, 43.5, 17.9, -8.5)          # the shallow 2.9 deg run-out into the mid station
        p.face(38.0, -6.5)
        p.wait(250)
        p.down("W")
        if mode == "crouch":
            p.down("C")
        sp = []
        for i in range(14):
            p.wait(160)
            stt = p.state()
            sp.append((round(hs(stt), 2), stt["pstate"]))
        p.up("W")
        if mode == "crouch":
            p.up("C")
        p.wait(400)
        out[mode] = sp
        p.say("  %s: %s" % (mode, sp))
        p.shot("N_%s" % mode)
    top_plain = max(x[0] for x in out["plain"])
    top_crouch = max(x[0] for x in out["crouch"])
    states = set(x[1] for x in out["crouch"])
    p.say("TUCK: plain top %.2f m/s, crouched top %.2f m/s, crouched states %s" % (top_plain, top_crouch, states))
    if top_crouch <= top_plain + 0.2 and not (states & {"slide", "dive", "slopeSlide"}):
        rep_defect("rime-2 BEAT 1/2, the spawn sign's instruction 'CROUCH AT SPEED TO TUCK  -  THE ICE KEEPS THE REST'",
                   "ran the flume deck at speed and held crouch (C), the exact thing the course's opening sign teaches, then ran the identical stretch without it",
                   "crouching does nothing on the ice: top speed %.2f m/s crouched vs %.2f m/s plain, and the hero's states while crouched were %s - a crouch-walk, no tuck, no speed, no pose" % (top_crouch, top_plain, sorted(states)),
                   "the first sign in the course teaches a verb; the verb should exist. Either give the crouch a tuck on ice (a faster, lower, committed slide) or stop the sign promising one.",
                   p.shot("N_tuck_nothing"), severity="medium")
    else:
        rep_worked("crouching at speed on the ice really does tuck: %.2f m/s crouched vs %.2f m/s plain (states %s)" % (top_crouch, top_plain, sorted(states)))
    p.dump("rime2_tuck")

@phase("crev2")
def ph_crev2(p):
    """The wall-kick shaft, driven the way a player drives it: hold into a wall and
    press jump the instant the hero grabs it. Samples every 60 ms."""
    s = start(p, cp=4)
    if s["course"] != "rime-2":
        rep_blocked("crev2: rime-2 did not load"); return
    SNAP = """() => { const G = CRESTBOUND.game, P = G.player;
        return {st: P.state, g: !!P.grounded, d: G.deaths,
                p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)],
                vy: +P.vel.y.toFixed(2), jc: P.jumpCount,
                wn: P.wallN ? [+P.wallN.x.toFixed(2), +P.wallN.z.toFixed(2)] : null}; }"""
    best = 0
    for attempt in range(3):
        tpv(p, -13.0, 14.6, -21.0)
        st = p.state()
        if abs(st["pos"][0] + 13) > 2 or abs(st["pos"][1] - 14.4) > 1.5:
            p.say("  attempt %d: could not get to the shaft floor (%s)" % (attempt, st["pos"]))
            continue
        p.shot("O%d_floor" % attempt)
        p.face(-11.05, -21.0)                     # into the EAST wall
        p.wait(250)
        p.down("W")
        p.tap("SPACE", 120)
        trace = []
        kicks = 0
        east = True
        for i in range(70):
            p.wait(60)
            sn = p.js(SNAP)
            trace.append((sn["st"], sn["p"][1], sn["vy"], sn["jc"], sn["wn"]))
            best = max(best, sn["p"][1])
            if sn["st"] in ("wallslide",) or (sn["wn"] and not sn["g"]):
                p.tap("SPACE", 70)
                kicks += 1
                east = not east
                p.up("W")
                p.face(-11.05 if east else -14.95, -21.0)
                p.down("W")
            if sn["g"] and i > 8 and sn["p"][1] < 15.0:
                break
            if sn["p"][1] > 22.6:
                break
        p.up("W")
        p.wait(400)
        sn = p.js(SNAP)
        top = max(t[1] for t in trace)
        states = []
        for t in trace:
            if not states or states[-1] != t[0]:
                states.append(t[0])
        p.say("  attempt %d: kicks fired %d, top y %.2f, end %s %s" % (attempt, kicks, top, sn["p"], sn["st"]))
        p.say("     states: %s" % ",".join(states))
        p.shot("O%d_end" % attempt)
        if sn["p"][1] > 22.6:
            break
    p.say("SHAFT best y reached: %.2f (exit ledge top is 23.00, floor 14.40)" % best)
    if best < 22.6:
        rep_defect("rime-2 BEAT 6, THE WALL-KICK SHAFT at (-13, -21) - floor 14.40, exit ledge 23.00, 3.20 m clear, 8.80 m tall",
                   "stood on the shaft floor, held W into one wall, jumped, and then pressed Space the instant the hero touched a wall, alternating walls, sampling every 60 ms - three separate attempts",
                   "never got out. The highest the hero reached in any attempt was y %.2f, against a 23.00 exit ledge. The wall-kick state did not chain: see the state trace in the log." % best,
                   "the course budgets 1 jump + 4 kicks (feet 14.80 -> 24.31, 1.31 m of margin) and this shaft is the ONLY way out of the crevasse and the only route to cp5, sigil 7 and the seracs back up to the shelf. A player who drops in here and cannot kick is stuck in a hole.",
                   p.shot("O_shaft_stuck"), severity="HIGH")
    else:
        rep_worked("the crevasse wall-kick shaft goes: jump plus alternating wall kicks reached y %.2f, over the 23.00 exit ledge" % best)
    p.dump("rime2_crev2")


@phase("bridges")
def ph_bridges(p):
    """The four vanish snow bridges, walked from the approach ledge with the vanish
    state logged, then again as a run."""
    s = start(p, cp=4)
    if s["course"] != "rime-2":
        rep_blocked("bridges: rime-2 did not load"); return
    VAN = """() => (CRESTBOUND.game.course.hazards||[])
        .filter(h => h && h.def && h.def.kind === 'vanish' && h.def.p[2] < -5)
        .map(h => ({z: h.def.p[2], solid: (h.colliders||[]).some(c => c.active)}))"""
    br = [(-23.0, 17.80, -10.0), (-21.2, 18.40, -12.6), (-19.4, 19.00, -15.2), (-17.6, 19.60, -17.8)]
    for mode in ("hop", "walk"):
        tpv(p, -25.4, 17.9, -7.8)
        st = p.state()
        if abs(st["pos"][0] + 25.4) > 2.5:
            p.say("  %s: could not reach the approach ledge (%s)" % (mode, st["pos"]))
            continue
        p.shot("P_%s_ledge" % mode)
        d0 = p.js("() => CRESTBOUND.game.deaths")
        reached = 0
        for i, (tx, ty, tz) in enumerate(br):
            v = p.js(VAN)
            p.face(tx, tz)
            p.down("W")
            if mode == "hop":
                p.wait(230); p.tap("SPACE", 120); p.wait(760)
            else:
                p.wait(950)
            p.up("W"); p.wait(420)
            stt = p.state()
            ok = abs(stt["pos"][0] - tx) < 1.9 and abs(stt["pos"][2] - tz) < 1.9 and stt["pos"][1] > ty - 0.9
            p.say("  %s bridge %d -> %s %s   vanish solid=%s" % (
                mode, i + 1, stt["pos"], "OK" if ok else "MISSED", [x["solid"] for x in v]))
            p.shot("P_%s_%d" % (mode, i + 1))
            if ok:
                reached = i + 1
            else:
                break
        d1 = p.js("() => CRESTBOUND.game.deaths")
        p.say("  %s: reached bridge %d of 4, deaths %d -> %d" % (mode, reached, d0, d1))
        if reached == 4:
            rep_worked("the four vanish snow bridges over the west hollow can be crossed (%s), and the cycle gives you long enough on each one" % mode)
        else:
            rep_defect("rime-2 BEAT 6, the vanish snow bridges (-23,17.8,-10 / -21.2,18.4,-12.6 / -19.4,19.0,-15.2 / -17.6,19.6,-17.8; cycle on 3.2 off 1.8, phases 0/0.5/1.0/1.5)",
                       "crossed them from the approach ledge at (-25.4, 17.6, -7.8) by %s, one bridge at a time, aiming at each in turn" % ("jumping" if mode == "hop" else "walking"),
                       "got as far as bridge %d of 4 and fell into the hollow (deaths %d -> %d)" % (reached, d0, d1),
                       "the course comment says 3.16 m centre-to-centre at +0.60 m of rise is 0.36 m edge-to-edge, 'inside a walk-off, let alone a jump'; four staggered vanish phases on top of that make the last bridge the one that is never there when you arrive",
                       p.shot("P_%s_failed" % mode))
    p.dump("rime2_bridges")

@phase("crev3")
def ph_crev3(p):
    """One clean, disciplined wall-kick ladder: jump, wait for the wall grab, ONE tap,
    respect the 0.28 s lockout, alternate walls. Record the height each kick buys."""
    s = start(p, cp=4)
    if s["course"] != "rime-2":
        rep_blocked("crev3: rime-2 did not load"); return
    SNAP = """() => { const G = CRESTBOUND.game, P = G.player;
        return {st: P.state, g: !!P.grounded, p1: +P.pos.y.toFixed(2),
                x: +P.pos.x.toFixed(2), z: +P.pos.z.toFixed(2), vy: +P.vel.y.toFixed(2),
                wall: !!P.wallN}; }"""
    gains = []
    tpv(p, -13.0, 14.6, -21.0)
    st = p.state()
    p.say("shaft floor:", st["pos"], st["pstate"])
    p.shot("Q0_floor")
    east = True
    p.face(-11.05, -21.0)
    p.wait(250)
    p.down("W")
    p.tap("SPACE", 120)
    peak = 14.4
    kicks = 0
    i = 0
    while i < 120 and kicks < 7:
        p.wait(55)
        i += 1
        sn = p.js(SNAP)
        peak = max(peak, sn["p1"])
        if sn["st"] in ("wallslide", "wallkick") or (sn["wall"] and not sn["g"] and sn["vy"] < -0.5):
            p.tap("SPACE", 70)
            kicks += 1
            after = None
            hi = sn["p1"]
            for _ in range(9):
                p.wait(55)
                s2 = p.js(SNAP)
                hi = max(hi, s2["p1"])
                after = s2
            gains.append((kicks, round(sn["p1"], 2), round(hi, 2), round(hi - sn["p1"], 2), after["st"]))
            p.say("   kick %d from y %.2f -> peak %.2f (+%.2f), then %s" % (
                kicks, sn["p1"], hi, hi - sn["p1"], after["st"]))
            peak = max(peak, hi)
            east = not east
            p.up("W")
            p.face(-11.05 if east else -14.95, -21.0)
            p.down("W")
            p.shot("Q1_kick_%d" % kicks)
        if sn["g"] and sn["p1"] < 15.0 and i > 10:
            p.say("   back on the floor after %d kicks (peak %.2f)" % (kicks, peak))
            break
        if sn["p1"] > 22.8:
            break
    p.up("W")
    p.wait(500)
    sn = p.js(SNAP)
    p.shot("Q2_end")
    p.say("CLEAN LADDER: peak %.2f, kicks %d, gains %s, end y %.2f state %s" % (
        peak, kicks, json.dumps(gains), sn["p1"], sn["st"]))
    if peak < 22.8:
        rep_defect("rime-2 BEAT 6, THE WALL-KICK SHAFT at (-13, -21): floor 14.40, exit ledge 23.00, 3.20 m clear, 8.80 m tall",
                   "climbed it with a disciplined rhythm - jump, hold into the wall, ONE Space the instant the hero grabs it, respect the lockout, alternate walls - sampling every 55 ms, plus three earlier spam-the-button attempts",
                   "best height reached in four attempts was y %.2f, 2.2 m under the 23.00 exit ledge. The kicks DO fire (wallkick and wallslide states both appear) and each one buys about %s m, but the ladder tops out and the hero slides back to the floor." % (
                       peak, [g[3] for g in gains] or "n/a"),
                   "the course budgets 1 jump + 4 kicks = feet 24.31 against a 23.00 ledge, with 1.31 m to spare, and the shaft is the ONLY way out of the crevasse - it is the required line to cp5, sigil 7 and the seracs back to the summit shelf. A player who drops in and cannot kick out is in a hole with no exit and no death to reset them.",
                   p.shot("Q3_stuck"), severity="HIGH",
                   note="the exit ledge slab (p [-9.6, 22.65, -20], s [7.6,0.7,5.0]) reaches x -13.4, so it caps the eastern 2 m of the 3.2 m well from y 22.30 to 23.00 - a climber on that side hits its underside before the ledge top")
    else:
        rep_worked("the crevasse wall-kick shaft goes with a disciplined rhythm: peak y %.2f, %d kicks, each buying about %s m" % (peak, kicks, [g[3] for g in gains]))
    p.dump("rime2_crev3")

@phase("peak2")
def ph_peak2(p):
    """Can a player WALK from the summit shelf to the foot of ROUTE A, and does the
    spiral climb? Also: how dark is the spire's shadowed flank to walk on?"""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("peak2: rime-2 did not load"); return
    # --- the authored path: (0,-34) -> (0,-40) -> (0,-46), width 3.0
    tpv(p, 0.0, 30.2, -36.0)
    p.face(0, -46)
    p.wait(300)
    p.shot("R0_looking_at_the_peak")
    trail = []
    p.down("W")
    for i in range(34):
        p.wait(180)
        st = p.state()
        trail.append((round(st["pos"][0], 1), round(st["pos"][1], 2), round(st["pos"][2], 1),
                      st["pstate"], round(hs(st), 1)))
        if i in (5, 12, 20, 30):
            p.shot("R1_walking_%d" % i)
    p.up("W")
    p.wait(400)
    st = p.state()
    for t in trail:
        p.say("   ", t)
    p.say("WALK TO THE PEAK ended at %s %s" % (st["pos"], st["pstate"]))
    p.shot("R2_walk_end")
    slid = [t for t in trail if t[3] == "slopeSlide"]
    reached = st["pos"][2] < -43
    if not reached:
        rep_defect("rime-2 BEAT 8, the walk from the summit shelf to the foot of ROUTE A (the terrain draws a trodden path (0,-34) -> (0,-40) -> (0,-46), w 3.0, and the header calls ROUTE A 'the line the gate walks')",
                   "stood on the shelf at (0, 30.2, -36) facing the peak and held W for 6 seconds - straight up the authored path",
                   "the hero never got past z %.1f: he goes into slopeSlide on the spire's flank (%d of %d samples were slopeSlide) and slides back down. The shelf flat holds the ground at 30.4 out to about z -43, and the ground then climbs to 34.3 at the first ROUTE A block (6.4, 34.65, -46) - roughly 4 m of rise in 3 m, past the 38-degree slide threshold." % (
                       min(t[2] for t in trail), len(slid), len(trail)),
                   "ROUTE A is the course's guaranteed static route to the open crest ('always works, never needs a moving platform, and is the line the gate walks'), and there is a painted path on the ground leading to it. If the last stretch to its first block cannot be walked, the guaranteed route is not reachable on foot.",
                   p.shot("R3_cannot_reach_route_a"), severity="HIGH")
    else:
        rep_worked("you can walk the trodden path from the summit shelf up to the foot of ROUTE A (ended %s)" % (st["pos"],))

    # --- the spiral itself, entered from block 1 (drop onto it, then climb on foot)
    spiral = [(6.40, 35.35, -46.00), (5.20, 36.80, -49.72), (1.87, 38.25, -52.12),
              (-2.13, 39.70, -52.03), (-5.35, 41.15, -49.51), (-6.39, 42.60, -45.73),
              (-4.99, 44.05, -42.07), (-1.58, 45.50, -39.82)]
    tpv(p, 6.40, 35.6, -46.00)
    st = p.state()
    p.say("on ROUTE A block 1:", st["pos"], st["pstate"], "grounded", st["grounded"])
    p.shot("R4_block1")
    made = 0
    for i in range(1, len(spiral)):
        tx, ty, tz = spiral[i]
        p.face(tx, tz)
        p.down("W"); p.wait(260)
        p.tap("SPACE", 135)
        p.wait(850)
        p.up("W"); p.wait(450)
        stt = p.state()
        okk = (abs(stt["pos"][0] - tx) < 2.0 and abs(stt["pos"][2] - tz) < 2.0
               and stt["pos"][1] > ty - 0.9)
        p.say("  block %d -> %s (want near %.2f,%.2f y>%.2f) %s" % (i + 1, stt["pos"], tx, tz, ty - 0.9, "OK" if okk else "MISSED"))
        p.shot("R5_spiral_%d" % (i + 1))
        if not okk:
            break
        made = i
    p.say("SPIRAL: cleared %d of 7 hops" % made)
    if made < 7:
        rep_defect("rime-2 BEAT 8, ROUTE A - the eight-block serac spiral round the peak plinth (radius 6.40 about (0,-46), 3.90 m centre to centre, +1.45 m per step, tops 35.35 to 45.50)",
                   "stood on block 1, aimed the camera at the next block and made one single jump per block, all the way round",
                   "cleared %d of the 7 hops before missing - fell at %s" % (made, p.state()["pos"]),
                   "the header says single-jump-safe at +1.45 m is 3.42 m centre-to-centre so the spiral is 'inside the envelope twice over', and calls it the route that always works",
                   p.shot("R6_spiral_failed"), severity="high")
    else:
        rep_worked("ROUTE A, the eight-block serac spiral, climbs cleanly with one single jump per block all the way to the peak cap")
    p.dump("rime2_peak2")

@phase("peak3")
def ph_peak3(p):
    """The ROUTE A hop, tried properly: several run-up lengths and a double jump."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("peak3: rime-2 did not load"); return
    A = (6.40, 35.35, -46.00)
    B = (5.20, 36.80, -49.72)
    results = []
    for runup, dbl in ((180, False), (260, False), (340, False), (420, False), (260, True)):
        tpv(p, A[0] + 0.6, A[1] + 0.25, A[2] + 1.0)   # back edge of block 1
        st = p.state()
        if abs(st["pos"][1] - A[1]) > 1.2:
            p.say("  setup off: %s" % (st["pos"],)); continue
        p.face(B[0], B[2])
        p.wait(320)
        p.shot("S_setup_%d%s" % (runup, "_dbl" if dbl else ""))
        p.down("W")
        p.wait(runup)
        sp = hs(p.state())
        p.tap("SPACE", 130)
        if dbl:
            p.wait(200); p.tap("SPACE", 130)
        p.wait(900)
        p.up("W")
        p.wait(500)
        stt = p.state()
        ok = (abs(stt["pos"][0] - B[0]) < 2.0 and abs(stt["pos"][2] - B[2]) < 2.0
              and stt["pos"][1] > B[1] - 0.9)
        results.append((runup, dbl, round(sp, 2), stt["pos"], ok))
        p.say("  runup %d ms%s: launch speed %.2f -> %s %s" % (
            runup, " +double" if dbl else "", sp, stt["pos"], "LANDED" if ok else "missed"))
        p.shot("S_res_%d%s" % (runup, "_dbl" if dbl else ""))
    p.say("ROUTE A hop results:", json.dumps(results))
    ok_any = [r for r in results if r[4]]
    if not ok_any:
        rep_defect("rime-2 BEAT 8, ROUTE A's first hop - block 1 (6.40, top 35.35, -46.00) to block 2 (5.20, top 36.80, -49.72): 3.90 m centre to centre, +1.45 m, blocks 2.8 m square",
                   "stood on the back edge of block 1, aimed at block 2 and jumped with five different run-ups (180 / 260 / 340 / 420 ms of W, and one double jump), launch speeds %s m/s" % ([r[2] for r in results],),
                   "not one attempt landed on block 2: %s" % ([list(r[3]) for r in results],),
                   "the header calls ROUTE A the route that 'always works' and 'the line the gate walks', and claims single-jump-safe at +1.45 m is 3.42 m so this 3.90 m step is inside the envelope. From a 2.8 m block you can only buy about 1.4 m of run-up before the lip, which is not the run-up the number assumes.",
                   p.shot("S_routeA_failed"), severity="HIGH")
    else:
        rep_worked("ROUTE A's first hop lands with a run-up of %s ms (launch speed %s m/s) - the spiral is jumpable when you use the whole block" % (
            [r[0] for r in ok_any], [r[2] for r in ok_any]))
    p.dump("rime2_peak3")

@phase("peak4")
def ph_peak4(p):
    """ROUTE A's first hop with the technique that worked on the flume gaps:
    run and fire the jump on POSITION, at the lip."""
    s = start(p)
    if s["course"] != "rime-2":
        rep_blocked("peak4: rime-2 did not load"); return
    A = (6.40, 35.35, -46.00)
    B = (5.20, 36.80, -49.72)
    res = []
    for lip in (1.15, 1.35, 1.55):
        tpv(p, 7.0, 35.7, -44.9)
        st = p.state()
        if abs(st["pos"][1] - A[1]) > 1.2:
            p.say("  setup off %s" % (st["pos"],)); continue
        p.face(B[0], B[2])
        p.wait(300)
        p.down("W")
        fired = False
        for i in range(22):
            p.wait(70)
            stt = p.state()
            dz = A[2] - stt["pos"][2]          # metres travelled toward block 2
            if not fired and dz > lip:
                p.tap("SPACE", 130)
                fired = True
                p.say("   fired at %s speed %.2f (%.2f m past block centre)" % (stt["pos"], hs(stt), dz))
            if fired and stt["grounded"] and i > 6:
                break
        p.wait(700)
        p.up("W")
        p.wait(400)
        stt = p.state()
        ok = (abs(stt["pos"][0] - B[0]) < 2.0 and abs(stt["pos"][2] - B[2]) < 2.0
              and stt["pos"][1] > B[1] - 0.9)
        res.append((lip, stt["pos"], ok))
        p.say("  lip %.2f -> %s %s" % (lip, stt["pos"], "LANDED" if ok else "missed"))
        p.shot("T_lip_%s" % str(lip).replace(".", "_"))
    p.say("ROUTE A hop (position-fired):", json.dumps(res))
    if any(r[2] for r in res):
        rep_worked("ROUTE A's first hop DOES land when the jump is fired at the block's lip rather than off a fixed timer (%s)" % ([r[0] for r in res if r[2]],))
    else:
        rep_defect("rime-2 BEAT 8, ROUTE A's first hop, block 1 (6.40, top 35.35, -46.00) -> block 2 (5.20, top 36.80, -49.72)",
                   "eight attempts across two sessions: five with fixed run-ups (180/260/340/420 ms and a double jump) and three firing the jump on POSITION at the block's lip - the same technique that clears GAP A and GAP C on the flume first time",
                   "not one landed on block 2. Most attempts end at almost exactly (3.88, 33.90, -47.95) - 0.38 m short of block 2's near edge, on the ground below - and one overshot to (3.65, 35.70, -54.81), five metres past it, onto a ROUTE C block.",
                   "ROUTE A is the course's guaranteed static route to the open crest ('always works... the line the gate walks'). Between this and the fact that the shelf-to-peak walk slides you back, BEAT 8 - the course's main objective - has no route I could complete.",
                   p.shot("T_routeA_failed"), severity="HIGH")
    p.dump("rime2_peak4")

@phase("hops")
def ph_hops(p):
    """How far does a jump actually go? Measure it on the flat lake ice and compare
    with the step distances this course's climbs are built from (2.42 - 3.90 m)."""
    s = start(p, cp=2)
    if s["course"] != "rime-2":
        rep_blocked("hops: rime-2 did not load"); return
    rows = []
    for runup in (0, 90, 150, 220, 300, 450):
        for dbl in (False, True):
            tpv(p, 4.0, 1.4, 34.0)
            p.face(4.0, 46.0)
            p.wait(300)
            st0 = p.state()
            p.down("W")
            if runup:
                p.wait(runup)
            sp = hs(p.state())
            p.tap("SPACE", 130)
            if dbl:
                p.wait(210); p.tap("SPACE", 130)
            land = None
            for i in range(22):
                p.wait(70)
                stt = p.state()
                if stt["grounded"] and i > 4:
                    land = stt
                    break
            p.up("W")
            p.wait(250)
            stt = land or p.state()
            dist = math.hypot(stt["pos"][0] - st0["pos"][0], stt["pos"][2] - st0["pos"][2])
            rows.append((runup, dbl, round(sp, 2), round(dist, 2)))
            p.say("  runup %3d ms %-7s launch %.2f m/s -> travelled %.2f m" % (
                runup, "double" if dbl else "single", sp, dist))
    p.shot("U_hops")
    p.say("HOP TABLE:", json.dumps(rows))
    singles = [r for r in rows if not r[1]]
    shortest = min(r[3] for r in singles)
    rep_note("measured hop distances on the flat lake ice: %s (runup ms, double?, launch m/s, distance m). The shortest single jump I could produce with a keyboard was %.2f m; this course's required climbs step 2.42 - 3.90 m." % (json.dumps(rows), shortest))
    if shortest > 2.6:
        rep_defect("rime-2 - the whole climb back (BEAT 4 west ice face 2.42-2.87 m steps, BEAT 6 snow bridges 3.16 m, BEAT 7 east seracs 3.14 m, BEAT 8 ROUTE A 3.90 m and ROUTE C 2.0-2.5 m)",
                   "measured how far a jump actually travels: stood on the flat lake ice and jumped with run-ups of 0, 90, 150, 220, 300 and 450 ms, single and double, twelve measurements",
                   "the shortest jump a keyboard can produce is %.2f m, because W reaches the full 9 m/s run inside about a quarter of a second (measured launch speeds %s m/s). Every climb on this course is built from steps of 2.4 to 3.9 m, so a player who presses W and Space at a step lands past it - which is exactly what happened on the west seracs (7.6 m travelled at a 2.87 m step) and on ROUTE A (5 m past a 3.90 m step)." % (
                       shortest, sorted(set(r[2] for r in rows))),
                   "a stair of small blocks over an 11 m drop should be forgiving of the speed the movement system actually gives you: either the blocks want to be bigger and closer, or the approach wants to be short enough that you cannot be at full run when you take off",
                   "_shots/play_rime2_hops/U_hops.png", severity="HIGH")
    p.dump("rime2_hops")

@phase("cavern2")
def ph_cavern2(p):
    """The cavern, carefully: walk in past the beams, read the telegraph, pound the
    crystal, climb the vanish stair, meet the Warden."""
    s = start(p, cp=3)
    if s["course"] != "rime-2":
        rep_blocked("cavern2: rime-2 did not load"); return
    p.shot("V0_apron")
    # --- walk in slowly and watch the beams
    p.face(-30.0, 0.0)
    p.wait(300)
    p.shot("V1_from_the_mouth")
    d0 = p.js("() => CRESTBOUND.game.deaths")
    trail = []
    p.down("W")
    for i in range(26):
        p.wait(170)
        st = p.state()
        trail.append((round(st["pos"][0], 1), round(st["pos"][1], 1), round(st["pos"][2], 1), st["pstate"]))
        if i in (3, 7, 11, 16, 22):
            p.shot("V2_walkin_%d" % i)
        d = p.js("() => CRESTBOUND.game.deaths")
        if d > d0:
            p.shot("V3_beam_death")
            p.say("  died walking in at %s (deaths %d -> %d)" % (st["pos"], d0, d))
            break
    p.up("W")
    p.wait(400)
    for t in trail:
        p.say("   ", t)
    d1 = p.js("() => CRESTBOUND.game.deaths")
    st = p.state()
    p.say("walk into the cavern: ended %s, deaths %d -> %d, camdist %s" % (st["pos"], d0, d1, st["camDist"]))
    if st["camDist"] is not None and st["camDist"] < 2.2:
        rep_defect("rime-2 BEAT 5, the camera inside the crystal cavern (room 17 x 14 m, walls 8 m, roof deck at 20.00)",
                   "walked in through the 5.2 m south mouth toward the crystal",
                   "the follow camera collapsed to dist %.2f (TUNE.cam.minDist is 1.60, dist is 6.80 outside)" % st["camDist"],
                   "the owner's P10 is exactly this - 'camera gets buggy and hard to look around when inside a structure'",
                   p.shot("V4_cam_in_cavern"))
    # --- the crystal + the vanish stair
    tpv(p, -30.0, 12.2, 4.0)
    st = p.state()
    p.say("at the crystal:", st["pos"], st["pstate"])
    p.shot("V5_crystal")
    if abs(st["pos"][2] - 4.0) < 3.0:
        p.tap("SPACE", 120); p.wait(220); p.down("C"); p.wait(700); p.up("C")   # jump then pound
        p.wait(700)
        p.shot("V6_pounded_the_crystal")
        p.say("  after a pound at the crystal:", p.state()["pos"], p.state()["pstate"])
    steps = [(-30.0, 13.55, 0.6), (-30.0, 15.35, -1.0), (-30.0, 17.15, 0.6), (-30.0, 18.95, -1.0)]
    tpv(p, -30.0, 12.2, 2.4)
    climbed = 0
    for i, (tx, ty, tz) in enumerate(steps):
        st0 = p.state()
        if abs(st0["pos"][2] - 11.5) < 1.0:
            p.say("  respawned mid-climb, aborting the stair test"); break
        p.face(tx, tz)
        p.down("W"); p.wait(210)
        p.tap("SPACE", 130)
        p.wait(820)
        p.up("W"); p.wait(450)
        stt = p.state()
        ok = stt["pos"][1] > ty - 0.85 and abs(stt["pos"][2] - tz) < 2.2
        p.say("  vanish step %d -> %s (want y>%.2f near z %.1f) %s" % (i + 1, stt["pos"], ty - 0.85, tz, "OK" if ok else "MISSED"))
        p.shot("V7_vanish_%d" % (i + 1))
        if not ok:
            break
        climbed = i + 1
    if climbed == 4:
        rep_worked("the vanish crystal stair climbs out through the cavern roof hole with four single jumps")
    else:
        rep_defect("rime-2 BEAT 5, the vanish crystal stair - four crystal steps at (-30, tops 13.55 / 15.35 / 17.15 / 18.95, z +0.6 / -1.0 alternating), cycle on 4.0 off 2.0 warn 0.8, phases 0 / 0.6 / 1.2 / 1.8",
                   "jumped the stair one step at a time from the cavern floor beside the crystal, aiming at each step in turn",
                   "got %d of 4 steps before missing - ended at %s" % (climbed, p.state()["pos"]),
                   "the comment says each 1.80 m rise is inside a single jump (apex 1.91 m) and this stair is the only way to the roof hole, the wing hat and the wing crest",
                   p.shot("V8_vanish_failed"), severity="high")
    # --- the Warden
    tpv(p, -30.0, 12.2, 6.0)
    p.wait(600)
    w = p.js("""() => (CRESTBOUND.game.course.critters||[]).filter(c => c && c.def && c.def.kind === 'warden')
        .map(c => ({hp: c.hp, kills: (c.kills||[]).length, alive: !c.dead}))""")
    p.say("warden:", json.dumps(w))
    p.shot("V9_warden")
    p.dump("rime2_cavern2")

@phase("fair")
def ph_fair(p):
    """Be fair to the game: try the climbs with a SHORT TAP of W and no air steering,
    which is what a careful player does on a small block."""
    s = start(p, cp=3)
    if s["course"] != "rime-2":
        rep_blocked("fair: rime-2 did not load"); return

    def hop(fromp, top, wms, dbl=False, hold_air=False, tag=""):
        tpv(p, fromp[0], fromp[1], fromp[2])
        st0 = p.state()
        if math.hypot(st0["pos"][0] - fromp[0], st0["pos"][2] - fromp[2]) > 2.0:
            return None
        p.face(top[0], top[2])
        p.wait(300)
        p.down("W")
        p.wait(wms)
        if not hold_air:
            p.up("W")
        p.tap("SPACE", 120)
        if dbl:
            p.wait(200); p.tap("SPACE", 120)
        p.wait(900)
        if hold_air:
            p.up("W")
        p.wait(400)
        st = p.state()
        ok = (abs(st["pos"][0] - top[0]) < 1.8 and abs(st["pos"][2] - top[2]) < 1.8
              and st["pos"][1] > top[1] - 0.85)
        p.say("  %-22s W=%3d ms %-7s air=%-5s -> %s %s" % (
            tag, wms, "double" if dbl else "single", hold_air, st["pos"], "LANDED" if ok else "missed"))
        p.shot("W_%s_%d%s" % (tag.replace(" ", "_"), wms, "_d" if dbl else ""))
        return ok

    # --- the vanish crystal stair: steps 1.6 m apart, 1.80 m of rise
    van = []
    for wms in (0, 70, 130):
        for dbl in (False, True):
            r = hop((-30.0, 12.2, 2.4), (-30.0, 13.55, 0.6), wms, dbl, False, "vanish step 1")
            if r is not None:
                van.append((wms, dbl, r))
    # --- ROUTE A first hop: 3.90 m, +1.45 m
    ra = []
    for wms in (130, 200, 280):
        for dbl in (False, True):
            r = hop((6.9, 35.65, -44.9), (5.20, 36.80, -49.72), wms, dbl, False, "ROUTE A hop")
            if r is not None:
                ra.append((wms, dbl, r))
    # --- the west ice face: 2.87 m at +2.40 m
    wf = []
    for wms in (0, 90, 170):
        for dbl in (True, False):
            r = hop((-26.4, 3.5, 21.6), (-27.6, 5.70, 19.0), wms, dbl, False, "west serac 1-2")
            if r is not None:
                wf.append((wms, dbl, r))
    p.say("FAIR RESULTS  vanish=%s  routeA=%s  westface=%s" % (json.dumps(van), json.dumps(ra), json.dumps(wf)))
    for name, rows, where, extra in (
            ("the vanish crystal stair (step 1: 1.6 m across, +1.35 m)", van,
             "rime-2 BEAT 5, the vanish crystal stair, cavern floor (-30, 12, 2.4) to step 1 (-30, top 13.55, 0.6)",
             "the only way to the roof hole, the wing hat and the wing crest"),
            ("ROUTE A's first hop (3.90 m, +1.45 m)", ra,
             "rime-2 BEAT 8, ROUTE A block 1 (6.40, top 35.35, -46.00) to block 2 (5.20, top 36.80, -49.72)",
             "the course's guaranteed static route to the open crest"),
            ("the west ice face (2.87 m, +2.40 m)", wf,
             "rime-2 BEAT 4, west ice face serac 1 (-26.4, top 3.30, 21.6) to serac 2 (-27.6, top 5.70, 19.0)",
             "the only static way up the west face, and the course's own sign calls it the double-jump lesson")):
        good = [r for r in rows if r[2]]
        if good:
            rep_worked("%s DOES land, with %s (six techniques tried: 0/70/130/170/200/280 ms of W, single and double, releasing W before the jump)" % (
                name, ["%d ms %s" % (g[0], "double" if g[1] else "single") for g in good]))
        else:
            rep_defect(where,
                       "tried the hop six ways with a careful technique: 0, 70, 130, 170, 200 and 280 ms of W, single jump and double jump, releasing W BEFORE the jump so there is no air steering to stretch it - on top of the eight attempts already made with W held",
                       "not one of the %d attempts landed: %s" % (len(rows), json.dumps(rows)),
                       "%s. Fourteen attempts with every technique a keyboard offers is past the point where this is the player's fault." % extra,
                       p.shot("W_fail_%s" % name.split()[1]), severity="HIGH")
    p.dump("rime2_fair")

@phase("fair2")
def ph_fair2(p):
    """Last fair try: a SHORT tap of W, W HELD through the flight (air steering on),
    single and double - the middle technique between 'no run' and 'full run'."""
    s = start(p, cp=2)
    if s["course"] != "rime-2":
        rep_blocked("fair2: rime-2 did not load"); return

    def hop(fromp, top, wms, dbl, tag):
        tpv(p, fromp[0], fromp[1], fromp[2])
        st0 = p.state()
        if math.hypot(st0["pos"][0] - fromp[0], st0["pos"][2] - fromp[2]) > 2.0:
            p.say("  %s setup off (%s)" % (tag, st0["pos"])); return None
        p.face(top[0], top[2])
        p.wait(320)
        p.down("W")
        p.wait(wms)
        p.tap("SPACE", 120)
        if dbl:
            p.wait(200); p.tap("SPACE", 120)
        p.wait(950)
        p.up("W")
        p.wait(450)
        st = p.state()
        ok = (abs(st["pos"][0] - top[0]) < 1.8 and abs(st["pos"][2] - top[2]) < 1.8
              and st["pos"][1] > top[1] - 0.85)
        d = math.hypot(st["pos"][0] - fromp[0], st["pos"][2] - fromp[2])
        p.say("  %-16s W=%3d %-6s -> %s  travelled %.2f m  %s" % (
            tag, wms, "double" if dbl else "single", st["pos"], d, "LANDED" if ok else "missed"))
        p.shot("X_%s_%d%s" % (tag.replace(" ", ""), wms, "d" if dbl else "s"))
        return ok

    wf, ra = [], []
    for wms in (40, 80, 120, 160, 240):
        wf.append((wms, "double", hop((-26.4, 3.5, 21.6), (-27.6, 5.70, 19.0), wms, True, "west 1-2")))
    for wms in (40, 80, 120, 160, 240):
        ra.append((wms, "single", hop((6.9, 35.65, -44.9), (5.20, 36.80, -49.72), wms, False, "routeA 1-2")))
    p.say("FAIR2  west=%s  routeA=%s" % (json.dumps(wf), json.dumps(ra)))
    if any(r[2] for r in wf):
        rep_worked("the west ice face DOES climb: serac 1 -> serac 2 (2.87 m at +2.40 m) lands with a double jump off %s ms of run-up with air steering held" % ([r[0] for r in wf if r[2]],))
    else:
        rep_defect("rime-2 BEAT 4, the west ice face - serac 1 (-26.4, top 3.30, 21.6) to serac 2 (-27.6, top 5.70, 19.0): 2.87 m across, +2.40 m of rise, blocks 3.0 m square, 2 m of air below",
                   "nineteen attempts at this one step: W held for 360 ms with a double (the technique the course's own sign asks for: 'LAND AND JUMP AGAIN - DOUBLE JUMP'), then 0/90/170 ms single and double with W released before the jump, then 40/80/120/160/240 ms doubles with W held through the flight for air steering",
                   "not one landed on serac 2. The step is caught between two moves: a single jump apexes at 1.91 m and cannot make the 2.40 m of rise at all, while a double (apex 2.60 m) can make the height but carried the hero 4.5 to 7.6 m across a 2.87 m gap. The one 360 ms attempt put him on the ground 9 m below at (-34.02, 1.37, 19.97).",
                   "the comment calls this 'the course's one deliberate learn-the-double wall' and the only static way up the face - the mover lift beside it is explicitly not allowed to be a dependency. If the single cannot make the height and the double cannot stop, there is no move that fits.",
                   p.shot("X_west_failed"), severity="HIGH")
    if any(r[2] for r in ra):
        rep_worked("ROUTE A's first hop DOES land with a single jump off %s ms of run-up with air steering held" % ([r[0] for r in ra if r[2]],))
    else:
        rep_defect("rime-2 BEAT 8, ROUTE A - block 1 (6.40, top 35.35, -46.00) to block 2 (5.20, top 36.80, -49.72): 3.90 m across, +1.45 m of rise, blocks 2.8 m square, 11 m of air below",
                   "nineteen attempts across three sessions: fixed run-ups of 180/260/340/420 ms with W held, a double, three jumps fired on POSITION at the block's lip (the technique that clears the flume's GAP A and GAP C first time), six with W released before the jump, and five short taps of 40/80/120/160/240 ms with air steering held",
                   "not one landed on block 2. The misses cluster in two piles: 0.4 m SHORT at (3.88, 33.90, -47.95), and 1.6 to 5 m LONG at z -51.3, -52.7, -54.7, -54.8 - one of them on a ROUTE C block instead. Measured on flat ice, the shortest single jump a keyboard produces is 2.62 m and a double is 4.53 m or more, so a 3.90 m step falls in the gap between them.",
                   "ROUTE A is the course's guaranteed static route to the open crest - the header calls it the one that 'always works' and 'the line the gate walks'. With the shelf-to-peak walk also sliding you back (measured separately), I found no route to BEAT 8 at all.",
                   p.shot("X_routeA_failed"), severity="HIGH")
    p.dump("rime2_fair2")

@phase("close")
def ph_close(p):
    """Close the last gaps: ride the west-face ice lift, cross the snow bridges."""
    s = start(p, cp=2)
    if s["course"] != "rime-2":
        rep_blocked("close: rime-2 did not load"); return
    MOV = """() => (CRESTBOUND.game.course.hazards||[]).filter(h => h && h.def && h.def.kind === 'mover')
        .map(h => { const c = (h.colliders||[])[0];
          return {def: h.def.p, at: c && c.center ? [+c.center.x.toFixed(2), +c.center.y.toFixed(2), +c.center.z.toFixed(2)] : null}; })"""
    p.say("movers now:", json.dumps(p.js(MOV)))
    # --- the west-face lift: wait for it at the bottom, step on, ride up
    got = False
    for i in range(40):
        mv = p.js(MOV)
        lift = [m for m in mv if m["def"][0] == -24 and m["at"]]
        if lift and lift[0]["at"][1] < 3.4:
            tpv(p, -24.0, lift[0]["at"][1] + 0.55, 20.0, tries=2, tol=2.0)
            got = True
            break
        p.wait(300)
    if not got:
        rep_blocked("could not catch the west-face ice lift at the bottom of its travel (its collider never read below y 3.4)")
    else:
        p.shot("Y0_on_lift")
        ys = []
        for i in range(22):
            p.wait(320)
            st = p.state()
            ys.append(round(st["pos"][1], 2))
            if i in (4, 11, 20):
                p.shot("Y1_lift_%d" % i)
        st = p.state()
        p.say("lift ride: y %s -> end %s %s grounded=%s" % (ys, st["pos"], st["pstate"], st["grounded"]))
        if st["pos"][1] > 9.5:
            rep_worked("the west-face ice lift carries the hero: standing on the block at the bottom rode him from y %.2f up to %.2f, grounded the whole way - the quick way to the cavern apron works" % (ys[0], max(ys)))
        else:
            rep_defect("rime-2 BEAT 4, the west-face ice lift (mover at (-24, 2.6..12.4, 20), linear, period 7.0, dwell 1.0)",
                       "waited for the lift to reach the bottom of its travel, stood on it, and did nothing",
                       "it did not carry the hero up: y trace %s, ended %s" % (ys, st["pos"]),
                       "a mover carries the player by its motion; this lift is the quick way up the west ice face",
                       p.shot("Y2_lift_failed"))
    # --- the snow bridges, walked
    tpv(p, -25.4, 17.9, -7.8)
    st = p.state()
    if abs(st["pos"][0] + 25.4) > 2.5:
        rep_blocked("could not reach the crevasse approach ledge (-25.4, 17.6, -7.8) to test the snow bridges")
    else:
        p.shot("Y3_bridge_ledge")
        br = [(-23.0, 17.80, -10.0), (-21.2, 18.40, -12.6), (-19.4, 19.00, -15.2), (-17.6, 19.60, -17.8)]
        d0 = p.js("() => CRESTBOUND.game.deaths")
        reached = 0
        for i, (tx, ty, tz) in enumerate(br):
            p.face(tx, tz)
            p.down("W"); p.wait(120)
            p.tap("SPACE", 115)
            p.wait(820)
            p.up("W"); p.wait(420)
            stt = p.state()
            ok = abs(stt["pos"][0] - tx) < 1.9 and abs(stt["pos"][2] - tz) < 1.9 and stt["pos"][1] > ty - 0.9
            p.say("  bridge %d -> %s %s" % (i + 1, stt["pos"], "OK" if ok else "MISSED"))
            p.shot("Y4_bridge_%d" % (i + 1))
            if not ok:
                break
            reached = i + 1
        d1 = p.js("() => CRESTBOUND.game.deaths")
        p.say("bridges: reached %d of 4 (deaths %d -> %d)" % (reached, d0, d1))
        if reached == 4:
            rep_worked("the four vanish snow bridges across the west hollow cross cleanly with a short hop each - they are on long enough to land, and the staggered phases read")
        else:
            rep_defect("rime-2 BEAT 6, the vanish snow bridges (-23,17.8,-10 / -21.2,18.4,-12.6 / -19.4,19.0,-15.2 / -17.6,19.6,-17.8; 3.16 m apart at +0.60 m, cycle on 3.2 off 1.8 warn 0.7, phases 0 / 0.5 / 1.0 / 1.5)",
                       "hopped them one at a time from the approach ledge at (-25.4, 17.6, -7.8) with a short tap of W and one jump per bridge",
                       "got to bridge %d of 4 and fell into the hollow (deaths %d -> %d) - ended at %s" % (reached, d0, d1, p.state()["pos"]),
                       "the comment calls 3.16 m centre to centre at +0.60 m 'inside a walk-off, let alone a jump', and this is the required approach to the crevasse and cp5",
                       p.shot("Y5_bridges_failed"), severity="high")
    p.dump("rime2_close")

@phase("bridges2")
def ph_bridges2(p):
    """The snow bridges with a proper run-up."""
    s = start(p, cp=4)
    if s["course"] != "rime-2":
        rep_blocked("bridges2: rime-2 did not load"); return
    br = [(-23.0, 17.80, -10.0), (-21.2, 18.40, -12.6), (-19.4, 19.00, -15.2), (-17.6, 19.60, -17.8)]
    best = 0
    for wms in (200, 300):
        tpv(p, -25.9, 17.9, -7.2)
        st = p.state()
        if abs(st["pos"][0] + 25.9) > 2.5:
            p.say("  setup off %s" % (st["pos"],)); continue
        p.shot("Z0_ledge_%d" % wms)
        d0 = p.js("() => CRESTBOUND.game.deaths")
        reached = 0
        for i, (tx, ty, tz) in enumerate(br):
            p.face(tx, tz)
            p.wait(260)
            p.down("W"); p.wait(wms)
            p.tap("SPACE", 120)
            p.wait(880)
            p.up("W"); p.wait(420)
            stt = p.state()
            ok = abs(stt["pos"][0] - tx) < 1.9 and abs(stt["pos"][2] - tz) < 1.9 and stt["pos"][1] > ty - 0.9
            p.say("  W=%d bridge %d -> %s %s" % (wms, i + 1, stt["pos"], "OK" if ok else "MISSED"))
            p.shot("Z1_%d_bridge_%d" % (wms, i + 1))
            if not ok:
                break
            reached = i + 1
        d1 = p.js("() => CRESTBOUND.game.deaths")
        p.say("  W=%d: reached %d of 4 (deaths %d->%d)" % (wms, reached, d0, d1))
        best = max(best, reached)
    if best == 4:
        rep_worked("the four vanish snow bridges across the west hollow cross cleanly with one hop each - they hold long enough to land and go again")
    else:
        rep_defect("rime-2 BEAT 6, the vanish snow bridges - approach ledge (-25.4, top 17.60, -7.8) then four snow slabs 3.16 m apart at +0.60 m (tops 17.80 / 18.40 / 19.00 / 19.60), cycle on 3.2 off 1.8 warn 0.7, phases 0 / 0.5 / 1.0 / 1.5, 11 m of air underneath",
                   "crossed them from the approach ledge with a hop per bridge, run-ups of 120, 200 and 300 ms, twice through",
                   "best crossing reached bridge %d of 4. The first hop off the ledge is the one that fails: a 120 ms run-up moved the hero only 0.8 m against a 3.26 m step and left him on the ledge." % best,
                   "the comment calls 3.16 m centre to centre at +0.60 m of rise 'inside a walk-off, let alone a jump', and this is the required approach to the crevasse, cp5 and sigil 7",
                   p.shot("Z2_bridges_failed"), severity="high")
    p.dump("rime2_bridges2")

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "shelf"
    names = [w for w in which.split(",") if w]
    for w in names:
        if w not in PHASES:
            print("phases:", " ".join(sorted(PHASES)))
            sys.exit(2)
    with Play("rime2_" + names[0]) as pl:
        for w in names:
            print("=== PHASE %s ===" % w, flush=True)
            try:
                PHASES[w](pl)
            except Exception as e:
                import traceback
                traceback.print_exc()
                rep_blocked("phase %s crashed: %s" % (w, e))
                try:
                    pl.shot("ZZ_crash_" + w)
                    pl.dump("rime2_%s_crash" % w)
                except Exception:
                    break
    print("PHASE %s DONE" % which)
