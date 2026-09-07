"""INTERACTIONS lane replay — every station the playtest flagged for the
pound/cannon/interact/collect/clock classes, driven with REAL key events
through _playlib.Play and read back from the live game (not from a diff).

    python _ix_replay.py [--only rime1,az1,...] [--out name]

Each station returns a dict; the run writes _harness/_ix_<out>.json and prints
one PASS/FAIL line per check so a before/after pair can be diffed.
"""
import os, sys, json, time, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

HERE = os.path.dirname(os.path.abspath(__file__))

JS_BREAKABLES = """() => (CRESTBOUND.game.course.hazards||[]).filter(r=>r.def&&r.def.kind==='breakable')
  .map(r=>{const h=r.h; return {p:r.def.p, trig:r.def.trigger||null, drop:r.def.drop||null,
     breakT:h.breakT, intact:(typeof h.intactAt==='function')?h.intactAt(h.time):null,
     colActive:h.collider?!!h.collider.active:null, solved:!!h._solved};})"""
JS_TRIG = "() => Array.from(CRESTBOUND.game.course._triggered||[])"
JS_COINS = "() => CRESTBOUND.game.course.collectibles.counts.coins"
JS_CRESTS = "() => CRESTBOUND.game.course.collectibles.counts.crests"
JS_CLOCK = "() => CRESTBOUND.game.course.clock"
JS_DROPS = """() => { const C=CRESTBOUND.game.course.collectibles; if (!C || C._coinAuthored===undefined) return -1;
  let n=0; for (let i=C._coinAuthored;i<C.coinCount;i++) if (C._cState[i]!==0) n++; return n; }"""


def boot(P, course=None, cp=None):
    for i in range(120):
        if P.js("() => CRESTBOUND.game.state !== 'loading'"):
            break
        P.wait(500)
    P.click_title()
    P.wait(1200)
    P.unlock_all()
    if course:
        goto(P, course, cp)
    return P.state()


def goto(P, course, cp=None):
    if cp is None:
        P.js("(c) => CRESTBOUND.game.__dev.goto(c)", course)
    else:
        P.js("([c,i]) => CRESTBOUND.game.__dev.goto(c, i)", [course, cp])
    for _ in range(90):
        P.wait(400)
        s = P.state()
        if s["course"] == course and s["gstate"] in ("playing", "keep"):
            break
    P.wait(1200)
    return P.state()


def pound(P, tag=""):
    """Jump, then crouch the instant the hero is airborne (a real pound, not a
    grounded crouch = backflip). Returns the state trace."""
    seen = []
    P.down("SPACE")
    airborne = False
    for _ in range(25):
        P.wait(20)
        if not P.js("() => CRESTBOUND.game.player.grounded"):
            airborne = True
            break
    P.down("C")
    P.wait(120)
    P.up("SPACE")
    for _ in range(45):
        P.wait(40)
        st = P.js("() => CRESTBOUND.game.player.state")
        if not seen or seen[-1] != st:
            seen.append(st)
        if st in ("poundLand", "idle", "crouch", "run", "dead"):
            if st == "poundLand" or len(seen) > 2:
                break
    P.up("C")
    P.wait(600)
    st = P.js("() => CRESTBOUND.game.player.state")
    if not seen or seen[-1] != st:
        seen.append(st)
    P.say("   pound%s: airborne=%s trace=%s pos=%s" % ((" " + tag) if tag else "", airborne, ">".join(seen), P.pos()))
    return seen


def brk_at(P, x, z, tol=0.6):
    for b in P.js(JS_BREAKABLES):
        if abs(b["p"][0] - x) < tol and abs(b["p"][2] - z) < tol:
            return b
    return None


def safe_tp(P, x, y, z, freeze=False, tag=""):
    """Teleport and make sure the hero is actually THERE (a tp into a crusher's
    sweep or a beam respawns him at the checkpoint in under a second). On a
    miss, freeze the hazards and try once more. Returns (ok, frozen)."""
    frozen = False
    if freeze:
        P.js("() => CRESTBOUND.game.__dev.freezeHazards(true)"); frozen = True
    for attempt in range(2):
        P.tp(x, y, z); P.wait(600)
        q = P.pos()
        if abs(q[0] - x) < 2.0 and abs(q[2] - z) < 2.0 and abs(q[1] - y) < 3.0:
            return True, frozen
        P.say("   tp %s -> hero at %s (%s) -- died or was pushed; freezing hazards and retrying" % ([x, y, z], q, tag))
        P.js("() => CRESTBOUND.game.__dev.freezeHazards(true)"); frozen = True
        for _ in range(20):
            P.wait(200)
            if P.js("() => CRESTBOUND.game.state === 'playing' && !CRESTBOUND.game.player.dead"):
                break
    return False, frozen


def unfreeze(P):
    P.js("() => CRESTBOUND.game.__dev.freezeHazards(false)")


RESULTS = {}


def check(name, ok, detail=""):
    RESULTS[name] = {"ok": bool(ok), "detail": detail}
    print("  %s %s  %s" % ("PASS" if ok else "FAIL", name, detail), flush=True)


# ----------------------------------------------------------------------------
def st_rime1(P):
    goto(P, "rime-1")
    # ICE PLUG (5, 1.3, 42): stand on it and pound
    safe_tp(P, 5.0, 1.9, 42.0, freeze=True, tag="ice plug")
    before = P.js(JS_COINS); b0 = brk_at(P, 5.0, 42.0)
    tr = pound(P, "ice plug")
    b1 = brk_at(P, 5.0, 42.0)
    check("rime1.plug.breaks", b1 and b1["intact"] is False, json.dumps(b1))
    check("rime1.plug.trigger", "ice-hole-open" in P.js(JS_TRIG), json.dumps(P.js(JS_TRIG)))
    unfreeze(P)
    P.wait(1500)
    after = P.js(JS_COINS); drops = P.js(JS_DROPS)
    check("rime1.plug.coins_drop", after > before or drops > 0, "coins %d -> %d, live dropped coins %s" % (before, after, drops))
    P.shot("rime1_plug_after")
    # HAY WALL on the loft gantry: pound from where a player stands beside it
    safe_tp(P, -27.2, 8.9, 4.4, freeze=True, tag="hay gantry")
    P.face(-27.2, 2.9)
    r = P.walk_to(-27.2, 3.2, tol=0.9, max_ms=3000, tag="to the hay")
    c0 = P.js(JS_CRESTS)
    tr = pound(P, "hay wall")
    b = brk_at(P, -27.2, 2.9)
    check("rime1.hay.breaks", b and b["intact"] is False, json.dumps(b))
    check("rime1.hay.trigger", "hay-wall-broken" in P.js(JS_TRIG), json.dumps(P.js(JS_TRIG)))
    P.shot("rime1_hay_after")
    unfreeze(P)


def st_az1(P):
    goto(P, "azure-1")
    # URN on top: (-7.6, 5.55+0.55 top 6.10, -15.4)
    P.tp(-7.6, 6.6, -15.4); P.wait(700)
    before = P.js(JS_COINS)
    tr = pound(P, "west urn")
    b = brk_at(P, -7.6, -15.4)
    check("az1.urn.breaks", b and b["intact"] is False, json.dumps(b))
    P.wait(1500)
    after = P.js(JS_COINS); drops = P.js(JS_DROPS)
    check("az1.urn.coins_drop", after > before or drops > 0, "coins %d -> %d, live dropped coins %s" % (before, after, drops))
    P.shot("az1_urn_after")
    # TIDE PEDESTAL: on top (-4.5, top 6.3, -33.4)
    P.tp(-4.5, 6.8, -33.4); P.wait(700)
    tr = pound(P, "tide pedestal")
    b = brk_at(P, -4.5, -33.4)
    check("az1.tide.breaks", b and b["intact"] is False, json.dumps(b))
    check("az1.tide.trigger", "tide-drawn" in P.js(JS_TRIG), json.dumps(P.js(JS_TRIG)))
    # CORAL WALL (-32, -5.25, -10.2) with drop crest: pound from beside it (the lagoon floor)
    P.js("() => CRESTBOUND.game.__dev.power('metal', 40)")
    P.tp(-32.0, -6.0, -8.6); P.wait(900)
    s = P.state(); P.say("   at coral: %s %s water=%s" % (s["pos"], s["pstate"], s["inWater"]))
    c0 = P.js(JS_CRESTS)
    tr = pound(P, "coral wall")
    b = brk_at(P, -32.0, -10.2)
    check("az1.coral.breaks", b and b["intact"] is False, json.dumps(b))
    check("az1.coral.trigger", "coral-broken" in P.js(JS_TRIG), json.dumps(P.js(JS_TRIG)))
    P.shot("az1_coral_after")
    # SANCTUM CREST walk-up: roof deck 14.21, dais 15.11, crest (0,16.45,-24)
    goto(P, "azure-1")
    P.tp(0.0, 14.4, -20.0); P.wait(800)
    c0 = P.js(JS_CRESTS)
    r = P.walk_to(0.0, -24.0, tol=0.9, max_ms=4000, tag="walk at the crest")
    st1 = P.state()
    got_walk = P.js(JS_CRESTS) > c0 or st1["gstate"] in ("clear", "card")
    if not got_walk:
        P.face(0.0, -24.0); P.down("W"); P.tap("SPACE", 200); P.wait(900); P.up("W"); P.wait(800)
    st2 = P.state()
    got = P.js(JS_CRESTS) > c0 or st2["gstate"] in ("clear", "card")
    check("az1.sanctum_crest.walk_or_jump_collects", got, "walk=%s pos=%s state=%s" % (got_walk, st2["pos"], st2["gstate"]))
    P.shot("az1_sanctum_crest")


def st_az2(P):
    goto(P, "azure-2")
    # GRATE at (0, 0.1, -5) 6x0.4x6: stand on it, pound, then die and respawn
    safe_tp(P, 0.0, 0.5, -3.7, freeze=True, tag="well grate")
    tr = pound(P, "well grate")
    b = brk_at(P, 0.0, -5.0)
    check("az2.grate.breaks", b and b["intact"] is False, json.dumps(b))
    unfreeze(P)
    P.wait(600)
    # die
    P.js("() => CRESTBOUND.game.__dev.kill('manual')")
    for _ in range(40):
        P.wait(200)
        if P.js("() => CRESTBOUND.game.state === 'playing' && !CRESTBOUND.game.player.dead"):
            break
    P.wait(600)
    b2 = brk_at(P, 0.0, -5.0)
    check("az2.grate.stays_open_after_respawn", b2 and b2["intact"] is False, json.dumps(b2))
    # XII pedestal crest (0, 40.52, -7.4): walk at it from the deck
    safe_tp(P, 0.0, 40.2, -5.6, freeze=True, tag="XII pedestal")
    c0 = P.js(JS_CRESTS)
    r = P.walk_to(0.0, -7.4, tol=0.9, max_ms=3500, tag="walk at the XII crest")
    unfreeze(P)
    st = P.state()
    check("az2.xii_crest.walkup_collects", P.js(JS_CRESTS) > c0 or st["gstate"] in ("clear", "card"), "pos=%s state=%s" % (st["pos"], st["gstate"]))
    # MAINTENANCE CANNON (-5, -10.4, -8.5): walk in from the platform (top -11)
    goto(P, "azure-2")
    P.tp(-2.0, -10.6, -8.5); P.wait(700)
    cannon_station(P, "az2.cannon", -5.0, -8.5, expect=None)


def cannon_station(P, name, bx, bz, expect=None, press_e=True):
    """Walk into the breech at (bx, bz); report whether the hero boards and flies."""
    r = P.walk_to(bx, bz, tol=0.7, max_ms=4000, tag="into the cannon")
    st = P.state()
    boarded = st["pstate"] == "cannon"
    if not boarded and press_e:
        P.tap("E", 120); P.wait(300)
        st = P.state(); boarded = st["pstate"] == "cannon"
    check(name + ".boards", boarded, "pos=%s state=%s dist=%s" % (st["pos"], st["pstate"], r["dist"]))
    if not boarded:
        P.shot(name.replace(".", "_") + "_noboard")
        return
    # let it auto-fire, or fire it
    fired = False
    peak = None
    for i in range(70):
        P.wait(60)
        s = P.js("() => { const P=CRESTBOUND.game.player; return {st:P.state, y:+P.pos.y.toFixed(2), x:+P.pos.x.toFixed(2), z:+P.pos.z.toFixed(2), vy:+P.vel.y.toFixed(1)}; }")
        if s["st"] != "cannon":
            fired = True
            if peak is None or s["y"] > peak["y"]:
                peak = s
        if i == 25 and not fired:
            P.tap("SPACE", 120)
    if not fired:
        P.tap("SPACE", 150)
        for i in range(30):
            P.wait(60)
            s = P.js("() => { const P=CRESTBOUND.game.player; return {st:P.state, y:+P.pos.y.toFixed(2), x:+P.pos.x.toFixed(2), z:+P.pos.z.toFixed(2)}; }")
            if s["st"] != "cannon":
                fired = True
                if peak is None or s["y"] > peak["y"]:
                    peak = s
    check(name + ".fires", fired, "peak=%s" % json.dumps(peak))
    # land
    for i in range(80):
        P.wait(80)
        if P.js("() => CRESTBOUND.game.player.grounded || CRESTBOUND.game.player.dead"):
            break
    s = P.state()
    d = None
    if expect:
        d = math.hypot(s["pos"][0] - expect[0], s["pos"][2] - expect[2])
    check(name + ".lands", (not expect) or (d is not None and d < 3.5 and abs(s["pos"][1] - expect[1]) < 2.5),
          "landed %s state=%s expect=%s d=%s" % (s["pos"], s["pstate"], expect, None if d is None else round(d, 2)))
    P.shot(name.replace(".", "_") + "_landed")


def st_az3(P):
    goto(P, "azure-3")
    # crate (-22, 30.6, 44.6): pound from on top -> coins should drop
    P.tp(-22.0, 31.6, 44.6); P.wait(700)
    before = P.js(JS_COINS)
    pound(P, "west crate")
    b = brk_at(P, -22.0, 44.6)
    check("az3.crate.breaks", b and b["intact"] is False, json.dumps(b))
    P.wait(1800)
    after = P.js(JS_COINS); drops = P.js(JS_DROPS)
    check("az3.crate.coins_drop", after > before or drops > 0, "coins %d -> %d, live dropped coins %s" % (before, after, drops))
    # cage on the sunken isle (0, 22.2, 68): pound beside it on the isle deck
    P.tp(0.0, 21.2, 65.6); P.wait(700)
    P.walk_to(0.0, 66.6, tol=0.6, max_ms=2500, tag="to the cage face")
    c0 = P.js(JS_CRESTS)
    pound(P, "beside the cage")
    b = brk_at(P, 0.0, 68.0)
    check("az3.cage.breaks_from_beside", b and b["intact"] is False, json.dumps(b))
    P.shot("az3_cage_after")
    # GRAND PEDESTAL walk-up (42, 60.6, -64)
    safe_tp(P, 39.2, 59.2, -64.0, tag="grand pedestal")
    c0 = P.js(JS_CRESTS)
    r = P.walk_to(42.0, -64.0, tol=0.8, max_ms=4000, tag="walk at the grand pedestal")
    st = P.state()
    check("az3.grand_crest.walkup_collects", P.js(JS_CRESTS) > c0 or st["gstate"] in ("clear", "card"), "pos=%s state=%s" % (st["pos"], st["gstate"]))
    # CANNON isle-1-2 at (30, 39, -3) -> target (46, 44.6, -16)
    goto(P, "azure-3")
    P.tp(26.0, 38.2, -3.0); P.wait(700)
    cannon_station(P, "az3.cannon1", 30.0, -3.0, expect=(46.0, 44.6, -16.0))


def st_e3(P):
    # CLOCK at hand-over: fresh load WITH the intro (flags cleared), then via goto
    P.js("() => { try { CRESTBOUND.game.save.flags.set('intro:ember-3', false); } catch(e){} }")
    P.js("() => CRESTBOUND.game.loadCourse('ember-3', {})")
    first = None
    for _ in range(400):
        P.wait(25)
        s = P.js("() => ({st:CRESTBOUND.game.state, c:CRESTBOUND.game.course&&CRESTBOUND.game.course.def.id, clk:CRESTBOUND.game.course?CRESTBOUND.game.course.clock:null})")
        if s["c"] == "ember-3" and s["st"] == "playing":
            first = s; break
    check("e3.clock_at_handover_with_intro", first and first["clk"] is not None and first["clk"] < 1.0, json.dumps(first))
    goto(P, "azure-1")
    P.js("() => CRESTBOUND.game.__dev.goto('ember-3')")
    first = None
    for _ in range(400):
        P.wait(25)
        s = P.js("() => ({st:CRESTBOUND.game.state, c:CRESTBOUND.game.course&&CRESTBOUND.game.course.def.id, clk:CRESTBOUND.game.course?CRESTBOUND.game.course.clock:null})")
        if s["c"] == "ember-3" and s["st"] == "playing":
            first = s; break
    check("e3.clock_at_handover_goto", first and first["clk"] is not None and first["clk"] < 1.0, json.dumps(first))
    P.wait(1500)
    # buried pad coin at cp-plaza (0, 1.6, 40)
    before = P.js(JS_COINS)
    P.tp(0.0, 2.0, 41.5); P.wait(500)
    P.walk_to(0.0, 39.0, tol=0.5, max_ms=2500, tag="across the cp pad")
    P.wait(800)
    after = P.js(JS_COINS)
    near = P.js("""() => { const C=CRESTBOUND.game.course.collectibles, P=CRESTBOUND.game.player; const out=[];
        for (let i=0;i<C.coinCount;i++){ const x=C._cHome[i*3],y=C._cHome[i*3+1],z=C._cHome[i*3+2];
          const d=Math.hypot(x-0,z-40); if (d<1.6) out.push({i,x:+x.toFixed(2),y:+y.toFixed(2),z:+z.toFixed(2),st:C._cState[i]}); }
        return out; }""")
    check("e3.pad_coin.collects", all(c["st"] != 1 for c in near) and len(near) > 0, "coins %d -> %d near=%s" % (before, after, json.dumps(near)))
    # SHAFT-GUN cannon (30, 5.6, 6) -> target (13.5, 15.6, -20)
    P.tp(30.0, 5.2, 10.0); P.wait(700)
    cannon_station(P, "e3.cannon", 30.0, 6.0, expect=(13.5, 15.6, -20.0))


def st_e4(P):
    goto(P, "ember-4")
    # DRAIN STONE (-20, 1.55, 34) top 2.35: on top, pound -> coins
    P.tp(-20.0, 2.9, 34.0); P.wait(700)
    before = P.js(JS_COINS)
    pound(P, "drain stone")
    b = brk_at(P, -20.0, 34.0)
    check("e4.drain.breaks", b and b["intact"] is False, json.dumps(b))
    P.wait(1800)
    after = P.js(JS_COINS); drops = P.js(JS_DROPS)
    check("e4.drain.coins_drop", after > before or drops > 0, "coins %d -> %d, live dropped coins %s" % (before, after, drops))
    # GLYPH WALL (0, 5.5, -64.5) half [2.8,1.5,0.45]: pound 0.5 m off its face
    safe_tp(P, 0.0, 4.8, -62.0, freeze=True, tag="glyph wall")
    P.walk_to(0.0, -63.6, tol=0.5, max_ms=2500, tag="to the glyph wall")
    c0 = P.js(JS_CRESTS)
    pound(P, "glyph wall")
    b = brk_at(P, 0.0, -64.5)
    check("e4.glyph.breaks_from_beside", b and b["intact"] is False, json.dumps(b))
    check("e4.glyph.trigger", "glyph-wall" in P.js(JS_TRIG), json.dumps(P.js(JS_TRIG)))
    P.shot("e4_glyph_after")
    unfreeze(P)
    # RACE start pad (-4, 19.5, -22)
    safe_tp(P, -4.0, 20.0, -22.0, tag="race pad")
    P.wait(900)
    rc = P.js("() => { const C=CRESTBOUND.game.course.collectibles; return {active:C.race.active, ms:C.race.ms, snap:CRESTBOUND.game.__dev.state().raceMs}; }")
    check("e4.race.arms_on_start_pad", rc["active"], json.dumps(rc))
    check("e4.race.hud_snap_reads_ms", rc["snap"] is not None, json.dumps(rc))
    # PYLON CANNON breech (0, 5.03, 6.4) -> target (5.5, 12.6, -9.5)
    goto(P, "ember-4")
    safe_tp(P, 0.0, 5.4, 9.5, tag="pylon cannon")
    cannon_station(P, "e4.cannon", 0.0, 6.4, expect=(5.5, 12.6, -9.5))
    # BUMBLER pound from above: find a live bumbler
    bp = P.js("""() => { const c=(CRESTBOUND.game.course.critters||[]).find(c=>c.kind==='bumbler'&&c.state==='walk'); return c?[c.pos.x,c.pos.y,c.pos.z]:null; }""")
    if bp:
        before = P.js(JS_COINS)
        P.tp(bp[0], bp[1] + 2.6, bp[2]); P.wait(150)
        P.down("C"); P.wait(1200); P.up("C"); P.wait(1200)
        stt = P.js("() => (CRESTBOUND.game.course.critters||[]).filter(c=>c.kind==='bumbler').map(c=>c.state)")
        check("e4.bumbler.pound_squishes", "squished" in stt, "states=%s coins %d -> %d" % (stt, before, P.js(JS_COINS)))


def st_v2(P):
    goto(P, "verdant-2")
    # PORTCULLIS (0, 19.2, 9.4) s [3.6,4,0.6]: pound in front of it on the race pad (0,18.36,10.08)
    P.tp(0.0, 18.8, 11.5); P.wait(700)
    P.walk_to(0.0, 10.0, tol=0.5, max_ms=2500, tag="to the portcullis")
    pound(P, "portcullis")
    b = brk_at(P, 0.0, 9.4)
    check("v2.portcullis.breaks_from_front", b and b["intact"] is False, json.dumps(b))
    check("v2.portcullis.trigger", "portcullis-up" in P.js(JS_TRIG), json.dumps(P.js(JS_TRIG)))
    P.shot("v2_portcullis_after")
    # GNASHER WEST POST (-7, 5.4, 26.5): pound beside it x3 (freeze the gnashers' bite for the replay)
    P.js("() => CRESTBOUND.game.__dev.setClock(0)")
    gn = P.js("""() => { const g=(CRESTBOUND.game.course.critters||[]).filter(c=>c.kind==='gnasher'); return g.map(c=>({post:[c.post.x,c.post.y,c.post.z], pounds:c.pounds, freed:c.freed})); }""")
    P.say("   gnashers: %s" % json.dumps(gn))
    for i in range(3):
        P.tp(-7.9, 6.2, 26.5); P.wait(300)
        P.down("C"); P.wait(1000); P.up("C"); P.wait(600)
    gn2 = P.js("""() => (CRESTBOUND.game.course.critters||[]).filter(c=>c.kind==='gnasher').map(c=>({pounds:c.pounds, freed:c.freed}))""")
    check("v2.gnasher_post.three_pounds_free", any(g["freed"] for g in gn2), json.dumps(gn2))
    # DROWNED CREST (0, -1.4, 39.5) type power 'metal': no hat -> locked; hat -> collect
    goto(P, "verdant-2")
    P.js("() => { CRESTBOUND.game._clearPower && CRESTBOUND.game._clearPower(); }")
    # the moat current (2.6 m/s east, another lane) sweeps a swimmer off the line, so the
    # station teleports ONTO the crest's spot: the question here is the power gate only
    c0 = P.js(JS_CRESTS)
    P.tp(0.0, -1.5, 39.5); P.wait(1200)
    st = P.state()
    locked = P.js("() => { const C=CRESTBOUND.game.course.collectibles; const c=(C.crests||[]).find(c=>c.type==='power'); return c ? {lockedCd:c.lockedCd, taken:c.taken} : null; }")
    check("v2.drowned.locked_without_hat", P.js(JS_CRESTS) == c0 and st["gstate"] not in ("clear", "card") and locked and locked["lockedCd"] > 0, "pos=%s state=%s power=%s crest=%s" % (st["pos"], st["gstate"], P.js("() => CRESTBOUND.game.player.power"), json.dumps(locked)))
    P.js("() => CRESTBOUND.game.__dev.power('metal', 30)")
    P.wait(300)
    P.tp(0.0, -1.5, 39.5); P.wait(1500)
    st = P.state()
    check("v2.drowned.collects_with_hat", P.js(JS_CRESTS) > c0 or st["gstate"] in ("clear", "card"), "pos=%s state=%s" % (st["pos"], st["gstate"]))


def st_v3(P):
    goto(P, "verdant-3")
    # MEZZANINE breakable (-8, 17.2, -16): pound from on top
    P.tp(-8.0, 18.2, -16.0); P.wait(700)
    c0 = P.js(JS_CRESTS)
    pound(P, "mezzanine")
    b = brk_at(P, -8.0, -16.0)
    check("v3.mezzanine.breaks", b and b["intact"] is False, json.dumps(b))
    P.wait(1200)
    st = P.state()
    P.say("   after the mezzanine: %s %s grounded=%s" % (st["pos"], st["pstate"], st["grounded"]))
    # BELL (4, 20.6, -30) 1.7x2x1.7: pound beside it
    goto(P, "verdant-3")
    P.tp(4.0, 20.0, -27.6); P.wait(700)
    P.walk_to(4.0, -28.6, tol=0.5, max_ms=2500, tag="to the bell")
    pound(P, "bell")
    b = brk_at(P, 4.0, -30.0)
    check("v3.bell.breaks_from_beside", b and b["intact"] is False, json.dumps(b))
    # CHAFF CANNON (14, 23.1, -40) -> target (47, SKY_TOP+0.6, -48)
    tgt = P.js("() => { const r=(CRESTBOUND.game.course.hazards||[]).find(r=>r.def&&r.def.kind==='cannon'); return r&&r.def.target?r.def.target:null; }")
    P.tp(14.0, 23.6, -36.5); P.wait(700)
    cannon_station(P, "v3.cannon", 14.0, -40.0, expect=tuple(tgt) if tgt else None)


def st_keep(P):
    P.js("() => CRESTBOUND.game.returnToKeep()")
    for _ in range(60):
        P.wait(400)
        s = P.state()
        if s["course"] == "keep" and s["gstate"] == "keep":
            break
    P.wait(1000)
    sp = P.js("() => CRESTBOUND.game.__dev.goto ? null : null")
    # spawn pad prompt
    P.tp(0.0, 0.2, -1.0); P.wait(900)
    pr = P.js("() => { const e=document.getElementById('cb-prompt'); return {show:e&&e.classList.contains('show'), text:e?e.textContent.trim().replace(/\\s+/g,' '):null}; }")
    check("keep.no_fen_prompt_on_spawn", not (pr["show"] and pr["text"] and "FEN" in pr["text"].upper()), json.dumps(pr))
    # walk to Fen (17, 6.35, -21) and press E
    P.tp(19.5, 6.4, -21.0); P.wait(800)
    P.walk_to(18.3, -21.0, tol=0.5, max_ms=2500, tag="up to Old Fen")
    P.wait(400)
    pr = P.js("() => { const e=document.getElementById('cb-prompt'); return {show:e&&e.classList.contains('show'), text:e?e.textContent.trim().replace(/\\s+/g,' '):null}; }")
    check("keep.fen_prompt_near_fen", pr["show"] and "FEN" in (pr["text"] or "").upper(), json.dumps(pr))
    line0 = P.js("() => CRESTBOUND.game._fenLine")
    P.tap("E", 120); P.wait(700)
    line1 = P.js("() => CRESTBOUND.game._fenLine")
    toast = P.js("() => { const t=[...document.querySelectorAll('[class*=toast]')].map(e=>e.textContent.trim().replace(/\\s+/g,' ')).filter(Boolean); return t.slice(-3); }")
    check("keep.fen_talks_on_E", line1 > line0, "fenLine %s -> %s toast=%s" % (line0, line1, json.dumps(toast)))
    P.shot("keep_fen_talk")


STATIONS = {"rime1": st_rime1, "az1": st_az1, "az2": st_az2, "az3": st_az3, "e3": st_e3,
            "e4": st_e4, "v2": st_v2, "v3": st_v3, "keep": st_keep}


def main():
    only = None
    out = "replay"
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--only": only = args[i + 1].split(","); i += 2
        elif args[i] == "--out": out = args[i + 1]; i += 2
        else: i += 1
    with Play("ix_" + out) as P:
        boot(P)
        for k, fn in STATIONS.items():
            if only and k not in only:
                continue
            print("\n=== %s ===" % k, flush=True)
            try:
                fn(P)
            except Exception as e:
                print("  STATION ERROR %s: %r" % (k, e), flush=True)
                RESULTS["%s.station_error" % k] = {"ok": False, "detail": repr(e)}
            P.release_all()
        errs = [c for c in P.console if "error" in c.lower()][:12]
        path = os.path.join(HERE, "_ix_%s.json" % out)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"results": RESULTS, "console": P.console[:80]}, f, indent=1)
        npass = sum(1 for r in RESULTS.values() if r["ok"])
        print("\n%d / %d checks pass -> %s" % (npass, len(RESULTS), path))
        if errs:
            print("console errors:", json.dumps(errs, indent=1))


if __name__ == "__main__":
    main()
