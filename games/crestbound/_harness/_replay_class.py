# -*- coding: utf-8 -*-
import json, os, re
from collections import Counter
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_playreports")
defs = json.load(open(os.path.join(D, "_defects_index.json"), encoding="utf-8"))

# (class, [(regex, weight)]) -- weights tuned so the PRIMARY subject wins
RULES = {
 "key conflict": [(r"same (key|code|binding)",6),(r"key conflict",6),(r"orbitUp",5),
    (r"restart(s|ed)? (the course|the run)",3),(r"\bKeyR\b",4),(r"rebind",3),(r"DEFAULT_BINDINGS",4),
    (r"documented camera-up key",6),(r"binding",2)],
 "stairs": [(r"\bstair(s|case|way)?\b",6),(r"\bflight(s)?\b",4),(r"\briser(s)?\b",5),
    (r"built backwards",4),(r"\bstep up\b",2),(r"grand (double )?stair",6),(r"spiral stair",6),
    (r"stepUp",3)],
 "pound": [(r"ground ?pound",6),(r"\bpound(ing|ed)?\b",4),(r"poundHang|poundFall|poundLand",6),
    (r"pound-?jump",6)],
 "idle-crush": [(r"idle[- ]crush",8),(r"crush(er|ers|ed|ing)?\b",4),(r"squish|squash(ed)?\b",3),
    (r"piston",4),(r"killed while standing still",6),(r"crush volume",6)],
 "pads/belts/currents": [(r"jump ?pad",6),(r"speed ?pad",6),(r"conveyor",6),(r"\bbelt(s)?\b",5),
    (r"\bcurrent(s)?\b",4),(r"\bwind\b",4),(r"air current",6),(r"sandboard",5),(r"bounce pad",6),
    (r"\bupdraft\b",5),(r"\bpad\b",3),(r"\bfan\b",3),(r"seesaw",4),(r"\bmill(s)?\b",3),(r"rotor",3)],
 "collectibles": [(r"\bcoin(s)?\b",5),(r"\bsigil(s)?\b",5),(r"\bcrest(s)?\b",4),(r"collectib",5),
    (r"100 coins",6),(r"magnet",5),(r"\bpickup\b",4),(r"unobtainable",4),(r"pedestal",2)],
 "cannon/interact": [(r"\bcannon(s)?\b",6),(r"interact(ion|s)?\b",4),(r"\bOld Fen\b|\bFen\b",5),
    (r"painting (entry|gate)",5),(r"\bgatedoor\b|gate door",5),(r"power hat|\bhat\b",4),
    (r"breakable",4),(r"\bNPC\b",5),(r"talk (radius|prompt)",6),(r"\bprompt\b",3),(r"\bE key\b",3),
    (r"course card",3)],
 "clock/reset": [(r"course clock",6),(r"\breset\(",5),(r"\brespawn(s|ed|ing)?\b",4),
    (r"checkpoint",4),(r"\btimer\b",4),(r"race (timer|clock)",6),(r"\bpar\b",3),(r"determinis",6),
    (r"\bclock\b",4),(r"restart(s|ed)? the course",3),(r"soft-?lock",4),(r"save",3)],
 "long-jump gaps": [(r"long ?jump",6),(r"\bgap\b",5),(r"REACH_TABLE|reach envelope|reachcheck",5),
    (r"too far to jump|cannot be reached by|unreachable jump",6),(r"triple jump",4),
    (r"backflip",4),(r"sideflip",4),(r"wall ?kick",4),(r"\bapex\b",3),(r"run-?up",3)],
 "signs/HUD": [(r"\bsign(s|age|board)?\b",5),(r"\bHUD\b",6),(r"\btoast\b",5),(r"text plate",6),
    (r"letter(ing|s)\b",4),(r"\blabel\b",3),(r"\bmenu\b",4),(r"typograph|font\b",4),
    (r"subtitle",3),(r"readable text|unreadable",4),(r"\bcopy\b",2),(r"\bspell",3)],
 "water/swim": [(r"\bwater\b",5),(r"\bswim(s|ming)?\b",6),(r"submerg",5),(r"underwater",5),
    (r"\bbrook\b",5),(r"lagoon|\bmoat\b|\bpool\b|\blake\b",4),(r"\bdrown",5),(r"\bwade\b",5),
    (r"\bsplash\b",3),(r"surface hop",6),(r"swimIdle|swimDive",6)],
 "camera": [(r"\bcamera\b",6),(r"\bcam\b",4),(r"occlud",6),(r"clip(s|ping|ped) through",4),
    (r"framing|not in frame|off screen|off-screen",5),(r"\bFOV\b|field of view",5),
    (r"\borbit\b",4),(r"near plane",5),(r"recenter",5),(r"\bpeek\b",4),(r"follow camera",6)],
 "geometry": [(r"z-?fight",6),(r"coplanar",6),(r"\bseam(s)?\b",5),(r"built twice|duplicate|doubled",5),
    (r"buried",5),(r"floating in (mid ?air|the air)",5),(r"hole in the",5),(r"fell? through",5),
    (r"out of the world|into the void",5),(r"\bcollider(s)?\b",4),(r"\bterrain\b",4),
    (r"\bLOD\b",4),(r"intersect",4),(r"clip(s|ping)? into",3),(r"misplaced",4),(r"\bmesh(es)?\b",3),
    (r"heightfield",4),(r"\bfog\b",3),(r"contrast",3),(r"washed out",3)],
}

FORCE = [
 ("key conflict", r"same (key|code|binding)|documented camera-up key|orbitUp is KeyR|ACTIONS orbitUp|INVERTED\. .{0,80}pitch|orbit ?up.{0,40}(dropped|lowered)|restart(ed)? .{0,40}(holding|pressing) (the )?(camera|orbit)"),
 ("geometry", r"soft-?lock|never moved and never died|stuck inside the geometry|inside the geometry at|froze: position|wedged (in|between)|cannot escape|trapped"),
]
def force(d):
    t = " ".join([d["where"], d["did"], d["happened"], d["should"]])
    for name, pat in FORCE:
        if re.search(pat, t, re.I): return name
    return None

def classify(d):
    where = (d["where"] or "").lower()
    body  = " ".join([d["did"], d["happened"], d["should"], d["note"]]).lower()
    best, bs = None, 0.0
    scores = {}
    for name, pats in RULES.items():
        s = 0.0
        for pat, w in pats:
            nb = len(re.findall(pat, body, re.I))
            nw = len(re.findall(pat, where, re.I))
            if nb: s += w * (1.0 + 0.35 * min(nb - 1, 3))
            if nw: s += w * 1.6 * min(nw, 2)
        scores[name] = s
        if s > bs: best, bs = name, s
    d["_scores"] = {k: round(v,1) for k,v in sorted(scores.items(), key=lambda kv:-kv[1])[:3] if v>0}
    return best or "geometry"

c = Counter()
for d in defs:
    d["cls"] = force(d) or classify(d); c[d["cls"]] += 1
json.dump(defs, open(os.path.join(D, "_defects_index.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
for k,v in c.most_common(): print("%-24s %d" % (k,v))
print("TOTAL", len(defs))
