"""SURFACES LANE — replay the testers' own situations for pads, belts, currents, wind
and the long-jump window, and READ the frames.  Not a gate: a proof harness.

Every station below is the playtest's own recipe (same positions, same keys, same
sampling), so a number here is comparable to the number in _playreports/<area>.json.
Yaw convention (CONTRACT §0): yaw 0 faces -Z (north), +pi/2 faces -X (west).

    python _sf_replay.py [station ...]
      stations: e2pads e2belts azure1 v3belt rime3 v1lj v2moat v3river v3pad v3scaffold
                v2pad rime1 azure3isle azure3road
"""
import os, sys, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _e2lib import E2

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "_playreports", "_sf_replay.json")
URL = "http://localhost:8788/games/crestbound/index.html?dev=1&quality=low&autoscale=0"
NORTH, WEST, SOUTH, EAST = 0.0, math.pi / 2, math.pi, -math.pi / 2

RES = {}


def dump():
    json.dump(RES, open(OUT, "w", encoding="utf-8"), indent=1)


def facing(p, yaw):
    p.js("(v) => { const G=CRESTBOUND.game; G.player.__test.setFacing(v); G.cam.yaw=v; G.cam._rcHoldT=0; }", yaw)


def vel0(p):
    p.js("() => CRESTBOUND.game.player.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0))")


def gametime(p):
    return p.js("() => CRESTBOUND.engine.elapsed")


def full(p):
    return p.js("""()=>{const G=CRESTBOUND.game,P=G.player;return {p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
        v:[+P.vel.x.toFixed(2),+P.vel.y.toFixed(2),+P.vel.z.toFixed(2)],
        st:P.state, sp:+P.speed.toFixed(2), gr:!!P.grounded, surf:P.surface||null, water:!!P.inWater,
        deaths:G.deaths, t:+(G.course?G.course.clock:0).toFixed(2)};}""")


def restart(p):
    """Bring the render loop back after an engine.stop(): start() without the loop fn runs a dead loop."""
    p.js("() => { const G=CRESTBOUND.game, E=CRESTBOUND.engine; if (!E.running || !E._loopFn) E.start((dt) => G.update(dt)); }")


def playing(p, ms=6000):
    """Wait until the course is handed over and the hero is alive (input suspended during intro/rewind)."""
    for _ in range(int(ms / 200)):
        s = p.js("() => { const G=CRESTBOUND.game; return {st:G.state, dead:!!(G.player&&G.player.dead), sus:!!(G.input&&G.input.suspended)}; }")
        if s["st"] == "playing" and not s["dead"] and not s["sus"]:
            return True
        p.wait(200)
    p.say("  !! not playing after %d ms: %s" % (ms, s))
    return False


def place(p, x, y, z, yaw=None, settle=700):
    """Teleport and PROVE the hero is there (a skipCP/respawn can land after a tp)."""
    playing(p)
    for _ in range(4):
        p.js("([x,y,z]) => CRESTBOUND.game.__dev.tp(x,y,z)", [x, y, z])
        vel0(p)
        if yaw is not None: facing(p, yaw)
        p.wait(settle)
        q = p.pos()
        if abs(q[0] - x) < 1.5 and abs(q[2] - z) < 1.5:
            return q
    p.say("  !! place(%s) failed: hero at %s" % ([x, y, z], q))
    return q


def volumes_near(p, x, z, r=12):
    return p.js("""([x,z,r]) => { const C = CRESTBOUND.game.course; const out=[];
      for (const v of (C.volumes||[])) { const c=v.center, h=v.half; if(!c||!h) continue;
        if (Math.abs(c.x-x) > h.x + r || Math.abs(c.z-z) > h.z + r) continue;
        out.push({kind:v.kind, c:[+c.x.toFixed(2),+c.y.toFixed(2),+c.z.toFixed(2)], h:[+h.x.toFixed(2),+h.y.toFixed(2),+h.z.toFixed(2)],
                  surfaceY: v.surfaceY!==undefined ? +(+v.surfaceY).toFixed(2) : null, active: v.active!==false,
                  power: v.props && v.props.power, dir: v.props && v.props.dirArr}); }
      return out; }""", [x, z, r])


def ground_profile(p, pts):
    return p.js("""(pts) => { const C = CRESTBOUND.game.course; const out=[];
      const hf = C.terrain && C.terrain.heightfield; const bp = C.broadphase; const THREE = CRESTBOUND.THREE;
      const o = new THREE.Vector3(), d = new THREE.Vector3(0,-1,0), hit = {t:0, normal:new THREE.Vector3(), collider:null};
      for (const [x,z] of pts) { let g = null; if (hf) { g = hf.heightAt(x,z); if (!isFinite(g)) g = null; }
        let top = null, surf = null; o.set(x, 60, z);
        if (bp && bp.raycast && bp.raycast(o, d, 120, hit)) { top = +(60 - hit.t).toFixed(2); surf = hit.collider ? hit.collider.surface : 'hf'; }
        out.push([x, z, g===null?null:+g.toFixed(2), top, surf]); }
      return out; }""", pts)


# ------------------------------------------------------------------ stations
def e2pads(p):
    """ember-2 E2-2: the tester's exact pad runs (tp 3 m south + 2 m up, face north, W, sample 100 ms)."""
    p.goto("ember-2")
    pads = p.js(r"""() => { const C = CRESTBOUND.game.course; const out=[];
      for (const h of (C.hazards||[])) if (h.def && h.def.kind==='speedpad')
        out.push({p:h.def.p, s:h.def.s, dir:h.def.dir, power:h.def.power});
      return out; }""")
    out = []
    for i, pad in enumerate(pads):
        px, py, pz = pad["p"]
        if i == 0:
            # pad 0's north approach lane is inside the sorter gnasher's 5.5 m chain (post on(-10,3)):
            # the tester's own tp point is a bite. Stand on the plate's south edge (the sign's
            # instruction) and read the launch in 50 ms samples.
            place(p, px, py + 0.3, pz + 1.2, NORTH, 600)
            p.face(px, pz - 20)
            p.down("W")
            rows = p.watch(1200, 50)
        else:
            place(p, px, py + 2.0, pz + 3.0, NORTH, 900)
            p.face(px, pz - 20)
            p.down("W")
            rows = p.watch(2200, 100)
        p.up("W"); p.wait(300)
        peak = max(r["sp"] or 0 for r in rows)
        onpad = [r for r in rows if abs(r["p"][2] - pz) <= pad["s"][2] * 0.5 + 0.2 and abs(r["p"][0] - px) < 2]
        after = [r for r in rows if r["p"][2] < pz - pad["s"][2] * 0.5 - 0.2]
        p.say("PAD %d @%s power %s: peak %.2f  on-pad (y,speed) %s  after-pad speeds %s" % (
            i, pad["p"], pad["power"], peak, [(r["p"][1], r["sp"]) for r in onpad][:5], [r["sp"] for r in after][:10]))
        for r in rows[:6]: p.say("     ", r["p"], r["ps"], r["sp"], "deaths", r["deaths"], "st", r["st"])
        p.shot("e2pad%d" % i)
        out.append({"pad": pad, "peak": peak, "after": [r["sp"] for r in after][:12],
                    "path": [[r["t"], r["p"], r["sp"], r["ps"]] for r in rows]})
    RES["e2pads"] = out
    dump()


def e2belts(p):
    """ember-2 E2-1 + the clean belt numbers, with the terrain profile under each belt."""
    p.goto("ember-2")
    prof = {"z3": ground_profile(p, [[x, 3] for x in range(-15, 2)]),
            "zm1": ground_profile(p, [[x, -1] for x in range(-1, 16)]),
            "x0": ground_profile(p, [[0, z] for z in range(-8, 7)])}
    for k, v in prof.items(): p.say("  profile %s: %s" % (k, v))
    RES["e2_profile"] = prof
    # E2-1: run north from the race pad at [0,6,15] into the x=0 cross belt's south edge
    place(p, 0, 6.4, 16, NORTH, 900); p.face(0, -20)
    p.down("W"); rows = p.watch(2200, 100); p.up("W"); p.wait(300)
    onbelt = [r for r in rows if r["surf"] == "conveyor"]
    p.say("E2-1 walk onto the cross belt: surface 'conveyor' reached %s at z %s; states %s" % (
        bool(onbelt), onbelt[0]["p"][2] if onbelt else None, sorted(set(r["ps"] for r in rows))))
    p.shot("e2belt_walkon")
    RES["e2belt_walkon"] = {"onbelt": bool(onbelt), "rows": [(r["p"], r["surf"], r["ps"], r["sp"]) for r in rows]}
    # clean numbers on the z=3 belt (x -15..1, dir +x, power 5): still / against / with
    place(p, -8, 6.9, 3.0, EAST, 1200)
    a = full(p); rows = []
    for _ in range(12): p.wait(250); rows.append(full(p))
    b = rows[-1]
    still = (b["p"][0] - a["p"][0]) / 3.0
    p.say("BELT still: %.2f m/s (authored 5.0) surfs %s states %s y %s" % (still, sorted(set(r["surf"] for r in rows)), sorted(set(r["st"] for r in rows)), b["p"][1]))
    cols = p.js(r"""() => { const bp = CRESTBOUND.game.course.broadphase; const THREE = CRESTBOUND.THREE;
      const box = new THREE.Box3(new THREE.Vector3(-3.5,6,1.5), new THREE.Vector3(-0.5,8,4.5)); const out=[]; bp.query(box, out);
      return out.map(c => ({c:[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2)], h:[+c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)], surf:c.surface, ref:(c.ref&&c.ref.kind)||(c.ref&&c.ref.def&&c.ref.def.kind)||null})); }""")
    p.say("  colliders near (-2, 3) ['bounce' seen in the profile]:", json.dumps(cols))
    # the z=-1 belt: x -1..15, dir -x (west), power 5.0. Against = run EAST from x 3; with = run WEST from x 12.
    place(p, 3, 6.9, -1.0, EAST, 1000); a = full(p)
    p.down("W"); rows = []
    for _ in range(8): p.wait(250); facing(p, EAST); rows.append(full(p))
    p.up("W"); p.wait(200); b = rows[-1]
    against = (b["p"][0] - a["p"][0]) / 2.0
    p.say("BELT run-against (east on the -x belt): %.2f m/s (design 9-5 = +4.0) surfs %s states %s" % (against, sorted(set(r["surf"] for r in rows)), sorted(set(r["st"] for r in rows))))
    for r in rows: p.say("     ", r["p"], r["st"], r["sp"], r["surf"], r["gr"], r["v"])
    # with: the x=0 cross belt (z -8..6, dir -z, power 4): run NORTH from z 5, 100 ms samples, until the crate at z -5.1
    place(p, 0, 6.9, 5.0, NORTH, 900); a = full(p)
    p.down("W"); rows = []
    for _ in range(9): p.wait(100); facing(p, NORTH); rows.append(full(p))
    p.up("W"); p.wait(200)
    onb = [r for r in rows if r["surf"] == "conveyor" and r["p"][2] > -4.5]
    if len(onb) >= 2:
        withb = (onb[-1]["p"][2] - onb[0]["p"][2]) / ((len(onb) - 1) * 0.1)
    else:
        withb = float("nan")
    p.say("BELT run-with (north on the -z belt): %.2f m/s (design 9+4 = -13 north) samples %s" % (withb, [(r["p"][2], r["sp"], r["surf"]) for r in rows]))
    for r in rows: p.say("     ", r["p"], r["st"], r["sp"], r["surf"], r["gr"], r["v"])
    RES["e2belt"] = {"still": still, "against": against, "with": withb}
    dump()


def azure1(p):
    """azure-1: the tester's four current runs (velocity zeroed, camera pinned, game-time durations)."""
    p.goto("azure-1")
    p.say("  volumes near (0,24):", json.dumps(volumes_near(p, 0, 24, 4)))

    def run(x, y, z, yaw, key, secs, label):
        place(p, x, y, z, yaw, 900)
        t0 = gametime(p); a = p.pos()
        if key: p.down(key)
        rows = []
        for i in range(int(secs * 4)):
            p.wait(250)
            if key: facing(p, yaw)
            f = full(p); rows.append(f)
        if key: p.up(key)
        t1 = gametime(p); b = p.pos(); dt = max(0.001, t1 - t0)
        mps = (b[0] - a[0]) / dt
        p.say("  %-34s dx %+6.2f m in %5.2f s = %+5.2f m/s ; vel.x tail %s ; end water=%s gr=%s st=%s" % (
            label, b[0] - a[0], dt, mps, [r["v"][0] for r in rows[-4:]], rows[-1]["water"], rows[-1]["gr"], rows[-1]["st"]))
        for r in rows[::4]: p.say("       ", r["p"], r["v"], r["st"], "water" if r["water"] else "DRY", "gr" if r["gr"] else "", r["surf"])
        return {"label": label, "mps": round(mps, 2), "end": b, "rows": [[r["p"], r["v"], r["st"], r["water"], r["gr"]] for r in rows]}

    cols = p.js(r"""() => { const bp = CRESTBOUND.game.course.broadphase; const THREE = CRESTBOUND.THREE;
      const box = new THREE.Box3(new THREE.Vector3(-2,-3,22), new THREE.Vector3(4,2,27)); const out=[]; bp.query(box, out);
      return out.map(c => ({c:[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2)], h:[+c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)], surf:c.surface, ref:(c.ref&&c.ref.kind)||(c.ref&&c.ref.def&&c.ref.def.kind)||null})); }""")
    p.say("  colliders in the band near (0..2, 24) [the swimmer pinned at x 0.38]:", json.dumps(cols)[:900])
    out = [run(0, -0.6, 24, NORTH, None, 6, "float, no input, in the current"),
           run(8, -0.6, 22, WEST, "W", 6, "swim WEST into the current (clear lane)"),
           run(0, -0.6, 24, WEST, "W", 8, "swim WEST into the current (tester's spot)"),
           run(0, -0.6, 26, NORTH, "W", 6, "swim NORTH across the current"),
           run(20, -0.6, 6, WEST, "W", 5, "swim WEST in still water")]
    p.shot("azure1_current")
    RES["azure1"] = out
    dump()


def v3belt(p):
    """verdant-3 V3-05: the lower hay belt [7,11.15,-2] dir +Z power 5 — no input, then run NORTH against it."""
    p.goto("verdant-3")
    p.say("  profile along the belt x=7:", ground_profile(p, [[7, z] for z in [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4]]))
    p.say("  profile along the upper belt x=10:", ground_profile(p, [[10, z] for z in [-14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3]]))
    p.say("  profile along the west belt x=-6:", ground_profile(p, [[-6, z] for z in [-9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3]]))
    place(p, 7.0, 11.7, 1.0, NORTH, 1000)
    a = full(p); rows = []
    for _ in range(10): p.wait(400); rows.append(full(p))
    p.say("  belt no-input from z 1.0: %s -> %s  (%.2f m/s south; authored 5.0) surfs %s states %s" % (
        a["p"], rows[-1]["p"], (rows[-1]["p"][2] - a["p"][2]) / 4.0, sorted(set(r["surf"] for r in rows)), sorted(set(r["st"] for r in rows))))
    for r in rows[:6]: p.say("     ", r["p"], r["st"], r["surf"], r["gr"], r["v"])
    RES["v3belt_noinput"] = {"a": a["p"], "rows": [[r["p"], r["st"], r["surf"], r["gr"]] for r in rows]}
    place(p, 7.0, 11.7, 1.6, NORTH, 800)
    a = full(p)
    p.down("W"); tr = []
    for i in range(12):
        p.wait(400); facing(p, NORTH); tr.append(full(p))
    p.up("W"); p.wait(500)
    p.say("  run-against (north): z %.2f -> %.2f in 4.8 s = %.2f m/s NORTH (design 9-5 = 4.0)" % (
        a["p"][2], tr[-1]["p"][2], -(tr[-1]["p"][2] - a["p"][2]) / 4.8))
    for r in tr: p.say("     ", r["p"], r["st"], r["sp"], r["surf"], r["gr"], r["v"])
    p.shot("v3belt_against")
    RES["v3belt_against"] = {"a": a["p"], "b": tr[-1]["p"], "rows": [[r["p"], r["st"], r["sp"], r["surf"], r["gr"]] for r in tr]}
    dump()


def rime3(p):
    """rime-3: the gale's real acceleration (free fall inside the volume), then shelf A -> B run-and-jump."""
    p.goto("rime-3")
    # free-fall wind probe: authored 9.0 m/s^2 along (-0.92, 0, 0.39) => ax = -8.28
    place(p, -28, 14.0, 25, NORTH, 300)
    r = p.js("""() => { const G=CRESTBOUND.game, P=G.player, E=CRESTBOUND.engine; if (E.running) E.stop();
      P.__test.setVel(new CRESTBOUND.THREE.Vector3(0,0,0));
      const v0 = P.vel.x; for (let i=0;i<30;i++) G.update(1/60); const v1 = P.vel.x; const y = P.pos.y;
      return {v0:+v0.toFixed(3), v1:+v1.toFixed(3), ax:+((v1-v0)/0.5).toFixed(2), y:+y.toFixed(2), gr:P.grounded}; }""")
    restart(p)
    p.say("  wind free-fall 0.5 s: vel.x %s -> %s  => ax %s m/s^2 (authored 9.0 x -0.92 = -8.28; doubled would be -16.6) y %s gr %s" % (r["v0"], r["v1"], r["ax"], r["y"], r["gr"]))
    RES["rime3_wind"] = r
    outs = []
    for runup in (350, 500, 650):
        place(p, -29.0, 4.4, 26.0, None, 900)     # shelf A centre
        p.face(-32.6, 20)
        p.down("W"); p.wait(runup)
        p.down("SPACE"); p.wait(250); p.up("SPACE")
        rows = []
        for _ in range(8):
            p.wait(150); p.face(-32.6, 20); rows.append(full(p))
        p.up("W"); p.wait(600)
        e = full(p)
        onB = abs(e["p"][0] + 32.6) <= 2.0 and abs(e["p"][2] - 20) <= 2.0 and e["p"][1] > 5.0
        p.say("  shelf A->B runup %d ms: landed %s st %s surf %s  ON B: %s" % (runup, e["p"], e["st"], e["surf"], onB))
        outs.append({"runup": runup, "end": e["p"], "onB": onB})
    place(p, -28, 4.2, 26, NORTH, 800)
    a = full(p); p.down("W"); p.wait(5000); p.up("W"); b = full(p)
    p.say("  NORTH walk 5 s no correction: %s -> %s  lateral drift %.2f m (%.2f m/s; course says ~1 m/s)" % (a["p"], b["p"], b["p"][0] - a["p"][0], (b["p"][0] - a["p"][0]) / 5.0))
    p.shot("rime3_shelf")
    RES["rime3"] = {"hops": outs, "drift": {"a": a["p"], "b": b["p"]}}
    dump()


STEPPER = r"""
() => { const G = CRESTBOUND.game, E = CRESTBOUND.engine;
  if (E.running) E.stop();
  window.__sfStep = (n) => { const out = [];
    for (let i = 0; i < n; i++) { G.update(1/60); const p = G.player;
      out.push([+p.pos.x.toFixed(3), +p.pos.y.toFixed(3), +p.pos.z.toFixed(3),
                p.state, +Math.hypot(p.vel.x,p.vel.z).toFixed(2), p.grounded?1:0]); }
    return out; };
  window.__sfPlace = (x,y,z,yaw) => { const p = G.player;
    p.__test.teleport({x:x,y:y,z:z}); p.__test.setVel({x:0,y:0,z:0});
    p.__test.setFacing(yaw); if (G.cam) { G.cam.yaw = yaw; G.cam.recenter && G.cam.recenter(); } };
  return 'stepper ready'; }
"""


def v1lj(p):
    """verdant-1: the tester's frame-stepped long-jump window — W 45 frames to 9 m/s, crouch, SPACE N frames later."""
    p.goto("verdant-1")
    p.say("  " + str(p.js(STEPPER)))
    step = lambda n: p.js("(n) => __sfStep(n)", n)
    out = []
    for key in ("C", "CTRL"):
        for pre in (1, 3, 6, 9, 12):
            p.js("([x,y,z,w]) => __sfPlace(x,y,z,w)", [-2, 2.4, 50, NORTH]); step(10)
            p.down("W"); fr = step(45)
            run = fr[-1][4]
            p.down(key); fc = step(pre) if pre else []
            at = (fc[-1][4] if fc else run)
            x0, z0 = fr[-1][0], fr[-1][2]
            p.down("SPACE"); f1 = step(7); p.up("SPACE")
            f2 = []
            for _ in range(80):
                s = step(1); f2 += s
                if s[0][5] == 1 and len(f2) > 3: break
            p.up(key); p.up("W"); step(5)
            states = []
            for f in f1 + f2:
                if not states or states[-1] != f[3]: states.append(f[3])
            land = f2[-1]
            dist = round(math.hypot(land[0] - x0, land[2] - z0), 2)
            p.say("  LONGJUMP key=%s pre=%d fr (%d ms): run %.2f -> at-jump %.2f | dist %s m | states %s" % (key, pre, int(pre * 1000 / 60), run, at, dist, ",".join(states)))
            out.append({"key": key, "pre": pre, "run": run, "atJump": at, "dist": dist, "states": states})
    restart(p)
    RES["v1lj"] = out
    dump()


def v2moat(p):
    """verdant-2 V2-07: float 8 s with no input from (-8, 39.5); hold W due WEST from x 12.5 for 8 s."""
    p.goto("verdant-2")
    vols = volumes_near(p, 0, 39.5, 6)
    p.say("  volumes near the moat:", json.dumps(vols))
    water = [v for v in vols if v["kind"] == "water"]
    y = (water[0]["c"][1] - 0.2) if water else -0.9
    place(p, -8, y, 39.5, NORTH, 900)
    a = full(p); rows = []
    for _ in range(8): p.wait(1000); rows.append(full(p))
    b = rows[-1]
    p.say("  moat float 8 s: x %.2f -> %.2f = %+.2f m (%.2f m/s east; authored 2.6) water=%s st=%s" % (a["p"][0], b["p"][0], b["p"][0] - a["p"][0], (b["p"][0] - a["p"][0]) / 8.0, b["water"], b["st"]))
    fl = {"a": a["p"], "b": b["p"], "water": b["water"]}
    place(p, 12.5, y, 39.5, WEST, 900)
    a = full(p); p.down("W"); rows = []
    for _ in range(16):
        p.wait(500); facing(p, WEST); rows.append(full(p))
    p.up("W"); b = rows[-1]
    p.say("  moat swim WEST 8 s: x %.2f -> %.2f = %+.2f m (%.2f m/s; design 4.5-2.6 = -1.9) water=%s st=%s" % (a["p"][0], b["p"][0], b["p"][0] - a["p"][0], (b["p"][0] - a["p"][0]) / 8.0, b["water"], b["st"]))
    p.shot("v2moat")
    RES["v2moat"] = {"float": fl, "west": {"a": a["p"], "b": b["p"], "water": b["water"]}}
    dump()


def v3river(p):
    """verdant-3 V3-09 / V3-10: fall in at [0,0.2,29], swim for the north jetty [0,2.6,21]; then sink onto sigil 1 at [-14,-3.3,28]."""
    p.goto("verdant-3")
    p.say("  volumes near the river:", json.dumps(volumes_near(p, 0, 27, 4)))
    place(p, 0, 0.2, 29, NORTH, 900)
    a = full(p)
    p.down("W"); rows = []
    for _ in range(32):
        p.wait(250); p.face(3.2, 21.0); f = full(p); rows.append(f)
        if f["p"][2] < 22.9 and f["p"][1] > 2.3: break
    p.up("W"); p.wait(400); b = full(p)
    on = (abs(b["p"][0]) <= 4.6 and b["p"][2] <= 23.0 and b["p"][1] > 2.3)
    p.say("  jetty swim (aim at the landing stage at x 3.2): %s -> %s  st %s water=%s  ON JETTY %s" % (a["p"], b["p"], b["st"], b["water"], on))
    for r in rows[::3]: p.say("     ", r["p"], r["v"], r["st"], r["water"])
    jet = {"a": a["p"], "b": b["p"], "st": b["st"], "onJetty": on}
    sig0 = p.js("() => CRESTBOUND.game.__dev.state().sigils")
    place(p, -9.0, -0.1, 28.0, WEST, 700)
    p.down("C"); p.down("W"); rows = []
    for _ in range(16):
        p.wait(250); facing(p, WEST); rows.append(full(p))
    p.up("W"); p.up("C"); p.wait(500)
    sig1 = p.js("() => CRESTBOUND.game.__dev.state().sigils")
    p.say("  riverbed sigil (start 5 m east, hold C+W west): sigils %s -> %s ; path %s" % (sig0, sig1, [r["p"] for r in rows[::3]]))
    p.shot("v3river_sigil")
    RES["v3river"] = {"jetty": jet, "sigil": {"before": sig0, "after": sig1, "path": [r["p"] for r in rows]}}
    dump()


def v3pad(p):
    """verdant-3 V3-17: the relocated deck-A jump pad — stand on it, hands off, read where it lands."""
    p.goto("verdant-3")
    d0 = p.js("() => CRESTBOUND.game.deaths")
    place(p, 0.5, 12.0, 1.8, NORTH, 800)
    p.down("W"); rows = []
    for _ in range(14):
        p.wait(150); rows.append(full(p))
        if rows[-1]["p"][1] > 11.6 and rows[-1]["st"] in ("jump1", "fall"): break
    p.up("W")
    for _ in range(12):
        p.wait(150); rows.append(full(p))
        if rows[-1]["gr"] and rows[-1]["p"][1] > 11.5 and len(rows) > 6: break
    e = full(p); d1 = p.js("() => CRESTBOUND.game.deaths")
    p.say("  deck-A pad hands-off: landed %s st %s surf %s deaths +%d  (deck B x -4..16, z -12..-4, top 12.30; post (-7,-9.6))" % (e["p"], e["st"], e["surf"], d1 - d0))
    for r in rows: p.say("     ", r["p"], r["st"], r["v"], r["gr"])
    p.shot("v3pad")
    RES["v3pad"] = {"end": e["p"], "deaths": d1 - d0, "rows": [[r["p"], r["st"], r["v"]] for r in rows]}
    dump()


def v3scaffold(p):
    """verdant-3 V3-35: ledge 1 -> ledge 2, run from the back of the ledge and jump at the lip."""
    p.goto("verdant-3")
    outs = []
    for start_z in (-46.0, -45.2):
        place(p, 17.0, 24.9, start_z, NORTH, 900)
        p.face(17.0, -30)
        r = p.js("""() => { const G=CRESTBOUND.game, P=G.player, E=CRESTBOUND.engine; if (E.running) E.stop();
          const rows=[]; let jumped=false, landed=null;
          for (let i=0;i<150;i++) { G.update(1/60);
            rows.push([+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2),P.state,+P.speed.toFixed(2),P.grounded?1:0]);
            if (!jumped && P.pos.z >= -42.7 - 0.45) { jumped=true; P.__test.force('jump1'); }
            if (jumped && i>8 && P.grounded && P.state!=='jump1') { landed=rows[rows.length-1]; break; } }
          return {rows: rows.filter((r,i)=>i%5==0), landed}; }""")
        restart(p)
        outs.append(r)
        p.say("  scaffold from z %.1f: landed %s" % (start_z, r["landed"]))
    RES["v3scaffold_forced"] = outs
    # the honest version: W held from the back of the ledge, SPACE tapped as the lip passes (real keys, real time)
    for start_z in (-44.5, -45.8):
        place(p, 17.0, 24.9, start_z, NORTH, 900); p.face(17.0, -30)
        p.down("W")
        fired = False; rows = []
        for _ in range(40):
            p.wait(30)
            f = full(p); rows.append(f); q = f["p"]
            if q[2] >= -43.1 and not fired:
                p.down("SPACE"); fired = True; p.wait(180); p.up("SPACE"); break
        for _ in range(20):
            p.wait(50); f = full(p); rows.append(f)
            if f["gr"] and len(rows) > 6 and f["st"] not in ("jump1", "jump2", "jump3"): break
        p.up("W"); p.wait(300)
        e = full(p)
        on2 = abs(e["p"][0] - 17) <= 1.7 and -40.7 <= e["p"][2] <= -36.5 and e["p"][1] > 25.5
        p.say("  scaffold real keys from z %.1f: fired %s landed %s st %s ON LEDGE 2 %s (ledge 2 z -40.5..-36.7 top 26.0)" % (start_z, fired, e["p"], e["st"], on2))
        for r in rows: p.say("     ", r["p"], r["st"], r["sp"], r["v"], r["gr"], r["surf"])
        RES["v3scaffold_real_%s" % start_z] = {"end": e["p"], "on2": on2, "rows": [[r["p"], r["st"], r["v"]] for r in rows]}
    dump()


def v2pad(p):
    """verdant-2 V2-22: the ROUTE C pad — step on, hands off; then step on holding forward."""
    p.goto("verdant-2")
    p.say("  ground at the pad:", ground_profile(p, [[-8, 24.5], [-8, 26], [-8, 27.5]]))
    d0 = p.js("() => CRESTBOUND.game.deaths")
    for hold in (False, True):
        # the pad is 1.8 m from the west gnasher's body: a tp beside it is a bite (4 of 4 died on
        # placement). Stand ON the plate — the sign's instruction — and it fires on contact.
        playing(p)
        p.js("([x,y,z]) => CRESTBOUND.game.__dev.tp(x,y,z)", [-8.0, 6.8, 24.8]); vel0(p); facing(p, NORTH)
        if hold: p.down("W")
        rows = []
        for _ in range(30):
            p.wait(50); rows.append(full(p))
            if rows[-1]["gr"] and len(rows) > 8 and rows[-1]["v"][1] <= 0.01 and rows[-1]["p"][1] > 7.5: break
            if rows[-1]["st"] == "dead": break
        p.up("W")
        e = full(p); d1 = p.js("() => CRESTBOUND.game.deaths")
        onwalk = (20.0 <= e["p"][2] <= 23.4 and abs(e["p"][1] - 12.0) < 0.4)
        p.say("  ROUTE C pad hold=%s: landed %s st %s surf %s deaths +%d  ON WALK %s (band z 20..23.4 at 12.00)" % (hold, e["p"], e["st"], e["surf"], d1 - d0, onwalk))
        for r in rows: p.say("     ", r["p"], r["st"], r["v"], r["gr"])
        RES["v2pad_hold%d" % int(hold)] = {"end": e["p"], "onwalk": onwalk, "deaths": d1 - d0}
        d0 = d1
    p.shot("v2pad")
    dump()


def rime1(p):
    """rime-1: from the gorge floor, walk south at the geyser pad (the sign's way) with W only."""
    p.goto("rime-1")
    p.say("  gorge floor along x=23.3:", ground_profile(p, [[23.3, z] for z in [-22, -23, -24, -24.5, -25, -25.5, -26, -26.5, -27, -28, -29]]))
    p.say("  gorge floor across z=-25.2:", ground_profile(p, [[x, -25.2] for x in [21.6, 22.0, 22.4, 22.8, 23.3, 23.8, 24.2, 24.6, 25.0]]))
    place(p, 23.3, 5.3, -23.8, SOUTH, 900)     # floor 4.74 at z -24: stand ON it, north of the flight's foot
    a = full(p); p.face(23.3, -27.9)
    p.down("W"); rows = []
    for _ in range(30):
        p.wait(120); rows.append(full(p))
        if rows[-1]["p"][1] > 7.5: break
    p.up("W"); p.wait(1200)
    e = full(p)
    top = max(r["p"][1] for r in rows + [e])
    p.say("  geyser pad from the floor: %s -> peak y %.2f, end %s st %s  (pad top 5.04, ledge 7.00, authored apex 8.5)" % (a["p"], top, e["p"], e["st"]))
    for r in rows[::2]: p.say("     ", r["p"], r["st"], r["surf"], r["gr"])
    p.shot("rime1_geyser")
    RES["rime1"] = {"a": a["p"], "peak": top, "end": e["p"]}
    dump()


def azure3isle(p):
    """azure-3: the station -> sunken isle long jump, crouch+jump at the NOTHING BELOW sign (z 53.4) and 3 m before it."""
    p.goto("azure-3")
    outs = []
    for fire_z in (53.0, 50.5, 47.5):
        # lane x 3: the isle spans x -6..6 (the tester's x 7 lane is outside it by a metre)
        place(p, 3.0, 30.3, 36.0, SOUTH, 900); p.face(3.0, 80)
        p.down("W"); fired = False
        for _ in range(80):
            p.wait(40); q = p.pos()
            if q[2] >= fire_z and not fired:
                p.down("C"); p.wait(90); p.down("SPACE"); fired = True; p.wait(160); p.up("SPACE"); p.up("C"); break
        rows = []
        for _ in range(14):
            p.wait(150); rows.append(full(p))
            if rows[-1]["gr"] and rows[-1]["p"][1] < 29: break
        p.up("W"); p.wait(300)
        e = full(p)
        onisle = (abs(e["p"][0]) <= 6 and 60 <= e["p"][2] <= 72 and abs(e["p"][1] - 21.0) < 0.5)
        p.say("  long jump fired at z %.1f: fired %s -> %s st %s  ON ISLE %s (isle x -6..6, z 60..72, top 21)" % (fire_z, fired, e["p"], e["st"], onisle))
        outs.append({"fire_z": fire_z, "end": e["p"], "onisle": onisle, "states": sorted(set(r["st"] for r in rows))})
    p.shot("azure3_isle")
    RES["azure3isle"] = outs
    dump()


def azure3road(p):
    """azure-3 BEAT 7: start -> mid -> east -> sanctum with a run-and-single-jump at each lip."""
    p.goto("azure-3")
    # leg 3 starts at x 25: past the rotor's sweep (x 18..24) — the rotor is the course's hazard, not the gap
    # leg 3 runs the z -65 lane: beside the jump pad (z -63.5..-60.5) and outside the rotor's 3 m sweep about (21, -62)
    legs = [(-33, 50.3, -62, -26.0, -20, 51.4), (1 - 10, 51.7, -62, 3.0, 12, 52.8), (26, 53.1, -65.2, 29.0, 40, 54.0)]
    outs = []
    d0 = p.js("() => CRESTBOUND.game.deaths")
    for (sx, sy, sz, lip_x, tx, ty) in legs:
        dleg = p.js("() => CRESTBOUND.game.deaths")
        place(p, sx, sy, sz, EAST, 900); p.face(60, sz)
        p.down("W"); fired = False
        for _ in range(80):
            p.wait(30); q = p.pos()
            if q[0] >= lip_x - 0.45 and not fired:
                p.down("SPACE"); fired = True; p.wait(180); p.up("SPACE"); break
        rows = []
        for _ in range(14):
            p.wait(150); rows.append(full(p))
            if rows[-1]["gr"] and len(rows) > 3: break
        p.up("W"); p.wait(300)
        e = full(p)
        ok = e["p"][0] > lip_x + 1.0 and abs(e["p"][1] - ty) < 0.4
        dl = p.js("() => CRESTBOUND.game.deaths") - dleg
        p.say("  road leg lip x %.1f -> deck %.1f: fired %s landed %s st %s  MADE IT %s  deaths this leg %d" % (lip_x, ty, fired, e["p"], e["st"], ok, dl))
        outs.append({"lip": lip_x, "end": e["p"], "ok": ok, "deaths": dl})
    d1 = p.js("() => CRESTBOUND.game.deaths")
    p.say("  road deaths +%d" % (d1 - d0))
    p.shot("azure3_road")
    RES["azure3road"] = {"legs": outs, "deaths": d1 - d0}
    dump()


def v2grid(p):
    """verdant-2: where on the bailey can the ROUTE C pad stand? Terrain height grid + distance to the west gnasher post (-7, 26.5)."""
    p.goto("verdant-2")
    pts = [[x, z] for x in range(-17, -5) for z in range(22, 32)]
    prof = ground_profile(p, pts)
    ok = []
    for x, z, g, top, surf in prof:
        if g is None: continue
        d = math.hypot(x + 7, z - 26.5)
        if g >= 5.8 and d >= 7.0:
            ok.append((x, z, g, round(d, 1), surf))
    p.say("  bailey cells with ground >= 5.8 and >= 7 m from the post: %s" % ok)
    p.say("  row z=26: %s" % [(x, g) for x, z, g, top, surf in prof if z == 26])
    p.say("  row z=24: %s" % [(x, g) for x, z, g, top, surf in prof if z == 24])
    p.say("  row z=28: %s" % [(x, g) for x, z, g, top, surf in prof if z == 28])
    RES["v2grid"] = {"ok": ok, "prof": prof}
    dump()


STATIONS = {"e2pads": e2pads, "e2belts": e2belts, "azure1": azure1, "v3belt": v3belt, "rime3": rime3, "v1lj": v1lj,
            "v2moat": v2moat, "v3river": v3river, "v3pad": v3pad, "v3scaffold": v3scaffold, "v2pad": v2pad,
            "rime1": rime1, "azure3isle": azure3isle, "azure3road": azure3road, "v2grid": v2grid}


def main():
    want = sys.argv[1:] or list(STATIONS)
    if os.path.exists(OUT):
        try: RES.update(json.load(open(OUT, encoding="utf-8")))
        except Exception: pass
    with E2("sf_replay", url=URL) as p:
        p.js("() => CRESTBOUND.game.__dev.unlockAll()")
        for name in want:
            p.say("\n=== %s ===" % name)
            try:
                STATIONS[name](p)
            except Exception as e:
                p.say("  !! station %s raised %r" % (name, e))
                RES[name + "_error"] = repr(e)
                dump()
        RES["console"] = p.console[:30]
        dump()


main()
