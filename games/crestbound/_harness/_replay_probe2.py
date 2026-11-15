# -*- coding: utf-8 -*-
"""Targeted mechanism probe -- the questions the coordinate probe cannot answer.

For every course, boot once and interrogate EVERY live instance of the machinery
the playtesters found dead:

  wardens       stand in the arena 4 s -> does it leave 'dormant'?
  breakables    stand over it, ground-pound -> does `broken` flip / do coins drop?
  gnashers      stand at 3.0 m from the post 4 s -> does it kill?
  cannons       walk into the breech, press E -> does the hero enter 'cannon'?
  power hats    walk over the hat -> does game.power become non-null?
  race pads     stand on the start pad -> does raceMs arm?
  quicksand     stand in it 4 s -> inQuicksand / does he sink?
  conveyors     stand on it 3 s -> does it carry?
  jump/speedpads stand on it -> rise / top speed
  seesaws       stand off-centre -> does the collider tilt?
  crests+sigils teleport onto every one -> does it collect?
  NPCs          stand at the talk radius, press E -> does dialogue appear?
  key conflict  hold KeyR 0.65 s -> camera pitch delta AND course restart?

Output: _replayout/probe2_<course>.json

    python _replay_probe2.py <course> [<course> ...]
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _playlib import Play

OUT = os.path.join(HERE, "_replayout")
os.makedirs(OUT, exist_ok=True)

INV = """() => { const G=CRESTBOUND.game, C=G.course; if(!C) return null;
  const n=(v)=>+(+v).toFixed(2), P3=(o)=>o?[n(o.x),n(o.y),n(o.z)]:null;
  const out={wardens:[],gnashers:[],breakables:[],cannons:[],powers:[],
             quicksand:[],conveyors:[],pads:[],crests:[],sigils:[],npcs:[],seesaws:[],rotors:[]};
  for (const c of (C.critters||[])) {
    const k=c.kind||(c.def&&c.def.kind);
    const p=P3(c.mesh&&c.mesh.position)||(c.def&&c.def.p)||null;
    if(k==='warden') out.wardens.push({p:p, state:c.state, hp:c.hp, alive:c.alive});
    else if(k==='gnasher') out.gnashers.push({p:p, post:(c.def&&c.def.post)||null, chain:(c.def&&c.def.chain)||null, state:c.state});
    else if(k==='fen') out.npcs.push({p:p});
  }
  for (const h of (C.hazards||[])) {
    const k=h.kind||(h.def&&h.def.kind); const d=h.def||{}; const p=d.p||null;
    if(k==='breakable') out.breakables.push({p:p, s:d.s||null, drop:d.drop||null, broken:!!h.broken});
    else if(k==='cannon') out.cannons.push({p:p, yaw:d.yaw, power:d.power, target:d.target||null});
    else if(k==='quicksand') out.quicksand.push({p:p, s:d.s||null});
    else if(k==='conveyor') out.conveyors.push({p:p, s:d.s||null, dir:d.dir||null, speed:d.speed||d.power||null});
    else if(k==='jumppad'||k==='speedpad') out.pads.push({padKind:k, p:p, power:d.power||null});
    else if(k==='seesaw') out.seesaws.push({p:p, s:d.s||null});
    else if(k==='rotor') out.rotors.push({p:p, style:d.style||null, arms:d.arms||null, len:d.len||null});
  }
  const D=C.def||{};
  for (const c of (D.powers||[])) out.powers.push({powerKind:c.kind, p:c.p});
  for (const c of (D.crests||[])) out.crests.push({id:c.id, type:c.type, p:c.p||c.spawnAt||null,
      start:c.start||null, finish:c.finish||null, limitMs:c.limitMs||null});
  let si=0; for (const s of (D.sigils||[])) { out.sigils.push({i:si++, p:(s&&s.p)||s}); }
  return out; }"""

SNAP = """() => { const G=CRESTBOUND.game, P=G.player, s=G._snapshot?G._snapshot():{};
  return { st:P?P.state:null, p:P?[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)]:null,
    vy:P?+P.vel.y.toFixed(2):null, sp:P?+(P.speed||0).toFixed(2):null, gr:P?!!P.grounded:null,
    sf:P?P.surface:null, qs:P?!!P.inQuicksand:null, deaths:G.deaths|0,
    power:G.power?G.power.id:null, raceMs:(s.raceMs===undefined?null:s.raceMs),
    coins:s.coins||0, sigils:s.sigils||0, crests:s.crests||0,
    clock:G.course?+G.course.clock.toFixed(1):0,
    camPitch:G.cam?+G.cam.pitch.toFixed(3):null, gs:G.state, courseId:G.courseId }; }"""

HAZ_STATE = ("(a)=>{const kind=a[0],i=a[1];"
             "const h=(CRESTBOUND.game.course.hazards||[]).filter(x=>(x.kind||(x.def&&x.def.kind))===kind)[i];"
             "return h?{broken:!!h.broken,cols:(h.colliders||[]).filter(c=>c.active!==false).length}:null;}")
WARD_STATE = ("(i)=>{const c=(CRESTBOUND.game.course.critters||[])"
              ".filter(x=>(x.kind||(x.def&&x.def.kind))==='warden')[i];"
              "return c?{state:c.state,hp:c.hp,alive:c.alive}:null;}")
SEESAW_Q = ("(i)=>{const h=(CRESTBOUND.game.course.hazards||[])"
            ".filter(x=>(x.kind||(x.def&&x.def.kind))==='seesaw')[i];"
            "if(!h||!h.colliders||!h.colliders[0])return null;const c=h.colliders[0];"
            "return c.quat?[+c.quat.x.toFixed(3),+c.quat.y.toFixed(3),+c.quat.z.toFixed(3),+c.quat.w.toFixed(3)]:null;}")


def tp(p, xyz, dy=0.1):
    p.js("(a)=>{CRESTBOUND.game.__dev.tp(a[0],a[1],a[2]);"
         "CRESTBOUND.game.player.__test.setVel({x:0,y:0,z:0});}",
         [xyz[0], xyz[1] + dy, xyz[2]])
    p.wait(320)


def faceto(p, frm, to):
    yaw = math.atan2(-(to[0] - frm[0]), -(to[2] - frm[2]))
    p.js("(y)=>{const G=CRESTBOUND.game;G.player.__test.setFacing(y);"
         "if(G.cam){G.cam.yaw=y;G.cam._rcHoldT=0;}}", yaw)
    p.wait(120)


def dist2(a, b):
    return round(math.hypot(a[0] - b[0], a[2] - b[2]), 2)


def run(course):
    res = {"course": course, "tests": []}

    def T(kind, **kw):
        kw["kind"] = kind
        res["tests"].append(kw)
        body = json.dumps({k: v for k, v in kw.items() if k != "kind"})[:200]
        print("   %-11s %s" % (kind, body), flush=True)

    with Play("probe2_" + course) as p:
        p.click_title(); p.wait(1200); p.unlock_all(); p.wait(400)
        if course != "keep":
            p.js("(c)=>{CRESTBOUND.game.__dev.goto(c);}", course)
            for _ in range(90):
                p.wait(250)
                if p.js("()=>(CRESTBOUND.game.state==='playing'&&CRESTBOUND.game.courseId===%s)"
                        % json.dumps(course)):
                    break
        p.wait(1400)
        inv = p.js(INV) or {}
        res["inventory"] = inv
        res["loaded"] = p.js("()=>({id:CRESTBOUND.game.courseId,state:CRESTBOUND.game.state})")
        print("   inventory: " + json.dumps({k: len(v) for k, v in inv.items()}), flush=True)

        # ---- key conflict: does the documented camera-up key wipe the run?
        try:
            a = p.js(SNAP)
            p.down("R"); p.wait(650); p.up("R"); p.wait(350)
            b = p.js(SNAP)
            T("keyR", pitchBefore=a["camPitch"], pitchAfter=b["camPitch"],
              clockBefore=a["clock"], clockAfter=b["clock"],
              restarted=(b["clock"] < a["clock"] - 0.4))
        except Exception as e:
            T("keyR", error=str(e)[:140])

        # ---- wardens
        for i, w in enumerate(inv.get("wardens", [])):
            if not w.get("p"):
                continue
            try:
                tp(p, w["p"], 1.2)
                a = p.js(SNAP)
                p.wait(3600)
                st = p.js(WARD_STATE, i)
                s = p.js(SNAP)
                T("warden", i=i, p=w["p"], before=w.get("state"), after=st,
                  deaths="%s->%s" % (a["deaths"], s["deaths"]),
                  woke=bool(st and st.get("state") and st.get("state") != "dormant"))
            except Exception as e:
                T("warden", i=i, error=str(e)[:140])

        # ---- breakables: hover over it, pound
        for i, b in enumerate(inv.get("breakables", [])):
            if not b.get("p"):
                continue
            try:
                half = ((b.get("s") or [0, 0, 0])[1] or 0) / 2.0
                tp(p, [b["p"][0], b["p"][1] + half + 2.6, b["p"][2]], 0)
                a = p.js(SNAP)
                p.wait(140); p.tap("C", 150); p.wait(1600)
                st = p.js(HAZ_STATE, ["breakable", i])
                s = p.js(SNAP)
                T("breakable", i=i, p=b["p"], drop=b.get("drop"), after=st,
                  coins="%s->%s" % (a["coins"], s["coins"]),
                  crests="%s->%s" % (a["crests"], s["crests"]),
                  broke=bool(st and st.get("broken")), state=s["st"])
            except Exception as e:
                T("breakable", i=i, error=str(e)[:140])

        # ---- gnashers: stand 3 m from the post
        for i, g in enumerate(inv.get("gnashers", [])):
            po = g.get("post") or g.get("p")
            if not po:
                continue
            try:
                x = po[0]
                z = po[-1]
                y = (g.get("p") or [0, 0, 0])[1]
                at = [x + 3.0, y, z]
                tp(p, at, 0.2)
                a = p.js(SNAP)
                p.wait(4000)
                s = p.js(SNAP)
                T("gnasher", i=i, post=po, standAt=at,
                  deaths="%s->%s" % (a["deaths"], s["deaths"]),
                  killed=(s["deaths"] > a["deaths"]))
            except Exception as e:
                T("gnasher", i=i, error=str(e)[:140])

        # ---- cannons: walk into the breech and press E
        for i, c in enumerate(inv.get("cannons", [])):
            if not c.get("p"):
                continue
            try:
                stand = [c["p"][0], c["p"][1], c["p"][2] + 2.2]
                tp(p, stand, 0.3)
                faceto(p, stand, c["p"])
                a = p.js(SNAP)
                p.down("W"); p.wait(1100); p.up("W"); p.wait(160)
                p.tap("E", 130); p.wait(900)
                mid = p.js(SNAP)
                p.wait(2600)
                s = p.js(SNAP)
                T("cannon", i=i, p=c["p"], stateAfterE=mid["st"], endState=s["st"],
                  moved=dist2(a["p"], s["p"]),
                  entered=(mid["st"] == "cannon" or s["st"] == "cannon"))
            except Exception as e:
                T("cannon", i=i, error=str(e)[:140])

        # ---- power hats
        for i, w in enumerate(inv.get("powers", [])):
            if not w.get("p"):
                continue
            try:
                tp(p, w["p"], 0.2)
                p.wait(1000)
                s = p.js(SNAP)
                T("power", i=i, powerKind=w.get("powerKind"), p=w["p"],
                  power=s["power"], got=bool(s["power"]))
            except Exception as e:
                T("power", i=i, error=str(e)[:140])

        # ---- race pads
        for c in inv.get("crests", []):
            if c.get("type") != "race" or not c.get("start"):
                continue
            try:
                tp(p, c["start"], 0.3)
                p.wait(500)
                p.down("W"); p.wait(450); p.up("W"); p.wait(1000)
                s = p.js(SNAP)
                T("race", id=c.get("id"), start=c["start"], raceMs=s["raceMs"],
                  armed=(s["raceMs"] is not None))
            except Exception as e:
                T("race", id=c.get("id"), error=str(e)[:140])

        # ---- quicksand
        for i, q in enumerate(inv.get("quicksand", [])):
            if not q.get("p"):
                continue
            try:
                tp(p, q["p"], 1.2)
                a = p.js(SNAP)
                p.wait(4000)
                s = p.js(SNAP)
                T("quicksand", i=i, p=q["p"], inQuicksand=s["qs"], surface=s["sf"],
                  sank=round(a["p"][1] - s["p"][1], 2),
                  deaths="%s->%s" % (a["deaths"], s["deaths"]))
            except Exception as e:
                T("quicksand", i=i, error=str(e)[:140])

        # ---- conveyors / belts
        for i, cv in enumerate(inv.get("conveyors", [])):
            if not cv.get("p"):
                continue
            try:
                half = ((cv.get("s") or [0, 0, 0])[1] or 0) / 2.0
                tp(p, [cv["p"][0], cv["p"][1] + half, cv["p"][2]], 0.35)
                a = p.js(SNAP)
                p.wait(3000)
                s = p.js(SNAP)
                T("conveyor", i=i, p=cv["p"], carried=dist2(a["p"], s["p"]),
                  end=s["p"], surface=s["sf"], state=s["st"],
                  deaths="%s->%s" % (a["deaths"], s["deaths"]))
            except Exception as e:
                T("conveyor", i=i, error=str(e)[:140])

        # ---- jump / speed pads
        for i, pd in enumerate(inv.get("pads", [])):
            if not pd.get("p"):
                continue
            try:
                tp(p, pd["p"], 1.6)
                peak = pd["p"][1]
                top = 0.0
                for _ in range(14):
                    p.wait(140)
                    s = p.js(SNAP)
                    peak = max(peak, s["p"][1])
                    top = max(top, s["sp"] or 0)
                s = p.js(SNAP)
                T("pad", i=i, padKind=pd.get("padKind"), p=pd["p"], power=pd.get("power"),
                  rise=round(peak - pd["p"][1], 2), topSpeed=round(top, 2), surface=s["sf"])
            except Exception as e:
                T("pad", i=i, error=str(e)[:140])

        # ---- seesaws
        for i, ss in enumerate(inv.get("seesaws", [])):
            if not ss.get("p"):
                continue
            try:
                sx = ((ss.get("s") or [2, 0, 0])[0] or 2) * 0.35
                half = ((ss.get("s") or [0, 0, 0])[1] or 0) / 2.0
                tp(p, [ss["p"][0] + sx, ss["p"][1] + half, ss["p"][2]], 0.35)
                p.wait(2600)
                q = p.js(SEESAW_Q, i)
                T("seesaw", i=i, p=ss["p"], quat=q,
                  tilted=bool(q and abs(q[3]) < 0.9995))
            except Exception as e:
                T("seesaw", i=i, error=str(e)[:140])

        # ---- collectibles: every crest and every sigil, on contact
        for c in inv.get("crests", []):
            if not c.get("p"):
                continue
            try:
                a = p.js(SNAP)
                tp(p, c["p"], 0.0)
                p.wait(1300)
                s = p.js(SNAP)
                T("crest", id=c.get("id"), crestType=c.get("type"), p=c["p"],
                  crests="%s->%s" % (a["crests"], s["crests"]),
                  got=(s["crests"] > a["crests"]), gs=s["gs"])
                if s["gs"] in ("clear", "card"):
                    p.js("()=>{try{CRESTBOUND.game.__dev.clearChoice('stay');}catch(e){}}")
                    p.wait(1800)
            except Exception as e:
                T("crest", id=c.get("id"), error=str(e)[:140])

        for sg in inv.get("sigils", [])[:8]:
            if not sg.get("p"):
                continue
            try:
                a = p.js(SNAP)
                tp(p, sg["p"], 0.0)
                p.wait(950)
                s = p.js(SNAP)
                T("sigil", i=sg["i"], p=sg["p"],
                  sigils="%s->%s" % (a["sigils"], s["sigils"]),
                  got=(s["sigils"] > a["sigils"]))
            except Exception as e:
                T("sigil", i=sg.get("i"), error=str(e)[:140])

        # ---- NPCs
        for i, npc in enumerate(inv.get("npcs", [])):
            if not npc.get("p"):
                continue
            try:
                stand = [npc["p"][0], npc["p"][1], npc["p"][2] + 1.4]
                tp(p, stand, 0.1)
                faceto(p, stand, npc["p"])
                before = p.js("()=>document.body.innerText.length")
                prompt = p.js("()=>{const e=document.querySelector('#cb-prompt');"
                              "return e?(e.className+'|'+(e.innerText||'').slice(0,60)):null;}")
                p.tap("E", 140); p.wait(1200)
                after = p.js("()=>document.body.innerText.length")
                dlg = p.js("()=>{const n=[...document.querySelectorAll('div,section,p')]"
                           ".filter(x=>x.offsetParent&&(x.innerText||'').length>25&&(x.innerText||'').length<400);"
                           "return n.slice(-2).map(x=>(x.innerText||'').slice(0,90));}")
                T("npc", i=i, p=npc["p"], prompt=prompt, textDelta=after - before, dialogue=dlg)
            except Exception as e:
                T("npc", i=i, error=str(e)[:140])

        res["console"] = p.console[:40]

    json.dump(res, open(os.path.join(OUT, "probe2_%s.json" % course), "w", encoding="utf-8"), indent=1)
    return res


if __name__ == "__main__":
    for c in sys.argv[1:]:
        print("=== probe2 %s" % c, flush=True)
        run(c)
