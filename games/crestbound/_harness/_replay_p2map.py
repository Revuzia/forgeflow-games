# -*- coding: utf-8 -*-
"""Map probe2 mechanism tests onto defects."""
import json, os, re, glob, math
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "_replayout")

P2 = {}
for f in glob.glob(os.path.join(OUT, "probe2_*.json")):
    try:
        j = json.load(open(f, encoding="utf-8"))
        if j.get("course"): P2[j["course"]] = j
    except Exception: pass

SUBJ = {
  "warden":    r"\bwarden\b",
  "breakable": r"breakable|crate|urn|glyph wall|portcullis|\bbell\b|hay wall|ice plug|coral wall|drain stone|mezzanine",
  "cannon":    r"\bcannon\b|shaft-?gun|chaff gun",
  "power":     r"power hat|\bwing\b|\bmetal\b (hat|power)|iron hat|the .{0,12}hat\b|power:|\bvanish\b power",
  "race":      r"\brace\b|raceMs|slalom|timed run",
  "quicksand": r"quicksand",
  "conveyor":  r"conveyor|\bbelt\b|smelter belt|hay belt",
  "pad":       r"jump ?pad|speed ?pad|geyser pad|launcher|bounce pad",
  "seesaw":    r"seesaw",
  "gnasher":   r"gnasher",
  "crest":     r"\bcrest\b",
  "sigil":     r"\bsigil\b",
  "keyR":      r"\bKeyR\b|orbitUp|camera-up key|orbit ?up",
}

def near(a, b, r=3.5):
    if not a or not b: return False
    return math.dist(a, b) <= r

def decide(d):
    """-> (verdict, evidence) or (None, '')"""
    pr = P2.get(d["course"])
    if not pr: return None, ""
    text = " ".join([d["where"], d["did"], d["happened"], d["should"]])
    coords = d.get("coords") or []
    hits = []
    for t in pr.get("tests", []):
        k = t.get("kind")
        pat = SUBJ.get(k)
        if not pat or not re.search(pat, text, re.I): continue
        if k == "keyR":
            hits.append(t); continue
        tp = t.get("p") or t.get("post") or t.get("start")
        # positional match REQUIRED for every object test (keyR is course-wide and
        # returns above); otherwise the first pad / cannon / crest in the course
        # answers for a defect that merely mentions one.
        if not tp or not coords or not any(near(tp, c, 4.5) for c in coords): continue
        hits.append(t)
    if not hits: return None, ""
    t = hits[0]
    k = t["kind"]
    if t.get("error"): return None, "probe2 %s error: %s" % (k, t["error"])
    q = json.dumps({x: y for x, y in t.items() if x != "kind"})[:300]

    if k == "keyR":
        # two separable defects live on this key: the RESTART conflict and the INVERSION
        if re.search(r"restart", text, re.I) and not re.search(r"invert", text, re.I):
            if t.get("restarted"):
                return "STILL REPRODUCES", "holding R still restarts the course (clock %s -> %s)" % (t["clockBefore"], t["clockAfter"])
            return "FIXED", "holding R no longer restarts: clock ran %s -> %s and the run survived (restart moved off R)" % (t["clockBefore"], t["clockAfter"])
        pb, pa = t.get("pitchBefore"), t.get("pitchAfter")
        if pb is not None and pa is not None:
            if pa < pb - 0.02:
                return "STILL REPRODUCES", "orbitUp (R) still LOWERS the camera: pitch %.2f -> %.2f" % (pb, pa)
            if pa > pb + 0.02:
                return "FIXED", "orbitUp (R) raises the camera: pitch %.2f -> %.2f" % (pb, pa)
        return None, q
    if k == "warden":
        return ("FIXED" if t.get("woke") else "STILL REPRODUCES"), \
               ("the warden wakes -- " if t.get("woke") else "the warden is still a statue -- ") + q
    if k == "breakable":
        return ("FIXED" if t.get("broke") else "STILL REPRODUCES"), \
               ("a ground pound breaks it -- " if t.get("broke") else "a ground pound still does not break it -- ") + q
    if k == "cannon":
        # `entered` only catches the 'cannon' state at the two sample instants; a launch
        # of tens of metres is the effect that matters and is unambiguous.
        moved = t.get("moved") or 0
        fired = bool(t.get("entered")) or moved > 8.0
        return ("FIXED" if fired else "STILL REPRODUCES"), \
               (("the hero boards and is launched %.1f m -- " % moved) if fired
                else ("the hero still cannot board (moved %.2f m) -- " % moved)) + q
    if k == "power":
        return ("FIXED" if t.get("got") else "STILL REPRODUCES"), \
               ("the hat is taken -- " if t.get("got") else "the hat is still not taken -- ") + q
    if k == "race":
        return ("FIXED" if t.get("armed") else "STILL REPRODUCES"), \
               ("the race arms -- " if t.get("armed") else "the race still never arms (raceMs null) -- ") + q
    if k == "quicksand":
        live = bool(t.get("inQuicksand")) or (t.get("sank") or 0) > 0.25
        return ("FIXED" if live else "STILL REPRODUCES"), \
               ("the pool grips -- " if live else "the pool is still inert -- ") + q
    if k == "conveyor":
        carried = t.get("carried") or 0
        if re.search(r"carried .{0,24}(off|and killed)|off the deck|killed", text, re.I):
            died = str(t.get("deaths", "")).split("->")
            still = len(died) == 2 and died[0] != died[1]
            return ("STILL REPRODUCES" if still else "FIXED"), \
                   ("the belt still carries you off and kills -- " if still else "the belt no longer kills a standing hero -- ") + q
        if carried < 0.4:
            return "STILL REPRODUCES", "the belt still does not carry (%.2f m in 3 s) -- %s" % (carried, q)
        return "FIXED", "the belt carries %.2f m in 3 s -- %s" % (carried, q)
    if k == "pad":
        rise = t.get("rise") or 0; top = t.get("topSpeed") or 0
        if t.get("padKind") == "speedpad":
            return ("FIXED" if top > 9.4 else "STILL REPRODUCES"), \
                   ("the speed pad boosts to %.2f m/s -- " % top if top > 9.4 else "the speed pad still does nothing (top %.2f m/s, run cap is 9.00) -- " % top) + q
        return ("FIXED" if rise > 1.0 else "STILL REPRODUCES"), \
               ("the pad launches %.2f m -- " % rise if rise > 1.0 else "the pad still does not fire (%.2f m) -- " % rise) + q
    if k == "seesaw":
        return ("FIXED" if t.get("tilted") else "STILL REPRODUCES"), \
               ("the seesaw tilts -- " if t.get("tilted") else "the seesaw collider is still identity (never moves) -- ") + q
    if k == "gnasher":
        if re.search(r"kill|died|death|reaches the post|bite", text, re.I):
            return ("STILL REPRODUCES" if t.get("killed") else "FIXED"), \
                   ("it still kills a hero standing 3.0 m from the post -- " if t.get("killed") else "a hero standing 3.0 m from the post survives 4 s -- ") + q
        return None, q
    if k == "crest":
        # sigils / coins / secret / boss crests are GATED: not collecting on bare
        # contact is correct, so only an `open` crest (or a positive result) decides.
        if t.get("got"):
            return "FIXED", "the crest collects on contact -- " + q
        if t.get("crestType") == "open":
            return "STILL REPRODUCES", "the open crest still does not collect on contact -- " + q
        return None, "gated crest (%s); contact alone cannot decide -- %s" % (t.get("crestType"), q)
    if k == "sigil":
        if re.search(r"unreachab|never spawn|does not collect|not collected|never collect|cannot be (taken|reached)|unobtainable", text, re.I):
            return ("FIXED" if t.get("got") else "STILL REPRODUCES"), \
                   ("it collects on contact -- " if t.get("got") else "it still does not collect on contact -- ") + q
        return None, q
    return None, q
