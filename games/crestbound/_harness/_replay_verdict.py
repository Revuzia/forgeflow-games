# -*- coding: utf-8 -*-
"""Assemble the replay verdict table.

Evidence, strongest first:
  1. DRIVER SELF-REPORT  the playtester's own driver re-run on this build
  2. COORDINATE PROBE    the defect's own coordinates re-driven with real input
  3. GATE RESULT         gatecheck / spawnwalk / loopcheck
No signal -> COULD NOT TEST.
"""
import json, os, re, sys, glob
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
RP = os.path.join(HERE, "_playreports")
OUT = os.path.join(HERE, "_replayout")
sys.path.insert(0, HERE)
import _replay_selfreport as SR
import _replay_p2map as P2M
import _replay_p3map as P3M
import _replay_p4map as P4M

IDX = json.load(open(os.path.join(RP, "_defects_index.json"), encoding="utf-8"))

SIG = [
 ("stuck",    r"stopped (dead|moving)|never moved|froze|frozen|did not move|moved 0\.0|0\.00 m|soft-?lock|wedged|cannot escape|trapped|stall(s|ed)\b|jam(s|med)\b|stuck\b|pinned\b|stops? dead"),
 ("bonk",     r"\bbonk|never got (on|in)|refus(es|ed) (a|the) step|acts as a wall|is a wall|stops? \d?\.?\d* m short|cannot go further|walled"),
 ("death",    r"\bdied\b|\bdeaths?\b|kill(s|ed)?\b|is lethal|instant(ly)? kill|dead in|falls? out of the world|crush death|cause 'crush'|death loop"),
 ("camocc",   r"not in frame|nim is not|hero (is )?(not|never) (visible|on screen)|occlud|hides nim|covers nim|inside (nim'?s|the hero'?s|his) (head|skull)|camera .{0,40}(inside|through)|collapse[sd]? (to|below)|below .{0,12}minDist|top-?down|never elevated"),
 ("nocollide",r"no collider|zero colliders|passes? through|never fires|has no collider|no purchase|does not collide|never (moves|arms|engages)|nothing (at all|happen)|no-?op|it never"),
 ("unreach",  r"unreachab|cannot be reached|too far|never reache[sd]|short of|impossible to (make|reach)|out of reach|not one (landed|crossing)|every .{0,20}jump fails|missed the"),
 ("visual",   r"render(s|ed|ing)? as|reads? as|looks? like|washed out|milky|z-?fight|banding|near-?black|flat (grey|gray|white|pale|opaque|saturated)|unreadable|illegible|no (visible )?(texture|grain|detail|riser)|naked primitive|blown-?out|featureless|hard-?edged|wraps? to|cut off|billboard|silhouette"),
]
def signature(d):
    t = " ".join([d["happened"], d["should"]])
    return [n for n, p in SIG if re.search(p, t, re.I)]

PROBE = {}
for f in glob.glob(os.path.join(OUT, "probe_*.json")):
    try:
        j = json.load(open(f, encoding="utf-8"))
        if isinstance(j, dict) and j.get("course"): PROBE[j["course"]] = j
    except Exception: pass

def station_for(course, coords):
    pr = PROBE.get(course)
    if not pr: return None
    for xyz in coords or []:
        for s in pr.get("stations", []):
            p = s.get("p")
            if not p: continue
            if abs(p[0]-xyz[0]) < .21 and abs(p[1]-xyz[1]) < .21 and abs(p[2]-xyz[2]) < .21:
                return s
    return None

def probe_verdict(d, st):
    if not st or st.get("error"): return None, ("probe error: " + st["error"]) if st and st.get("error") else ""
    sig, se, wb, cm, jp = d["_sig"], st.get("settle"), st.get("walkBest"), st.get("cam"), st.get("jump")
    walks = st.get("walk") or []
    up = max(walks, key=lambda w: w["dy"]) if walks else None          # best CLIMB of the four headings
    allStuck = bool(walks) and all(w["disp"] < 0.6 for w in walks)
    maxBonk = max([w["bonk"] for w in walks], default=0)
    if not se: return None, ""
    parts = ["settle drift %.2f m dy %.2f died=%s end-state %s" % (se["drift"], se["dy"], se["died"], se["end"]["st"])]
    if wb: parts.append("best walk %.2f m (%s), %d bonk frames, states %s, died=%s" % (wb["disp"], wb["dir"], wb["bonk"], ",".join(wb["states"]), wb["died"]))
    if jp: parts.append("jump apex %.2f m" % jp["apex"])
    if cm: parts.append("cam dist %.2f onScreen=%s occluded=%s" % (cm.get("camDist") if cm.get("camDist") is not None else -1, cm.get("onScreen"), cm.get("occluded")))
    if up: parts.append("best climb %+.2f m (%s)" % (up["dy"], up["dir"]))
    parts.append("all four headings stuck=%s, worst bonk frames %d" % (allStuck, maxBonk))
    diedIn = []
    if se["died"]: diedIn.append("standing still")
    for w in walks:
        if w["died"]: diedIn.append("walking " + w["dir"])
    if jp and jp["died"]: diedIn.append("jumping")
    anydied = bool(diedIn)
    if diedIn: parts.append("DIED while: " + ", ".join(diedIn))
    why = "; ".join(parts)

    # A no-death conclusion is only worth anything where the ORIGINAL report was a
    # death at this spot, and only for the classes whose test IS standing there.
    DEATH_OK = ("idle-crush", "pads/belts/currents", "geometry", "clock/reset", "stairs", "water/swim")
    if "death" in sig:
        if anydied: return "STILL REPRODUCES", "still dies at the recorded spot -- " + why
        if d["cls"] in DEATH_OK:
            return "FIXED", "no death in settle + 4 held-W walks + a jump at the recorded spot -- " + why
    if d["cls"] == "stairs" and up is not None and wb:
        if up["dy"] >= 1.0 and wb["disp"] >= 2.0:
            return "FIXED", "climbs %+.2f m from the recorded foot -- %s" % (up["dy"], why)
        if allStuck and maxBonk >= 3:
            return "STILL REPRODUCES", "still walled at the recorded foot -- " + why
    if "stuck" in sig and wb:
        if allStuck and se["drift"] < 0.6 and not anydied:
            return "STILL REPRODUCES", "still immobile -- " + why
        if wb["disp"] >= 2.0:
            return "FIXED", "moves freely now -- " + why
    if "bonk" in sig and wb:
        if maxBonk >= 4 and allStuck:
            return "STILL REPRODUCES", "still bonking -- " + why
        if wb["disp"] >= 2.5 and wb["bonk"] <= 1:
            return "FIXED", "walks through now -- " + why
    if "camocc" in sig and cm and cm.get("camDist") is not None:
        bad = (cm.get("onScreen") is False) or (cm.get("occluded") is True) or (cm["camDist"] < 1.55)
        if bad: return "STILL REPRODUCES", "hero unframed / lens too close -- " + why
        return "FIXED", "hero framed at >= minDist, unoccluded -- " + why
    if "nocollide" in sig and wb and se:
        # a hazard/pad/critter that does nothing: the station is inert
        if not anydied and wb["disp"] >= 2.0 and se["drift"] < 0.3:
            return None, why   # inert probe cannot tell -- needs the driver
    return None, why

def main():
    self_rep = SR.build()
    # hand verdicts from reading the replay FRAMES (a colour / legibility / "reads as"
    # complaint is not answered by a state probe)
    try:
        FRAMEV = json.load(open(os.path.join(RP, "_frame_verdicts.json"), encoding="utf-8"))
    except Exception:
        FRAMEV = {}
    rows = []
    for d in IDX:
        d["_sig"] = signature(d)
        st = station_for(d["course"], d.get("coords"))
        v = w = None
        src = ""
        if d["key"] in self_rep:
            v, w = self_rep[d["key"]]; src = "driver self-report"
        for fn, name in ((P4M.decide, "scene/console probe (probe4)"),
                         (P3M.decide, "mechanism probe (probe3)"),
                         (P2M.decide, "mechanism probe (probe2)")):
            if v is not None: break
            vv, ww = fn(d)
            if vv: v, w, src = vv, ww, name
            elif ww and not w: w = ww
        if v is None:
            vv, ww = probe_verdict(d, st)
            if vv: v, w, src = vv, ww, "coordinate probe"
            elif ww and not w: w = ww
        # A purely VISUAL complaint ("renders as", "reads as", a colour, legibility) is
        # not decided by a state probe. Only a frame read or the tester's own driver may.
        visual_only = bool(d.get("needsFrame")) and not bool(d.get("mechanical"))
        if d["key"] in FRAMEV:
            v, w, src = FRAMEV[d["key"]][0], FRAMEV[d["key"]][1], "replay frame, read"
        elif visual_only and src.startswith(("mechanism", "coordinate")) and not src.startswith("scene/console"):
            v, src = None, "probe cannot decide a visual claim"
            w = "the defect is a rendering/legibility claim; " + (w or "")
        rows.append(OrderedDict([
            ("key", d["key"]), ("course", d["course"]), ("id", d["id"]), ("cls", d["cls"]),
            ("severity", d["sev"][:60]), ("signature", d["_sig"]),
            ("where", (d["where"] or "")[:200]),
            ("originally", (d["happened"] or "")[:220]),
            ("verdict", v or "COULD NOT TEST"),
            ("evidenceSource", src or ("coordinate probe (inconclusive)" if st else "none")),
            ("evidence", w or ""),
            ("probeStation", (st or {}).get("tag")), ("frame", (st or {}).get("png")),
        ]))
    json.dump(rows, open(os.path.join(RP, "_replay_verdicts.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    vc = Counter(r["verdict"] for r in rows)
    print("VERDICTS:", dict(vc))
    byc = {}
    for r in rows:
        b = byc.setdefault(r["cls"], Counter()); b[r["verdict"]] += 1
    for c in sorted(byc):
        b = byc[c]
        print("%-22s total %3d | fixed %3d | still %3d | cnt %3d" % (
            c, sum(b.values()), b["FIXED"], b["STILL REPRODUCES"], b["COULD NOT TEST"]))
    return rows

if __name__ == "__main__":
    main()
