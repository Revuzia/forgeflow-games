"""WATER LANE — replay the playtest water stations with REAL input and read the frame.

Stations (each replays what the tester did, in the tester's own words):
  keep_fountain   K2/K10 + owner screenshot 3: rim look, hop in, swim, CROUCH to sink,
                  underwater frame, six surface-hop exits over the 1.10 m rim.
  v3_river        V3-03 (frozen at log A), V3-11 (white sheet / no underwater look),
                  V3-09 (swim out north), V3-10 (sink onto sigil 1 against the current).
  v2_moat         V2-02 (surface bands from the quay), V2-03 (camera at the water line).
  v1_brook        verdant-1 brook: underwater frame, swim out north.
  az1_lagoon      P8: float over the tidewell looking down; the shoal; the wading shelf.

    python _wl_replay.py --tag before --stations keep_fountain,v3_river
"""
import argparse, json, os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

HERE = os.path.dirname(os.path.abspath(__file__))

LOAD_JS = r"""async (id) => { const G=CRESTBOUND.game; const t0=performance.now();
  const live=()=>G.course&&G.courseId===id&&(G.state==='playing'||G.state==='keep');
  if (!live()) await G.__dev.goto(id);
  const tick=()=>new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};requestAnimationFrame(f);setTimeout(f,60);});
  while(performance.now()<t0+40000&&!live()) await tick(); return live(); }"""

POST_JS = r"""() => { const P = CRESTBOUND.engine.post; if (!P) return null;
  const out = { target: P._underwaterTarget, cur: P._underwater };
  for (const k of Object.keys(P)) { const v = P[k]; if (v && v.uniforms && v.uniforms.uUnderwater) out.uniform = v.uniforms.uUnderwater.value; }
  if (out.uniform === undefined && P.composer) for (const p of P.composer.passes) if (p.uniforms && p.uniforms.uUnderwater) out.uniform = p.uniforms.uUnderwater.value;
  return out; }"""

def cam(P, yaw=None, pitch=None):
    P.js("([y,p]) => { const c = CRESTBOUND.game.cam; if (y !== null) c.yaw = y; if (p !== null) c.pitch = p; c._rcHoldT = 0; if (c.snapToPlayer) c.snapToPlayer(); }", [yaw, pitch])
    P.wait(350)

def st_line(P, tag):
    s = P.state(); post = P.js(POST_JS)
    P.say("  [%s] pos %s vel %s state %s grounded %s inWater %s submerged %s camPos %s post %s" % (
        tag, s["pos"], s["vel"], s["pstate"], s["grounded"], s["inWater"], s["submerged"], s["camPos"], json.dumps(post)))
    return s

# --------------------------------------------------------------------- KEEP
def keep_fountain(P):
    P.say("=== KEEP: the parterre / fountain ===")
    assert P.js(LOAD_JS, "keep"); P.wait(1200)
    # the basin centre z is authored (FZ) and has moved between trees: read it live
    FZ = P.js("() => CRESTBOUND.game.course.def.waters[0].p[2]")
    P.say("  fountain centre z = %s (rim faces z %.1f / %.1f)" % (FZ, FZ - 5.2, FZ + 5.2))
    P.say("  BED under the basin centre: terrain heightAt(0, FZ) = %s  (the marble slab is at -1.30; pass-1 fix carved the lawn to -2.20 under it)" % P.js(HF_JS, [0, FZ]))
    # the owner's angle: on the lawn south of the rim, looking north at the pool
    P.tp(0, 0.2, FZ - 8.5); P.wait(300); P.face(0, FZ); cam(P, yaw=math.pi, pitch=0.18)
    P.shot("keep_rim_look_south")
    st_line(P, "rim look")
    # walk up to the rim on foot (tester: walk_to 25.0 when FZ was 30)
    P.walk_to(0, FZ - 5.4, tol=0.8, max_ms=6000, tag="up to the rim")
    P.face(0, FZ); cam(P, yaw=math.pi, pitch=0.30)
    P.shot("keep_at_the_rim")
    # hop the rim (tester recipe)
    P.down("W"); P.wait(420); P.tap("SPACE", 240); P.wait(1100); P.up("W"); P.wait(900)
    s = st_line(P, "after rim hop")
    if not s["inWater"]:
        P.tp(0, 0.2, FZ - 6.6); P.face(0, FZ); cam(P, yaw=math.pi, pitch=0.30)
        P.down("W"); P.wait(520); P.tap("SPACE", 260); P.wait(1200); P.up("W"); P.wait(900)
        s = st_line(P, "after rim hop #2")
    P.shot("keep_in_the_pool")
    # swim north 1.6 s
    P.face(0, FZ + 3.0); P.hold(["W"], 1600, sample_ms=400, tag="swimming north")
    s = st_line(P, "swimming")
    # K10: CROUCH 1.5 s -> does y drop, does submerged flip, does the post tint?
    y0 = s["pos"][1]
    P.down("C"); samples = []
    for i in range(6):
        P.wait(250); ss = P.state(); samples.append([ss["pos"][1], ss["submerged"], ss["pstate"]])
    P.shot("keep_crouch_held")
    post = P.js(POST_JS)
    P.say("  K10 crouch: y %.2f -> %s  post %s" % (y0, json.dumps(samples), json.dumps(post)))
    # evidence for the camera lane: with cam.setPost(engine.post) injected, does the grade fire while submerged?
    wired = P.js("() => { const G = CRESTBOUND.game; if (!G.cam || typeof G.cam.setPost !== 'function') return 'no setPost'; G.cam.setPost(CRESTBOUND.engine.post); return 'wired'; }")
    P.wait(700); post2 = P.js(POST_JS); ss = P.state()
    P.say("  UNDERWATER GRADE after injecting cam.setPost(engine.post): %s  submerged %s  post %s" % (wired, ss["submerged"], json.dumps(post2)))
    P.shot("keep_crouch_held_grade_wired")
    P.up("C"); P.wait(500)
    s = st_line(P, "after crouch release")
    P.shot("keep_after_crouch")
    # exits: six surface hops at the south rim with W held (the tester needed four tries)
    exits = 0; tries = 6; ends = []
    for i in range(tries):
        P.tp(0, 0.3, FZ - 2.8); P.wait(400); P.face(0, FZ - 6.0); cam(P, yaw=0.0, pitch=0.25)
        P.down("W"); P.wait(500); P.tap("SPACE", 200); P.wait(1500); P.up("W"); P.wait(500)
        ss = P.state(); ends.append([ss["pos"], ss["pstate"], ss["inWater"]])
        # OUT = not in the water, south of the rim's outer face (z FZ-5.2), alive. (Pass 1 demanded
        # y > 0.9 as well - i.e. standing ON the rim - but W held through the hop runs the hero off
        # the 1 m rim onto the lawn at y 0: pass 1's "0/6" ends at z 7-9 were all on the lawn, OUT.)
        if (not ss["inWater"]) and ss["pos"][2] < FZ - 5.2 and ss["gstate"] != "dead": exits += 1
    P.say("  RIM EXIT: %d / %d surface hops got out over the 1.10 rim (rim outer face z %.1f)  ends=%s" % (exits, tries, FZ - 5.2, json.dumps(ends)))
    P.shot("keep_after_exit_tries")
    return {"exits": exits, "tries": tries, "crouch": samples}

# ---------------------------------------------------------------- VERDANT-3
def v3_river(P):
    P.say("=== VERDANT-3: the river ===")
    assert P.js(LOAD_JS, "verdant-3"); P.wait(1200)
    # V3-11: in the water between the logs, the tester's frame 11 angle
    P.tp(2.9, 0.4, 29.0); P.wait(600); P.face(0, 20); cam(P, yaw=-0.12, pitch=0.22)
    P.wait(500); P.shot("v3_in_the_river")
    st_line(P, "in the river")
    # V3-03: swim north into log A's south face (log spans z 30.7..34.3), tap SPACE twice
    P.tp(0, 0.3, 36.2); P.wait(500); P.face(0, 30.0); cam(P, yaw=0.0, pitch=0.2)
    P.down("W"); rows = []
    for i in range(10):
        P.wait(170); ss = P.state(); rows.append([ss["pos"], ss["vel"], ss["pstate"]])
        if i == 3 or i == 7: P.tap("SPACE", 120)
    P.up("W"); P.wait(300)
    P.say("  V3-03 log A push: " + json.dumps(rows))
    onlog = rows[-1][0][1] > 1.0
    P.say("  V3-03 -> %s (final y %.2f, z %.2f)" % ("ON THE LOG" if onlog else "NOT on the log", rows[-1][0][1], rows[-1][0][2]))
    P.shot("v3_log_a_push")
    # V3-11 underwater: sink to the bed at the tester's spot and look east along the river
    P.tp(-8.8, -1.5, 28.2); P.wait(400); P.face(20, 28.2); cam(P, yaw=-math.pi/2 + 0.1, pitch=0.05)
    P.down("C"); P.wait(1400); P.up("C"); P.wait(400)
    s = st_line(P, "on the bed")
    P.shot("v3_underwater_bed")
    # look UP at the surface from below
    cam(P, yaw=None, pitch=-0.5); P.wait(300); P.shot("v3_underwater_lookup")
    # V3-09: fall in at [0,0.2,29], hold W toward the north jetty for 6 s
    P.tp(0, 0.2, 29.0); P.wait(400); P.face(0, 21.0); cam(P, yaw=0.0, pitch=0.2)
    rows = P.hold(["W"], 6000, sample_ms=600, tag="swim north to the jetty")
    P.face(0, 21.0)
    ss = P.state(); P.say("  V3-09 end: pos %s state %s grounded %s inWater %s" % (ss["pos"], ss["pstate"], ss["grounded"], ss["inWater"]))
    P.shot("v3_swim_out_north")
    # ...and from wherever the current left him at the north bank: keep W north, tap SPACE every 2 s, 10 s
    d0 = P.js(DEATHS_JS); x0 = ss["pos"][0]; P.face(x0, 5.0); cam(P, yaw=0.0, pitch=0.2)
    rows = []; P.down("W"); out_t = None
    for i in range(20):
        P.wait(500)
        if i % 4 == 0: P.tap("SPACE", 120)
        ss = P.state(); g = P.js(HF_JS, [ss["pos"][0], ss["pos"][2]])
        rows.append([ss["pos"], ss["pstate"], ss["grounded"], ss["inWater"], g])
        if ss["gstate"] == "dead": break
        if (not ss["inWater"]) and ss["grounded"] and ss["pos"][1] > 0.9: out_t = 0.5 * (i + 1); break
    P.up("W"); P.wait(300); ss = P.state()
    P.say("  V3-09 north bank from the current's drop-off (W + a SPACE tap every 2 s): %s at %s state %s grounded %s inWater %s terrain %s deaths %s->%s" % (
        ("OUT after %.1f s" % out_t) if out_t else "NOT OUT after %.1f s" % (0.5 * len(rows)), ss["pos"], ss["pstate"], ss["grounded"], ss["inWater"],
        P.js(HF_JS, [ss["pos"][0], ss["pos"][2]]), d0, P.js(DEATHS_JS)))
    P.say("     trace [x, y, z, state, grounded, inWater, terrain]: " + json.dumps([[r[0][0], r[0][1], r[0][2], r[1][:6], r[2], r[3], r[4]] for r in rows]))
    P.shot("v3_north_bank_out")
    # V3-10: float over sigil 1 [-14,-3.3,28] and hold C 3 s
    P.tp(-14.1, -0.1, 28.05); P.wait(400)
    P.down("C"); rows = []
    for i in range(6):
        P.wait(500); ss = P.state(); rows.append(ss["pos"])
    P.up("C"); P.wait(300)
    P.say("  V3-10 sink over sigil 1 (C only, the tester's first 3 s): " + json.dumps(rows))
    # the surfaces lane's authored recipe: crouch AND hold west against the 2.8 m/s flow
    P.tp(-14.1, -0.1, 28.05); P.wait(400); P.face(-40.0, 28.05); cam(P, yaw=math.pi/2, pitch=0.2)
    sig0 = P.js("() => CRESTBOUND.game.course.collectibles ? CRESTBOUND.game.course.collectibles.counts.sigils : null")
    P.down("C", "W"); rows = []
    for i in range(8):
        P.wait(500); ss = P.state(); rows.append(ss["pos"])
    P.up("C", "W"); P.wait(300)
    sig1 = P.js("() => CRESTBOUND.game.course.collectibles ? CRESTBOUND.game.course.collectibles.counts.sigils : null")
    P.say("  V3-10 sink over sigil 1 (C + W west, the authored recipe): %s  sigils %s -> %s" % (json.dumps(rows), sig0, sig1))
    # the player's recipe: C alone until under the current band (y < -2.7), then W west to the sigil at (-14, -3.3, 28)
    P.tp(-11.0, -0.1, 28.05); P.wait(400); P.face(-40.0, 28.05); cam(P, yaw=math.pi/2, pitch=0.2)
    sig0 = P.js("() => CRESTBOUND.game.course.collectibles ? CRESTBOUND.game.course.collectibles.counts.sigils : null")
    P.down("C"); rows = []
    for i in range(10):
        P.wait(400); ss = P.state(); rows.append(ss["pos"])
        if ss["pos"][1] < -2.8: break
    P.down("W")
    for i in range(12):
        P.wait(400); ss = P.state(); rows.append(ss["pos"])
        sg = P.js("() => CRESTBOUND.game.course.collectibles ? CRESTBOUND.game.course.collectibles.counts.sigils : null")
        if sg and sig0 is not None and sg > sig0: break
    P.up("C", "W"); P.wait(300)
    sig1 = P.js("() => CRESTBOUND.game.course.collectibles ? CRESTBOUND.game.course.collectibles.counts.sigils : null")
    P.say("  V3-10 player's recipe (sink under the current band first, then swim west): %s  sigils %s -> %s" % (json.dumps(rows), sig0, sig1))
    P.shot("v3_sigil1_recipe")
    # V3-09 "the current carries you EAST until the channel shallows and you walk out - a lesson, not a death":
    # fall in mid-crossing, hands off, up to 40 s; then from wherever it leaves you, hold W toward the near bank
    d0 = P.js(DEATHS_JS)
    P.tp(0, 0.2, 29.0); P.wait(400); P.release_all()
    rows = []
    for i in range(40):
        P.wait(1000); ss = P.state(); g = P.js(HF_JS, [ss["pos"][0], ss["pos"][2]])
        rows.append([ss["pos"], ss["pstate"], ss["grounded"], ss["inWater"], g])
        if ss["gstate"] == "dead" or (ss["grounded"] and not ss["inWater"]): break
        if i >= 3 and abs(rows[-1][0][0] - rows[-2][0][0]) < 0.05 and abs(rows[-1][0][2] - rows[-2][0][2]) < 0.05: break
    ss = P.state()
    P.say("  V3-09 drift, hands off: end %s state %s grounded %s inWater %s terrain %s after %d s deaths %s->%s" % (
        ss["pos"], ss["pstate"], ss["grounded"], ss["inWater"], P.js(HF_JS, [ss["pos"][0], ss["pos"][2]]), len(rows), d0, P.js(DEATHS_JS)))
    P.say("     trace [x, y, z, state, terrain]: " + json.dumps([[r[0][0], r[0][1], r[0][2], r[1][:6], r[4]] for r in rows]))
    P.shot("v3_drift_end")
    # from there: toward the SOUTH bank (the quay side) with W, 8 s
    x0 = ss["pos"][0]
    P.face(x0, 45.0); cam(P, yaw=math.pi, pitch=0.2)
    rows = P.hold(["W"], 8000, sample_ms=800, tag="from the drift end, W to the south bank")
    ss = P.state(); g = P.js(HF_JS, [ss["pos"][0], ss["pos"][2]])
    P.say("  V3-09 walk-out south: end %s state %s grounded %s inWater %s terrain %s deaths %s" % (ss["pos"], ss["pstate"], ss["grounded"], ss["inWater"], g, P.js(DEATHS_JS)))
    P.shot("v3_drift_walkout_south")
    return {}

# ---------------------------------------------------------------- VERDANT-2
def v2_moat(P):
    P.say("=== VERDANT-2: the moat ===")
    assert P.js(LOAD_JS, "verdant-2"); P.wait(1200)
    P.tp(0, 1.7, 47.5); P.wait(500); P.face(0, 30); cam(P, yaw=0.0, pitch=0.20)
    P.wait(400); P.shot("v2_moat_from_quay")
    st_line(P, "quay")
    # V2-03: run off the quay north, miss the sinker, stay in the water, look back at the shore
    P.face(0, 40.0); P.down("W"); P.wait(1500); P.up("W"); P.wait(1200)
    s = st_line(P, "in the moat")
    P.face(0, 48.0); cam(P, yaw=math.pi, pitch=0.05); P.wait(500)
    P.shot("v2_moat_waterline_lookback")
    P.tp(11.7, -0.6, 41.4); P.wait(500); P.face(0, 48); cam(P, yaw=2.6, pitch=0.02); P.wait(400)
    P.shot("v2_moat_waterline_east")
    st_line(P, "east")
    return {}

# ---------------------------------------------------------------- VERDANT-1
def v1_brook(P):
    P.say("=== VERDANT-1: the brook ===")
    assert P.js(LOAD_JS, "verdant-1"); P.wait(1200)
    P.tp(0, 1.0, 22.0); P.wait(800)
    s = st_line(P, "fell in")
    P.face(0, 13.0); cam(P, yaw=0.0, pitch=0.15); P.wait(300); P.shot("v1_brook_surface")
    P.down("C"); P.wait(1200); P.up("C"); P.wait(300)
    s = st_line(P, "sunk")
    P.shot("v1_brook_underwater")
    rows = P.hold(["W"], 6000, sample_ms=600, tag="swim north at the bank")
    ss = P.state(); P.say("  V1 exit north: pos %s state %s grounded %s inWater %s" % (ss["pos"], ss["pstate"], ss["grounded"], ss["inWater"]))
    P.shot("v1_brook_exit_north")
    return {}

# ------------------------------------------------------------------ AZURE-1
def az1_lagoon(P):
    P.say("=== AZURE-1: the lagoon (P8) ===")
    assert P.js(LOAD_JS, "azure-1"); P.wait(1200)
    P.tp(-32, -0.3, -6); P.wait(700)
    st_line(P, "over the tidewell")
    cam(P, yaw=0.0, pitch=0.9); P.wait(400); P.shot("az1_tidewell_lookdown")
    cam(P, yaw=0.0, pitch=0.25); P.wait(300); P.shot("az1_tidewell_level")
    P.tp(0, 0.9, 12.5); P.wait(600); P.face(0, 0); cam(P, yaw=0.0, pitch=0.2); P.wait(300)
    P.shot("az1_shoal_north")
    P.tp(0, 1.2, 36.0); P.wait(600); P.face(0, 20); cam(P, yaw=0.0, pitch=0.22); P.wait(300)
    P.shot("az1_shelf_from_shore")
    st_line(P, "shore")
    return {}


# ------------------------------------------------- VERDANT-1: the north-bank exits
# Playtest verdant-1 (BLOCKER-class): "Dropped into the brook at [x, 0.4, 18] ...
# pointed the camera due north at the bank and held W ... THE PLAYER FALLS OUT OF
# THE WORLD AND DIES: while inWater the terrain does not collide (swims at y -1.05
# inside the hillside) and the water box's north face at z 13 is open."
HF_JS = r"""([x,z]) => { const bp = CRESTBOUND.game.course.broadphase; let b = NaN;
  for (const h of (bp.heightfields || [])) { const g = h.heightAt(x, z); if (g === g && (!(b === b) || g > b)) b = g; }
  return b === b ? +b.toFixed(2) : null; }"""
DEATHS_JS = "() => (CRESTBOUND.game.deaths | 0)"

def v1_brook_exits(P):
    P.say("=== VERDANT-1: swim out at the north bank (tester: x -20..30, drop at [x,0.4,18], W north) ===")
    assert P.js(LOAD_JS, "verdant-1"); P.wait(1200)
    out = []
    for x in (-20, -10, 0, 10, 20, 30):
        d0 = P.js(DEATHS_JS)
        P.tp(x, 0.4, 18.0); P.wait(500); P.face(x, 10.0); cam(P, yaw=0.0, pitch=0.2)
        rows = []
        P.down("W")
        for i in range(15):
            P.wait(400); ss = P.state(); g = P.js(HF_JS, [ss["pos"][0], ss["pos"][2]])
            rows.append([ss["pos"], ss["pstate"], ss["inWater"], g, ss["grounded"]])
            if ss["gstate"] == "dead": break
        P.up("W"); P.wait(300)
        d1 = P.js(DEATHS_JS); ss = P.state(); g = P.js(HF_JS, [ss["pos"][0], ss["pos"][2]])
        under = [r for r in rows if r[3] is not None and r[0][1] < r[3] - 0.3 and r[2]]
        P.say("  x=%d end pos %s state %s inWater %s grounded %s terrain-under %s deaths %s->%s  inside-hill samples %d/%d" % (
            x, ss["pos"], ss["pstate"], ss["inWater"], ss["grounded"], g, d0, d1, len(under), len(rows)))
        P.say("     trace [y, z, state, terrain, grounded]: " + json.dumps([[r[0][1], r[0][2], r[1][:7], r[3], r[4]] for r in rows]))
        P.shot("v1_exit_x%+d" % x)
        out.append({"x": x, "end": ss["pos"], "state": ss["pstate"], "deaths": (d1 - d0) if (d0 is not None and d1 is not None) else None, "underHill": len(under)})
    # the course file's promised shallow exit: fall in mid-channel, no input, where does the current ground you
    d0 = P.js(DEATHS_JS)
    P.tp(0, 1.0, 22.0); P.wait(500); P.release_all()
    rows = []
    for i in range(30):
        P.wait(500); ss = P.state(); rows.append([ss["pos"], ss["pstate"], ss["grounded"], ss["inWater"]])
        if ss["grounded"] and not ss["inWater"]: break
    ss = P.state()
    P.say("  drift, no input: grounded %s inWater %s at %s after %.1f s (deaths %s->%s)" % (ss["grounded"], ss["inWater"], ss["pos"], 0.5 * len(rows), d0, P.js(DEATHS_JS)))
    P.say("     trace [x, y, z, state]: " + json.dumps([[r[0][0], r[0][1], r[0][2], r[1][:6]] for r in rows]))
    P.shot("v1_drift_end")
    return out

def v1_wade_out(P):
    """The player's own situation: fell in mid-channel under the bridge, swims for the north bank."""
    P.say("=== VERDANT-1: wade out at the north bank from mid-channel (the tester's [x,0.4,18] drop is 1.9-7.0 m INSIDE the hill: terrain 1.91/2.71/2.96/2.08/2.95/7.04 at z 18) ===")
    assert P.js(LOAD_JS, "verdant-1"); P.wait(1200)
    for mode in ("W", "W+SPACE"):
        d0 = P.js(DEATHS_JS)
        P.tp(0, 0.2, 22.0); P.wait(600); P.face(0, 10.0); cam(P, yaw=0.0, pitch=0.2)
        rows = []; P.down("W"); out_t = None
        for i in range(30):
            P.wait(500)
            if mode == "W+SPACE" and i % 2 == 0: P.tap("SPACE", 120)
            ss = P.state(); g = P.js(HF_JS, [ss["pos"][0], ss["pos"][2]])
            rows.append([ss["pos"], ss["pstate"], ss["grounded"], ss["inWater"], g])
            if ss["gstate"] == "dead": break
            if (not ss["inWater"]) and ss["grounded"]: out_t = 0.5 * (i + 1); break
        P.up("W"); P.wait(300); ss = P.state()
        P.say("  %s north from mid-channel: %s at %s state %s grounded %s inWater %s terrain %s deaths %s->%s" % (
            mode, ("OUT after %.1f s" % out_t) if out_t else "NOT OUT after %.1f s" % (0.5 * len(rows)), ss["pos"], ss["pstate"], ss["grounded"], ss["inWater"],
            P.js(HF_JS, [ss["pos"][0], ss["pos"][2]]), d0, P.js(DEATHS_JS)))
        P.say("     trace [x, y, z, state, grounded, inWater, terrain]: " + json.dumps([[r[0][0], r[0][1], r[0][2], r[1][:6], r[2], r[3], r[4]] for r in rows]))
        P.shot("v1_wade_%s" % mode.replace("+", "_"))
    return {}

STATIONS = {"keep_fountain": keep_fountain, "v3_river": v3_river, "v2_moat": v2_moat, "v1_brook": v1_brook, "v1_brook_exits": v1_brook_exits, "v1_wade_out": v1_wade_out, "az1_lagoon": az1_lagoon}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="wl")
    ap.add_argument("--stations", default=",".join(STATIONS.keys()))
    a = ap.parse_args()
    out = {}
    with Play("wl_" + a.tag) as P:
        P.click_title(); P.wait(1200)
        for s in [x for x in a.stations.split(",") if x]:
            try:
                out[s] = STATIONS[s](P)
            except Exception as e:
                P.say("!! station %s failed: %s" % (s, e)); out[s] = {"error": str(e)}
        if P.console:
            P.say("console:", json.dumps(P.console[:20]))
        P.dump("wl_" + a.tag)
    print(json.dumps(out))

if __name__ == "__main__":
    main()
