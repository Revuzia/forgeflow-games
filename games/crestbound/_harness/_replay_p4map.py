# -*- coding: utf-8 -*-
"""Map probe4 (live scene / console / HUD data) onto defects."""
import json, os, re, glob

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "_replayout")

P4 = {}
for f in glob.glob(os.path.join(OUT, "probe4_*.json")):
    try:
        j = json.load(open(f, encoding="utf-8"))
        if j.get("course"):
            P4[j["course"]] = j
    except Exception:
        pass


def decide(d):
    pr = P4.get(d["course"])
    if not pr:
        return None, ""
    text = " ".join([d["where"], d["did"], d["happened"], d["should"]])
    cons = pr.get("consoleCourse") or []
    consb = pr.get("consoleBoot") or []
    allc = cons + consb

    # ---- a defect whose evidence WAS a console line
    m = re.search(r"props\.js had no entry for:?\s*([a-z, ]+)", text, re.I)
    if m:
        want = [w.strip() for w in m.group(1).split(",") if w.strip()]
        hit = [c for c in allc if "no entry for" in c and any(w in c for w in want)]
        if hit:
            return "STILL REPRODUCES", "the same console warning is still logged on load: %s" % hit[0][:180]
        return "FIXED", ("no 'props.js had no entry for' warning for %s on this build "
                         "(course console: %s)" % (want, json.dumps(cons)[:140]))

    if re.search(r"killY .{0,30}(sits at or above|lowest geometry)|killY \(\d+\)", text, re.I):
        k = pr.get("killY") or {}
        if k.get("bad"):
            return "STILL REPRODUCES", ("killY %s still sits at or above the lowest geometry %s"
                                        % (k.get("killY"), k.get("lowestGeometry")))
        warn = [c for c in allc if "killY" in c]
        if warn:
            return "STILL REPRODUCES", "the course still logs: %s" % warn[0][:180]
        return "FIXED", ("killY %s is now clear of the lowest geometry %s and no killY warning "
                         "is logged" % (k.get("killY"), k.get("lowestGeometry")))

    # ---- "built twice / coincident / duplicated" geometry
    if re.search(r"built twice|two complete sets|coincident|duplicated?\b|two 'water|two grass", text, re.I):
        dup = pr.get("duplicates") or {}
        names = []
        for x in (dup.get("duplicates") or []):
            names += x.get("names") or []
        interesting = [n for n in names if re.search(r"terrain|water|grass|pool", str(n), re.I)]
        if interesting:
            return "STILL REPRODUCES", ("coincident meshes still present: %s (of %s duplicate pairs "
                                        "in %s scene meshes)" % (interesting[:6], dup.get("duplicateCount"),
                                                                 dup.get("meshes")))
        return "FIXED", ("no coincident terrain / water / grass mesh in the live scene: %s duplicate "
                         "bounding-box pairs in %s meshes, and none of them is a terrain, water or "
                         "grass mesh (%s)" % (dup.get("duplicateCount"), dup.get("meshes"),
                                              sorted(set(map(str, names)))[:6]))

    # ---- HUD running off the viewport
    if re.search(r"runs? off the (right|left|bottom|top)|cut by the screen edge|off the .{0,12}edge of the "
                 r"(viewport|screen)|covers? nim from the waist|sits across the middle of the screen", text, re.I):
        h = pr.get("hud") or {}
        nodes = h.get("nodes") or []
        off = [x for x in nodes if (x["offRight"] or x["offBottom"] or x["offLeft"] or x["offTop"])
               and "vig" not in (x["cls"] or "")]
        mid = [x for x in nodes if x["y"] < 420 and x["y"] + x["h"] > 300 and x["w"] > 500
               and "vig" not in (x["cls"] or "")]
        if off:
            return "STILL REPRODUCES", "HUD nodes still off the %sx%s viewport: %s" % (h.get("vw"), h.get("vh"), json.dumps(off)[:200])
        if mid:
            return "STILL REPRODUCES", "a HUD panel still spans the middle of the frame: %s" % json.dumps(mid)[:200]
        return "FIXED", ("every visible HUD node sits inside the %sx%s viewport and none spans the "
                         "middle band (%d nodes measured)" % (h.get("vw"), h.get("vh"), len(nodes)))
    return None, ""
