# -*- coding: utf-8 -*-
"""probe3 -- the three probe2 tests whose PLACEMENT was wrong, redone.

probe2 read a critter's position off `mesh.position`, which is (0,0,0) for every
critter (the rig is a child group), so its warden / gnasher / NPC stations were
teleports to the world origin and their deaths are fall deaths, not bites.  This
pass takes the AUTHORED position (`def.p`) and the live `post` / `rest` vectors,
and it also records the player's STATE SEQUENCE around every pound so a
"breakable did not break" is not confused with "the pound never fired".

  warden     stand in the arena 4 s at the authored y -> does it leave 'dormant'?
  gnasher    stand at 3.0 m from the LIVE post, at the post's own y, 4 s
  breakable  drop on it and pound THREE times, recording every state
  npc        stand at the authored NPC position + 1.4 m, press E

Output: _replayout/probe3_<course>.json
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _playlib import Play

OUT = os.path.join(HERE, "_replayout")
os.makedirs(OUT, exist_ok=True)

INV3 = """() => { const G=CRESTBOUND.game, C=G.course, T=CRESTBOUND.THREE; if(!C) return null;
  const n=(v)=>+(+v).toFixed(2);
  const wp=(o)=>{ if(!o) return null; const v=new T.Vector3(); o.getWorldPosition(v); return [n(v.x),n(v.y),n(v.z)]; };
  const V=(v)=>v?[n(v.x),n(v.y),n(v.z)]:null;
  const out={wardens:[],gnashers:[],breakables:[],npcs:[]};
  for (const c of (C.critters||[])) {
    const k=c.kind||(c.def&&c.def.kind);
    const rec={def:(c.def&&c.def.p)||null, world:wp(c.mesh), rest:V(c.rest), post:V(c.post),
               arena:(c.def&&c.def.arena)||null, state:c.state, hp:c.hp, alive:c.alive,
               chain:(c.def&&c.def.chain)||null};
    if(k==='warden') out.wardens.push(rec);
    else if(k==='gnasher') out.gnashers.push(rec);
    else if(k==='fen') out.npcs.push(rec);
  }
  for (const h of (C.hazards||[])) {
    const k=h.kind||(h.def&&h.def.kind); const d=h.def||{};
    if(k==='breakable') out.breakables.push({p:d.p||null, s:d.s||null, drop:d.drop||null,
        broken:!!h.broken, cols:(h.colliders||[]).length});
  }
  const D=C.def||{};
  out.npcDefs=(D.npcs||[]).map(x=>({kind:x.kind, p:x.p}));
  return out; }"""

SNAP = """() => { const G=CRESTBOUND.game, P=G.player, s=G._snapshot?G._snapshot():{};
  return { st:P?P.state:null, p:P?[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)]:null,
    gr:P?!!P.grounded:null, deaths:G.deaths|0, cause:G._deathCause||null,
    coins:s.coins||0, crests:s.crests||0, gs:G.state }; }"""

WARD = ("(i)=>{const c=(CRESTBOUND.game.course.critters||[])"
        ".filter(x=>(x.kind||(x.def&&x.def.kind))==='warden')[i];"
        "return c?{state:c.state,hp:c.hp,alive:c.alive}:null;}")
BRK = ("(i)=>{const h=(CRESTBOUND.game.course.hazards||[])"
       ".filter(x=>(x.kind||(x.def&&x.def.kind))==='breakable')[i];"
       "return h?{broken:!!h.broken,cols:(h.colliders||[]).filter(c=>c.active!==false).length}:null;}")


def tp(p, xyz, dy=0.1):
    p.js("(a)=>{CRESTBOUND.game.__dev.tp(a[0],a[1],a[2]);"
         "CRESTBOUND.game.player.__test.setVel({x:0,y:0,z:0});}",
         [xyz[0], xyz[1] + dy, xyz[2]])
    p.wait(300)


def pick(rec):
    """The best world position for a critter: authored def, then live rest/post."""
    for k in ("def", "rest", "post", "world"):
        v = rec.get(k)
        if v and (abs(v[0]) + abs(v[1]) + abs(v[2])) > 0.001:
            return v, k
    return None, None


def run(course):
    res = {"course": course, "tests": []}

    def T(kind, **kw):
        kw["kind"] = kind
        res["tests"].append(kw)
        print("   %-10s %s" % (kind, json.dumps({k: v for k, v in kw.items() if k != "kind"})[:230]), flush=True)

    with Play("probe3_" + course) as p:
        p.click_title(); p.wait(1200); p.unlock_all(); p.wait(400)
        if course != "keep":
            p.js("(c)=>{CRESTBOUND.game.__dev.goto(c);}", course)
            for _ in range(90):
                p.wait(250)
                if p.js("()=>(CRESTBOUND.game.state==='playing'&&CRESTBOUND.game.courseId===%s)"
                        % json.dumps(course)):
                    break
        p.wait(1400)
        inv = p.js(INV3) or {}
        res["inventory"] = inv
        print("   inventory: " + json.dumps({k: (len(v) if isinstance(v, list) else v)
                                             for k, v in inv.items()}), flush=True)

        # ---- wardens, at their authored position
        for i, w in enumerate(inv.get("wardens", [])):
            pos, srcp = pick(w)
            if not pos:
                T("warden", i=i, error="no usable position", rec=w); continue
            try:
                tp(p, pos, 1.4)
                a = p.js(SNAP)
                p.wait(4000)
                st = p.js(WARD, i)
                s = p.js(SNAP)
                T("warden", i=i, at=pos, posFrom=srcp, before=w.get("state"), after=st,
                  standing=s["p"], deaths="%s->%s" % (a["deaths"], s["deaths"]),
                  woke=bool(st and st.get("state") and st.get("state") != "dormant"))
            except Exception as e:
                T("warden", i=i, error=str(e)[:140])

        # ---- gnashers, 3.0 m from the LIVE post at the post's own height
        for i, g in enumerate(inv.get("gnashers", [])):
            po = g.get("post") or g.get("def") or g.get("rest")
            if not po:
                T("gnasher", i=i, error="no post", rec=g); continue
            try:
                at = [po[0] + 3.0, po[1], po[2]]
                tp(p, at, 0.4)
                a = p.js(SNAP)
                p.wait(4200)
                s = p.js(SNAP)
                T("gnasher", i=i, post=po, chain=g.get("chain"), standAt=at, landed=a["p"],
                  end=s["p"], deaths="%s->%s" % (a["deaths"], s["deaths"]),
                  cause=s.get("cause"), killed=(s["deaths"] > a["deaths"]))
            except Exception as e:
                T("gnasher", i=i, error=str(e)[:140])

        # ---- breakables: three pounds, with the state sequence recorded
        for i, b in enumerate(inv.get("breakables", [])):
            if not b.get("p"):
                continue
            try:
                half = ((b.get("s") or [0, 0, 0])[1] or 0) / 2.0
                a = p.js(SNAP)
                seq = []
                broke = None
                for attempt in range(3):
                    # high enough that the hero is unambiguously AIRBORNE when C goes
                    # down -- crouch on the ground is not a pound (probe2's mistake)
                    tp(p, [b["p"][0], b["p"][1] + half + 7.0, b["p"][2]], 0)
                    for _ in range(10):
                        p.wait(80)
                        st = p.js("()=>CRESTBOUND.game.player.state")
                        seq.append(st)
                        if st in ("fall", "jump1", "jump2", "jump3"):
                            break
                    p.down("C")
                    for _ in range(10):
                        p.wait(130)
                        seq.append(p.js("()=>CRESTBOUND.game.player.state"))
                    p.up("C")
                    p.wait(800)
                    seq.append(p.js("()=>CRESTBOUND.game.player.state"))
                    broke = p.js(BRK, i)
                    if broke and broke.get("broken"):
                        break
                s = p.js(SNAP)
                order, prev = [], None
                for st in seq:
                    if st != prev:
                        order.append(st); prev = st
                T("breakable", i=i, p=b["p"], drop=b.get("drop"), after=broke,
                  pounded=("poundFall" in seq or "poundHang" in seq or "poundLand" in seq),
                  states=order[:16], coins="%s->%s" % (a["coins"], s["coins"]),
                  crests="%s->%s" % (a["crests"], s["crests"]),
                  broke=bool(broke and broke.get("broken")))
            except Exception as e:
                T("breakable", i=i, error=str(e)[:140])

        # ---- NPCs at their authored position
        npcs = inv.get("npcDefs") or []
        if not npcs:
            npcs = [{"kind": "fen", "p": pick(x)[0]} for x in inv.get("npcs", [])]
        for i, npc in enumerate(npcs):
            if not npc.get("p"):
                continue
            try:
                stand = [npc["p"][0], npc["p"][1], npc["p"][2] + 1.5]
                tp(p, stand, 0.2)
                yaw = math.atan2(-(npc["p"][0] - stand[0]), -(npc["p"][2] - stand[2]))
                p.js("(y)=>{const G=CRESTBOUND.game;G.player.__test.setFacing(y);"
                     "if(G.cam){G.cam.yaw=y;G.cam._rcHoldT=0;}}", yaw)
                p.wait(500)
                prompt = p.js("()=>{const e=document.querySelector('#cb-prompt');"
                              "return e?((e.className||'')+'|'+(e.innerText||'').slice(0,60)):null;}")
                before = p.js("()=>[...document.querySelectorAll('*')].length")
                p.tap("E", 150); p.wait(1300)
                after = p.js("()=>[...document.querySelectorAll('*')].length")
                dlg = p.js("()=>{const sel='.cb-dialogue,.ch-dialogue,#cb-dialogue,.cb-talk,"
                           ".ch-talk,.cb-say,.cb-npc,.ch-npc,[class*=dialog],[class*=talk]';"
                           "const t=[...document.querySelectorAll(sel)].filter(x=>x.offsetParent);"
                           "return t.length?t.map(x=>(x.innerText||'').slice(0,120)).join(' | '):null;}")
                toast = p.js("()=>{const t=document.querySelector('.ch-toast,.cb-toast');"
                             "return t?(t.innerText||'').slice(0,120):null;}")
                T("npc", i=i, at=stand, npcAt=npc["p"], prompt=prompt,
                  domDelta=after - before, dialogue=dlg, toast=toast,
                  spoke=bool(dlg) or (after - before) > 2)
            except Exception as e:
                T("npc", i=i, error=str(e)[:140])

        res["console"] = p.console[:30]

    json.dump(res, open(os.path.join(OUT, "probe3_%s.json" % course), "w", encoding="utf-8"), indent=1)
    return res


if __name__ == "__main__":
    for c in sys.argv[1:]:
        print("=== probe3 %s" % c, flush=True)
        run(c)
