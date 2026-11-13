# -*- coding: utf-8 -*-
"""probe4 -- the DATA questions, read straight off the live scene.

These defects are not decided by driving the hero anywhere; they are facts about
what the course built.  One page load per course:

  console      every console error / warning the course logs at boot
  duplicates   coincident meshes (the "built twice" class: terrain, water, grass)
  boards       every text board: authored size, the plate's real width/height,
               line count, and whether the plate is wider than the walk it stands on
  hud          the live HUD DOM: which panels exist, their on-screen rectangles,
               and whether any of them runs off the 1280 x 720 viewport
  gates        (keep) the live gate objects + what unlockAll() actually does
  killY        the course's killY against the lowest authored geometry

Output: _replayout/probe4_<course>.json
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _playlib import Play

OUT = os.path.join(HERE, "_replayout")
os.makedirs(OUT, exist_ok=True)

DUP = """() => { const G=CRESTBOUND.game, C=G.course, T=CRESTBOUND.THREE;
  if(!C||!C.group) return null;
  const n=(v)=>+(+v).toFixed(2), box=new T.Box3(), seen=new Map(), dups=[];
  let meshes=0;
  C.group.traverse((o)=>{
    if(!o.isMesh && !o.isInstancedMesh && !o.isBatchedMesh) return;
    meshes++;
    let k=null;
    try{ box.setFromObject(o);
      if(!isFinite(box.min.x)) return;
      k=[o.name||o.type, n(box.min.x),n(box.min.y),n(box.min.z),n(box.max.x),n(box.max.y),n(box.max.z)].join('|');
    }catch(e){ return; }
    if(seen.has(k)) dups.push({key:k, names:[seen.get(k), o.name||o.type]});
    else seen.set(k, o.name||o.type);
  });
  return {meshes, duplicates:dups.slice(0,40), duplicateCount:dups.length}; }"""

BOARDS = """() => { const G=CRESTBOUND.game, C=G.course, T=CRESTBOUND.THREE;
  if(!C||!C.def) return null;
  const n=(v)=>+(+v).toFixed(2), box=new T.Box3(), out=[];
  const defs=(C.def.objects||[]).filter(o=>o && (o.kind==='text'||o.kind==='sign'));
  const plates=[];
  C.group.traverse((o)=>{ if((o.name||'').match(/text|sign|board|plate/i)) plates.push(o); });
  for (const d of defs) {
    let best=null, bd=1e9;
    for (const o of plates) {
      try{ box.setFromObject(o); }catch(e){ continue; }
      if(!isFinite(box.min.x)) continue;
      const cx=(box.min.x+box.max.x)/2, cy=(box.min.y+box.max.y)/2, cz=(box.min.z+box.max.z)/2;
      const dd=(d.p?Math.hypot(cx-d.p[0], cy-d.p[1], cz-d.p[2]):1e9);
      if(dd<bd){ bd=dd; best={w:n(box.max.x-box.min.x), h:n(box.max.y-box.min.y),
                             d:n(box.max.z-box.min.z), name:o.name||o.type, dist:n(dd)}; }
    }
    out.push({p:d.p, size:d.size||null, text:(d.text||'').slice(0,80),
              rot:d.rot||null, plate:best});
  }
  return out.slice(0,30); }"""

HUD = """() => { const out=[]; const vw=window.innerWidth, vh=window.innerHeight;
  const sel='[class^=cb-],[class*=" cb-"],[class^=ch-],[class*=" ch-"],#cb-prompt,#cb-hud';
  for (const e of document.querySelectorAll(sel)) {
    if(!e.offsetParent && e.id!=='cb-hud') continue;
    const r=e.getBoundingClientRect();
    if(r.width<2||r.height<2) continue;
    out.push({cls:(e.className||'').toString().slice(0,60), id:e.id||null,
      x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
      offRight:r.right>vw+1, offBottom:r.bottom>vh+1, offLeft:r.x<-1, offTop:r.y<-1,
      text:(e.innerText||'').slice(0,70)});
  }
  return {vw, vh, nodes: out.slice(0,40)}; }"""

GATES = """() => { const G=CRESTBOUND.game;
  const before=(G._gates||[]).map(g=>({course:g.course, req:g.requires&&g.requires.crests,
    unlocked:g.unlocked, sealed:g.sealed}));
  const crests0=G.save?G.save.crestTotal():null;
  try{ G.__dev.unlockAll(); }catch(e){}
  const after=(G._gates||[]).map(g=>({course:g.course, unlocked:g.unlocked, sealed:g.sealed}));
  return {crestTotal:crests0, before, after,
          openedBy_unlockAll: after.filter((g,i)=>g.unlocked && !before[i].unlocked).map(g=>g.course)}; }"""

KILLY = """() => { const C=CRESTBOUND.game.course, T=CRESTBOUND.THREE;
  if(!C) return null;
  const box=new T.Box3(); let lowest=1e9;
  C.group.traverse((o)=>{ if(!(o.isMesh||o.isInstancedMesh||o.isBatchedMesh)) return;
    try{ box.setFromObject(o); if(isFinite(box.min.y)) lowest=Math.min(lowest, box.min.y); }catch(e){} });
  return {killY:(C.def&&C.def.killY), lowestGeometry:+lowest.toFixed(2),
          bad:(C.def&&typeof C.def.killY==='number')?(C.def.killY >= lowest):null}; }"""


def run(course):
    res = {"course": course}
    with Play("probe4_" + course) as p:
        p.click_title(); p.wait(1200); p.unlock_all(); p.wait(400)
        boot_console = list(p.console)
        if course != "keep":
            p.console.clear()
            p.js("(c)=>{CRESTBOUND.game.__dev.goto(c);}", course)
            for _ in range(90):
                p.wait(250)
                if p.js("()=>(CRESTBOUND.game.state==='playing'&&CRESTBOUND.game.courseId===%s)"
                        % json.dumps(course)):
                    break
        p.wait(1600)
        res["loaded"] = p.js("()=>({id:CRESTBOUND.game.courseId,state:CRESTBOUND.game.state})")
        res["consoleBoot"] = boot_console[:30]
        res["consoleCourse"] = list(p.console)[:40]
        for name, expr in (("duplicates", DUP), ("boards", BOARDS), ("hud", HUD), ("killY", KILLY)):
            try:
                res[name] = p.js(expr)
            except Exception as e:
                res[name] = {"error": str(e)[:160]}
        if course == "keep":
            try:
                res["gates"] = p.js(GATES)
            except Exception as e:
                res["gates"] = {"error": str(e)[:160]}
        print("   console(course): %s" % json.dumps(res["consoleCourse"])[:400], flush=True)
        d = res.get("duplicates") or {}
        print("   meshes %s duplicates %s" % (d.get("meshes"), d.get("duplicateCount")), flush=True)
        h = res.get("hud") or {}
        bad = [x for x in (h.get("nodes") or []) if x["offRight"] or x["offBottom"] or x["offLeft"] or x["offTop"]]
        print("   hud nodes %s, off-viewport %s" % (len(h.get("nodes") or []), json.dumps(bad)[:260]), flush=True)
        print("   killY %s" % json.dumps(res.get("killY")), flush=True)
        b = res.get("boards") or []
        wide = [x for x in b if x.get("plate") and x["plate"]["w"] > 4.2]
        print("   boards %s, plates wider than 4.2 m: %s" % (len(b), json.dumps(wide)[:300]), flush=True)
    json.dump(res, open(os.path.join(OUT, "probe4_%s.json" % course), "w", encoding="utf-8"), indent=1)
    return res


if __name__ == "__main__":
    for c in sys.argv[1:]:
        print("=== probe4 %s" % c, flush=True)
        run(c)
