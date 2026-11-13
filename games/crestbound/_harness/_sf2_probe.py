"""SURFACES LANE pass 2 — hand-stepped probes for the residual stations.

Every station stops the engine and hand-steps game.update(1/60) with REAL
KeyboardEvents down (the feelshots.py method: independent of the renderer, so a
loaded box cannot inflate a duration or collapse a press into one frame).

    python _sf2_probe.py [station ...]
      v1pad      verdant-1 jump pad at [13, gy+0.14, -47]: does it exist, where, does it fire
      a1hop      azure-1: pinned on sinker pad 2 at x 0.38 -> tap SPACE -> mantle?  then keep W west
      r3drift    rime-3: the tester's 5 s north walk from (-28, 26), y/grounded every 15 frames
      v3crag     verdant-3 V3-28: crag 1 -> crag 2 -> crag 3, 400 ms run + 250 ms jump
      e2float    ember-2 E2-13: float 9 s in the coolant channel, no input
      a3air      azure-3: wing power forced, fly through an air current, read the push
"""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _e2lib import E2

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("SF2OUT") or os.path.join(HERE, "_playreports", "_sf2_probe.json")
URL = os.environ.get("SF2URL") or "http://localhost:8788/games/crestbound/index.html?dev=1&quality=low&autoscale=0"
NORTH, WEST, SOUTH, EAST = 0.0, math.pi / 2, math.pi, -math.pi / 2
RES = {}


def dump():
    json.dump(RES, open(OUT, "w", encoding="utf-8"), indent=1)


STEPPER = r"""
() => { const G = CRESTBOUND.game, E = CRESTBOUND.engine;
  if (E.running) E.stop();
  window.__sfStep = (n, every) => { const out = []; every = every || 1;
    for (let i = 0; i < n; i++) { G.update(1/60); const p = G.player;
      if (i % every === 0 || i === n - 1) out.push([+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2),
                p.state, +p.vel.x.toFixed(2), +p.vel.y.toFixed(2), +p.vel.z.toFixed(2), p.grounded?1:0, p.surface||null, p.inWater?1:0, G.deaths]); }
    return out; };
  window.__sfPlace = (x,y,z,yaw) => { const p = G.player;
    p.__test.teleport({x:x,y:y,z:z}); p.__test.setVel({x:0,y:0,z:0});
    p.__test.setFacing(yaw); if (G.cam) { G.cam.yaw = yaw; G.cam._rcHoldT = 0; } };
  window.__sfFace = (yaw) => { const p = G.player; p.__test.setFacing(yaw); if (G.cam) { G.cam.yaw = yaw; G.cam._rcHoldT = 0; } };
  return 'stepper ready'; }
"""


def restart(p):
    p.js("() => { const G=CRESTBOUND.game, E=CRESTBOUND.engine; if (!E.running || !E._loopFn) E.start((dt) => G.update(dt)); }")


def yaw_to(x0, z0, x1, z1):
    return math.atan2(-(x1 - x0), -(z1 - z0))


def stepper(p):
    p.say("  " + str(p.js(STEPPER)))


def step(p, n, every=1):
    return p.js("([n,e]) => __sfStep(n,e)", [n, every])


def place(p, x, y, z, yaw):
    p.js("([x,y,z,w]) => __sfPlace(x,y,z,w)", [x, y, z, yaw])


def face(p, yaw):
    p.js("(w) => __sfFace(w)", yaw)


def colliders_in(p, lo, hi):
    return p.js(r"""([lo,hi]) => { const bp = CRESTBOUND.game.course.broadphase; const THREE = CRESTBOUND.THREE;
      const box = new THREE.Box3(new THREE.Vector3(...lo), new THREE.Vector3(...hi)); const out=[]; bp.query(box, out);
      return out.map(c => ({c:[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2)], h:[+c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)],
        surf:c.surface, active:c.active!==false, solid:c.solid!==false, ref:(c.ref&&c.ref.kind)||(c.ref&&c.ref.def&&c.ref.def.kind)||null})); }""", [lo, hi])


# ------------------------------------------------------------------ stations
def v1pad(p):
    p.goto("verdant-1")
    info = p.js(r"""() => { const C = CRESTBOUND.game.course; const out={hazards:[], broken:[]};
      for (const h of (C.hazards||[])) if (h.def && (h.def.kind==='jumppad' || h.def.kind==='speedpad')) {
        const cols = (h.colliders||[]).map(c => ({c:[+c.center.x.toFixed(2),+c.center.y.toFixed(2),+c.center.z.toFixed(2)], h:[+c.half.x.toFixed(2),+c.half.y.toFixed(2),+c.half.z.toFixed(2)], surf:c.surface, active:c.active!==false, inBP: !!(c._bp || c.broadphase)}));
        out.hazards.push({kind:h.def.kind, p:h.def.p, s:h.def.s, power:h.def.power, cols, enabled: h.enabled!==false, ncol: (h.colliders||[]).length}); }
      const recs = C._hazardRecs || C.hazardRecs || C._recs || null;
      if (recs) for (const r of recs) if (r.broken) out.broken.push({kind: r.def && r.def.kind, p: r.def && r.def.p, err: String(r.error||r.err||'')});
      const hf = C.terrain && C.terrain.heightfield; out.gy = hf ? +hf.heightAt(13,-47).toFixed(2) : null;
      out.bpCount = C.broadphase.count; return out; }""")
    p.say("  jump/speed pads in verdant-1:", json.dumps(info))
    RES["v1pad_info"] = info
    RES["v1pad_bp"] = colliders_in(p, [10, 0, -50], [16, 20, -44])
    p.say("  broadphase 10..16 x 0..20 x -50..-44:", json.dumps(RES["v1pad_bp"]))
    stepper(p)
    for y0 in (8.6, 14.0):
        place(p, 13, y0, -47, NORTH)
        rows = step(p, 150, 10)
        p.say("  dropped from y %.1f onto (13,-47): %s" % (y0, rows))
        RES["v1pad_drop_%s" % y0] = rows
    restart(p)
    dump()


def a1hop(p):
    p.goto("azure-1")
    stepper(p)
    # pinned at x 0.38 on sinker pad 2's east face, feet -0.6 (the tester's float)
    place(p, 0.9, -0.6, 24, WEST)
    p.down("W"); r1 = step(p, 60, 10)
    p.say("  W west from 0.9: %s" % r1)
    # now tap SPACE while holding W
    p.down("SPACE"); r2 = step(p, 6, 1); p.up("SPACE")
    r3 = step(p, 120, 6)
    p.say("  SPACE tap: %s" % (r2 + r3))
    # keep holding W for 6 more seconds: does he cross the pad line and get back into the water west of it?
    r4 = step(p, 360, 30)
    p.up("W")
    p.say("  W held 6 s more: %s" % r4)
    RES["a1hop"] = {"approach": r1, "tap": r2 + r3, "cross": r4}
    # crouch-under: from the pinned spot, hold C + W
    place(p, 0.9, -0.6, 24, WEST)
    p.down("C"); p.down("W"); r5 = step(p, 300, 20); p.up("W"); p.up("C")
    p.say("  C+W under the pad: %s" % r5)
    RES["a1under"] = r5
    restart(p)
    dump()


def r3drift(p):
    p.goto("rime-3")
    stepper(p)
    prof = p.js(r"""() => { const C = CRESTBOUND.game.course; const hf = C.terrain && C.terrain.heightfield; const out=[];
      for (let z = 26; z >= -6; z -= 2) { const row=[]; for (const x of [-28,-30,-32,-34,-36,-38]) { const g = hf ? hf.heightAt(x,z) : NaN; row.push(isFinite(g)?+g.toFixed(1):null); } out.push([z,row]); } return out; }""")
    p.say("  terrain z rows (x -28..-38 step 2): %s" % prof)
    RES["r3_terrain"] = prof
    vols = p.js(r"""() => { const C = CRESTBOUND.game.course; return (C.volumes||[]).filter(v=>v.kind==='wind').map(v=>({c:[+v.center.x.toFixed(1),+v.center.y.toFixed(1),+v.center.z.toFixed(1)], h:[+v.half.x.toFixed(1),+v.half.y.toFixed(1),+v.half.z.toFixed(1)], power:v.props&&v.props.power, dir:v.props&&v.props.dir})); }""")
    p.say("  wind volumes: %s" % json.dumps(vols))
    for label, yaw in (("north, no correction", NORTH),):
        place(p, -28, 4.3, 26, yaw)
        step(p, 30)
        p.down("W"); rows = step(p, 300, 15); p.up("W")
        a, b = rows[0], rows[-1]
        gr = sum(1 for r in rows if r[7]) / float(len(rows))
        p.say("  %s 5 s: %s -> %s  lateral %.2f m (%.2f m/s)  grounded %.0f%% of samples" % (label, a[:3], b[:3], b[0] - a[0], (b[0] - a[0]) / 5.0, gr * 100))
        for r in rows: p.say("     ", r)
        RES["r3drift"] = rows
    # grounded-only drift: walk north on the flat shelf A area for 1.5 s and read the lateral velocity while grounded
    place(p, -28, 4.3, 26, NORTH); step(p, 30)
    p.down("W"); rows = step(p, 90, 5); p.up("W")
    RES["r3drift_short"] = rows
    p.say("  first 1.5 s: %s" % rows)
    restart(p)
    dump()


def v3crag(p):
    p.goto("verdant-3")
    stepper(p)
    # the two swinging sacks are the crossing's timing hazard (a head-bonk at the bottom of the swing, a
    # kill at swing speed); SACKS=0 disables them so the GAP is what is measured.
    if os.environ.get("SACKS") == "0":
        # the wrapper's `enabled` is not the inner hazard's: stop its update (which re-arms the ball
        # collider every frame) and deactivate every collider and kill it owns.
        n = p.js("() => { let n = 0; for (const h of CRESTBOUND.game.course.hazards) if (h.def && h.def.kind === 'pendulum' && h.def.p[0] > 5) { h.update = function () {}; for (const c of (h.colliders||[])) c.active = false; for (const k of (h.kills||[])) k.active = false; n++; } return n; }")
        p.say("  sacks DISABLED: %s pendulums" % n)
    crags = [(9.6, 17.70, -22.0, 3.4), (15.65, 19.10, -25.78, 3.6), (21.3, 20.30, -29.0, 3.6)]   # surfaces pass 2 positions
    RES["v3crag"] = []
    for i in range(2):
        cx, cy, cz, cw = crags[i]; nx, ny, nz, nw = crags[i + 1]
        for run_ms in (400, 250, 150):
            place(p, cx, cy + 0.05, cz, yaw_to(cx, cz, nx, nz)); step(p, 40)
            # a fresh single: the previous run's landing must not arm a jump2 for this one
            p.js("() => { const P = CRESTBOUND.game.player; P.jumpCount = 0; P._chainT = 0; P._chainSpeed = 0; }")
            step(p, 2)
            p.down("W"); r1 = step(p, int(run_ms * 60 / 1000), 4)
            p.down("SPACE"); r2 = step(p, 15, 3); p.up("SPACE")
            r3 = []
            for _ in range(40):
                s = step(p, 3, 3); r3 += s
                if s[-1][7] == 1 and len(r3) > 4: break
            p.up("W"); step(p, 10)
            e = r3[-1]
            on = abs(e[0] - nx) <= nw / 2 + 0.1 and abs(e[2] - nz) <= nw / 2 + 0.1 and abs(e[1] - ny) < 0.3
            gap_line = math.hypot(nx - cx, nz - cz)
            p.say("  crag %d -> %d run %d ms: launch %s -> land %s  ON CRAG %s (centres %.2f m apart, rise %.2f)" % (
                i + 1, i + 2, run_ms, r1[-1][:3], e[:3], on, gap_line, ny - cy))
            p.say("     run rows %s" % r1)
            p.say("     air rows %s" % (r2 + r3))
            RES["v3crag"].append({"from": i + 1, "run_ms": run_ms, "launch": r1[-1], "end": e, "on": on})
    restart(p)
    dump()


def e2float(p):
    p.goto("ember-2")
    stepper(p)
    vols = p.js(r"""() => { const C = CRESTBOUND.game.course; return (C.volumes||[]).filter(v=>v.kind==='current'||v.kind==='water').map(v=>({kind:v.kind, c:[+v.center.x.toFixed(1),+v.center.y.toFixed(1),+v.center.z.toFixed(1)], h:[+v.half.x.toFixed(1),+v.half.y.toFixed(1),+v.half.z.toFixed(1)], power:v.props&&v.props.power, surfaceY:v.surfaceY})); }""")
    p.say("  water/current volumes: %s" % json.dumps(vols))
    place(p, 4, 4.5, -14, NORTH)
    rows = step(p, 540, 30)
    a = [r for r in rows if r[9]][0] if any(r[9] for r in rows) else rows[0]
    b = rows[-1]
    p.say("  coolant float 9 s from (4,4.5,-14): first-wet %s -> %s : %.2f m/s west (authored 3.2)" % (a[:3], b[:3], -(b[0] - a[0]) / ((len(rows) - rows.index(a) - 1) * 0.5)))
    for r in rows: p.say("     ", r)
    RES["e2float"] = rows
    restart(p)
    dump()


def a3air(p):
    p.goto("azure-3")
    vols = p.js(r"""() => { const C = CRESTBOUND.game.course; return (C.volumes||[]).filter(v=>v.kind==='current').map(v=>({c:[+v.center.x.toFixed(1),+v.center.y.toFixed(1),+v.center.z.toFixed(1)], h:[+v.half.x.toFixed(1),+v.half.y.toFixed(1),+v.half.z.toFixed(1)], power:v.props&&v.props.power, dir:v.props&&v.props.dir})); }""")
    p.say("  air current volumes: %s" % json.dumps(vols))
    RES["a3_vols"] = vols
    stepper(p)
    p.js("() => CRESTBOUND.game.__dev.power && CRESTBOUND.game.__dev.power('wing', 60)")
    # inside current 1: centre (-30, 40, -8) dir (-0.62, 0.35, -0.70) power 5. Start at its centre, airborne, hold jump to glide, no stick.
    place(p, -30, 40, -8, NORTH)
    p.js("() => { const P = CRESTBOUND.game.player; P.__test.setVel({x:0,y:0,z:0}); P.__test.force && P.__test.force('fall'); }")
    p.down("SPACE"); rows = step(p, 120, 10); p.up("SPACE")
    p.say("  glide inside current 1 (SPACE held, no stick) 2 s: %s" % rows)
    RES["a3air_glide"] = rows
    p.say("  power now: %s" % p.js("() => ({power: CRESTBOUND.game.power, pstate: CRESTBOUND.game.player.state, flyT: CRESTBOUND.game.player._flyT})"))
    restart(p)
    dump()


def a3fly(p):
    """azure-3: the glide itself (player.setFly — the contract's API game.js will call for the wing),
    started at rest inside air current 1 with no stick: does the current carry the flyer?
    Then the same from the pier lip flying north-west at run speed through the volume."""
    p.goto("azure-3")
    stepper(p)
    outs = {}
    # setFly() only enters 'fly' when the hero is ALREADY airborne at the call (a teleport leaves
    # `grounded` true until the next substep) and nothing promotes fall -> fly later: the glide
    # ENTRY is the power lane's gap. The state is forced here so the CURRENT response can be read.
    FLY = "() => { const P = CRESTBOUND.game.player; P.__test.setVel({x:0,y:0,z:0}); P.setFly(true, 60); P.__test.force('fly'); if (P.state !== 'fly') P._setState('fly'); return P.state; }"
    # (a) at rest at the volume centre, fly, no input, 2 s
    place(p, -30, 40, -8, NORTH); step(p, 2)
    p.js(FLY)
    rows = step(p, 120, 10)
    p.say("  fly at rest in current 1 (dir -0.62,0.35,-0.70 x 5): %s" % rows)
    outs["rest"] = rows
    # (b) a control OUTSIDE any current: same thing at (-30, 40, 8) (volume 1 spans z -15..-1)
    place(p, -30, 40, 8, NORTH); step(p, 2)
    p.js(FLY)
    rows = step(p, 120, 10)
    p.say("  fly at rest OUTSIDE (control): %s" % rows)
    outs["control"] = rows
    # (c) launched over the pier's west lip at 9 m/s north-west (toward ring 1 at (-26.4, 38.6, -12.7)), W held, 2.5 s
    place(p, -31.5, 38.0, -10, yaw_to(-31.5, -10, -36.5, -16)); step(p, 2)
    p.js("() => { const P = CRESTBOUND.game.player; P.__test.setVel({x:-6.4,y:2,z:-6.4}); P.setFly(true, 60); P.__test.force('fly'); if (P.state !== 'fly') P._setState('fly'); return P.state; }")
    p.down("W"); rows = step(p, 150, 10); p.up("W")
    p.say("  fly NW from the pier lip at 9 m/s, W held: %s" % rows)
    outs["pier"] = rows
    RES["a3fly"] = outs
    restart(p)
    dump()


def r3disc(p):
    """rime-3 discriminator for the hands-off west-face run: which of wind / camera auto-yaw / slope turns the run west?"""
    p.goto("rime-3")
    stepper(p)
    outs = {}

    def run(label, wind_on, pin_cam, pin_face, frames=300):
        p.js("(on) => { for (const v of CRESTBOUND.game.course.volumes) if (v.kind === 'wind') v.active = on; }", wind_on)
        place(p, -28, 4.3, 26, NORTH); step(p, 30)
        p.down("W"); rows = []
        for i in range(frames // 15):
            if pin_cam: p.js("() => { const G = CRESTBOUND.game; G.cam.yaw = 0; G.cam._lastManualT = G.cam._time; }")
            if pin_face: p.js("() => { CRESTBOUND.game.player.__test.setFacing(0); }")
            rows += step(p, 15, 15)
        p.up("W")
        a, b = rows[0], rows[-1]
        hv = [round(math.degrees(math.atan2(-r[4], -r[6])), 1) if abs(r[4]) + abs(r[6]) > 0.5 else None for r in rows]
        p.say("  %-44s %s -> %s  lateral %+.2f m (%+.2f m/s)  heading(deg, +=west) %s" % (label, a[:3], b[:3], b[0] - a[0], (b[0] - a[0]) / (frames / 60.0), hv))
        outs[label] = {"a": a, "b": b, "lateral": b[0] - a[0], "headings": hv, "rows": rows}

    run("wind OFF, hands off", False, False, False)
    run("wind ON, hands off", True, False, False)
    run("wind ON, camera yaw pinned north", True, True, False)
    run("wind ON, camera + facing pinned north", True, True, True)
    p.js("() => { for (const v of CRESTBOUND.game.course.volumes) if (v.kind === 'wind') v.active = true; }")
    RES["r3disc"] = outs
    restart(p)
    dump()


def r3idle(p):
    """rime-3: hands off on the two checkpoint pads that sit INSIDE the gale (cp-gorge, cp-bridge) and
    azure-3's cp-gauntlet-mid — an idle hero must stay on the pad (loopcheck: within 0.6 m after respawn)."""
    outs = {}
    for course, x, y, z, label in ((u"rime-3", -36.0, 6.6, -9.0, "rime-3 cp-gorge"), (u"rime-3", -23.8, 8.0, -30.7, "rime-3 cp-bridge"),
                                   (u"azure-3", -11.0, 51.4, -62.0, "azure-3 cp-gauntlet-mid")):
        p.goto(course)
        stepper(p)
        place(p, x, y + 0.3, z, NORTH); step(p, 30)
        a = step(p, 1)[0]
        rows = step(p, 300, 60)
        b = rows[-1]
        d = math.hypot(b[0] - a[0], b[2] - a[2])
        p.say("  %-26s idle 5 s in the gale: %s -> %s  moved %.2f m  grounded %s  st %s" % (label, a[:3], b[:3], d, b[7], b[3]))
        outs[label] = {"a": a, "b": b, "moved": d}
        restart(p)
    RES["r3idle"] = outs
    dump()


def r3shelf(p):
    """rime-3 shelf A -> B with the replay driver's three run-ups, hand-stepped and SAMPLED (the replay
    driver prints only the landing): where does a mistimed 500 ms run-up end, and why."""
    p.goto("rime-3")
    stepper(p)
    outs = {}
    for runup_ms in (350, 500, 650):
        place(p, -29.0, 4.4, 26.0, yaw_to(-29.0, 26.0, -32.6, 20.0)); step(p, 30)
        p.js("() => { const P = CRESTBOUND.game.player; P.jumpCount = 0; P._chainT = 0; }")
        p.down("W"); r1 = step(p, int(runup_ms * 60 / 1000), 6)
        p.down("SPACE"); r2 = step(p, 15, 5); p.up("SPACE")
        r3 = []
        for _ in range(60):
            s = step(p, 5, 5); r3 += s
            if (s[-1][7] == 1 and len(r3) > 6) or s[-1][3] == 'dead': break
        p.up("W"); step(p, 5)
        e = r3[-1]
        onB = abs(e[0] + 32.6) <= 2.0 and abs(e[2] - 20) <= 2.0 and e[1] > 5.0
        p.say("  run-up %d ms: launch %s -> end %s st %s ON B %s deaths %s" % (runup_ms, r1[-1][:3], e[:3], e[3], onB, e[10]))
        p.say("     run %s" % r1)
        p.say("     air %s" % (r2 + r3))
        outs[runup_ms] = {"launch": r1[-1], "end": e, "onB": onB, "run": r1, "air": r2 + r3}
    RES["r3shelf"] = outs
    restart(p)
    dump()


STATIONS = {"v1pad": v1pad, "a1hop": a1hop, "r3drift": r3drift, "v3crag": v3crag, "e2float": e2float, "a3air": a3air, "a3fly": a3fly, "r3disc": r3disc, "r3idle": r3idle, "r3shelf": r3shelf}


def main():
    want = sys.argv[1:] or list(STATIONS)
    if os.path.exists(OUT):
        try: RES.update(json.load(open(OUT, encoding="utf-8")))
        except Exception: pass
    with E2("sf2_probe", url=URL) as p:
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
