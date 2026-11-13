# -*- coding: utf-8 -*-
"""Coordinate-anchored replay probe.

For every defect coordinate recorded by the 14 playtesters, drive the CURRENT
build to that exact spot and measure, with real input:

  settle   teleport, press nothing 1.6 s   -> pos drift, state, grounded, deaths, surface
  walk     face +Z/-Z/+X/-X in turn, hold W 1.6 s each -> best displacement, bonk frames
  jump     tap SPACE, 1.2 s                -> apex gained, state chain
  cam      settle 1.0 s                    -> cam.dist, hero on-screen, hero occluded

One browser, one course load per course, every station measured off the engine
clock. Output: _replayout/probe_<course>.json

    python _replay_probe.py <course> [<course> ...]
"""
import json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _playlib import Play

OUT = os.path.join(HERE, "_replayout")
os.makedirs(OUT, exist_ok=True)
IDX = json.load(open(os.path.join(HERE, "_playreports", "_defects_index.json"), encoding="utf-8"))

SNAP = """() => { const G=CRESTBOUND.game, P=G.player, C=G.cam;
  return { st:P?P.state:null, x:P?+P.pos.x.toFixed(2):null, y:P?+P.pos.y.toFixed(2):null,
    z:P?+P.pos.z.toFixed(2):null, vy:P?+P.vel.y.toFixed(2):null, sp:P?+(P.speed||0).toFixed(2):null,
    gr:P?!!P.grounded:null, sf:P?P.surface:null, w:P?!!P.inWater:null, sub:P?!!P.submerged:null,
    deaths:G.deaths|0, gs:G.state, crests:G.save?G.save.crestTotal():0,
    coins:(G._collectibles&&G._collectibles.counts)?G._collectibles.counts.coins:null,
    sig:(G._collectibles&&G._collectibles.counts)?G._collectibles.counts.sigils:null,
    cd:C?+C.dist.toFixed(2):null, cy:C?+C.yaw.toFixed(2):null, cp:C?+C.pitch.toFixed(2):null,
    t:CRESTBOUND.engine?+CRESTBOUND.engine.elapsed.toFixed(2):0 }; }"""

# hero visible + not occluded, measured off the live camera and broadphase
CAMV = """() => { const G=CRESTBOUND.game, P=G.player, C=G.cam, T=CRESTBOUND.THREE;
  if(!P||!C||!C.cam) return null;
  const cam=C.cam; cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const head=new T.Vector3(P.pos.x, P.pos.y+1.2, P.pos.z);
  const ndc=head.clone().project(cam);
  const onScreen = ndc.x>-1 && ndc.x<1 && ndc.y>-1 && ndc.y<1 && ndc.z>-1 && ndc.z<1;
  let occluded=null;
  try{
    const bp=G.course&&G.course.broadphase;
    if(bp&&bp.raycast){
      const o=cam.position.clone(), d=head.clone().sub(o); const L=d.length(); d.normalize();
      const hit={t:0,normal:new T.Vector3(),collider:null};
      occluded = !!bp.raycast(o,d,Math.max(0,L-0.55),hit);
    }
  }catch(e){ occluded=null; }
  const dist = cam.position.distanceTo(head);
  return {onScreen, occluded, camDist:+C.dist.toFixed(2), realDist:+dist.toFixed(2),
          ndc:[+ndc.x.toFixed(2),+ndc.y.toFixed(2)], mode:C.mode}; }"""


WORLD = """() => { const G=CRESTBOUND.game, C=G.course; if(!C) return null;
  const num=(v)=>(typeof v==='number'? +v.toFixed(2): v);
  const hz=(C.hazards||[]).map(h=>({kind:h.kind||(h.def&&h.def.kind)||null,
      p:h.def&&h.def.p?h.def.p.map(num):null,
      cols:(h.colliders||[]).length, kills:(h.kills||[]).length, vols:(h.volumes||[]).length,
      active:(h.colliders||[]).filter(c=>c.active!==false).length,
      broken: h.broken===undefined?null:!!h.broken}));
  const cr=(C.critters||[]).map(c=>({kind:c.kind||(c.def&&c.def.kind)||null,
      p:c.mesh&&c.mesh.position?[num(c.mesh.position.x),num(c.mesh.position.y),num(c.mesh.position.z)]:null,
      state:c.state||null, hp:c.hp===undefined?null:c.hp, alive:c.alive===undefined?null:!!c.alive,
      kills:(c.kills||[]).length, killsActive:(c.kills||[]).filter(k=>k.active!==false).length}));
  const kv=(C.killVolumes||[]).length, vo=(C.volumes||[]).map(v=>v.kind);
  const cc=G._collectibles&&G._collectibles.counts?G._collectibles.counts:null;
  return {hazards:hz, critters:cr, killVolumes:kv, volumeKinds:vo, counts:cc,
          checkpoints:(C.checkpoints||[]).length,
          clock:num(C.clock||0), power:G.power?G.power.id:null,
          raceMs:(G._snapshot?(G._snapshot().raceMs):undefined),
          draws:CRESTBOUND.engine.stats?CRESTBOUND.engine.stats.drawCalls:null,
          tris:CRESTBOUND.engine.stats?CRESTBOUND.engine.stats.tris:null}; }"""

def face(p, yaw):
    p.js("(y)=>{const G=CRESTBOUND.game; G.player.__test.setFacing(y); if(G.cam){G.cam.yaw=y; G.cam._rcHoldT=0;}}", yaw)


def station(p, xyz, tag):
    import math
    r = {"tag": tag, "p": xyz}
    p.js("(a)=>{CRESTBOUND.game.__dev.tp(a[0],a[1],a[2]); CRESTBOUND.game.player.__test.setVel({x:0,y:0,z:0});}", xyz)
    p.wait(260)
    d0 = p.js(SNAP)
    # ---- settle: press nothing
    p.wait(1600)
    d1 = p.js(SNAP)
    r["settle"] = {"start": d0, "end": d1,
                   "drift": round(((d1["x"]-d0["x"])**2 + (d1["z"]-d0["z"])**2) ** .5, 2),
                   "dy": round(d1["y"] - d0["y"], 2),
                   "died": d1["deaths"] > d0["deaths"]}
    r["cam"] = p.js(CAMV)
    try: r["png"] = os.path.relpath(p.shot(tag.replace(".", "_")), os.path.dirname(HERE))
    except Exception: r["png"] = None
    # ---- walk: four headings, best displacement wins
    best = None
    for name, yaw in (("N", 0.0), ("E", -1.5708), ("S", 3.1416), ("W", 1.5708)):
        p.js("(a)=>{CRESTBOUND.game.__dev.tp(a[0],a[1],a[2]); CRESTBOUND.game.player.__test.setVel({x:0,y:0,z:0});}", xyz)
        p.wait(200); face(p, yaw); p.wait(120)
        a = p.js(SNAP)
        p.down("W")
        states = []
        for _ in range(8):
            p.wait(200); states.append(p.js("()=>CRESTBOUND.game.player.state"))
        p.up("W"); p.wait(150)
        b = p.js(SNAP)
        disp = round(((b["x"]-a["x"])**2 + (b["z"]-a["z"])**2) ** .5, 2)
        rec = {"dir": name, "disp": disp, "dy": round(b["y"]-a["y"], 2),
               "bonk": states.count("bonk"), "states": sorted(set(states)),
               "died": b["deaths"] > a["deaths"], "end": [b["x"], b["y"], b["z"]], "st": b["st"]}
        if best is None or disp > best["disp"]: best = rec
        r.setdefault("walk", []).append(rec)
    r["walkBest"] = best
    # ---- jump from the station
    p.js("(a)=>{CRESTBOUND.game.__dev.tp(a[0],a[1],a[2]); CRESTBOUND.game.player.__test.setVel({x:0,y:0,z:0});}", xyz)
    p.wait(420)
    a = p.js(SNAP)
    p.tap("Space", 110)
    peak = a["y"]; sts = []
    for _ in range(9):
        p.wait(100)
        s = p.js(SNAP); peak = max(peak, s["y"]); sts.append(s["st"])
    p.wait(400)
    b = p.js(SNAP)
    r["jump"] = {"apex": round(peak - a["y"], 2), "states": sorted(set(sts)),
                 "endY": b["y"], "grounded": b["gr"], "died": b["deaths"] > a["deaths"]}
    return r


def run(course, tasks):
    res = {"course": course, "stations": [], "errors": []}
    with Play("probe_" + course) as p:
        p.click_title(); p.wait(1200)
        p.unlock_all(); p.wait(400)
        if course != "keep":
            p.js("(c)=>{CRESTBOUND.game.__dev.goto(c);}", course)
            for _ in range(80):
                p.wait(250)
                if p.js("()=>(CRESTBOUND.game.state==='playing' && CRESTBOUND.game.courseId===%s)" % json.dumps(course)):
                    break
        p.wait(1500)
        res["loaded"] = p.js("()=>({id:CRESTBOUND.game.courseId, state:CRESTBOUND.game.state})")
        try: res["world"] = p.js(WORLD)
        except Exception as e: res["world"] = {"error": str(e)[:200]}
        for i, (tag, xyz) in enumerate(tasks):
            try:
                st = station(p, xyz, tag)
            except Exception as e:
                st = {"tag": tag, "p": xyz, "error": str(e)[:200]}
            res["stations"].append(st)
            print("  [%3d/%3d] %-16s %s settle=%s walkBest=%s jumpApex=%s" % (
                i+1, len(tasks), tag, xyz,
                (st.get("settle") or {}).get("drift"), (st.get("walkBest") or {}).get("disp"),
                (st.get("jump") or {}).get("apex")), flush=True)
        res["console"] = p.console[:40]
    json.dump(res, open(os.path.join(OUT, "probe_%s.json" % course), "w", encoding="utf-8"), indent=1)
    return res


def tasks_for(course):
    out, seen = [], set()
    for d in IDX:
        if d["course"] != course: continue
        for j, c in enumerate(d.get("coords") or []):
            k = (round(c[0], 1), round(c[1], 1), round(c[2], 1))
            if k in seen: continue
            seen.add(k)
            out.append(("%s.%d" % (d["key"].split("#")[1], j), c))
    return out


if __name__ == "__main__":
    for c in sys.argv[1:]:
        t = tasks_for(c)
        print("=== %s : %d stations" % (c, len(t)), flush=True)
        run(c, t)
