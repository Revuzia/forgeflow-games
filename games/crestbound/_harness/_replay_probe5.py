# -*- coding: utf-8 -*-
"""probe5 -- the last measurable defects the other probes leave open.

  underwater   submerge and read post._underwaterTarget / the resolved post
  longjump     frame-step crouch -> jump at 1 / 3 / 6 / 10 frames and measure the
               distance, i.e. how wide the long-jump window really is
  runup        distance covered by a jump after 120 / 200 / 300 / 500 ms of W
  current      float in each 'current' volume, then swim into it, and measure
  sinker       stand on each 'sinker' hazard and measure the descent
  clearcard    take the open crest and read whether a modal survives into play

Output: _replayout/probe5_<course>.json
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _playlib import Play

OUT = os.path.join(HERE, "_replayout")
os.makedirs(OUT, exist_ok=True)

SNAP = """() => { const G=CRESTBOUND.game, P=G.player;
  return { st:P?P.state:null, x:+P.pos.x.toFixed(3), y:+P.pos.y.toFixed(3), z:+P.pos.z.toFixed(3),
    sp:+(P.speed||0).toFixed(2), gr:!!P.grounded, w:!!P.inWater, sub:!!P.submerged,
    deaths:G.deaths|0, gs:G.state }; }"""

UW = """() => { const G=CRESTBOUND.game, E=CRESTBOUND.engine, C=G.cam, P=G.player;
  const post = E && E.post;
  let resolved = null;
  try { resolved = C && C._resolvePost ? !!C._resolvePost() : null; } catch(e) { resolved = 'err'; }
  return { submerged: P?!!P.submerged:null, inWater: P?!!P.inWater:null,
    hasPost: !!post, hasSetUnderwater: !!(post && typeof post.setUnderwater==='function'),
    camResolvesPost: resolved, camPost: !!(C && C._post),
    underwaterTarget: post && post._underwaterTarget!==undefined ? +(+post._underwaterTarget).toFixed(4) : null,
    uUnderwater: (function(){ try{ const u=post && post.finish && post.finish.uniforms;
      return u && u.uUnderwater ? +(+u.uUnderwater.value).toFixed(4) : null; }catch(e){ return null; } })() }; }"""

WATERS = """() => { const C=CRESTBOUND.game.course; if(!C) return [];
  const n=(v)=>+(+v).toFixed(2);
  return (C.volumes||[]).filter(v=>v.kind==='water').map(v=>({
    c:[n(v.center.x),n(v.center.y),n(v.center.z)], h:[n(v.half.x),n(v.half.y),n(v.half.z)] })); }"""

CURRENTS = """() => { const C=CRESTBOUND.game.course; if(!C) return [];
  const n=(v)=>+(+v).toFixed(2);
  return (C.volumes||[]).filter(v=>v.kind==='current').map(v=>({
    c:[n(v.center.x),n(v.center.y),n(v.center.z)], h:[n(v.half.x),n(v.half.y),n(v.half.z)],
    power:(v.props&&v.props.power)||null, dir:(v.props&&Array.isArray(v.props.dir))?v.props.dir:null })); }"""

SINKERS = """() => { const C=CRESTBOUND.game.course; if(!C) return [];
  return (C.hazards||[]).filter(h=>(h.kind||(h.def&&h.def.kind))==='sinker')
    .map(h=>({p:(h.def&&h.def.p)||null, s:(h.def&&h.def.s)||null,
              delay:(h.def&&h.def.delay)||null, speed:(h.def&&h.def.speed)||null})); }"""

FRAMESTEP_LJ = """(nFrames) => {
  const G=CRESTBOUND.game, E=CRESTBOUND.engine, P=G.player, I=G.input;
  const t=P.__test; const out={};
  E.stop && E.stop();
  t.teleport({x:0,y:200,z:0});
  return 'stopped'; }"""


def tp(p, xyz, dy=0.1):
    p.js("(a)=>{CRESTBOUND.game.__dev.tp(a[0],a[1],a[2]);"
         "CRESTBOUND.game.player.__test.setVel({x:0,y:0,z:0});}",
         [xyz[0], xyz[1] + dy, xyz[2]])
    p.wait(300)


def run(course):
    res = {"course": course, "tests": []}

    def T(kind, **kw):
        kw["kind"] = kind
        res["tests"].append(kw)
        print("   %-11s %s" % (kind, json.dumps({k: v for k, v in kw.items() if k != "kind"})[:220]), flush=True)

    with Play("probe5_" + course) as p:
        p.click_title(); p.wait(1200); p.unlock_all(); p.wait(400)
        if course != "keep":
            p.js("(c)=>{CRESTBOUND.game.__dev.goto(c);}", course)
            for _ in range(90):
                p.wait(250)
                if p.js("()=>(CRESTBOUND.game.state==='playing'&&CRESTBOUND.game.courseId===%s)"
                        % json.dumps(course)):
                    break
        p.wait(1400)

        # ---------------- underwater grade
        waters = p.js(WATERS) or []
        for i, w in enumerate(waters[:3]):
            try:
                c, h = w["c"], w["h"]
                tp(p, [c[0], c[1] + h[1] - 0.4, c[2]], 0)
                p.wait(700)
                surf = p.js(UW)
                p.down("C"); p.wait(2600)
                sub = p.js(UW)
                st = p.js(SNAP)
                p.up("C"); p.wait(300)
                T("underwater", i=i, box=w, floating=surf, submerged=sub, state=st["st"],
                  gradeFires=bool(sub.get("submerged") and (sub.get("underwaterTarget") or 0) > 0.3))
            except Exception as e:
                T("underwater", i=i, error=str(e)[:140])

        # ---------------- currents
        for i, cur in enumerate((p.js(CURRENTS) or [])[:3]):
            try:
                c = cur["c"]
                tp(p, [c[0], c[1], c[2]], 0.2)
                a = p.js(SNAP); p.wait(4000); b = p.js(SNAP)
                drift = round(math.hypot(b["x"] - a["x"], b["z"] - a["z"]) / 4.0, 2)
                tp(p, [c[0], c[1], c[2]], 0.2)
                # swim against the drift direction
                yaw = math.atan2(-(a["x"] - b["x"]), -(a["z"] - b["z"]))
                p.js("(y)=>{const G=CRESTBOUND.game;G.player.__test.setFacing(y);"
                     "if(G.cam){G.cam.yaw=y;G.cam._rcHoldT=0;}}", yaw)
                a2 = p.js(SNAP); p.down("W"); p.wait(4000); p.up("W"); b2 = p.js(SNAP)
                against = round(math.hypot(b2["x"] - a2["x"], b2["z"] - a2["z"]) / 4.0, 2)
                # signed: did he make progress the way he asked?
                dot = ((b2["x"] - a2["x"]) * (a["x"] - b["x"]) + (b2["z"] - a2["z"]) * (a["z"] - b["z"]))
                T("current", i=i, box=cur, driftSpeed=drift, swimSpeed=against,
                  madeHeadway=(dot > 0), endState=b2["st"])
            except Exception as e:
                T("current", i=i, error=str(e)[:140])

        # ---------------- sinkers
        for i, s in enumerate((p.js(SINKERS) or [])[:4]):
            if not s.get("p"):
                continue
            try:
                half = ((s.get("s") or [0, 0, 0])[1] or 0) / 2.0
                tp(p, [s["p"][0], s["p"][1] + half, s["p"][2]], 0.3)
                a = p.js(SNAP); p.wait(4500); b = p.js(SNAP)
                T("sinker", i=i, p=s["p"], delay=s.get("delay"), speed=s.get("speed"),
                  descended=round(a["y"] - b["y"], 2), endState=b["st"], grounded=b["gr"],
                  deaths="%s->%s" % (a["deaths"], b["deaths"]))
            except Exception as e:
                T("sinker", i=i, error=str(e)[:140])

        # ---------------- long-jump window (real key events, timed gaps)
        try:
            sp = p.js("()=>{const d=CRESTBOUND.game.course.def; const s=d.spawn&&d.spawn.p; return s||[0,2,0];}")
            for gap in (0, 60, 110, 180, 260):
                tp(p, sp, 0.4)
                p.js("()=>{CRESTBOUND.game.player.__test.setFacing(0);"
                     "if(CRESTBOUND.game.cam){CRESTBOUND.game.cam.yaw=0;}}")
                p.wait(200)
                p.down("W"); p.wait(1200)
                a = p.js(SNAP)
                p.down("C")
                if gap: p.wait(gap)
                p.tap("Space", 90)
                p.wait(120); p.up("C")
                sts = []
                for _ in range(10):
                    p.wait(110); sts.append(p.js("()=>CRESTBOUND.game.player.state"))
                p.up("W"); p.wait(500)
                b = p.js(SNAP)
                T("longjump", gapMs=gap, speedAtPress=a["sp"],
                  dist=round(math.hypot(b["x"] - a["x"], b["z"] - a["z"]), 2),
                  states=sorted(set(sts)), fired=("longjump" in sts))
        except Exception as e:
            T("longjump", error=str(e)[:140])

        # ---------------- run-up sensitivity
        try:
            sp = p.js("()=>{const d=CRESTBOUND.game.course.def; const s=d.spawn&&d.spawn.p; return s||[0,2,0];}")
            for ms in (120, 200, 300, 500, 900):
                tp(p, sp, 0.4)
                p.js("()=>{CRESTBOUND.game.player.__test.setFacing(0);"
                     "if(CRESTBOUND.game.cam){CRESTBOUND.game.cam.yaw=0;}}")
                p.wait(200)
                a = p.js(SNAP)
                p.down("W"); p.wait(ms); p.tap("Space", 90); p.wait(900); p.up("W"); p.wait(400)
                b = p.js(SNAP)
                T("runup", holdMs=ms, dist=round(math.hypot(b["x"] - a["x"], b["z"] - a["z"]), 2),
                  endState=b["st"])
        except Exception as e:
            T("runup", error=str(e)[:140])

        # ---------------- clear card over live play
        try:
            crest = p.js("()=>{const c=(CRESTBOUND.game.course.def.crests||[]).find(x=>x.type==='open');"
                         "return c?c.p:null;}")
            if crest:
                tp(p, crest, 0.0); p.wait(1400)
                mid = p.js("()=>({gs:CRESTBOUND.game.state, modal:!!document.querySelector('.cb-card.on,.cb-clear.on,.ch-clear.on')})")
                p.wait(4200)
                late = p.js("()=>({gs:CRESTBOUND.game.state, modal:!!document.querySelector('.cb-card.on,.cb-clear.on,.ch-clear.on'),"
                            "grounded:!!CRESTBOUND.game.player.grounded})")
                T("clearcard", crest=crest, atCollect=mid, after4s=late,
                  modalOverLivePlay=bool(late.get("modal") and late.get("gs") == "playing"))
        except Exception as e:
            T("clearcard", error=str(e)[:140])

        res["console"] = p.console[:30]

    def clean(o):
        import math as _m
        if isinstance(o, float):
            return None if (_m.isnan(o) or _m.isinf(o)) else o
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, list):
            return [clean(v) for v in o]
        return o
    json.dump(clean(res), open(os.path.join(OUT, "probe5_%s.json" % course), "w", encoding="utf-8"), indent=1)
    return res


if __name__ == "__main__":
    for c in sys.argv[1:]:
        print("=== probe5 %s" % c, flush=True)
        run(c)
