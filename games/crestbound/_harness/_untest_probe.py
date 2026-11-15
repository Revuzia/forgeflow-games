# -*- coding: utf-8 -*-
"""Re-measure the defects the replay pass could not test.

    python _untest_probe.py <course> [<course> ...]
    python _untest_probe.py --all

Reads `_playreports/_replay_verdicts.json`, takes every entry whose verdict is
COULD NOT TEST, resolves a driveable station for it (from its recorded coords, or
by parsing the tester's own prose), and runs the battery its class needs — using
the goto+verify / save-state / clock-advance / two-input helpers in `_untestlib`.

Writes `_replayout/untest_<course>.json`. Decides nothing; `_untest_verdict.py`
turns the measurements into verdicts.
"""
import json, math, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _untestlib import Probe, stations_from_text

RP = os.path.join(HERE, "_playreports")
OUT = os.path.join(HERE, "_replayout")
os.makedirs(OUT, exist_ok=True)

VERD = json.load(open(os.path.join(RP, "_replay_verdicts.json"), encoding="utf-8"))
IDX = {d["key"]: d for d in json.load(open(os.path.join(RP, "_defects_index.json"), encoding="utf-8"))}
TODO = [v for v in VERD["verdicts"] if v["verdict"] == "COULD NOT TEST"]
# Stations resolved BY HAND from the course data for reports that name a place
# but no coordinate. See _playreports/_untest_stations.json for the derivation.
try:
    HANDPOS = json.load(open(os.path.join(RP, "_untest_stations.json"), encoding="utf-8"))
except Exception:
    HANDPOS = {}

COURSES = ["keep", "verdant-1", "verdant-2", "verdant-3", "ember-1", "ember-2", "ember-3",
           "ember-4", "rime-1", "rime-2", "rime-3", "azure-1", "azure-2", "azure-3"]


# ---------------------------------------------------------------- battery pick
def batteries(d):
    """Which measurements this defect needs. Text-driven, not class-only."""
    t = " ".join([d.get("where") or "", d.get("did") or "", d.get("happened") or "",
                  d.get("should") or ""]).lower()
    cls = d.get("cls") or ""
    b = set(["stand", "phase", "mats", "screen"])          # every station gets these
    if re.search(r"camera|occlud|in frame|hides|covers nim|top-?down|skull|scalp|clip", t) or cls == "camera":
        b.add("camsweep")
    if re.search(r"long ?jump|\bgap\b|triple|double jump|reach|too far|short of|missed|not one landed", t) or cls == "long-jump gaps":
        b.add("jumps")
        b.add("cross")      # when the report names BOTH ends, drive the crossing
    if re.search(r"wall ?kick|kick shaft|chimney|flue|tops? out", t):
        b.add("kickladder")
    if re.search(r"stair|tread|riser|flight|step up|climb", t) or cls == "stairs":
        b.add("walk4")
    if re.search(r"swim|water|submerg|sink|current|quicksand|drown|brook|moat|lagoon", t) or cls == "water/swim":
        b.add("swim")
    if re.search(r"pound|breakable|urn|grate|hay wall|coral", t):
        b.add("pound")
    if re.search(r"\bcoin|sigil|crest|pedestal|collect|magnet", t) or cls == "collectibles":
        b.add("collect")
    if re.search(r"\bpad\b|jumppad|speedpad|conveyor|belt|rotor|mill|gondola|mover|seesaw|cart|trolley|carr(y|ies|ied)|current|drift|drag(s|ged)?", t) or cls == "pads/belts/currents":
        b.add("ride")
    if re.search(r"\bsign|board|text|hud|prompt|toast|letter|legib|readab|wrap", t) or cls == "signs/HUD":
        b.add("signs")
    if re.search(r"stuck|bonk|stopped dead|never got|walled|blocked|soft-?lock|slide|slopeslide", t):
        b.add("walk4")
    if re.search(r"scarf|cloth|rigid|plank|animation|pose|t-?pose|scarecrow", t):
        b.add("hero")
    if re.search(r"warden|gnasher|bumbler|skitter|critter|boss", t):
        b.add("critter")
        if re.search(r"no reaction|ran through|runs? through|as if it were not there|never (moved|attack|did)|"
                     r"knockback|squish|statue|dormant|never wakes", t):
            b.add("bump")
    if re.search(r"died|death|kill|crush|lethal|instant", t) or cls == "idle-crush":
        b.add("standlong")
    return b


def resolve_stations(d, p, limit=3):
    """Coordinates first from the index, then from the prose. Ground-resolve pairs."""
    out = []
    hp = HANDPOS.get(d["key"])
    if hp:
        out.append({"p": list(hp["p"]), "src": "course data (hand-resolved)", "kind": "handmap",
                    "why": hp.get("why"), "needsGround": bool(hp.get("needsGround"))})
        if hp.get("p2"):
            out.append({"p": list(hp["p2"]), "src": "course data (hand-resolved)", "kind": "handmap"})
    for c in (d.get("coords") or [])[:limit]:
        out.append({"p": [float(c[0]), float(c[1]), float(c[2])], "src": "index", "kind": "triple"})
    if not out:
        for s in stations_from_text(d, limit):
            out.append(s)
    bb = p.js("""()=>{const c=CRESTBOUND.game.course; if(!c) return null;
        const b=c.bounds&&c.bounds.isBox3?c.bounds:null;
        return { min: b?[b.min.x,b.min.y,b.min.z]:null, max: b?[b.max.x,b.max.y,b.max.z]:null,
                 killY: (c.def&&typeof c.def.killY==='number')?c.def.killY:null }; }""")
    for s in out:
        if bb:
            v = s["p"]
            bad = False
            if bb.get("killY") is not None and v[1] < bb["killY"] + 0.5:
                bad = "below killY %s" % bb["killY"]
            if bb.get("min") and bb.get("max"):
                mn, mx = bb["min"], bb["max"]
                pad = 8.0
                if not (mn[0] - pad <= v[0] <= mx[0] + pad and mn[2] - pad <= v[2] <= mx[2] + pad):
                    bad = "outside the course bounds"
            if bad:
                s["outOfBounds"] = bad
        # ONLY when the parse had no height. A y of 0.0 the tester WROTE is a real
        # height (the Keep lobby floor is y 0); re-resolving it off a downward ray
        # from 400 m put the first cut on the ROOF at 15.15.
        if s.get("needsGround"):
            g = p.cbx("groundAt", s["p"][0], s["p"][2], 400)
            y = None
            if g and g.get("ray"):
                y = g["ray"]["y"]
            elif g and g.get("hf") is not None:
                y = g["hf"]
            if y is not None:
                s["p"][1] = round(y + 0.15, 2)
                s["groundResolved"] = True
    return out


# ---------------------------------------------------------------- the batteries
def run_batteries(p, xyz, want, tag, stations=None):
    r = {}
    gv = p.goto_verify(xyz)
    r["reach"] = gv
    at = gv["at"] if gv["ok"] else xyz
    r["point"] = gv.get("point")
    # what the page tells the player HERE — an interact prompt that is drawn 27 m
    # from its NPC is a fact about the DOM plus a distance, not about a station.
    r["prompt"] = p.js(r"""(a)=>{ const G=CRESTBOUND.game, C=G.course;
        const el=(document.getElementById('cb-prompt')||document.querySelector('.cb-prompt'));
        const out={ shown: el? el.classList.contains('show') : null,
                    text: el? (el.innerText||'').replace(/\s+/g,' ').trim().slice(0,120) : null };
        let best=null;
        const consider=(kind,q)=>{ if(!q) return; const d=Math.hypot(q.x-a[0],q.y-a[1],q.z-a[2]);
          if(best===null||d<best.d) best={kind:kind,d:+d.toFixed(2)}; };
        for(const n of (G._npcs||[])) consider('npc', n.pos||n.p||(n.mesh&&n.mesh.position));
        for(const k of ((C&&C.critters)||[])) if((k.kind||'')==='fen' && k.mesh) consider('fen', k.mesh.getWorldPosition(new CRESTBOUND.THREE.Vector3()));
        for(const g of (G._gates||[])) consider('gate', g.pos);
        for(const rec of ((C&&C.hazards)||[])) if(rec.kind==='cannon') consider('cannon', rec.h&&rec.h.mesh&&rec.h.mesh.position);
        out.nearest=best; return out; }""", at)
    if "phase" in want:
        ps = p.phase_scan(at, 24, 48)
        if ps:
            ps.pop("rows", None)
        r["phase"] = ps
    if "mats" in want:
        r["mats"] = p.cbx("matsNear", at[0], at[1], at[2], 6)
    if "signs" in want:
        r["signs"] = p.cbx("textBoards", at[0], at[1], at[2], 16)
    if "screen" in want:
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
        p.wait(700)
        r["screen"] = p.cbx("screenBlockers", 0.04)
        try:
            r["frame"] = p.frame_stats((0.0, 0.0, 1.0, 1.0), tag)
        except Exception as e:
            r["frame"] = {"error": str(e)[:120]}
    if "camsweep" in want:
        cs = p.cam_sweep(at, 8, 380)
        if cs:
            cs.pop("rows", None)
        r["camsweep"] = cs
    if "standlong" in want:
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
        p.wait(300)
        a = p.snap()
        sts = []
        for _ in range(12):
            p.wait(500)
            s = p.snap(); sts.append(s["st"])
            if s["deaths"] > a["deaths"]:
                break
        b = p.snap()
        r["standlong"] = {"seconds": 6, "died": b["deaths"] > a["deaths"], "states": sorted(set(sts)),
                          "end": [b["x"], b["y"], b["z"]], "drift": round(math.hypot(b["x"] - at[0], b["z"] - at[2]), 2)}
    if "walk4" in want:
        walks = []
        for name, yaw in (("N", 0.0), ("E", -1.5708), ("S", 3.1416), ("W", 1.5708)):
            p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
            p.wait(200); p.face_yaw(yaw)
            a = p.snap()
            p.down("W")
            sts = []
            for _ in range(8):
                p.wait(200); sts.append(p.js("()=>CRESTBOUND.game.player.state"))
            p.up("W"); p.wait(160)
            b = p.snap()
            walks.append({"dir": name, "disp": round(math.hypot(b["x"] - a["x"], b["z"] - a["z"]), 2),
                          "dy": round(b["y"] - a["y"], 2), "bonk": sts.count("bonk"),
                          "slide": sts.count("slopeSlide"), "states": sorted(set(sts)),
                          "died": b["deaths"] > a["deaths"]})
        r["walk4"] = {"walks": walks,
                      "best": max(walks, key=lambda w: w["disp"]),
                      "climb": max(walks, key=lambda w: w["dy"]),
                      "allStuck": all(w["disp"] < 0.6 for w in walks),
                      "maxBonk": max(w["bonk"] for w in walks),
                      "maxSlide": max(w["slide"] for w in walks)}
    if "jumps" in want:
        jr = {}
        for name, runup, hold, tap in (("single", 700, None, "Space"),
                                       ("longjump", 700, "C", "Space")):
            p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
            p.wait(400)
            if hold:
                jr[name] = p.run_then(runup, hold, tap, hold_first_ms=600, after_ms=1500)
            else:
                a0 = p.snap()
                p.down("W"); p.wait(runup)
                p.tap("Space", 100)
                peak = a0["y"]; sts = []
                for _ in range(14):
                    p.wait(100); s = p.snap(); peak = max(peak, s["y"]); sts.append(s["st"])
                p.up("W"); p.wait(250)
                b0 = p.snap()
                jr[name] = {"apex": round(peak - a0["y"], 2),
                            "dist": round(math.hypot(b0["x"] - a0["x"], b0["z"] - a0["z"]), 2),
                            "uniqueStates": sorted(set(sts)), "died": b0["deaths"] > a0["deaths"],
                            "end": [b0["x"], b0["y"], b0["z"]]}
        # triple: three chained jumps out of a run
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
        p.wait(400)
        a0 = p.snap()
        p.down("W"); p.wait(700)
        peak, sts = a0["y"], []
        for _ in range(3):
            p.tap("Space", 90)
            for _ in range(6):
                p.wait(100); s = p.snap(); peak = max(peak, s["y"]); sts.append(s["st"])
        p.up("W"); p.wait(400)
        b0 = p.snap()
        jr["triple"] = {"apex": round(peak - a0["y"], 2),
                        "dist": round(math.hypot(b0["x"] - a0["x"], b0["z"] - a0["z"]), 2),
                        "uniqueStates": sorted(set(sts)), "died": b0["deaths"] > a0["deaths"],
                        "end": [b0["x"], b0["y"], b0["z"]]}
        r["jumps"] = jr
    if "cross" in want and stations and len(stations) >= 2:
        # THE CROSSING TEST. The tester wrote both ends of the gap; drive from A
        # to B with each move in the family and report which one lands on B.
        a, b = stations[0]["p"], stations[1]["p"]
        gap = round(math.hypot(b[0] - a[0], b[2] - a[2]), 2)
        rise = round(b[1] - a[1], 2)
        tries = []
        for name, runup, hold in (("single", 900, None), ("single_short", 450, None),
                                  ("longjump", 900, "C"), ("double", 900, "DBL"),
                                  ("triple", 900, "TRI")):
            p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1]+0.1,a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", a)
            p.wait(420)
            p.face(b[0], b[2])
            s0 = p.snap()
            p.down("W"); p.wait(runup)
            if hold == "C":
                p.down("C"); p.wait(120); p.tap("Space", 90); p.wait(120); p.up("C")
            elif hold == "DBL":
                p.tap("Space", 90); p.wait(320); p.tap("Space", 90)
            elif hold == "TRI":
                p.tap("Space", 90); p.wait(300); p.tap("Space", 90); p.wait(300); p.tap("Space", 90)
            else:
                p.tap("Space", 100)
            peak, sts = s0["y"], []
            for _ in range(16):
                p.wait(120)
                s = p.snap(); peak = max(peak, s["y"]); sts.append(s["st"])
                if s["deaths"] > s0["deaths"]:
                    break
            p.up("W"); p.wait(400)
            s1 = p.snap()
            d = round(math.hypot(s1["x"] - b[0], s1["z"] - b[2]), 2)
            tries.append({"move": name, "speedAtLaunch": s0["sp"], "gap": gap, "rise": rise,
                          "apex": round(peak - s0["y"], 2),
                          "landed": [s1["x"], s1["y"], s1["z"]], "distToB": d,
                          "dyToB": round(s1["y"] - b[1], 2),
                          "onB": d <= 1.8 and abs(s1["y"] - b[1]) <= 1.2 and not (s1["deaths"] > s0["deaths"]),
                          "states": sorted(set(sts)), "died": s1["deaths"] > s0["deaths"]})
        best = min(tries, key=lambda t: t["distToB"])
        r["cross"] = {"from": a, "to": b, "gap": gap, "rise": rise, "tries": tries,
                      "anyLanded": any(t["onB"] for t in tries),
                      "landedBy": [t["move"] for t in tries if t["onB"]],
                      "closest": best}
    if "kickladder" in want:
        best = None
        for yaw in (0.0, 1.5708, 3.1416, -1.5708):
            k = p.wall_kick_ladder(at, yaw, kicks=5)
            k["yaw"] = yaw
            if best is None or k["maxGain"] > best["maxGain"]:
                best = k
        r["kickladder"] = best
    if "swim" in want:
        # SINK: hold crouch and read the depth AT THE END OF THE HOLD. (The first
        # cut sampled 1.5 s after the release and read a hero who had floated back
        # up — a measurement of the wrong instant, not of the water.)
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
        p.wait(700)
        a0 = p.snap()
        p.down("C")
        sink, low = [], a0["y"]
        for _ in range(12):
            p.wait(250)
            s = p.snap(); sink.append(s["st"]); low = min(low, s["y"])
        sEnd = p.snap()
        p.up("C"); p.wait(200)
        # SWIM: hold forward and read displacement while it is held
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
        p.wait(500)
        b0 = p.snap()
        p.down("W")
        drift = []
        for _ in range(12):
            p.wait(250); s = p.snap(); drift.append([s["x"], s["y"], s["z"], s["st"]])
        c0 = p.snap()
        p.up("W"); p.wait(200)
        r["swim"] = {"start": a0, "sinkDy": round(sEnd["y"] - a0["y"], 2),
                     "sinkLowest": round(low - a0["y"], 2),
                     "sinkStates": sorted(set(sink)), "submergedAfterSink": sEnd["sub"],
                     "inWaterAtStart": a0["w"],
                     "swimDisp": round(math.hypot(c0["x"] - b0["x"], c0["z"] - b0["z"]), 2),
                     "swimDy": round(c0["y"] - b0["y"], 2), "swimEnd": [c0["x"], c0["y"], c0["z"]],
                     "states": sorted(set(d[3] for d in drift)), "inWater": c0["w"],
                     "died": c0["deaths"] > a0["deaths"]}
    if "pound" in want:
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1]+1.6,a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
        p.wait(300)
        a0 = p.snap()
        before = p.cbx("courseAudit")
        p.tap("Space", 90); p.wait(160)
        p.down("C"); p.wait(1400); p.up("C"); p.wait(500)
        b0 = p.snap()
        after = p.cbx("courseAudit")
        r["pound"] = {"state": b0["st"], "coins": [a0["coins"], b0["coins"]],
                      "triggeredBefore": (before or {}).get("triggered"),
                      "triggeredAfter": (after or {}).get("triggered"),
                      "brokenBefore": sum(v.get("broken", 0) for v in (before or {}).get("hazardsByKind", {}).values()),
                      "brokenAfter": sum(v.get("broken", 0) for v in (after or {}).get("hazardsByKind", {}).values()),
                      "crests": [a0["crests"], b0["crests"]], "died": b0["deaths"] > a0["deaths"]}
    if "collect" in want:
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
        p.wait(900)
        s = p.snap()
        r["collect"] = {"coins": s["coins"], "sigils": s["sig"], "crests": s["crests"],
                        "near": p.js("""(a)=>{const G=CRESTBOUND.game,C=G._collectibles;
              if(!C) return null;
              const near=(home,state,n,label)=>{ if(!home) return null; let best=null;
                for(let i=0;i<n;i++){ const x=home[i*3],y=home[i*3+1],z=home[i*3+2];
                  if(!isFinite(x)) continue;
                  const d=Math.hypot(x-a[0],y-a[1],z-a[2]);
                  if(best===null||d<best.d) best={d:+d.toFixed(2), p:[+x.toFixed(2),+y.toFixed(2),+z.toFixed(2)],
                                                  live: state?state[i]:null}; }
                return best; };
              const cr=[]; for(const c of (C.crests||[])){ const h=c.home;
                if(!h) continue; cr.push({id:c.id,type:c.type||null,present:!!c.present,
                  d:+Math.hypot(h.x-a[0],h.y-a[1],h.z-a[2]).toFixed(2),
                  p:[+h.x.toFixed(2),+h.y.toFixed(2),+h.z.toFixed(2)]}); }
              cr.sort((x,y)=>x.d-y.d);
              return { coin: near(C._cHome, C._cState, C.coinCount|0, 'coin'),
                       sigil: near(C._sHome, C._sState, C.sigilCount|0, 'sigil'),
                       crests: cr.slice(0,4) }; }""", at)}
    if "ride" in want:
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1]+0.4,a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
        p.wait(400)
        a0 = p.snap()
        peak, sts, path = a0["y"], [], []
        for _ in range(20):
            p.wait(400)
            s = p.snap(); peak = max(peak, s["y"]); sts.append(s["st"])
            path.append([s["x"], s["y"], s["z"]])
            if s["deaths"] > a0["deaths"]:
                break
        b0 = p.snap()
        r["ride"] = {"dy": round(b0["y"] - a0["y"], 2), "peakDy": round(peak - a0["y"], 2),
                     "disp": round(math.hypot(b0["x"] - a0["x"], b0["z"] - a0["z"]), 2),
                     "states": sorted(set(sts)), "died": b0["deaths"] > a0["deaths"],
                     "end": [b0["x"], b0["y"], b0["z"]]}
    if "hero" in want:
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
        p.wait(400)
        p.down("W")
        frames = []
        for _ in range(10):
            p.wait(140)
            frames.append(p.cbx("heroSample"))
        p.up("W"); p.wait(200)
        # per-bone local motion range over the samples
        rng = {}
        for f in frames:
            for row in (f or []):
                nm = row[0]
                if row[1] is None:
                    continue
                cur = rng.setdefault(nm, [row[1], row[1], row[2], row[2], row[3], row[3]])
                cur[0] = min(cur[0], row[1]); cur[1] = max(cur[1], row[1])
                cur[2] = min(cur[2], row[2]); cur[3] = max(cur[3], row[2])
                cur[4] = min(cur[4], row[3]); cur[5] = max(cur[5], row[3])
        moved = {k: round(max(v[1] - v[0], v[3] - v[2], v[5] - v[4]), 4) for k, v in rng.items()}
        r["hero"] = {"bones": len(moved), "moved": moved,
                     "scarf": {k: v for k, v in moved.items() if "scarf" in k.lower()},
                     "still": [k for k, v in moved.items() if v < 0.001]}
    if "bump" in want:
        # WALK INTO IT. "the hero runs through the space it occupies as if it were
        # not there" is a claim about contact, and only contact answers it.
        tgt = p.js("""(a)=>{ const C=CRESTBOUND.game.course; if(!C) return null;
            let best=null;
            const TH=CRESTBOUND.THREE;
            for(const k of (C.critters||[])){ if(!k.mesh) continue;
              const q=k.mesh.getWorldPosition(new TH.Vector3());
              const d=Math.hypot(q.x-a[0],q.y-a[1],q.z-a[2]);
              if(best===null||d<best.d) best={kind:k.kind||(k.def&&k.def.kind),
                d:+d.toFixed(2), p:[+q.x.toFixed(2),+q.y.toFixed(2),+q.z.toFixed(2)],
                state:k.state||null, hp:k.hp===undefined?null:k.hp,
                kills:(k.kills||[]).length,
                killsActive:(k.kills||[]).filter(v=>v.active!==false).length}; }
            return best; }""", at)
        rb = {"target": tgt}
        if tgt and tgt["d"] <= 30:
            q = tgt["p"]
            # start 4 m short of it on the line from the station
            dx, dz = q[0] - at[0], q[2] - at[2]
            L = max(0.001, math.hypot(dx, dz))
            sx, sz = q[0] - 4.0 * dx / L, q[2] - 4.0 * dz / L
            p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}",
                 [sx, q[1] + 0.2, sz])
            p.wait(500)
            p.face(q[0], q[2])
            a0 = p.snap()
            p.down("W")
            sts, vmax = [], 0.0
            for _ in range(14):
                p.wait(200)
                s = p.snap(); sts.append(s["st"]); vmax = max(vmax, s["sp"] or 0)
                if s["deaths"] > a0["deaths"]:
                    break
            p.up("W"); p.wait(400)
            b0 = p.snap()
            after = p.js("""(a)=>{ const C=CRESTBOUND.game.course, TH=CRESTBOUND.THREE; let best=null;
                for(const k of (C.critters||[])){ if(!k.mesh) continue;
                  const q=k.mesh.getWorldPosition(new TH.Vector3());
                  const d=Math.hypot(q.x-a[0],q.y-a[1],q.z-a[2]);
                  if(best===null||d<best.d) best={kind:k.kind, d:+d.toFixed(2), state:k.state||null,
                    hp:k.hp===undefined?null:k.hp, alive:k.alive===undefined?null:!!k.alive}; }
                return best; }""", q)
            rb.update({"from": [round(sx, 2), q[1] + 0.2, round(sz, 2)],
                       "states": sorted(set(sts)), "died": b0["deaths"] > a0["deaths"],
                       "coins": [a0["coins"], b0["coins"]],
                       "endDist": round(math.hypot(b0["x"] - q[0], b0["z"] - q[2]), 2),
                       "passedThrough": round(math.hypot(b0["x"] - sx, b0["z"] - sz), 2) > 5.0,
                       "critterAfter": after,
                       "reacted": bool(set(sts) & {"bonk", "skid", "pivot", "hardLand", "dead"})
                                  or b0["deaths"] > a0["deaths"]
                                  or (b0["coins"] or 0) > (a0["coins"] or 0)})
        r["bump"] = rb
    if "critter" in want:
        p.js("(a)=>{const G=CRESTBOUND.game; G.__dev.tp(a[0],a[1],a[2]); G.player.__test.setVel({x:0,y:0,z:0});}", at)
        p.wait(400)
        seq = []
        for _ in range(10):
            p.wait(500)
            ca = p.cbx("courseAudit")
            seq.append([(c["kind"], c["state"], c["hp"]) for c in (ca or {}).get("critters", [])][:6])
        r["critter"] = {"first": seq[0] if seq else None, "last": seq[-1] if seq else None,
                        "changed": seq[0] != seq[-1] if seq else None,
                        "states": sorted({str(x) for row in seq for x in row})[:14]}
    return r


def run_course(course, items):
    res = {"course": course, "generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "defects": {}}
    with Probe("untest_" + course) as p:
        p.click_title(); p.wait(1000)
        p.unlock_all(); p.wait(300)
        p.install()
        if course != "keep":
            p.js("(c)=>{CRESTBOUND.game.__dev.goto(c);}", course)
            for _ in range(80):
                p.wait(250)
                if p.js("()=>CRESTBOUND.game.state==='playing' && CRESTBOUND.game.courseId===%s" % json.dumps(course)):
                    break
        p.wait(1400)
        res["loaded"] = p.js("()=>({id:CRESTBOUND.game.courseId,state:CRESTBOUND.game.state})")
        # every precondition a defect might need, set once: gates open, every
        # power available on demand, every secret trigger reachable.
        res["saveState"] = p.set_save(unlockAll=True, crestTotal=40, refreshGates=True)
        res["audit"] = p.cbx("courseAudit")
        for i, key in enumerate(items):
            d = IDX[key]
            t0 = time.time()
            rec = {"key": key, "cls": d.get("cls"), "batteries": sorted(batteries(d))}
            # A station can land ON a crest: verdant-2#26's teleport put the hero
            # on CREST ON THE FLAGPOLE, the clear card came up, and every battery
            # after it measured a celebrating game. Put the game back in play
            # before each defect, and say so if it had to.
            gs = p.js("()=>CRESTBOUND.game.state")
            if gs not in ("playing", "keep"):
                rec["hadToResume"] = gs
                for _ in range(8):
                    p.js("()=>{const g=CRESTBOUND.game; try{ if(g.__dev.clearChoice) g.__dev.clearChoice('stay'); }catch(e){} "
                         "try{ if(g.menu && g.menu.isOpen) g.menu.close(); }catch(e){} }")
                    p.wait(400)
                    gs = p.js("()=>CRESTBOUND.game.state")
                    if gs in ("playing", "keep"):
                        break
                rec["resumedTo"] = gs
            try:
                # C. SAVE-STATE: a defect that needs a power hat gets one before
                #    the battery runs (the coral wall only breaks with METAL on,
                #    and the glide only exists with WING on).
                txt = " ".join([d.get("where") or "", d.get("did") or "", d.get("happened") or ""]).lower()
                pw = ("metal" if re.search(r"metal (hat|power)", txt) else
                      "wing" if re.search(r"wing (hat|power)|glide", txt) else
                      "vanish" if re.search(r"vanish (hat|power)", txt) else None)
                # ...unless the claim is ABOUT not having it. rime-3#01 says the
                # rings are drawn "with the wing power NOT taken"; granting the hat
                # to test that destroys the precondition.
                if pw and re.search(r"not taken|without the|before (you|the player)|has the .{0,12}hat|"
                                    r"before .{0,24}(hat|power)|no power", txt):
                    rec["powerWithheld"] = pw
                    pw = None
                if pw:
                    rec["power"] = p.set_save(power=pw, powerS=900)
                st = resolve_stations(d, p, 3)
                rec["stations"] = st
                if not st:
                    rec["note"] = "no coordinate in the report and none parseable from its prose"
                else:
                    rec["m"] = run_batteries(p, st[0]["p"], set(rec["batteries"]),
                                             "%s_%s" % (key.replace("#", "_"), 0), st)
                    if len(st) > 1 and ("stand" in rec["batteries"]):
                        rec["m2"] = {"station": st[1]["p"],
                                     "reach": p.goto_verify(st[1]["p"]),
                                     "phase": (lambda x: (x.pop("rows", None), x)[1] if x else None)(
                                         p.phase_scan(st[1]["p"], 24, 32))}
            except Exception as e:
                rec["error"] = ("%s: %s" % (type(e).__name__, e))[:300]
            rec["ms"] = int((time.time() - t0) * 1000)
            res["defects"][key] = rec
            print("  [%2d/%2d] %-14s %-22s %5d ms  %s" % (
                i + 1, len(items), key, ",".join(rec["batteries"])[:22], rec["ms"],
                "ERR " + rec["error"][:60] if rec.get("error") else
                ("reach=%s" % (rec.get("m", {}).get("reach", {}).get("ok"))
                 if rec.get("m") else rec.get("note", ""))), flush=True)
        res["console"] = p.console[:60]
    with open(os.path.join(OUT, "untest_%s.json" % course), "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1, ensure_ascii=False)
    return res


if __name__ == "__main__":
    args = sys.argv[1:]
    todo = COURSES if (not args or args[0] == "--all") else args
    for c in todo:
        items = [v["key"] for v in TODO if v["course"] == c]
        if not items:
            print("=== %s : nothing untested" % c, flush=True)
            continue
        print("=== %s : %d untestable defects" % (c, len(items)), flush=True)
        run_course(c, items)
